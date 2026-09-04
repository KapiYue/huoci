# 活词网关

`design.md` §12.1 T8。**nginx 唯一入口 + location 分流**，不是「Flask 全代理」。

> **要把它装到服务器上 → `docs/gateway-deployment.md`**（初始化 / 证书 / nginx / systemd / 验收 / 运维）。
> 本文说的是**代码分工与端点契约**，部署步骤不在这里。

```
小程序 ──► nginx ──┬─ /auth/v1 /rest/v1 ─────► 词鲸 Supabase（无状态透传，keepalive）
                   └─ /wx/*  /functions/v1 ──► 本机 Flask（有状态）
```

主流量不进 Flask：Python 那一跳既没必要，又会把跨境延迟叠上进程开销。

## 文件

| 文件 | 作用 |
|---|---|
| `wx_blueprint.py` | Flask Blueprint，提供 `/wx/login` `/wx/attach` `/wx/msgseccheck` |
| `functions_blueprint.py` | Flask Blueprint，提供 `/functions/v1/<name>` 的**过检代理**（白名单） |
| `nginx/huoci.conf` | nginx 站点配置 |
| `.env.example` | 需要的环境变量 |

## 装到词鲸的 Flask 里

`cijing/server/app.py` 已经是一个能透传 `/auth/v1` `/rest/v1` `/functions/v1` 的代理。
把本目录的 blueprint 挂上去即可：

```python
from huoci_gateway.wx_blueprint import wx_bp
from huoci_gateway.functions_blueprint import functions_bp

app.register_blueprint(wx_bp)                                        # → /wx/*
app.register_blueprint(functions_bp, url_prefix="/hc/functions/v1")  # ← 私有前缀，见下
```

⚠️ `cijing/server/app.py` 自己也有一条 `/functions/v1/<path>` 的透传路由。同一条路径注册两次，
谁生效取决于 Werkzeug 的内部排序 —— **不可预测**，而赌错的后果是 AI 返回的文本绕过
`msgSecCheck`（§12.4 第 5 条）。

**已定做法（`docs/gateway-deployment.md` §4.2 / §6.2）**：活词这条挂到私有前缀
`/hc/functions/v1`，由 nginx 把公网的 `/functions/v1/` 重写过去
（`proxy_pass http://huoci_flask/hc/functions/v1/;`）。这样公网根本打不到词鲸那条透传路由，
结果是确定的、不依赖注册顺序。

验收：`POST /functions/v1/not-in-whitelist` 必须返回 **404 +「未开放的函数」**。
返回别的，就说明请求落到了词鲸那条透传路由上。

nginx 上线后，`/auth/v1` 与 `/rest/v1` 由 nginx 直接打 Supabase，
Flask 里那两个透传路由就只在本地开发时用得上了。

## 端点

### `POST /wx/login`

微信一键登录。新用户建账号，老用户换 session。

```jsonc
// 请求（匿名）
{ "code": "wx.login 拿的 code", "nickname": "可选", "avatar_url": "可选" }
// 响应
{ "openid": "...", "unionid": null, "session": { "access_token": "...", "refresh_token": "...", "expires_in": 3600, "user": {...} } }
```

登录方案是 **T3 的 B：按 openid 派生服务端密码 + signInWithPassword**。
`password = HMAC-SHA256(HUOCI_WX_DERIVE_SECRET, "openid:secret_version")[:48]`，
邮箱是 `wx_<sha256(openid)[:32]>@$HUOCI_WX_EMAIL_DOMAIN`。

### `POST /wx/attach`

把 openid 挂到**已登录**账号上（邮箱登录的老词鲸用户走这条）。需要 `Authorization: Bearer`。

> ⚠️ 这条**极易漏**。`msgSecCheck` v2 必传 openid；邮箱登录的用户若没走过 `wx.login`，
> 网关手里没有 openid，一调 AI 内容就炸。客户端的 `auth.loginWithPassword()` 里已经自动调它。

### `POST /wx/msgseccheck`

文本内容安全检测。§14.4 第 5 条：**在网关做，不在 Edge Function 做**。
收窄口径：用户自己粘贴、只给自己看、不外传的阅读器正文**不逐段送检**；
必须过检的是 **AI 返回的文本**与**任何进入分享链路的内容**。

### `POST /functions/v1/<name>`

Edge Function 的过检代理。**白名单**：`lookup-word`（P2 查词）、`explain-reading-word`（P3）。
不做通配代理 —— 通配等于给每个新增的 Edge Function 自动开一条绕过审核的入口。

- 用**调用者自己的 JWT** 转发（Edge Function 里的 `requireUser` 要认人，
  `lexicon_cache` 的 RLS 也落在他名下）。**绝不能换成 service_role。**
- 检的是**响应**不是请求：只把 AI 返回的释义/例句字段拼起来送检，
  不送整个 JSON（大括号和字段名一起算字数，费额度又容易误判）。
- openid 从 `hc_wechat_identities` 按 JWT 里的 user_id 查，**不信客户端传的**。
  查不到就跳过检测并打一行日志 —— 那行日志是「审核到底有没有在跑」的唯一证据。
- 命中违规返回 **422 + `blocked: true`**，不下发内容。

## 上线前必须做的两件事

**具体步骤与预期结果 → `docs/gateway-deployment.md` §9（`[09-04]` 已写成可照做的版本）。**
这里只说是什么、为什么。

1. **调高 Supabase 的 per-IP 限流并压测。**
   网关是单一出口 IP ⇒ per-IP 限流对整个 App 生效 —— 默认的「每 IP 每 5 分钟 30 次登录」
   意味着**全 App 每分钟只能有 6 个人登录**。这是 T3 两个方案通吃的坑，不处理的话用户一多就
   集体登录失败。⚠️ **压测必须在网关那台机器上跑**，从自己电脑打过去是另一个 IP，测了等于没测。
2. **实测 T5**（服务器域名是否要求与小程序同主体备案）—— **没有公开文档能答，只能在后台试**。
   `[09-04]` 它的赌注变大了：`joy-coder.com` 是**个人**备案、小程序是**个体户**主体，
   T5 的答案直接决定开发期能不能借 `api.joy-coder.com` 联调（`gateway-deployment.md` §1.1）。
   ⚠️ 生产**不能**长期挂在 `.com` 上 —— 个人备案不得承载经营性服务。**不阻塞编码。**
