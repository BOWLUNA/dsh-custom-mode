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

      const ROUTE = "/custom-mode"

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
        "msg.importEmpty": "这个文件是空的。",
        "msg.importTooLarge": "文件太大（上限 1MB）。",
        "msg.exported": "已导出为文件。",
        "msg.exportFailed": "导出失败",
        "delete.title": "永久删除这个助手？",
        "delete.description": "这会删除磁盘上的模式目录，连同它的系统提示词一起消失，无法撤销。正在使用它的会话不受影响；新建会话时它不再出现在选择器里。",
        "delete.acknowledge": "我明白这个助手的提示词会被永久删除",
        "delete.confirm": "永久删除",
        "delete.close": "关闭",
        "delete.plainConfirm": "确定永久删除「{name}」吗？该操作无法撤销。",
        "name.heading": "模式名称",
        "name.hint": "改名只影响显示（模式选择器与上面的助手列表），内部标识和已有会话不受影响。新建会话即可看到新名称。",
        "name.placeholder": "自定义模式",
        "name.descriptionPlaceholder": "模式描述（显示在模式选择器里，可留空）",
        "mode.heading": "基础模式",
        "mode.hint": "选一个官方模式作为底子，下面再按行微调。注意：底子只决定**行集合**与工具能力 —— 本模式的 persona 行始终替换掉底子那一行（提示词由你编辑，complete: false），底子的提示词语义不会被继承。改完保存后，新建会话即生效，不需要重启。",
        "rows.heading": "插件开关",
        "rows.hint": "逐行控制这个模式挂载哪些插件，和官方插件列表一样按行铺开。没拨过的行保持官方默认（含平台判断）；你手动拨了就以你的为准。",
        "prompt.heading": "系统提示词",
        "prompt.hint": "这段文本在每个模型调用前重新读取，所以保存后下一步即生效，且只影响使用这个助手的会话。「导入」把文件读进编辑器（未保存前不写入任何东西）；「导出」把当前文本存成 .md 文件。",
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
        "row.tool-subagent-codex.note": "默认关闭：需要先安装对应 Bundle",
        "row.tool-subagent-claude-code.label": "Claude Code 子代理",
        "row.tool-subagent-claude-code.note": "默认关闭：需要先安装对应 Bundle",
        "row.workflow-ptc.label": "工作流引擎",
        "row.tool-workflow.label": "工作流工具",
        "row.tool-ralph.label": "Ralph 工作流",
        "row.tool-ralph.note": "默认关闭",
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
        "msg.importEmpty": "That file is empty.",
        "msg.importTooLarge": "That file is too large (1 MB limit).",
        "msg.exported": "Exported to a file.",
        "msg.exportFailed": "Export failed",
        "delete.title": "Delete this assistant permanently?",
        "delete.description": "This removes the mode directory from disk, system prompt included, and cannot be undone. Sessions already using it keep running; new sessions no longer offer it.",
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
        "prompt.hint": "This text is re-read before every model call, so a save applies on the next step and only affects sessions on this assistant. \"Import\" reads a file into the editor (nothing is written until you save); \"Export\" saves the current text as a .md file.",
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
        "row.tool-subagent-codex.note": "Off by default: install the matching Bundle first",
        "row.tool-subagent-claude-code.label": "Claude Code subagent",
        "row.tool-subagent-claude-code.note": "Off by default: install the matching Bundle first",
        "row.workflow-ptc.label": "Workflow engine",
        "row.tool-workflow.label": "Workflow tool",
        "row.tool-ralph.label": "Ralph workflow",
        "row.tool-ralph.note": "Off by default",
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
        ".cpfe-note{display:block;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}",
        ".cpfe-mono{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
        ".cpfe-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center}",
        ".cpfe-pill-wrap{display:inline-flex;align-items:center;gap:4px}",
        ".cpfe-actions{display:flex;flex-wrap:wrap;gap:var(--g);align-items:center;margin-top:4px}",
        ".cpfe-newrow{display:flex;gap:var(--g);align-items:center;flex-wrap:wrap;margin-top:10px}",
        ".cpfe-field{display:flex;width:100%;margin-bottom:8px}",
        ".cpfe-row-head{display:block;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}",
        ".cpfe-row-switch{flex:0 0 auto;margin-top:2px}",
        ".cpfe-sec-head{display:flex;align-items:center;justify-content:space-between;gap:var(--g);flex-wrap:wrap}",
        ".cpfe-newinput{flex:1;min-width:200px}",
        ".cpfe-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--g);align-items:stretch;margin-top:4px}",
        ".cpfe-group{grid-column:1/-1;display:flex;flex-direction:column;gap:var(--g)}",
        ".cpfe-kids{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--g);padding-left:16px;border-left:.5px solid var(--dsw-alias-border-l1)}",
        ".cpfe-row{display:flex;gap:12px;align-items:flex-start;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}",
        ".cpfe-row-meta{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}",
        ".cpfe-row-badges{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
        ".cpfe-editor{box-sizing:border-box;width:100%;min-height:240px;resize:vertical;padding:12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:20px}",
        ".cpfe-bar{display:flex;align-items:center;gap:var(--g);flex-wrap:wrap}",
        ".cpfe-status{font-size:13px;line-height:20px}",
        ".cpfe-ok{color:var(--dsw-alias-label-secondary)}",
        ".cpfe-err{color:var(--dsw-alias-state-error-primary)}",
        ".cpfe-dirty{color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-danger{color:var(--dsw-alias-state-error-primary)}",
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
        create: ROUTE + "/create",
        delete: ROUTE + "/delete",
        reorder: ROUTE + "/reorder",
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
      function draftOf(state) {
        return {
          id: state.id,
          mode: state.mode,
          overrides: { ...state.overrides },
          prompt: state.prompt,
          name: typeof state.name === "string" ? state.name : "",
          description: typeof state.description === "string" ? state.description : "",
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

      /** Render one row's switch, recursing into a group's children. */
      function RowList(props) {
        const { rows, overrides, onToggle, depth, t } = props
        return react.createElement(
          "div",
          { className: depth === 0 ? "cpfe-rows" : "cpfe-kids" },
          rows.map((row) => {
            // A row is "on" unless its explicit override says off; without an
            // override the shipped state decides (which is what "跟随默认" means).
            const effective = overrides[row.id] !== undefined ? overrides[row.id] : !row.disabled
            const changed = overrides[row.id] !== undefined
            const rowTitle = t("row." + row.id + ".label", row.label)
            return react.createElement(
              "div",
              { key: row.id, className: row.children.length > 0 ? "cpfe-group" : undefined },
              react.createElement(
                "div",
                { className: "cpfe-row" },
                react.createElement(A.Switch, {
                  checked: effective,
                  onChange: (next) => onToggle(row.id, next),
                  // `Switch` renders NO text: its `label` is the accessible name only, so the
                  // visible title is drawn below (an unlabelled toggle is unusable).
                  label: rowTitle,
                  className: "cpfe-row-switch",
                }),
                react.createElement(
                  "div",
                  { className: "cpfe-row-meta" },
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
                    row.disabledExpression !== null
                      ? react.createElement(A.Tag, { tone: "outline" }, t("tag.followPlatform"))
                      : null,
                    changed ? react.createElement(A.Tag, { tone: "info" }, t("status.changed")) : null,
                  ),
                  react.createElement("span", { className: "cpfe-mono" }, row.id),
                  row.note !== null
                    ? react.createElement("span", { className: "cpfe-note" }, t("row." + row.id + ".note", row.note))
                    : null,
                ),
              ),
              row.children.length > 0
                ? react.createElement(RowList, {
                    rows: row.children,
                    overrides: overrides,
                    onToggle: onToggle,
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
        /** Hidden `<input type="file">` behind the 「导入」 button. */
        const fileInput = react.useRef(null)

        const entry = selected === "" ? undefined : entries[selected]
        const draft = entry === undefined ? null : entry.value
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
            setStatus((result && result.error) || t("msg.readFailed"))
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
            setStatus((result && result.error) || t("msg.readFailed"))
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
                setStatus(t("msg.readFailed") + "：" + describeError(error))
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
        const update = (patch) => {
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
            setStatus(t("msg.readFailed") + "：" + describeError(error))
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
              setStatus(result.note || (from === undefined ? t("msg.created") : t("msg.duplicated")))
              await reload(result.id)
            } else {
              setFailed(true)
              setStatus((result && result.error) || t("msg.createFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(t("msg.createFailed") + "：" + describeError(error))
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
              setStatus(result.note || t("msg.reordered"))
              await reload(draft.id)
            } else {
              setFailed(true)
              setStatus((result && result.error) || t("msg.reorderFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(t("msg.reorderFailed") + "：" + describe(error))
          } finally {
            setBusy(false)
          }
        }

        /** Download the prompt being edited (client-side only — the host is not involved). */
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
            setStatus(t("msg.exportFailed") + "：" + describe(error))
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
              setStatus(result.note || t("msg.deleted"))
              setEntries((previous) => {
                const next = { ...previous }
                delete next[id]
                return next
              })
              await reload("")
            } else {
              setFailed(true)
              setStatus((result && result.error) || t("msg.deleteFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(t("msg.deleteFailed") + "：" + describeError(error))
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
              setStatus(result.note || t("msg.saved"))
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
              setStatus((result && result.error) || t("msg.saveFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(t("msg.saveFailed") + "：" + describeError(error))
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
          react.createElement("p", { className: "cpfe-sub" }, t("assistant.hint")),
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
                react.createElement("p", { className: "cpfe-sub" }, t("name.hint")),
                react.createElement(A.Input, {
                  className: "cpfe-field",
                  value: draft.name,
                  placeholder: t("name.placeholder"),
                  "aria-label": t("name.heading"),
                  onChange: (event) => update({ name: event.target.value }),
                }),
                react.createElement(A.Input, {
                  className: "cpfe-field",
                  value: draft.description,
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
                react.createElement("p", { className: "cpfe-sub" }, t("mode.hint")),
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
              ),
              react.createElement(
                "section",
                { key: "rows" },
                react.createElement("h2", { className: "cpfe-h" }, t("rows.heading")),
                react.createElement("p", { className: "cpfe-sub" }, t("rows.hint")),
                react.createElement(RowList, {
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
                react.createElement("p", { className: "cpfe-sub" }, t("prompt.hint")),
                react.createElement("textarea", {
                  className: "cpfe-editor",
                  value: draft.prompt,
                  spellCheck: false,
                  "aria-label": t("prompt.heading"),
                  onChange: (event) => update({ prompt: event.target.value }),
                }),
              ),
            ]
          : []

        return react.createElement(
          "div",
          { className: "cpfe" },
          assistantList,
          react.createElement("p", { className: "cpfe-note" }, t("assistant.switchHint")),
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
            react.createElement("span", { className: "cpfe-path" }, editorReady ? payload.compositionPath : ""),
          ),
          // The confirmation is a portal: rendering it here keeps every piece of this page's
          // state in one component.
          typeof A.RiskConfirmation === "function" && editorReady
            ? react.createElement(A.RiskConfirmation, {
                open: deleteOpen,
                title: t("delete.title"),
                description: t("delete.description") + "（" + draft.id + "）",
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
