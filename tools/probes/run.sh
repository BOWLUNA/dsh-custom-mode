#!/usr/bin/env bash
# 运行本目录下全部对抗性探针。
#
# 用法（从 Git Bash）：
#   wsl.exe -d Ubuntu -- bash /mnt/c/BL/Work/WorkSpace/WorkBuddy/Plugin/plugins/identity/dsh-custom-mode/probes/run.sh
#
# 可选环境变量：
#   PROBE_REPO=<仓库路径>              默认 /home/bowluna/dsh/dsh-custom-mode
#   DSH_SHIPPED_PRESETS_DIR=<presets>  默认 ~/.dsh/profiles/node_modules/.../presets
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 只跑命令行点名的探针；不给就全跑
if [ "$#" -gt 0 ]; then
  FILES=("$@")
else
  FILES=(probe-composition.mjs probe-io.mjs probe-fuzz.mjs)
fi

fail=0
for f in "${FILES[@]}"; do
  [ -f "$HERE/$f" ] || continue
  echo
  echo "############################################################"
  echo "##  $f"
  echo "############################################################"
  node "$HERE/$f"
  code=$?
  [ "$code" -eq 0 ] || fail=1
  echo "   → exit $code"
done
echo
echo "============================================================"
[ "$fail" -eq 0 ] && echo "全部探针通过" || echo "有探针失败（见上）"
exit "$fail"
