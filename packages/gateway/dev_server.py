"""活词网关的本地开发入口；生产环境应由宿主 Flask 应用挂载蓝图。"""

from __future__ import annotations

import os
from urllib import error as urlerror
from urllib import request as urlrequest

from flask import Flask, Response, jsonify, request

from .functions_blueprint import functions_bp
from .wx_blueprint import wx_bp


_FORWARDED_REQUEST_HEADERS = {
    "accept",
    "accept-profile",
    "apikey",
    "authorization",
    "content-profile",
    "content-type",
    "prefer",
    "range",
    "x-client-info",
}
_HOP_BY_HOP_HEADERS = {
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def _supabase_base_url() -> str:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not url or "YOUR_PROJECT" in url:
        raise RuntimeError("SUPABASE_URL 缺失或仍是模板占位值")
    return url


def _forward_supabase(path: str) -> Response:
    """仅供本地开发：模拟 nginx 对 auth/rest 的无状态透传。"""
    query = request.query_string.decode("latin-1")
    target = f"{_supabase_base_url()}/{path}"
    if query:
        target = f"{target}?{query}"

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() in _FORWARDED_REQUEST_HEADERS
    }
    upstream = urlrequest.Request(
        target,
        data=request.get_data() if request.method not in {"GET", "HEAD"} else None,
        headers=headers,
        method=request.method,
    )
    try:
        with urlrequest.urlopen(upstream, timeout=30) as result:
            body = result.read()
            status = result.status
            response_headers = result.headers.items()
    except urlerror.HTTPError as exc:
        body = exc.read()
        status = exc.code
        response_headers = exc.headers.items()
    except (urlerror.URLError, TimeoutError) as exc:
        return jsonify({"message": f"Supabase 开发上游不可用：{exc}"}), 502

    response = Response(body, status=status)
    for key, value in response_headers:
        if key.lower() not in _HOP_BY_HOP_HEADERS:
            response.headers.add(key, value)
    return response


def create_app() -> Flask:
    """创建供本地联调使用的最小 Flask 应用。"""
    app = Flask(__name__)
    app.register_blueprint(wx_bp)
    app.register_blueprint(functions_bp)

    @app.route("/auth/v1/<path:path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
    def auth_proxy(path: str):
        return _forward_supabase(f"auth/v1/{path}")

    @app.route("/rest/v1/<path:path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
    def rest_proxy(path: str):
        return _forward_supabase(f"rest/v1/{path}")

    @app.get("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app


if __name__ == "__main__":
    create_app().run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes"},
    )
