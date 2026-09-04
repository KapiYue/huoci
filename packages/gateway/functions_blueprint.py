"""活词小程序的 /functions/v1/* 端点：Edge Function 的**过检代理**。

为什么不直通 Supabase（`nginx/huoci.conf` 里 /auth/v1 与 /rest/v1 都是直通的）：
§12.4 第 5 条 —— **AI 返回的文本必须过 `msgSecCheck`，在网关做，不在 Edge Function 做**。
直通就等于把审核这一步交给了跨境那一侧，做不到也查不到。

收窄口径（§12.4 第 5 条 09-01 修订）：必须过检的是 **AI 返回的文本**，
用户自己粘贴、只给自己看、不外传的阅读器正文**不逐段送检**（费额度又拖首屏）。
所以这里检的是**响应**，不是请求。

openid 从**服务端**的身份映射查，不信客户端传上来的：
openid 是身份凭据（§9.1c 的 RLS 是 `using (false)`，客户端一行都读不到）。
⚠️ 邮箱登录的老用户若没走过 `wx.login`，映射表里没有他的 openid ——
客户端的 `auth.attachOpenid()` 就是补这一步的，**极易漏**（§5.3 S0 的红字）。
"""

from __future__ import annotations

import json
import os
from typing import Any
from urllib import error, request as urlrequest

from flask import Blueprint, jsonify, request as flask_request

from .wx_blueprint import (  # 复用同一份基础设施，不要复制第二份
    _access_token,
    _get_json,
    _post_json,
    _service_headers,
    _supabase,
    _user_from_token,
    interpret_sec_check,
    sec_check_enabled,
)

functions_bp = Blueprint("huoci_functions", __name__, url_prefix="/functions/v1")

# AI 生成慢，比普通请求宽。nginx 那边 proxy_read_timeout 是 60s，这里留出余量。
TIMEOUT = 45

# **白名单，不做通配代理。** 多一个函数就在这里多一行，
# 否则任何新增的 Edge Function 都会自动获得一条绕过审核策略的入口。
ALLOWED = {
    "lookup-word",       # S7 查词（P2）
    "explain-reading-word",  # R3 释义弹层（P3）
}

# 从返回体里挑出**要送检的文本字段**。挑字段而不是整个 JSON 送检：
# 送 JSON 会把大括号、字段名一起算进字数，既费额度又容易误判。
CHECKED_FIELDS = (
    "primaryMeaning",
    "contextualMeaning",
    "englishDefinition",
    "exampleEnglish",
    "exampleChinese",
    "sentence",
    "explanation",
)


def _openid_of(user_id: str) -> str:
    from urllib import parse

    q = parse.urlencode({"user_id": f"eq.{user_id}", "select": "openid"})
    status, rows = _get_json(
        f"{_supabase()}/rest/v1/hc_wechat_identities?{q}", _service_headers()
    )
    if status != 200 or not rows:
        return ""
    return str(rows[0].get("openid") or "")


def _forward(name: str, token: str, payload: dict[str, Any]) -> tuple[int, Any]:
    url = f"{_supabase()}/functions/v1/{name}"
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "content-type": "application/json",
        "apikey": os.getenv("SUPABASE_ANON_KEY", ""),
        # 用**调用者自己的** JWT 转发：Edge Function 里的 requireUser 要拿它认人，
        # 且它决定了 lexicon_cache 的 RLS 落在谁名下。绝不能换成 service_role。
        "Authorization": f"Bearer {token}",
    }
    req = urlrequest.Request(url, data=body, headers=headers, method="POST")
    try:
        with urlrequest.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return exc.code, {"message": raw.decode("utf-8", "replace")}


def _collect_text(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    parts: list[str] = []
    for key in CHECKED_FIELDS:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    for item in data.get("parts") or []:
        if isinstance(item, dict) and isinstance(item.get("meaning"), str):
            parts.append(item["meaning"])
    # msg_sec_check 单次上限 2500 字节，查词的返回远到不了，截断只是保险
    return "\n".join(parts)[:2000]


def _passes_check(text: str, openid: str) -> bool | None:
    """True = 通过，False = 命中违规，None = 检不了（缺 openid / 开关关 / 微信侧不可用）。

    ⚠️ 判定逻辑统一在 `wx_blueprint.interpret_sec_check` 里，**不要在这里就地解析返回体**。
    历史上这里写过 `.get("suggest", "pass")`，微信一返回 errcode 就静默变成全量放行，
    连下面那条「唯一证据」日志都打不出来。
    """
    if not text or not openid:
        return None
    if not sec_check_enabled():
        return None
    try:
        token = _access_token()
    except RuntimeError:
        return None
    status, data = _post_json(
        f"https://api.weixin.qq.com/wxa/msg_sec_check?access_token={token}",
        {"content": text, "version": 2, "scene": 3, "openid": openid},
        {},
    )
    if status != 200:
        return None
    return interpret_sec_check(data)


@functions_bp.post("/<name>")
def proxy(name: str):
    if name not in ALLOWED:
        return jsonify({"message": f"未开放的函数 {name}"}), 404

    auth_header = flask_request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    if not token:
        return jsonify({"message": "未登录"}), 401

    user = _user_from_token(token)
    if not user or not user.get("id"):
        return jsonify({"message": "登录已失效"}), 401

    status, data = _forward(name, token, flask_request.get_json(silent=True) or {})
    if status != 200:
        return jsonify(data if isinstance(data, dict) else {"message": "上游失败"}), status

    payload = data.get("data") if isinstance(data, dict) else None
    verdict = _passes_check(_collect_text(payload), _openid_of(str(user["id"])))

    if verdict is False:
        # 命中违规就**不下发内容**。返回 200 + 一个明确的空态比 4xx 好：
        # 客户端把它当「没查到」处理，用户看到的是产品语言，不是错误码。
        return jsonify({"message": "内容不可用", "blocked": True}), 422
    if verdict is None:
        # 检不了不代表要拦。但必须留痕 —— 这条日志是「审核到底有没有在跑」的唯一证据。
        print(f"[functions] msgSecCheck 未执行 name={name} user={user.get('id')}")

    return jsonify(data)
