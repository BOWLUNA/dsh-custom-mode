#!/usr/bin/env bash
# 卸载「自定义模式」与设置页插件。默认保留你写好的提示词。
#
# 用法:
#   ./uninstall.sh                 # 默认 web profile
#   ./uninstall.sh --purge         # 连同本工具创建的所有模式目录一起删除
set -euo pipefail

PROFILE=web
PRESET_ID=custom
PRESET_ID_EXPLICIT=0
PURGE=0
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?}"; shift 2 ;;
    --preset-id) PRESET_ID="${2:?}"; PRESET_ID_EXPLICIT=1; shift 2 ;;
    --purge) PURGE=1; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# Reject invalid selectors before any package or filesystem operation.
if ! printf '%s' "$PROFILE" | grep -Eq '^[a-z0-9][a-z0-9_-]*$'; then
  echo "profile 不合法: $PROFILE（只能用小写字母、数字、连字符与下划线）" >&2
  exit 2
fi
if ! printf '%s' "$PRESET_ID" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "助手 id 不合法: $PRESET_ID（只能用 a-z、0-9 与连字符，且不能是路径）" >&2
  exit 2
fi

# ── 桌面端的 profile 不是 CLI 的地盘（与 install.sh 同一条闸门）────────────────
# Electron 独占 `$DSH_HOME/profiles/desktop`：依赖与 bundle 列表由应用维护，包操作持有 profile
# 事务锁，启动恢复还会自己重命名 `cordis.patch.yml`。dsh 自己就会拒（实测 0.1.7-rc.2：
# 'profile "desktop" is managed exclusively by the Electron application'），所以这里也拒，
# 并指路应用内的 Plugins 页。
if [ "$PROFILE" = "desktop" ] && [ "${DSH_ALLOW_DESKTOP_PROFILE:-}" != "1" ]; then
  cat >&2 <<'MSG'
错误: profile "desktop" 属于桌面端应用，不能用 CLI 修改。

桌面端卸载插件请在**应用内**：侧栏 Plugins → 找到 dsh-custom-mode → 卸载。
（同 install.sh：DSH_ALLOW_DESKTOP_PROFILE=1 只给本机模拟测试用。）
MSG
  exit 2
fi

echo "==> 移除设置页插件"
# 包名从仓库根 package.json 读取，与 install.sh 用同一来源，避免不一致。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="$(cd "$ROOT" && node tools/package-facts.mjs name 2>/dev/null || true)"
[ -n "$PKG_NAME" ] || { echo "无法从 package.json 读取包名" >&2; exit 1; }

command -v dsh >/dev/null 2>&1 || { echo "找不到 dsh CLI；未卸载，未清理任何安装或助手数据。" >&2; exit 1; }
# A failed host transaction is authoritative. Never bypass it by deleting files or editing bundles.
if dsh plugin --profile "$PROFILE" remove "$PKG_NAME"; then
  node "$ROOT/tools/uninstall-state.mjs" "$DSH_HOME" "$PROFILE" "$PKG_NAME"
else
  status=$?
  echo "宿主卸载失败（退出 $status）；保留安装与助手数据，请处理错误后重试。" >&2
  exit "$status"
fi

PRESET_ROOT="$DSH_HOME/.agent-presets"
if [ "$PURGE" = "1" ]; then
  echo "==> 删除本工具创建的助手目录（含提示词）"
  if [ "$PRESET_ID_EXPLICIT" = "1" ]; then
    node "$ROOT/tools/uninstall-presets.mjs" purge "$PRESET_ROOT" "$PRESET_ID"
  else
    node "$ROOT/tools/uninstall-presets.mjs" purge "$PRESET_ROOT"
  fi
else
  echo "==> 保留助手目录与提示词"
  node "$ROOT/tools/uninstall-presets.mjs" list "$PRESET_ROOT"
  echo "    如需一并删除，重新执行 ./uninstall.sh --purge"
fi
echo
echo "完成。重启 dsh 后生效。"
