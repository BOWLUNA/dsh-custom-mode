#!/usr/bin/env bash
# 拍 README 界面截图。
#
# 用法:
#   ./run-shots.sh <带 token 的 URL> [输出目录]
#
# 前置:
#   1) 一个装好本插件、正在运行的 dsh web 实例（token 从它的启动日志里取）；
#   2) 带 --remote-debugging-port=9222 启动的 Chrome/Chromium（见 README.md）。
#
# 可选: 若设置了 DSH_HOME，脚本会先把该实例的 preset 还原成出厂状态，
# 让「拨开关 → 保存」的叙事在每次运行里都一样。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="${1:?用法: ./run-shots.sh <带 token 的 URL> [输出目录]}"
OUT="${2:-$REPO/docs/images}"
# Resolve OUT before the `cd` below: a relative argument (the common `docs/images`) would
# otherwise be created inside tools/screenshots/ instead of the repository root.
case "$OUT" in
  /*) ;;
  *) OUT="$(cd "$(dirname "$REPO/$OUT")" 2>/dev/null && pwd)/$(basename "$OUT")" ;;
esac

if [ -n "${DSH_HOME:-}" ] && [ -d "$DSH_HOME/.agent-presets/custom" ]; then
  cp "$REPO/preset/agent.cordis.yml" "$REPO/preset/preset.yml" "$DSH_HOME/.agent-presets/custom/"
  cp "$REPO/preset/prompt.md" "$DSH_HOME/.agent-presets/custom/prompt.md"
  echo "已把 $DSH_HOME 的 preset 还原成出厂状态"
else
  echo "提示: 未设置 DSH_HOME，跳过 preset 还原（截图可能带着上一次运行的开关状态）"
fi

mkdir -p "$OUT"
cd "$(dirname "${BASH_SOURCE[0]}")"
node screenshots.mjs "$URL" "$OUT"
