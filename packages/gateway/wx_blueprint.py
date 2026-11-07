"""活词小程序的 /wx/* 端点。挂进词鲸那个 Flask 进程。

`design.md` §12.1 T8 的分流约定：
    /auth/v1  /rest/v1  → nginx 无状态透传（开 keepalive），**不进 Flask**
    /wx/*                → 本机 Flask（有状态：AppSecret、openid 映射、access_token 缓存）

微信独立账号沿用按微信身份派生的合成邮箱登录。已关联到词鲸邮箱账号的微信身份则由网关验证
新的微信 code 后，为映射到的既有 auth user 生成一次性登录凭据并立即兑换 Supabase session。
一次性凭据仅在服务器内存中的单次请求内存在，绝不写日志、数据库或响应。

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
import logging
import os
import string
import time
from typing import Any
from urllib import error, parse, request as urlrequest

from flask import Blueprint, jsonify, request as flask_request

wx_bp = Blueprint("huoci_wx", __name__, url_prefix="/wx")
logger = logging.getLogger(__name__)

# 客户端在执行账号数据合并前必须确认实际命中的网关支持这一版协议。
# 旧实例或错误部署路径会缺少此值，客户端会明确阻止关联，避免再把旧服务的
# 模糊 409 当成当前代码产生的结果。
ACCOUNT_LINK_PROTOCOL_VERSION = "2026-11-06.2"

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


def _account_verification_message(status: int, data: Any) -> str:
    """将认证端的错误转换为可展示的脱敏原因。"""
    error_code = ""
    if isinstance(data, dict):
        error_code = str(data.get("error_code") or data.get("code") or "").lower()
    if error_code in {"email_not_confirmed", "email_not_verified"}:
        return "词鲸账号尚未完成邮箱验证，请先完成邮箱验证"
    if error_code in {"user_not_found", "invalid_credentials", "invalid_grant", "invalid_login_credentials"}:
        return "词鲸账号或密码不正确，请检查后重试"
    if status == 429 or error_code in {"over_request_rate_limit", "too_many_requests"}:
        return "词鲸账号验证请求过于频繁，请稍后再试"
    if status >= 500:
        return "词鲸账号服务暂时不可用，请稍后再试"
    if status in (400, 401):
        return "词鲸账号验证失败，请检查账号信息后重试"
    return "词鲸账号验证失败，请稍后再试"


def _find_identity(openid: str) -> dict[str, Any] | None:
    q = parse.urlencode({"openid": f"eq.{openid}", "select": "openid,unionid,user_id,secret_version"})
    status, rows = _get_json(f"{_supabase()}/rest/v1/hc_wechat_identities?{q}", _service_headers())
    if status != 200 or not rows:
        return None
    return rows[0]


def _find_identity_for_user(user_id: str) -> dict[str, Any] | None:
    """查当前账号已有的微信映射；attach 必须在写前检查这条唯一约束。"""
    q = parse.urlencode({"user_id": f"eq.{user_id}", "select": "openid,unionid,user_id,secret_version"})
    status, rows = _get_json(f"{_supabase()}/rest/v1/hc_wechat_identities?{q}", _service_headers())
    if status != 200 or not rows:
        return None
    return rows[0]


def _find_linked_cijing_user(wechat_user_id: str) -> str | None:
    """返回已关联微信账号对应的规范词鲸账号。

    微信认证映射和账号关联刻意分表：前者永远指回微信独立账号，后者才决定
    本次微信登录应签发哪个账号的 session。查询失败时不能猜测或回退到另一账号。
    """
    q = parse.urlencode({
        "wechat_user_id": f"eq.{wechat_user_id}",
        "select": "cijing_user_id",
        "limit": "1",
    })
    status, rows = _get_json(f"{_supabase()}/rest/v1/hc_account_links?{q}", _service_headers())
    if status != 200:
        raise RuntimeError("无法读取账号关联状态")
    if not rows:
        return None
    cijing_user_id = str(rows[0].get("cijing_user_id") or "").strip()
    if not cijing_user_id:
        raise RuntimeError("账号关联记录无效")
    return cijing_user_id


def _is_linked_cijing_user(cijing_user_id: str) -> bool:
    q = parse.urlencode({"cijing_user_id": f"eq.{cijing_user_id}", "select": "cijing_user_id", "limit": "1"})
    status, rows = _get_json(f"{_supabase()}/rest/v1/hc_account_links?{q}", _service_headers())
    if status != 200:
        raise RuntimeError("无法读取账号关联状态")
    return bool(rows)


def _find_linked_wechat_user(cijing_user_id: str) -> str | None:
    """按规范词鲸账号查询关联的微信独立账号；绝不把该 ID 返回给客户端。"""
    q = parse.urlencode({
        "cijing_user_id": f"eq.{cijing_user_id}",
        "select": "wechat_user_id",
        "limit": "1",
    })
    status, rows = _get_json(f"{_supabase()}/rest/v1/hc_account_links?{q}", _service_headers())
    if status != 200:
        raise RuntimeError("无法读取账号关联状态")
    if not rows:
        return None
    wechat_user_id = str(rows[0].get("wechat_user_id") or "").strip()
    if not wechat_user_id:
        raise RuntimeError("账号关联记录无效")
    return wechat_user_id


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


class IdentityConflict(RuntimeError):
    """映射唯一约束冲突；调用方应返回可理解的 409，而不是将其伪装成 502。"""


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
    if status == 409 or (isinstance(data, dict) and data.get("code") == "23505"):
        raise IdentityConflict("微信身份映射冲突")
    if status not in (200, 201, 204):
        raise RuntimeError(f"写 hc_wechat_identities 失败：{status} {data}")


def _user_from_token(access_token: str) -> dict[str, Any] | None:
    status, data = _get_json(
        f"{_supabase()}/auth/v1/user",
        {**_anon_headers(), "Authorization": f"Bearer {access_token}"},
    )
    return data if status == 200 and isinstance(data, dict) else None


def _execute_account_link(operation: str, wechat_user_id: str, cijing_user_id: str,
                          requested_by: str, confirmation_version: str) -> dict[str, Any]:
    """调用数据库内的单事务迁移入口；请求体不包含任何身份凭据。"""
    status, data = _post_json(
        f"{_supabase()}/rest/v1/rpc/hc_execute_account_link",
        {
            "p_operation": operation,
            "p_wechat_user_id": wechat_user_id,
            "p_cijing_user_id": cijing_user_id,
            "p_requested_by": requested_by,
            "p_confirmation_version": confirmation_version,
        },
        _service_headers(),
    )
    if status == 409:
        # 请求前已按两端分别检查。这里代表并发竞争，不能臆测成“第三个账号”。
        raise IdentityConflict("关联状态刚刚发生变化，请刷新后重试")
    if status != 200 or not isinstance(data, dict) or data.get("state") != "committed":
        raise RuntimeError("账号数据处理未完成，请稍后重试")
    return data


def _admin_user(user_id: str) -> dict[str, Any] | None:
    """仅服务端按 UUID 取认证用户；调用方永远不能指定要签发会话的 user_id。"""
    status, data = _get_json(f"{_supabase()}/auth/v1/admin/users/{parse.quote(user_id, safe='')}", _service_headers())
    return data if status == 200 and isinstance(data, dict) else None


def _issue_mapped_session(user_id: str) -> dict[str, Any]:
    """为已由新微信 code 证明控制权的映射用户签发常规 Supabase 可刷新 session。

    generate_link 的 hashed_token 和 verify 返回的 session 都不落盘、不记录日志。这个函数只能在
    hc_wechat_identities 的服务端查询已确认 user_id 后调用，绝不接受客户端提供的 ID 或邮箱。
    """
    user = _admin_user(user_id)
    email = str((user or {}).get("email") or "").strip()
    if not email:
        raise RuntimeError("关联账号缺少可用登录邮箱")

    status, generated = _post_json(
        f"{_supabase()}/auth/v1/admin/generate_link",
        {"type": "magiclink", "email": email},
        _service_headers(),
    )
    properties = (generated or {}).get("properties") if isinstance(generated, dict) else None
    token_hash = (properties or {}).get("hashed_token") if isinstance(properties, dict) else None
    verification_type = (properties or {}).get("verification_type") if isinstance(properties, dict) else None
    if status not in (200, 201) or not token_hash or not verification_type:
        raise RuntimeError("无法签发关联账号会话")

    status, session = _post_json(
        f"{_supabase()}/auth/v1/verify",
        {"token_hash": token_hash, "type": verification_type},
        _anon_headers(),
    )
    if status != 200 or not isinstance(session, dict) or not ((session.get("user") or {}).get("id")):
        raise RuntimeError("无法兑换关联账号会话")
    if str((session.get("user") or {}).get("id")) != user_id:
        raise RuntimeError("关联账号会话校验失败")
    return session


def _issue_wechat_identity_session(identity: dict[str, Any]) -> dict[str, Any]:
    """用刚验证的微信身份登录其独立账号，不依赖邮件 magic link。

    解绑时如果先提交数据搬运、再走 magic-link 兑换，后者任何瞬时故障都会让数据库已
    解绑而客户端仍保存旧的词鲸 session。微信独立账号本来就有服务端派生的密码，且
    openid 已由本次新 code 证明控制权，因此直接登录更可靠，也让会话可在事务前备好。
    """
    openid = str(identity.get("openid") or "")
    user_id = str(identity.get("user_id") or "")
    try:
        version = int(identity.get("secret_version") or 1)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("微信身份映射版本无效") from exc
    if not openid or not user_id or version < 1:
        raise RuntimeError("微信身份映射无效")
    status, session = _sign_in(_synthetic_email(openid), _derive_password(openid, version))
    if status != 200 or not isinstance(session, dict):
        raise RuntimeError("无法签发微信账号会话")
    if str((session.get("user") or {}).get("id") or "") != user_id:
        raise RuntimeError("微信账号会话校验失败")
    return session


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

    identity = _find_identity(openid)

    # 建号与写映射不是一个事务。原来的顺序（建号 → 立刻写映射）一旦在中间失败，
    # 就留下一个没有映射行的 auth 账号：下次重来仍然查不到 identity，于是再建号，
    # 撞 email_exists → 502，**这个 openid 被永久堵死，只能人工进后台删账号**。
    # 现在改成：建号容忍已存在 → 先登录 → 用 token 里的 user.id 补写映射。
    # 任何一步失败，下一次重试都能自愈。
    if identity is None:
        email = _synthetic_email(openid)
        version = 1
        password = _derive_password(openid, version)
        display_name = (body.get("nickname") or "").strip() or "微信用户"
        try:
            _create_user(email, password, display_name, body.get("avatar_url"))
        except RuntimeError as exc:
            return jsonify({"message": str(exc)}), 502

    if identity is not None:
        try:
            wechat_user_id = str(identity["user_id"])
            # 关联后，认证映射仍指向微信独立账号；只有 session 的签发对象切换到
            # 关联关系指定的规范词鲸账号。解除关联后查询不到关系，自动恢复微信账号。
            linked_cijing_user_id = _find_linked_cijing_user(wechat_user_id)
            token = (_issue_mapped_session(linked_cijing_user_id)
                     if linked_cijing_user_id else _issue_wechat_identity_session(identity))
        except RuntimeError as exc:
            logger.warning("wx_login_mapped_session_failed")
            return jsonify({"message": str(exc)}), 502
    else:
        status, token = _sign_in(email, password)
        if status != 200:
            # 密码对不上通常意味着 secret 轮转过但 secret_version 没升。
            # 这里不静默重试——静默重试会把「密钥配错」伪装成偶发失败。
            return jsonify({"message": "微信登录失败，请稍后重试"}), 502

    if identity is None:
        user_id = str(((token or {}).get("user") or {}).get("id") or "")
        if not user_id:
            return jsonify({"message": "登录返回异常，请稍后重试"}), 502
        try:
            _link_identity(openid, unionid, user_id, version)
        except RuntimeError as exc:
            return jsonify({"message": str(exc)}), 502

    # 已有映射是认证记录，不因一次登录重建、补写或改指向。特别是历史 /wx/attach
    # 映射必须原样保留；是否关联学习数据由 hc_account_links 单独表示。

    # 身份凭据只保存在服务端映射表；客户端只需要常规 Supabase session。
    return jsonify({"session": token})


@wx_bp.post("/account-link/status")
def account_link_status():
    """返回当前微信身份的关联状态，不暴露认证身份凭据或另一账号的资料。"""
    auth_header = flask_request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return jsonify({"message": "缺少登录态"}), 401
    user = _user_from_token(auth_header[7:].strip())
    if not user or not user.get("id"):
        return jsonify({"message": "登录态无效"}), 401
    try:
        user_id = str(user["id"])
        cijing_user_id = _find_linked_cijing_user(user_id)
        linked = cijing_user_id is not None or _is_linked_cijing_user(user_id)
    except IdentityConflict as exc:
        return jsonify({"message": str(exc)}), 409
    except RuntimeError as exc:
        logger.warning("wx_account_link_status_failed")
        return jsonify({"message": str(exc)}), 502
    return jsonify({"linked": linked})


ACCOUNT_LINK_CONFIRMATION_VERSION = "2026-11-06"


@wx_bp.post("/version")
def gateway_version():
    """返回非敏感协议版本，供客户端在账号合并前做部署一致性检查。"""
    return jsonify({"account_link_protocol": ACCOUNT_LINK_PROTOCOL_VERSION})


@wx_bp.post("/account-link/confirm")
def confirm_account_link():
    """验证微信新 code、词鲸密码和主动确认后，在数据库内完成关联。"""
    auth_header = flask_request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return jsonify({"message": "缺少登录态"}), 401
    wechat_user = _user_from_token(auth_header[7:].strip())
    if not wechat_user or not wechat_user.get("id"):
        return jsonify({"message": "登录态无效"}), 401
    body = flask_request.get_json(silent=True) or {}
    if body.get("confirmed") is not True:
        return jsonify({"message": "请先阅读并确认数据处理说明"}), 400
    if body.get("confirmation_version") != ACCOUNT_LINK_CONFIRMATION_VERSION:
        return jsonify({"message": "关联说明已更新，请重新确认"}), 400
    code = str(body.get("code") or "").strip()
    email = str(body.get("email") or "").strip()
    password = body.get("password")
    if not code or not email or not isinstance(password, str) or not password:
        return jsonify({"message": "请完成微信验证和词鲸账号验证"}), 400
    try:
        identity = _find_identity(_code2session(code)["openid"])
        if not identity or str(identity.get("user_id")) != str(wechat_user["id"]):
            return jsonify({"message": "微信身份与当前账号不一致"}), 409
        status, cijing_session = _sign_in(email, password)
        cijing_user_id = str(((cijing_session or {}).get("user") or {}).get("id") or "")
        if status != 200 or not cijing_user_id or cijing_user_id == str(wechat_user["id"]):
            return jsonify({"message": _account_verification_message(status, cijing_session)}), 401
        wechat_user_id = str(wechat_user["id"])
        linked_cijing_user_id = _find_linked_cijing_user(wechat_user_id)
        linked_wechat_user_id = _find_linked_wechat_user(cijing_user_id)
        if linked_cijing_user_id == cijing_user_id and linked_wechat_user_id == wechat_user_id:
            # 同一对账号的重复确认（例如网络在响应前断开）安全地返回既有规范会话。
            return jsonify({"session": cijing_session, "linked": True, "idempotent": True})
        if linked_cijing_user_id is not None:
            return jsonify({"message": "当前微信账号已关联其他词鲸账号，请先解除原有关联"}), 409
        if linked_wechat_user_id is not None:
            return jsonify({"message": "当前词鲸账号已关联其他微信账号，请先在原微信账号解除关联"}), 409
        _execute_account_link("link", wechat_user_id, cijing_user_id,
                              str(wechat_user["id"]), ACCOUNT_LINK_CONFIRMATION_VERSION)
        # 密码验证返回的 session 已是规范账号 session；不回传密码、code 或任何微信身份字段。
        return jsonify({"session": cijing_session, "linked": True})
    except IdentityConflict as exc:
        return jsonify({"message": str(exc)}), 409
    except RuntimeError as exc:
        logger.warning("wx_account_link_failed")
        return jsonify({"message": str(exc)}), 502
    except Exception:  # 微信上游错误与无效 code 不向客户端泄漏内部信息
        logger.warning("wx_account_link_verification_failed")
        return jsonify({"message": "微信验证失败，请重新发起关联"}), 502


@wx_bp.post("/account-link/unlink")
def unlink_account_link():
    """以新的微信 code 确认身份后复制数据回微信账号并移除关联。"""
    auth_header = flask_request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return jsonify({"message": "缺少登录态"}), 401
    cijing_user = _user_from_token(auth_header[7:].strip())
    if not cijing_user or not cijing_user.get("id"):
        return jsonify({"message": "登录态无效"}), 401
    body = flask_request.get_json(silent=True) or {}
    if body.get("confirmed") is not True or body.get("confirmation_version") != ACCOUNT_LINK_CONFIRMATION_VERSION:
        return jsonify({"message": "请阅读并确认解绑说明"}), 400
    code = str(body.get("code") or "").strip()
    if not code:
        return jsonify({"message": "缺少微信验证"}), 400
    try:
        identity = _find_identity(_code2session(code)["openid"])
        if not identity:
            return jsonify({"message": "未找到微信身份"}), 409
        wechat_user_id = str(identity["user_id"])
        # 必须在迁移事务前换好微信独立账号会话。否则数据已经复制并解除关联后才
        # 发现 session 兑换失败，客户端会误以为解绑失败而继续把旧词鲸 session 当微信账号使用。
        wechat_session = _issue_wechat_identity_session(identity)
        linked_cijing_user_id = _find_linked_cijing_user(wechat_user_id)
        if linked_cijing_user_id is None:
            # 兼容旧版“数据库已提交、会话兑换失败”的半完成请求：本次新 code 已证明
            # 微信控制权，安全地交付本应返回的独立账号 session。
            return jsonify({"session": wechat_session, "linked": False, "idempotent": True})
        if linked_cijing_user_id != str(cijing_user["id"]):
            return jsonify({"message": "当前账号没有这项微信关联"}), 409
        _execute_account_link("unlink", wechat_user_id, str(cijing_user["id"]),
                              str(cijing_user["id"]), ACCOUNT_LINK_CONFIRMATION_VERSION)
        return jsonify({"session": wechat_session, "linked": False})
    except IdentityConflict as exc:
        return jsonify({"message": str(exc)}), 409
    except RuntimeError as exc:
        logger.warning("wx_account_unlink_failed")
        return jsonify({"message": str(exc)}), 502
    except Exception:
        logger.warning("wx_account_unlink_verification_failed")
        return jsonify({"message": "微信验证失败，请重新发起解绑"}), 502


@wx_bp.post("/attach")
def wx_attach():
    """兼容旧客户端：以新的微信 code 为当前 JWT 补齐身份映射。

    这是身份映射，不是账号关联，更不会合并学习数据。已有同一映射直接成功；任一
    方向冲突均返回 409，保留既有映射并留待人工处理。
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
    existing_openid = _find_identity(openid)
    if existing_openid and existing_openid["user_id"] != user["id"]:
        logger.warning("wx_attach_identity_conflict direction=openid_already_mapped")
        return jsonify({"message": "这个微信已经绑定了另一个账号"}), 409

    existing_user = _find_identity_for_user(str(user["id"]))
    if existing_user and existing_user["openid"] != openid:
        logger.warning("wx_attach_identity_conflict direction=account_already_mapped")
        return jsonify({"message": "当前账号已经绑定了另一个微信"}), 409

    # 同一 openid → 同一 user_id 是严格幂等：不重写 unionid / secret_version，
    # 也不依赖 upsert 的合并语义，避免历史认证映射被意外改动。
    if existing_openid:
        return jsonify({"idempotent": True})

    try:
        _link_identity(openid, session_info.get("unionid"), str(user["id"]))
    except IdentityConflict:
        # 预检和 INSERT 之间仍可能有并发请求；将数据库唯一约束翻译成稳定的产品错误。
        logger.warning("wx_attach_identity_conflict direction=insert_race")
        return jsonify({"message": "微信身份映射发生冲突，请联系支持处理"}), 409
    except RuntimeError as exc:
        return jsonify({"message": str(exc)}), 502

    return jsonify({"idempotent": False})


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
        raise RuntimeError("内容检测服务凭据获取失败")
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
