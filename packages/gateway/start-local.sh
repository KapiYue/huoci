#!/usr/bin/env bash
# 启动活词的本地 Flask 网关。
#
# 词鲸与活词共用同一个 Supabase 项目和微信服务端配置。开发时以相邻
# cijing 仓库的 .env 为唯一的私有配置源，避免把 .env.example 的占位值
# 误当成可运行配置复制到这里。

set -euo pipefail

gateway_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$gateway_dir/../.." && pwd)"
cijing_env="$repo_dir/../cijing/.env"
venv_python="$gateway_dir/.venv/bin/python"

if [[ ! -f "$cijing_env" ]]; then
  echo "缺少共享开发配置：$cijing_env" >&2
  exit 1
fi

if [[ ! -x "$venv_python" ]]; then
  echo "缺少网关 Python 环境：$venv_python" >&2
  echo "请先按 README 安装 packages/gateway/requirements.txt。" >&2
  exit 1
fi

set -a
source "$cijing_env"
set +a

required=(SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SECRET_KEY HUOCI_WX_APPID HUOCI_WX_APPSECRET HUOCI_WX_DERIVE_SECRET)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" || "${!key}" == *YOUR_* ]]; then
    echo "共享开发配置中的 $key 缺失或仍是占位值。" >&2
    exit 1
  fi
done

cd "$repo_dir"
# 5000 被桌面系统组件占用时很常见；活词的本地入口固定使用独立的 5001。
# 默认只监听回环地址；真机联调时可显式设置 HUOCI_GATEWAY_HOST 为本机局域网地址
# 或 0.0.0.0。这样不会把局域网暴露作为日常开发的默认行为。
exec env HOST="${HUOCI_GATEWAY_HOST:-127.0.0.1}" PORT="${HUOCI_GATEWAY_PORT:-5001}" "$venv_python" -m packages.gateway.dev_server
