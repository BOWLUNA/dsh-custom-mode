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

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PROMPT_PATH, COMPOSITION_PATH, ROUTE_PATH, PRESET_DIR } from './paths.mjs'
import {
  BASE_MODES,
  collectRows,
  renderComposition,
  modeOf,
  overridesOf,
  readBaseComposition,
  setShippedPresetsDir,
} from './composition.mjs'
import { readPresetMeta, writePresetMeta, presetMetaPath, PRESET_META_PATH } from './meta.mjs'
import { packagedPresetDir } from './seed.mjs'
import {
  allocateId,
  assistantDir,
  assistantsFromRoster,
  COMPOSITION_FILE,
  createAssistantDir,
  reorderAssistant,
  seedOnActivation,
  userPresetRoot,
} from './assistants.mjs'

export { PROMPT_PATH, COMPOSITION_PATH, ROUTE_PATH, API_PREFIX, PRESET_DIR, PRESET_META_PATH }

/** The list endpoint is the route path itself; the rest hang off it. */
const STATE_PATH = ROUTE_PATH + '/state'
const CREATE_PATH = ROUTE_PATH + '/create'
const DELETE_PATH = ROUTE_PATH + '/delete'
const REORDER_PATH = ROUTE_PATH + '/reorder'

/** Which verbs each endpoint answers. `undefined` for a path means 404. */
const METHODS = {
  [ROUTE_PATH]: ['GET'],
  [STATE_PATH]: ['GET', 'POST'],
  [CREATE_PATH]: ['POST'],
  [DELETE_PATH]: ['POST'],
  [REORDER_PATH]: ['POST'],
}

/** 只告警一次：避免每个请求都刷同一行日志。 */
let warnedRosterShape = false

/** 应用层请求体上限；平台的 buffered cap 是第一道，这个是我们自己的兜底（见 handler 里的注释）。 */
const MAX_BODY_BYTES = 4 * 1024 * 1024

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
    return { ok: false, error: '读取提示词失败：' + describe(error) }
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

export function readState(rows, id, options = {}) {
  const directory = assistantDir(rows, id)
  if (directory === undefined) return unknownAssistant(id)
  const composition = compositionFile(directory)
  if (!existsSync(composition)) return { ok: false, error: '找不到组成文件：' + composition }
  const text = readFileSync(composition, 'utf8')
  const mode = modeOf(text)
  const prompt = readPrompt(directory)
  const meta = readPresetMeta(directory)
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
export function saveState(rows, input) {
  const id = input !== null && typeof input === 'object' && typeof input.id === 'string' ? input.id : ''
  const directory = assistantDir(rows, id)
  if (directory === undefined) return unknownAssistant(id)

  const mode = input !== null && typeof input === 'object' && typeof input.mode === 'string' ? input.mode : ''
  if (!BASE_MODES.some((entry) => entry.id === mode)) {
    return { ok: false, error: '未知的基础模式：' + mode }
  }
  const prompt = input !== null && typeof input === 'object' && typeof input.prompt === 'string' ? input.prompt : ''
  if (prompt.trim() === '') {
    return { ok: false, error: '保存被拒绝：系统提示词为空。留空不会清空身份，读取器会沿用上一版。' }
  }
  const verdict = checkPromptText(prompt)
  if (verdict.ok !== true) return { ok: false, error: verdict.error }

  const rawName = input !== null && typeof input === 'object' && typeof input.name === 'string' ? input.name : ''
  const name = rawName.replace(/\r?\n/g, ' ').trim()
  if (name.length > MAX_NAME) {
    return { ok: false, error: '保存被拒绝：模式名称过长（上限 ' + String(MAX_NAME) + ' 个字符）。' }
  }
  const rawDescription =
    input !== null && typeof input === 'object' && typeof input.description === 'string' ? input.description : ''
  const description = rawDescription.replace(/\r?\n/g, ' ').trim()
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, error: '保存被拒绝：模式描述过长（上限 ' + String(MAX_DESCRIPTION) + ' 个字符）。' }
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
    return { ok: false, error: '生成组成文件失败：' + describe(error) }
  }

  // Self-check our own output before publishing it: a composition that lost its
  // rows would break the mode on its next mount, and the cause would be opaque.
  try {
    if (collectRows(composition).length === 0) throw new Error('生成的组成文件没有任何行')
    readBaseComposition(mode)
  } catch (error) {
    return { ok: false, error: '生成结果自检失败，已放弃写入：' + describe(error) }
  }

  try {
    writeAtomic(compositionFile(directory), composition)
    writeAtomic(promptFile(directory), prompt)
  } catch (error) {
    return { ok: false, error: '写入失败：' + describe(error) }
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
  if (name === '') return { ok: false, error: '请先给新助手起个名字。' }
  if (name.length > MAX_NAME) {
    return { ok: false, error: '名字太长了（上限 ' + String(MAX_NAME) + ' 个字符）。' }
  }
  const rawDescription =
    input !== null && typeof input === 'object' && typeof input.description === 'string' ? input.description : ''
  const description = rawDescription.replace(/\r?\n/g, ' ').trim()
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, error: '描述太长了（上限 ' + String(MAX_DESCRIPTION) + ' 个字符）。' }
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
    return { ok: false, error: '目录已存在，请换一个名字：' + join(root, id) }
  }

  // A "duplicate" carries the source's prompt, base mode and row switches into a
  // NEW assistant — read here, before anything is created, so a failure leaves no
  // half-made directory behind. The composition is NOT copied verbatim: it is
  // re-rendered from the source's base mode and overrides, because the generated
  // file embeds the new assistant's own name and id.
  let source = null
  const from = input !== null && typeof input === 'object' && typeof input.from === 'string' ? input.from : ''
  if (from !== '') {
    const fromDir = assistantDir(rows, from)
    if (fromDir === undefined) return unknownAssistant(from)
    const fromComposition = compositionFile(fromDir)
    if (!existsSync(fromComposition)) return { ok: false, error: '找不到组成文件：' + fromComposition }
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
      return { ok: false, error: '写入提示词失败：' + describe(error) }
    }
  }
  const metaResult = writePresetMeta(name, description === '' && source !== null ? source.description : description, created.dir)
  if (metaResult.ok !== true) return metaResult

  return {
    ok: true,
    id,
    name,
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
export async function deleteAssistant(rows, input, agentPresets) {
  const id = input !== null && typeof input === 'object' && typeof input.id === 'string' ? input.id : ''
  if (assistantDir(rows, id) === undefined) return unknownAssistant(id)
  if (typeof agentPresets?.remove !== 'function') {
    return { ok: false, error: '当前 DSH 版本没有 agentPresets.remove()，无法删除。' }
  }
  try {
    await agentPresets.remove(id)
  } catch (error) {
    return { ok: false, error: '删除失败：' + describe(error) }
  }
  return { ok: true, id, note: '已删除「' + id + '」。正在使用它的会话不受影响；新建会话时不再出现。' }
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
    seedOnActivation({ root: dirname(PRESET_DIR), templateDir: packagedPresetDir() })
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

        // Backstop on request size. `requestBody: 'buffered'` means the platform applies its own
        // JSON cap, but that cap is the host's configuration, not a contract — measured on Windows,
        // a 5 MB body reached us happily. This keeps one authenticated request from making us buffer
        // an unbounded amount; the platform's cap remains the primary guard.
        const declared = Number(request.headers.get('content-length') ?? '')
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
          return json({ ok: false, error: `请求体过大（上限 ${String(MAX_BODY_BYTES)} 字节）` }, 413)
        }

        // Everything below writes, so the body is read and parsed exactly once.
        let parsed
        try {
          parsed = await request.json()
        } catch {
          return json({ ok: false, error: '请求体不是合法 JSON' }, 400)
        }
        await ensureShipped()
        if (pathname === STATE_PATH) {
          const result = saveState(await roster(), parsed)
          return json(result, result.ok === true ? 200 : 400)
        }
        if (pathname === CREATE_PATH) {
          const result = createAssistant(await roster(), parsed)
          return json(result, result.ok === true ? 200 : 400)
        }
        if (pathname === REORDER_PATH) {
          const result = reorderAssistant(await roster(), parsed)
          return json(result, result.ok === true ? 200 : 400)
        }
        const result = await deleteAssistant(await roster(), parsed, scope.agentPresets)
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
function writeAtomic(file, text) {
  // 临时名必须**每个请求唯一**：只带 pid 时，同一进程内两个并发保存会争同一个临时名，
  // Windows 上两个 rename 指向同一目标会以 EPERM 失败（实测：10 并发保存 2 例 400），
  // 而 POSIX 上 rename 原子覆盖、静默地后写胜出 —— 也就是说这个缺陷只在 Windows 显现。
  const temporary = `${file}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, file)
}

/** `error` as a readable string, without assuming it is an Error. */
function describe(error) {
  return String((error && error.message) || error)
}
