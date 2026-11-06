#!/usr/bin/env bash
# 停止通过 start-local.sh 启动的本地 Flask 网关。

set -euo pipefail

port="${HUOCI_GATEWAY_PORT:-5001}"

if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  echo "HUOCI_GATEWAY_PORT 必须是 1 到 65535 之间的端口号。" >&2
  exit 1
fi

pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -z "$pids" ]]; then
  echo "本地网关未在端口 ${port} 上运行。"
  exit 0
fi

gateway_pids=()
while IFS= read -r pid; do
  [[ -z "$pid" ]] && continue
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ "$command" == *"packages.gateway.dev_server"* ]]; then
    gateway_pids+=("$pid")
  else
    echo "端口 ${port} 正被非活词网关进程占用（PID ${pid}）：${command}" >&2
  fi
done <<< "$pids"

if (( ${#gateway_pids[@]} == 0 )); then
  echo "未停止任何进程，以免误杀占用端口 ${port} 的其他服务。" >&2
  exit 1
fi

kill -TERM "${gateway_pids[@]}"
echo "已请求停止本地网关（端口 ${port}，PID：${gateway_pids[*]}）。"
