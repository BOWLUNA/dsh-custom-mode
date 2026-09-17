#!/usr/bin/env bash
# 卸载「自定义模式」与设置页插件。默认保留你写好的提示词。
#
# 用法:
#   ./uninstall.sh                 # 默认 web profile
#   ./uninstall.sh --purge         # 连同本工具创建的所有模式目录一起删除
set -euo pipefail

PROFILE=web
PRESET_ID=custom
PURGE=0
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?}"; shift 2 ;;
    --preset-id) PRESET_ID="${2:?}"; shift 2 ;;
    --purge) PURGE=1; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

echo "==> 移除设置页插件"
# 包名从仓库的 editor/package.json 读取，与 install.sh 用同一来源，避免不一致。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="$(node -e "process.stdout.write(require('$ROOT/editor/package.json').name)")"

if command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile "$PROFILE" remove "$PKG_NAME" || true
else
  echo "    找不到 dsh CLI，跳过（请手动从 profile 的 dsh.profile.bundles 中移除）"
fi

# 实测：`dsh plugin remove` 会清掉 package.json 的依赖与 bundles 条目，但 pnpm 可能在
# node_modules 里留下指向本仓库的软链（pnpm 12.4.2 上复现过）。它不影响 dsh 装配
# （装配只看 bundles 列表），但 uninstall 就该不留痕迹——尤其当你随后要删掉这个仓库时，
# 它会变成一个指不到任何地方的断链。只删我们自己这一个包名。
for modules_dir in "$DSH_HOME/profiles/$PROFILE/node_modules" "$DSH_HOME/profiles/node_modules"; do
  if [ -L "$modules_dir/$PKG_NAME" ] || [ -e "$modules_dir/$PKG_NAME" ]; then
    rm -rf "$modules_dir/$PKG_NAME"
    echo "    已清掉 node_modules 里的残留: $modules_dir/$PKG_NAME"
  fi
done

# remove 之后 bundles 列表若仍留有名字，补一次清理。
node - "$PROFILE" "$DSH_HOME" "$PKG_NAME" <<'NODE' || true
const fs = require('fs')
const [profile, dshHome, name] = process.argv.slice(2)
const manifest = `${dshHome}/profiles/${profile}/package.json`
if (!fs.existsSync(manifest)) process.exit(0)
const j = JSON.parse(fs.readFileSync(manifest, 'utf8'))
const bundles = j.dsh?.profile?.bundles ?? []
const next = bundles.filter((b) => b !== name)
if (next.length !== bundles.length) {
  j.dsh.profile.bundles = next
  fs.writeFileSync(manifest, JSON.stringify(j, null, 2) + '\n')
  console.log(`    已从 bundles 移除: ${JSON.stringify(next)}`)
}
NODE

PRESET_ROOT="$DSH_HOME/.agent-presets"
PRESET_DIR="$PRESET_ROOT/$PRESET_ID"

# 一个设置页可以管理多个助手：每个助手是预设根目录下的一个目录。判据与插件一致——
# 目录里有 prompt.md，且（有 prompt-reader.mjs，或组成文件里引用了 './prompt-reader.mjs'）。
# 手写的 preset 不会被误伤：它们两者都不满足。
managed_dirs() {
  for dir in "$PRESET_ROOT"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    case "$name" in .*) continue ;; esac
    [ -f "$dir/prompt.md" ] || continue
    if [ -f "$dir/prompt-reader.mjs" ] || grep -qF "'./prompt-reader.mjs'" "$dir/agent.cordis.yml" 2>/dev/null; then
      printf '%s\n' "${dir%/}"
    fi
  done
}

# 先把名单算出来再用，不要写成 `managed_dirs | grep -q`：脚本开了 pipefail，grep 命中即退出
# 会让 managed_dirs 收到 SIGPIPE，整条管道的状态变成 141，判断随之反过来。
MANAGED="$(managed_dirs)"

if [ "$PURGE" = "1" ]; then
  echo "==> 删除本工具创建的助手目录（含提示词）"
  named=0
  while IFS= read -r dir; do
    if [ "$dir" = "$PRESET_DIR" ]; then named=1; fi
  done <<< "$MANAGED"
  if [ -d "$PRESET_DIR" ] && [ "$named" = "0" ]; then
    # 组成文件被改坏、或身份不再走 prompt-reader.mjs 时名单会漏掉它；
    # 但 --preset-id 明确点名了这个目录，就按点名的删。
    echo "    $PRESET_DIR（按 --preset-id 指名）"
    rm -rf "$PRESET_DIR"
  fi
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    echo "    $dir"
    rm -rf "$dir"
  done <<< "$MANAGED"
  # 播种标记一并删掉，否则重装时不会再建出第一个助手。
  rm -f "$PRESET_ROOT/.custom-mode.json"
else
  echo "==> 保留助手目录与提示词"
  found=0
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    found=1
    echo "    $dir/prompt.md"
  done <<< "$MANAGED"
  if [ "$found" = "0" ]; then echo "    （没有找到本工具创建的模式）"; fi
  echo "    如需一并删除，重新执行 ./uninstall.sh --purge"
fi
echo
echo "完成。重启 dsh 后生效。"
