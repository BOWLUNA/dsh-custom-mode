/**
 * Composition compiler for the 自定义模式 settings page.
 *
 * Turns「base mode + per-row switches」into an `agent.cordis.yml`, by rewriting a
 * shipped preset's composition text rather than reserialising parsed YAML.
 *
 * Why text surgery instead of a YAML round-trip:
 *
 *  - The shipped compositions carry explanatory comments that are genuinely
 *    useful; a parse/serialise round-trip destroys all of them.
 *  - Rows carry `!!js` expressions (`disabled: !!js process.platform === 'win32'`).
 *    A round-trip would either lose them or re-emit them differently, silently
 *    changing platform behaviour.
 *
 * So a row is treated as an opaque text segment: we keep it byte-for-byte and
 * only ever insert or replace its `disabled:` line. An untouched row therefore
 * stays EXACTLY as shipped, including its platform condition.
 *
 * Timestamp: `agent-presets` decides whether to re-mount a preset by comparing
 * only `mtimeMs` and `size` of the composition file. A regeneration that
 * happened to produce identical bytes would not take effect, so the rendered
 * output always carries a timestamp comment.
 */

import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dshHome } from './paths.mjs'

/**
 * Directory holding the shipped preset folders (`standard`, `ptc`, …),
 * discovered once and cached.
 *
 * Resolved from the installed `dsh-agent-presets` package rather than a
 * hard-coded install path, so this works on any machine layout. The chain is:
 *
 *   <harness>/dsh-agent-presets/presets/custom/prompt-reader.mjs   ← this preset
 *   <harness>/dsh-agent-presets/presets/                           ← what we want
 *
 * The preset directory is the FIRST place `prompt-reader.mjs` exists walking up
 * from here: `preset/` in a source checkout does not carry that file. Discovery
 * is deferred to first use so importing this module never throws.
 */
let shippedPresetsCache
function discoverShippedPresets() {
  const require = createRequire(import.meta.url)
  // 1) Node 解析：插件安装在能看见 harness 依赖的位置时直接命中。
  try {
    const manifest = require.resolve('@deepseek-ai/dsh-agent-presets/package.json')
    return join(dirname(manifest), 'presets')
  } catch {
    /* fall through */
  }
  // 2) profile 的 node_modules：dsh 把 harness 包放在 <dshHome>/profiles/node_modules，
  //    这里独立于「roster 是否给出 system 行」的形状，是 agentPresets 之外的第二条路。
  try {
    const fromProfile = createRequire(join(dshHome(), 'profiles', 'package.json'))
    const manifest = fromProfile.resolve('@deepseek-ai/dsh-agent-presets/package.json')
    return join(dirname(manifest), 'presets')
  } catch {
    /* fall through */
  }
  throw new Error(
    '无法定位出厂基础模式。已尝试：agentPresets 的 system 预设路径、Node 解析、profile 的 node_modules。' +
      '若 DSH 改了包布局，请用 DSH_SHIPPED_PRESETS_DIR 指向 presets 目录。',
  )
}

/**
 * Base modes a user may build on.
 *
 * `custom` is deliberately absent: it is this feature's own output, and offering
 * it as a base would let a preset recursively include itself.
 */
export const BASE_MODES = [
  { id: 'standard', label: '标准模式', note: '完整编码能力：Shell、文件、检索、技能、计划、目标、子代理、工作流' },
  { id: 'ptc', label: 'PTC 模式', note: '在标准模式基础上启用 PTC 工具呈现（tool-presentation）' },
  { id: 'minimal', label: '极简模式', note: '只有 Shell 与终端，共 7 行；没有文件、检索、技能、子代理' },
  { id: 'cordis', label: 'Cordis 模式', note: '标准模式 + 读写运行时的 Cordis 工具集，可让 agent 自己改 harness' },
]

/**
 * Row display metadata: a friendly label, and whether switching it off costs a
 * basic capability. Rows absent from this table still render; they simply show
 * their raw id.
 */
export const ROW_META = {
  persona: { label: '身份（系统提示词）', essential: true, note: '提示词注入点；关掉后本模式用回部署默认身份' },
  'agent-instructions': { label: '项目指令 AGENTS.md', note: '读取 AGENTS.md / CLAUDE.md' },
  'tool-bash': { label: 'Shell（bash）', essential: true },
  'tool-pwsh': { label: 'Shell（pwsh）', essential: true },
  'tool-fs': { label: '文件读写', essential: true, note: '关掉后 agent 无法读写文件' },
  'tool-fs-search': { label: '文件搜索（glob/grep）' },
  'tool-jobs': { label: '后台任务' },
  'tool-todo': { label: '待办清单' },
  'tool-ask-user': { label: '向用户提问' },
  'tool-goal': { label: '目标' },
  'command-goal': { label: '目标命令' },
  planning: { label: '计划模式（分组）', note: '含 isolate realm，关掉等于移除整个计划能力' },
  'plan-mode': { label: '计划模式实现' },
  compaction: { label: '上下文压缩（分组）', note: '含 isolate realm' },
  'compaction-basic': { label: '基础压缩' },
  'command-compact': { label: '/compact 命令' },
  'tool-result-pruner': { label: '工具结果裁剪' },
  delegation: { label: '委派与工作流（分组）', note: '含 isolate realm；关掉等于移除子代理与工作流' },
  'tool-subagent': { label: '子代理（spawn）' },
  'tool-subagent-fork': { label: '子代理（fork）' },
  'tool-subagent-control': { label: '子代理控制' },
  'tool-subagent-list-agents': { label: '列出子代理' },
  'tool-subagent-codex': { label: 'Codex 子代理', note: '默认关闭：需要先安装对应 Bundle' },
  'tool-subagent-claude-code': { label: 'Claude Code 子代理', note: '默认关闭：需要先安装对应 Bundle' },
  'workflow-ptc': { label: '工作流引擎' },
  // 只出现在**稳定线**（0.1.5-rc.2）的委派分组里；预览线没有这一行。CI 的稳定线任务抓到了它
  // 缺标签（"每个出厂行都能查到标签"），这正是双线矩阵的价值。
  'workflow-worker-thread': { label: '工作流 Worker 线程', note: '把工作流跑在独立的 worker 线程里' },
  'tool-workflow': { label: '工作流工具' },
  'tool-ralph': { label: 'Ralph 工作流', note: '默认关闭' },
  'tool-web': { label: '网页检索与抓取' },
  'tool-skill': { label: '技能工具' },
  'skill-filesystem': { label: '技能发现' },
  'tool-cordis': { label: 'Cordis 运行时工具', note: '可读写 harness 运行时' },
  'tool-plugin-manager': {
    label: '插件管理（安装 / 启停）',
    note: '模型侧可安装/启停插件；标准与 PTC 模式里出厂即关闭（只有创造模式默认开），本模式可以显式打开它',
  },
  'tool-presentation': { label: 'PTC 工具呈现' },
  present: { label: '交付文件（present）' },
  'custom-prompt-tool': { label: 'custom_prompt 工具', note: '关掉后无法用对话改提示词（设置页仍可用）' },
  'persistent-shell': { label: '持久 Shell' },
  pty: { label: 'PTY 终端' },
  'terminal-bash': { label: '终端（bash）' },
  'persistent-bash': { label: '持久 bash' },
  'terminal-pwsh': { label: '终端（pwsh）' },
  'persistent-pwsh': { label: '持久 pwsh' },
}

/** Absolute path of the shipped composition for a base mode. */
export function baseCompositionPath(modeId) {
  return join(shippedPresetsDir(), modeId, 'agent.cordis.yml')
}

/**
 * Resolve the shipped-preset directory.
 *
 * A test (or a source checkout, where the shipped presets are not beside this
 * module) may override it through `DSH_SHIPPED_PRESETS_DIR`; otherwise it is
 * discovered from the installed `dsh-agent-presets` package.
 */
/** Directory injected by the host half, which resolves it via the agentPresets service. */
let injectedShippedDir
/**
 * Point the compiler at a shipped-preset directory discovered at runtime.
 *
 * The host half does this from `agentPresets.list()` (system-trust rows carry
 * absolute paths), which is layout-independent. Deriving the directory from this
 * module's own location does NOT work: this module is loaded from the plugin's
 * install directory, not from inside a preset, so no amount of walking up finds
 * the shipped presets.
 */
export function setShippedPresetsDir(dir) {
  if (typeof dir === 'string' && dir !== '') injectedShippedDir = dir
}

export function shippedPresetsDir() {
  const override = process.env.DSH_SHIPPED_PRESETS_DIR
  if (override !== undefined && override !== '') return override
  if (injectedShippedDir !== undefined) return injectedShippedDir
  if (shippedPresetsCache === undefined) shippedPresetsCache = discoverShippedPresets()
  return shippedPresetsCache
}

/** Read one base mode's shipped composition text. */
export function readBaseComposition(modeId) {
  return readFileSync(baseCompositionPath(modeId), 'utf8')
}

/**
 * Whether a segment line declares a row id at the expected indentation.
 *
 * Nested group rows are indented four spaces in the shipped compositions, so a
 * top-level row is recognised only at column 0 and a nested one only at that
 * exact depth. Deeper indentation never carries a row id.
 */
function rowIdAt(line, topLevel) {
  const pattern = topLevel ? /^- id: (.+?)\s*$/ : /^ {4}- id: (.+?)\s*$/
  const match = pattern.exec(line)
  return match === null ? undefined : match[1].replace(/^['"]|['"]$/g, '')
}

/**
 * Split composition text into a leading preamble plus one segment per row.
 *
 * A segment runs from its `- id:` line to just before the next row line, and —
 * critically — the separating newline is INCLUDED in the segment it follows.
 * Segments therefore concatenate back to the original text with NO separator:
 * `lead + segments.join('') === text` exactly. Joining with `'\n'` instead would
 * lose one newline at every boundary, because the last line of a `slice` has no
 * trailing newline of its own.
 *
 * The `lead` keeps everything before the first row (the shipped header comment),
 * and also has no trailing newline of its own — the first segment starts with
 * one.
 */
function splitSegments(text, topLevel) {
  const lines = text.split('\n')
  const starts = []
  for (let i = 0; i < lines.length; i += 1) {
    const id = rowIdAt(lines[i], topLevel)
    if (id !== undefined) starts.push({ index: i, id })
  }
  if (starts.length === 0) return { lead: text, segments: [] }
  /**
   * Text from line `from` up to (not including) line `to`, carrying the newline
   * that ended the last included line.
   *
   * The empty range is the case that matters: a nested level often begins AT
   * line 0, so `slice(0, 0)` must yield `''`. Returning `'\n'` there injects a
   * blank line before every group's first child.
   */
  const slice = (from, to) => {
    if (from >= to) return ''
    if (to >= lines.length) return lines.slice(from).join('\n')
    return `${lines.slice(from, to).join('\n')}\n`
  }
  const lead = slice(0, starts[0].index)
  const segments = starts.map((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1].index : lines.length
    return { id: start.id, text: slice(start.index, end) }
  })
  return { lead, segments }
}

/**
 * Whether a row segment carries its OWN `disabled` key, and its raw value.
 *
 * Scoped to the row's own indentation (see {@link ownKeyIndent}) for the same
 * reason {@link setDisabled} is: a group whose children ship disabled must not
 * read as a disabled group.
 */
function disabledOf(segmentText) {
  const own = disabledLineAt(ownKeyIndent(segmentText))
  for (const line of segmentText.split('\n')) {
    const match = own.exec(line)
    if (match !== null) return { present: true, value: match[1].trim() }
  }
  return { present: false, value: '' }
}

/**
 * Indentation of a row's OWN keys, for a row segment or a whole row tree.
 *
 * The `disabled` key we may set belongs at `- id:`'s indentation plus two
 * spaces. That distinction is load-bearing: group rows contain child rows that
 * carry their own `disabled:` keys, so a naive "first `disabled:` line in this
 * segment" search edits a CHILD's key and silently leaves the group itself
 * unchanged — which is exactly the bug this function exists to prevent.
 *
 * For a whole-tree input (used by the UI description path) the minimum `- id:`
 * indentation identifies the outermost row.
 *
 * @param {string} segmentText - one row segment, or a whole composition.
 * @returns {number} the column the row's own keys start at.
 */
function ownKeyIndent(segmentText) {
  let minIndent = Infinity
  for (const line of segmentText.split('\n')) {
    const match = /^(\s*)- id:/.exec(line)
    if (match !== null) minIndent = Math.min(minIndent, match[1].length)
  }
  return minIndent === Infinity ? 0 : minIndent + 2
}

/** Regex matching a `disabled:` key at exactly one indentation depth. */
function disabledLineAt(indent) {
  return new RegExp(`^ {${String(indent)}}disabled:\\s*(.*)$`)
}

/**
 * Rewrite the `disabled` key of one row segment.
 *
 * Only the row's OWN key is touched (see {@link ownKeyIndent}).
 *
 * Three states, and the distinction matters:
 *
 *  - `undefined` — the user did not touch this row. The segment is returned
 *    untouched, which is what preserves a shipped `!!js` platform condition and
 *    the rows that ship switched off (`tool-subagent-codex`, …).
 *  - `false` — the user explicitly enabled the row. Any `disabled:` line at the
 *    row's own depth is removed, INCLUDING a platform expression: an explicit
 *    choice beats the platform default.
 *  - `true` — the user disabled it. The value is written as a literal `true`,
 *    replacing a platform expression, again because the explicit choice wins.
 */
function setDisabled(segmentText, disabled) {
  if (disabled === undefined) return segmentText
  const lines = segmentText.split('\n')
  const indent = ownKeyIndent(segmentText)
  const own = disabledLineAt(indent)
  const index = lines.findIndex((line) => own.test(line))
  if (index !== -1) {
    const shipped = lines[index].trim().replace(/^disabled:\s*/, '')
    if (disabled) {
      lines[index] = `${' '.repeat(indent)}disabled: true`
    } else if (shipped.startsWith('!!js') && evalDisabledExpression(shipped) !== true) {
      // 显式打开，但出厂那行是平台表达式、且它在本机求值就是"开"：这不是覆盖，而是**撤销覆盖** ——
      // 保持出厂表达式原样，这一行就回到"跟随平台"。（原先这里删掉整行，结果是文件既不是出厂原样、
      // 也不是显式覆盖，页面却显示"未拨过" —— 文件与显示同时失真。）
      return segmentText
    } else {
      lines[index] = `${' '.repeat(indent)}disabled: false`
    }
    return lines.join('\n')
  }
  if (!disabled) return segmentText
  const nameIndex = lines.findIndex((line) => new RegExp(`^ {${String(indent)}}name:\\s`).test(line))
  if (nameIndex === -1) return segmentText
  lines.splice(nameIndex + 1, 0, `${' '.repeat(indent)}disabled: true`)
  return lines.join('\n')
}

/**
 * Evaluate a row's shipped `!!js` disable predicate against THIS process.
 *
 * Rows carry conditions like `!!js process.platform === 'win32'`. Reporting such
 * a row as "disabled" purely because a `disabled:` key exists would show every
 * platform row as off on every platform, and would hide the user's own toggle of
 * it (the diff against the shipped state comes out empty).
 *
 * Evaluating the predicate is what lets the page show the state that is actually
 * in force here. The expression comes from a composition file installed on this
 * machine, which the deployment already executes as a Cordis plugin, so this adds
 * no trust that the file did not already have.
 *
 * @param {string} expression - the raw value after `disabled:`, starting with `!!js`.
 * @returns {boolean|undefined} the evaluated result, or undefined when it cannot be evaluated.
 */
function evalDisabledExpression(expression) {
  if (typeof expression !== 'string' || !expression.startsWith('!!js')) return undefined
  try {
    // eslint-disable-next-line no-new-func -- evaluating the composition's own predicate is the point
    const fn = new Function('process', `return (${expression.slice(4).trim()});`)
    return fn(process) === true
  } catch {
    return undefined
  }
}

/** Build one row's UI description from its segment text. */
function describeRow(id, segmentText, children) {
  const own = disabledOf(segmentText)
  const meta = ROW_META[id] ?? {}
  // A literal `disabled: true` is off. A `!!js` predicate is resolved for THIS
  // machine, so the page shows the state actually in force rather than "has a key".
  // 只看"有没有 disabled 键"是不够的：`disabled: false` 也是字面量，但它表示**开着**。
  const literalOff = own.present && !own.value.startsWith('!!js') && own.value === 'true'
  const fromExpression = own.present ? evalDisabledExpression(own.value) : undefined
  return {
    id,
    group: children.length > 0,
    disabled: literalOff || fromExpression === true,
    disabledExpression: own.present && own.value.startsWith('!!js') ? own.value : null,
    label: meta.label ?? id,
    essential: meta.essential === true,
    note: meta.note ?? null,
    children,
  }
}

/**
 * Collect the row tree of a composition, for rendering the settings UI.
 *
 * @param {string} text - composition file text.
 * @returns {Array<object>} rows, groups carrying their nested rows.
 */
export function collectRows(text) {
  const { segments } = splitSegments(text, true)
  return segments.map((segment) => {
    const isGroup = /^\s*group:\s*true\s*$/m.test(segment.text)
    const nested = isGroup ? splitSegments(segment.text, false).segments : []
    const children = nested.map((child) => describeRow(child.id, child.text, []))
    return describeRow(segment.id, segment.text, children)
  })
}

/**
 * Rewrite one level of rows, applying disabled overrides by id.
 *
 * `overrides` maps a row id to its explicit **enabled** state (`true` = on, `false` = off). A row absent is
 * left byte-for-byte as shipped — that is how an untouched `!!js` platform
 * condition and the rows that ship disabled survive a regeneration.
 *
 * @param {string} text - the level to rewrite.
 * @param {boolean} topLevel - level selector for {@link splitSegments}.
 * @param {Map<string, boolean>} overrides - explicit per-row states.
 * @param {boolean} nested - whether this call rewrites a group's contents.
 * @returns {string} the rewritten level.
 */
function applyLevel(text, topLevel, overrides, nested, replacePersona = true) {
  const { lead, segments } = splitSegments(text, topLevel)
  if (segments.length === 0) return text
  const rendered = segments.map((segment) => {
    // The persona row is always replaced by this feature's own reader row: the
    // shipped one is a static-string persona whose text cannot be edited, so
    // keeping it would silently disable the editable prompt.
    // `replacePersona` 只有**重新渲染**时才为真：那时整段 persona 换成我们的读取器行是对的。
    // 但"按本线修复"是**就地**手术，它必须连 persona 段里的注释都原样保留 ——
    // 之前这里无条件替换，导致每次修复都会丢注释 / 或多复制一行身份注释（外部评审实测）。
    if (!nested && segment.id === 'persona' && replacePersona === true) {
      return setDisabled(PERSONA_ROW, overrides.get('persona'))
    }
    let body = segment.text
    if (nested) {
      // Nested rows: rewrite only the row's own `disabled`, never recurse.
      return setDisabled(body, overrides.get(segment.id))
    }
    const isGroup = /^\s*group:\s*true\s*$/m.test(body)
    if (isGroup) {
      const children = splitSegments(body, false).segments
      if (children.length > 0) {
        // Rewrite the group's nested block, then the group's own `disabled`.
        const cut = body.indexOf(`\n    - id: ${children[0].id}`)
        if (cut !== -1) {
          const head = body.slice(0, cut + 1)
          const tail = body.slice(cut + 1)
          body = head + applyLevel(tail, false, overrides, true)
        }
      }
    }
    return setDisabled(body, overrides.get(segment.id))
  })
  // Empty join: each segment already carries the newline that followed it, so
  // `lead + rendered.join('')` reproduces the input byte-for-byte.
  return `${lead}${rendered.join('')}`
}

/**
 * Normalise a caller's override input into `Map<rowId, boolean>`.
 *
 * A `Map` is the real input: only ids present in it are touched. A `Set` or
 * array is accepted as shorthand for "these ids are off" (which is what a test
 * or a quick script usually wants), and an empty one therefore means "leave
 * every row exactly as shipped".
 */
function normaliseOverrides(input) {
  const disabled = new Map()
  // Shorthand first: an array or Set means "these ids are off". Checked before
  // the object branch because an array IS an object.
  if (input instanceof Set || Array.isArray(input)) {
    for (const id of input) disabled.set(id, true)
    return disabled
  }
  // Encoding form: true means ENABLED, matching the settings checkbox.
  const entries = input instanceof Map ? [...input.entries()] : input !== null && typeof input === 'object' ? Object.entries(input) : []
  for (const [id, enabled] of entries) {
    if (typeof enabled === 'boolean') disabled.set(id, enabled !== true)
  }
  return disabled
}

/**
 * Render a complete `agent.cordis.yml` for one base mode and switch set.
 *
 * @param {string} modeId - one of {@link BASE_MODES}.
 * @param {Map<string, boolean>|Set<string>|string[]} overrides - explicit per-row
 *   states; ids absent from a Map keep their shipped value.
 * @param {{modeName?: string, assistantId?: string}} [options] - the assistant this
 *   composition belongs to. Recorded in the header (so a stray file is traceable)
 *   and passed to the `custom_prompt` row's config, which lets the tool name the
 *   assistant it edits. Optional: every existing caller keeps working, and an
 *   assistant created before this existed keeps its old module, which ignores it.
 * @returns {string} the composition text to install.
 */
export function renderComposition(modeId, overrides, options = {}) {
  if (!BASE_MODES.some((mode) => mode.id === modeId)) throw new Error(`未知基础模式: ${modeId}`)
  const modeName = typeof options?.modeName === 'string' ? options.modeName.trim() : ''
  const assistantId = typeof options?.assistantId === 'string' ? options.assistantId.trim() : ''
  const explicit = normaliseOverrides(overrides)
  const base = readBaseComposition(modeId)
  const rewritten = applyLevel(base, true, explicit, false)
  const header = [
    '# 本文件由「自定义模式」设置页生成，请勿手工编辑——下次保存会覆盖。',
    ...modeName === '' && assistantId === ''
      ? []
      : [`# 助手: ${modeName === '' ? assistantId : modeName}${assistantId === '' ? '' : ` (${assistantId})`}`],
    `# 基础模式: ${modeId}`,
    `# 生成时间: ${new Date().toISOString()}`,
    '#',
    '# 每一行都是原样复制的官方 preset 行，只有 disable 状态会被改写；',
    '# 未被你切换过的行保持出厂状态（含 !!js 平台条件与默认关闭行）。',
    '# 生成时间戳同时用于让 agent-presets 检测到变化并重新挂载（它只比对 mtime 与 size）。',
    '',
  ].join('\n')
  // Rows this feature owns are appended after the base mode's rows, so a
  // regeneration cannot drop them.
  const extras = EXTRA_ROWS.map((extra) => setDisabled(extra.text(modeName), explicit.get(extra.id))).join('')
  return `${header}${rewritten}${extras}`
}

/**
 * The persona row this feature REQUIRES, substituted for whatever the base mode
 * ships.
 *
 * Without this substitution, regenerating from a shipped mode would restore
 * `@deepseek-ai/dsh-persona` — whose `prefix` is a static string resolved at
 * mount — and the editable prompt would silently stop working.
 */
const PERSONA_ROW = [
  '# 本模式的身份来自 prompt.md（由本插件的 prompt-reader.mjs 每步重新读取）。',
  "- id: persona",
  "  name: './prompt-reader.mjs'",
  '  config:',
  '    # Omitted `path` defaults to prompt.md beside the module.',
  '    complete: false',
  '',
].join('\n')

/**
 * Rows this feature adds on top of any base mode: preset-relative modules that
 * no shipped mode contains.
 *
 * They are always emitted, so a regeneration cannot drop them. `custom-prompt-tool`
 * is the durable editing path for sessions with no browser.
 *
 * Its text is a function of the assistant's display name because this feature now
 * manages several assistants and the tool description is what tells the model which
 * one it is editing. A module from before that change ignores `config:` entirely,
 * so the extra key is additive rather than a compatibility break.
 */
const EXTRA_ROWS = [
  {
    id: 'custom-prompt-tool',
    text: (modeName) => {
      const lines = [
        '# 无浏览器时的改提示词通道（模型工具 custom_prompt）。',
        '- id: custom-prompt-tool',
        "  name: './prompt-tool.mjs'",
      ]
      if (modeName !== '') {
        lines.push('  config:', '    # 让工具描述报出本助手的名字；不认识这一行的旧版模块会忽略它。', '    modeName: ' + yamlScalar(modeName))
      }
      lines.push('')
      return lines.join('\n')
    },
  },
]

/**
 * Quote a value into a single-line YAML scalar.
 *
 * JSON string syntax is valid YAML flow-scalar syntax, and it is the one escaping
 * this repository already trusts (`meta.mjs` writes `preset.yml` the same way): a
 * colon, a leading dash or a newline in an assistant's name must not restructure
 * the document, because a composition that stops parsing makes the mode vanish.
 *
 * @param {string} value - the raw value.
 * @returns {string} a double-quoted scalar.
 */
function yamlScalar(value) {
  return JSON.stringify(String(value).replace(/\r?\n/g, ' ').trim())
}

/** Read the base mode recorded in a generated composition, defaulting to standard. */
/**
 * Enabled rows whose plugin package cannot be resolved in **this** installation.
 *
 * Why this exists (measured): a preset with an enabled row whose package this dsh line does not ship is marked
 * broken by the platform and **silently dropped from every picker**, while the settings page keeps working — the
 * P0 an external review found. Fresh installs are safe because seeding derives the composition from the installed
 * line, but an assistant created by an **older** version keeps its old file forever (seeding never overwrites user
 * data), so this is how the page can tell the user instead of leaving them with an invisible mode.
 *
 * Relative modules (`./prompt-reader.mjs`, ours) and `cordis:` pseudo-packages (the runtime's) are skipped.
 *
 * @param {string} text - a composition.
 * @returns {Array<{id: string, name: string}>} enabled rows that cannot resolve.
 */
/**
 * Turn the named rows **off in place**, leaving every other byte of the file alone.
 *
 * Used by the "fix for this line" action: the composition a user has may contain rows this dsh line cannot
 * resolve (typically written by an older version of this plugin), and the platform then drops the whole preset
 * from every picker. Re-rendering the file from the base would also fix it — but it would silently discard any
 * row the user (or a future version) added outside the base. This edits only the offending rows.
 *
 * @param {string} text - the composition.
 * @param {Iterable<string>} ids - row ids to disable.
 * @returns {string} the rewritten composition.
 */
export function disableRowsInPlace(text, ids) {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return text
  // `applyLevel` 把 Map 的值直接交给 `setDisabled(...)`，所以值是**关闭**布尔（true = 关闭）。
  const off = new Map(wanted.map((id) => [id, true]))
  const top = applyLevel(text, true, off, false, false)
  return applyLevel(top, false, off, false, false)
}

export function unresolvableRows(text) {
  let root
  try {
    root = join(shippedPresetsDir(), '..', '..', '..')
  } catch {
    return []
  }
  // **判断不了就不要报警**：如果这个根下根本没有 node_modules（例如测试用的是一个临时出厂目录），
  // 那么"查不到某个包"只说明我们不知道，不说明那行坏了。误报的代价是用户被引导去关掉本来正常的行。
  if (existsSync(join(root, '@deepseek-ai')) === false) return []
  const out = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const row = /^( {0,4})- id: (.+?)\s*$/.exec(lines[index])
    if (row === null) continue
    const indent = row[1].length
    let name
    let disabled = false
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next]
      if (line.trim() !== '' && line.search(/\S/) <= indent) break
      if (/^\s+name: ['"]?(.+?)['"]?\s*$/.test(line)) name = /^\s+name: ['"]?(.+?)['"]?\s*$/.exec(line)[1]
      // 平台条件行（`disabled: !!js …`）必须**求值**判定：只看有没有字面 `true` 会把"本平台已启用"的行
      // 误判成关闭，也会把"本平台本来就关闭"的行（如 Windows 专用的 pwsh）误报成"无法解析"。
      const flag = /^\s+disabled:\s*(.+?)\s*$/.exec(line)
      if (flag !== null) {
        // 字面量直接读，`!!js` 一类交给求值器（它对字面量不做布尔化）。
        const raw = flag[1].replace(/^['"]|['"]$/g, '')
        disabled = raw === 'true' ? true : raw === 'false' ? false : evalDisabledExpression(flag[1]) === true
      }
    }
    if (name === undefined || disabled) continue
    if (name.startsWith('.') || name.startsWith('cordis:')) continue
    const parts = name.split('/')
    const pkg = name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    if (existsSync(join(root, pkg)) === false) out.push({ id: row[2], name })
  }
  return out
}

export function modeOf(text) {
  const match = /^# 基础模式: (\S+)\s*$/m.exec(text)
  const id = match === null ? undefined : match[1]
  return BASE_MODES.some((mode) => mode.id === id) ? id : 'standard'
}

/** Flatten a row tree into `Map<id, disabled>`. */
function flattenRows(rows, into = new Map()) {
  for (const row of rows) {
    into.set(row.id, row.disabled)
    flattenRows(row.children, into)
  }
  return into
}

/** 同 {@link flattenRows}，但保留整行对象：判断"未触碰"要看**文本形态**，不只是求值结果。 */
function flattenRowObjects(rows, into = new Map()) {
  for (const row of rows) {
    into.set(row.id, row)
    flattenRowObjects(row.children, into)
  }
  return into
}

/**
 * Derive the explicit overrides that turned `base` into `text`.
 *
 * The composition file is the single source of truth: instead of keeping a
 * separate settings document that can drift, the page recomputes which rows the
 * user has deviated from by diffing against the same base mode. A row whose
 * state matches the shipped one is simply "not overridden", which is what keeps
 * its `!!js` platform condition intact.
 *
 * @param {string} text - the installed composition.
 * @param {string} modeId - its base mode.
 * @returns {Record<string, boolean>} row id -> enabled.
 */
export function overridesOf(text, modeId) {
  const base = flattenRowObjects(collectRows(readBaseComposition(modeId)))
  for (const extra of EXTRA_ROWS) base.set(extra.id, { id: extra.id, disabled: false, disabledExpression: null })
  const current = flattenRowObjects(collectRows(text))
  const overrides = {}
  for (const [id, row] of current) {
    const baseRow = base.get(id)
    // "未触碰"的判据是**文本形态相同**：出厂行可能是 `!!js` 平台表达式，而它在本机的求值结果恰好与
    // 某个字面量一致 —— 只看求值结果，会把"表达式被换成字面量"误判成"没动过"。
    const sameForm = baseRow !== undefined
      && baseRow.disabled === row.disabled
      && baseRow.disabledExpression === row.disabledExpression
    if (sameForm) continue
    overrides[id] = row.disabled !== true
  }
  return overrides
}

/**
 * Rows this feature always adds, for the settings UI to show alongside the base
 * mode's own rows.
 */
export function extraRowIds() {
  return EXTRA_ROWS.map((extra) => extra.id)
}
