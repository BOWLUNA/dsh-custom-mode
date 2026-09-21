/**
 * Browser half: 「自定义模式」settings page — the assistant manager.
 *
 * Blocks:
 *   0. 助手        — every custom mode this feature manages: pick one, create one, duplicate one, delete one.
 *   1. 模式名称    — the selected assistant's display name and description.
 *   2. 基础模式    — standard / ptc / minimal / cordis, per assistant.
 *   3. 插件开关    — one switch per composition row; groups show their children.
 *   4. 系统提示词  — the selected assistant's editable prompt text.
 *
 * Three decisions worth knowing before editing this file:
 *
 *  1. **Controls come from the shell, not from here.** `@deepseek-ai/dsh-client-ui-primitives`
 *     is in the shell's seed table (`require` resolves it like `react`), so Button / Input /
 *     Switch / Tag / Pill / RiskConfirmation / icons are the same atoms every official page
 *     uses. They are styled by the shell's own CSS through `--dsw-*` tokens, which is what makes
 *     this page follow the theme, density and future restyling instead of drifting from it.
 *     The atoms are probed, never assumed: a shell that does not seed the module falls back to
 *     plain elements below, so an older dsh gets a plainer page rather than a missing one.
 *
 *  2. **Drafts are per assistant and never discarded by switching.** `entries[id]` holds the
 *     loaded payload, the saved baseline and the current value; selecting another assistant
 *     keeps the old draft, and the list marks it 「未保存」. Losing a hand-written system prompt
 *     to a stray click is the one failure this page must not have.
 *
 *  3. **Deleting goes through the shell's RiskConfirmation.** It removes a directory and a
 *     prompt permanently, so it asks for an explicit acknowledgement instead of a second click
 *     next to the primary button.
 *
 * Hand-written in the client bundle format the module system expects
 * (`window.__ModuleLoader__.load({ id, factory })`). It talks to its host half over one private
 * HTTP route and its sub-paths with `fetch`, so it needs no Remote namespace.
 *
 * Failure policy: everything is wrapped so a broken editor can never take the page down. Worst
 * case is that this settings page does not appear.
 */

try {
  window.__ModuleLoader__.load({
    id: "dsh-custom-mode",
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

      const react = require("react")

      // 路由注册在平台的共享 `/api` 频道上（由载体在分发前施加信任与鉴权），
      // 所以这里的路径必须带 `/api` 前缀。
      const ROUTE = "/api/custom-mode"

      const NS = "settings.customMode"

      /** The shell's shared atom library. See decision 1 in the module comment. */
      const ATOMS_MODULE = "@deepseek-ai/dsh-client-ui-primitives"

      /**
       * Copy for this page, generated from editor/locales.mjs (single source of
       * truth, checked for key parity by test/locales.test.mjs).
       */
      const ZH = {
        "nav": "自定义模式",
        "assistant.heading": "助手",
        "assistant.hint": "每个助手就是一个独立模式：有自己的系统提示词、基础模式和插件开关，互不影响。新建会话时在模式选择器里挑一个。",
        "assistant.empty": "还没有助手，用下面的输入框新建一个。",
        "assistant.loadingList": "正在读取助手列表…",
        "assistant.newPlaceholder": "新助手的名字（例如：写作助手）",
        "assistant.meta": "标识",
        "assistant.copyName": "「{name}」副本",
        "assistant.broken": "组成文件有问题",
        "assistant.switchHint": "切换助手不会丢掉未保存的修改：每个助手的草稿各自留着，列表上的「未保存」标记就是它。",
        "btn.create": "新增助手",
        "btn.creating": "创建中…",
        "btn.duplicate": "复制一份",
        "btn.moveUp": "上移",
        "btn.moveDown": "下移",
        "btn.import": "导入提示词",
        "btn.export": "导出提示词",
        "btn.reset": "恢复出厂提示词",
        "btn.resetHint": "把编辑器里的内容换成出厂模板（新建助手时得到的那一份）。它同样只改草稿，点保存才落盘 —— 误点可以用「重新读取」撤销。",
        "btn.delete": "删除这个助手",
        "btn.cancel": "取消",
        "msg.created": "已创建。现在可以为它写系统提示词。",
        "msg.duplicated": "已复制。两份从此各改各的。",
        "msg.deleted": "已删除。",
        "msg.createFailed": "创建失败",
        "msg.deleteFailed": "删除失败",
        "msg.nameRequired": "请先给新助手起个名字。",
        "msg.unsaved": "有未保存的修改",
        "msg.readOnlyHint": "这一页只管理本工具创建的助手；手写的 preset 不在这里，也不会被改写。",
        "msg.reordered": "顺序已保存：新建会话时的模式选择器按这个顺序排列。",
        "msg.reorderFailed": "调整顺序失败",
        "msg.imported": "已导入到编辑器（还没有保存）：检查后点「保存」。",
        "msg.importFailed": "导入失败",
        "api.badDirection": "未知的排序方向：{direction}",
        "api.unknownAssistant": "找不到助手「{id}」：这一页只管理本工具创建的助手（目录里有 prompt.md，且组成文件用 prompt-reader.mjs 注入身份）。",
        "api.alreadyFirst": "「{name}」已经在最前面。",
        "api.alreadyLast": "「{name}」已经在最后面。",
        "api.badVariableName": "变量引用的写法不合法：{variable} 里的名字只能用小写字母、数字、下划线，且以字母开头。要写字面量花括号，请用单个左花括号，或不闭合的双左花括号。",
        "api.unknownVariable": "{variable} 不是已注册的变量，渲染会报错并让本模式每个请求都失败。可用：{known}。",
        "assistant.short": "每个助手是一个独立模式：自己的系统提示词、基础模式与插件开关。",
        "name.short": "改名只影响显示，内部标识与已有会话不受影响。",
        "mode.short": "底子决定「行集合」与工具能力；persona 行始终由本模式替换。",
        "mode.pendingRows": "底子已改为「{mode}」：保存后，下面的行列表会按新底子重算。",
        "rows.short": "逐行控制挂载哪些插件；没拨过的行保持官方默认。",
        "prompt.short": "这段文本就是本模式的系统提示词，保存后下一步生效。",
        "aria.expandHint": "展开完整说明",
        "aria.collapseHint": "收起完整说明",
        "aria.expand": "展开详情",
        "aria.collapse": "收起详情",
        "detail.id": "行 id",
        "detail.shipped": "出厂状态",
        "detail.shippedOn": "启用",
        "detail.shippedOff": "关闭",
        "detail.note": "说明",
        "detail.state": "开关状态",
        "detail.explicitOn": "已手动启用",
        "detail.explicitOff": "已手动停用",
        "detail.untouched": "未改动（跟随官方默认）",
        "detail.platform": "平台条件",
        "btn.repair": "按本线修复",
        "msg.repaired": "已修复",
        "meta.version": "插件版本",
        "meta.versionHint": "安装时不钉版本号会受 pnpm 发布冷却期影响（默认 24 小时），可能装到较旧的版本。要换版本请按 README 的钉版本命令重装，然后重启 DSH。",
        "api.saved": "已保存（{name}，基础模式 {mode}）。新建会话即生效，当前会话保持原配置。",
        "api.created": "已创建「{name}」。现在可以为它写系统提示词。",
        "api.duplicated": "已复制自「{from}」。两份从此各改各的。",
        "api.deleted": "已删除「{name}」。正在使用它的会话不受影响；新建会话时它不再出现。",
        "api.reordered": "顺序已保存：新建会话时的模式选择器按这个顺序排列。",
        "api.nameRequired": "请先给新助手起个名字。",
        "api.nameTooLong": "名字太长了（上限 {max} 个字符）。",
        "api.descriptionTooLong": "描述太长了（上限 {max} 个字符）。",
        "api.promptEmpty": "保存被拒绝：系统提示词为空。留空不会清空身份，读取器会沿用上一版。",
        "api.badMode": "未知的基础模式：{mode}",
        "api.dirExists": "目录已存在，请换一个名字：{path}",
        "api.compositionMissing": "找不到组成文件：{path}",
        "api.writeFailed": "写入失败：{detail}",
        "api.promptWriteFailed": "写入提示词失败：{detail}",
        "api.renderFailed": "生成组成文件失败：{detail}",
        "api.selfCheckFailed": "生成结果自检失败，已放弃写入：{detail}",
        "api.internalError": "宿主内部错误：{detail}",
        "api.bodyTooLarge": "请求体过大（上限 {max} 字节）",
        "api.repairNotNeeded": "这个助手在本机没有无法解析的行，无需修复。",
        "api.repaired": "已按本机这条 dsh 线关闭 {count} 个无法解析的行（{ids}）。现在这个模式能重新出现在选择器里。",
        "api.badAssistantId": "助手标识不合法：{id}（只能用 a-z、0-9 与连字符）",
        "api.seedFailed": "复制模式模板失败：{detail}",
        "api.metaWriteFailed": "写入 preset.yml 失败：{detail}",
        "api.promptReadFailed": "读取提示词失败：{detail}",
        "api.noRemoveApi": "当前 DSH 版本没有 agentPresets.remove()，无法删除。",
        "api.deleteFailed": "删除失败：{detail}",
        "api.versionMissing": "找不到这个版本（历史可能已被上限裁剪）。",
        "api.badJson": "请求体不是合法 JSON",
        "warn.approvalGateMissing": "审批闸门未启用：本机这个 DSH 版本没有 tools/pre-execute 事件，会话内改写系统提示词不会弹审批。见「详情」。",
        "warn.unresolvableRows": "有行在本机这条 DSH 线上无法解析：平台会把整个模式判为 broken，并从新会话的选择器里**静默丢弃**。点右侧的「按本线修复」即可（只关掉那几行，其它选择不动）。",
        "warn.approvalGateMissing.label": "审批闸门未启用",
        "warn.approvalGateMissing.hint": "这个 DSH 版本没有 tools/pre-execute 事件，会话内改写系统提示词**不会**弹审批。设置页不受影响；要恢复保护请升级 DSH，或把「custom_prompt 工具」那一行关掉。",
        "warn.personaOffWithPrompt": "「身份（系统提示词）」这一行是关的，所以 prompt.md 不会被注入 —— 你写的提示词现在不起作用。要么打开这一行，要么清空提示词。",
        "warn.toolOff": "「custom_prompt 工具」这一行是关的：会话里无法让 agent 改提示词，只能在本页改。",
        "warn.noDescription": "没有描述：新建会话的模式选择器里会显示成「暂无描述」。",
        "warn.noName": "没有名字：模式选择器里会显示成目录 id（例如 custom）。",
        "history.label": "改动历史",
        "history.pick": "选择要载入的版本…",
        "history.load": "载入这一版",
        "history.hint": "每次保存、以及会话内工具或手工改动，都会在这里留一版；载入只改草稿，保存前不落盘。",
        "history.by.settings": "设置页保存",
        "history.by.external": "会话内/手工改动",
        "msg.loadFailed": "载入这一版失败",
        "msg.importEmpty": "这个文件是空的。",
        "msg.importTooLarge": "文件太大（上限 1MB）。",
        "msg.exported": "已导出为文件。",
        "msg.exportFailed": "导出失败",
        "delete.title": "永久删除这个助手？",
        "delete.description": "这会删除磁盘上的模式目录，连同它的系统提示词一起消失，无法撤销。正在使用它的会话不受影响；新建会话时它不再出现在选择器里。（{id}）",
        "delete.acknowledge": "我明白这个助手的提示词会被永久删除",
        "delete.confirm": "永久删除",
        "delete.close": "关闭",
        "delete.plainConfirm": "确定永久删除「{name}」吗？该操作无法撤销。",
        "name.heading": "模式名称",
        "name.hint": "改名只影响显示（模式选择器与上面的助手列表），内部标识和已有会话不受影响。新建会话即可看到新名称。",
        "name.placeholder": "自定义模式",
        "name.descriptionPlaceholder": "模式描述（显示在模式选择器里，可留空）",
        "mode.heading": "基础模式",
        "mode.hint": "选一个官方模式作为底子，下面再按行微调。注意：底子只决定「行集合」与工具能力 —— 本模式的 persona 行始终替换掉底子那一行（提示词由你编辑，complete: false），底子的提示词语义不会被继承。改完保存后，新建会话即生效，不需要重启。",
        "rows.heading": "插件开关",
        "rows.hint": "逐行控制这个模式挂载哪些插件，和官方插件列表一样按行铺开。没拨过的行保持官方默认（含平台判断）；你手动拨了就以你的为准。",
        "prompt.heading": "系统提示词",
        "prompt.hint": "这段文本在每个模型调用前重新读取，所以保存后下一步即生效，且只影响使用这个助手的会话。「导入」把文件读进编辑器（未保存前不写入任何东西）；「导出」把当前文本存成 .md 文件；「恢复出厂提示词」把出厂模板填回编辑器（同样要保存才写入）。",
        "status.enabled": "已启用",
        "status.disabled": "已停用",
        "status.changed": "已改",
        "tag.essential": "基础能力",
        "tag.followPlatform": "跟随平台",
        "btn.save": "保存",
        "btn.saving": "处理中…",
        "btn.reload": "重新读取",
        "btn.reloadDiscard": "放弃修改并重新读取",
        "msg.loading": "正在读取…",
        "msg.notLoaded": "（尚未读取）",
        "msg.reread": "已重新读取",
        "msg.readFailed": "读取失败",
        "msg.saveFailed": "保存失败",
        "msg.saved": "已保存。新建会话即生效，当前会话保持原配置。",
        "status.detail": "{message}：{detail}",
        "row.persona.label": "身份（系统提示词）",
        "row.persona.note": "提示词注入点；关掉后本模式用回部署默认身份",
        "row.custom-prompt-tool.label": "custom_prompt 工具",
        "row.custom-prompt-tool.note": "关掉后无法用对话改提示词（设置页仍可用）",
        "row.agent-instructions.label": "项目指令 AGENTS.md",
        "row.agent-instructions.note": "读取 AGENTS.md / CLAUDE.md",
        "row.tool-bash.label": "Shell（bash）",
        "row.tool-pwsh.label": "Shell（pwsh）",
        "row.tool-fs.label": "文件读写",
        "row.tool-fs.note": "关掉后 agent 无法读写文件",
        "row.tool-fs-search.label": "文件搜索（glob/grep）",
        "row.tool-jobs.label": "后台任务",
        "row.planning.label": "计划模式（分组）",
        "row.planning.note": "含 isolate realm，关掉等于移除整个计划能力",
        "row.plan-mode.label": "计划模式实现",
        "row.compaction.label": "上下文压缩（分组）",
        "row.compaction.note": "含 isolate realm",
        "row.compaction-basic.label": "基础压缩",
        "row.command-compact.label": "/compact 命令",
        "row.tool-result-pruner.label": "工具结果裁剪",
        "row.delegation.label": "委派与工作流（分组）",
        "row.delegation.note": "含 isolate realm；关掉等于移除子代理与工作流",
        "row.tool-subagent.label": "子代理（spawn）",
        "row.tool-subagent-fork.label": "子代理（fork）",
        "row.tool-subagent-control.label": "子代理控制",
        "row.tool-subagent-list-agents.label": "列出子代理",
        "row.tool-subagent-codex.label": "Codex 子代理",
        "row.tool-subagent-codex.note": "需要先安装对应 Bundle 才能用；出厂状态见「详情」",
        "row.tool-subagent-claude-code.label": "Claude Code 子代理",
        "row.tool-subagent-claude-code.note": "需要先安装对应 Bundle 才能用；出厂状态见「详情」",
        "row.workflow-ptc.label": "工作流引擎",
        "row.workflow-worker-thread.label": "工作流 Worker 线程",
        "row.workflow-worker-thread.note": "把工作流跑在独立的 worker 线程里",
        "row.tool-workflow.label": "工作流工具",
        "row.tool-ralph.label": "Ralph 工作流",
        "row.tool-ralph.note": "Ralph 工作流工具；出厂状态见「详情」",
        "row.tool-web.label": "网页检索与抓取",
        "row.tool-skill.label": "技能工具",
        "row.skill-filesystem.label": "技能发现",
        "row.tool-cordis.label": "Cordis 运行时工具",
        "row.tool-cordis.note": "可读写 harness 运行时",
        "row.tool-plugin-manager.label": "插件管理（安装 / 启停）",
        "row.tool-plugin-manager.note": "模型侧可安装/启停插件；标准与 PTC 模式里出厂即关闭（只有创造模式默认开），本模式可以显式打开它",
        "row.tool-presentation.label": "PTC 工具呈现",
        "row.present.label": "交付文件（present）",
        "row.command-goal.label": "目标命令",
        "row.tool-goal.label": "目标",
        "row.tool-todo.label": "待办清单",
        "row.tool-ask-user.label": "向用户提问",
        "row.persistent-shell.label": "持久 Shell",
        "row.pty.label": "PTY 终端",
        "row.terminal-bash.label": "终端（bash）",
        "row.persistent-bash.label": "持久 bash",
        "row.terminal-pwsh.label": "终端（pwsh）",
        "row.persistent-pwsh.label": "持久 pwsh",
        "base.standard.label": "标准模式",
        "base.standard.note": "完整编码能力：Shell、文件、检索、技能、计划、目标、子代理、工作流",
        "base.ptc.label": "PTC 模式",
        "base.ptc.note": "在标准模式基础上启用 PTC 工具呈现（tool-presentation）",
        "base.minimal.label": "极简模式",
        "base.minimal.note": "只有 Shell 与终端，共 7 行；没有文件、检索、技能、子代理。系统提示词不是极简那一套（persona 行被本模式替换）",
        "base.cordis.label": "Cordis 模式",
        "base.cordis.note": "标准模式 + 读写运行时的 Cordis 工具集，可让 agent 自己改 harness"
      }

      const EN = {
        "nav": "Custom mode",
        "assistant.heading": "Assistants",
        "assistant.hint": "Each assistant is an independent mode: its own system prompt, base mode and plugin switches, with no effect on the others. Pick one in the mode picker when you start a new session.",
        "assistant.empty": "No assistants yet — create one with the field below.",
        "assistant.loadingList": "Loading assistants…",
        "assistant.newPlaceholder": "Name of the new assistant (e.g. Writing assistant)",
        "assistant.meta": "ID",
        "assistant.copyName": "{name} (copy)",
        "assistant.broken": "Composition problem",
        "assistant.switchHint": "Switching assistants never loses unsaved edits: each one keeps its own draft, and the \"Unsaved\" marker in the list is exactly that.",
        "btn.create": "New assistant",
        "btn.creating": "Creating…",
        "btn.duplicate": "Duplicate",
        "btn.moveUp": "Move up",
        "btn.moveDown": "Move down",
        "btn.import": "Import prompt",
        "btn.export": "Export prompt",
        "btn.reset": "Reset to factory prompt",
        "btn.resetHint": "Puts the shipped template back into the editor (the text a new assistant starts from). Like every other edit it only changes the draft — save to apply, or use Reload to discard.",
        "btn.delete": "Delete this assistant",
        "btn.cancel": "Cancel",
        "msg.created": "Created. Now you can write its system prompt.",
        "msg.duplicated": "Duplicated. The two are independent from here on.",
        "msg.deleted": "Deleted.",
        "msg.createFailed": "Could not create",
        "msg.deleteFailed": "Could not delete",
        "msg.nameRequired": "Give the new assistant a name first.",
        "msg.unsaved": "Unsaved changes",
        "msg.readOnlyHint": "This page manages only the assistants this tool created; a hand-written preset is not listed here and is never rewritten.",
        "msg.reordered": "Order saved: the mode picker for new sessions follows it.",
        "msg.reorderFailed": "Could not reorder",
        "msg.imported": "Imported into the editor (not saved yet) — review it, then click Save.",
        "msg.importFailed": "Import failed",
        "api.badDirection": "Unknown reorder direction: {direction}",
        "api.unknownAssistant": "No assistant {id}: this page only manages the assistants it created (a directory with prompt.md whose composition injects the identity through prompt-reader.mjs).",
        "api.alreadyFirst": "{name} is already first.",
        "api.alreadyLast": "{name} is already last.",
        "api.badVariableName": "{variable} is not a valid variable reference: names may use lower-case letters, digits and underscores, and must start with a letter. For a literal brace, use a single opening brace or an unclosed double brace.",
        "api.unknownVariable": "{variable} is not a registered variable — rendering would fail every request in this mode. Available: {known}.",
        "assistant.short": "Each assistant is its own mode: its own system prompt, base mode and plugin switches.",
        "name.short": "Renaming only changes what is displayed — not the internal id or existing sessions.",
        "mode.short": "The base decides the row set and tool abilities; the persona row is always replaced by this mode.",
        "mode.pendingRows": "Base changed to {mode}: the row list below is recomputed from the new base when you save.",
        "rows.short": "Control which plugins this mode mounts, row by row; untouched rows keep the shipped default.",
        "prompt.short": "Saving this text makes it the system prompt of this mode, and it takes effect on the next step.",
        "aria.expandHint": "Show the full explanation",
        "aria.collapseHint": "Hide the full explanation",
        "aria.expand": "Show details",
        "aria.collapse": "Hide details",
        "detail.id": "Row id",
        "detail.shipped": "Shipped",
        "detail.shippedOn": "enabled",
        "detail.shippedOff": "disabled",
        "detail.note": "Note",
        "detail.state": "Switch",
        "detail.explicitOn": "Set to on by you",
        "detail.explicitOff": "Set to off by you",
        "detail.untouched": "Untouched (follows the shipped default)",
        "detail.platform": "Platform condition",
        "btn.repair": "Fix for this line",
        "msg.repaired": "Repaired",
        "meta.version": "Plugin version",
        "meta.versionHint": "Installing without a pinned version is subject to pnpm’s release cooldown (24 h by default) and can land on an older release. To change version, reinstall with the pinned command from the README and restart DSH.",
        "api.saved": "Saved ({name}, base mode {mode}). A new session picks it up; the current one keeps its configuration.",
        "api.created": "Created {name}. You can write its system prompt now.",
        "api.duplicated": "Copied from {from}. The two are independent from now on.",
        "api.deleted": "Deleted {name}. Sessions already using it keep running; it no longer appears for new sessions.",
        "api.reordered": "Order saved: the new-session mode picker follows it.",
        "api.nameRequired": "Give the new assistant a name first.",
        "api.nameTooLong": "That name is too long (limit {max} characters).",
        "api.descriptionTooLong": "That description is too long (limit {max} characters).",
        "api.promptEmpty": "Save rejected: the system prompt is empty. Emptying it would not clear the identity — the reader keeps the last good text.",
        "api.badMode": "Unknown base mode: {mode}",
        "api.dirExists": "That directory already exists — pick another name: {path}",
        "api.compositionMissing": "Composition file not found: {path}",
        "api.writeFailed": "Write failed: {detail}",
        "api.promptWriteFailed": "Writing the prompt failed: {detail}",
        "api.renderFailed": "Rendering the composition failed: {detail}",
        "api.selfCheckFailed": "The generated composition failed its self-check, so nothing was written: {detail}",
        "api.internalError": "Unexpected host error: {detail}",
        "api.bodyTooLarge": "Request body too large (limit {max} bytes)",
        "api.repairNotNeeded": "Nothing to repair — no row of this assistant is unresolvable on this machine.",
        "api.repaired": "Disabled {count} row(s) this dsh line cannot resolve ({ids}). The mode can appear in the pickers again.",
        "api.badAssistantId": "Invalid assistant id: {id} (a-z, 0-9 and hyphens only)",
        "api.seedFailed": "Copying the mode template failed: {detail}",
        "api.metaWriteFailed": "Writing preset.yml failed: {detail}",
        "api.promptReadFailed": "Reading the prompt failed: {detail}",
        "api.noRemoveApi": "This DSH build has no agentPresets.remove(), so deleting is unavailable.",
        "api.deleteFailed": "Delete failed: {detail}",
        "api.versionMissing": "That version is gone (the history is capped).",
        "api.badJson": "The request body is not valid JSON",
        "warn.personaOffWithPrompt": "The \"Identity (system prompt)\" row is off, so prompt.md is never injected — the prompt you wrote has no effect. Turn the row on, or clear the prompt.",
        "warn.toolOff": "The \"custom_prompt tool\" row is off: the agent cannot change the prompt from inside a session, only this page can.",
        "warn.noDescription": "No description: the new-session mode picker will show it as \"no description yet\".",
        "warn.approvalGateMissing": "The approval gate is off: this DSH build has no tools/pre-execute event, so in-session prompt rewrites do not ask for approval. See the details.",
        "warn.unresolvableRows": "Some rows cannot be resolved on this DSH line: the platform marks the whole mode broken and silently drops it from the new-session picker. Click Fix for this line — it only turns those rows off and leaves your other choices alone.",
        "warn.approvalGateMissing.label": "Approval gate is off",
        "warn.approvalGateMissing.hint": "This DSH build has no tools/pre-execute event, so in-session prompt rewrites do NOT ask for approval. The settings page is unaffected; upgrade DSH or turn the custom_prompt tool row off to restore the gate.",
        "warn.noName": "No name: the mode picker will show the directory id (e.g. custom).",
        "history.label": "Change history",
        "history.pick": "Pick a version to load…",
        "history.load": "Load this version",
        "history.hint": "Every save — plus changes made in a session or by hand — leaves a version here. Loading one only edits the draft; nothing is written until you save.",
        "history.by.settings": "saved from this page",
        "history.by.external": "changed in a session / by hand",
        "msg.loadFailed": "Could not load that version",
        "msg.importEmpty": "That file is empty.",
        "msg.importTooLarge": "That file is too large (1 MB limit).",
        "msg.exported": "Exported to a file.",
        "msg.exportFailed": "Export failed",
        "delete.title": "Delete this assistant permanently?",
        "delete.description": "This removes the mode directory from disk, system prompt included, and cannot be undone. Sessions already using it keep running; new sessions no longer offer it. ({id})",
        "delete.acknowledge": "I understand this assistant's prompt will be deleted permanently",
        "delete.confirm": "Delete permanently",
        "delete.close": "Close",
        "delete.plainConfirm": "Permanently delete \"{name}\"? This cannot be undone.",
        "name.heading": "Mode name",
        "name.hint": "Renaming changes only what is displayed (the mode picker and the assistant list above); the internal id and existing sessions are unaffected. Start a new session to see it.",
        "name.placeholder": "Custom mode",
        "name.descriptionPlaceholder": "Mode description (shown in the mode picker, optional)",
        "mode.heading": "Base mode",
        "mode.hint": "Pick an official mode as the base, then adjust it row by row. Note: the base only decides which rows exist — this mode always replaces the base's persona row with its own reader (complete: false), so the base's prompt semantics are not inherited. A save applies to the next new session; no restart needed.",
        "rows.heading": "Plugin switches",
        "rows.hint": "Control row by row which plugins this mode mounts, laid out like the official plugin list. Untouched rows keep the official default (platform conditions included); your manual choice wins.",
        "prompt.heading": "System prompt",
        "prompt.hint": "This text is re-read before every model call, so a save applies on the next step and only affects sessions on this assistant. \"Import\" reads a file into the editor (nothing is written until you save); \"Export\" saves the current text as a .md file; \"Reset to factory prompt\" puts the shipped template back into the editor (also saved only when you save).",
        "status.enabled": "Enabled",
        "status.disabled": "Disabled",
        "status.changed": "changed",
        "tag.essential": "core",
        "tag.followPlatform": "follows platform",
        "btn.save": "Save",
        "btn.saving": "Working…",
        "btn.reload": "Reload",
        "btn.reloadDiscard": "Discard edits and reload",
        "msg.loading": "Loading…",
        "msg.notLoaded": "(not loaded)",
        "msg.reread": "Reloaded",
        "msg.readFailed": "Load failed",
        "msg.saveFailed": "Save failed",
        "msg.saved": "Saved. A new session picks it up; the current one keeps its configuration.",
        "status.detail": "{message}: {detail}",
        "row.persona.label": "Identity (system prompt)",
        "row.persona.note": "Where the prompt is injected; turning it off falls back to the deployment identity",
        "row.custom-prompt-tool.label": "custom_prompt tool",
        "row.custom-prompt-tool.note": "Without it the prompt can still be edited here, but not by asking the agent",
        "row.agent-instructions.label": "Project instructions (AGENTS.md)",
        "row.agent-instructions.note": "Reads AGENTS.md / CLAUDE.md",
        "row.tool-bash.label": "Shell (bash)",
        "row.tool-pwsh.label": "Shell (pwsh)",
        "row.tool-fs.label": "File access",
        "row.tool-fs.note": "Without it the agent cannot read or write files",
        "row.tool-fs-search.label": "File search (glob/grep)",
        "row.tool-jobs.label": "Background jobs",
        "row.planning.label": "Plan mode (group)",
        "row.planning.note": "Carries an isolate realm; turning it off removes planning entirely",
        "row.plan-mode.label": "Plan mode implementation",
        "row.compaction.label": "Context compaction (group)",
        "row.compaction.note": "Carries an isolate realm",
        "row.compaction-basic.label": "Basic compaction",
        "row.command-compact.label": "/compact command",
        "row.tool-result-pruner.label": "Tool-result pruning",
        "row.delegation.label": "Delegation and workflows (group)",
        "row.delegation.note": "Carries an isolate realm; turning it off removes subagents and workflows",
        "row.tool-subagent.label": "Subagent (spawn)",
        "row.tool-subagent-fork.label": "Subagent (fork)",
        "row.tool-subagent-control.label": "Subagent control",
        "row.tool-subagent-list-agents.label": "List subagents",
        "row.tool-subagent-codex.label": "Codex subagent",
        "row.tool-subagent-codex.note": "Needs its Bundle installed first; the shipped state is in the details",
        "row.tool-subagent-claude-code.label": "Claude Code subagent",
        "row.tool-subagent-claude-code.note": "Needs its Bundle installed first; the shipped state is in the details",
        "row.workflow-ptc.label": "Workflow engine",
        "row.workflow-worker-thread.label": "Workflow worker thread",
        "row.workflow-worker-thread.note": "Runs workflows on a separate worker thread",
        "row.tool-workflow.label": "Workflow tool",
        "row.tool-ralph.label": "Ralph workflow",
        "row.tool-ralph.note": "The Ralph workflow tool; the shipped state is in the details",
        "row.tool-web.label": "Web search and fetch",
        "row.tool-skill.label": "Skill tool",
        "row.skill-filesystem.label": "Skill discovery",
        "row.tool-cordis.label": "Cordis runtime tools",
        "row.tool-cordis.note": "Can read and modify the running harness",
        "row.tool-plugin-manager.label": "Plugin manager (install / toggle)",
        "row.tool-plugin-manager.note": "Lets the agent install and toggle plugins; shipped OFF in Standard and PTC (only Creator enables it) — this mode can switch it on",
        "row.tool-presentation.label": "PTC tool presentation",
        "row.present.label": "Deliverables (present)",
        "row.command-goal.label": "Goal command",
        "row.tool-goal.label": "Goals",
        "row.tool-todo.label": "Todo list",
        "row.tool-ask-user.label": "Ask the user",
        "row.persistent-shell.label": "Persistent shell",
        "row.pty.label": "PTY terminal",
        "row.terminal-bash.label": "Terminal (bash)",
        "row.persistent-bash.label": "Persistent bash",
        "row.terminal-pwsh.label": "Terminal (pwsh)",
        "row.persistent-pwsh.label": "Persistent pwsh",
        "base.standard.label": "Standard",
        "base.standard.note": "Full coding agent: shell, files, search, skills, planning, goals, subagents, workflows",
        "base.ptc.label": "PTC",
        "base.ptc.note": "Standard plus PTC tool presentation (tool-presentation)",
        "base.minimal.label": "Minimal",
        "base.minimal.note": "Shell and terminal only, 7 rows; no files, search, skills or subagents. The system prompt is not minimal's either (this mode replaces the persona row)",
        "base.cordis.label": "Cordis",
        "base.cordis.note": "Standard plus the Cordis toolset, letting the agent modify its own harness"
      }

      const TRANSLATIONS = { zh: ZH, en: EN }

      /**
       * The language the shell is showing right now.
       *
       * Read from the service SNAPSHOT at call time rather than captured once, so a language
       * switch — which re-renders every outlet — picks up the new value on the next render.
       */
      /** `error` as a readable string, without assuming it is an Error. */
      function describe(error) {
        return String((error && error.message) || error)
      }

      function activeLanguage(locale) {
        try {
          const snapshot = locale !== undefined && typeof locale.getLocale === "function" ? locale.getLocale() : undefined
          const id = snapshot !== undefined && typeof snapshot.active === "string" ? snapshot.active : ""
          if (id !== "") return id.toLowerCase().startsWith("zh") ? "zh" : "en"
        } catch (error) {
          /* a shell without a readable snapshot falls through to the default */
        }
        return "zh"
      }

      /**
       * Translate one key, with this bundle's own dictionaries as a FLOOR.
       *
       * The shell's bound `t` is preferred — it is what makes a language switch re-render the
       * page and what keeps this text in the same table as every other plugin's. But the page
       * must never depend on that registration having succeeded: `locale.register()` refuses a
       * namespace it already holds (an HMR swap applies this bundle twice), and a registration
       * can be gone by the time the already-mounted page renders — both observed as a page full
       * of raw keys like `assistant.heading`. The dictionaries are inlined in this file anyway
       * (they are what test/locales.test.mjs diffs against locales.mjs), so they are used when
       * the shell cannot answer. A raw key is therefore impossible whenever it is in the table.
       */
      function translate(key, fallback, shellT) {
        if (typeof shellT === "function") {
          const value = shellT(key)
          if (typeof value === "string" && value !== "" && value !== key) return value
        }
        const dict = activeLanguage(localeRef) === "en" ? EN : ZH
        if (typeof dict[key] === "string" && dict[key] !== "") return dict[key]
        if (typeof ZH[key] === "string" && ZH[key] !== "") return ZH[key]
        return fallback === undefined ? key : fallback
      }

      /**
       * The locale service, kept for {@link translate}'s language lookup and the nav label.
       *
       * A module-scope slot rather than a parameter because the nav label is a thunk the shell
       * calls outside any component, and it must read the CURRENT language each time.
       */
      let localeRef

      /**
       * Plain-element stand-ins for the shell's atoms.
       *
       * Only reached on a shell that does not seed {@link ATOMS_MODULE}. Their prop contracts
       * match the real ones exactly (`Switch.onChange` hands over the next boolean, not an
       * event), so no component below needs to know which set it got.
       */
      function fallbackAtoms() {
        const join = (...parts) => parts.filter((part) => typeof part === "string" && part !== "").join(" ")
        const Button = (props) => {
          const { variant, size, icon, children, className, ...rest } = props
          return react.createElement(
            "button",
            {
              ...rest,
              type: rest.type === undefined ? "button" : rest.type,
              className: join(
                "cpfe-btn",
                variant === "primary" ? "cpfe-btn-primary" : variant === "ghost" ? "cpfe-btn-ghost" : "cpfe-btn-outline",
                size === "sm" ? "cpfe-btn-sm" : "",
                className,
              ),
            },
            icon === undefined || icon === null ? null : icon,
            children,
          )
        }
        const Input = (props) => {
          const { icon, className, ...rest } = props
          return react.createElement("input", { ...rest, className: join("cpfe-input", className) })
        }
        const Switch = (props) => {
          const { checked, onChange, label, disabled, title, className } = props
          // Like the real atom: `label` is the accessible name ONLY, never visible text —
          // the caller draws the row title, so both paths look the same.
          return react.createElement(
            "label",
            { className: join("cpfe-switch", className), title },
            react.createElement("input", {
              type: "checkbox",
              checked,
              disabled,
              "aria-label": label,
              onChange: (event) => onChange(event.target.checked),
            }),
          )
        }
        const Tag = (props) =>
          react.createElement(
            "span",
            { className: join("cpfe-tag", props.tone === undefined ? "" : "cpfe-tag-" + props.tone, props.className) },
            props.children,
          )
        const Pill = (props) => {
          const { active, className, children, ...rest } = props
          return react.createElement(
            "button",
            {
              ...rest,
              type: "button",
              "aria-pressed": active === true,
              className: join("cpfe-pill", active === true ? "cpfe-pill-on" : "", className),
            },
            children,
          )
        }
        return { Button, Input, Switch, Tag, Pill }
      }

      /** Resolve the atom set once, at factory time. */
      function loadAtoms() {
        try {
          const atoms = require(ATOMS_MODULE)
          if (atoms !== null && typeof atoms === "object" && typeof atoms.Button === "function") return atoms
        } catch (error) {
          console.info(
            "dsh-custom-mode: 当前壳没有在种子表里提供 " +
              ATOMS_MODULE +
              "，改用内置的朴素控件（功能一致，外观更简）。",
          )
        }
        return fallbackAtoms()
      }

      const A = loadAtoms()

      /**
       * Stylesheet: LAYOUT ONLY.
       *
       * Controls are the shell's, so nothing here restyles a button, input or switch while the
       * atoms are available — that is what keeps this page consistent with every other one. The
       * `cpfe-btn*` / `cpfe-input` / `cpfe-switch*` / `cpfe-tag*` / `cpfe-pill*` rules exist for
       * the fallback path above, and `--dsw-*` tokens are used for the few own surfaces (cards,
       * grids, the status line).
       */
      const CSS = [
        ".cpfe{--g:8px;display:flex;flex-direction:column;gap:24px;width:100%;max-width:900px;box-sizing:border-box;padding-bottom:16px}",
        ".cpfe-h{margin:0 0 4px;font-size:15px;line-height:22px;color:var(--dsw-alias-label-primary)}",
        ".cpfe-sub{margin:0 0 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
        // 一行提示 + 详情下拉（与插件行同一套语言）
        ".cpfe-hint{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px}",
        ".cpfe-hint-line{flex:1;min-width:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".cpfe-hint-toggle{flex:0 0 auto;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;line-height:1}",
        ".cpfe-hint-toggle:hover{background:var(--dsw-alias-bg-layer-2)}",
        ".cpfe-hint-detail{flex:1 0 100%;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
        // 描述：多行、自适应高度（没有多行输入组件，所以用 textarea + 同一批语义变量）
        ".cpfe-desc{box-sizing:border-box;min-height:56px;max-height:200px;resize:vertical;padding:8px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;margin-bottom:8px}",
        ".cpfe-base-pending{color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-note{display:block;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}",
        ".cpfe-mono{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
        ".cpfe-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center}",
        ".cpfe-pill-wrap{display:inline-flex;align-items:center;gap:4px}",
        ".cpfe-actions{display:flex;flex-wrap:wrap;gap:var(--g);align-items:center;margin-top:4px}",
        ".cpfe-newrow{display:flex;gap:var(--g);align-items:center;flex-wrap:wrap;margin-top:10px}",
        ".cpfe-field{display:flex;width:100%;margin-bottom:8px}",
        ".cpfe-row-head{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}",
        ".cpfe-row-switch{flex:0 0 auto}",
        ".cpfe-row-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}",
        ".cpfe-row-note{min-height:16px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".cpfe-row-toggle{flex:0 0 auto;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;line-height:1}",
        ".cpfe-row-toggle:hover{background:var(--dsw-alias-bg-layer-2)}",
        ".cpfe-row-open{border-color:var(--dsw-alias-border-l2)}",
        ".cpfe-row-detail{display:flex;flex-direction:column;gap:4px;margin:0 0 2px 14px;padding:8px 12px;border-left:.5px solid var(--dsw-alias-border-l1);font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}",
        ".cpfe-detail-line{display:flex;gap:8px;min-width:0}",
        ".cpfe-detail-key{flex:0 0 62px;color:var(--dsw-alias-label-secondary)}",
        ".cpfe-detail-value{min-width:0;overflow-wrap:anywhere}",
        ".cpfe-sec-head{display:flex;align-items:center;justify-content:space-between;gap:var(--g);flex-wrap:wrap}",
        ".cpfe-newinput{flex:1;min-width:200px}",
        // 单列、行高统一（对齐官方插件页的形态）；之前的自适应多列网格会让行高参差不齐。
        ".cpfe-rows{display:flex;flex-direction:column;gap:6px;margin-top:4px}",
        ".cpfe-line{display:flex;flex-direction:column;gap:6px;min-width:0}",
        ".cpfe-group{display:flex;flex-direction:column;gap:6px;margin-top:8px;min-width:0}",
        ".cpfe-kids{display:flex;flex-direction:column;gap:6px;margin-left:14px;padding-left:14px;border-left:.5px solid var(--dsw-alias-border-l1)}",
        ".cpfe-row{display:flex;gap:10px;align-items:center;box-sizing:border-box;min-height:52px;padding:8px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}",
        ".cpfe-row-meta{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}",
        ".cpfe-row-badges{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
        ".cpfe-editor{box-sizing:border-box;width:100%;min-height:240px;resize:vertical;padding:12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:20px}",
        ".cpfe-bar{display:flex;align-items:center;gap:var(--g);flex-wrap:wrap}",
        ".cpfe-status{font-size:13px;line-height:20px}",
        ".cpfe-ok{color:var(--dsw-alias-label-secondary)}",
        ".cpfe-err{color:var(--dsw-alias-state-error-primary)}",
        ".cpfe-dirty{color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-danger{color:var(--dsw-alias-state-error-primary)}",
        ".cpfe-meta-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;min-width:0}",
        ".cpfe-version{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}",
        ".cpfe-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
        // ── fallback-path controls (unused when the shell provides the atoms) ──
        ".cpfe-btn{appearance:none;cursor:pointer;padding:0 14px;height:32px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
        ".cpfe-btn:disabled{opacity:.5;cursor:default}",
        ".cpfe-btn-sm{height:28px;padding:0 10px;font-size:12px}",
        ".cpfe-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent;font-weight:500}",
        ".cpfe-btn-ghost{border-color:transparent;background:transparent}",
        ".cpfe-input{box-sizing:border-box;width:100%;height:34px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
        ".cpfe-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}",
        ".cpfe-tag{font-size:11px;line-height:16px;padding:0 5px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}",
        ".cpfe-tag-success,.cpfe-tag-info{color:var(--dsw-alias-state-success-primary)}",
        ".cpfe-tag-warning{color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-tag-danger{color:var(--dsw-alias-state-error-primary)}",
        ".cpfe-pill{appearance:none;cursor:pointer;height:28px;padding:0 12px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px}",
        ".cpfe-pill-on{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}",
      ].join("")

      /** Apply the page stylesheet once, keyed so a re-mount never duplicates it. */
      function ensureStyles() {
        if (typeof document === "undefined") return
        const tagId = "dsh-custom-mode/system-prompt"
        if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return
        const tag = document.createElement("style")
        tag.dataset.plugin = "dsh-custom-mode"
        tag.dataset.pluginCss = tagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }

      const asJson = (response) => response.json()

      /** The endpoints, all under the one prefix route the host half registers. */
      const ROUTES = {
        list: ROUTE,
        state: ROUTE + "/state",
        history: ROUTE + "/history",
        create: ROUTE + "/create",
        delete: ROUTE + "/delete",
        reorder: ROUTE + "/reorder",
        repair: ROUTE + "/repair",
      }

      /** Every assistant this feature manages. */
      async function fetchList() {
        return asJson(await fetch(ROUTES.list, { method: "GET", headers: { accept: "application/json" } }))
      }

      /** One assistant: base mode, row tree, switches, prompt, display metadata. */
      async function fetchState(id) {
        return asJson(
          await fetch(ROUTES.state + "?id=" + encodeURIComponent(id), {
            method: "GET",
            headers: { accept: "application/json" },
          }),
        )
      }

      /** POST a JSON body to one endpoint and read the JSON verdict. */
      async function postJson(url, payload) {
        return asJson(
          await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(payload),
          }),
        )
      }

      /** A safe download name: no separators or characters a filesystem rejects. */
      function fileNameFor(name) {
        const cleaned = String(name === undefined || name === null ? "" : name)
          .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .trim()
        return cleaned === "" ? "prompt" : cleaned.slice(0, 60)
      }

      /** The editable draft for one assistant, derived from its loaded state. */
      /** 时间戳给人看：转本地时间；解析不了就原样显示（历史文件是纯文本，什么都有可能）。 */
      function formatWhen(at) {
        const parsed = new Date(at)
        if (Number.isNaN(parsed.getTime())) return String(at).slice(0, 16)
        return parsed.toLocaleString()
      }

      function draftOf(state) {
        return {
          id: state.id,
          mode: state.mode,
          overrides: { ...state.overrides },
          prompt: state.prompt,
          name: typeof state.name === "string" ? state.name : "",
          description: typeof state.description === "string" ? state.description : "",
          // 「恢复出厂提示词」要用它。它不是草稿的一部分，`sameDraft` 不比较它 ——
          // 漏掉这一行按钮会一直置灰（实测：真点了没反应，浏览器验收抓到）。
          factoryPrompt: typeof state.factoryPrompt === "string" ? state.factoryPrompt : null,
          // 改动历史：列表来自 state（只有元数据），正文点「载入这一版」时按需取。
          history: Array.isArray(state.history) ? state.history : [],
          historyPick: "",
          // 「配置了却不生效」的告警码；文案按当前语言渲染。
          warnings: Array.isArray(state.warnings) ? state.warnings : [],
        }
      }

      /** Whether a draft still differs from the state it was loaded from. */
      function sameDraft(left, right) {
        if (left === undefined || right === undefined || left === null || right === null) return left === right
        return (
          left.mode === right.mode &&
          left.prompt === right.prompt &&
          left.name === right.name &&
          left.description === right.description &&
          JSON.stringify(left.overrides) === JSON.stringify(right.overrides)
        )
      }

      /** `「名称」副本`-style copy name, from a locale template. */
      function copyName(template, name) {
        return String(template).replace("{name}", name)
      }

      /**
       * A section's one-line hint, with the full explanation behind a disclosure.
       *
       * The sections used to open with a paragraph each. On a real screen that is a wall of text above the
       * controls the user came for, and the same "compact line + open on demand" language as the row list keeps
       * the page scannable without dropping a word of the explanation.
       */
      function SectionHint(props) {
        const { id, hint, detail, expanded, onToggleExpand, t } = props
        const open = expanded[id] === true
        const collapsible = typeof detail === "string" && detail !== "" && detail !== hint
        return react.createElement(
          "div",
          { className: "cpfe-hint" },
          react.createElement("span", { className: "cpfe-hint-line", title: hint }, hint),
          collapsible === false
            ? null
            : react.createElement(
                "button",
                {
                  type: "button",
                  className: "cpfe-hint-toggle",
                  "aria-expanded": open,
                  "aria-label": t(open ? "aria.collapse" : "aria.expandHint"),
                  title: t(open ? "aria.collapse" : "aria.expandHint"),
                  onClick: () => onToggleExpand(id),
                },
                open ? "▾" : "▸",
              ),
          open === true && collapsible === true
            ? react.createElement("p", { className: "cpfe-hint-detail" }, detail)
            : null,
        )
      }

      /**
       * One row of the plugin switch list.
       *
       * Laid out like the shell's own plugin page: **one compact line per row** — title, status tags, a
       * one-line truncated description and the switch on the right — with everything else (the row id, the
       * full note, the tri-state detail, the platform condition) behind a per-row disclosure. Measured before
       * this change: 33 rows at 274px wide and 84–117px tall with a bare `tool-bash` line each, i.e. uneven
       * heights and a lot of vertical noise for information most users never read.
       */
      function RowList(props) {
        const { rows, overrides, onToggle, expanded, onToggleExpand, depth, t } = props
        return react.createElement(
          "div",
          { className: depth === 0 ? "cpfe-rows" : "cpfe-kids" },
          rows.map((row) => {
            // A row is "on" unless its explicit override says off; without an
            // override the shipped state decides (which is what "跟随默认" means).
            const effective = overrides[row.id] !== undefined ? overrides[row.id] : !row.disabled
            const changed = overrides[row.id] !== undefined
            const rowTitle = t("row." + row.id + ".label", row.label)
            const note = row.note === null || row.note === undefined ? null : t("row." + row.id + ".note", row.note)
            const open = expanded !== undefined && expanded[row.id] === true
            return react.createElement(
              "div",
              { key: row.id, className: row.children.length > 0 ? "cpfe-group" : "cpfe-line" },
              react.createElement(
                "div",
                { className: "cpfe-row" + (open ? " cpfe-row-open" : "") },
                react.createElement(
                  "div",
                  { className: "cpfe-row-meta" },
                  react.createElement(
                    "div",
                    { className: "cpfe-row-line" },
                    react.createElement("span", { className: "cpfe-row-head" }, rowTitle),
                    react.createElement(
                      "div",
                      { className: "cpfe-row-badges" },
                      react.createElement(
                        A.Tag,
                        { tone: effective ? "success" : "neutral" },
                        effective ? t("status.enabled") : t("status.disabled"),
                      ),
                      row.essential ? react.createElement(A.Tag, { tone: "warning" }, t("tag.essential")) : null,
                      row.disabledExpression !== null && row.disabledExpression !== undefined
                        ? react.createElement(A.Tag, { tone: "outline" }, t("tag.followPlatform"))
                        : null,
                      changed ? react.createElement(A.Tag, { tone: "info" }, t("status.changed")) : null,
                    ),
                  ),
                  // 折叠时只留一行说明（超出截断，悬停给全文）。**没有说明就留空**：裸露的行 id
                  // 是开发者信息，已经在「详情」里 —— 之前它作为副标题占了每行一行。
                  react.createElement("span", { className: "cpfe-row-note", title: note ?? "" }, note ?? ""),
                ),
                react.createElement(
                  "button",
                  {
                    type: "button",
                    className: "cpfe-row-toggle",
                    "aria-expanded": open,
                    "aria-label": t(open ? "aria.collapse" : "aria.expand"),
                    onClick: () => onToggleExpand(row.id),
                  },
                  open ? "▾" : "▸",
                ),
                react.createElement(A.Switch, {
                  checked: effective,
                  onChange: (next) => onToggle(row.id, next),
                  // `Switch` renders NO text: its `label` is the accessible name only, so the
                  // visible title is drawn next to it (an unlabelled toggle is unusable).
                  label: rowTitle,
                  className: "cpfe-row-switch",
                }),
              ),
              open
                ? react.createElement(
                    "div",
                    { className: "cpfe-row-detail" },
                    react.createElement(
                      "div",
                      { className: "cpfe-detail-line" },
                      react.createElement("span", { className: "cpfe-detail-key" }, t("detail.id")),
                      react.createElement("span", { className: "cpfe-mono" }, row.id),
                    ),
                    note === null
                      ? null
                      : react.createElement(
                          "div",
                          { className: "cpfe-detail-line" },
                          react.createElement("span", { className: "cpfe-detail-key" }, t("detail.note")),
                          react.createElement("span", { className: "cpfe-detail-value" }, note),
                        ),
                    react.createElement(
                      "div",
                      { className: "cpfe-detail-line" },
                      react.createElement("span", { className: "cpfe-detail-key" }, t("detail.shipped")),
                      // 出厂状态来自**本机实际文件**（row.disabled），不是写死的文案：同一个行在两条 dsh 线上
                      // 的出厂状态可能不同（实测：Ralph 在稳定线出厂是启用的，在预览线是关闭的）。
                      react.createElement(
                        "span",
                        { className: "cpfe-detail-value" },
                        row.disabled ? t("detail.shippedOff") : t("detail.shippedOn"),
                      ),
                    ),
                    react.createElement(
                      "div",
                      { className: "cpfe-detail-line" },
                      react.createElement("span", { className: "cpfe-detail-key" }, t("detail.state")),
                      react.createElement(
                        "span",
                        { className: "cpfe-detail-value" },
                        changed
                          ? effective
                            ? t("detail.explicitOn")
                            : t("detail.explicitOff")
                          : t("detail.untouched"),
                      ),
                    ),
                    row.disabledExpression !== null && row.disabledExpression !== undefined
                      ? react.createElement(
                          "div",
                          { className: "cpfe-detail-line" },
                          react.createElement("span", { className: "cpfe-detail-key" }, t("detail.platform")),
                          react.createElement("span", { className: "cpfe-mono" }, String(row.disabledExpression)),
                        )
                      : null,
                  )
                : null,
              row.children.length > 0
                ? react.createElement(RowList, {
                    rows: row.children,
                    overrides: overrides,
                    onToggle: onToggle,
                    expanded: expanded,
                    onToggleExpand: onToggleExpand,
                    depth: depth + 1,
                    t: t,
                  })
                : null,
            )
          }),
        )
      }

      function CustomModeSection(props) {
        // Compatibility: a shell that does not hand us a bound `t` (older or
        // changed settings contract) must still render real copy. Falling back to
        // the Chinese dictionary means the worst case is "Chinese text", never a
        // page full of raw keys like `name.heading`.
        const shellT =
          props !== null && typeof props === "object" && typeof props.t === "function" ? props.t : undefined
        /**
         * Translate a key. {@link translate} prefers the shell's bound `t` and falls back to
         * this bundle's own dictionaries, so an untranslated key degrades to Chinese (or to the
         * caller's fallback) and never to a bare key like `name.heading`.
         */
        const t = (key, fallback) => translate(key, fallback, shellT)

        /** 把 `{name}` 这类占位符换成 params 里的值（缺失就原样留着，便于发现漏参）。 */
        const fillPlaceholders = (template, params) =>
          template.replace(/\{(\w+)\}/g, (match, key) =>
            params !== null && typeof params === "object" && params[key] !== undefined ? String(params[key]) : match,
          )

        /**
         * 服务端结果的**本地化渲染**。
         *
         * 宿主仍然回中文的 `note`/`error`（那是 HTTP API 的兼容面），但页面优先用自己的词典按 `code`
         * 渲染 —— 否则英文界面会在出错那一刻掉回中文（外部审阅点名的"硬伤"）。服务端若带来了页面无从
         * 知道的细节（路径、底层错误），放在 `params` 里填进模板。没有 `code` 时退回宿主文案，兼容旧宿主。
         */
        const apiText = (result, fallbackKey) => {
          const code = result !== null && typeof result === "object" && typeof result.code === "string" ? result.code : ""
          if (code !== "") {
            const template = translate("api." + code, "", shellT)
            if (template !== "") return fillPlaceholders(template, result.params)
          }
          if (result !== null && typeof result === "object") {
            if (typeof result.error === "string" && result.error !== "") return result.error
            if (typeof result.note === "string" && result.note !== "") return result.note
          }
          return t(fallbackKey)
        }

        const [list, setList] = react.useState(null)
        const [selected, setSelected] = react.useState("")
        /** id → { payload, saved, value }: loaded state, baseline and live draft. */
        const [entries, setEntries] = react.useState({})
        const [status, setStatus] = react.useState("")
        const [failed, setFailed] = react.useState(false)
        const [busy, setBusy] = react.useState(false)
        const [newName, setNewName] = react.useState("")
        const [deleteOpen, setDeleteOpen] = react.useState(false)
        const [acknowledged, setAcknowledged] = react.useState(false)
        /**
         * Which rows have their detail open, by row id.
         *
         * Per-row and local to the section: the list is long (33 rows measured) and the interesting detail
         * differs per user, so nothing is expanded by default and nothing is persisted.
         */
        const [expandedRows, setExpandedRows] = react.useState({})
        /** 本机这条线上有无法解析的行时，一键把它们关掉（服务端复用保存同一条排版手术）。 */
        const repairRowsNow = async () => {
          if (draft === null) return
          setBusy(true)
          setFailed(false)
          try {
            const result = await postJson(ROUTES.repair, { id: selected })
            if (result !== null && result.ok === true) {
              setStatus(apiText(result, "msg.repaired"))
              // ★ 把修复折进**草稿**（issue #8）。
              //
              // 修复在磁盘上是生效的，但草稿里那几行仍然是"启用"。而 `reload()` 对脏草稿是
              // **保留**的（`open()` 的 `!sameDraft(...)` 保护），所以草稿不会自己更新；
              // 于是下一次保存会按草稿重渲染，把刚修好的行原样打开 —— 模式再次从所有选择器里消失。
              // 实测（2026-09-21）：修复后磁盘上 ghost-row 已关闭，保存一次就又被打开了。
              const repairedIds = Array.isArray(result.params?.repairedIds) ? result.params.repairedIds : []
              if (repairedIds.length > 0 && draft !== null) {
                // 草稿里的 `overrides` 是"显式**启用**"语义，所以关闭 = false。
                const nextOverrides = { ...draft.overrides }
                for (const rowId of repairedIds) nextOverrides[rowId] = false
                update({ overrides: nextOverrides }, { force: true })
              }
              await reload()
            } else {
              setFailed(true)
              setStatus(apiText(result, "msg.saveFailed"))
            }
          } catch {
            setFailed(true)
            setStatus(t("msg.saveFailed"))
          } finally {
            setBusy(false)
          }
        }

        const toggleRowExpanded = (id) =>
          setExpandedRows((previous) => {
            const next = { ...previous }
            if (next[id] === true) delete next[id]
            else next[id] = true
            return next
          })
        /** Hidden `<input type="file">` behind the 「导入」 button. */
        const fileInput = react.useRef(null)

        const entry = selected === "" ? undefined : entries[selected]
        const draft = entry === undefined ? null : entry.value

        /** 描述框：随内容长高，避免双语描述被单行截断。draft 在未选中助手时是 null，依赖项要先取出来。 */
        const descriptionRef = react.useRef(null)
        const draftDescription = draft === null ? "" : draft.description
        // 已保存的底子：用来提示"改了但还没保存"—— 行列表是按它渲染的。
        const savedMode =
          entry === undefined || entry === null || entry.saved === null || entry.saved === undefined
            ? null
            : entry.saved.mode
        react.useEffect(() => {
          const el = descriptionRef.current
          if (el === null || el === undefined) return
          el.style.height = "auto"
          el.style.height = String(Math.min(el.scrollHeight, 200)) + "px"
        }, [draftDescription, selected])

        const payload = entry === undefined ? null : entry.payload
        const editorReady = draft !== null && payload !== null
        const dirty = editorReady && !sameDraft(draft, entry.saved)

        /** Which assistants hold unsaved edits — the list marks them. */
        const dirtyIds = new Set()
        for (const item of list === null ? [] : list) {
          const held = entries[item.id]
          if (held !== undefined && !sameDraft(held.value, held.saved)) dirtyIds.add(item.id)
        }

        const describeError = (error) => String((error && error.message) || error)

        /**
         * Fetch one assistant into `entries`, keeping any unsaved draft it already has.
         *
         * `discard` is the explicit "throw my edits away" path (the reload button), and
         * `force` is "re-read even if this entry is already in memory". Neither is set by
         * ordinary switching: moving between assistants must never race a half-typed prompt.
         */
        const open = async (id, options) => {
          if (typeof id !== "string" || id === "") return
          const force = options !== null && typeof options === "object" && options.force === true
          const discard = options !== null && typeof options === "object" && options.discard === true
          const held = entries[id]
          if (force !== true && held !== undefined) return
          const result = await fetchState(id)
          if (result === null || result === undefined || result.ok !== true) {
            setFailed(true)
            setStatus(apiText(result, "msg.readFailed"))
            return
          }
          const fresh = draftOf(result)
          setEntries((previous) => {
            const before = previous[id]
            const keep = discard !== true && before !== undefined && !sameDraft(before.value, before.saved) ? before.value : fresh
            return { ...previous, [id]: { payload: result, saved: fresh, value: keep } }
          })
          setFailed(false)
        }

        /** Re-read the assistant list and force-reload the one it settles on. */
        const reload = async (preferId, options) => {
          const result = await fetchList()
          if (result === null || result === undefined || result.ok !== true) {
            setFailed(true)
            setStatus(apiText(result, "msg.readFailed"))
            return
          }
          const assistants = Array.isArray(result.assistants) ? result.assistants : []
          setList(assistants)
          const wanted =
            typeof preferId === "string" && preferId !== ""
              ? preferId
              : assistants.some((item) => item.id === selected)
                ? selected
                : assistants.length > 0
                  ? assistants[0].id
                  : ""
          setSelected(wanted)
          if (wanted === "") {
            setEntries({})
            return
          }
          await open(wanted, { force: true, discard: options !== null && typeof options === "object" && options.discard === true })
        }

        /**
         * Refresh the display names only.
         *
         * A save can rename an assistant but never changes ids, so the list needs a new
         * fetch while the selection, the payloads and every draft stay exactly as they are.
         */
        const refreshNames = async () => {
          const result = await fetchList()
          if (result !== null && result !== undefined && result.ok === true) {
            setList(Array.isArray(result.assistants) ? result.assistants : [])
          }
        }

        /**
         * Re-render when the shell's active language changes.
         *
         * `settings.section` no longer receives a namespace-bound `t` (the `locale:`
         * registration option was removed in 0.1.6-alpha.2), so this page translates from its
         * own dictionaries — and must therefore notice a language switch itself. The revision
         * counter is not read in render: bumping it is what re-runs {@link activeLanguage}.
         */
        const [, setLocaleRevision] = react.useState(0)
        react.useEffect(() => {
          const service = localeRef
          if (service === undefined || typeof service.subscribe !== "function") return undefined
          return service.subscribe(() => setLocaleRevision((value) => value + 1))
        }, [])

        react.useEffect(() => {
          let alive = true
          ;(async () => {
            setBusy(true)
            try {
              await reload("")
            } catch (error) {
              if (alive) {
                setFailed(true)
                setStatus(fillPlaceholders(t("status.detail"), { message: t("msg.readFailed"), detail: describeError(error) }))
              }
            } finally {
              if (alive) setBusy(false)
            }
          })()
          return () => {
            alive = false
          }
        }, [])

        /** Change one field of the selected assistant's draft. */
        const update = (patch, options) => {
          // ★ 忙碌期间**不接受**对草稿的修改（issue #6）。
          //
          // 为什么必须在这里拦：保存成功后（下面 `save()` 里）会用服务器归一化的结果
          // `value: normalized` **无条件**覆盖草稿。于是往返期间敲进去的字、翻过的行开关都会
          // 凭空消失，而页面还显示 "Saved" —— 用户丢的是手写的系统提示词。
          //
          // 拦在这一层而不是逐个控件加 `disabled`，是因为它一处覆盖**所有**草稿字段
          // （name / description / prompt / overrides），漏掉任何一个都会重新打开那条丢失路径。
          // 视觉上控件仍可点，但点了不会改状态，所以不会出现"开关翻过去又弹回来"这种骗人的反馈。
          //
          // `{ force: true }` 是给**内部**调用用的（例如「按本线修复」把结果折进草稿）：
          // 那不是用户输入，不受这条守护约束。
          if (busy === true && options?.force !== true) return
          setEntries((previous) => {
            const current = previous[selected]
            if (current === undefined) return previous
            return { ...previous, [selected]: { ...current, value: { ...current.value, ...patch } } }
          })
          setStatus("")
        }

        const pick = async (id) => {
          if (id === selected) return
          setSelected(id)
          setDeleteOpen(false)
          setAcknowledged(false)
          setStatus("")
          setBusy(true)
          try {
            await open(id)
          } catch (error) {
            setFailed(true)
            setStatus(fillPlaceholders(t("status.detail"), { message: t("msg.readFailed"), detail: describeError(error) }))
          } finally {
            setBusy(false)
          }
        }

        /** Create a new assistant, or duplicate the selected one. */
        const create = async (options) => {
          const from = options !== null && typeof options === "object" ? options.from : undefined
          const name =
            options !== null && typeof options === "object" && typeof options.name === "string"
              ? options.name.trim()
              : newName.trim()
          if (name === "") {
            setFailed(true)
            setStatus(t("msg.nameRequired"))
            return
          }
          setBusy(true)
          try {
            const result = await postJson(ROUTES.create, from === undefined ? { name } : { name, from })
            if (result !== null && result !== undefined && result.ok === true) {
              setNewName("")
              setFailed(false)
              setStatus(apiText(result, from === undefined ? "msg.created" : "msg.duplicated"))
              await reload(result.id)
            } else {
              setFailed(true)
              setStatus(apiText(result, "msg.createFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(fillPlaceholders(t("status.detail"), { message: t("msg.createFailed"), detail: describeError(error) }))
          } finally {
            setBusy(false)
          }
        }

        const duplicate = () => create({ from: draft.id, name: copyName(t("assistant.copyName"), draft.name || draft.id) })

        /**
         * Move the selected assistant one slot in the picker order.
         *
         * Reordering must not cost the user their edits, so this reloads with `discard: false`
         * (the default) and only the roster order changes.
         */
        const move = async (direction) => {
          setBusy(true)
          try {
            const result = await postJson(ROUTES.reorder, { id: draft.id, direction })
            if (result !== null && result !== undefined && result.ok === true) {
              setFailed(false)
              setStatus(apiText(result, "msg.reordered"))
              await reload(draft.id)
            } else {
              setFailed(true)
              setStatus(apiText(result, "msg.reorderFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(fillPlaceholders(t("status.detail"), { message: t("msg.reorderFailed"), detail: describe(error) }))
          } finally {
            setBusy(false)
          }
        }

        /** Download the prompt being edited (client-side only — the host is not involved). */
        /**
         * 把编辑器内容换回出厂提示词。
         *
         * 只改**草稿**，不写盘：这样"一键回到官方"既立刻可见，又可被「重新读取」撤销 ——
         * 与页面其余部分一样，一切改动都要点保存才落盘。
         */
        const resetPrompt = () => {
          const factory = typeof draft.factoryPrompt === "string" ? draft.factoryPrompt : ""
          if (factory === "") return
          update({ prompt: factory })
        }

        /** 把某个历史版本载入编辑器。与「恢复出厂」同一条纪律：只改草稿，保存前不落盘。 */
        const loadVersion = async () => {
          const picked = typeof draft.historyPick === "string" ? draft.historyPick : ""
          if (picked === "" || draft.id === undefined) return
          try {
            // 版本键是序号（时间戳会在同一毫秒内撞车 —— 单测就是那样抓到它的）。
            const response = await fetch(ROUTES.history + "?id=" + encodeURIComponent(draft.id) + "&n=" + encodeURIComponent(picked))
            const payload = await asJson(response)
            if (payload === null || payload.ok !== true) {
              setStatus(t("msg.loadFailed"))
              return
            }
            update({ prompt: payload.text })
          } catch (error) {
            setStatus(fillPlaceholders(t("status.detail"), { message: t("msg.loadFailed"), detail: describeError(error) }))
          }
        }

        const exportPrompt = () => {
          try {
            const blob = new Blob([draft.prompt], { type: "text/markdown;charset=utf-8" })
            const url = URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            link.download = fileNameFor(draft.name || draft.id) + ".prompt.md"
            document.body.appendChild(link)
            link.click()
            link.remove()
            setTimeout(() => URL.revokeObjectURL(url), 0)
            setFailed(false)
            setStatus(t("msg.exported"))
          } catch (error) {
            setFailed(true)
            setStatus(fillPlaceholders(t("status.detail"), { message: t("msg.exportFailed"), detail: describe(error) }))
          }
        }

        /**
         * Load a prompt file into the EDITOR, not onto disk.
         *
         * The imported text lands in the draft, so it goes through the same review-and-save
         * path (and the same `{{…}}` validation) as anything typed by hand — an import can
         * never silently publish a prompt the renderer would refuse.
         */
        const importPrompt = (event) => {
          const input = event !== null && event !== undefined ? event.target : undefined
          const file = input !== null && input !== undefined && input.files !== undefined ? input.files[0] : undefined
          // Reset so picking the same file twice in a row fires `change` again.
          if (input !== null && input !== undefined) input.value = ""
          if (file === undefined || file === null) return
          if (file.size > 1_000_000) {
            setFailed(true)
            setStatus(t("msg.importTooLarge"))
            return
          }
          const reader = new FileReader()
          reader.onload = () => {
            const text = typeof reader.result === "string" ? reader.result : ""
            if (text.trim() === "") {
              setFailed(true)
              setStatus(t("msg.importEmpty"))
              return
            }
            update({ prompt: text })
            setFailed(false)
            setStatus(t("msg.imported"))
          }
          reader.onerror = () => {
            setFailed(true)
            setStatus(t("msg.importFailed"))
          }
          reader.readAsText(file, "utf-8")
        }

        const remove = async (id) => {
          setBusy(true)
          try {
            const result = await postJson(ROUTES.delete, { id })
            if (result !== null && result !== undefined && result.ok === true) {
              setDeleteOpen(false)
              setAcknowledged(false)
              setFailed(false)
              setStatus(apiText(result, "msg.deleted"))
              setEntries((previous) => {
                const next = { ...previous }
                delete next[id]
                return next
              })
              await reload("")
            } else {
              setFailed(true)
              setStatus(apiText(result, "msg.deleteFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(fillPlaceholders(t("status.detail"), { message: t("msg.deleteFailed"), detail: describeError(error) }))
          } finally {
            setBusy(false)
          }
        }

        /**
         * Ask before deleting.
         *
         * With the shell's `RiskConfirmation` the user must tick an acknowledgement — it is an
         * irreversible loss of their own text. A shell without that atom gets the plain native
         * confirmation instead of losing the guardrail entirely.
         */
        const askDelete = () => {
          if (typeof A.RiskConfirmation === "function") {
            setAcknowledged(false)
            setDeleteOpen(true)
            return
          }
          const label = draft.name || draft.id
          if (typeof window !== "undefined" && window.confirm(copyName(t("delete.plainConfirm"), label))) remove(draft.id)
        }

        const pickMode = (mode) => {
          // Switching base mode keeps explicit row overrides: rows that exist in
          // the new mode keep their state, ids absent from it are ignored.
          update({ mode })
        }

        const save = async () => {
          setBusy(true)
          try {
            const result = await postJson(ROUTES.state, {
              id: draft.id,
              mode: draft.mode,
              overrides: draft.overrides,
              prompt: draft.prompt,
              name: draft.name,
              description: draft.description,
            })
            if (result !== null && result !== undefined && result.ok === true) {
              setFailed(false)
              setStatus(apiText(result, "msg.saved"))
              // The server normalises what it stores (trimmed name, recomputed overrides),
              // so the just-saved draft is replaced by what it actually wrote. Without this
              // the page would show 「已保存」 and 「未保存」 at the same time.
              const fresh = await fetchState(draft.id)
              if (fresh !== null && fresh !== undefined && fresh.ok === true) {
                const normalized = draftOf(fresh)
                setEntries((previous) => ({
                  ...previous,
                  [draft.id]: { payload: fresh, saved: normalized, value: normalized },
                }))
                await refreshNames()
              } else {
                await reload(draft.id, { discard: true })
              }
            } else {
              setFailed(true)
              setStatus(apiText(result, "msg.saveFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(fillPlaceholders(t("status.detail"), { message: t("msg.saveFailed"), detail: describeError(error) }))
          } finally {
            setBusy(false)
          }
        }

        const assistants = list === null ? [] : list
        const position = assistants.findIndex((item) => item.id === selected)
        const statusClass = failed
          ? "cpfe-status cpfe-err"
          : dirty
            ? "cpfe-status cpfe-dirty"
            : "cpfe-status cpfe-ok"
        const shown = dirty && status === "" ? t("msg.unsaved") : status

        // ── assistant list ────────────────────────────────────────────────────
        const assistantList = react.createElement(
          "section",
          null,
          react.createElement("h2", { className: "cpfe-h" }, t("assistant.heading")),
          react.createElement(SectionHint, {
                  id: "hint:assistant",
                  hint: t("assistant.short", t("assistant.hint")),
                  detail: t("assistant.hint"),
                  expanded: expandedRows,
                  onToggleExpand: toggleRowExpanded,
                  t: t,
                }),
          list === null
            ? react.createElement("p", { className: "cpfe-sub" }, t("assistant.loadingList"))
            : assistants.length === 0
              ? react.createElement("p", { className: "cpfe-sub" }, t("assistant.empty"))
              : react.createElement(
                  "div",
                  { className: "cpfe-pills cpfe-assistants" },
                  assistants.map((item) =>
                    react.createElement(
                      "span",
                      { key: item.id, className: "cpfe-pill-wrap" },
                      react.createElement(
                        A.Pill,
                        {
                          active: item.id === selected,
                          disabled: busy,
                          title: item.id,
                          onClick: () => pick(item.id),
                        },
                        item.name || item.id,
                      ),
                      dirtyIds.has(item.id)
                        ? react.createElement(A.Tag, { tone: "warning" }, t("msg.unsaved"))
                        : null,
                      typeof item.broken === "string" && item.broken !== ""
                        ? react.createElement(A.Tag, { tone: "danger" }, t("assistant.broken"))
                        : null,
                    ),
                  ),
                ),
          react.createElement(
            "div",
            { className: "cpfe-newrow" },
            react.createElement(A.Input, {
              className: "cpfe-newinput",
              value: newName,
              placeholder: t("assistant.newPlaceholder"),
              "aria-label": t("assistant.newPlaceholder"),
              onKeyDown: (event) => {
                if (event.key === "Enter") create()
              },
              onChange: (event) => {
                setNewName(event.target.value)
                setStatus("")
              },
            }),
            react.createElement(
              A.Button,
              {
                variant: "primary",
                icon: A.IconPlusOutline16 === undefined ? null : react.createElement(A.IconPlusOutline16),
                disabled: busy,
                onClick: () => create(),
              },
              busy ? t("btn.creating") : t("btn.create"),
            ),
          ),
          react.createElement("p", { className: "cpfe-note" }, t("msg.readOnlyHint")),
        )

        // ── editor ────────────────────────────────────────────────────────────
        const editorSections = editorReady
          ? [
              react.createElement(
                "section",
                { key: "name" },
                react.createElement("h2", { className: "cpfe-h" }, t("name.heading")),
                react.createElement(SectionHint, {
                  id: "hint:name",
                  hint: t("name.short", t("name.hint")),
                  detail: t("name.hint"),
                  expanded: expandedRows,
                  onToggleExpand: toggleRowExpanded,
                  t: t,
                }),
                react.createElement(A.Input, {
                  className: "cpfe-field",
                  value: draft.name,
                  placeholder: t("name.placeholder"),
                  "aria-label": t("name.heading"),
                  onChange: (event) => update({ name: event.target.value }),
                }),
                // 描述用 textarea 而不是单行 Input：shell 的组件里没有多行输入，而双语描述在单行框里
                // 会被截断（实测界面上只看到 "… / Ful"）。高度随内容自适应，样式沿用同一批语义变量。
                react.createElement("textarea", {
                  ref: descriptionRef,
                  className: "cpfe-field cpfe-desc",
                  value: draft.description,
                  rows: 2,
                  placeholder: t("name.descriptionPlaceholder"),
                  "aria-label": t("name.descriptionPlaceholder"),
                  onChange: (event) => update({ description: event.target.value }),
                }),
                react.createElement(
                  "div",
                  { className: "cpfe-actions" },
                  react.createElement(
                    A.Button,
                    {
                      variant: "outline",
                      size: "sm",
                      icon: A.IconChevronUpOutline14 === undefined ? null : react.createElement(A.IconChevronUpOutline14),
                      disabled: busy || position <= 0,
                      onClick: () => move("up"),
                    },
                    t("btn.moveUp"),
                  ),
                  react.createElement(
                    A.Button,
                    {
                      variant: "outline",
                      size: "sm",
                      icon: A.IconChevronDownOutline14 === undefined ? null : react.createElement(A.IconChevronDownOutline14),
                      disabled: busy || position === -1 || position >= assistants.length - 1,
                      onClick: () => move("down"),
                    },
                    t("btn.moveDown"),
                  ),
                  react.createElement(
                    A.Button,
                    {
                      variant: "outline",
                      size: "sm",
                      icon: A.IconCopyOutline16 === undefined ? null : react.createElement(A.IconCopyOutline16),
                      disabled: busy,
                      onClick: duplicate,
                    },
                    t("btn.duplicate"),
                  ),
                  react.createElement(
                    A.Button,
                    {
                      variant: "ghost",
                      size: "sm",
                      className: "cpfe-danger",
                      icon: A.IconTrashOutline16 === undefined ? null : react.createElement(A.IconTrashOutline16),
                      disabled: busy,
                      onClick: askDelete,
                    },
                    t("btn.delete"),
                  ),
                ),
              ),
              react.createElement(
                "section",
                { key: "mode" },
                react.createElement("h2", { className: "cpfe-h" }, t("mode.heading")),
                react.createElement(SectionHint, {
                  id: "hint:mode",
                  hint: t("mode.short", t("mode.hint")),
                  detail: t("mode.hint"),
                  expanded: expandedRows,
                  onToggleExpand: toggleRowExpanded,
                  t: t,
                }),
                react.createElement(
                  "div",
                  { className: "cpfe-pills" },
                  payload.modes.map((mode) =>
                    react.createElement(
                      A.Pill,
                      { key: mode.id, active: draft.mode === mode.id, onClick: () => pickMode(mode.id) },
                      t("base." + mode.id + ".label", mode.label),
                    ),
                  ),
                ),
                react.createElement(
                  "p",
                  { className: "cpfe-note" },
                  payload.modes.reduce((note, mode) => (mode.id === draft.mode ? t("base." + mode.id + ".note", mode.note) : note), ""),
                ),
                // 底子改过但还没保存时明说一句：行列表是按**已保存**的组成渲染的，审阅把它记成了"点了没反应"。
                draft.mode !== savedMode
                  ? react.createElement(
                      "p",
                      { className: "cpfe-note cpfe-base-pending" },
                      fillPlaceholders(t("mode.pendingRows"), { mode: t("base." + draft.mode + ".label", draft.mode) }),
                    )
                  : null,
              ),
              react.createElement(
                "section",
                { key: "rows" },
                react.createElement("h2", { className: "cpfe-h" }, t("rows.heading")),
                react.createElement(SectionHint, {
                  id: "hint:rows",
                  hint: t("rows.short", t("rows.hint")),
                  detail: t("rows.hint"),
                  expanded: expandedRows,
                  onToggleExpand: toggleRowExpanded,
                  t: t,
                }),
                react.createElement(RowList, {
                  expanded: expandedRows,
                  onToggleExpand: toggleRowExpanded,
                  rows: payload.rows,
                  overrides: draft.overrides,
                  onToggle: (id, next) => update({ overrides: { ...draft.overrides, [id]: next } }),
                  depth: 0,
                  t: t,
                }),
              ),
              react.createElement(
                "section",
                { key: "prompt" },
                react.createElement(
                  "div",
                  { className: "cpfe-sec-head" },
                  react.createElement("h2", { className: "cpfe-h" }, t("prompt.heading")),
                  react.createElement(
                    "div",
                    { className: "cpfe-actions" },
                    react.createElement(
                      A.Button,
                      {
                        variant: "outline",
                        size: "sm",
                        icon:
                          A.IconDownloadOutline16 === undefined ? null : react.createElement(A.IconDownloadOutline16),
                        disabled: busy || draft.prompt === "",
                        onClick: exportPrompt,
                      },
                      t("btn.export"),
                    ),
                    react.createElement(
                      A.Button,
                      {
                        variant: "outline",
                        size: "sm",
                        disabled: busy,
                        onClick: () => {
                          const node = fileInput.current
                          if (node !== null && node !== undefined) node.click()
                        },
                      },
                      t("btn.import"),
                    ),
                    react.createElement(
                      A.Button,
                      {
                        variant: "outline",
                        size: "sm",
                        disabled:
                          busy ||
                          typeof draft.factoryPrompt !== "string" ||
                          draft.factoryPrompt === "" ||
                          draft.prompt === draft.factoryPrompt,
                        onClick: resetPrompt,
                        title: t("btn.resetHint"),
                      },
                      t("btn.reset"),
                    ),
                    // The picker itself is invisible; the button above is the affordance. The
                    // file is read locally and lands in the editor, never straight on disk.
                    react.createElement("input", {
                      ref: fileInput,
                      type: "file",
                      accept: ".md,.markdown,.txt,text/*",
                      style: { display: "none" },
                      onChange: importPrompt,
                      "aria-hidden": "true",
                      tabIndex: -1,
                    }),
                  ),
                ),
                react.createElement(SectionHint, {
                  id: "hint:prompt",
                  hint: t("prompt.short", t("prompt.hint")),
                  detail: t("prompt.hint"),
                  expanded: expandedRows,
                  onToggleExpand: toggleRowExpanded,
                  t: t,
                }),
                react.createElement("textarea", {
                  className: "cpfe-editor",
                  value: draft.prompt,
                  spellCheck: false,
                  // 忙碌期间只读（issue #6）：`update()` 那一层已经会丢弃改动，这里再给一个
                  // **看得见**的信号 —— 否则用户会以为自己在编辑，而字根本没进去。
                  // 用 readOnly 而不是 disabled：仍然可以选中/复制，只是改不了。
                  readOnly: busy === true,
                  "aria-busy": busy === true,
                  "aria-label": t("prompt.heading"),
                  onChange: (event) => update({ prompt: event.target.value }),
                }),
                // 改动历史：谁在什么时候改过。之前这里只有"当前文本"，所以会话内的工具
                // （或手工编辑）改掉提示词时，用户既看不见也回不去。
                draft.history.length === 0
                  ? null
                  : react.createElement(
                      "div",
                      { className: "cpfe-history" },
                      react.createElement("span", { className: "cpfe-history-label" }, t("history.label")),
                      react.createElement(
                        "select",
                        {
                          value: draft.historyPick,
                          "aria-label": t("history.label"),
                          onChange: (event) => update({ historyPick: event.target.value }),
                        },
                        react.createElement("option", { value: "" }, t("history.pick")),
                        ...draft.history.map((entry) =>
                          react.createElement(
                            "option",
                            { key: String(entry.n), value: String(entry.n) },
                            formatWhen(entry.at) + " · " + t("history.by." + entry.by) + " · " + String(entry.bytes) + " B",
                          ),
                        ),
                      ),
                      react.createElement(
                        A.Button,
                        {
                          variant: "outline",
                          size: "sm",
                          disabled: busy || draft.historyPick === "",
                          onClick: loadVersion,
                        },
                        t("history.load"),
                      ),
                      react.createElement("span", { className: "cpfe-history-hint" }, t("history.hint")),
                    ),
              ),
            ]
          : []

        return react.createElement(
          "div",
          { className: "cpfe" },
          assistantList,
          react.createElement("p", { className: "cpfe-note" }, t("assistant.switchHint")),
          // 配了却不生效的项：主动点名，而不是让用户对着"我明明写了"发呆。
          // `draft` 在没选中任何助手时是 null（列表还没加载完 / 一个都没有）—— 这里必须先守卫，
          // 否则整块设置页崩掉（实测：浏览器验收当场报 Cannot read properties of null）。
          draft === null || draft.warnings === undefined || draft.warnings.length === 0
            ? null
            : react.createElement(
                "div",
                { className: "cpfe-warns" },
                ...draft.warnings.map((code) =>
                  react.createElement(
                    "div",
                    { key: code, className: "cpfe-warn-row" },
                    react.createElement("p", { className: "cpfe-warn" }, "⚠ " + t("warn." + code)),
                    // 本线无法解析的行可以一键修（只关掉那几行；用户创建它的那个版本可能早于播种改为派生的版本）。
                    code === "unresolvableRows"
                      ? react.createElement(
                          A.Button,
                          { disabled: busy, onClick: repairRowsNow },
                          t("btn.repair"),
                        )
                      : null,
                  ),
                ),
              ),
          ...editorSections,
          react.createElement(
            "div",
            { className: "cpfe-bar" },
            react.createElement(
              A.Button,
              {
                variant: "primary",
                icon: A.IconCheckOutline14 === undefined ? null : react.createElement(A.IconCheckOutline14),
                disabled: busy || editorReady === false || dirty === false,
                onClick: save,
              },
              busy ? t("btn.saving") : t("btn.save"),
            ),
            react.createElement(
              A.Button,
              {
                variant: "outline",
                icon: A.IconRefreshOutline16 === undefined ? null : react.createElement(A.IconRefreshOutline16),
                disabled: busy || editorReady === false,
                // Explicitly destructive of the local draft, so it says so while there is
                // one: switching assistants never discards edits, and this button is the
                // one place that does.
                onClick: () => reload(selected, { discard: true }),
              },
              dirty ? t("btn.reloadDiscard") : t("btn.reload"),
            ),
            react.createElement("span", { className: statusClass }, shown),
            react.createElement(
              "span",
              { className: "cpfe-meta-line" },
              // 让用户能自己判断装到的是哪一版：pnpm 的发布冷却期会让"不钉版本"的安装落到旧版
              // （实测：干净机器上按名安装装到 1.0.1，而 latest 是 1.9.x）。
              react.createElement(
                "span",
                { className: "cpfe-version", title: t("meta.versionHint") },
                // payload 在"还没读到任何助手"时是 null —— 页脚仍然会渲染，所以必须判空
                // （同一条错误这一轮被浏览器验收抓到过三次，单元测试一次都看不到）。
                payload === null ? "" : t("meta.version") + " v" + String(payload.version ?? "?"),
              ),
              react.createElement("span", { className: "cpfe-path" }, editorReady ? payload.compositionPath : ""),
            ),
          ),
          // The confirmation is a portal: rendering it here keeps every piece of this page's
          // state in one component.
          typeof A.RiskConfirmation === "function" && editorReady
            ? react.createElement(A.RiskConfirmation, {
                open: deleteOpen,
                title: t("delete.title"),
                description: fillPlaceholders(t("delete.description"), { id: draft.id }),
                acknowledgeLabel: t("delete.acknowledge"),
                cancelLabel: t("btn.cancel"),
                closeLabel: t("delete.close"),
                confirmLabel: t("delete.confirm"),
                acknowledged,
                disabled: busy,
                onAcknowledgedChange: setAcknowledged,
                onCancel: () => {
                  setDeleteOpen(false)
                  setAcknowledged(false)
                },
                onConfirm: () => {
                  if (acknowledged) remove(draft.id)
                },
              })
            : null,
        )
      }

      function apply(ctx) {
        try {
          ensureStyles()
          const locale = ctx.get("locale")
          localeRef = locale
          // Bound once so the nav label thunk can translate at projection time.
          const navT = locale === undefined ? null : locale.bind(NS)
          if (locale !== undefined) {
            ctx.effect(() => {
              try {
                return locale.register(NS, TRANSLATIONS)
              } catch (error) {
                // The service keeps ONE dictionary per (namespace, locale), so a second apply
                // of this bundle — which is what an HMR swap looks like — is refused. Aborting
                // apply() here would cost the page its slot registration, and the dictionaries
                // it wanted are inlined in this file anyway: report and carry on.
                console.warn("dsh-custom-mode: 词典注册被拒，改用内置词典：" + describe(error))
                return () => {}
              }
            }, "custom-mode: dictionaries")
            // Self-check. A namespace this bundle just registered must answer its own key; if
            // the shell cannot answer, say so in the console instead of leaving a page of raw
            // keys (`assistant.heading`) for the user to discover. translate() falls back to
            // the inlined copy, so the page renders correctly either way.
            if (navT !== null && navT("nav") === "nav") {
              console.warn("dsh-custom-mode: 词典注册后宿主仍查不到 " + NS + "，页面已改用内置词典。")
            }
          }
          const slots = ctx.get("slots")
          if (slots === undefined) {
            console.warn("dsh-custom-mode: slots service unavailable; settings page not registered")
            return
          }
          slots.inject("settings.section", () => {
            // `locale: NS` is the shipped contract: the shell then hands the
            // component a bound `t` in props.
            //
            // The nav entry keeps the localized default rather than following the
            // selected assistant's name: with several assistants there is no single
            // name an entry called 「自定义模式」 could honestly show.
            return slots.register(
              {
                name: "settings.section",
                id: "custom-system-prompt",
                order: 21,
                label: () => translate("nav", undefined, navT === null ? undefined : navT),
                locale: NS,
              },
              CustomModeSection,
            )
          })
        } catch (error) {
          console.error("dsh-custom-mode: apply() failed", error)
        }
      }

      // Declared like every shipped settings-section plugin: the registry guards
      // service reads, and the settings shell owns the target slot.
      const inject = ["slots", "locale"]

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
} catch (error) {
  // Never take the page down with us. The settings page simply will not appear.
  try {
    console.error("dsh-custom-mode: browser half failed to register", error)
  } catch {
    /* logging is best-effort */
  }
}
