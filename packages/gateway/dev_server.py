"""活词网关的本地开发入口；生产环境应由宿主 Flask 应用挂载蓝图。"""

from __future__ import annotations

import os

from flask import Flask, jsonify

from .functions_blueprint import functions_bp
from .wx_blueprint import wx_bp


def create_app() -> Flask:
    """创建供本地联调使用的最小 Flask 应用。"""
    app = Flask(__name__)
    app.register_blueprint(wx_bp)
    app.register_blueprint(functions_bp)

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
