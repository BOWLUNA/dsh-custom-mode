/**
 * Browser half: 「自定义模式」settings page.
 *
 * Three blocks:
 *   1. 基础模式    — standard / ptc / minimal / cordis.
 *   2. 插件开关    — one switch per composition row; groups show their children.
 *   3. 系统提示词  — the editable prompt text.
 *
 * Hand-written in the client bundle format the module system expects
 * (`window.__ModuleLoader__.load({ id, factory })`). `require("react")` resolves
 * from the shell's static seed table, so no bundler is involved. It talks to its
 * host half over one private HTTP route with `fetch`, so it needs no Remote
 * namespace.
 *
 * Failure policy: everything is wrapped so a broken editor can never take the
 * page down. Worst case is that this settings page does not appear.
 */

try {
  window.__ModuleLoader__.load({
    id: "dsh-custom-prompt-editor",
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

      const ROUTE = "/custom-prompt-editor"

      const NS = "settings.customMode"

      /**
       * Copy for this page, generated from editor/locales.mjs (single source of
       * truth, checked for key parity by test/locales.test.mjs).
       */
      const ZH = {
        "nav": "自定义模式",
        "name.heading": "模式名称",
        "name.hint": "改名只影响显示（模式选择器和这里的导航项），内部标识保持不变，已有会话不受影响。新建会话即可看到新名称。",
        "name.placeholder": "自定义模式",
        "name.descriptionPlaceholder": "模式描述（显示在模式选择器里，可留空）",
        "mode.heading": "基础模式",
        "mode.hint": "选一个官方模式作为底子，下面再按行微调。改完保存后，新建会话即生效，不需要重启。",
        "rows.heading": "插件开关",
        "rows.hint": "逐行控制这个模式挂载哪些插件，和官方插件列表一样按行铺开。没拨过的行保持官方默认（含平台判断）；你手动拨了就以你的为准。",
        "prompt.heading": "系统提示词",
        "prompt.hint": "这一步编辑的文本会在每次模型调用前重新读取，保存后下一步即生效。仅影响使用本模式的会话。",
        "status.enabled": "已启用",
        "status.disabled": "已停用",
        "status.changed": "已改",
        "tag.essential": "基础能力",
        "tag.followPlatform": "跟随平台",
        "btn.save": "保存",
        "btn.saving": "处理中…",
        "btn.reload": "重新读取",
        "msg.unsaved": "有未保存的修改",
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
        "base.minimal.note": "只有 Shell 与终端，共 7 行；没有文件、检索、技能、子代理",
        "base.cordis.label": "Cordis 模式",
        "base.cordis.note": "标准模式 + 读写运行时的 Cordis 工具集，可让 agent 自己改 harness"
      }

      const EN = {
        "nav": "Custom mode",
        "name.heading": "Mode name",
        "name.hint": "Renaming changes only what is displayed (the mode picker and this nav entry); the internal id stays the same and existing sessions are unaffected. Start a new session to see it.",
        "name.placeholder": "Custom mode",
        "name.descriptionPlaceholder": "Mode description (shown in the mode picker, optional)",
        "mode.heading": "Base mode",
        "mode.hint": "Choose an official mode as the base, then fine-tune individual rows below. After saving, a new session picks it up — no restart needed.",
        "rows.heading": "Plugin switches",
        "rows.hint": "Control row by row which plugins this mode mounts, laid out like the official plugin list. Untouched rows keep the official default (platform conditions included); your manual choice wins.",
        "prompt.heading": "System prompt",
        "prompt.hint": "This text is re-read before every model call, so a save applies on the next step. It affects only sessions using this mode.",
        "status.enabled": "Enabled",
        "status.disabled": "Disabled",
        "status.changed": "changed",
        "tag.essential": "core",
        "tag.followPlatform": "follows platform",
        "btn.save": "Save",
        "btn.saving": "Working…",
        "btn.reload": "Reload",
        "msg.unsaved": "Unsaved changes",
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
        "base.minimal.note": "Shell and terminal only, 7 rows; no files, search, skills or subagents",
        "base.cordis.label": "Cordis",
        "base.cordis.note": "Standard plus the Cordis toolset, letting the agent modify its own harness"
      }

      const TRANSLATIONS = { zh: ZH, en: EN }

      /**
       * Display name for the settings nav entry.
       *
       * The slot label is a thunk, which the shell re-reads on every projection, so
       * renaming the mode updates the nav without re-registering the slot.
       */
      let currentLabel = ""

      const CSS = [
        ".cpfe{--g:8px;display:flex;flex-direction:column;gap:24px;width:100%;max-width:900px;box-sizing:border-box;padding-bottom:16px}",
        ".cpfe-h{margin:0 0 4px;font-size:15px;line-height:22px;color:var(--dsw-alias-label-primary)}",
        ".cpfe-sub{margin:0 0 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
        ".cpfe-modes{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--g)}",
        ".cpfe-mode{display:flex;gap:10px;align-items:flex-start;box-sizing:border-box;min-height:64px;padding:12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);cursor:pointer;transition:border-color .12s}",
        ".cpfe-mode:hover{border-color:var(--dsw-alias-label-secondary)}",
        ".cpfe-mode-on{border-color:var(--dsw-alias-label-primary)}",
        ".cpfe-mode input{margin:3px 0 0;cursor:pointer;flex:none}",
        ".cpfe-mode-b{display:flex;flex-direction:column;gap:2px;min-width:0}",
        ".cpfe-mode-t{font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}",
        ".cpfe-mode-n{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}",
        ".cpfe-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--g);align-items:stretch}",
        ".cpfe-group{grid-column:1/-1;display:flex;flex-direction:column;gap:var(--g)}",
        ".cpfe-kids{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--g);padding-left:16px;border-left:.5px solid var(--dsw-alias-border-l1)}",
        ".cpfe-row{display:flex;gap:10px;align-items:flex-start;box-sizing:border-box;min-height:64px;padding:10px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);transition:border-color .12s}",
        ".cpfe-row:hover{border-color:var(--dsw-alias-label-secondary)}",
        ".cpfe-row input{margin:3px 0 0;cursor:pointer;flex:none}",
        ".cpfe-row-b{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}",
        ".cpfe-row-t{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}",
        ".cpfe-row-d{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
        ".cpfe-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}",
        ".cpfe-badge{font-size:11px;line-height:17px;padding:0 6px;border-radius:4px;white-space:nowrap}",
        ".cpfe-on{color:var(--dsw-alias-state-success-primary)}",
        ".cpfe-off{color:var(--dsw-alias-label-secondary)}",
        ".cpfe-tag{font-size:11px;line-height:16px;padding:0 5px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}",
        ".cpfe-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-ess{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-input{box-sizing:border-box;width:100%;height:34px;margin-bottom:8px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
        ".cpfe-editor{box-sizing:border-box;width:100%;min-height:240px;resize:vertical;padding:12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:20px}",
        ".cpfe-bar{display:flex;align-items:center;gap:var(--g);flex-wrap:wrap}",
        ".cpfe-btn{appearance:none;cursor:pointer;padding:0 14px;height:32px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
        ".cpfe-btn:disabled{opacity:.5;cursor:default}",
        ".cpfe-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent;font-weight:500}",
        ".cpfe-status{font-size:13px;line-height:20px}",
        ".cpfe-ok{color:var(--dsw-alias-label-secondary)}",
        ".cpfe-err{color:var(--dsw-alias-state-error-primary)}",
        ".cpfe-dirty{color:var(--dsw-alias-state-warn-primary)}",
        ".cpfe-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
      ].join("")

      /** Apply the page stylesheet once, keyed so a re-mount never duplicates it. */
      function ensureStyles() {
        if (typeof document === "undefined") return
        const tagId = "dsh-custom-prompt-editor/system-prompt"
        if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return
        const tag = document.createElement("style")
        tag.dataset.plugin = "dsh-custom-prompt-editor"
        tag.dataset.pluginCss = tagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }

      const asJson = (response) => response.json()

      /** Everything the page needs, in one round trip. */
      async function fetchState() {
        return asJson(await fetch(ROUTE, { method: "GET", headers: { accept: "application/json" } }))
      }

      /** Persist mode + per-row overrides + prompt text. */
      async function saveState(payload) {
        return asJson(
          await fetch(ROUTE, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(payload),
          }),
        )
      }

      /** Render one row's switches, recursing into a group's children. */
      function RowList(props) {
        const react = require("react")
        const { rows, overrides, onToggle, depth, t } = props
        return react.createElement(
          "div",
          { className: depth === 0 ? "cpfe-rows" : "cpfe-kids" },
          rows.map((row) => {
            // A row is "on" unless its explicit override says off; without an
            // override the shipped state decides (which is what "跟随默认" means).
            const effective = overrides[row.id] !== undefined ? overrides[row.id] : !row.disabled
            const changed = overrides[row.id] !== undefined
            return react.createElement(
              "div",
              { key: row.id, className: row.children.length > 0 ? "cpfe-group" : undefined },
              react.createElement(
                "label",
                { className: "cpfe-row" },
                react.createElement("input", {
                  type: "checkbox",
                  checked: effective,
                  onChange: () => onToggle(row.id, !effective),
                }),
                react.createElement(
                  "span",
                  { className: "cpfe-row-b" },
                  react.createElement(
                    "span",
                    { className: "cpfe-row-t" },
                    t("row." + row.id + ".label", row.label),
                    react.createElement(
                      "span",
                      { className: effective ? "cpfe-badge cpfe-on" : "cpfe-badge cpfe-off" },
                      effective ? t("status.enabled") : t("status.disabled"),
                    ),
                    row.essential ? react.createElement("span", { className: "cpfe-tag cpfe-ess" }, t("tag.essential")) : null,
                    row.disabledExpression !== null
                      ? react.createElement("span", { className: "cpfe-tag" }, t("tag.followPlatform"))
                      : null,
                    changed ? react.createElement("span", { className: "cpfe-tag" }, t("status.changed")) : null,
                  ),
                  react.createElement("span", { className: "cpfe-row-d" }, row.id),
                  row.note !== null ? react.createElement("span", { className: "cpfe-note" }, t("row." + row.id + ".note", row.note)) : null,
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

      /**
       * Whether a preset name is just the shipped default rather than a real
       * customisation.
       *
       * The nav entry has two jobs: follow the language when the user never named
       * the mode, and show the user's own name verbatim once they have. Treating
       * EITHER language's default as "default" is what lets a language switch
       * relabel the entry, while any other value is displayed untouched.
       */
      function isDefaultName(name) {
        if (typeof name !== "string" || name === "") return true
        return name === ZH.nav || name === EN.nav
      }

      function CustomModeSection(props) {
        const react = require("react")
        // Compatibility: a shell that does not hand us a bound `t` (older or
        // changed settings contract) must still render real copy. Falling back to
        // the Chinese dictionary means the worst case is "Chinese text", never a
        // page full of raw keys like `name.heading`.
        const rawT =
          props !== null && typeof props === "object" && typeof props.t === "function"
            ? props.t
            : (key) => (Object.prototype.hasOwnProperty.call(ZH, key) ? ZH[key] : key)
        /**
         * Translate a key, falling back to the shipped text when the dictionary
         * lacks it — an untranslated key degrades to Chinese, never to a bare key.
         */
        const t = (key, fallback) => {
          const value = rawT(key)
          if (typeof value === "string" && value !== "" && value !== key) return value
          return fallback === undefined ? key : fallback
        }
        const [state, setState] = react.useState(null)
        const [draft, setDraft] = react.useState(null)
        const [status, setStatus] = react.useState("")
        const [failed, setFailed] = react.useState(false)
        const [busy, setBusy] = react.useState(false)

        const load = react.useCallback(async (announce) => {
          setBusy(true)
          try {
            const result = await fetchState()
            if (result && result.ok === true) {
              setState(result)
              currentLabel = isDefaultName(result.name) ? "" : result.name
              setDraft({
                mode: result.mode,
                overrides: { ...result.overrides },
                prompt: result.prompt,
                name: typeof result.name === "string" ? result.name : "",
                description: typeof result.description === "string" ? result.description : "",
              })
              setFailed(false)
              if (announce === true) setStatus(t("msg.reread"))
            } else {
              setFailed(true)
              setStatus((result && result.error) || t("msg.readFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(t("msg.readFailed") + "：" + String((error && error.message) || error))
          } finally {
            setBusy(false)
          }
        }, [])

        react.useEffect(() => {
          load(false)
        }, [load])

        if (draft === null || state === null) {
          return react.createElement("p", { className: "cpfe-sub" }, busy ? t("msg.loading") : status || t("msg.notLoaded"))
        }

        const dirty =
          draft.mode !== state.mode ||
          draft.prompt !== state.prompt ||
          draft.name !== state.name ||
          draft.description !== state.description ||
          JSON.stringify(draft.overrides) !== JSON.stringify(state.overrides)

        const pickMode = (mode) => {
          // Switching base mode keeps explicit row overrides: rows that exist in
          // the new mode keep their state, ids absent from it are ignored.
          setDraft({ ...draft, mode })
          setStatus("")
        }

        const toggle = (id, next) => {
          setDraft({ ...draft, overrides: { ...draft.overrides, [id]: next } })
          setStatus("")
        }

        const save = async () => {
          setBusy(true)
          try {
            const result = await saveState({
              mode: draft.mode,
              overrides: draft.overrides,
              prompt: draft.prompt,
              name: draft.name,
              description: draft.description,
            })
            if (result && result.ok === true) {
              setFailed(false)
              setStatus(result.note || "已保存。")
              // Re-read so the row list matches the composition we just wrote.
              const fresh = await fetchState()
              if (fresh && fresh.ok === true) {
                setState(fresh)
                currentLabel = isDefaultName(fresh.name) ? "" : fresh.name
                setDraft({
                  mode: fresh.mode,
                  overrides: { ...fresh.overrides },
                  prompt: fresh.prompt,
                  name: typeof fresh.name === "string" ? fresh.name : "",
                  description: typeof fresh.description === "string" ? fresh.description : "",
                })
              }
            } else {
              setFailed(true)
              setStatus((result && result.error) || t("msg.saveFailed"))
            }
          } catch (error) {
            setFailed(true)
            setStatus(t("msg.saveFailed") + "：" + String((error && error.message) || error))
          } finally {
            setBusy(false)
          }
        }

        const statusClass = failed ? "cpfe-status cpfe-err" : dirty ? "cpfe-status cpfe-dirty" : "cpfe-status cpfe-ok"
        const shown = dirty && status === "" ? t("msg.unsaved") : status

        return react.createElement(
          "div",
          { className: "cpfe" },
          react.createElement(
            "section",
            null,
            react.createElement("h2", { className: "cpfe-h" }, t("name.heading")),
            react.createElement(
              "p",
              { className: "cpfe-sub" },
              t("name.hint"),
            ),
            react.createElement("input", {
              className: "cpfe-input",
              type: "text",
              value: draft.name,
              placeholder: t("name.placeholder"),
              onChange: (event) => {
                setDraft({ ...draft, name: event.target.value })
                setStatus("")
              },
            }),
            react.createElement("input", {
              className: "cpfe-input",
              type: "text",
              value: draft.description,
              placeholder: t("name.descriptionPlaceholder"),
              onChange: (event) => {
                setDraft({ ...draft, description: event.target.value })
                setStatus("")
              },
            }),
          ),
          react.createElement(
            "section",
            null,
            react.createElement("h2", { className: "cpfe-h" }, t("mode.heading")),
            react.createElement(
              "p",
              { className: "cpfe-sub" },
              t("mode.hint"),
            ),
            react.createElement(
              "div",
              { className: "cpfe-modes" },
              state.modes.map((mode) =>
                react.createElement(
                  "label",
                  { key: mode.id, className: draft.mode === mode.id ? "cpfe-mode cpfe-mode-on" : "cpfe-mode" },
                  react.createElement("input", {
                    type: "radio",
                    name: "cpfe-mode",
                    checked: draft.mode === mode.id,
                    onChange: () => pickMode(mode.id),
                  }),
                  react.createElement(
                    "span",
                    { className: "cpfe-mode-b" },
                    react.createElement("span", { className: "cpfe-mode-t" }, t("base." + mode.id + ".label", mode.label)),
                    react.createElement("span", { className: "cpfe-mode-n" }, t("base." + mode.id + ".note", mode.note)),
                  ),
                ),
              ),
            ),
          ),
          react.createElement(
            "section",
            null,
            react.createElement("h2", { className: "cpfe-h" }, t("rows.heading")),
            react.createElement(
              "p",
              { className: "cpfe-sub" },
              t("rows.hint"),
            ),
            react.createElement(RowList, {
              rows: state.rows,
              overrides: draft.overrides,
              onToggle: toggle,
              depth: 0,
              t: t,
            }),
          ),
          react.createElement(
            "section",
            null,
            react.createElement("h2", { className: "cpfe-h" }, t("prompt.heading")),
            react.createElement(
              "p",
              { className: "cpfe-sub" },
              t("prompt.hint"),
            ),
            react.createElement("textarea", {
              className: "cpfe-editor",
              value: draft.prompt,
              spellCheck: false,
              onChange: (event) => {
                setDraft({ ...draft, prompt: event.target.value })
                setStatus("")
              },
            }),
          ),
          react.createElement(
            "div",
            { className: "cpfe-bar" },
            react.createElement(
              "button",
              { className: "cpfe-btn cpfe-primary", disabled: busy || dirty === false, onClick: save },
              busy ? t("btn.saving") : t("btn.save"),
            ),
            react.createElement("button", { className: "cpfe-btn", disabled: busy, onClick: () => load(true) }, t("btn.reload")),
            react.createElement("span", { className: statusClass }, shown),
            react.createElement("span", { className: "cpfe-path" }, state.compositionPath),
          ),
        )
      }

      function apply(ctx) {
        console.log("dsh-custom-prompt-editor: apply() entered")
        try {
          ensureStyles()
          const locale = ctx.get("locale")
          // Bound once so the nav label thunk can translate at projection time.
          const navT = locale === undefined ? null : locale.bind(NS)
          if (locale !== undefined) {
            ctx.effect(() => locale.register(NS, TRANSLATIONS), "custom-prompt-editor: dictionaries")
          }
          const slots = ctx.get("slots")
          if (slots === undefined) {
            console.warn("dsh-custom-prompt-editor: slots service unavailable; settings page not registered")
            return
          }
          slots.inject("settings.section", () => {
            console.log("dsh-custom-prompt-editor: registering settings.section")
            // `locale: NS` is the shipped contract: the shell then hands the
            // component a bound `t` in props.
            return slots.register(
              {
                name: "settings.section",
                id: "custom-system-prompt",
                order: 21,
                label: () => currentLabel || (navT === null ? ZH.nav : navT("nav")),
                locale: NS,
              },
              CustomModeSection,
            )
          })
        } catch (error) {
          console.error("dsh-custom-prompt-editor: apply() failed", error)
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
    console.error("dsh-custom-prompt-editor: browser half failed to register", error)
  } catch {
    /* logging is best-effort */
  }
}

