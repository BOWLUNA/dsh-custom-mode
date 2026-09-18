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
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PRESET_DIR="$DSH_HOME/.agent-presets/$PRESET_ID"
PROMPT_PATH="$PRESET_DIR/prompt.md"
PROFILE_MANIFEST="$DSH_HOME/profiles/$PROFILE/package.json"

command -v dsh >/dev/null 2>&1 || { echo "找不到 dsh CLI，请先安装 DeepSeek Harness。" >&2; exit 1; }

# ── 0/3 前置自检 ─────────────────────────────────────────────────────────────
# 只警告不中止：这些都是「能装但会以奇怪方式失败」的环境问题，提前说出来比事后
# 让用户对着 pnpm 的 Rust panic 猜要好。
echo "==> 0/3 前置自检"

DSH_VERSION="$(dsh --version 2>/dev/null | head -1 | tr -d '[:space:]')"
# 兼容性由 editor/package.json 声明的范围定义（engines.dsh 与 peer 范围），包版本走自己的线，
# 两者不再相等。判断逻辑只保留一份，就在那个脚本里。
DECLARED="$(node -p "const p=require('$ROOT/editor/package.json'); [p.engines && p.engines.dsh, p.peerDependencies && p.peerDependencies['@deepseek-ai/dsh']].filter(Boolean).join(' / ')" 2>/dev/null || echo '?')"
if node "$ROOT/tools/verify-version-consistency.mjs" --dsh "$DSH_VERSION" >/dev/null 2>&1; then
  echo "    dsh 版本 $DSH_VERSION 在声明的兼容范围内（$DECLARED）"
else
  echo "    警告: dsh 版本是 $DSH_VERSION，不在本插件声明的兼容范围内（$DECLARED）。"
  echo "          本项目深度依赖 DSH 内部 API，请先核对 README 的「耦合点清单」。"
fi

# `dsh plugin` 是把参数转发给 PATH 上的 pnpm 的（spawnSync("pnpm", ...)）。WSL 里
# 如果 PATH 先命中了 Windows 的 pnpm，它会以「cwd 是带盘符的绝对路径」为由直接
# panic，而 dsh 只会打印一句 pnpm failed —— 极难定位。这里提前识别。
PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
if [ -z "$PNPM_BIN" ]; then
  echo "    警告: PATH 上没有 pnpm，第 2 步会失败。请先安装 pnpm（推荐 corepack enable pnpm）。"
else
  case "$PNPM_BIN" in
    /mnt/*|*.cmd|*.exe)
      echo "    警告: PATH 上先命中的是 Windows 版 pnpm：$PNPM_BIN"
      echo "          WSL 下它会 panic（current dir is an absolute path with drive letter）。"
      echo "          请改用 Linux 版，例如：corepack enable pnpm，然后确认 which pnpm 不再指向 /mnt/*。"
      ;;
    *) echo "    pnpm: $PNPM_BIN" ;;
  esac
fi

# ── 1/3 安装 agent preset ───────────────────────────────────────────────────
echo "==> 1/3 安装 agent preset 到 $PRESET_DIR"
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

# 包名一律从 editor/package.json 读取，绝不硬编码。
PKG_NAME="$(node -e "process.stdout.write(require('$ROOT/editor/package.json').name)")"
[ -n "$PKG_NAME" ] || { echo "无法从 editor/package.json 读取包名" >&2; exit 1; }

# 记录安装前的 bundle 列表：装完要断言「一个都没少」。
# 这一条是回归护栏 —— 曾经这里有一段「清理解析不到的幽灵条目」，它按两个硬编码
# 路径探测依赖，结果把 profile 模板自带的 in-box bundle（@deepseek-ai/dsh-base、
# @deepseek-ai/dsh-web-app）当成幽灵删掉了，装完 dsh 起不来（只剩本插件一行，
# 所有服务永远 pending）。dsh 自己的 reconcilePlugins 明确写着 in-box bundle
# 「are never touched」，所以正确做法是：**只增不删**，删的事交给 pnpm 与 dsh。
BUNDLES_BEFORE="$(node -e '
  const fs = require("fs");
  const path = process.argv[1];
  if (!fs.existsSync(path)) { process.stdout.write("[]"); process.exit(0); }
  const j = JSON.parse(fs.readFileSync(path, "utf8"));
  process.stdout.write(JSON.stringify(j.dsh?.profile?.bundles ?? []));
' "$PROFILE_MANIFEST")"
echo "    安装前 bundles: $BUNDLES_BEFORE"

# ── 2/3 安装设置页插件 ──────────────────────────────────────────────────────
echo "==> 2/3 安装设置页插件 \"$PKG_NAME\" 到 profile \"$PROFILE\""
# 先移除旧 link，避免链接指向已移动的目录（从别处再次 clone 后运行会踩到）。
dsh plugin --profile "$PROFILE" remove "$PKG_NAME" >/dev/null 2>&1 || true
dsh plugin --profile "$PROFILE" add "$ROOT/editor"

# dsh 在 add 之后会按「已安装状态」校正 bundles；这里只补一件事：确保本插件的
# 名字确实在列表里（旧版 dsh 不一定会自动追加）。绝不移除任何条目。
node - "$PROFILE_MANIFEST" "$PKG_NAME" "$BUNDLES_BEFORE" <<'NODE'
const fs = require('fs')
const [manifest, name, beforeRaw] = process.argv.slice(2)
const j = JSON.parse(fs.readFileSync(manifest, 'utf8'))
const before = JSON.parse(beforeRaw)
const bundles = j.dsh?.profile?.bundles ?? []

const dropped = before.filter((b) => !bundles.includes(b))
if (dropped.length > 0) {
  // 正常情况下永远不会走到这里。真走到了，就把安装前的列表原样并回去：宁可有
  // 一个解析不到的条目（dsh 会在启动时明确报出它），也不能让基础 bundle 消失。
  j.dsh = j.dsh ?? {}
  j.dsh.profile = j.dsh.profile ?? {}
  j.dsh.profile.bundles = [...new Set([...before, ...bundles])]
  fs.writeFileSync(manifest, JSON.stringify(j, null, 2) + '\n')
  console.log(`    已恢复被移除的 bundle 条目: ${JSON.stringify(dropped)}`)
  console.log(`    当前 bundles: ${JSON.stringify(j.dsh.profile.bundles)}`)
} else if (!bundles.includes(name)) {
  j.dsh = j.dsh ?? {}
  j.dsh.profile = j.dsh.profile ?? {}
  j.dsh.profile.bundles = [...bundles, name]
  fs.writeFileSync(manifest, JSON.stringify(j, null, 2) + '\n')
  console.log(`    bundle 已补登记: ${JSON.stringify(j.dsh.profile.bundles)}`)
} else {
  console.log(`    bundle 已登记: ${JSON.stringify(bundles)}`)
}
NODE

# ── 3/3 安装后自检 ─────────────────────────────────────────────────────────
# 用 dsh 自己组合一遍 profile，确认：(a) 本插件的行进了组合树；(b) 组合树没有塌成
# 只剩本插件。第二条正是上面那个 P0 的症状 —— 当时安装「成功」退出，用户直到
# 下次重启 dsh 才发现整个 harness 没了。
echo "==> 3/3 安装后自检（组合 profile）"
DUMP_FILE="$(mktemp)"
trap 'rm -f "$DUMP_FILE"' EXIT
if ! dsh --profile "$PROFILE" --dump-config >"$DUMP_FILE" 2>/dev/null; then
  echo "    自检失败: dsh --profile $PROFILE --dump-config 无法执行。" >&2
  echo "    请把上面的完整输出发给作者。" >&2
  exit 1
fi

node - "$DUMP_FILE" "$PKG_NAME" "$PROFILE" "$PROFILE_MANIFEST" <<'NODE'
const fs = require('fs')
const [dumpFile, pkg, profile, manifest] = process.argv.slice(2)
const dump = fs.readFileSync(dumpFile, 'utf8')
const rows = (dump.match(/^- id: /gm) ?? []).length
const bundles = JSON.parse(fs.readFileSync(manifest, 'utf8')).dsh?.profile?.bundles ?? []

// 阈值取得很松：只要有 20 行以上就说明基础 bundle 还在。真出问题时实际值是 1。
const MIN_ROWS = 20
let ok = true
if (!dump.includes(`name: ${pkg}`)) {
  console.error(`    自检失败: 组合树里没有 ${pkg} 的行，设置页不会出现。`)
  ok = false
}
if (rows < MIN_ROWS) {
  console.error(`    自检失败: 组合树只有 ${rows} 行，基础 bundle 疑似丢失（正常应有上百行）。`)
  console.error(`    当前 bundles: ${JSON.stringify(bundles)}`)
  console.error('    自救: 把 profile 模板自带的 bundle 名（如 @deepseek-ai/dsh-base、')
  console.error('          @deepseek-ai/dsh-web-app）加回上面这个列表，见 docs/TROUBLESHOOTING.md。')
  ok = false
}
if (!ok) process.exit(1)
console.log(`    组合树 ${rows} 行，${pkg} 已就位`)

// 设置页是 Web 页面：装进没有 web 服务器的 profile（例如 tui）时它不可能工作。
// 更关键的是，agent preset 本身也要靠 agent-presets 服务才会被挂载 —— 没有它，
// 「自定义模式」连选都选不到。这不算安装失败，但必须当场说清楚，否则用户会去翻
// 「设置页怎么不出现」的故障排查，然后发现问题是整个功能都不在这个 profile 里。
const hasWebServer = dump.includes('@deepseek-ai/dsh-host-webserver')
const hasAgentPresets = dump.includes('@deepseek-ai/dsh-agent-presets')
if (!hasWebServer || !hasAgentPresets) {
  console.log('')
  console.log(`    注意: profile "${profile}" 里这个插件只有一部分能生效。`)
  if (hasAgentPresets) {
    console.log('          · 模式本身可用（新建会话时可选）')
  } else {
    console.log('          · 组合里没有 agent-presets：**「自定义模式」无法被选中**，')
    console.log('            preset 文件被复制过去了，但没有任何东西会挂载它')
  }
  // 不要再承诺 custom_prompt：没有 agent-presets 就没有任何东西挂载这个 preset，
  // 那一行（连同它的工具）永远不会出现 —— 指一条不存在的通道比不指更糟。
  console.log('          · 会话里也拿不到：custom_prompt 工具来自这个 preset 的行，同样不会被挂载')
  if (!hasWebServer) console.log('          · 没有设置页：组合里没有 web 服务器')
  console.log('          要用完整功能（模式可选 + 图形化设置页），请装进 web profile：')
  console.log('            ./install.sh --profile web')
}
NODE

# 收尾的三行说明也要随 profile 变，否则会出现「上一段说模式选不到、下一段说去选模式」。
if grep -q '@deepseek-ai/dsh-agent-presets' "$DUMP_FILE" 2>/dev/null \
  && grep -q '@deepseek-ai/dsh-host-webserver' "$DUMP_FILE" 2>/dev/null; then
  NEXT_STEPS="  - 新会话选一个自定义模式（设置页里可以建多个助手）；
  - 设置面板 → 「自定义模式」：上方助手列表可新增 / 切换 / 删除，
    下方编辑当前助手的系统提示词与插件开关，保存后新建会话即生效。"
else
  NEXT_STEPS="  - 本 profile 里没有 agent-presets / 设置页，见上方「只有一部分能生效」那段；
  - 可用的通道是 custom_prompt 工具（会话里直接说「把系统提示词改成……」）。"
fi

cat <<EOF

安装完成。请**重启 dsh**（bundle 插件只在启动装配期生效），然后：

$NEXT_STEPS

设置页管理的是预设根目录下所有「本工具创建的」模式（判据：目录里有 prompt.md，
且组成文件用 prompt-reader.mjs 注入身份）。以前只有一个 custom 时用的是同一个根目录，
所以升级不需要迁移：它会作为第一个助手出现在列表里。

关于 --preset-id：编辑器现在按 roster 认目录（判据是目录里有 prompt.md、且组成文件引用
prompt-reader.mjs），所以换了目录名照样会被列出与编辑，不需要再设任何环境变量。
（DSH_CUSTOM_PROMPT_PATH 现在只用于测试时重定向"首次播种"的根。）

故障排查见 docs/TROUBLESHOOTING.md。

EOF
