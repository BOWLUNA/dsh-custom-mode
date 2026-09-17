/**
 * Bilingual copy for the 「自定义模式」settings page.
 *
 * Registered with the official `locale` service (`ctx.locale.register(ns, {zh, en})`),
 * and the page is registered with `locale: NS` so the shell hands the component a
 * bound `t` — the same contract the shipped settings plugins use.
 *
 * Row labels are keyed by row id (`row.<id>.label`), derived rather than stored:
 * `composition.mjs` therefore keeps working unchanged for any row it knows, and a
 * row this dictionary does not cover falls back to that source (or to its bare id).
 * Adding a new row to a base mode never requires touching this file.
 *
 * Key-set parity is asserted by `test/locales.test.mjs`: a key present in one
 * language and missing in the other would render as a raw key in that locale.
 */

/** Simplified Chinese dictionary — the key source of truth. */
export const zh = {
  nav: '自定义模式',

  'name.heading': '模式名称',
  'name.hint': '改名只影响显示（模式选择器和这里的导航项），内部标识保持不变，已有会话不受影响。新建会话即可看到新名称。',
  'name.placeholder': '自定义模式',
  'name.descriptionPlaceholder': '模式描述（显示在模式选择器里，可留空）',

  'mode.heading': '基础模式',
  'mode.hint': '选一个官方模式作为底子，下面再按行微调。改完保存后，新建会话即生效，不需要重启。',

  'rows.heading': '插件开关',
  'rows.hint': '逐行控制这个模式挂载哪些插件，和官方插件列表一样按行铺开。没拨过的行保持官方默认（含平台判断）；你手动拨了就以你的为准。',

  'prompt.heading': '系统提示词',
  'prompt.hint': '这一步编辑的文本会在每次模型调用前重新读取，保存后下一步即生效。仅影响使用本模式的会话。',

  'status.enabled': '已启用',
  'status.disabled': '已停用',
  'status.changed': '已改',
  'tag.essential': '基础能力',
  'tag.followPlatform': '跟随平台',

  'btn.save': '保存',
  'btn.saving': '处理中…',
  'btn.reload': '重新读取',

  'msg.unsaved': '有未保存的修改',
  'msg.loading': '正在读取…',
  'msg.notLoaded': '（尚未读取）',
  'msg.reread': '已重新读取',
  'msg.readFailed': '读取失败',
  'msg.saveFailed': '保存失败',
  'msg.saved': '已保存。新建会话即生效，当前会话保持原配置。',

  // ── row labels ────────────────────────────────────────────────────────────
  'row.persona.label': '身份（系统提示词）',
  'row.persona.note': '提示词注入点；关掉后本模式用回部署默认身份',
  'row.custom-prompt-tool.label': 'custom_prompt 工具',
  'row.custom-prompt-tool.note': '关掉后无法用对话改提示词（设置页仍可用）',
  'row.agent-instructions.label': '项目指令 AGENTS.md',
  'row.agent-instructions.note': '读取 AGENTS.md / CLAUDE.md',
  'row.tool-bash.label': 'Shell（bash）',
  'row.tool-pwsh.label': 'Shell（pwsh）',
  'row.tool-fs.label': '文件读写',
  'row.tool-fs.note': '关掉后 agent 无法读写文件',
  'row.tool-fs-search.label': '文件搜索（glob/grep）',
  'row.tool-jobs.label': '后台任务',
  'row.planning.label': '计划模式（分组）',
  'row.planning.note': '含 isolate realm，关掉等于移除整个计划能力',
  'row.plan-mode.label': '计划模式实现',
  'row.compaction.label': '上下文压缩（分组）',
  'row.compaction.note': '含 isolate realm',
  'row.compaction-basic.label': '基础压缩',
  'row.command-compact.label': '/compact 命令',
  'row.tool-result-pruner.label': '工具结果裁剪',
  'row.delegation.label': '委派与工作流（分组）',
  'row.delegation.note': '含 isolate realm；关掉等于移除子代理与工作流',
  'row.tool-subagent.label': '子代理（spawn）',
  'row.tool-subagent-fork.label': '子代理（fork）',
  'row.tool-subagent-control.label': '子代理控制',
  'row.tool-subagent-list-agents.label': '列出子代理',
  'row.tool-subagent-codex.label': 'Codex 子代理',
  'row.tool-subagent-codex.note': '默认关闭：需要先安装对应 Bundle',
  'row.tool-subagent-claude-code.label': 'Claude Code 子代理',
  'row.tool-subagent-claude-code.note': '默认关闭：需要先安装对应 Bundle',
  'row.workflow-ptc.label': '工作流引擎',
  'row.tool-workflow.label': '工作流工具',
  'row.tool-ralph.label': 'Ralph 工作流',
  'row.tool-ralph.note': '默认关闭',
  'row.tool-web.label': '网页检索与抓取',
  'row.tool-skill.label': '技能工具',
  'row.skill-filesystem.label': '技能发现',
  'row.tool-cordis.label': 'Cordis 运行时工具',
  'row.tool-cordis.note': '可读写 harness 运行时',
  'row.tool-plugin-manager.label': '插件管理（安装 / 启停）',
  'row.tool-plugin-manager.note': '模型侧可安装与启停插件；0.1.6-alpha.2 起出厂模式自带这一行',
  'row.tool-presentation.label': 'PTC 工具呈现',
  'row.present.label': '交付文件（present）',
  'row.command-goal.label': '目标命令',
  'row.tool-goal.label': '目标',
  'row.tool-todo.label': '待办清单',
  'row.tool-ask-user.label': '向用户提问',
  'row.persistent-shell.label': '持久 Shell',
  'row.pty.label': 'PTY 终端',
  'row.terminal-bash.label': '终端（bash）',
  'row.persistent-bash.label': '持久 bash',
  'row.terminal-pwsh.label': '终端（pwsh）',
  'row.persistent-pwsh.label': '持久 pwsh',

  // ── base mode labels ──────────────────────────────────────────────────────
  'base.standard.label': '标准模式',
  'base.standard.note': '完整编码能力：Shell、文件、检索、技能、计划、目标、子代理、工作流',
  'base.ptc.label': 'PTC 模式',
  'base.ptc.note': '在标准模式基础上启用 PTC 工具呈现（tool-presentation）',
  'base.minimal.label': '极简模式',
  'base.minimal.note': '只有 Shell 与终端，共 7 行；没有文件、检索、技能、子代理',
  'base.cordis.label': 'Cordis 模式',
  'base.cordis.note': '标准模式 + 读写运行时的 Cordis 工具集，可让 agent 自己改 harness',
}

/** English dictionary; the parity test keeps its key set equal to {@link zh}. */
export const en = {
  nav: 'Custom mode',

  'name.heading': 'Mode name',
  'name.hint':
    'Renaming changes only what is displayed (the mode picker and this nav entry); the internal id stays the same and existing sessions are unaffected. Start a new session to see it.',
  'name.placeholder': 'Custom mode',
  'name.descriptionPlaceholder': 'Mode description (shown in the mode picker, optional)',

  'mode.heading': 'Base mode',
  'mode.hint':
    'Choose an official mode as the base, then fine-tune individual rows below. After saving, a new session picks it up — no restart needed.',

  'rows.heading': 'Plugin switches',
  'rows.hint':
    'Control row by row which plugins this mode mounts, laid out like the official plugin list. Untouched rows keep the official default (platform conditions included); your manual choice wins.',

  'prompt.heading': 'System prompt',
  'prompt.hint':
    'This text is re-read before every model call, so a save applies on the next step. It affects only sessions using this mode.',

  'status.enabled': 'Enabled',
  'status.disabled': 'Disabled',
  'status.changed': 'changed',
  'tag.essential': 'core',
  'tag.followPlatform': 'follows platform',

  'btn.save': 'Save',
  'btn.saving': 'Working…',
  'btn.reload': 'Reload',

  'msg.unsaved': 'Unsaved changes',
  'msg.loading': 'Loading…',
  'msg.notLoaded': '(not loaded)',
  'msg.reread': 'Reloaded',
  'msg.readFailed': 'Load failed',
  'msg.saveFailed': 'Save failed',
  'msg.saved': 'Saved. A new session picks it up; the current one keeps its configuration.',

  // ── row labels ────────────────────────────────────────────────────────────
  'row.persona.label': 'Identity (system prompt)',
  'row.persona.note': 'Where the prompt is injected; turning it off falls back to the deployment identity',
  'row.custom-prompt-tool.label': 'custom_prompt tool',
  'row.custom-prompt-tool.note': 'Without it the prompt can still be edited here, but not by asking the agent',
  'row.agent-instructions.label': 'Project instructions (AGENTS.md)',
  'row.agent-instructions.note': 'Reads AGENTS.md / CLAUDE.md',
  'row.tool-bash.label': 'Shell (bash)',
  'row.tool-pwsh.label': 'Shell (pwsh)',
  'row.tool-fs.label': 'File access',
  'row.tool-fs.note': 'Without it the agent cannot read or write files',
  'row.tool-fs-search.label': 'File search (glob/grep)',
  'row.tool-jobs.label': 'Background jobs',
  'row.planning.label': 'Plan mode (group)',
  'row.planning.note': 'Carries an isolate realm; turning it off removes planning entirely',
  'row.plan-mode.label': 'Plan mode implementation',
  'row.compaction.label': 'Context compaction (group)',
  'row.compaction.note': 'Carries an isolate realm',
  'row.compaction-basic.label': 'Basic compaction',
  'row.command-compact.label': '/compact command',
  'row.tool-result-pruner.label': 'Tool-result pruning',
  'row.delegation.label': 'Delegation and workflows (group)',
  'row.delegation.note': 'Carries an isolate realm; turning it off removes subagents and workflows',
  'row.tool-subagent.label': 'Subagent (spawn)',
  'row.tool-subagent-fork.label': 'Subagent (fork)',
  'row.tool-subagent-control.label': 'Subagent control',
  'row.tool-subagent-list-agents.label': 'List subagents',
  'row.tool-subagent-codex.label': 'Codex subagent',
  'row.tool-subagent-codex.note': 'Off by default: install the matching Bundle first',
  'row.tool-subagent-claude-code.label': 'Claude Code subagent',
  'row.tool-subagent-claude-code.note': 'Off by default: install the matching Bundle first',
  'row.workflow-ptc.label': 'Workflow engine',
  'row.tool-workflow.label': 'Workflow tool',
  'row.tool-ralph.label': 'Ralph workflow',
  'row.tool-ralph.note': 'Off by default',
  'row.tool-web.label': 'Web search and fetch',
  'row.tool-skill.label': 'Skill tool',
  'row.skill-filesystem.label': 'Skill discovery',
  'row.tool-cordis.label': 'Cordis runtime tools',
  'row.tool-cordis.note': 'Can read and modify the running harness',
  'row.tool-plugin-manager.label': 'Plugin manager (install / toggle)',
  'row.tool-plugin-manager.note': 'Lets the agent install and toggle plugins; shipped with the official modes from 0.1.6-alpha.2',
  'row.tool-presentation.label': 'PTC tool presentation',
  'row.present.label': 'Deliverables (present)',
  'row.command-goal.label': 'Goal command',
  'row.tool-goal.label': 'Goals',
  'row.tool-todo.label': 'Todo list',
  'row.tool-ask-user.label': 'Ask the user',
  'row.persistent-shell.label': 'Persistent shell',
  'row.pty.label': 'PTY terminal',
  'row.terminal-bash.label': 'Terminal (bash)',
  'row.persistent-bash.label': 'Persistent bash',
  'row.terminal-pwsh.label': 'Terminal (pwsh)',
  'row.persistent-pwsh.label': 'Persistent pwsh',

  // ── base mode labels ──────────────────────────────────────────────────────
  'base.standard.label': 'Standard',
  'base.standard.note': 'Full coding agent: shell, files, search, skills, planning, goals, subagents, workflows',
  'base.ptc.label': 'PTC',
  'base.ptc.note': 'Standard plus PTC tool presentation (tool-presentation)',
  'base.minimal.label': 'Minimal',
  'base.minimal.note': 'Shell and terminal only, 7 rows; no files, search, skills or subagents',
  'base.cordis.label': 'Cordis',
  'base.cordis.note': 'Standard plus the Cordis toolset, letting the agent modify its own harness',
}
