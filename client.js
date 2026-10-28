/**
 * Browser half: 「自定义模式」settings page — the assistant manager.
 *
 * Blocks:
 *   0. 助手        — which assistant is selected.
 *   1. 当前助手    — prompt, name, five live base modes, plugin switches.
 *   2. 新建助手    — Coding / Writing / Chat stay selectable. The official
 *                  modes are shown beside them, and only Standard is lit.
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
       * Copy for this page, generated from locales.mjs (single source of
       * truth, checked for key parity by test/locales.test.mjs).
       */
      const ZH = {
        "update.heading": "插件更新",
        "update.orphanHint": "以下助手已不在当前列表，但本页仍保留其未保存草稿，因此暂不能离页。",
        "update.orphanName": "{name}（ID：{id}）",
        "update.orphanView": "查看并保留草稿",
        "update.orphanHide": "收起草稿",
        "update.orphanCopy": "下方包含完整提示词、名称、描述、模式和覆盖项，可选中复制到本地文件保留。放弃仅移除本页内存草稿，不修改磁盘文件。",
        "update.orphanDiscard": "放弃此草稿…",
        "update.orphanConfirm": "确认放弃“{name}”（ID：{id}）的未保存草稿？请先复制保留需要的内容。放弃后无法从本页恢复；磁盘文件不会改动。",
        "update.orphanAcknowledge": "我已保留需要的内容，确认放弃后无法从本页恢复。",
        "update.orphanChanged": "草稿或助手列表已变化，未放弃任何内容。请重新查看并确认。",
        "update.orphanDiscarded": "已放弃所确认的本页草稿；磁盘文件未改动。",
        "update.running": "运行中的插件版本：{version}",
        "update.unknown": "未知",
        "update.check": "检查更新",
        "update.checking": "正在检查…",
        "update.inPlugins": "在插件管理中更新",
        "update.details": "打开插件详情",
        "update.guide": "更新指引",
        "update.idle": "仅在点击检查时查询宿主配置的包仓库；不会自动安装。",
        "update.unavailable": "当前连接未提供原生版本检查能力。可打开插件详情或查看更新指引。",
        "update.permission": "此操作缺少宿主授权，或权限服务暂不可用。",
        "update.updatePermission": "可以查看版本，但当前连接没有更新权限。",
        "update.available": "可用更新：{version}。安装由官方插件管理处理。",
        "update.current": "此次检查未返回更高版本。",
        "update.filtered": "发现较新版本，但没有符合官方默认条件的稳定兼容版本。",
        "update.partial": "结果未覆盖全部新版本，暂未找到可推荐的更新。",
        "update.omitted": "另有 {count} 个较新版本未列出。",
        "update.disk": "磁盘安装版本：{version}；它可能尚未在运行中加载。",
        "update.managed": "此安装无法使用原生包仓库更新，请通过原来源或插件详情管理；不会自动切换来源。",
        "update.notFound": "宿主插件列表中没有找到此插件，无法确认更新。",
        "update.network": "宿主查询包仓库失败，请稍后重试；尚不能确认更新状态。",
        "update.refused": "宿主未提供可用的版本列表，尚不能确认更新状态。",
        "update.failed": "未能完成更新检查，请重试或打开插件详情查看。",
        "update.finishOperation": "请等待当前操作完成后再离开此页。",
        "update.finishRecovery": "请先完成重试读取或重试生效，再离开此页。",
        "update.saveDrafts": "请先保存或主动放弃所有助手草稿及未提交的新建输入，再离开此页。",
        "update.navigationFailed": "未能打开插件详情；草稿已保留，可稍后重试。",
        "create.nextStep": "创建后可在上方继续编辑并保存；使用时，在新会话的模式菜单选择它。",
        "btn.retryRead": "重试读取",
        "btn.retrySync": "重试生效",
        "api.savedButSyncFailed": "文件已保存，但这些助手尚未生效：{ids}。请点「重试生效」，无需重复原操作。",
        "api.syncFailed": "这些助手仍未生效：{ids}。请重试；仍失败时查看宿主日志。",
        "api.synchronized": "配置已生效。新会话请从模式菜单选择助手。",
        "api.recoveryRequired": "助手文件需要恢复：{path}。请保留目录中的备份，并查看宿主日志中的恢复说明。",
        "msg.completedReadFailed": "{result} 页面刷新失败。请点「重试读取」，无需重复原操作。",
        "msg.synchronized": "配置已生效。",
        "msg.syncFailed": "重新应用配置失败，请重试。",
        "msg.loaded": "已载入到编辑器。尚未保存。",
        "status.reading": "正在读取…",
        "status.saving": "正在保存…",
        "status.creating": "正在创建助手…",
        "status.deleting": "正在删除助手…",
        "status.reordering": "正在保存顺序…",
        "status.repairing": "正在修复…",
        "status.importing": "正在读取导入文件…",
        "status.synchronizing": "正在应用配置…",
        "nav": "自定义模式",
        "assistant.heading": "助手",
        "assistant.hint": "选择要编辑的助手。每位助手独立保存系统提示词、基础模式和插件开关。",
        "posture.hint": "选择起步姿态并命名，再点「新增助手」。",
        "tree.posture": "起步",
        "tree.base": "初始基础模式",
        "tree.baseLocked": "新建助手从官方标准模式起步。建好后，可在「当前助手」调整基础模式。",
        "posture.develop.label": "开发",
        "posture.develop.note": "官方标准模式，工具按出厂。",
        "posture.write.label": "写作",
        "posture.write.note": "官方标准模式。终端关闭，文件读写打开。",
        "posture.chat.label": "聊天",
        "posture.chat.note": "官方标准模式。文件和终端关闭。",
        "editor.heading": "当前助手",
        "editor.hint": "正在编辑「{name}」。这里的选择只决定编辑对象；新会话请从模式菜单选择助手。",
        "assistant.empty": "还没有助手，用下面的输入框新建一个。",
        "assistant.loadingList": "正在读取助手列表…",
        "assistant.newPlaceholder": "新助手的名字（例如：写作助手）",
        "assistant.copyName": "「{name}」副本",
        "assistant.broken": "本机无法启动",
        "assistant.brokenRows": "{count} 行在本机不可用",
        "assistant.brokenHint": "此模式在本机无法启动，不会出现在新会话菜单里。点「按本线修复」只关闭那些行。",
        "assistant.switchHint": "切换助手保留各自的未保存草稿；列表中的「未保存」标记即为此。",
        "btn.create": "新增助手",
        "create.heading": "新建助手",
        "btn.creating": "创建中…",
        "btn.duplicate": "复制",
        "btn.moveUp": "上移",
        "btn.moveDown": "下移",
        "btn.import": "导入",
        "btn.export": "导出",
        "btn.reset": "恢复出厂",
        "btn.resetHint": "把编辑器换回此助手新建时保存的提示词。只改草稿，保存后才写入。",
        "btn.delete": "删除",
        "btn.cancel": "取消",
        "msg.created": "已创建。可继续编辑；使用时请在新会话的模式菜单选择它。",
        "msg.duplicated": "已复制。两份配置彼此独立。",
        "msg.deleted": "已删除。",
        "msg.createFailed": "创建失败",
        "msg.deleteFailed": "删除失败",
        "msg.nameRequired": "请先给新助手起个名字。",
        "msg.readOnlyHint": "仅管理本插件创建的助手；手写 preset 不计入，也不会被改写。",
        "msg.reordered": "顺序已保存。新会话的模式菜单按此排列。",
        "msg.reorderFailed": "调整顺序失败",
        "msg.imported": "已导入到编辑器。尚未保存。",
        "msg.importFailed": "导入失败",
        "api.badDirection": "未知的排序方向：{direction}",
        "api.unknownAssistant": "找不到助手「{id}」。此页只管理本插件创建的助手。",
        "api.alreadyFirst": "「{name}」已经在最前面。",
        "api.alreadyLast": "「{name}」已经在最后面。",
        "api.badVariableName": "变量 {variable} 不合法。名字用小写字母、数字和下划线，且以字母开头。",
        "api.unknownVariable": "{variable} 不能使用。可用：{known}。",
        "mode.unavailable": "本机读不到出厂组成，基础模式暂不能切换。",
        "rows.unavailable": "本机读不到出厂组成，插件开关暂不能改。磁盘上的现有设置仍然有效。",
        "mode.pendingRows": "基础模式已改为「{mode}」。保存后，工具底换成这套官方预设。",
        "aria.expand": "展开详情",
        "aria.collapse": "收起详情",
        "detail.id": "行 id",
        "detail.hostReason": "平台原始信息：",
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
        "meta.versionHint": "未钉版本时，可能装到较旧的发布。要换版本，按 README 钉版本重装，然后重启。",
        "api.saved": "已保存（{name}，{mode}）。下一步组装时会重读已保存的提示词。",
        "api.conflict": "磁盘上的提示词已经变了，这次没有写入。先重新读取，再决定要不要覆盖。",
        "api.savedWithExclusiveRows": "已保存（{name}，{mode}）。已关闭不能同时启用的行：{rows}。",
        "api.created": "已创建「{name}」。可继续编辑；使用时请在新会话的模式菜单选择它。",
        "api.savedPrompt": "已保存系统提示词（{name}）。下一步组装时会重读这个文件。",
        "api.duplicated": "已从「{from}」复制。两份互不影响。",
        "api.deleted": "已删除「{name}」。正在使用它的会话不受影响。",
        "api.reordered": "顺序已保存。新会话的模式菜单按此排列。",
        "api.nameRequired": "请先给新助手起个名字。",
        "api.postureUnknown": "没有这个起步：{posture}。",
        "api.posturePromptMissing": "读不到「{posture}」的起步提示词。",
        "api.nameTooLong": "名字太长了（上限 {max} 个字符）。",
        "api.descriptionTooLong": "描述太长了（上限 {max} 个字符）。",
        "api.promptEmpty": "不能保存空的系统提示词。",
        "api.badMode": "未知的基础模式：{mode}",
        "api.dirExists": "目录已存在，请换一个名字：{path}",
        "api.compositionMissing": "找不到组成文件：{path}",
        "api.writeFailed": "写入失败：{detail}",
        "api.promptWriteFailed": "写入提示词失败：{detail}",
        "api.renderFailed": "生成组成文件失败：{detail}",
        "api.selfCheckFailed": "生成结果自检失败，已放弃写入：{detail}",
        "api.internalError": "宿主内部错误：{detail}",
        "api.bodyTooLarge": "请求体过大（上限 {max} 字节）",
        "api.repairNotNeeded": "没有需要修复的行。",
        "api.repaired": "已关闭 {count} 个本机无法启动的行（{ids}）。",
        "api.badAssistantId": "助手标识不合法：{id}（只能用 a-z、0-9 与连字符）",
        "api.seedFailed": "复制模式模板失败：{detail}",
        "api.metaWriteFailed": "写入 preset.yml 失败：{detail}",
        "api.promptReadFailed": "读取提示词失败：{detail}",
        "api.noRemoveApi": "当前版本无法删除助手。",
        "api.noDirectory": "删除失败：磁盘上已没有这个目录。刷新后再试。",
        "api.deleteFailed": "删除失败：{detail}",
        "api.versionMissing": "找不到这个版本（历史可能已被上限裁剪）。",
        "api.badJson": "请求体不是合法 JSON",
        "api.savedPromptOnly": "已保存系统提示词。基础模式和插件开关未改。",
        "api.baseCompositionUnavailable": "读不到基础模式「{mode}」的出厂组成。开关未改。系统提示词可以单独保存。",
        "warn.approvalGateMissing": "当前版本没有审批事件。会话内改写提示词不会请求确认。",
        "warn.unresolvableRows": "有的行在本机无法启动，此模式不会出现在新会话菜单里。点「按本线修复」只关闭那些行。",
        "warn.presetBroken": "此模式无法启动，不会出现在新会话菜单里。点「按本线修复」。原因见下一行。",
        "warn.badPromptVariable": "提示词里有不可用的变量。改掉后再保存，否则此模式的请求会失败。",
        "warn.duplicateRowIds": "组成文件里有重复的行 id。开关只作用于第一处。",
        "warn.predicateFailed": "有一行的平台条件无法计算，已按关闭处理。",
        "warn.exclusiveRowsActive": "两套终端不能同时打开，否则此模式无法启动。保存时会关掉其中一套。",
        "warn.baseCompositionUnavailable": "读不到出厂组成。基础模式和插件开关暂不能改。系统提示词仍可保存。",
        "warn.personaOffWithPrompt": "「身份」已关闭，这段提示词不会生效。",
        "warn.toolOff": "custom_prompt 已关闭。会话里不能改提示词，只能在此页改。",
        "warn.noDescription": "没有描述时，模式菜单显示「暂无描述」。",
        "warn.noName": "没有名字时，模式菜单显示目录 id。",
        "history.label": "改动历史",
        "history.pick": "选择版本…",
        "history.load": "载入",
        "history.hint": "载入只改草稿。保存后才写入。",
        "history.by.settings": "此页保存",
        "history.by.external": "外部改动",
        "msg.loadFailed": "载入这一版失败",
        "msg.importEmpty": "这个文件是空的。",
        "msg.importTooLarge": "文件太大（上限 1MB）。",
        "msg.exported": "已导出为文件。",
        "msg.exportFailed": "导出失败",
        "delete.title": "删除「{name}」？",
        "delete.description": "将删除此助手的目录和系统提示词，不能撤销。正在使用它的会话不受影响。",
        "delete.acknowledge": "我知道提示词会被删除",
        "delete.confirm": "删除",
        "delete.close": "关闭",
        "delete.plainConfirm": "删除「{name}」？不能撤销。",
        "name.heading": "名称",
        "name.hint": "显示在模式菜单里。内部标识不变。",
        "name.placeholder": "自定义模式",
        "name.descriptionPlaceholder": "描述，显示在模式菜单里，可留空",
        "mode.heading": "基础模式",
        "mode.hint": "五档都可以点。改的是当前这位助手。提示词仍以本页为准。",
        "rows.heading": "插件开关",
        "rows.filterPlaceholder": "按名称或 id 筛选",
        "cap.heading": "插件开关",
        "cap.expand": "显示插件开关",
        "cap.collapse": "隐藏插件开关",
        "cap.hint": "关闭的行，这个助手不会使用。",
        "rows.hint": "关闭的行，这个助手不会使用。",
        "prompt.heading": "系统提示词",
        "prompt.hint": "保存后，下一步组装模型输入时重读这个文件。",
        "status.enabled": "已启用",
        "status.disabled": "已停用",
        "status.changed": "已改",
        "tag.essential": "核心",
        "tag.followPlatform": "随平台",
        "btn.save": "保存",
        "btn.saving": "保存中…",
        "btn.reload": "重新读取",
        "btn.reloadDiscard": "放弃修改并重新读取",
        "btn.reloadConfirm": "放弃未保存的修改并重新读取？",
        "msg.unsaved": "有未保存的修改",
        "msg.readFailed": "读取失败",
        "msg.saveFailed": "保存失败",
        "msg.saved": "已保存。下一步组装时会重读这个文件。",
        "status.detail": "{message}：{detail}",
        "row.persona.label": "身份（系统提示词）",
        "row.persona.note": "关闭后，此提示词不会生效。",
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
        "row.planning.note": "关闭后，计划能力一并去掉。",
        "row.plan-mode.label": "计划模式实现",
        "row.compaction.label": "上下文压缩（分组）",
        "row.compaction.note": "含 isolate realm",
        "row.compaction-basic.label": "基础压缩",
        "row.command-compact.label": "/compact 命令",
        "row.tool-result-pruner.label": "工具结果裁剪",
        "row.delegation.label": "委派与工作流（分组）",
        "row.delegation.note": "关闭后，子代理和工作流一并去掉。",
        "row.tool-subagent.label": "子代理（spawn）",
        "row.tool-subagent-fork.label": "子代理（fork）",
        "row.tool-subagent-control.label": "子代理控制",
        "row.tool-subagent-list-agents.label": "列出子代理",
        "row.tool-subagent-codex.label": "Codex 子代理",
        "row.tool-subagent-codex.note": "需要先安装对应 Bundle 才能用；出厂状态见「详情」",
        "row.tool-subagent-claude-code.label": "Claude Code 子代理",
        "row.tool-subagent-claude-code.note": "需要先安装对应 Bundle 才能用；出厂状态见「详情」",
        "row.time-context.label": "时间上下文（模型看得到时间）",
        "row.time-context.note": "在部分步骤附上当前时间。",
        "row.tool-schedule.label": "定时提醒工具",
        "row.tool-schedule.note": "让 agent 创建/列出/修改/删除持久提醒；存储与投递由宿主的 schedule 服务负责",
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
        "row.tool-plugin-market.label": "插件市场检索",
        "row.tool-plugin-market.note": "发现插件；安装与启停仍由插件管理工具负责",
        "row.tool-plugin-manager.label": "插件管理（安装 / 启停）",
        "row.tool-plugin-manager.note": "供模型安装或开关插件。",
        "row.tool-presentation.label": "PTC 工具呈现",
        "row.tool-executor-ptc.label": "PTC 程序执行器",
        "row.tool-executor-ptc.note": "通过 run_code 执行程序并调用工具，同时向模型提供工具 SDK。",
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
        "base.standard.note": "出厂的完整工具集。",
        "base.ptc.label": "PTC 模式",
        "base.ptc.note": "标准模式，另开 PTC 工具呈现。",
        "base.minimal.label": "极简模式",
        "base.minimal.note": "只有 Shell 与终端。提示词仍以本页为准。",
        "base.cordis.label": "创造模式",
        "base.cordis.note": "标准模式，另开 Cordis 运行时工具。",
        "base.all.label": "全部出厂行",
        "base.all.note": "四套官方预设的行合在一处，均可开关。"
      }

      const EN = {
        "update.heading": "Plugin updates",
        "update.orphanHint": "These assistants left the current list, but this page still holds their unsaved drafts. Resolve them before leaving.",
        "update.orphanName": "{name} (ID: {id})",
        "update.orphanView": "View and keep draft",
        "update.orphanHide": "Hide draft",
        "update.orphanCopy": "The text below includes the full prompt, name, description, mode and overrides. Select and copy it to a local file to keep it. Discarding only removes this page's in-memory draft; files on disk are unchanged.",
        "update.orphanDiscard": "Discard this draft…",
        "update.orphanConfirm": "Discard the unsaved draft for \"{name}\" (ID: {id})? First copy any content you need to keep. This page cannot recover it after discarding; files on disk will remain unchanged.",
        "update.orphanAcknowledge": "I have kept the content I need and understand this page cannot recover the discarded draft.",
        "update.orphanChanged": "The draft or assistant list changed. Nothing was discarded. Review it again before confirming.",
        "update.orphanDiscarded": "The confirmed draft was discarded from this page; files on disk are unchanged.",
        "update.running": "Running plugin version: {version}",
        "update.unknown": "unknown",
        "update.check": "Check for updates",
        "update.checking": "Checking…",
        "update.inPlugins": "Update in Plugins",
        "update.details": "Open plugin details",
        "update.guide": "Update guide",
        "update.idle": "Only a click checks the registries configured by the host; installation is never automatic.",
        "update.unavailable": "This connection does not offer native version checks. Open plugin details or the update guide.",
        "update.permission": "Host permission is missing for this action, or the access service is unavailable.",
        "update.updatePermission": "You can view versions, but this connection does not have update permission.",
        "update.available": "Update available: {version}. Official plugin management handles installation.",
        "update.current": "This check returned no newer releases.",
        "update.filtered": "Newer releases exist, but none meet the official default conditions for a stable compatible version.",
        "update.partial": "The result omits some newer releases; no recommended update was found.",
        "update.omitted": "{count} additional newer releases were omitted.",
        "update.disk": "Installed on disk: {version}; this version may not be loaded in the running host yet.",
        "update.managed": "Manage this installation through its original source or plugin details; it cannot use this native registry update path. The source will not be changed automatically.",
        "update.notFound": "The host did not list this plugin, so its update status could not be determined.",
        "update.network": "The host could not query the registry. Try again later; update status is unknown.",
        "update.refused": "The host did not provide a usable version list; update status is unknown.",
        "update.failed": "The update check could not finish. Retry or open plugin details.",
        "update.finishOperation": "Wait for the current operation to finish before leaving this page.",
        "update.finishRecovery": "Complete Retry refresh or Retry activation before leaving this page.",
        "update.saveDrafts": "Save or explicitly discard all assistant drafts and unsubmitted new-assistant input before leaving this page.",
        "update.navigationFailed": "Plugin details could not open. Your drafts are preserved; try again later.",
        "create.nextStep": "After creating, edit and save above. To use the assistant, choose it in the mode menu for a new session.",
        "btn.retryRead": "Retry refresh",
        "btn.retrySync": "Retry activation",
        "api.savedButSyncFailed": "Files are saved, but these assistants are not active yet: {ids}. Select Retry activation; you do not need to repeat the original action.",
        "api.syncFailed": "These assistants are still not active: {ids}. Retry, then check the host log if the problem continues.",
        "api.synchronized": "Configuration is active. Choose an assistant in the mode menu for a new session.",
        "api.recoveryRequired": "Assistant files need recovery: {path}. Keep the backups in that directory and check the host log for recovery details.",
        "msg.completedReadFailed": "{result} The page could not refresh. Select Retry refresh; do not repeat the original action.",
        "msg.synchronized": "Configuration is active.",
        "msg.syncFailed": "Could not apply the configuration. Please retry.",
        "msg.loaded": "Loaded into the editor. Not saved yet.",
        "status.reading": "Reading…",
        "status.saving": "Saving…",
        "status.creating": "Creating assistant…",
        "status.deleting": "Deleting assistant…",
        "status.reordering": "Saving order…",
        "status.repairing": "Repairing…",
        "status.importing": "Reading import file…",
        "status.synchronizing": "Applying configuration…",
        "nav": "Custom mode",
        "assistant.heading": "Assistants",
        "assistant.hint": "Choose an assistant to edit. Each keeps its own system prompt, base mode and plugin switches.",
        "posture.hint": "Choose a starting posture and a name, then select New assistant.",
        "tree.posture": "Starter",
        "tree.base": "Starting base mode",
        "tree.baseLocked": "New assistants start on the official Standard mode. You can change the base mode under This assistant after creating one.",
        "posture.develop.label": "Coding",
        "posture.develop.note": "Official Standard mode, tools as shipped.",
        "posture.write.label": "Writing",
        "posture.write.note": "Official Standard mode. Terminal off, file access on.",
        "posture.chat.label": "Chat",
        "posture.chat.note": "Official Standard mode. Files and terminal off.",
        "editor.heading": "This assistant",
        "editor.hint": "Editing {name}. This selection controls what you edit here; choose an assistant in the mode menu when starting a new session.",
        "assistant.empty": "No assistants yet — create one with the field below.",
        "assistant.loadingList": "Loading assistants…",
        "assistant.newPlaceholder": "Name of the new assistant (e.g. Writing assistant)",
        "assistant.copyName": "{name} (copy)",
        "assistant.broken": "Will not start here",
        "assistant.brokenRows": "{count} row(s) unusable here",
        "assistant.brokenHint": "This mode cannot start here, so it will not appear for a new session. Fix for this line turns off only those rows.",
        "assistant.switchHint": "Switching assistants keeps each draft; the \"Unsaved\" marker in the list is exactly that.",
        "btn.create": "New assistant",
        "create.heading": "New assistant",
        "btn.creating": "Creating…",
        "btn.duplicate": "Duplicate",
        "btn.moveUp": "Move up",
        "btn.moveDown": "Move down",
        "btn.import": "Import",
        "btn.export": "Export",
        "btn.reset": "Factory prompt",
        "btn.resetHint": "Restores the prompt saved when this assistant was created. The editor changes. Save writes it.",
        "btn.delete": "Delete",
        "btn.cancel": "Cancel",
        "msg.created": "Created. Continue editing here, then choose it in the mode menu for a new session.",
        "msg.duplicated": "Duplicated. The two are independent from here on.",
        "msg.deleted": "Deleted.",
        "msg.createFailed": "Could not create",
        "msg.deleteFailed": "Could not delete",
        "msg.nameRequired": "Give the new assistant a name first.",
        "msg.readOnlyHint": "Manages only the assistants this plugin created; a hand-written preset is not listed and is never rewritten.",
        "msg.reordered": "Order saved. New sessions list modes in this order.",
        "msg.reorderFailed": "Could not reorder",
        "msg.imported": "Imported into the editor. Not saved yet.",
        "msg.importFailed": "Import failed",
        "api.badDirection": "Unknown reorder direction: {direction}",
        "api.unknownAssistant": "No assistant \"{id}\". This page only manages assistants it created.",
        "api.alreadyFirst": "{name} is already first.",
        "api.alreadyLast": "{name} is already last.",
        "api.badVariableName": "{variable} is not a valid variable. Use a lower-case name.",
        "api.unknownVariable": "{variable} cannot be used. Available: {known}.",
        "mode.unavailable": "No shipped composition is available, so the base mode cannot be changed.",
        "rows.unavailable": "No shipped composition is available, so the plugin switches cannot be edited right now; the row states already on disk still apply.",
        "mode.pendingRows": "Base mode is now {mode}. On save, the tool base becomes this shipped preset.",
        "aria.expand": "Show details",
        "aria.collapse": "Hide details",
        "detail.id": "Row id",
        "detail.hostReason": "Host message: ",
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
        "meta.versionHint": "Without a pinned version, an older release may be installed. To change it, reinstall with the version pin from the README, then restart.",
        "api.saved": "Saved ({name}, {mode}). The next model step rereads the saved prompt.",
        "api.conflict": "The prompt on disk has changed, so this save was not written. Reload, then decide whether to overwrite.",
        "api.savedWithExclusiveRows": "Saved ({name}, {mode}). Turned off rows that cannot be on together: {rows}.",
        "api.created": "Created {name}. Continue editing here, then choose it in the mode menu for a new session.",
        "api.savedPrompt": "System prompt saved ({name}). The next model step rereads this file.",
        "api.duplicated": "Copied from {from}. The two are independent from now on.",
        "api.deleted": "Deleted {name}. Sessions already using it are unchanged.",
        "api.reordered": "Order saved. New sessions list modes in this order.",
        "api.nameRequired": "Give the new assistant a name first.",
        "api.postureUnknown": "No such starter: {posture}.",
        "api.posturePromptMissing": "Could not read the starter prompt for {posture}.",
        "api.nameTooLong": "That name is too long (limit {max} characters).",
        "api.descriptionTooLong": "That description is too long (limit {max} characters).",
        "api.promptEmpty": "An empty system prompt cannot be saved.",
        "api.badMode": "Unknown base mode: {mode}",
        "api.dirExists": "That directory already exists — pick another name: {path}",
        "api.compositionMissing": "Composition file not found: {path}",
        "api.writeFailed": "Write failed: {detail}",
        "api.promptWriteFailed": "Writing the prompt failed: {detail}",
        "api.renderFailed": "Rendering the composition failed: {detail}",
        "api.selfCheckFailed": "The generated composition failed its self-check, so nothing was written: {detail}",
        "api.internalError": "Unexpected host error: {detail}",
        "api.bodyTooLarge": "Request body too large (limit {max} bytes)",
        "api.repairNotNeeded": "Nothing to repair.",
        "api.repaired": "Turned off {count} row(s) that cannot start here ({ids}).",
        "api.badAssistantId": "Invalid assistant id: {id} (a-z, 0-9 and hyphens only)",
        "api.seedFailed": "Copying the mode template failed: {detail}",
        "api.metaWriteFailed": "Writing preset.yml failed: {detail}",
        "api.promptReadFailed": "Reading the prompt failed: {detail}",
        "api.noRemoveApi": "This version cannot delete an assistant.",
        "api.noDirectory": "Delete failed: this assistant's directory is gone from disk, so the list on screen is stale. Refresh and try again.",
        "api.deleteFailed": "Delete failed: {detail}",
        "api.versionMissing": "That version is gone (the history is capped).",
        "api.badJson": "The request body is not valid JSON",
        "api.savedPromptOnly": "System prompt saved. Base mode and plugin switches were not changed.",
        "api.baseCompositionUnavailable": "No shipped composition for base mode \"{mode}\" on this machine, so its plugin switches and base mode cannot be changed (the system prompt can still be saved on its own).",
        "warn.personaOffWithPrompt": "Identity is off, so this prompt has no effect.",
        "warn.toolOff": "custom_prompt is off. The prompt can be edited on this page only.",
        "warn.noDescription": "Without a description, the mode menu shows \"no description yet\".",
        "warn.approvalGateMissing": "This version has no approval event. In-session prompt edits are not confirmed.",
        "warn.unresolvableRows": "Some rows cannot start here, so this mode is absent from the new-session menu. Fix for this line turns off only those rows.",
        "warn.presetBroken": "This mode cannot start, so it will not appear for a new session. Use Fix for this line. The reason is on the next line.",
        "warn.badPromptVariable": "The prompt uses a variable that is not available. Fix it before saving.",
        "warn.duplicateRowIds": "A row id is repeated. A switch applies only to the first one.",
        "warn.predicateFailed": "A platform condition could not be evaluated. That row is treated as off.",
        "warn.exclusiveRowsActive": "The two terminals cannot both be on, or this mode will not start. Saving turns one of them off.",
        "warn.noName": "Without a name, the mode menu shows the directory id.",
        "warn.baseCompositionUnavailable": "No shipped composition is available. Base mode and plugin switches cannot be changed. The system prompt can still be saved.",
        "history.label": "Change history",
        "history.pick": "Choose a version…",
        "history.load": "Load",
        "history.hint": "Loading edits the draft only. Save writes it.",
        "history.by.settings": "saved here",
        "history.by.external": "external edit",
        "msg.loadFailed": "Could not load that version",
        "msg.importEmpty": "That file is empty.",
        "msg.importTooLarge": "That file is too large (1 MB limit).",
        "msg.exported": "Exported to a file.",
        "msg.exportFailed": "Export failed",
        "delete.title": "Delete \"{name}\"?",
        "delete.description": "This deletes the assistant directory and its system prompt. It cannot be undone. Sessions already using it are unchanged.",
        "delete.acknowledge": "I understand this assistant's prompt will be deleted permanently",
        "delete.confirm": "Delete",
        "delete.close": "Close",
        "delete.plainConfirm": "Delete \"{name}\"? This cannot be undone.",
        "name.heading": "Name",
        "name.hint": "Shown in the mode menu. The internal id stays the same.",
        "name.placeholder": "Custom mode",
        "name.descriptionPlaceholder": "Description, shown in the mode menu. Optional.",
        "mode.heading": "Base mode",
        "mode.hint": "All five can be chosen. This edits the assistant selected above. The prompt on this page still applies.",
        "rows.heading": "Plugin switches",
        "rows.filterPlaceholder": "Filter by name or id",
        "cap.heading": "Plugin switches",
        "cap.expand": "Show plugin switches",
        "cap.collapse": "Hide plugin switches",
        "cap.hint": "A row that is off is not used by this assistant.",
        "rows.hint": "A row that is off is not used by this assistant.",
        "prompt.heading": "System prompt",
        "prompt.hint": "After you save, the next model step rereads this file.",
        "status.enabled": "Enabled",
        "status.disabled": "Disabled",
        "status.changed": "changed",
        "tag.essential": "Core",
        "tag.followPlatform": "Platform",
        "btn.save": "Save",
        "btn.saving": "Saving…",
        "btn.reload": "Reload",
        "btn.reloadDiscard": "Discard edits and reload",
        "btn.reloadConfirm": "Discard unsaved edits and reload?",
        "msg.unsaved": "Unsaved changes",
        "msg.readFailed": "Load failed",
        "msg.saveFailed": "Save failed",
        "msg.saved": "Saved. The next model step rereads this file.",
        "status.detail": "{message}: {detail}",
        "row.persona.label": "Identity (system prompt)",
        "row.persona.note": "Off: this prompt has no effect.",
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
        "row.planning.note": "Off: planning is removed with it.",
        "row.plan-mode.label": "Plan mode implementation",
        "row.compaction.label": "Context compaction (group)",
        "row.compaction.note": "Carries an isolate realm",
        "row.compaction-basic.label": "Basic compaction",
        "row.command-compact.label": "/compact command",
        "row.tool-result-pruner.label": "Tool-result pruning",
        "row.delegation.label": "Delegation and workflows (group)",
        "row.delegation.note": "Off: subagents and workflows are removed with it.",
        "row.tool-subagent.label": "Subagent (spawn)",
        "row.tool-subagent-fork.label": "Subagent (fork)",
        "row.tool-subagent-control.label": "Subagent control",
        "row.tool-subagent-list-agents.label": "List subagents",
        "row.tool-subagent-codex.label": "Codex subagent",
        "row.tool-subagent-codex.note": "Needs its Bundle installed first; the shipped state is in the details",
        "row.tool-subagent-claude-code.label": "Claude Code subagent",
        "row.tool-subagent-claude-code.note": "Needs its Bundle installed first; the shipped state is in the details",
        "row.time-context.label": "Time context (the model can see the clock)",
        "row.time-context.note": "Adds the current time on some steps.",
        "row.tool-schedule.label": "Scheduled reminders tool",
        "row.tool-schedule.note": "Lets the agent create, list, edit and delete durable reminders; the host schedule service owns storage and delivery",
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
        "row.tool-plugin-market.label": "Plugin marketplace search",
        "row.tool-plugin-market.note": "Discovers plugins; installation and toggles remain with the plugin manager.",
        "row.tool-plugin-manager.label": "Plugin manager (install / toggle)",
        "row.tool-plugin-manager.note": "Lets the model install or toggle plugins.",
        "row.tool-presentation.label": "PTC tool presentation",
        "row.tool-executor-ptc.label": "PTC program executor",
        "row.tool-executor-ptc.note": "Runs programs and calls tools through run_code, and provides the tool SDK to the model.",
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
        "base.standard.label": "Standard mode",
        "base.standard.note": "The shipped tool set.",
        "base.ptc.label": "PTC mode",
        "base.ptc.note": "Standard, plus PTC tool presentation.",
        "base.minimal.label": "Minimal mode",
        "base.minimal.note": "Shell and terminal only. The prompt on this page still applies.",
        "base.cordis.label": "Creator mode",
        "base.cordis.note": "Standard, plus Cordis runtime tools.",
        "base.all.label": "All shipped rows",
        "base.all.note": "Rows from all four shipped presets. Each row can be switched."
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
        let id = ""
        try {
          const snapshot = locale !== undefined && typeof locale.getLocale === "function" ? locale.getLocale() : undefined
          if (snapshot !== undefined && typeof snapshot.active === "string") id = snapshot.active
        } catch (error) {
          /* a shell without a readable snapshot falls through */
        }
        if (id === "" && typeof navigator !== "undefined" && typeof navigator.language === "string") id = navigator.language
        const norm = id.toLowerCase()
        if (norm.startsWith("zh")) return "zh"
        if (norm.startsWith("en")) return "en"
        const primary = norm.split("-")[0]
        if (Object.prototype.hasOwnProperty.call(TRANSLATIONS, norm)) return norm
        if (primary !== "" && Object.prototype.hasOwnProperty.call(TRANSLATIONS, primary)) return primary
        // 壳目前内置 zh / en，语言包可以再注册别的 id。没有对应词典时用英文，避免整页中文或裸键。
        return "en"
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

      const UPDATE_PACKAGE = "dsh-custom-mode"
      let updateServices = { manager: null, navigation: null, list: false, versions: false, update: false, accessKnown: false, revision: 0 }
      const updateListeners = new Set()
      const publishUpdateServices = (patch) => {
        updateServices = { ...updateServices, ...patch, revision: updateServices.revision + 1 }
        for (const listener of updateListeners) listener()
      }

      /** Optional Cordis scopes own these reads; old hosts never block the editor. */
      function mountUpdateServices(ctx) {
        if (typeof ctx.inject !== "function") return
        ctx.inject(["remote", "remote.pluginManager"], (scope) => {
          const manager = scope.remote.pluginManager
          if (manager === null || manager === undefined) return
          publishUpdateServices({ manager, list: false, versions: false, update: false, accessKnown: false })
          scope.effect(() => () => {
            if (updateServices.manager === manager) publishUpdateServices({ manager: null, list: false, versions: false, update: false, accessKnown: false })
          })
          scope.inject(["remoteAccess"], (accessScope) => {
            if (typeof accessScope.remoteAccess.whenAccess !== "function") return
            if (updateServices.manager === manager) publishUpdateServices({ accessKnown: true })
            for (const [key, action] of [["list", "listBundles"], ["versions", "listVersions"], ["update", "updateBundle"]]) {
              if (typeof manager[action] !== "function") continue
              accessScope.effect(() => accessScope.remoteAccess.whenAccess("pluginManager/" + action, () => {
                if (updateServices.manager === manager) publishUpdateServices({ [key]: true })
                return () => {
                  if (updateServices.manager === manager) publishUpdateServices({ [key]: false })
                }
              }))
            }
          })
        })
        ctx.inject(["pluginNavigation"], (scope) => {
          const navigation = scope.get("pluginNavigation")
          publishUpdateServices({ navigation })
          scope.effect(() => () => {
            if (updateServices.navigation === navigation) publishUpdateServices({ navigation: null })
          })
        })
      }

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

      /**
       * Whether an atom can be handed to `createElement`.
       *
       * ★ **This is where the page's native look was lost.** The probe used to be
       * `typeof atoms.Button === "function"`, but the shell's components are `forwardRef(...)` /
       * `memo(...)` **objects** (`Button = forwardRef(function Button(){…})`, measured), so the check
       * failed and *every* control silently fell back to the plain stand-ins — hand-painted buttons,
       * `input[type=checkbox]` instead of the shell's switch, a native `window.confirm` instead of its
       * risk dialog. Measured on 0.1.7-rc.2 (2026-09-25): `require(ATOMS_MODULE)` returns **279 exports**
       * including `Button`, `RiskConfirmation`, `Modal`, `Menu`, `SegmentedControl` and the icon set —
       * the module was in the platform seed table the whole time.
       * React renders any object carrying `$$typeof`, so that is what "usable" means here.
       */
      const renderable = (atom) =>
        typeof atom === "function" || (atom !== null && typeof atom === "object" && atom.$$typeof !== undefined)

      /**
       * The page asks for icons under short names (`IconPlusOutline16`); the shell exports
       * `IconPlusOutlineRegular`. Without this map the calls were `undefined` and **no icon ever
       * rendered** — which is part of why the header row looked hand-made.
       */
      const ICON_ALIAS = {
        IconChevronDownOutline14: "IconChevronDownOutlineRegular",
        IconChevronUpOutline14: "IconChevronUpOutlineRegular",
        IconChevronLeftOutline14: "IconChevronLeftOutlineRegular",
        IconChevronRightOutline14: "IconChevronRightOutlineRegular",
        IconPlusOutline16: "IconPlusOutlineRegular",
        IconCheckOutline14: "IconCheckOutlineRegular",
        IconCopyOutline16: "IconCopyOutlineRegular",
        IconDownloadOutline16: "IconDownloadOutlineRegular",
        IconRefreshOutline16: "IconRefreshOutlineRegular",
        IconTrashOutline16: "IconTrashOutlineRegular",
        IconWarningOutline14: "IconWarningOutlineRegular",
      }

      function withIconAliases(atoms) {
        const out = Object.assign({}, atoms)
        for (const short of Object.keys(ICON_ALIAS)) {
          if (out[short] === undefined && renderable(atoms[ICON_ALIAS[short]])) out[short] = atoms[ICON_ALIAS[short]]
        }
        return out
      }

      /** Resolve the atom set once, at factory time. */
      function loadAtoms() {
        try {
          const atoms = require(ATOMS_MODULE)
          if (atoms !== null && typeof atoms === "object" && renderable(atoms.Button)) return withIconAliases(atoms)
          console.info(
            "dsh-custom-mode: 壳提供了 " +
              ATOMS_MODULE +
              "，但里面没有可用的 Button，改用内置的朴素控件（功能一致，外观更简）。",
          )
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
        ".cpfe{--g:8px;display:flex;flex-direction:column;gap:16px;width:100%;max-width:900px;box-sizing:border-box;padding-bottom:16px;font:inherit;color:inherit}",
        ".cpfe > section{padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1)}",
        ".cpfe > section:first-child{padding-top:0;border-top:0}",
        // 分节标题：度量抄官方设置面板里的同类文本。
        // 实测（**0.1.7-rc.2 与 0.2.0-rc.2 各量一次，结论相同**）：官方 `_title`（设置行标题）
        // 与 `groupTitle`（插件页分组标题）都是 14px/22px **w400**；官方唯一的 14px w500 是插件
        // 卡片标题（`cardTitle`，行高 20px，形态不同），页级标题则是 16px/24px w500。
        // 本页是设置面板里的分节，取 w400。
        // ⚠️ 本仓长期记作「官方区块标题 14px/22px w500」—— 那一条在 2026-10-02 的复量中被证伪。
        ".cpfe-h{margin:0 0 2px;font-size:14px;line-height:22px;font-weight:400;color:var(--dsw-alias-label-primary)}",
        ".cpfe-sub{margin:0 0 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
        // 区块引言：官方是标题下的一行 12px 灰字 —— 没有折叠按钮，也没有那个蓝色圆点。
        ".cpfe-hint{display:flex;flex-direction:column;gap:2px;margin:0 0 6px}",
        ".cpfe-hint-line{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
        ".cpfe-hint-detail{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
        // The native InlineEditor saves on Enter and autofocuses; document editing must keep
        // Enter as a newline and manual Save. Use its exact surface/font tokens for these
        // controlled textareas, with only document height and width as layout differences.
        ".cpfe-desc,.cpfe-editor{box-sizing:border-box;min-width:0;margin:0;padding:3px 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);font-family:Inter,var(--dsw-font-family);overflow-y:auto}",
        ".cpfe-desc:focus,.cpfe-editor:focus{border-color:var(--dsw-alias-state-business-primary)}",
        ".cpfe-desc{min-height:40px;max-height:120px;resize:vertical}",
        ".cpfe-base-pending{color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-note{display:block;margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
        ".cpfe-mono{display:block;margin:0;font:inherit;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
        ".cpfe-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center}",
        ".cpfe-pills > *{flex:0 0 auto;white-space:nowrap}",
        ".cpfe-pills button{white-space:nowrap}",
        ".cpfe-picker{display:flex;align-items:center;gap:8px;margin:2px 0 4px}",
        ".cpfe-history{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}",
        // Native Menu and Button keep their appearance; only the trigger's
        // own text shrinks so long names cannot wrap outside its fixed height.
        ".cpfe-selector-menu,.cpfe-selector{min-width:0;max-width:100%}",
        ".cpfe-selector-label{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".cpfe-selector-chevron{flex:0 0 auto}",
        ".cpfe-history-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
        ".cpfe-history-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
        ".cpfe-pill-wrap{display:inline-flex;align-items:center;gap:4px}",
        ".cpfe-actions{display:flex;flex-wrap:wrap;gap:var(--g);align-items:center;margin-top:4px}",
        ".cpfe-newrow{display:flex;gap:var(--g);align-items:center;flex-wrap:wrap;margin-top:10px}",
        ".cpfe-postures{display:flex;flex-direction:column;gap:6px}",
        ".cpfe-create{display:flex;flex-direction:column;gap:6px}",
        ".cpfe-branch{display:flex;flex-direction:column;gap:16px;margin-top:8px;padding-left:12px;border-left:1px solid var(--dsw-alias-border-l1)}",
        ".cpfe-node{display:flex;flex-direction:column;gap:4px}",
        ".cpfe-node-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
        // Native Input applies className to its padded wrapper span, so its
        // outer box (not only the inner input) must fit the plugin column.
        ".cpfe-field{display:flex;box-sizing:border-box;width:100%;min-width:0;max-width:100%;margin-bottom:8px}",
        ".cpfe-row-head{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}",
        ".cpfe-row-switch{flex:0 0 auto}",
        ".cpfe-row-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}",
        ".cpfe-row-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".cpfe-row-toggle{flex:0 0 auto}",
        ".cpfe-row-open{border-color:var(--dsw-alias-border-l2)}",
        ".cpfe-row-detail{display:flex;flex-direction:column;gap:4px;margin:0 0 12px;padding:0 0 0 16px;border:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
        ".cpfe-detail-line{display:flex;gap:8px;min-width:0}",
        ".cpfe-detail-key{flex:0 0 9.5em;color:var(--dsw-alias-label-secondary)}",
        ".cpfe-detail-value{min-width:0;overflow-wrap:anywhere}",
        ".cpfe-sec-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}",
        ".cpfe-sec-head .cpfe-actions{margin-top:0}",
        ".cpfe-update{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:16px}",
        ".cpfe-update-meta{flex:1 1 220px;min-width:0}",
        ".cpfe-update-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;max-width:100%}",
        // The shared atoms expose no Link or anchor-shaped Button. Keep a real anchor;
        // use official settings UI typography/link tokens, not Markdown prose styles.
        ".cpfe-update-guide{max-width:100%;overflow-wrap:anywhere;font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-link);text-decoration:none}",
        "@media (hover:hover){.cpfe-update-guide:hover{text-decoration:underline}}",
        ".cpfe-update-note{overflow-wrap:anywhere}",
        ".cpfe-newinput{box-sizing:border-box;flex:1 1 200px;min-width:0;max-width:100%}",
        // 单列、行高统一（对齐官方插件页的形态）；之前的自适应多列网格会让行高参差不齐。
        // ★ 对齐官方设置行（实测 0.1.7-rc.2 的行：padding 16px 0、无背景、无圆角，行间只有一条 1px
        //   分隔线）。原来是"圆角卡片 + 描边 + 灰底" —— 那正是廉价感最重的部分。
        ".cpfe-rows{display:flex;flex-direction:column;gap:0;margin-top:0}",
        ".cpfe-line{display:flex;flex-direction:column;min-width:0;border-bottom:1px solid var(--dsw-alias-border-l1)}",
        ".cpfe-line:last-child{border-bottom:0}",
        ".cpfe-group{display:flex;flex-direction:column;min-width:0}",
        ".cpfe-kids{display:flex;flex-direction:column;margin-left:0;padding-left:16px}",
        ".cpfe-row-meta{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}",
        ".cpfe-row-badges{display:flex;align-items:center;gap:4px;flex:0 1 auto;min-width:0}",
        ".cpfe-row{display:flex;gap:12px;align-items:center;box-sizing:border-box;min-height:74px;padding:16px 0;border:0;border-radius:0;background:none}",
        ".cpfe-editor{width:100%;min-height:120px;resize:vertical}",
        ".cpfe-bar{display:flex;align-items:center;gap:var(--g);flex-wrap:wrap;margin-top:8px}",
        ".cpfe-disclosure{align-self:flex-start;margin-top:8px}",
        ".cpfe .cpfe-danger{margin-left:auto}",
        ".cpfe-status{font-size:13px;line-height:20px}",
        ".cpfe-ok{color:var(--dsw-alias-label-secondary)}",
        ".cpfe-err{color:var(--dsw-alias-state-error-primary)}",
        ".cpfe-dirty{color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-meta-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;min-width:0}",
        ".cpfe-version{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}",
        ".cpfe-path{font:inherit;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
        // ── fallback-path controls (unused when the shell provides the atoms) ──
        ".cpfe-btn{appearance:none;cursor:pointer;padding:0 14px;height:36px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px}",
        ".cpfe-btn:disabled{opacity:.4;cursor:not-allowed}",
        ".cpfe-btn-sm{height:28px;padding:0 10px;font-size:12px;line-height:18px;border-radius:var(--dsw-radius-sm)}",
        ".cpfe-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent;font-weight:500}",
        ".cpfe-btn-ghost{border-color:transparent;background:transparent}",
        ".cpfe-input{box-sizing:border-box;width:100%;height:36px;padding:0 12px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
        ".cpfe-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}",
        // 忙碌期间禁掉草稿类控件的交互（issue #6）。
        // 状态层已经拦住了改动（`update()` 在 busy 时直接返回），但对**受控组件**来说，
        // 光拦状态还不够：DOM 会先显示用户敲进去的字/翻过去的开关，等下一次重渲染才被拉回来 ——
        // 那就是"我明明改了，它自己弹回去了"。`pointer-events` 让点击根本到不了控件，
        // 视觉上也给一个明确的"此刻不能动"。
        ".cpfe-busy .cpfe-switch,.cpfe-busy .cpfe-row-switch,.cpfe-busy .cpfe-row-toggle,.cpfe-busy .cpfe-input,.cpfe-busy .cpfe-field,.cpfe-busy .cpfe-pill,.cpfe-busy .cpfe-selector{pointer-events:none}",
        ".cpfe-busy .cpfe-editor{cursor:progress}",
        ".cpfe-tag{font-size:12px;line-height:18px;padding:0 5px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}",
        ".cpfe-tag-success,.cpfe-tag-info{color:var(--dsw-alias-state-success-primary)}",
        ".cpfe-tag-warning{color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-tag-danger{color:var(--dsw-alias-state-error-primary)}",
        ".cpfe-pill{appearance:none;cursor:pointer;height:28px;padding:0 12px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px}",
        ".cpfe-pill-on{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}",
        // Menu surfaces and trigger Buttons keep the native atoms' own styles.
        // ── 告警区 ──────────────────────────────────────────────────────────────
        // 这一段此前**一条 CSS 都没有**（2026-10-02 逐表核对：样式表里 `cpfe-warn` 零规则），
        // 于是出现告警时它是一串没有排版的裸 `<p>`：没有行距、图标与文字不对齐、
        // 与页面其余部分（12px/18px）的字号也对不上。度量沿用页面其余部分。
        ".cpfe-warns{display:flex;flex-direction:column;gap:12px}",
        ".cpfe-warn-row{display:flex;flex-direction:column;gap:6px;align-items:flex-start}",
        ".cpfe-warn{display:flex;gap:6px;align-items:flex-start;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-warn svg{flex:0 0 auto;margin-top:2px}",
      ].join("")

      /** Keep one stylesheet, replacing stale content when an HMR bundle arrives. */
      function ensureStyles() {
        if (typeof document === "undefined") return
        const tagId = "dsh-custom-mode/system-prompt"
        const existing = document.querySelector('style[data-plugin-css="' + tagId + '"]')
        if (existing !== null) {
          if (existing.textContent !== CSS) existing.textContent = CSS
          return
        }
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
        sync: ROUTE + "/sync",
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
          // 出厂组成取不到时的降级标记（服务端给，只读）。它不是用户可改的字段，sameDraft 不比较它。
          baseUnavailable:
            state.baseUnavailable === undefined || state.baseUnavailable === null ? null : state.baseUnavailable,
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
          broken: typeof state.broken === "string" && state.broken !== "" ? state.broken : null,
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
       * A section's one-line introduction, sitting under its heading.
       *
       * It takes ONE string and renders it as one line — the shape the official settings pages use:
       * a single 12px/18px tertiary line under the title, with no disclosure control and no bullet.
       *
       * It used to take `hint` + `detail` and pick `detail` when present, for a collapsible
       * introduction that no longer exists. Every caller passed both, so the short form was
       * **never rendered** — five dictionary entries (`assistant.short`, `name.short`, `mode.short`,
       * `rows.short`, `prompt.short`) that looked alive in a grep but reached no pixel. Both are gone.
       */
      function SectionHint(props) {
        return react.createElement(
          "div",
          { className: "cpfe-hint" },
          react.createElement("span", { className: "cpfe-hint-line" }, props.text),
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
      function filterRows(rows, query, translateRow) {
        const needle = String(query || "").trim().toLowerCase()
        if (needle === "") return rows
        const out = []
        for (const row of rows) {
          const title = String(translateRow("row." + row.id + ".label", row.label)).toLowerCase()
          const self = title.includes(needle) || row.id.toLowerCase().includes(needle)
          const children = Array.isArray(row.children) ? row.children : []
          const kids = self ? children : filterRows(children, query, translateRow)
          if (self || kids.length > 0) out.push(self ? row : { ...row, children: kids })
        }
        return out
      }

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
                      row.essential ? react.createElement(A.Tag, { tone: "warning" }, t("tag.essential")) : null,
                      row.disabledExpression !== null && row.disabledExpression !== undefined
                        ? react.createElement(A.Tag, { tone: "outline" }, t("tag.followPlatform"))
                        : null,
                      changed ? react.createElement(A.Tag, { tone: "info" }, t("status.changed")) : null,
                    ),
                  ),
                  note
                    ? react.createElement("span", { className: "cpfe-row-note", title: note }, note)
                    : null,
                ),
                react.createElement(
                  A.Button,
                  {
                    variant: "ghost",
                    size: "sm",
                    className: "cpfe-row-toggle",
                    "aria-expanded": open,
                    "aria-label": t(open ? "aria.collapse" : "aria.expand"),
                    onClick: () => onToggleExpand(row.id),
                  },
                  // 用壳自己的图标，不再手绘 "▸"/"▾" 字符：字符的字形、基线与粗细都随字体走，
                  // 与官方那一排 14px 线性图标放在一起就是两种东西。壳没提供时退回原字符。
                  (() => {
                    const Icon = open ? A.IconChevronDownOutline14 : A.IconChevronRightOutline14
                    return renderable(Icon) ? react.createElement(Icon, { size: 14 }) : open ? "▾" : "▸"
                  })(),
                ),
                react.createElement(A.Switch, {
                  checked: effective,
                  disabled: props.disabled === true,
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
                    disabled: props.disabled === true,
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
            if (template !== "") {
              /**
               * `{mode}` 是**基础模式**，宿主只能交出机器名（`standard` / `ptc` / `minimal` /
               * `cordis` / `all`）。直接印出来就是「基础模式 all」—— 中文读者看不懂，
               * 而且和壳自己的叫法（标准模式 / PTC 模式 / 极简模式 / 创造模式 / 自定义模式）对不上，
               * 一条原生质感的提示不该长这样。页面手上有 `base.<id>.label`，用它；
               * 词典里没有这个 id 时（旧宿主 / 未来新增）退回机器名，宁可难看也不要空。
               */
              const params = result.params
              let shown = params
              if (params !== null && typeof params === "object") {
                shown = { ...params }
                if (typeof params.mode === "string") {
                  shown.mode = translate("base." + params.mode + ".label", params.mode, shellT)
                }
                if (typeof params.rows === "string") {
                  shown.rows = params.rows
                    .split(",")
                    .map((id) => translate("row." + id.trim() + ".label", id.trim(), shellT))
                    .join(", ")
                }
              }
              return fillPlaceholders(template, shown)
            }
          }
          if (result !== null && typeof result === "object") {
            if (typeof result.error === "string" && result.error !== "") return result.error
            if (typeof result.note === "string" && result.note !== "") return result.note
          }
          return t(fallbackKey)
        }

        const [list, setListState] = react.useState(null)
        const heldRoster = react.useRef(list)
        const setList = (value) => { heldRoster.current = value; setListState(value) }
        const [selected, setSelected] = react.useState("")
        /** id → { payload, saved, value }: loaded state, baseline and live draft. */
        const [entries, setEntriesState] = react.useState({})
        const heldEntries = react.useRef(entries)
        const setEntries = (next) => {
          heldEntries.current = typeof next === "function" ? next(heldEntries.current) : next
          setEntriesState(heldEntries.current)
        }
        const [status, setStatus] = react.useState("")
        const [failed, setFailed] = react.useState(false)
        const [busy, setBusy] = react.useState(false)
        const [pending, setPending] = react.useState("")
        const [syncNeeded, setSyncNeededState] = react.useState(false)
        const [refreshNeeded, setRefreshNeededState] = react.useState(null)
        const navigationState = react.useRef({ syncNeeded: false, refreshNeeded: null, newName: "" })
        const setSyncNeeded = (value) => { navigationState.current.syncNeeded = value; setSyncNeededState(value) }
        const setRefreshNeeded = (value) => { navigationState.current.refreshNeeded = value; setRefreshNeededState(value) }
        // A ref closes the interval before React renders disabled controls. Only the
        // owning operation may apply a response or release the busy state.
        const operation = react.useRef({ alive: true, current: null })
        const [newName, setNewNameState] = react.useState("")
        const setNewName = (value) => { navigationState.current.newName = value; setNewNameState(value) }
        const [runtimeVersion, setRuntimeVersion] = react.useState("")
        const [updateResult, setUpdateResult] = react.useState(null)
        const [updateNotice, setUpdateNotice] = react.useState("")
        const [updateChecking, setUpdateChecking] = react.useState(false)
        const [, setUpdateRevision] = react.useState(0)
        const updateOperation = react.useRef({ alive: true, current: null })
        const [orphanView, setOrphanView] = react.useState("")
        const [orphanDialog, setOrphanDialog] = react.useState(null)
        const [orphanAcknowledged, setOrphanAcknowledged] = react.useState(false)
        const orphanConfirmation = react.useRef(null)
        const orphanAcknowledgement = react.useRef(false)
        const [postureChoices, setPostureChoices] = react.useState([])
        const [posture, setPosture] = react.useState("develop")
        const [deleteOpen, setDeleteOpen] = react.useState(false)
        const [acknowledged, setAcknowledged] = react.useState(false)
        /**
         * Which rows have their detail open, by row id.
         *
         * Per-row and local to the section: the list is long (33 rows measured) and the interesting detail
         * differs per user, so nothing is expanded by default and nothing is persisted.
         */
        const [expandedRows, setExpandedRows] = react.useState({})
        // 两个官方风格的下拉（壳的 `Menu`）：助手切换与改动历史。壳不提供 Menu 时退回原生控件。
        const [assistantOpen, setAssistantOpen] = react.useState(false)
        const [historyOpen, setHistoryOpen] = react.useState(false)
        const [listFailed, setListFailed] = react.useState(false)
        const [capOpen, setCapOpen] = react.useState(false)
        const [rowQuery, setRowQuery] = react.useState("")
        /** 本机这条线上有无法解析的行时，一键把它们关掉（服务端复用保存同一条排版手术）。 */
        const repairRowsNow = async () => {
          if (draft === null) return
          return runOperation("status.repairing", "msg.saveFailed", async (token) => {
            const result = await postJson(ROUTES.repair, { id: selected })
            if (!ownsOperation(token)) return
            showResult(result, "msg.repaired", "msg.saveFailed")
            if (result?.ok === true || result?.persisted === true) {
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
              await refreshAfterWrite(result, "msg.repaired", selected, token, () => reload(selected, undefined, token))
            }
          })
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

        const ownsOperation = (token) => operation.current.alive && operation.current.current === token
        const runOperation = async (pendingKey, failureKey, action) => {
          if (!operation.current.alive || operation.current.current !== null) return
          const token = {}
          operation.current.current = token
          setBusy(true)
          setPending(pendingKey)
          try {
            await action(token)
          } catch (error) {
            if (ownsOperation(token)) {
              setFailed(true)
              if (pendingKey === "status.reading" && list === null) setListFailed(true)
              setStatus(fillPlaceholders(t("status.detail"), { message: t(failureKey), detail: describeError(error) }))
            }
          } finally {
            if (ownsOperation(token)) {
              operation.current.current = null
              setBusy(false)
              setPending("")
            }
          }
        }

        const showResult = (result, successKey, failureKey) => {
          setFailed(result?.ok !== true)
          setStatus(apiText(result, result?.ok === true ? successKey : failureKey))
          if (result?.synchronized === false) setSyncNeeded(true)
          else if (result?.synchronized === true) setSyncNeeded(false)
        }

        // Once the host confirms a mutation, a failed follow-up GET cannot turn
        // that fact into a failed mutation or invite the user to repeat it.
        const refreshAfterWrite = async (result, fallbackKey, targetId, token, refresh) => {
          try {
            await refresh()
            if (ownsOperation(token)) setRefreshNeeded(null)
          } catch (error) {
            if (!ownsOperation(token)) return
            setRefreshNeeded({ result, fallbackKey, targetId })
            setFailed(true)
            const message = fillPlaceholders(t("msg.completedReadFailed"), { result: apiText(result, fallbackKey) })
            setStatus(fillPlaceholders(t("status.detail"), { message, detail: describeError(error) }))
          }
        }

        /**
         * Fetch one assistant into `entries`, keeping any unsaved draft it already has.
         *
         * `discard` is the explicit "throw my edits away" path (the reload button), and
         * `force` is "re-read even if this entry is already in memory". Neither is set by
         * ordinary switching: moving between assistants must never race a half-typed prompt.
         */
        const open = async (id, options, token) => {
          if (!ownsOperation(token)) return
          if (typeof id !== "string" || id === "") return
          const force = options !== null && typeof options === "object" && options.force === true
          const discard = options !== null && typeof options === "object" && options.discard === true
          const held = entries[id]
          if (force !== true && held !== undefined) return
          const result = await fetchState(id)
          if (!ownsOperation(token)) return
          if (result === null || result === undefined || result.ok !== true) {
            throw new Error(apiText(result, "msg.readFailed"))
          }
          const fresh = draftOf(result)
          setEntries((previous) => {
            const before = previous[id]
            const keep = discard !== true && before !== undefined && !sameDraft(before.value, before.saved) ? before.value : fresh
            return { ...previous, [id]: { payload: result, saved: fresh, value: keep } }
          })
        }

        /** Re-read the assistant list and force-reload the one it settles on. */
        const reload = async (preferId, options, token) => {
          if (!ownsOperation(token)) return
          const result = await fetchList()
          if (!ownsOperation(token)) return
          if (result === null || result === undefined || result.ok !== true) {
            setListFailed(true)
            throw new Error(apiText(result, "msg.readFailed"))
          }
          const assistants = Array.isArray(result.assistants) ? result.assistants : []
          const choices = Array.isArray(result.postures) ? result.postures.filter((item) => item !== null && typeof item === "object" && typeof item.id === "string") : []
          setListFailed(false)
          if (typeof result.version === "string" && result.version !== "") setRuntimeVersion(result.version)
          setList(assistants)
          setPostureChoices(choices)
          setPosture((current) => (choices.some((item) => item.id === current) ? current : choices.length > 0 ? choices[0].id : "develop"))
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
            // An empty remote roster does not discard the only in-memory copy of another draft.
            setEntries((previous) => Object.fromEntries(Object.entries(previous).filter(([, held]) => !sameDraft(held.value, held.saved))))
            return
          }
          await open(wanted, { force: true, discard: options !== null && typeof options === "object" && options.discard === true }, token)
        }

        /**
         * Refresh the display names only.
         *
         * A save can rename an assistant but never changes ids, so the list needs a new
         * fetch while the selection, the payloads and every draft stay exactly as they are.
         */
        const refreshNames = async (token) => {
          const result = await fetchList()
          if (!ownsOperation(token)) return
          if (result !== null && result !== undefined && result.ok === true) {
            if (typeof result.version === "string" && result.version !== "") setRuntimeVersion(result.version)
            setList(Array.isArray(result.assistants) ? result.assistants : [])
          } else throw new Error(apiText(result, "msg.readFailed"))
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
          operation.current.alive = true
          runOperation("status.reading", "msg.readFailed", (token) => reload("", undefined, token))
          return () => {
            operation.current.alive = false
            operation.current.current = null
          }
        }, [])

        react.useEffect(() => {
          updateOperation.current.alive = true
          const changed = () => {
            updateOperation.current.current = null
            setUpdateChecking(false)
            setUpdateResult(null)
            setUpdateNotice("")
            setUpdateRevision((value) => value + 1)
          }
          updateListeners.add(changed)
          return () => {
            updateListeners.delete(changed)
            updateOperation.current.alive = false
            updateOperation.current.current = null
          }
        }, [])

        const hasNativeUpdates = (services) => typeof services.manager?.listBundles === "function" &&
          typeof services.manager?.listVersions === "function" && typeof services.manager?.updateBundle === "function"
        const ownsUpdateCheck = (token, services) => updateOperation.current.alive &&
          updateOperation.current.current === token && updateServices.revision === services.revision
        const checkUpdates = async () => {
          if (!updateOperation.current.alive || operation.current.current !== null || updateOperation.current.current !== null) return
          const services = updateServices
          if (!hasNativeUpdates(services) || !services.list || !services.versions) return
          const token = {}
          updateOperation.current.current = token
          setUpdateChecking(true)
          setUpdateResult(null)
          setUpdateNotice("")
          const show = (key, details) => setUpdateResult({ key, ...details, revision: services.revision })
          try {
            const inventory = await services.manager.listBundles()
            if (!ownsUpdateCheck(token, services)) return
            if (inventory?.ok !== true || !Array.isArray(inventory.value)) throw new Error("inventory")
            const bundle = inventory.value.find((item) => item?.name === UPDATE_PACKAGE)
            if (bundle === undefined) { show("update.notFound"); return }
            if (bundle.updatable !== true || bundle.installed !== true || bundle.availability !== "profile" ||
                bundle.official !== false || bundle.readOnlyReason !== undefined || typeof bundle.source !== "string" ||
                typeof bundle.version !== "string" || bundle.version === "") {
              show("update.managed", { installed: bundle.version }); return
            }
            const answer = await services.manager.listVersions(UPDATE_PACKAGE, {})
            if (!ownsUpdateCheck(token, services)) return
            if (answer?.ok !== true || answer.value === null || typeof answer.value !== "object") throw new Error("versions")
            const listing = answer.value
            if (listing.status === "refused") {
              show(listing.problem === "network" ? "update.network" : listing.problem === "not-updatable" ? "update.managed" : "update.refused")
              return
            }
            if (listing.status !== "listed" || typeof listing.installed !== "string" || listing.installed !== bundle.version ||
                !(listing.registry === null || typeof listing.registry === "string") || !Array.isArray(listing.attempts) ||
                !Number.isInteger(listing.omitted) || listing.omitted < 0 || !Array.isArray(listing.versions) ||
                !listing.versions.every((item) => item !== null && typeof item === "object" && typeof item.version === "string" &&
                  item.version !== "" && typeof item.bundle === "boolean" && typeof item.prerelease === "boolean" && Array.isArray(item.tags))) {
              throw new Error("incomplete listing")
            }
            // Match the official default candidate and trust the Host's semver ordering.
            const candidate = listing.versions.find((item) => item.bundle && item.incompatible === undefined && item.deprecated === undefined && !item.prerelease)
            show(candidate ? "update.available" : listing.omitted > 0 ? "update.partial" : listing.versions.length > 0 ? "update.filtered" : "update.current", {
              candidate: candidate?.version, installed: listing.installed, omitted: listing.omitted,
            })
          } catch {
            if (ownsUpdateCheck(token, services)) show("update.failed")
          } finally {
            if (ownsUpdateCheck(token, services)) {
              updateOperation.current.current = null
              setUpdateChecking(false)
            }
          }
        }

        /** Latest refs also guard a click before React commits the last keystroke. */
        const updateNavigationBlock = () => {
          if (operation.current.current !== null || busy || updateOperation.current.current !== null) return "update.finishOperation"
          if (navigationState.current.syncNeeded || navigationState.current.refreshNeeded !== null) return "update.finishRecovery"
          if (navigationState.current.newName !== "" || Object.values(heldEntries.current).some((held) => !sameDraft(held.value, held.saved))) return "update.saveDrafts"
          return ""
        }
        const guardUpdateNavigation = () => {
          if (!updateOperation.current.alive) return false
          const block = updateNavigationBlock()
          if (block !== "") { setUpdateNotice(block); return false }
          return true
        }
        const openPluginDetails = () => {
          if (!guardUpdateNavigation()) return
          const services = updateServices
          if (((hasNativeUpdates(services) || services.accessKnown) && !services.list) || typeof services.navigation?.openBundle !== "function" ||
              (updateResult?.candidate && (updateResult.revision !== services.revision || !services.update))) {
            setUpdateNotice("update.permission"); return
          }
          try { services.navigation.openBundle(UPDATE_PACKAGE) }
          catch { setUpdateNotice("update.navigationFailed") }
        }

        const orphanDrafts = () => {
          if (!Array.isArray(heldRoster.current)) return []
          const visible = new Set(heldRoster.current.map((item) => item.id))
          return Object.entries(heldEntries.current).filter(([id, held]) => !visible.has(id) && !sameDraft(held.value, held.saved))
        }
        const closeOrphanConfirmation = () => {
          orphanConfirmation.current = null
          orphanAcknowledgement.current = false
          setOrphanAcknowledged(false)
          setOrphanDialog(null)
        }
        const orphanActionBlock = () => operation.current.current !== null || busy || updateOperation.current.current !== null
          ? "update.finishOperation"
          : navigationState.current.syncNeeded || navigationState.current.refreshNeeded !== null ? "update.finishRecovery" : ""
        const orphanSnapshotCurrent = (snapshot) => heldEntries.current === snapshot.entries && heldRoster.current === snapshot.roster &&
          navigationState.current.newName === snapshot.newName && orphanDrafts().some(([id]) => id === snapshot.id)
        const discardOrphan = (snapshot) => {
          if (!updateOperation.current.alive || orphanConfirmation.current !== snapshot || !orphanAcknowledgement.current) return
          const blocked = orphanActionBlock()
          if (blocked || !orphanSnapshotCurrent(snapshot)) {
            closeOrphanConfirmation()
            setUpdateNotice(blocked || "update.orphanChanged")
            return
          }
          setEntries((previous) => { const next = { ...previous }; delete next[snapshot.id]; return next })
          closeOrphanConfirmation()
          setOrphanView("")
          setUpdateNotice("update.orphanDiscarded")
        }
        const askDiscardOrphan = (id, shown) => {
          if (!updateOperation.current.alive) return
          const snapshot = { ...shown, id }
          const blocked = orphanActionBlock()
          if (blocked || !orphanSnapshotCurrent(snapshot)) { setUpdateNotice(blocked || "update.orphanChanged"); return }
          const value = snapshot.entries[id].value
          snapshot.name = value.name || id
          orphanConfirmation.current = snapshot
          orphanAcknowledgement.current = false
          setOrphanAcknowledged(false)
          if (renderable(A.RiskConfirmation)) setOrphanDialog(snapshot)
          else if (typeof window !== "undefined" && typeof window.confirm === "function" &&
              window.confirm(fillPlaceholders(t("update.orphanConfirm"), { name: snapshot.name, id }))) {
            orphanAcknowledgement.current = true
            discardOrphan(snapshot)
          } else closeOrphanConfirmation()
        }

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
          if (operation.current.current !== null && options?.force !== true) return
          setEntries((previous) => {
            const current = previous[selected]
            if (current === undefined) return previous
            return { ...previous, [selected]: { ...current, value: { ...current.value, ...patch } } }
          })
          setStatus("")
        }

        const pick = async (id) => {
          return runOperation("status.reading", "msg.readFailed", async (token) => {
            setSelected(id)
            setDeleteOpen(false)
            setAcknowledged(false)
            setStatus("")
            setFailed(false)
            await open(id, { force: id === selected }, token)
          })
        }

        const reread = (discard = false) => runOperation("status.reading", "msg.readFailed", async (token) => {
          setStatus("")
          setFailed(false)
          await reload(selected, { discard }, token)
        })

        /** Create a new assistant, or duplicate the selected one. */
        const create = async (options) => {
          if (operation.current.current !== null) return
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
          return runOperation("status.creating", "msg.createFailed", async (token) => {
            const body = { name, locale: activeLanguage(localeRef) }
            if (from !== undefined) body.from = from
            else if (postureChoices.some((item) => item.id === posture)) body.posture = posture
            const result = await postJson(ROUTES.create, body)
            if (!ownsOperation(token)) return
            showResult(result, from === undefined ? "msg.created" : "msg.duplicated", "msg.createFailed")
            if (result?.ok === true || result?.persisted === true) {
              setNewName("")
              await refreshAfterWrite(result, from === undefined ? "msg.created" : "msg.duplicated", result.id, token, () => reload(result.id, undefined, token))
            }
          })
        }

        const duplicate = () => create({ from: draft.id, name: copyName(t("assistant.copyName"), draft.name || draft.id) })

        /**
         * Move the selected assistant one slot in the picker order.
         *
         * Reordering must not cost the user their edits, so this reloads with `discard: false`
         * (the default) and only the roster order changes.
         */
        const move = async (direction) => {
          return runOperation("status.reordering", "msg.reorderFailed", async (token) => {
            const result = await postJson(ROUTES.reorder, { id: draft.id, direction })
            if (!ownsOperation(token)) return
            showResult(result, "msg.reordered", "msg.reorderFailed")
            if (result?.ok === true || result?.persisted === true) {
              await refreshAfterWrite(result, "msg.reordered", draft.id, token, () => reload(draft.id, undefined, token))
            }
          })
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
          return runOperation("status.reading", "msg.loadFailed", async (token) => {
            // 版本键是序号（时间戳会在同一毫秒内撞车 —— 单测就是那样抓到它的）。
            const response = await fetch(ROUTES.history + "?id=" + encodeURIComponent(draft.id) + "&n=" + encodeURIComponent(picked))
            const payload = await asJson(response)
            if (!ownsOperation(token)) return
            if (payload === null || payload.ok !== true) {
              setFailed(true)
              setStatus(t("msg.loadFailed"))
              return
            }
            update({ prompt: payload.text }, { force: true })
            setFailed(false)
            setStatus(t("msg.loaded"))
          })
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
        const importPrompt = async (event) => {
          const input = event !== null && event !== undefined ? event.target : undefined
          const file = input !== null && input !== undefined && input.files !== undefined ? input.files[0] : undefined
          // Reset so picking the same file twice in a row fires `change` again.
          if (input !== null && input !== undefined) input.value = ""
          if (operation.current.current !== null) return
          if (file === undefined || file === null) return
          if (file.size > 1_000_000) {
            setFailed(true)
            setStatus(t("msg.importTooLarge"))
            return
          }
          return runOperation("status.importing", "msg.importFailed", async (token) => {
            const text = await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
              reader.onerror = () => reject(reader.error || new Error(t("msg.importFailed")))
              reader.onabort = () => reject(new Error(t("msg.importFailed")))
              reader.readAsText(file, "utf-8")
            })
            if (!ownsOperation(token)) return
            if (text.trim() === "") {
              setFailed(true)
              setStatus(t("msg.importEmpty"))
              return
            }
            update({ prompt: text }, { force: true })
            setFailed(false)
            setStatus(t("msg.imported"))
          })
        }

        const remove = async (id) => {
          return runOperation("status.deleting", "msg.deleteFailed", async (token) => {
            const result = await postJson(ROUTES.delete, { id })
            if (!ownsOperation(token)) return
            showResult(result, "msg.deleted", "msg.deleteFailed")
            if (result?.ok === true || result?.persisted === true) {
              setDeleteOpen(false)
              setAcknowledged(false)
              setEntries((previous) => {
                const next = { ...previous }
                delete next[id]
                return next
              })
              await refreshAfterWrite(result, "msg.deleted", "", token, () => reload("", undefined, token))
            }
          })
        }

        /**
         * Ask before deleting.
         *
         * With the shell's `RiskConfirmation` the user must tick an acknowledgement — it is an
         * irreversible loss of their own text. A shell without that atom gets the plain native
         * confirmation instead of losing the guardrail entirely.
         */
        const askDelete = () => {
          if (renderable(A.RiskConfirmation)) {
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
          if (draft === null) return
          return runOperation("status.saving", "msg.saveFailed", async (token) => {
            const savedHistory = entry?.saved?.history
            const newest = Array.isArray(savedHistory) && savedHistory.length > 0 ? savedHistory[0].n : undefined
            const result = await postJson(ROUTES.state, {
              id: draft.id,
              mode: draft.mode,
              overrides: draft.overrides,
              prompt: draft.prompt,
              name: draft.name,
              description: draft.description,
              ...(typeof newest === "number" ? { baseN: newest } : {}),
            })
            if (!ownsOperation(token)) return
            if (result?.synchronized === false) setSyncNeeded(true)
            else if (result?.synchronized === true) setSyncNeeded(false)
            if (result !== null && result !== undefined && result.ok === true) {
              setFailed(false)
              const compositionChanged =
                entry !== undefined &&
                (draft.mode !== entry.saved.mode ||
                  JSON.stringify(draft.overrides) !== JSON.stringify(entry.saved.overrides))
              const spoken =
                result.code === "saved" && compositionChanged !== true ? { ...result, code: "savedPrompt" } : result
              setStatus(apiText(spoken, "msg.saved"))
              // The server normalises what it stores (trimmed name, recomputed overrides),
              // so the just-saved draft is replaced by what it actually wrote. Without this
              // the page would show 「已保存」 and 「未保存」 at the same time.
              await refreshAfterWrite(spoken, "msg.saved", draft.id, token, async () => {
                const fresh = await fetchState(draft.id)
                if (!ownsOperation(token)) return
                if (fresh?.ok !== true) throw new Error(apiText(fresh, "msg.readFailed"))
                const normalized = draftOf(fresh)
                setEntries((previous) => ({
                  ...previous,
                  [draft.id]: { payload: fresh, saved: normalized, value: normalized },
                }))
                await refreshNames(token)
              })
            } else {
              setFailed(true)
              setStatus(apiText(result, "msg.saveFailed"))
            }
          })
        }

        const retrySync = () => runOperation("status.synchronizing", "msg.syncFailed", async (token) => {
          const result = await postJson(ROUTES.sync, {})
          if (!ownsOperation(token)) return
          showResult(result, "msg.synchronized", "msg.syncFailed")
          if (result?.ok === true) {
            await refreshAfterWrite(result, "msg.synchronized", selected, token, () => reload(selected, undefined, token))
          }
        })

        const retryRead = () => {
          if (refreshNeeded === null) return
          const { result, fallbackKey, targetId } = refreshNeeded
          return runOperation("status.reading", "msg.readFailed", (token) =>
            refreshAfterWrite(result, fallbackKey, targetId, token, async () => {
              await reload(targetId, undefined, token)
              if (ownsOperation(token)) showResult(result, fallbackKey, fallbackKey)
            }),
          )
        }

        const assistants = list === null ? [] : list
        const position = assistants.findIndex((item) => item.id === selected)
        const statusClass = busy
          ? "cpfe-status"
          : failed
          ? "cpfe-status cpfe-err"
          : dirty
            ? "cpfe-status cpfe-dirty"
            : "cpfe-status cpfe-ok"
        const shown = pending !== "" ? t(pending) : dirty && status === "" ? t("msg.unsaved") : status
        const feedback = [
          refreshNeeded !== null
            ? react.createElement(A.Button, { variant: "outline", disabled: busy, onClick: retryRead }, t("btn.retryRead"))
            : null,
          refreshNeeded === null && !editorReady && failed && list !== null && selected !== ""
            ? react.createElement(A.Button, { variant: "outline", disabled: busy, onClick: () => reread() }, t("btn.reload"))
            : null,
          syncNeeded
            ? react.createElement(A.Button, { variant: "outline", disabled: busy, onClick: retrySync }, t("btn.retrySync"))
            : null,
          react.createElement("span", { className: statusClass, role: "status", "aria-live": "polite", "aria-atomic": true }, shown),
        ]
        const createGroup = react.createElement(
          "section",
          { className: "cpfe-create" },
          react.createElement("h2", { className: "cpfe-h" }, t("create.heading")),
          react.createElement(SectionHint, { text: t("posture.hint") }),
          react.createElement(
            "div",
            { className: "cpfe-branch" },
            postureChoices.length === 0
              ? null
              : react.createElement(
                  "div",
                  { className: "cpfe-node" },
                  react.createElement("span", { className: "cpfe-node-label" }, t("tree.posture")),
                  react.createElement(
                    "div",
                    { className: "cpfe-pills", role: "radiogroup", "aria-label": t("tree.posture") },
                    postureChoices.map((item) =>
                      react.createElement(
                        A.Pill,
                        {
                          key: item.id,
                          active: item.id === posture,
                          disabled: busy,
                          "aria-pressed": item.id === posture,
                          onClick: () => setPosture(item.id),
                        },
                        t("posture." + item.id + ".label", item.id),
                      ),
                    ),
                  ),
                  react.createElement("p", { className: "cpfe-note" }, t("posture." + posture + ".note", "")),
                ),
            react.createElement(
              "div",
              { className: "cpfe-node" },
              react.createElement("span", { className: "cpfe-node-label" }, t("tree.base")),
              react.createElement("p", { className: "cpfe-note" }, t("tree.baseLocked")),
            ),
            react.createElement(
              "div",
              { className: "cpfe-newrow" },
            react.createElement(A.Input, {
              className: "cpfe-newinput",
              value: newName,
              disabled: busy,
              placeholder: t("assistant.newPlaceholder"),
              "aria-label": t("assistant.newPlaceholder"),
              onKeyDown: (event) => {
                if (event.key === "Enter" && busy !== true) create()
              },
              onChange: (event) => {
                setNewName(event.target.value)
                setStatus("")
              },
            }),
            react.createElement(
              A.Button,
              {
                variant: "outline",
                icon: A.IconPlusOutline16 === undefined ? null : react.createElement(A.IconPlusOutline16),
                disabled: busy,
                onClick: () => create(),
              },
              pending === "status.creating" ? t("btn.creating") : t("btn.create"),
            ),
            ),
            react.createElement("p", { className: "cpfe-note" }, t("create.nextStep")),
          ),
        )

        // ── assistant list ────────────────────────────────────────────────────
        const nativeUpdates = hasNativeUpdates(updateServices)
        const updateAllowed = nativeUpdates && updateServices.list && updateServices.versions
        const checkedUpdate = updateResult?.revision === updateServices.revision ? updateResult : null
        const navigationBlock = updateNavigationBlock()
        const updateText = updateChecking ? t("update.checking") : checkedUpdate
          ? fillPlaceholders(t(checkedUpdate.key), { version: checkedUpdate.candidate })
          : !nativeUpdates ? t("update.unavailable") : !updateAllowed ? t("update.permission") : t("update.idle")
        const shownOrphans = orphanDrafts()
        const orphanSnapshot = { entries: heldEntries.current, roster: heldRoster.current, newName: navigationState.current.newName }
        const updateSection = react.createElement(
          "section", { className: "cpfe-update", "aria-label": t("update.heading"), "aria-busy": updateChecking },
          react.createElement("div", { className: "cpfe-update-meta" },
            react.createElement("h2", { className: "cpfe-h" }, t("update.heading")),
            react.createElement("p", { className: "cpfe-version" }, fillPlaceholders(t("update.running"), { version: runtimeVersion || t("update.unknown") })),
            react.createElement("p", { id: "cpfe-update-status", className: "cpfe-sub cpfe-update-note", role: "status", "aria-live": "polite", "aria-atomic": true }, updateText),
            checkedUpdate?.installed && checkedUpdate.installed !== runtimeVersion
              ? react.createElement("p", { className: "cpfe-sub cpfe-update-note" }, fillPlaceholders(t("update.disk"), { version: checkedUpdate.installed })) : null,
            checkedUpdate?.omitted > 0
              ? react.createElement("p", { className: "cpfe-sub" }, fillPlaceholders(t("update.omitted"), { count: checkedUpdate.omitted })) : null,
            checkedUpdate?.candidate && !updateServices.update ? react.createElement("p", { className: "cpfe-sub" }, t("update.updatePermission")) : null,
            updateNotice || navigationBlock ? react.createElement("p", { className: "cpfe-sub", role: "status" }, t(updateNotice || navigationBlock)) : null,
            shownOrphans.length > 0 ? react.createElement("div", { className: "cpfe-warns cpfe-update-note" },
              react.createElement("p", { className: "cpfe-sub" }, t("update.orphanHint")),
              ...shownOrphans.map(([id, held]) => react.createElement("div", { key: id, className: "cpfe-node" },
                react.createElement("span", { className: "cpfe-row-head" }, fillPlaceholders(t("update.orphanName"), { name: held.value.name || id, id })),
                react.createElement(A.Button, { variant: "ghost", className: "cpfe-disclosure", "aria-expanded": orphanView === id,
                  onClick: () => setOrphanView(orphanView === id ? "" : id) }, t(orphanView === id ? "update.orphanHide" : "update.orphanView")),
                orphanView === id ? react.createElement("div", { className: "cpfe-node" },
                  react.createElement("p", { className: "cpfe-sub" }, t("update.orphanCopy")),
                  react.createElement("textarea", { className: "cpfe-editor cpfe-orphan-editor", readOnly: true, spellCheck: false,
                    "aria-label": fillPlaceholders(t("update.orphanName"), { name: held.value.name || id, id }),
                    value: JSON.stringify({ id, name: held.value.name, description: held.value.description, mode: held.value.mode, overrides: held.value.overrides, prompt: held.value.prompt }, null, 2) }),
                  react.createElement(A.Button, { variant: "outline", className: "cpfe-disclosure", disabled: orphanActionBlock() !== "",
                    onClick: () => askDiscardOrphan(id, orphanSnapshot) }, t("update.orphanDiscard")),
                ) : null,
              )),
            ) : null,
          ),
          react.createElement("div", { className: "cpfe-update-actions" },
            react.createElement(A.Button, {
              variant: "outline", disabled: busy || updateChecking || !updateAllowed,
              "aria-describedby": "cpfe-update-status", onClick: checkUpdates,
            }, t(updateChecking ? "update.checking" : "update.check")),
            react.createElement(A.Button, {
              variant: "outline",
              disabled: navigationBlock !== "" || ((nativeUpdates || updateServices.accessKnown) && !updateServices.list) || typeof updateServices.navigation?.openBundle !== "function" ||
                (!!checkedUpdate?.candidate && !updateServices.update),
              title: navigationBlock ? t(navigationBlock) : undefined,
              onClick: openPluginDetails,
            }, t(checkedUpdate?.candidate ? "update.inPlugins" : "update.details")),
            react.createElement("a", {
              className: "cpfe-update-guide",
              href: "https://github.com/BOWLUNA/dsh-custom-mode/blob/main/README" + (activeLanguage(localeRef) === "zh" ? ".zh" : "") + ".md#plugin-updates",
              target: "_blank", rel: "noopener noreferrer", "aria-disabled": navigationBlock !== "",
              onClick: (event) => { if (!guardUpdateNavigation()) event.preventDefault() },
            }, t("update.guide")),
          ),
        )

        const selectedAssistantLabel = (assistants.find((item) => item.id === selected) || {}).name || selected || t("assistant.heading")
        const pickedHistoryEntry = draft === null || draft.historyPick === "" ? undefined : draft.history.find((item) => String(item.n) === draft.historyPick)
        const historySelectionLabel = pickedHistoryEntry === undefined
          ? t("history.pick")
          : formatWhen(pickedHistoryEntry.at) + " · " + t("history.by." + pickedHistoryEntry.by)
        const assistantList = react.createElement(
          "section",
          null,
          react.createElement("h2", { className: "cpfe-h" }, t("assistant.heading")),
                react.createElement(SectionHint, { text: t("assistant.hint") }),
          list === null
            ? react.createElement(
                "div",
                null,
                react.createElement("p", { className: "cpfe-sub" }, listFailed ? t("msg.readFailed") : t("assistant.loadingList")),
                listFailed
                  ? react.createElement(A.Button, { disabled: busy, onClick: () => reread() }, t("btn.reload"))
                  : null,
              )
            : assistants.length === 0
              ? react.createElement("p", { className: "cpfe-sub" }, t("assistant.empty"))
              : react.createElement(
                  // 官方的"选择"就是壳的 `Menu`：一个灰底按钮 + chevron，浮层里是选项
                  // （通用设置页的「权限 / 语言 / 工作步骤展示」都是这个形态）。原来是一排 pill
                  // 药丸 + 描边，是页面上最"不像官方"的一块。
                  "div",
                  { className: "cpfe-picker" },
                  renderable(A.Menu)
                    ? react.createElement(A.Menu, {
                        open: assistantOpen,
                        className: "cpfe-selector-menu",
                        // ★ portal：不把浮层渲染在我们的容器里。设置面板有裁剪与叠层，非 portal 的
                        //   菜单会被裁掉表面，只剩文字"压"在下面的输入框上（实测截图如此）。
                        portal: true,
                        align: "start",
                        side: "bottom",
                        selectedId: selected,
                        anchor: react.createElement(
                          A.Button,
                          {
                            variant: "toolbar",
                            className: "cpfe-selector",
                            title: selectedAssistantLabel,
                            disabled: busy,
                            onClick: () => setAssistantOpen((open) => open !== true),
                          },
                          react.createElement("span", { className: "cpfe-selector-label" }, selectedAssistantLabel),
                          // 官方设置项的下拉是「文字在左、chevron 在右」（实测「通用设置」页的
                          // 「工作区内修改 / 中文 / 详细」都是这个形态）⇒ 图标放在 children 末尾，
                          // 不走 `icon` prop —— 那个会渲染到文字**前面**，成为页面上唯一一个反向的下拉。
                          renderable(A.IconChevronDownOutline14)
                            ? react.createElement(A.IconChevronDownOutline14, { size: 14, className: "cpfe-selector-chevron", "aria-hidden": true })
                            : null,
                        ),
                        items: assistants.map((item) => ({
                          id: item.id,
                          label:
                            (item.name || item.id) +
                            (dirtyIds.has(item.id) ? " · " + t("msg.unsaved") : "") +
                            (typeof item.broken === "string" && item.broken !== "" ? " · " + t("assistant.broken") : ""),
                        })),
                        onSelect: (id) => {
                          setAssistantOpen(false)
                          pick(id)
                        },
                        onClose: () => setAssistantOpen(false),
                      })
                    : react.createElement(
                        "div",
                        { className: "cpfe-pills" },
                        assistants.map((item) =>
                          react.createElement(
                            "span",
                            { key: item.id, className: "cpfe-pill-wrap" },
                            react.createElement(
                              A.Pill,
                              { active: item.id === selected, disabled: busy, title: item.id, onClick: () => pick(item.id) },
                              item.name || item.id,
                            ),
                            dirtyIds.has(item.id) ? react.createElement(A.Tag, { tone: "warning" }, t("msg.unsaved")) : null,
                            typeof item.broken === "string" && item.broken !== ""
                              ? react.createElement(
                                  A.Tag,
                                  { tone: "danger", title: t("assistant.brokenHint") },
                                  Array.isArray(item.brokenRows) && item.brokenRows.length > 0
                                    ? fillPlaceholders(t("assistant.brokenRows"), { count: item.brokenRows.length })
                                    : t("assistant.broken"),
                                )
                              : null,
                          ),
                        ),
                      ),
                  dirtyIds.has(selected) ? react.createElement(A.Tag, { tone: "warning" }, t("msg.unsaved")) : null,
                  typeof (assistants.find((item) => item.id === selected) || {}).broken === "string"
                    ? react.createElement(
                        A.Tag,
                        { tone: "danger", title: t("assistant.brokenHint") },
                        (() => {
                          const current = assistants.find((item) => item.id === selected) || {}
                          return Array.isArray(current.brokenRows) && current.brokenRows.length > 0
                            ? fillPlaceholders(t("assistant.brokenRows"), { count: current.brokenRows.length })
                            : t("assistant.broken")
                        })(),
                      )
                    : null,
                ),
          editorReady
            ? react.createElement(
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
              )
            : null,
          typeof (assistants.find((item) => item.id === selected) || {}).broken === "string"
            ? react.createElement("p", { className: "cpfe-note" }, t("assistant.brokenHint"))
            : null,
          null,
        )

        // ── editor ────────────────────────────────────────────────────────────
        const editorSections = editorReady
          ? [
              react.createElement(
                "section",
                { key: "name" },
                react.createElement("h2", { className: "cpfe-h" }, t("name.heading")),
                react.createElement(SectionHint, { text: t("name.hint") }),
                react.createElement(A.Input, {
                  className: "cpfe-field",
                  disabled: busy,
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
                  // 忙碌期间只读（issue #6）。**描述框在 DOM 里排在提示词编辑器前面**，
                  // 所以只给 `.cpfe-editor` 加 readOnly 是不够的 —— 实测就是这么漏掉的。
                  readOnly: busy === true,
                  placeholder: t("name.descriptionPlaceholder"),
                  "aria-label": t("name.descriptionPlaceholder"),
                  onChange: (event) => update({ description: event.target.value }),
                }),
              ),
              react.createElement(
                "section",
                { key: "mode" },
                react.createElement("h2", { className: "cpfe-h" }, t("mode.heading")),
                react.createElement(SectionHint, { text: t("mode.hint") }),
                // 降级态（本机这条线没有可读的出厂组成）：不给可点的模式药丸，改说一句为什么 ——
                // 点了也只会拿到一个服务端错误，那比置灰更糟。
                draft.baseUnavailable !== null
                  ? react.createElement("p", { className: "cpfe-note" }, t("mode.unavailable"))
                  : react.createElement(
                      "div",
                      { className: "cpfe-pills", "data-live": "base" },
                      payload.modes.map((mode) =>
                        react.createElement(
                          A.Pill,
                          {
                            key: mode.id,
                            active: draft.mode === mode.id,
                            disabled: busy,
                            "aria-pressed": draft.mode === mode.id,
                            onClick: () => pickMode(mode.id),
                          },
                          t("base." + mode.id + ".label", mode.label),
                        ),
                      ),
                    ),
                draft.baseUnavailable !== null
                  ? null
                  : react.createElement(
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
                draft.baseUnavailable !== null
                  ? react.createElement("p", { className: "cpfe-note" }, t("rows.unavailable"))
                  : react.createElement(
                      "div",
                      null,
                      react.createElement(A.Input, {
                        className: "cpfe-field cpfe-filter",
                        disabled: busy,
                        value: rowQuery,
                        placeholder: t("rows.filterPlaceholder"),
                        "aria-label": t("rows.filterPlaceholder"),
                        onChange: (event) => setRowQuery(event.target.value),
                      }),
                      react.createElement(RowList, {
                        expanded: expandedRows,
                        onToggleExpand: toggleRowExpanded,
                        rows: filterRows(payload.rows, rowQuery, t),
                        overrides: draft.overrides,
                        onToggle: (id, next) => {
                          if (draft.mode !== savedMode) return
                          update({ overrides: { ...draft.overrides, [id]: next } })
                        },
                        depth: 0,
                        t: t,
                        disabled: busy === true || draft.mode !== savedMode,
                      }),
                    ),
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
                        variant: "ghost",
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
                react.createElement(SectionHint, { text: t("prompt.hint") }),
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
                      // 与助手切换同一个形态：官方的下拉是壳的 Menu（灰底按钮 + chevron + 浮层），
                      // 而不是浏览器原生 `<select>`（后者的外观由浏览器决定，与官方界面完全不同）。
                      renderable(A.Menu)
                        ? react.createElement(A.Menu, {
                            open: historyOpen,
                            className: "cpfe-selector-menu",
                            portal: true,
                            align: "start",
                            side: "bottom",
                            selectedId: draft.historyPick,
                            anchor: react.createElement(
                              A.Button,
                              {
                                variant: "toolbar",
                                className: "cpfe-selector",
                                title: historySelectionLabel,
                                disabled: busy,
                                onClick: () => setHistoryOpen((open) => open !== true),
                              },
                              react.createElement("span", { className: "cpfe-selector-label" }, historySelectionLabel),
                              renderable(A.IconChevronDownOutline14)
                                ? react.createElement(A.IconChevronDownOutline14, { size: 14, className: "cpfe-selector-chevron", "aria-hidden": true })
                                : null,
                            ),
                            items: draft.history.map((entry) => ({
                              id: String(entry.n),
                              label: formatWhen(entry.at) + " · " + t("history.by." + entry.by) + " · " + String(entry.bytes) + " B",
                            })),
                            onSelect: (id) => {
                              setHistoryOpen(false)
                              update({ historyPick: id })
                            },
                            onClose: () => setHistoryOpen(false),
                          })
                        : react.createElement(
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
                          title: t("history.hint"),
                          onClick: loadVersion,
                        },
                        t("history.load"),
                      ),
                    ),
              ),
            ]
          : []

        return react.createElement(
          "div",
          // `cpfe-busy` 是 issue #6 的兜底：面板里**所有**会改草稿的控件在忙碌期间一律不可交互。
          // 逐个控件加 `disabled` 会漏（本轮就漏了行开关与描述框），一个根类 + 一条 CSS 反而漏不掉。
          { className: busy === true ? "cpfe cpfe-busy" : "cpfe", "aria-busy": busy === true },
          updateSection,
          assistantList,
          editorReady ? null : react.createElement("div", { className: "cpfe-bar" }, ...feedback),
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
                    react.createElement(
                      "p",
                      { className: "cpfe-warn" },
                      // 图标与文本分成两个节点：文本单独包一层 span，`align-items:flex-start`
                      // 才能把图标钉在**第一行**，而不是让它在一段多行告警里垂直居中。
                      // 壳没提供图标时退回原来的 "⚠" 字符。
                      renderable(A.IconWarningOutline14)
                        ? react.createElement(A.IconWarningOutline14, { size: 14 })
                        : "⚠",
                      react.createElement("span", null, t("warn." + code)),
                    ),
                    // 平台自己给的那句话（`state.broken`，形如
                    // `tool-workflow (@deepseek-ai/dsh-tool-workflow): waiting for workflowEngine`）。
                    //
                    // ★ 以前它只在 API 载荷里，**页面上根本不渲染** —— 而 `warn.presetBroken` 的文案却写着
                    //   「宿主给的原因见「详情」」，那个「详情」里从来没有它。文本在说谎，用户按提示去找也找不到。
                    //   现在把它原样印在告警下面：那是平台的原始信息、不是我们的行文，所以用等宽体单独成行。
                    code === "presetBroken" && typeof draft.broken === "string" && draft.broken !== ""
                      ? react.createElement(
                          "p",
                          { className: "cpfe-note cpfe-mono", title: draft.broken },
                          t("detail.hostReason") + draft.broken,
                        )
                      : null,
                    // 本线起不来的行可以一键修（只关掉那几行；用户创建它的那个版本可能早于播种改为派生的版本）。
                    //
                    // ★ 两个 code 都要给按钮：`presetBroken` 说的是"平台判它 broken，而『无法解析』解释不了"
                    //   —— 那正是**修复按钮唯一还帮得上的时候**。原先只认 `unresolvableRows`，于是
                    //   第一轮修复之后 `unresolvable` 变空、按钮消失，而告警文案还在叫用户"点右侧的
                    //   按本线修复"。实测（2026-10-01，桌面端）就是卡在这一步：能看见病，没有药。
                    code === "unresolvableRows" || code === "presetBroken"
                      ? react.createElement(
                          A.Button,
                          { disabled: busy, onClick: repairRowsNow },
                          t("btn.repair"),
                        )
                      : null,
                  ),
                ),
              ),
          editorReady
            ? react.createElement(
                "section",
                null,
                react.createElement("h2", { className: "cpfe-h" }, t("editor.heading")),
                react.createElement(SectionHint, { text: fillPlaceholders(t("editor.hint"), { name: draft.name || draft.id }) }),
                react.createElement(
                  "div",
                  { className: "cpfe-branch" },
                  editorSections.filter((section) => section.key === "prompt"),
                  react.createElement(
            "div",
            { className: "cpfe-bar" },
            react.createElement(
              A.Button,
              {
                variant: "primary",
                icon: A.IconCheckOutline14 === undefined ? null : react.createElement(A.IconCheckOutline14),
                disabled: busy || syncNeeded || editorReady === false || dirty === false,
                onClick: save,
              },
              pending === "status.saving" ? t("btn.saving") : t("btn.save"),
            ),
            react.createElement(
              A.Button,
              {
                variant: "outline",
                icon: A.IconRefreshOutline16 === undefined ? null : react.createElement(A.IconRefreshOutline16),
                disabled: busy,
                // Explicitly destructive of the local draft, so it says so while there is
                // one: switching assistants never discards edits, and this button is the
                // one place that does.
                onClick: () => {
                  if (dirty && typeof window !== "undefined" && window.confirm(t("btn.reloadConfirm")) !== true) return
                  reread(true)
                },
              },
              dirty ? t("btn.reloadDiscard") : t("btn.reload"),
            ),
            ...feedback,
          ),
          ...(editorReady ? editorSections.filter((section) => section.key === "name") : []),
          ...(editorReady ? editorSections.filter((section) => section.key === "mode") : []),
          editorReady
            ? react.createElement(
                "section",
                null,
                react.createElement(
                  A.Button,
                  {
                    variant: "ghost",
                    disabled: busy,
                    "data-cap": "toggle",
                    className: "cpfe-disclosure",
                    "aria-expanded": capOpen,
                    "aria-label": capOpen ? t("cap.collapse") : t("cap.expand"),
                    onClick: () => setCapOpen((open) => open !== true),
                  },
                  renderable(capOpen ? A.IconChevronDownOutline14 : A.IconChevronRightOutline14)
                    ? react.createElement(capOpen ? A.IconChevronDownOutline14 : A.IconChevronRightOutline14, { size: 14 })
                    : capOpen
                      ? "▾"
                      : "▸",
                  t("rows.heading"),
                ),
                capOpen
                  ? react.createElement(
                      "div",
                      null,
                      react.createElement(SectionHint, { text: t("cap.hint") }),
                      editorSections.filter((section) => section.key === "rows"),
                    )
                  : null,
              )
            : null,
                ),
              )
            : null,
          createGroup,
          // The confirmation is a portal: rendering it here keeps every piece of this page's
          // state in one component.
          renderable(A.RiskConfirmation) && orphanDialog !== null
            ? react.createElement(A.RiskConfirmation, {
                open: true, title: t("update.orphanDiscard"),
                description: fillPlaceholders(t("update.orphanConfirm"), { name: orphanDialog.name, id: orphanDialog.id }),
                acknowledgeLabel: t("update.orphanAcknowledge"), acknowledged: orphanAcknowledged,
                onAcknowledgedChange: (value) => {
                  if (!updateOperation.current.alive || orphanConfirmation.current !== orphanDialog) return
                  orphanAcknowledgement.current = value === true
                  setOrphanAcknowledged(value === true)
                },
                cancelLabel: t("btn.cancel"), closeLabel: t("btn.cancel"), confirmLabel: t("update.orphanDiscard"),
                disabled: orphanActionBlock() !== "", onCancel: () => { if (updateOperation.current.alive && orphanConfirmation.current === orphanDialog) closeOrphanConfirmation() },
                onConfirm: () => discardOrphan(orphanDialog),
              })
            : null,
          renderable(A.RiskConfirmation) && editorReady
            ? react.createElement(A.RiskConfirmation, {
                open: deleteOpen,
                title: fillPlaceholders(t("delete.title"), { name: draft.name || draft.id }),
                description: fillPlaceholders(t("delete.description"), { id: draft.id, name: draft.name || draft.id }),
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
          try { mountUpdateServices(ctx) }
          catch { console.warn("dsh-custom-mode: optional native update services unavailable") }
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
