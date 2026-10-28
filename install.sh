#!/usr/bin/env bash
# 安装「自定义模式」+ 设置页插件。
#
# 用法:
#   ./install.sh                  # 默认 web profile
#   ./install.sh --profile tui    # 指定 profile（desktop 会被拒绝，见下）
#   ./install.sh --preset-id mine # 使用别的 preset 目录名
#
# 桌面端（DeepSeek Harness Desktop）**不用**这个脚本装插件：它独占 $DSH_HOME/profiles/desktop，
# 请在应用内的 Plugins 页里搜 dsh-custom-mode 安装。预设那一步（.agent-presets/）两边共享，
# 首次激活时由插件自己落盘，不需要额外操作。
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

# ── 桌面端 profile 不是 CLI 的地盘 ───────────────────────────────────────────
# 官方桌面端（apps/desktop）**独占** `$DSH_HOME/profiles/desktop`：依赖、bundle 列表与包管理状态
# 都由 Electron 维护，启动恢复流程还会自己重命名 `cordis.patch.yml`。官方 README 的原话是
# "The CLI cannot boot or mutate this profile" —— CLI 写进去等于绕过应用的包管理与事务锁，
# 轻则被忽略、重则让桌面端起不来（而恢复流程只会去禁用第三方 bundle，用户看到的是"插件装完崩了"）。
# 所以这里直接拒绝，并指路应用内的 Plugins 页；只有本机模拟测试才显式放开。
if [ "$PROFILE" = "desktop" ] && [ "${DSH_ALLOW_DESKTOP_PROFILE:-}" != "1" ]; then
  cat >&2 <<'MSG'
错误: profile "desktop" 属于桌面端应用，不能用 CLI 修改。

官方约定（见 dsh 仓库 apps/desktop/README.md）：
  · Electron 独占 $DSH_HOME/profiles/desktop —— 依赖、dsh.profile.bundles 与包管理状态都由应用维护，
    "The CLI cannot boot or mutate this profile"。
  · 桌面端装外部插件请**在应用里**：侧栏 Plugins → 添加插件 → 搜 dsh-custom-mode → 安装。
    （走的是与应用同一套认证 HTTP API 的插件管理器，pnpm 由应用自带。）
  · 助手预设 $DSH_HOME/.agent-presets/ 是桌面端与 CLI 共享的产品数据，仍由本插件首次激活时落盘，
    不需要这一步。
  · 若某个第三方 bundle 让应用起不来：启动恢复对话框提供「禁用第三方插件」。
MSG
  exit 2
fi

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PRESET_DIR="$DSH_HOME/.agent-presets/$PRESET_ID"
PROMPT_PATH="$PRESET_DIR/prompt.md"
PROFILE_MANIFEST="$DSH_HOME/profiles/$PROFILE/package.json"

command -v dsh >/dev/null 2>&1 || { echo "找不到 dsh CLI，请先安装 DeepSeek Harness。" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "找不到 Node.js。" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "找不到 npm；安装脚本需要它离线准备与校验本地包。" >&2; exit 1; }
if ! printf '%s' "$PRESET_ID" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "助手 id 不合法: $PRESET_ID（只能用 a-z、0-9 与连字符，且不能是路径）" >&2
  exit 2
fi

# ── 0/3 前置自检 ─────────────────────────────────────────────────────────────
# 只警告不中止：这些都是「能装但会以奇怪方式失败」的环境问题，提前说出来比事后
# 让用户对着 pnpm 的 Rust panic 猜要好。
echo "==> 0/3 前置自检"

DSH_ERR="$(mktemp)"
DSH_OUT="$(mktemp)"
set +e
dsh --version >"$DSH_OUT" 2>"$DSH_ERR"
DSH_STATUS=$?
set -e
DSH_VERSION="$(head -1 "$DSH_OUT" | tr -d '[:space:]')"
if [ "$DSH_STATUS" -ne 0 ]; then
  echo "    错误: dsh 已在 PATH 里，但 dsh --version 退出 ${DSH_STATUS}。安装中止。" >&2
  cat "$DSH_ERR" >&2
  rm -f "$DSH_ERR" "$DSH_OUT"
  exit 1
fi
rm -f "$DSH_ERR" "$DSH_OUT"
# 兼容性由根 package.json 声明的范围定义（engines.dsh 与 peer 范围），包版本走自己的线，
# 两者不再相等。判断逻辑只保留一份，就在那个脚本里。
# 读声明范围：**传相对路径给脚本**，不把绝对路径嵌进 `node -e` 字符串 —— Git Bash 下
# `$ROOT` 是 `/c/Users/…`，嵌进去 Windows 的 node 解析不了（实测：MODULE_NOT_FOUND，且
# 下面那句自检会静默降级成 `?`）。细节见 tools/package-facts.mjs 的头注释。
DECLARED="$(cd "$ROOT" && node tools/package-facts.mjs ranges 2>/dev/null || true)"
if [ -z "$DECLARED" ]; then
  # 读不到就说读不到：自检在最需要它的环境下静默降级成 "?"，比不检查更糟。
  echo "    警告: 读不到 package.json 里声明的兼容范围，无法做版本自检"
  DECLARED="(读取失败)"
fi
if node "$ROOT/tools/verify-version-consistency.mjs" --dsh "$DSH_VERSION" >/dev/null 2>&1; then
  echo "    dsh 版本 $DSH_VERSION 在声明的兼容范围内（$DECLARED）"
else
  echo "    警告: dsh 版本是 $DSH_VERSION，不在本插件声明的兼容范围内（$DECLARED）。"
  echo "          请先核对 docs/CURRENT_COMPATIBILITY.md 与 docs/ARCHITECTURE.md。"
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

# 包名一律从根 package.json 读取，绝不硬编码。
PKG_NAME="$(cd "$ROOT" && node tools/package-facts.mjs name 2>/dev/null || true)"
[ -n "$PKG_NAME" ] || { echo "无法从 package.json 读取包名" >&2; exit 1; }

# ── 1/3 准备本地包与可用的回滚快照，不先卸载旧插件 ─────────────────────────
echo "==> 1/3 离线准备安装包与回滚快照"
TRANSACTION="$(mktemp -d "${TMPDIR:-/tmp}/dsh-custom-install.XXXXXX")"
TRANSACTION_TOOL="$ROOT/tools/install-transaction.mjs"
DUMP_FILE=''
finish_install() {
  status=$?
  trap - EXIT
  [ -z "$DUMP_FILE" ] || rm -f "$DUMP_FILE"
  if [ "$status" -ne 0 ] && [ -f "$TRANSACTION/state.json" ]; then
    set +e
    if node "$TRANSACTION_TOOL" needs-rollback "$TRANSACTION"; then
      previous="$(node "$TRANSACTION_TOOL" rollback-spec "$TRANSACTION")"
      if [ -n "$previous" ]; then
        dsh plugin --profile "$PROFILE" add "$previous" >"$TRANSACTION/rollback-package.log" 2>&1
      else
        dsh plugin --profile "$PROFILE" remove "$PKG_NAME" >"$TRANSACTION/cleanup-first-install.log" 2>&1
      fi
      rollback_status=$?
      if ! node "$TRANSACTION_TOOL" rollback "$TRANSACTION" "$rollback_status"; then
        echo "回滚未验证。保留 $TRANSACTION；不要把部分安装当作成功，见其中日志与旧包。" >&2
        exit 5
      fi
    fi
    echo "安装未完成；事务证据保留在 $TRANSACTION。" >&2
  fi
  exit "$status"
}
trap finish_install EXIT
node "$TRANSACTION_TOOL" prepare "$TRANSACTION" "$ROOT" "$DSH_HOME" "$PROFILE" "$PRESET_ID"

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
# 直接替换依赖，保留 clone 的链接开发语义。失败通过已归档的实际旧包重新安装。
node "$TRANSACTION_TOOL" attempt "$TRANSACTION"
ADD_LOG="$(mktemp)"
if ! dsh plugin --profile "$PROFILE" add "$ROOT" >"$ADD_LOG" 2>&1; then
  cat "$ADD_LOG" >&2
  if grep -q 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION' "$ADD_LOG"; then
    echo "安装被 pnpm 的发布冷却期拦住（ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION）。" >&2
    echo "profile 的 pnpm-workspace.yaml 里，dsh-custom-mode 只能有一条 minimumReleaseAgeExclude。" >&2
    echo "推荐写成：  - dsh-custom-mode" >&2
    echo "不要由本脚本改这个文件。收成一条后重新运行安装。node_modules 里的版本不能当作已经升级成功。" >&2
    echo "见 docs/TROUBLESHOOTING.md 的当前自救步骤。" >&2
    rm -f "$ADD_LOG"
    exit 3
  fi
  rm -f "$ADD_LOG"
  exit 1
fi
cat "$ADD_LOG"
rm -f "$ADD_LOG"

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
// **两条线都要认。** 旧线是复数包 @deepseek-ai/dsh-agent-presets（扫目录）；0.1.7 起换成
// @deepseek-ai/dsh-agent-preset + @deepseek-ai/dsh-agent-preset-registry（声明式注册表）。
// 实测（2026-09-25，0.1.7-rc.2，干净实例）：组合树里 grep 不到 'dsh-agent-presets'（0 次），
// 但模式确实注册成功、也出现在新会话选择器里 —— 只按复数包名判断，会给**最新线**的用户
// 一句"「自定义模式」无法被选中"的假警报，而那句话恰好是 1.9.10 起明确宣称已适配的那条线。
const hasAgentPresets =
  dump.includes('@deepseek-ai/dsh-agent-presets') ||
  (dump.includes('@deepseek-ai/dsh-agent-preset-registry') && dump.includes('@deepseek-ai/dsh-agent-preset'))
if (!hasWebServer || !hasAgentPresets) {
  console.log('')
  console.log(`    注意: profile "${profile}" 里这个插件只有一部分能生效。`)
  if (hasAgentPresets) {
    console.log('          · 模式本身可用（新建会话时可选）')
  } else {
    console.log('          · 组合里没有 preset 机制（旧线的 dsh-agent-presets 或新线的')
    console.log('            dsh-agent-preset-registry）：**「自定义模式」无法被选中**，')
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

# 只有新包与组合自检通过才刷新预设代码；用户数据始终只补缺失。
# 不复制包内 agent.cordis.yml，由激活后的插件按当前宿主生成。
node "$TRANSACTION_TOOL" verify "$TRANSACTION"
node "$TRANSACTION_TOOL" seed "$TRANSACTION"
node "$TRANSACTION_TOOL" commit "$TRANSACTION"
echo "    提示词文件: $PROMPT_PATH"
echo "    安装事务记录: $TRANSACTION/state.json"

# 收尾的三行说明也要随 profile 变，否则会出现「上一段说模式选不到、下一段说去选模式」。
if grep -qE '@deepseek-ai/dsh-agent-presets|@deepseek-ai/dsh-agent-preset-registry' "$DUMP_FILE" 2>/dev/null \
  && grep -q '@deepseek-ai/dsh-host-webserver' "$DUMP_FILE" 2>/dev/null; then
  NEXT_STEPS="  - 新会话选一个自定义模式（设置页里可以建多个助手）；
  - 设置面板 → 「自定义模式」：上方助手列表可新增 / 切换 / 删除，
    下方编辑当前助手的系统提示词与插件开关，保存后新建会话即生效。"
else
  NEXT_STEPS="  - 本 profile 里没有 agent-presets / 设置页，见上方「只有一部分能生效」那段；
  - 要使用助手与 custom_prompt，请装入带有预设机制的 web profile。"
fi

cat <<EOF

安装完成。请**重启 dsh**（bundle 插件只在启动装配期生效），然后：

$NEXT_STEPS

设置页先恢复中断保存，再发现由 prompt-reader.mjs 管理的助手；恢复未完成的目录保留并明确告警。
不会先用模板填补缺失的用户提示词或元数据。以前只有一个 custom 时用的是同一个根目录，
所以升级不需要迁移：它会作为第一个助手出现在列表里。

关于 --preset-id：编辑器按恢复后的受管助手目录认身份，换了目录名照样可以列出与编辑，
不需要再设任何环境变量。
（DSH_CUSTOM_PROMPT_PATH 现在只用于测试时重定向"首次播种"的根。）

故障排查见 docs/TROUBLESHOOTING.md。

EOF
