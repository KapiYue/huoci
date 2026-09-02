"""活词小程序的 /wx/* 端点。挂进词鲸那个 Flask 进程。

《执行方案》§14.1 T8 的分流约定：
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

import hashlib
import hmac
import json
import os
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


def _create_user(email: str, password: str, display_name: str, avatar_url: str | None) -> dict[str, Any]:
    # 坑 2：昵称必须进 user_metadata.display_name，否则 handle_new_user 的兜底会让昵称为空
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {"display_name": display_name or "微信用户", "avatar_url": avatar_url},
    }
    status, data = _post_json(f"{_supabase()}/auth/v1/admin/users", payload, _service_headers())
    if status not in (200, 201):
        raise RuntimeError(f"建用户失败：{status} {data}")
    return data


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

    if identity is None:
        display_name = (body.get("nickname") or "").strip() or "微信用户"
        try:
            user = _create_user(email, password, display_name, body.get("avatar_url"))
            _link_identity(openid, unionid, user["id"], version)
        except RuntimeError as exc:
            return jsonify({"message": str(exc)}), 502

    status, token = _sign_in(email, password)
    if status != 200:
        # 密码对不上通常意味着 secret 轮转过但 secret_version 没升。
        # 这里不静默重试——静默重试会把「密钥配错」伪装成偶发失败。
        return jsonify({"message": "微信登录失败，请稍后重试", "detail": token}), 502

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

    §6.0 的红字：msgSecCheck v2 必传 openid。邮箱登录的用户若没走过 wx.login，
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

    suggest = ((data or {}).get("result") or {}).get("suggest", "pass")
    return jsonify({"pass": suggest == "pass", "suggest": suggest, "raw": data})
