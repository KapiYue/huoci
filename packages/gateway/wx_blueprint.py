"""活词小程序的 /wx/* 端点。挂进词鲸那个 Flask 进程。

`design.md` §12.1 T8 的分流约定：
    /auth/v1  /rest/v1  → nginx 无状态透传（开 keepalive），**不进 Flask**
    /wx/*                → 本机 Flask（有状态：AppSecret、openid 映射、access_token 缓存）

T3 的登录方案是 **B：按 openid 派生服务端密码 + signInWithPassword**。
放弃 A（magiclink）的理由：网关本来就常驻 service_role，持有它即可对任意用户
generateLink + verifyOtp，A 声称的「不用保管能登录全站的 secret」根本不成立；
而 B 少一跳跨境、复用已验证的密码链路、行为可预测。

两方案通吃的三个坑，本文件都处理了：
  1. **必须造合成邮箱** —— Supabase 的 password 登录以 email 为主键
  2. 建 user 时必须把昵称塞进 raw_user_meta_data.display_name，否则 handle_new_user 的
     兜底 split_part(NULL,'@',1) 会让昵称为空。拿不到就塞 '微信用户'
  3. **网关是单一出口 IP ⇒ Supabase 的 per-IP 限流对整个 App 生效**。上线前必须调高并压测。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import string
import time
from typing import Any
from urllib import error, parse, request as urlrequest

from flask import Blueprint, jsonify, request as flask_request

wx_bp = Blueprint("huoci_wx", __name__, url_prefix="/wx")

# 合成邮箱的域。用自有域名的子域，避免撞上真实邮箱，也避免被 Supabase 判为无效域。
SYNTHETIC_EMAIL_DOMAIN = os.getenv("HUOCI_WX_EMAIL_DOMAIN", "wx.joy-coder.cn")
TIMEOUT = 10


# ─────────────────────────── 基础设施 ───────────────────────────

def _env(name: str) -> str:
    value = os.getenv(name, "")
    if not value:
        raise RuntimeError(f"缺少环境变量 {name}")
    return value


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> tuple[int, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(url, data=body, headers={**headers, "content-type": "application/json"}, method="POST")
    try:
        with urlrequest.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return exc.code, {"message": raw.decode("utf-8", "replace")}


def _get_json(url: str, headers: dict[str, str]) -> tuple[int, Any]:
    req = urlrequest.Request(url, headers=headers, method="GET")
    try:
        with urlrequest.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return exc.code, {"message": raw.decode("utf-8", "replace")}


def _supabase() -> str:
    return _env("SUPABASE_URL").rstrip("/")


def _service_headers() -> dict[str, str]:
    key = _env("SUPABASE_SECRET_KEY")
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _anon_headers() -> dict[str, str]:
    key = os.getenv("SUPABASE_ANON_KEY") or _env("SUPABASE_SECRET_KEY")
    return {"apikey": key}


# ─────────────────────────── 派生密码 ───────────────────────────

def _derive_password(openid: str, version: int) -> str:
    """HMAC(secret, openid:version)。轮转靠 secret_version 惰性重派生（T3 未决项①）。

    ⚠️ HUOCI_WX_DERIVE_SECRET 一旦泄露，等于泄露全部微信用户的密码。
    它和 service_role 同级，只放服务器环境变量，不进仓库、不进日志。
    """
    secret = _env("HUOCI_WX_DERIVE_SECRET").encode("utf-8")
    mac = hmac.new(secret, f"{openid}:{version}".encode("utf-8"), hashlib.sha256)
    # 48 位十六进制，远超 Supabase 的密码强度要求
    return mac.hexdigest()[:48]


def _synthetic_email(openid: str) -> str:
    """openid 本身含大小写与下划线，直接当 local-part 有风险，取哈希更稳。"""
    digest = hashlib.sha256(openid.encode("utf-8")).hexdigest()[:32]
    return f"wx_{digest}@{SYNTHETIC_EMAIL_DOMAIN}"


# ─────────────────────────── 微信侧 ───────────────────────────

def _code2session(code: str) -> dict[str, Any]:
    params = parse.urlencode({
        "appid": _env("HUOCI_WX_APPID"),
        "secret": _env("HUOCI_WX_APPSECRET"),
        "js_code": code,
        "grant_type": "authorization_code",
    })
    url = f"https://api.weixin.qq.com/sns/jscode2session?{params}"
    req = urlrequest.Request(url, method="GET")
    with urlrequest.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read() or b"{}")
    if data.get("errcode"):
        raise ValueError(f"code2session 失败：{data.get('errcode')} {data.get('errmsg')}")
    if not data.get("openid"):
        raise ValueError("code2session 没返回 openid")
    return data


# ─────────────────────────── Supabase 侧 ───────────────────────────

def _sign_in(email: str, password: str) -> tuple[int, Any]:
    return _post_json(
        f"{_supabase()}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        _anon_headers(),
    )


def _find_identity(openid: str) -> dict[str, Any] | None:
    q = parse.urlencode({"openid": f"eq.{openid}", "select": "openid,user_id,secret_version"})
    status, rows = _get_json(f"{_supabase()}/rest/v1/hc_wechat_identities?{q}", _service_headers())
    if status != 200 or not rows:
        return None
    return rows[0]


def _create_user(email: str, password: str, display_name: str, avatar_url: str | None) -> None:
    """建 auth user。**邮箱已存在不算失败** —— 见下面 wx_login 里的自愈说明。

    合成邮箱是 openid 的纯函数，`email_exists` 只可能是「上一次建成了但后续步骤挂了」。
    这时候要的是接着往下走（登录 + 补写映射），不是把用户永久挡在门外。
    """
    # 坑 2：昵称必须进 user_metadata.display_name，否则 handle_new_user 的兜底会让昵称为空
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {"display_name": display_name or "微信用户", "avatar_url": avatar_url},
    }
    status, data = _post_json(f"{_supabase()}/auth/v1/admin/users", payload, _service_headers())
    if status in (200, 201):
        return
    if status == 422 and isinstance(data, dict) and data.get("error_code") == "email_exists":
        return
    raise RuntimeError(f"建用户失败：{status} {data}")


def _link_identity(openid: str, unionid: str | None, user_id: str, version: int = 1) -> None:
    payload = {
        "openid": openid,
        "unionid": unionid,
        "user_id": user_id,
        "secret_version": version,
    }
    status, data = _post_json(
        f"{_supabase()}/rest/v1/hc_wechat_identities",
        payload,
        {**_service_headers(), "Prefer": "resolution=merge-duplicates"},
    )
    if status not in (200, 201, 204):
        raise RuntimeError(f"写 hc_wechat_identities 失败：{status} {data}")


def _user_from_token(access_token: str) -> dict[str, Any] | None:
    status, data = _get_json(
        f"{_supabase()}/auth/v1/user",
        {**_anon_headers(), "Authorization": f"Bearer {access_token}"},
    )
    return data if status == 200 and isinstance(data, dict) else None


# ─────────────────────────── 端点 ───────────────────────────

@wx_bp.post("/login")
def wx_login():
    """微信一键登录。新用户建账号，老用户直接换 session。"""
    body = flask_request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()
    if not code:
        return jsonify({"message": "缺少 code"}), 400

    try:
        session_info = _code2session(code)
    except Exception as exc:  # noqa: BLE001 —— 微信侧的错要原样告诉客户端
        return jsonify({"message": str(exc)}), 502

    openid = session_info["openid"]
    unionid = session_info.get("unionid")
    email = _synthetic_email(openid)

    identity = _find_identity(openid)
    version = int(identity["secret_version"]) if identity else 1
    password = _derive_password(openid, version)

    # 建号与写映射不是一个事务。原来的顺序（建号 → 立刻写映射）一旦在中间失败，
    # 就留下一个没有映射行的 auth 账号：下次重来仍然查不到 identity，于是再建号，
    # 撞 email_exists → 502，**这个 openid 被永久堵死，只能人工进后台删账号**。
    # 现在改成：建号容忍已存在 → 先登录 → 用 token 里的 user.id 补写映射。
    # 任何一步失败，下一次重试都能自愈。
    if identity is None:
        display_name = (body.get("nickname") or "").strip() or "微信用户"
        try:
            _create_user(email, password, display_name, body.get("avatar_url"))
        except RuntimeError as exc:
            return jsonify({"message": str(exc)}), 502

    status, token = _sign_in(email, password)
    if status != 200:
        # 密码对不上通常意味着 secret 轮转过但 secret_version 没升。
        # 这里不静默重试——静默重试会把「密钥配错」伪装成偶发失败。
        return jsonify({"message": "微信登录失败，请稍后重试", "detail": token}), 502

    if identity is None:
        user_id = str(((token or {}).get("user") or {}).get("id") or "")
        if not user_id:
            return jsonify({"message": "登录返回里没有 user.id", "detail": token}), 502
        try:
            _link_identity(openid, unionid, user_id, version)
        except RuntimeError as exc:
            return jsonify({"message": str(exc)}), 502

    # unionid 可能是这次才拿到的（用户刚关注了同主体的公众号），顺手补写
    if unionid and identity is not None and not identity.get("unionid"):
        try:
            _link_identity(openid, unionid, identity["user_id"], version)
        except RuntimeError:
            pass

    return jsonify({"openid": openid, "unionid": unionid, "session": token})


@wx_bp.post("/attach")
def wx_attach():
    """把 openid 挂到**当前已登录**的账号上（邮箱登录的老词鲸用户走这条）。

    §5.3 的红字：msgSecCheck v2 必传 openid。邮箱登录的用户若没走过 wx.login，
    网关手里没有 openid，一调 AI 内容就炸。**极易漏。**
    """
    auth_header = flask_request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return jsonify({"message": "缺少登录态"}), 401
    access_token = auth_header[7:].strip()

    user = _user_from_token(access_token)
    if not user or not user.get("id"):
        return jsonify({"message": "登录态无效"}), 401

    body = flask_request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()
    if not code:
        return jsonify({"message": "缺少 code"}), 400

    try:
        session_info = _code2session(code)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"message": str(exc)}), 502

    openid = session_info["openid"]
    existing = _find_identity(openid)
    if existing and existing["user_id"] != user["id"]:
        # 一个微信只能绑一个账号（hc_wechat_identities.user_id 上的 UNIQUE 是同一条规则的另一半）
        return jsonify({"message": "这个微信已经绑定了另一个账号"}), 409

    try:
        _link_identity(openid, session_info.get("unionid"), user["id"],
                       int(existing["secret_version"]) if existing else 1)
    except RuntimeError as exc:
        return jsonify({"message": str(exc)}), 502

    return jsonify({"openid": openid})


# ─────────────────────────── 内容审核 ───────────────────────────

_token_cache: dict[str, Any] = {"value": "", "expires_at": 0.0}


def _access_token() -> str:
    """微信 access_token 全局唯一且有配额，**必须缓存**。多进程部署时改用 Redis。"""
    now = time.time()
    if _token_cache["value"] and now < _token_cache["expires_at"]:
        return str(_token_cache["value"])
    params = parse.urlencode({
        "grant_type": "client_credential",
        "appid": _env("HUOCI_WX_APPID"),
        "secret": _env("HUOCI_WX_APPSECRET"),
    })
    with urlrequest.urlopen(f"https://api.weixin.qq.com/cgi-bin/token?{params}", timeout=TIMEOUT) as resp:
        data = json.loads(resp.read() or b"{}")
    if not data.get("access_token"):
        raise RuntimeError(f"取 access_token 失败：{data}")
    _token_cache["value"] = data["access_token"]
    _token_cache["expires_at"] = now + int(data.get("expires_in", 7200)) - 300
    return str(data["access_token"])


# ─────────────────────── 内容安全：返回体解释 ───────────────────────
#
# 微信在**业务失败时也返回 HTTP 200**，错误只体现在 body 的 errcode 上
# （48001 未认证 / 40001 token 失效 / 45009 调用超额 / 61010 session 过期…）。
# 所以「HTTP 200」不等于「检过了」，必须先读 errcode 再读 result。
#
# 🔴 绝对不要写成 `((data or {}).get("result") or {}).get("suggest", "pass")`：
#    出错时 result 缺失 → 默认值兜成 "pass" → 整条审核链**静默降级成 no-op**，
#    而且一条日志都不会打，直到线上出事才会发现。这是本文件最贵的一个坑。

# 命中违规时微信不一定走 result.suggest，也可能直接用 errcode 表达（v1 的历史行为）。
# 这个码必须映射成「违规」，映射成「检不了」就等于放行。
SEC_CHECK_RISKY_ERRCODES = {87014}


def sec_check_enabled() -> bool:
    """内容安全总开关，默认**开**。

    `HUOCI_WX_SECCHECK=off|0|false|no` 时跳过送检并留痕。
    用途是微信侧故障 / 额度耗尽时的**应急旁路**，不是常态，更不是省额度的手段。
    """
    return os.getenv("HUOCI_WX_SECCHECK", "on").strip().lower() not in {"0", "off", "false", "no"}


def interpret_sec_check(data: Any) -> bool | None:
    """把 msg_sec_check 的返回体翻译成 True=通过 / False=违规 / None=没检成。

    None 与 True 的区别是**故意**的：调用方可以选择放行，但必须自己写下这条日志，
    不能让「没检成」伪装成「检过了」。
    """
    if not isinstance(data, dict):
        print(f"[wx] msg_sec_check 返回体不是对象：{data!r}")
        return None

    errcode = data.get("errcode") or 0
    if errcode in SEC_CHECK_RISKY_ERRCODES:
        return False
    if errcode:
        print(f"[wx] msg_sec_check 调用失败 errcode={errcode} errmsg={data.get('errmsg')!r}")
        return None

    result = data.get("result")
    if not isinstance(result, dict) or not result.get("suggest"):
        # errcode=0 却没有 result，说明微信改了返回体或我们传错了 version。
        # 这时放行是权衡后的选择，但必须吵出来。
        print(f"[wx] msg_sec_check 返回体缺 result.suggest：{data!r}")
        return None

    # suggest ∈ {pass, review, risky}。review（疑似）**不放行** —— 这是查词场景，
    # 宁可少给一条释义，不可放过一条违规内容。
    return result["suggest"] == "pass"


@wx_bp.post("/msgseccheck")
def msg_sec_check():
    """文本内容安全检测。§14.4 第 5 条：在网关做，不在 Edge Function 做。

    ⚠️ 收窄口径（§14.4 第 5 条 09-01 修订）：用户自己粘贴、只给自己看、不外传的
    阅读器正文**不逐段送检**（费额度又拖首屏）。必须过检的是 **AI 返回的文本**
    与**任何进入分享链路的内容**。
    """
    body = flask_request.get_json(silent=True) or {}
    content = (body.get("content") or "").strip()
    openid = (body.get("openid") or "").strip()
    scene = int(body.get("scene") or 3)
    if not content or not openid:
        return jsonify({"message": "缺少 content 或 openid"}), 400

    # `checked` 是给调用方的诚实信号：pass=true 但 checked=false 意味着**放行了但没检**。
    # 客户端可以不理它，但日志和排查必须能区分这两种 pass。
    if not sec_check_enabled():
        print(f"[wx] msg_sec_check 已被 HUOCI_WX_SECCHECK 关闭，未送检 len={len(content)}")
        return jsonify({"pass": True, "suggest": "skipped", "checked": False})

    payload = {"content": content, "version": 2, "scene": scene, "openid": openid}
    try:
        token = _access_token()
    except RuntimeError as exc:
        return jsonify({"message": str(exc)}), 502

    status, data = _post_json(
        f"https://api.weixin.qq.com/wxa/msg_sec_check?access_token={token}",
        payload,
        {},
    )
    if status != 200:
        return jsonify({"message": "内容检测服务不可用"}), 502

    verdict = interpret_sec_check(data)
    if verdict is None:
        # 检不了不等于要拦（拦了等于微信一抖动全站查词就废）。放行，但如实标注。
        return jsonify({"pass": True, "suggest": "unknown", "checked": False, "raw": data})
    return jsonify({
        "pass": verdict,
        "suggest": "pass" if verdict else "risky",
        "checked": True,
        "raw": data,
    })


# ─────────────────────── 小程序码（成果海报用） ───────────────────────
#
# `design.md` §5.9 L4 + §14.4：成果海报是 canvas 画的，**图上要带小程序码**，
# 且所有分享带 `scene` 参数用于归因。小程序码只能服务端出 —— 接口要 access_token。
#
# 用 `getwxacodeunlimit`（数量不限）而不是 `createwxaqrcode`（总量上限 10 万，
# 且生成后无法回收）：海报是一人一张、带各自 scene 的，数量天然发散。
#
# 🔴 **四个坑，每个都能让这条链路静默坏掉：**
#
# 1. **成功返回的是图片二进制，失败返回的是 JSON，HTTP 状态码都是 200。**
#    照着别处的 `_post_json` 抄，失败时会拿 JSON 当图片存下去 ——
#    海报上就是一块糊的方块，没有任何报错。必须先看 content-type 再决定怎么解。
#
# 2. **`page` 不带前导斜杠、不带 query**（`pages/today/today`，不是 `/pages/today/today?a=1`）。
#    参数只能走 `scene`，这是接口的硬规定，不是风格问题。
#
# 3. **小程序没发布过，这个接口一定失败**（41030：page 不存在或未发布）。
#    活词现在卡在 ICP 备案 → 认证 → 首次发布这条链上，所以**上线前这条接口是通不了的**，
#    开发期必须传 `env_version=trial|develop` 且 `check_path=false`。
#    这不是 bug，别去调参数，见返回里的 `hint`。
#
# 4. **scene 最长 32 个可见字符，且字符集是白名单**（数字、大小写字母，加
#    `!#$&'()*+,/:;=?@-._~`）。中文、空格、`%`、`{}` 全部非法。
#    超长或越界时微信也只回 40097 之类的泛化错误，不会告诉你是哪个字符 ——
#    所以在**我们这一侧**先校验并把违规字符指出来。

WXACODE_SCENE_CHARS = frozenset(string.ascii_letters + string.digits + "!#$&'()*+,/:;=?@-._~")
WXACODE_SCENE_MAX = 32
WXACODE_ENV_VERSIONS = {"release", "trial", "develop"}
WXACODE_DEFAULT_PAGE = "pages/today/today"

# 生成一张码要走一次微信接口，配额有限（getwxacodeunlimit 每日 10 万次）。
# 同一个 scene 出的码是同一张图，缓存它是纯赚。
# ⚠️ 与 `_access_token` 同样的限制：**多进程部署时这份缓存要换成 Redis**，
# 否则 N 个进程各缓存各的，配额按 N 倍消耗。
_wxacode_cache: dict[str, tuple[float, bytes, str]] = {}
WXACODE_CACHE_TTL = 24 * 3600
WXACODE_CACHE_MAX = 500


def validate_wxacode_scene(scene: str) -> str | None:
    """返回 None 表示合法，否则返回**能直接给人看**的原因。"""
    if not scene:
        return "scene 不能为空"
    if len(scene) > WXACODE_SCENE_MAX:
        return f"scene 最长 {WXACODE_SCENE_MAX} 个字符，收到 {len(scene)} 个"
    bad = sorted({c for c in scene if c not in WXACODE_SCENE_CHARS})
    if bad:
        # 把违规字符列出来。微信只回一个泛化错误码，不列的话排查全靠猜。
        return "scene 含非法字符 " + " ".join(repr(c) for c in bad) + \
               "（只允许数字、大小写字母与 !#$&'()*+,/:;=?@-._~）"
    return None


def _post_binary(url: str, payload: dict[str, Any]) -> tuple[int, str, bytes]:
    """和 `_post_json` 的区别只有一处：**不预设返回是 JSON**，原样把字节和 content-type 带回来。"""
    body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(url, data=body, headers={"content-type": "application/json"}, method="POST")
    try:
        with urlrequest.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.headers.get("content-type", ""), resp.read()
    except error.HTTPError as exc:
        return exc.code, exc.headers.get("content-type", ""), exc.read()


def _looks_like_json(content_type: str, raw: bytes) -> bool:
    """content-type 是主判据，但微信偶尔回 `text/plain` 带 JSON 体，所以再嗅一次首字节。"""
    if "json" in content_type.lower():
        return True
    return raw[:1] in (b"{", b"[")


# 值得给出「怎么办」的错误码。其余的原样透传 errcode，不编解释。
WXACODE_HINTS = {
    41030: "page 不存在或小程序还没发布过。活词现在卡在 ICP 备案 → 微信认证 → 首次发布，"
           "**这条接口在首次发布前一定失败**。开发期请传 env_version=trial 或 develop。",
    45009: "调用超出频率限制（getwxacodeunlimit 每日 10 万次）。先查是不是缓存没生效。",
    40001: "access_token 失效。多进程部署时各进程各刷 token 会互相顶掉，换 Redis 共享。",
    40097: "参数不在合法范围内，绝大多数情况是 scene 越界 —— 但我们这边已经先校验过了，"
           "所以更可能是 page 带了前导斜杠或 query。",
}


@wx_bp.post("/wxacode")
def wxacode():
    """出一张带 scene 的小程序码，给 §5.9 L4 的成果海报用。

    要登录态：这个接口消耗微信配额，不能裸奔。
    返回 `{"image": "data:image/png;base64,…", "cached": bool}` 而不是裸二进制 ——
    客户端拿到后 `writeFile` 成临时文件再 `canvas.drawImage`，
    错误也能和别的 /wx/* 端点一样按 JSON 处理，不用为这一条写第二套解析。
    """
    auth_header = flask_request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return jsonify({"message": "缺少登录态"}), 401
    user = _user_from_token(auth_header[7:].strip())
    if not user or not user.get("id"):
        return jsonify({"message": "登录态无效"}), 401

    body = flask_request.get_json(silent=True) or {}
    scene = str(body.get("scene") or "").strip()
    page = str(body.get("page") or WXACODE_DEFAULT_PAGE).strip().lstrip("/")
    env_version = str(body.get("env_version") or os.getenv("HUOCI_WX_CODE_ENV", "release")).strip()
    try:
        width = int(body.get("width") or 280)
    except (TypeError, ValueError):
        width = 280
    width = max(280, min(1280, width))  # 微信侧的合法区间，越界会直接报错

    reason = validate_wxacode_scene(scene)
    if reason:
        return jsonify({"message": reason}), 400
    if "?" in page or "#" in page:
        # 坑 2：参数只能走 scene。这里挡住而不是悄悄截断——截断了页面会跳错地方。
        return jsonify({"message": "page 不能带 query 或 hash，参数一律走 scene"}), 400
    if env_version not in WXACODE_ENV_VERSIONS:
        return jsonify({"message": f"env_version 只能是 {'/'.join(sorted(WXACODE_ENV_VERSIONS))}"}), 400

    cache_key = f"{scene}|{page}|{env_version}|{width}"
    now = time.time()
    hit = _wxacode_cache.get(cache_key)
    if hit and now < hit[0]:
        return jsonify({"image": f"data:{hit[2]};base64,{hit[1].decode('ascii')}",
                        "scene": scene, "page": page, "cached": True})

    try:
        token = _access_token()
    except RuntimeError as exc:
        return jsonify({"message": str(exc)}), 502

    payload = {
        "scene": scene,
        "page": page,
        "width": width,
        "env_version": env_version,
        # 只有正式版才有「已发布的页面」可校验；trial/develop 下开着必然 41030
        "check_path": env_version == "release",
        "auto_color": False,
        "line_color": {"r": 0, "g": 0, "b": 0},
        "is_hyaline": False,
    }
    status, content_type, raw = _post_binary(
        f"https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token={token}", payload
    )
    if status != 200:
        return jsonify({"message": "小程序码服务不可用", "status": status}), 502

    # 坑 1：失败也回 200，靠 content-type 区分。**先判 JSON，再当图片用。**
    if _looks_like_json(content_type, raw):
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            data = {"errmsg": raw[:200].decode("utf-8", "replace")}
        errcode = int(data.get("errcode") or 0)
        print(f"[wx] getwxacodeunlimit 失败 errcode={errcode} errmsg={data.get('errmsg')!r} "
              f"page={page} env={env_version}")
        return jsonify({
            "message": "小程序码生成失败",
            "errcode": errcode,
            "errmsg": data.get("errmsg"),
            "hint": WXACODE_HINTS.get(errcode),
        }), 502

    encoded = base64.b64encode(raw)
    mime = content_type.split(";")[0].strip() or "image/png"

    if len(_wxacode_cache) >= WXACODE_CACHE_MAX:
        # 满了就整体清掉。做 LRU 要额外的数据结构，而这份缓存是纯优化、丢了只是多打一次接口。
        _wxacode_cache.clear()
    _wxacode_cache[cache_key] = (now + WXACODE_CACHE_TTL, encoded, mime)

    return jsonify({"image": f"data:{mime};base64,{encoded.decode('ascii')}",
                    "scene": scene, "page": page, "cached": False})
