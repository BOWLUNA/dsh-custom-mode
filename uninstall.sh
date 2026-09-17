#!/usr/bin/env bash
# 卸载「自定义模式」与设置页插件。默认保留你写好的提示词。
#
# 用法:
#   ./uninstall.sh                 # 默认 web profile
#   ./uninstall.sh --purge         # 连同提示词文件一起删除
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

PRESET_DIR="$DSH_HOME/.agent-presets/$PRESET_ID"
if [ "$PURGE" = "1" ]; then
  echo "==> 删除 preset 目录（含提示词）: $PRESET_DIR"
  rm -rf "$PRESET_DIR"
else
  echo "==> 保留 preset 目录: $PRESET_DIR"
  echo "    提示词仍在: $PRESET_DIR/prompt.md"
  echo "    如需一并删除，重新执行 ./uninstall.sh --purge"
fi

echo
echo "完成。重启 dsh 后生效。"
