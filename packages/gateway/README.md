# 活词网关

《执行方案》§14.1 T8。**nginx 唯一入口 + location 分流**，不是「Flask 全代理」。

```
小程序 ──► nginx ──┬─ /auth/v1 /rest/v1 ─────► 词鲸 Supabase（无状态透传，keepalive）
                   └─ /wx/*  /functions/v1 ──► 本机 Flask（有状态）
```

主流量不进 Flask：Python 那一跳既没必要，又会把跨境延迟叠上进程开销。

## 文件

| 文件 | 作用 |
|---|---|
| `wx_blueprint.py` | Flask Blueprint，提供 `/wx/login` `/wx/attach` `/wx/msgseccheck` |
| `nginx/huoci.conf` | nginx 站点配置 |
| `.env.example` | 需要的环境变量 |

## 装到词鲸的 Flask 里

`cijing/server/app.py` 已经是一个能透传 `/auth/v1` `/rest/v1` `/functions/v1` 的代理。
把本目录的 blueprint 挂上去即可：

```python
from huoci_gateway.wx_blueprint import wx_bp   # 或直接把文件拷进 server/
app.register_blueprint(wx_bp)
```

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

## 上线前必须做的两件事

1. **调高 Supabase 的 per-IP 限流并压测。**
   网关是单一出口 IP ⇒ per-IP 限流对整个 App 生效。这是 T3 两个方案通吃的坑，
   不处理的话用户一多就集体登录失败。
2. **确认 T5**（服务器域名是否要求与小程序同主体备案）。
   倾向结论是「不要求」，但需本人操作小程序后台核实。它决定生产网关能先挂
   `cijing.joy-coder.com` 还是必须等 `api.joy-coder.cn` 备案下来。**不阻塞编码。**
