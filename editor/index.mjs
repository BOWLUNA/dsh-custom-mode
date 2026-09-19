/**
 * Host half: the 「自定义模式」 settings page — an ASSISTANT MANAGER.
 *
 * It registers five exact routes on the platform's shared `/api` channel; the browser half calls them
 * with `fetch`:
 *
 *   GET  /api/custom-mode              — every assistant this feature manages.
 *   GET  /api/custom-mode/state?id=…   — one assistant: base mode, rows, switches, prompt.
 *   POST /api/custom-mode/state        — { id, mode, overrides, prompt, name, description }:
 *                                        validate, render a fresh `agent.cordis.yml`, write both files.
 *   POST /api/custom-mode/create       — { name, description }: seed a new assistant from the
 *                                        packaged template and give it the standard base mode.
 *   POST /api/custom-mode/delete       — { id }: remove a locally authored assistant.
 *   POST /api/custom-mode/reorder      — { id, direction }: move one assistant up/down in the
 *                                        picker order by writing `order` into each `preset.yml`.
 *
 * **Why `/api` and not the raw `webServer` table**: the carrier that owns the `/api` channel applies the
 * platform's trust and authentication policy — loopback/`trustedHosts` Host check, `Sec-Fetch-Site`,
 * `Origin`, and the signed browser-session cookie — *before* dispatching to a route. Registering there
 * makes the fence part of the structure: a route cannot exist without it. Registering on the raw table
 * instead puts the route outside that policy and leaves "check the request first" as a rule a human has
 * to remember — and an earlier version of this plugin, doing exactly that, let an unauthenticated GET
 * read the whole system prompt and an unauthenticated cross-site POST rewrite `prompt.md` (every official
 * route answered 401; a plain form post needs no preflight, so CORS would not have helped either). The
 * registered paths are absolute *including* `/api`, which is what the platform's own packages pass.
 *
 * **Why exact routes rather than one prefix**: the Fetch registry matches exact paths. Five registrations
 * cost nothing and each declares the methods it owns, so the method table doubles as the guarantee that a
 * prefetched `GET …/create` cannot create anything — that method is simply not registered for that path.
 *
 * Why a private route instead of a Remote namespace or `dsh-settings`: this plugin then owns no Cordis
 * service name and cannot collide with anything, and it stays independent of the settings API whose helper
 * names differ between dsh releases (see docs/ARCHITECTURE.md §5).
 *
 * Storage is deliberately file-only and stateless: the composition file IS the
 * saved state, so no second document can drift from it. The page derives which
 * rows the user changed by diffing against the same shipped base mode.
 */

import { writeAtomic, writeAtomicPair } from './atomic.mjs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PROMPT_PATH, COMPOSITION_PATH, ROUTE_PATH, PRESET_DIR } from './paths.mjs'
import {
  BASE_MODES,
  collectRows,
  disableRowsInPlace,
  modeOf,
  overridesOf,
  readBaseComposition,
  renderComposition,
  setShippedPresetsDir,
  unresolvableRows,
} from './composition.mjs'
import { readPresetMeta, writePresetMeta, presetMetaPath, PRESET_META_PATH } from './meta.mjs'
import { listHistory, readVersion, recordExternalChange, recordPrompt, HISTORY_SOURCE } from './journal.mjs'
import { packagedPresetDir, starterComposition } from './seed.mjs'
import {
  allocateId,
  assistantDir,
  assistantsFromRoster,
  COMPOSITION_FILE,
  createAssistantDir,
  reorderAssistant,
  seedOnActivation,
  LEGACY_ID,
  userPresetRoot,
} from './assistants.mjs'

export { PROMPT_PATH, COMPOSITION_PATH, ROUTE_PATH, API_PREFIX, PRESET_DIR, PRESET_META_PATH }

/** The list endpoint is the route path itself; the rest hang off it. */
const STATE_PATH = ROUTE_PATH + '/state'
const CREATE_PATH = ROUTE_PATH + '/create'
const DELETE_PATH = ROUTE_PATH + '/delete'
const REORDER_PATH = ROUTE_PATH + '/reorder'
const REPAIR_PATH = ROUTE_PATH + '/repair'
const HISTORY_PATH = ROUTE_PATH + '/history'

/** Which verbs each endpoint answers. `undefined` for a path means 404. */
const METHODS = {
  [ROUTE_PATH]: ['GET'],
  [STATE_PATH]: ['GET', 'POST'],
  [HISTORY_PATH]: ['GET'],
  [CREATE_PATH]: ['POST'],
  [DELETE_PATH]: ['POST'],
  [REORDER_PATH]: ['POST'],
  [REPAIR_PATH]: ['POST'],
}

/** 只告警一次：避免每个请求都刷同一行日志。 */
let warnedRosterShape = false

/** 应用层请求体上限；平台的 buffered cap 是第一道，这个是我们自己的兜底（见 handler 里的注释）。 */
const MAX_BODY_BYTES = 4 * 1024 * 1024

/**
 * 本插件的版本。
 *
 * 页面把它显示出来，是因为**用户很难自己判断装到的是哪一版**：pnpm 的发布冷却期（默认 24 小时）会让
 * 不钉版本的安装落到"超过 24 小时的最新版"，实测在一台干净机器上 `dsh plugin add dsh-custom-mode`
 * 装到的是 1.0.1 而不是最新的 1.9.x。看见版本号，用户才知道要不要按 README 的钉版本命令重装。
 */
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
})()

/** Longest display name / description the page accepts, so one paste cannot bloat every picker. */
const MAX_NAME = 80
const MAX_DESCRIPTION = 400

/**
 * Variable names the prompt renderer accepts, mirroring
 * `VARIABLE_NAME = /^[a-z][a-z0-9_]*$/` in `@deepseek-ai/dsh-system-prompt`.
 */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/**
 * Variables this deployment registers for every agent (`dsh-agent-loop`).
 *
 * The persona section renders with strict interpolation: an unknown `{{name}}`
 * or a malformed group makes the renderer THROW, failing every model request in
 * this mode. Rejecting it at the write is what keeps a typo from bricking it.
 *
 * Mirrors `checkPromptText` in the preset's `prompt-tool.mjs`; the duplication is
 * deliberate so neither side depends on the other's install location.
 */
const KNOWN_VARIABLES = ['model', 'cwd', 'provider']

/**
 * Check prompt text against the renderer's interpolation rules.
 *
 * A complete `{{...}}` group must hold a valid, registered name; a lone `{{`
 * with no later `}}` is literal prose and passes.
 */
export function checkPromptText(text) {
  let index = 0
  for (;;) {
    const open = text.indexOf('{{', index)
    if (open === -1) return { ok: true }
    const close = text.indexOf('}}', open + 2)
    if (close === -1) return { ok: true }
    const variable = text.slice(open + 2, close)
    if (!VARIABLE_NAME.test(variable)) {
      return {
        ok: false,
        code: 'badVariableName',
        params: { variable: '{{' + variable + '}}' },
        error:
          '保存被拒绝：{{' +
          variable +
          '}} 不是合法的变量引用（合法名只能用小写字母、数字、下划线且以字母开头）。' +
          '若只想要字面量花括号，请用单个 { 或不闭合的 {{。',
      }
    }
    if (!KNOWN_VARIABLES.includes(variable)) {
      return {
        ok: false,
        code: 'unknownVariable',
        params: { variable: '{{' + variable + '}}', known: KNOWN_VARIABLES.map((item) => '{{' + item + '}}').join('、') },
        error:
          '保存被拒绝：{{' +
          variable +
          '}} 不是已注册的变量，渲染时会报错并让本模式每个请求都失败。可用：' +
          KNOWN_VARIABLES.map((item) => '{{' + item + '}}').join('、') +
          '。',
      }
    }
    index = close + 2
  }
}

/** Absolute path of one preset directory's editable prompt file. */
export function promptFile(directory) {
  return join(directory, 'prompt.md')
}

/** Absolute path of one preset directory's composition file. */
export function compositionFile(directory) {
  return join(directory, COMPOSITION_FILE)
}

/** Read one assistant's prompt file, or report a typed failure the page can show. */
export function readPrompt(directory) {
  const path = promptFile(directory)
  try {
    return { ok: true, path, text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { ok: false, code: 'promptReadFailed', params: { detail: describe(error) }, error: '读取提示词失败：' + describe(error) }
  }
}

/** The isolation message for an id the roster does not describe as a managed assistant. */
function unknownAssistant(id) {
  return {
    ok: false,
    error:
      '找不到助手「' +
      String(id) +
      '」。设置页只管理本工具创建的模式（目录里有 prompt.md，且组成文件用 prompt-reader.mjs 注入身份）；' +
      '手工编写的其它模式不会被改动。',
  }
}

/**
 * Everything the settings page renders for ONE assistant.
 *
 * `mode` and `overrides` are derived from the composition file rather than
 * stored separately, so the file stays the single source of truth.
 *
 * @param {Array<object>} rows - the current roster.
 * @param {string} id - the assistant's preset id.
 * @returns {object} the payload the browser half reads.
 */
/**
 * 出厂提示词：新建助手时拿到的那一份（打包在包里的 preset 模板）。
 *
 * 设置页用它实现「恢复出厂提示词」—— 在此之前，用户改坏了提示词只能把整个助手删掉重建。
 * 读不到就返回 null（页面会把那个按钮置灰，而不是给一个会写坏文件的按钮）。
 */
let packagedPromptCache
function packagedPrompt() {
  if (packagedPromptCache === undefined) {
    try {
      packagedPromptCache = readFileSync(join(packagedPresetDir(), 'prompt.md'), 'utf8')
    } catch (error) {
      packagedPromptCache = null
      console.error('custom-mode: 读不到出厂提示词模板（' + describe(error) + '），设置页将不提供「恢复出厂提示词」。')
    }
  }
  return packagedPromptCache
}

/**
 * 「配置了，但不生效」的告警码。
 *
 * 这一条借自同生态的 whale-persona：它会主动点名"配了却没起作用"的项。这里对应四种**静默**的
 * 自相矛盾 —— 每一种此前都只会让人以为"我明明写了提示词/描述，怎么没效果"：
 *
 *   - `personaOffWithPrompt`：身份行被关掉，`prompt.md` 根本不会被注入（最坑的一种）；
 *   - `toolOff`：`custom_prompt` 工具行关掉 → 会话内改提示词不可用（设置页照旧）；
 *   - `noDescription`：描述为空 → 新建会话的模式选择器里显示「暂无描述」；
 *   - `noName`：名字为空 → 选择器里显示成裸目录 id。
 *
 * 只返回**码**，文案由页面按语言渲染（双语文案的真值源在 locales.mjs 一处）。
 *
 * @param {string} text - the composition text.
 * @param {string} prompt - the prompt file's content.
 * @param {{name?: string, description?: string}} meta - `preset.yml`.
 * @returns {string[]} warning codes, stable order.
 */
export function configWarnings(text, prompt, meta) {
  const warnings = []
  const rows = collectRows(text)
  const find = (id) => rows.find((row) => row.id === id)
  if (find('persona')?.disabled === true && typeof prompt === 'string' && prompt.trim() !== '') {
    warnings.push('personaOffWithPrompt')
  }
  if (find('custom-prompt-tool')?.disabled === true) warnings.push('toolOff')
  if (typeof meta?.description !== 'string' || meta.description.trim() === '') warnings.push('noDescription')
  if (typeof meta?.name !== 'string' || meta.name.trim() === '') warnings.push('noName')
  return warnings
}

export function readState(rows, id, options = {}) {
  const directory = assistantDir(rows, id)
  if (directory === undefined) return unknownAssistant(id)
  const composition = compositionFile(directory)
  if (!existsSync(composition)) return { ok: false, code: 'compositionMissing', params: { path: composition }, error: '找不到组成文件：' + composition }
  const text = readFileSync(composition, 'utf8')
  const mode = modeOf(text)
  const prompt = readPrompt(directory)
  const meta = readPresetMeta(directory)
  // 页面要打开时顺便对账：磁盘上的文本若与日志末条不同，说明它在设置页之外被改过
  // （会话内的 custom_prompt 工具、手工编辑、别处同步）—— 补记一条 external，于是"被改过"看得见。
  if (prompt.ok === true) recordExternalChange(directory, prompt.text)
  return {
    ok: true,
    id,
    mode,
    modes: BASE_MODES,
    rows: collectRows(text),
    overrides: overridesOf(text, mode),
    prompt: prompt.ok === true ? prompt.text : '',
    ...prompt.ok === true ? {} : { promptError: prompt.error },
    name: meta.name,
    description: meta.description,
    promptPath: promptFile(directory),
    compositionPath: composition,
    presetMetaPath: presetMetaPath(directory),
    // 回退用的出厂文本。它不是"当前值"，页面只把它填进编辑器，保存前不落盘 —— 所以
    // 一次误点不会破坏任何东西（重新读取即可丢弃）。
    factoryPrompt: typeof options.factoryPrompt === 'string' ? options.factoryPrompt : null,
    // 改动历史（只有元数据，正文按需取：见 GET /custom-mode/history）。
    history: listHistory(directory),
    // 本插件版本 + 本机装的那条 dsh 线上无法解析的行（页面据此显示版本与"按本线修复"）。
    version: PLUGIN_VERSION,
    unresolvable: unresolvableRows(text),
    // 「配置了却不生效」的告警码（文案在页面侧按语言渲染）。
    warnings: [
      ...configWarnings(text, prompt.ok === true ? prompt.text : '', meta),
      // 审批闸门缺失：由预置侧在注册失败时留下标记文件（宿主半看不到那个事件是否真的有人监听）。
      // 诚实地把它变成页面上的告警，而不是只留在 console.error 里。
      ...(existsSync(join(directory, 'approval-gate-missing')) ? ['approvalGateMissing'] : []),
      // 本线无法解析的启用行 = 平台会把整个预设判为 broken 并从选择器里丢掉（曾经的 P0）。
      ...(unresolvableRows(text).length > 0 ? ['unresolvableRows'] : []),
    ],
  }
}

/**
 * The list payload: every managed assistant, plus the root they live in.
 *
 * @param {Array<object>} rows - the current roster.
 */
export function readList(rows) {
  return { ok: true, assistants: assistantsFromRoster(rows), root: userPresetRoot(rows) }
}

/**
 * Apply one save: validate the prompt, render the composition, write both files.
 *
 * The render always carries a fresh timestamp, and `agent-presets` re-mounts a
 * preset when the composition file's `mtimeMs`/`size` differ — so the new
 * configuration reaches the next session without a process restart.
 *
 * @param {Array<object>} rows - the current roster.
 * @param {object} input - `{ id, mode, overrides, prompt, name, description }`.
 */
/**
 * 进程内按助手串行化写入。
 *
 * 实测（外部审阅，Windows）：即使有 rename 重试，同一助手 10 个并发保存里仍有 1 次 EPERM —— 因为两个
 * 处理器在**同一时刻**准备并改名同一对文件。重试覆盖的是跨进程窗口；这里消掉的是本进程内的竞争，也就是
 * 我们能真正保证的那一半。（两个实例共用同一个 DSH_HOME 的跨进程竞争，插件无法串行化，那里靠重试。）
 */
const writeChains = new Map()

function serializedWrite(key, work) {
  const previous = writeChains.get(key) ?? Promise.resolve()
  const next = previous.then(work, work)
  // 链本身必须永远处于 fulfilled 状态，否则一次失败会卡死后续所有写入。
  writeChains.set(key, next.then(() => undefined, () => undefined))
  return next
}

export function saveState(rows, input) {
  const id = input !== null && typeof input === 'object' && typeof input.id === 'string' ? input.id : ''
  const directory = assistantDir(rows, id)
  if (directory === undefined) return unknownAssistant(id)

  const mode = input !== null && typeof input === 'object' && typeof input.mode === 'string' ? input.mode : ''
  if (!BASE_MODES.some((entry) => entry.id === mode)) {
    return { ok: false, code: 'badMode', params: { mode }, error: '未知的基础模式：' + mode }
  }
  const prompt = input !== null && typeof input === 'object' && typeof input.prompt === 'string' ? input.prompt : ''
  if (prompt.trim() === '') {
    return { ok: false, code: 'promptEmpty', error: '保存被拒绝：系统提示词为空。留空不会清空身份，读取器会沿用上一版。' }
  }
  const verdict = checkPromptText(prompt)
  if (verdict.ok !== true) {
    // 带上 code/params：英文界面由页面自己的词典渲染；中文串保留给直接调 HTTP API 的调用方。
    return { ok: false, code: verdict.code, params: verdict.params, error: verdict.error }
  }

  const rawName = input !== null && typeof input === 'object' && typeof input.name === 'string' ? input.name : ''
  const name = rawName.replace(/\r?\n/g, ' ').trim()
  if (name.length > MAX_NAME) {
    return { ok: false, code: 'nameTooLong', params: { max: MAX_NAME }, error: '保存被拒绝：模式名称过长（上限 ' + String(MAX_NAME) + ' 个字符）。' }
  }
  const rawDescription =
    input !== null && typeof input === 'object' && typeof input.description === 'string' ? input.description : ''
  const description = rawDescription.replace(/\r?\n/g, ' ').trim()
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, code: 'descriptionTooLong', params: { max: MAX_DESCRIPTION }, error: '保存被拒绝：模式描述过长（上限 ' + String(MAX_DESCRIPTION) + ' 个字符）。' }
  }

  const overrides = new Map()
  const raw = input !== null && typeof input === 'object' ? input.overrides : undefined
  if (raw !== null && typeof raw === 'object') {
    for (const [rowId, value] of Object.entries(raw)) {
      if (typeof value === 'boolean') overrides.set(rowId, value)
    }
  }

  let composition
  try {
    composition = renderComposition(mode, overrides, { modeName: name, assistantId: id })
  } catch (error) {
    return { ok: false, code: 'renderFailed', params: { detail: describe(error) }, error: '生成组成文件失败：' + describe(error) }
  }

  // Self-check our own output before publishing it: a composition that lost its
  // rows would break the mode on its next mount, and the cause would be opaque.
  try {
    if (collectRows(composition).length === 0) throw new Error('生成的组成文件没有任何行')
    readBaseComposition(mode)
  } catch (error) {
    return { ok: false, code: 'selfCheckFailed', params: { detail: describe(error) }, error: '生成结果自检失败，已放弃写入：' + describe(error) }
  }

  try {
    // 组成文件与提示词必须一起更新：先都写进临时文件再一起换名，失败时不会留下"新组成 + 旧提示词"
    // 这种混合状态（审阅指出原先两次独立原子写之间存在这个窗口）。
    writeAtomicPair([
      [compositionFile(directory), composition],
      [promptFile(directory), prompt],
    ])
    // 改动留痕：三个改动路径（设置页 / 会话内工具 / 手工编辑）里，只有设置页是"当场知道"的。
    // 另外两条由 readState 对比补记（见 journal.mjs 的单写者说明）。
    recordPrompt(directory, prompt, HISTORY_SOURCE.settings)
  } catch (error) {
    return { ok: false, code: 'writeFailed', params: { detail: describe(error) }, error: '写入失败：' + describe(error) }
  }

  // A name the user cleared is left alone rather than written as an empty scalar:
  // an empty `preset.yml` name is what makes a mode render as its bare id.
  if (name !== '') {
    const metaResult = writePresetMeta(name, description, directory)
    if (metaResult.ok !== true) return metaResult
  }

  return {
    ok: true,
    id,
    mode,
    code: 'saved',
    params: { name: name === '' ? id : name, mode },
    note: '已保存（' + (name === '' ? id : name) + '，基础模式 ' + mode + '）。新建会话即生效，当前会话保持原配置。',
  }
}

/**
 * Create one assistant from the packaged template — or duplicate an existing one.
 *
 * Nothing here copies an existing DIRECTORY: a copy would inherit whatever extra
 * files its source had accumulated, and creation would break as soon as the user
 * deleted the last one. Seeding the template makes "new" mean new, and a duplicate
 * (`from`) then replays the source's prompt, base mode and row switches on top.
 *
 * @param {Array<object>} rows - the current roster.
 * @param {object} input - `{ name, description, from }`; `from` names an existing
 *   assistant to duplicate.
 * @param {string} [templateDir] - packaged template (tests inject their own).
 */
export function createAssistant(rows, input, templateDir = packagedPresetDir()) {
  const rawName = input !== null && typeof input === 'object' && typeof input.name === 'string' ? input.name : ''
  const name = rawName.replace(/\r?\n/g, ' ').trim()
  if (name === '') return { ok: false, code: 'nameRequired', error: '请先给新助手起个名字。' }
  if (name.length > MAX_NAME) {
    return { ok: false, code: 'nameTooLong', params: { max: MAX_NAME }, error: '名字太长了（上限 ' + String(MAX_NAME) + ' 个字符）。' }
  }
  const rawDescription =
    input !== null && typeof input === 'object' && typeof input.description === 'string' ? input.description : ''
  const description = rawDescription.replace(/\r?\n/g, ' ').trim()
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, code: 'descriptionTooLong', params: { max: MAX_DESCRIPTION }, error: '描述太长了（上限 ' + String(MAX_DESCRIPTION) + ' 个字符）。' }
  }

  const root = userPresetRoot(rows)
  const taken = new Set()
  for (const row of rows) {
    if (row !== null && typeof row === 'object' && typeof row.id === 'string') taken.add(row.id)
  }
  const id = allocateId(name, taken)
  // The roster can lag a directory it skipped (a hand-made one with no
  // composition). Refuse the name rather than half-own that directory.
  if (existsSync(join(root, id))) {
    return { ok: false, code: 'dirExists', params: { path: join(root, id) }, error: '目录已存在，请换一个名字：' + join(root, id) }
  }

  // A "duplicate" carries the source's prompt, base mode and row switches into a
  // NEW assistant — read here, before anything is created, so a failure leaves no
  // half-made directory behind. The composition is NOT copied verbatim: it is
  // re-rendered from the source's base mode and overrides, because the generated
  // file embeds the new assistant's own name and id.
  let source = null
  const from = input !== null && typeof input === 'object' && typeof input.from === 'string' ? input.from : ''
  // 显示名在分支里计算，但返回语句在分支外 —— 所以声明在外层。
  let fromDisplayName = from
  if (from !== '') {
    const fromDir = assistantDir(rows, from)
    if (fromDir === undefined) return unknownAssistant(from)
    const fromComposition = compositionFile(fromDir)
    if (!existsSync(fromComposition)) return { ok: false, code: 'compositionMissing', params: { path: fromComposition }, error: '找不到组成文件：' + fromComposition }
    // 显示名（`rows` 里的 name）优先于内部 id —— 与删除一致。
    const fromRow = rows.find((item) => item !== null && typeof item === 'object' && item.id === from)
    if (typeof fromRow?.name === 'string' && fromRow.name.trim() !== '') fromDisplayName = fromRow.name
    const text = readFileSync(fromComposition, 'utf8')
    const sourceMode = modeOf(text)
    const sourcePrompt = readPrompt(fromDir)
    source = {
      mode: sourceMode,
      overrides: overridesOf(text, sourceMode),
      prompt: sourcePrompt.ok === true ? sourcePrompt.text : '',
      description: readPresetMeta(fromDir).description,
    }
  }

  let composition
  try {
    composition = source === null
      ? renderComposition('standard', new Map(), { modeName: name, assistantId: id })
      : renderComposition(source.mode, source.overrides, { modeName: name, assistantId: id })
  } catch (error) {
    return { ok: false, error: '生成组成文件失败：' + describe(error) }
  }

  const created = createAssistantDir({ root, id, composition, templateDir })
  if (created.ok !== true) return created

  // The template ships a starter prompt; a duplicate replaces it with the source's.
  if (source !== null) {
    try {
      writeAtomic(promptFile(created.dir), source.prompt)
    } catch (error) {
      return { ok: false, code: 'promptWriteFailed', params: { detail: describe(error) }, error: '写入提示词失败：' + describe(error) }
    }
  }
  const metaResult = writePresetMeta(name, description === '' && source !== null ? source.description : description, created.dir)
  if (metaResult.ok !== true) return metaResult

  return {
    ok: true,
    id,
    name,
    code: source === null ? 'created' : 'duplicated',
    // D5：文案里用**显示名**而不是内部目录 id。
    params: source === null ? { name } : { name, from: fromDisplayName },
    note: source === null
      ? '已创建「' + name + '」。它的系统提示词现在是模板默认文本；写好后新建会话即可选择它。'
      : '已复制出「' + name + '」：提示词、基础模式与插件开关都来自「' + from + '」，之后各改各的，互不影响。',
  }
}

/**
 * Delete one assistant.
 *
 * Deletion goes through the platform's own `agentPresets.remove`, which is what
 * refuses a shipped preset and re-checks that the directory really lives under the
 * writable root. A live session that mounted the preset keeps running: its
 * composition was read at creation and is never re-read.
 *
 * @param {Array<object>} rows - the current roster.
 * @param {object} input - `{ id }`.
 * @param {{remove: (id: string) => Promise<void>}} agentPresets - the roster service.
 */
/**
 * 把"本机这条 dsh 线上无法解析的启用行"关掉，让预设重新健康。
 *
 * 为什么需要它：老版本创建（或老版本播种）的组成文件会一直留着 —— 播种只补缺失文件、从不覆盖用户数据。
 * 如果那份文件里有一行启用了本线不提供的插件，平台会把整个预设判为 broken 并从所有选择器里**静默丢弃**
 * （设置页照常能开，所以用户完全不知道）。这里复用与保存同一条排版手术：读出现有 overrides，把那几行显式
 * 关闭后重新渲染。用户的其它选择一字不动。
 */
export function repairComposition(rows, input) {
  const id = input !== null && typeof input === 'object' && typeof input.id === 'string' ? input.id : ''
  const directory = assistantDir(rows, id)
  if (directory === undefined) return unknownAssistant(id)
  const file = compositionFile(directory)
  if (!existsSync(file)) return { ok: false, code: 'compositionMissing', params: { path: file }, error: '找不到组成文件：' + file }
  const text = readFileSync(file, 'utf8')
  const bad = unresolvableRows(text)
  if (bad.length === 0) {
    return { ok: true, id, code: 'repairNotNeeded', note: '这个助手在本机没有无法解析的行，无需修复。' }
  }
  // **就地**关闭那几行，不重渲染：重渲染会顺手丢掉 base 之外的自有行，而用户的数据不该被这样动。
  const rendered = disableRowsInPlace(text, bad.map((row) => row.id))
  try {
    writeAtomic(file, rendered)
  } catch (error) {
    return { ok: false, code: 'writeFailed', params: { detail: describe(error) }, error: '写入失败：' + describe(error) }
  }
  const ids = bad.map((row) => row.id).join('、')
  return {
    ok: true,
    id,
    code: 'repaired',
    params: { count: bad.length, ids },
    note: '已按本机这条 dsh 线关闭 ' + String(bad.length) + ' 个无法解析的行（' + ids + '）。现在这个模式能重新出现在选择器里。',
  }
}

export async function deleteAssistant(rows, input, agentPresets) {
  const id = input !== null && typeof input === 'object' && typeof input.id === 'string' ? input.id : ''
  if (assistantDir(rows, id) === undefined) return unknownAssistant(id)
  if (typeof agentPresets?.remove !== 'function') {
    return { ok: false, code: 'noRemoveApi', error: '当前 DSH 版本没有 agentPresets.remove()，无法删除。' }
  }
  // 文案用**显示名**，不用内部目录 id（复制/删除的状态行曾把 id 暴露给用户，审阅点名）。
  const displayName = (() => {
    const row = Array.isArray(rows) ? rows.find((item) => item !== null && typeof item === 'object' && item.id === id) : undefined
    return typeof row?.name === 'string' && row.name.trim() !== '' ? row.name : id
  })()
  try {
    await agentPresets.remove(id)
  } catch (error) {
    return { ok: false, code: 'deleteFailed', params: { detail: describe(error) }, error: '删除失败：' + describe(error) }
  }
  return { ok: true, id, code: 'deleted', params: { name: displayName }, note: '已删除「' + displayName + '」。正在使用它的会话不受影响；新建会话时不再出现。' }
}

/**
 * The plugin's HTTP surface, registered on the platform's **shared `/api` channel**.
 *
 * `ctx.connection.fetch.register({ path, methods, requestBody, fetch })` mounts one exact route under
 * `/api`, and the carrier applies its trust and authentication policy **before** dispatch. That is a
 * structural guarantee, not a convention: a route cannot exist without the fence, so "did you remember
 * to check?" is not a question anyone has to answer. An earlier version of this plugin registered on the
 * raw `ctx.webServer` table and called `ctx.connection.requestRejection` by hand — measured then, an
 * unauthenticated GET returned the whole system prompt and an unauthenticated cross-site POST rewrote
 * `prompt.md`, while every official route answered 401.
 *
 * Measured on 0.1.6-alpha.2 with a throwaway probe plugin (see `docs/MEASUREMENTS.md` §16):
 *
 *     GET  /api/<route>                                  no session cookie → 401 unauthorized
 *     GET  /api/<route>   Origin: https://evil.example   cross-site        → 403
 *     GET  /api/<route>   Host: evil.example             DNS-rebinding shape → 403
 *     GET  /api/<route>                                  session cookie    → 200
 *     POST /api/<route>   on a route that owns GET only                    → 404 (never dispatched)
 *
 * The paths are absolute *including* `/api` — that is what the platform's own packages pass
 * (`/api/present.host`, `/api/changes.summary`), despite the type saying "below /api".
 */
const API_PREFIX = '/api'

/**
 * Where the settings page can exist at all.
 *
 * The page is a WEB page: without `connection` there is no `/api` channel to register on, and without
 * `agentPresets` the assistant list cannot be built. The tui profile has neither.
 *
 * These must NOT go into the row's own `inject`. Measured on 0.1.6-alpha.1:
 * `./install.sh --profile tui` — a usage both `install.sh --help` and the READMEs
 * advertise — installs this web-only bundle into a profile with no web server, and a
 * row-level `inject` then parks the whole entry forever:
 *
 *     dsh: warning: 1 entry did not activate
 *     custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
 *
 * That is the SAME line a broken installation prints, so it teaches users to ignore the
 * one warning that matters. Instead the row always activates, and the routes are
 * registered from a scoped fiber that waits for those two services (`ctx.inject`),
 * which is the dynamic form of the same declaration.
 */
const WEB_SERVICES = ['connection', 'agentPresets']

export function apply(ctx) {
  // Before anything else: make sure the preset tree on disk is complete.
  //
  // A storefront install is a single command (`dsh plugin --profile web add
  // dsh-custom-mode`), and the npm package is all that command carries. Without this,
  // such an install produces a settings page whose composition file does not exist: the
  // page opens on an error and no mode can be picked for a new session.
  //
  // Synchronous on purpose: this runs on EVERY activation, and profiles without a web
  // server (tui) never reach the scoped fiber below, so the seed cannot live there.
  // `seedOnActivation` fills only MISSING files (never overwriting a prompt or a
  // generated composition) and creates the legacy assistant only on a first run — see
  // the assistant registry for why a deleted assistant must not come back.
  try {
    seedOnActivation({
      root: dirname(PRESET_DIR),
      templateDir: packagedPresetDir(),
      // 组成文件**不照搬包内模板**，而是按本机装的那条 dsh 线派生：模板是某一条线渲染出来的，
      // 另一条线可能根本没有它的某些行（实测：预览线的 workflow-ptc 在稳定线上不存在，
      // 平台会把整个预设判为 broken 并从所有选择器里静默丢弃）。
      composition: starterComposition({ assistantId: LEGACY_ID }),
    })
  } catch (error) {
    console.error('custom-mode: 初始化 preset 目录时出现意外错误（已忽略）: ' + describe(error))
  }

  ctx.inject(WEB_SERVICES, (scope) => {
    // Compatibility guard: this plugin reads host APIs that a future DSH release could
    // reshape. Check them once and say so plainly, instead of letting every request
    // fail with an opaque 500.
    // 数据表形式：以后新增一处耦合点，只要在这里加一行 —— README 的耦合点清单与本表同源，
    // 让"上游改了 API 形状"在启动日志里就能看见，而不是等用户报"设置页白屏"。
    const REQUIRED_APIS = [
      ['agentPresets.list()', () => typeof scope.agentPresets?.list === 'function'],
      ['agentPresets.remove()', () => typeof scope.agentPresets?.remove === 'function'],
      ['connection.fetch.register()', () => typeof scope.connection?.fetch?.register === 'function'],
    ]
    const missing = REQUIRED_APIS.filter(([, probe]) => !probe()).map(([name]) => name)
    if (missing.length > 0) {
      console.error(
        'custom-mode: 当前 DSH 版本缺少所需 API：' +
          missing.join('、') +
          '。设置页将不可用，请核对 DSH 版本或提 issue。',
      )
      return
    }

    /**
     * Resolve the shipped-preset directory through the roster, which reports each
     * preset's absolute path and is therefore independent of install layout.
     */
    let shippedReady = null
    const ensureShipped = () => {
      if (shippedReady === null) {
        shippedReady = (async () => {
          try {
            const rows = await scope.agentPresets.list()
            const system = rows.find((row) => row.trust === 'system' && typeof row.path === 'string')
            // <presets>/<id>/agent.cordis.yml -> <presets>
            if (system !== undefined) setShippedPresetsDir(dirname(dirname(system.path)))
          } catch (error) {
            console.error('custom-mode: 无法从 roster 解析出厂预设目录：' + describe(error))
          }
        })()
      }
      return shippedReady
    }

    /** The roster, or an empty list — discovery itself reports broken rows rather than throwing. */
    const roster = async () => {
      const rows = await scope.agentPresets.list()
      if (!Array.isArray(rows)) {
        // 形状变了：静默返回空列表会让页面显示"一个助手都没有"，比报错更难查（曾经就因为
        // 缺少这种告警，一个 API 形状变化以"设置页白屏"的形式出现）。
        if (!warnedRosterShape) {
          warnedRosterShape = true
          console.error('custom-mode: agentPresets.list() 没有返回数组（DSH 版本不匹配？），助手列表将为空。')
        }
        return []
      }
      return rows
    }

    /**
     * One Fetch-shaped handler for the whole surface.
     *
     * `pathname` is the logical path (without the `/api` prefix) so the method table above stays the
     * single place where the surface is described.
     */
    /**
     * JSON response with the page's caching policy attached.
     *
     * `no-store` because every one of these answers is state the page then displays: a cached
     * `GET /api/custom-mode/state` would show the user rows they already changed. (The old
     * hand-rolled response helper set the same header; dropping it here would have been a silent
     * regression.)
     */
    const json = (value, status = 200) =>
      Response.json(value, { status, headers: { 'cache-control': 'no-store' } })

    const handle = async (request, pathname) => {
      try {
        const url = new URL(request.url)
        if (request.method === 'GET' && pathname === ROUTE_PATH) {
          await ensureShipped()
          return json(readList(await roster()))
        }
        if (request.method === 'GET' && pathname === STATE_PATH) {
          await ensureShipped()
          return json(readState(await roster(), url.searchParams.get('id') ?? '', { factoryPrompt: packagedPrompt() }))
        }

        if (request.method === 'GET' && pathname === HISTORY_PATH) {
          await ensureShipped()
          const id = url.searchParams.get('id') ?? ''
          const directory = assistantDir(await roster(), id)
          if (directory === undefined) return json(unknownAssistant(id), 404)
          const text = readVersion(directory, url.searchParams.get('n') ?? '')
          if (text === null) return json({ ok: false, code: 'versionMissing', error: '找不到这个版本（历史可能已被上限裁剪）。' }, 404)
          return json({ ok: true, id, n: url.searchParams.get('n'), text })
        }

        // Backstop on request size. `requestBody: 'buffered'` means the platform applies its own
        // JSON cap, but that cap is the host's configuration, not a contract — measured on Windows,
        // a 5 MB body reached us happily. This keeps one authenticated request from making us buffer
        // an unbounded amount; the platform's cap remains the primary guard.
        const declared = Number(request.headers.get('content-length') ?? '')
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
          return json({ ok: false, code: 'bodyTooLarge', params: { max: MAX_BODY_BYTES }, error: `请求体过大（上限 ${String(MAX_BODY_BYTES)} 字节）` }, 413)
        }

        // Everything below writes, so the body is read and parsed exactly once.
        let parsed
        try {
          // 只信 `content-length` 会被 chunked（或不带该头）的请求绕过 —— 所以读完再按**实际字节**判一次。
          // 平台自己的 buffered cap 仍是第一道；这一道保证"我们绝不 buffer 一个无上限的请求体"。
          const raw = await request.text()
          if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
            return json({ ok: false, code: 'bodyTooLarge', params: { max: MAX_BODY_BYTES }, error: `请求体过大（上限 ${String(MAX_BODY_BYTES)} 字节）` }, 413)
          }
          parsed = JSON.parse(raw)
        } catch {
          return json({ ok: false, code: 'badJson', error: '请求体不是合法 JSON' }, 400)
        }
        await ensureShipped()
        const targetId = parsed !== null && typeof parsed === 'object' && typeof parsed.id === 'string' ? parsed.id : ''
        if (pathname === STATE_PATH) {
          const result = await serializedWrite('save:' + targetId, async () => saveState(await roster(), parsed))
          return json(result, result.ok === true ? 200 : 400)
        }
        if (pathname === CREATE_PATH) {
          // 新建与排序改的是整棵树（根目录 + 每个助手的 preset.yml），所以用同一把"树锁"。
          const result = await serializedWrite('tree', async () => createAssistant(await roster(), parsed))
          return json(result, result.ok === true ? 200 : 400)
        }
        if (pathname === REPAIR_PATH) {
          const result = await serializedWrite('repair:' + targetId, async () => repairComposition(await roster(), parsed))
          return json(result, result.ok === true ? 200 : 400)
        }
        if (pathname === REORDER_PATH) {
          const result = await serializedWrite('tree', async () => reorderAssistant(await roster(), parsed))
          return json(result, result.ok === true ? 200 : 400)
        }
        const result = await serializedWrite('delete:' + targetId, async () => deleteAssistant(await roster(), parsed, scope.agentPresets))
        return json(result, result.ok === true ? 200 : 400)
      } catch (error) {
        return json({ ok: false, error: describe(error) }, 500)
      }
    }

    // One registration per exact path — the platform's Fetch registry matches exact paths, not prefixes —
    // each declaring the methods it owns. The method table doubles as the guarantee that a prefetched
    // `GET /api/custom-mode/create` cannot create anything: that method is not registered for that path.
    for (const [pathname, methods] of Object.entries(METHODS)) {
      scope.effect(
        () => scope.connection.fetch.register({
          path: API_PREFIX + pathname,
          methods: [...methods],
          requestBody: 'buffered',
          fetch: (request) => handle(request, pathname),
        }),
        'custom-mode.route' + pathname,
      )
    }
  })
}

/**
 * 写文件：先写同目录的临时文件，再 rename 覆盖。
 *
 * `rename(2)` 在同一文件系统内是原子的，所以读者（提示词读取器按 mtime+size 缓存）要么看到旧内容、
 * 要么看到新内容，不会读到写了一半的文件。原来连续两次 writeFileSync 在极端时序下可能被读成撕裂的
 * prompt，而这个文件正是"用户的提示词"。
 */
// 原子写与重试只有一份实现（见 atomic.mjs 的说明）；这里再导出 renameWithRetry，
// 让既有的路由测试继续能从 index.mjs 取到它。
export { renameWithRetry } from './atomic.mjs'

/** `error` as a readable string, without assuming it is an Error. */
function describe(error) {
  return String((error && error.message) || error)
}
