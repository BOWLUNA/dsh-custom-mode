/**
 * Host half: 「自定义模式」settings page.
 *
 * Serves one private HTTP route; the browser half calls it with `fetch`:
 *
 *   GET  — the current base mode, the row tree with switch states, prompt text.
 *   POST — { mode, overrides, prompt }: validate, render a fresh
 *          `agent.cordis.yml`, write both files.
 *
 * Why a private route instead of a Remote namespace or `dsh-settings`: this
 * plugin then owns no Cordis service name and cannot collide with anything, and
 * it stays independent of the settings API whose helper names differ between dsh
 * releases (see docs/ARCHITECTURE.md).
 *
 * A route registered on the raw `webServer` table is however OUTSIDE the
 * platform's browser-trust fence, which only guards the channels the Connection
 * service mounts (`/`, `/api`, …). Measured on 0.1.6-alpha.1: an unauthenticated
 * POST with `content-type: text/plain` rewrote `prompt.md`, while every official
 * route answered 401 — and a cross-site form post needs no preflight, so any page
 * the user visited could have rewritten their agent's system prompt. The route
 * therefore runs the platform's own check first, via
 * `ctx.connection.requestRejection(req)` (Host/Origin fence + browser auth),
 * which is the same verdict `/api` gets.
 *
 * Storage is deliberately file-only and stateless: the composition file IS the
 * saved state, so no second document can drift from it. The page derives which
 * rows the user changed by diffing against the same shipped base mode.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
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
import { readPresetMeta, writePresetMeta, PRESET_META_PATH } from './meta.mjs'
import { seedPresetWithLog } from './seed.mjs'

export { PROMPT_PATH, COMPOSITION_PATH, ROUTE_PATH, PRESET_DIR, PRESET_META_PATH }

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

/** Read the prompt file, or report a typed failure the page can show. */
export function readPrompt() {
  try {
    return { ok: true, path: PROMPT_PATH, text: readFileSync(PROMPT_PATH, 'utf8') }
  } catch (error) {
    return { ok: false, error: '读取提示词失败：' + String((error && error.message) || error) }
  }
}

/** Read the installed composition. */
function readComposition() {
  return existsSync(COMPOSITION_PATH) ? readFileSync(COMPOSITION_PATH, 'utf8') : null
}

/**
 * Everything the settings page renders from.
 *
 * `mode` and `overrides` are derived from the composition file rather than
 * stored separately, so the file stays the single source of truth.
 */
export function readState() {
  const text = readComposition()
  if (text === null) {
    return { ok: false, error: '找不到组成文件：' + COMPOSITION_PATH }
  }
  const mode = modeOf(text)
  const prompt = readPrompt()
  const meta = readPresetMeta()
  return {
    ok: true,
    mode,
    modes: BASE_MODES,
    rows: collectRows(text),
    overrides: overridesOf(text, mode),
    prompt: prompt.ok === true ? prompt.text : '',
    name: meta.name,
    description: meta.description,
    presetMetaPath: PRESET_META_PATH,
    promptPath: PROMPT_PATH,
    compositionPath: COMPOSITION_PATH,
  }
}

/**
 * Apply one save: validate the prompt, render the composition, write both files.
 *
 * The render always carries a fresh timestamp, and `agent-presets` re-mounts a
 * preset when the composition file's `mtimeMs`/`size` differ — so the new
 * configuration reaches the next session without a process restart.
 */
export function saveState(input) {
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

  const overrides = new Map()
  const raw = input !== null && typeof input === 'object' ? input.overrides : undefined
  if (raw !== null && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === 'boolean') overrides.set(id, value)
    }
  }

  let composition
  try {
    composition = renderComposition(mode, overrides)
  } catch (error) {
    return { ok: false, error: '生成组成文件失败：' + String((error && error.message) || error) }
  }

  // Self-check our own output before publishing it: a composition that lost its
  // rows would break the mode on its next mount, and the cause would be opaque.
  try {
    if (collectRows(composition).length === 0) throw new Error('生成的组成文件没有任何行')
    readBaseComposition(mode)
  } catch (error) {
    return { ok: false, error: '生成结果自检失败，已放弃写入：' + String((error && error.message) || error) }
  }

  try {
    mkdirSync(dirname(COMPOSITION_PATH), { recursive: true })
    writeFileSync(COMPOSITION_PATH, composition, 'utf8')
    writeFileSync(PROMPT_PATH, prompt, 'utf8')
  } catch (error) {
    return { ok: false, error: '写入失败：' + String((error && error.message) || error) }
  }

  if (typeof input.name === 'string' && input.name.trim() !== '') {
    const metaResult = writePresetMeta(input.name, input.description)
    if (metaResult.ok !== true) return metaResult
  }

  return {
    ok: true,
    mode,
    note: '已保存（基础模式：' + mode + '）。新建会话即生效，当前会话保持原配置。',
  }
}

/** Send JSON with no-store caching, so a save is never read back stale. */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body, 'utf8')),
  })
  res.end(body)
}

/** Read a request body with a hard cap. */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 4_000_000) throw new Error('请求体过大（上限 4MB）')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Rejection status for one request, or undefined when it may proceed.
 *
 * The platform's fence is verified through the Connection service, which is where
 * the Host/Origin check and the browser-session check live:
 *
 *  - Host must be loopback (or a declared trusted authority) → defeats DNS
 *    rebinding, where the socket reaches this server but the Host names the
 *    attacker's domain;
 *  - `Sec-Fetch-Site: cross-site` and a mismatching `Origin` are refused → defeats
 *    a malicious page posting to this local port (a simple form post needs no
 *    preflight, so CORS alone would not have stopped it);
 *  - the signed `dsh-auth-*` cookie must be present → without the browser session
 *    that the launch URL establishes, the route is closed.
 *
 * The service is resolved lazily, per request, and NOT through `inject`: measured
 * on 0.1.6-alpha.1, `connection` is provided after this bundle row's `apply` runs,
 * so an `inject` here would park the plugin in `pending` for no reason — while by
 * request time the service is always there.
 *
 * When the service is absent the route FAILS CLOSED. A dead settings page is a
 * visible, honest failure; an unauthenticated write path that rewrites the agent's
 * system prompt is a silent one.
 */
let warnedMissingConnection = false
function connectionRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (connection !== undefined && typeof connection.requestRejection === 'function') {
    return connection.requestRejection(req)
  }
  if (!warnedMissingConnection) {
    warnedMissingConnection = true
    console.error(
      'custom-mode: connection 服务不可用（DSH 版本不匹配？），已拒绝该设置页的所有请求以保守处理。' +
        'prompt.md 与 custom_prompt 工具不受影响。',
    )
  }
  return 503
}

/**
 * Where the settings page can exist at all.
 *
 * The page is a WEB page: without `webServer` there is nothing to serve the route on,
 * and without `agentPresets` the base-mode list cannot be built. The tui profile has
 * neither.
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
 * one warning that matters. Instead the row always activates, and the route is
 * registered from a scoped fiber that waits for those two services (`ctx.inject`),
 * which is the dynamic form of the same declaration.
 */
const WEB_SERVICES = ['webServer', 'agentPresets']

export function apply(ctx) {
  // Before anything else: make sure the preset exists on disk.
  //
  // A storefront install is a single command (`dsh plugin --profile web add
  // dsh-custom-mode`), and the npm package is all that command carries. Without this,
  // such an install produces a settings page whose composition file does not exist: the
  // page opens on an error and the mode cannot even be picked for a new session.
  // Idempotent, never overwrites an existing file (see seed.mjs), and silent once the
  // preset is complete.
  seedPresetWithLog(PRESET_DIR)

  ctx.inject(WEB_SERVICES, (scope) => {
    // Compatibility guard: this plugin reads host APIs that a future DSH release could
    // reshape. Check them once and say so plainly, instead of letting every request
    // fail with an opaque 500.
    const missing = []
    if (typeof scope.agentPresets?.list !== 'function') missing.push('agentPresets.list()')
    if (typeof scope.webServer?.register !== 'function') missing.push('webServer.register()')
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
            console.error(
              'custom-mode: 无法从 roster 解析出厂预设目录：' + String((error && error.message) || error),
            )
          }
        })()
      }
      return shippedReady
    }

    const handler = async (req, res) => {
      try {
        // The fence comes first, before any method dispatch: the GET leaks the whole
        // system prompt and the POST rewrites it, so neither may run unauthenticated.
        const rejection = connectionRejection(scope, req)
        if (rejection !== undefined) {
          // 401/403 与平台对 /api 的措辞一致；503 是"我们自己保守关闭"（connection 服务
          // 取不到），它既不是未授权也不是被禁止，别把响应体写成 forbidden 误导排查的人。
          const reason = rejection === 401 ? 'unauthorized' : rejection === 403 ? 'forbidden' : 'unavailable'
          res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(reason)
          return
        }
        if (req.method === 'GET') {
          await ensureShipped()
          sendJson(res, 200, readState())
          return
        }
        if (req.method === 'POST') {
          await ensureShipped()
          const raw = await readBody(req)
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
            return
          }
          const result = saveState(parsed)
          sendJson(res, result.ok === true ? 200 : 400, result)
          return
        }
        sendJson(res, 405, { ok: false, error: '只支持 GET 与 POST' })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    }

    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler }),
      'custom-mode.route',
    )
  })
}
