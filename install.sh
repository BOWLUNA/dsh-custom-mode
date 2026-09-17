#!/usr/bin/env bash
# 安装「自定义模式」+ 设置页插件。
#
# 用法:
#   ./install.sh                  # 默认 web profile
#   ./install.sh --profile tui    # 指定 profile
#   ./install.sh --preset-id mine # 使用别的 preset 目录名
set -euo pipefail

PROFILE=web
PRESET_ID=custom
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile 需要一个值}"; shift 2 ;;
    --preset-id) PRESET_ID="${2:?--preset-id 需要一个值}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PRESET_DIR="$DSH_HOME/.agent-presets/$PRESET_ID"
PROMPT_PATH="$PRESET_DIR/prompt.md"

command -v dsh >/dev/null 2>&1 || { echo "找不到 dsh CLI，请先安装 DeepSeek Harness。" >&2; exit 1; }

echo "==> 1/2 安装 agent preset 到 $PRESET_DIR"
if [ -e "$PRESET_DIR/prompt.md" ]; then
  # 已装过：只更新模式定义，保留用户已经写好的提示词。
  echo "    检测到已存在的 prompt.md，保留它（只更新模式文件）"
  mkdir -p "$PRESET_DIR"
  cp "$ROOT/preset/agent.cordis.yml" "$ROOT/preset/preset.yml" \
     "$ROOT/preset/prompt-reader.mjs" "$ROOT/preset/prompt-tool.mjs" "$PRESET_DIR/"
else
  mkdir -p "$PRESET_DIR"
  cp "$ROOT/preset/agent.cordis.yml" "$ROOT/preset/preset.yml" "$ROOT/preset/prompt.md" \
     "$ROOT/preset/prompt-reader.mjs" "$ROOT/preset/prompt-tool.mjs" "$PRESET_DIR/"
fi
chmod 644 "$PRESET_DIR"/* 2>/dev/null || true
echo "    提示词文件: $PROMPT_PATH"

# 包名一律从 editor/package.json 读取，绝不硬编码：硬编码的名字一旦与包名不符，
# 就会往 bundles 里写一个解析不到的幽灵条目，而 resolveBundleDir 在启动时会因此
# 抛错，导致 dsh 起不来。
PKG_NAME="$(node -e "process.stdout.write(require('$ROOT/editor/package.json').name)")"
[ -n "$PKG_NAME" ] || { echo "无法从 editor/package.json 读取包名" >&2; exit 1; }

echo "==> 2/2 安装设置页插件 \"$PKG_NAME\" 到 profile \"$PROFILE\""
# 先移除旧 link，避免链接指向已移动的目录（从别处再次 clone 后运行会踩到）。
dsh plugin --profile "$PROFILE" remove "$PKG_NAME" >/dev/null 2>&1 || true
dsh plugin --profile "$PROFILE" add "$ROOT/editor"

# dsh plugin add 不一定把包追加进 dsh.profile.bundles（只有声明了 dsh.bundle 且被识别时才自动加），
# 这里按读取到的真实包名核对并补齐。
node - "$PROFILE" "$DSH_HOME" "$PKG_NAME" <<'NODE'
const fs = require('fs')
const [profile, dshHome, name] = process.argv.slice(2)
const manifest = `${dshHome}/profiles/${profile}/package.json`
const j = JSON.parse(fs.readFileSync(manifest, 'utf8'))
const bundles = j.dsh?.profile?.bundles ?? []
// 清掉任何「声明了但实际解析不到」的条目，避免上一次失败安装留下的幽灵污染启动。
const clean = bundles.filter((b) => {
  if (b === name) return true
  const probe = `${dshHome}/profiles/${profile}/node_modules/${b}/package.json`
  const shared = `${dshHome}/profiles/node_modules/${b}/package.json`
  return fs.existsSync(probe) || fs.existsSync(shared)
})
if (clean.length !== bundles.length) {
  console.log(`    已移除解析不到的残留条目: ${JSON.stringify(bundles.filter((b) => !clean.includes(b)))}`)
}
j.dsh = j.dsh ?? {}
j.dsh.profile = j.dsh.profile ?? {}
if (clean.includes(name)) {
  j.dsh.profile.bundles = clean
  console.log(`    bundle 已登记: ${JSON.stringify(clean)}`)
} else {
  j.dsh.profile.bundles = [...clean, name]
  console.log(`    bundle 已补登记: ${JSON.stringify(j.dsh.profile.bundles)}`)
}
fs.writeFileSync(manifest, JSON.stringify(j, null, 2) + '\n')
NODE

cat <<EOF

安装完成。请**重启 dsh**（bundle 插件只在启动装配期生效），然后：

  - 新会话选「自定义模式」；
  - 设置面板 → 「系统提示词」即可编辑，保存后当前会话下一步生效。

如果 preset 目录名不是 custom（--preset-id），编辑器默认找不到提示词文件，
需要用环境变量指定：

  export DSH_CUSTOM_PROMPT_PATH="$PROMPT_PATH"

EOF
