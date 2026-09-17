/**
 * Host-half HTTP route tests — the security-relevant file.
 *
 * Run: node test/editor-route.test.mjs
 *
 * Why this exists: `editor/index.mjs` is the half that serves the settings page, and it is where the
 * unauthenticated-read/write vulnerability lived (see docs/TROUBLESHOOTING.md §9 and SECURITY.md).
 * It had NO test at all — the fix was verified by hand with curl. A hand check proves the fix worked
 * once; it does not stop the fence from being moved, reordered or forgotten later.
 *
 * So this drives the real handler with a stand-in request/response pair and asserts:
 *
 *   - the fence runs FIRST, before any method dispatch (a rejected POST must not write files);
 *   - it FAILS CLOSED when the `connection` service is unavailable;
 *   - every branch of the route: GET / POST / 405 / bad JSON / bad mode / empty prompt /
 *     rejected interpolation / oversized body;
 *   - what the client half depends on: path, `kind: exact`, JSON + `no-store` headers.
 *
 * Self-contained on purpose: the shipped presets come from a fixture directory this test builds,
 * so it needs neither dsh nor `@deepseek-ai/dsh-agent-presets` installed.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let passed = 0
let failed = 0
const check = (label, condition, detail = '') => {
  if (condition) {
    passed += 1
    console.log(`PASS  ${label}`)
  } else {
    failed += 1
    console.log(`FAIL  ${label}${detail === '' ? '' : '  → ' + detail}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-custom-route-'))
const shippedDir = join(dir, 'presets')
const presetDir = join(dir, 'agent-presets', 'custom')
const promptPath = join(presetDir, 'prompt.md')
const compositionPath = join(presetDir, 'agent.cordis.yml')

// ── 出厂 preset 夹具：本测试不依赖已安装的 dsh ────────────────────────────────
const BASE_COMPOSITION = [
  '# fixture base composition',
  '',
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '',
  '- id: tool-bash',
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "  disabled: !!js process.platform === 'win32'",
  '',
  '- id: tool-pwsh',
  "  name: '@deepseek-ai/dsh-tool-pwsh'",
  "  disabled: !!js process.platform === 'win32'",
  '',
  '- id: planning',
  '  name: ./planning.mjs',
  '  group: true',
  '  config:',
  '    label: 计划',
  '  children:',
  '    - id: plan-mode',
  '      name: ./plan-mode.mjs',
  '',
  '- id: tool-web',
  "  name: '@deepseek-ai/dsh-tool-web'",
  '',
  '- id: tool-off-by-default',
  "  name: '@deepseek-ai/dsh-tool-off'",
  '  disabled: true',
  '',
].join('\n')

mkdirSync(join(shippedDir, 'standard'), { recursive: true })
mkdirSync(join(shippedDir, 'ptc'), { recursive: true })
mkdirSync(join(shippedDir, 'minimal'), { recursive: true })
mkdirSync(join(shippedDir, 'cordis'), { recursive: true })
for (const mode of ['standard', 'ptc', 'minimal', 'cordis']) {
  writeFileSync(join(shippedDir, mode, 'agent.cordis.yml'), BASE_COMPOSITION, 'utf8')
  writeFileSync(join(shippedDir, mode, 'preset.yml'), `name: ${mode}\n`, 'utf8')
}
mkdirSync(presetDir, { recursive: true })

// 路径在 import 时求值，所以这两个环境变量必须在 import 之前设好。
process.env.DSH_CUSTOM_PROMPT_PATH = promptPath
process.env.DSH_SHIPPED_PRESETS_DIR = shippedDir

const { renderComposition } = await import('../editor/composition.mjs')
const editor = await import('../editor/index.mjs')

// 装上一份生成好的组合文件，让 readState() 有东西可读（和真实安装后的状态一致）
writeFileSync(compositionPath, renderComposition('standard', new Map()), 'utf8')
writeFileSync(promptPath, 'PROMPT-ORIGINAL\n', 'utf8')

// ── 桩：ctx / req / res ─────────────────────────────────────────────────────
const registeredRoutes = []

function makeCtx({ rejection, connectionAvailable = true } = {}) {
  const webServer = {
    register(route) {
      registeredRoutes.push(route)
      return () => {}
    },
  }
  const agentPresets = {
    async list() {
      return [{ trust: 'system', path: join(shippedDir, 'standard', 'agent.cordis.yml') }]
    },
  }
  const ctx = {
    effect: (fn) => fn(),
    // 作用域化的等待：真实 Cordis 会等服务就绪，测试里直接给。
    inject: (deps, callback) => callback(ctx),
    get: (name) =>
      name === 'connection' && connectionAvailable
        ? { requestRejection: () => rejection }
        : undefined,
    webServer,
    agentPresets,
  }
  return ctx
}

function makeRes() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(body) {
      this.body = body ?? ''
    },
  }
}

function makeReq(method, { headers = {}, body } = {}) {
  const req = { method, headers }
  if (body !== undefined) {
    req[Symbol.asyncIterator] = async function* iterate() {
      yield Buffer.from(body, 'utf8')
    }
  }
  return req
}

/** 装一次插件，拿到它注册的那条路由。 */
function mount(options) {
  registeredRoutes.length = 0
  editor.apply(makeCtx(options))
  return registeredRoutes[0]
}

let route = mount({ rejection: undefined })
check('注册了一条路由', route !== undefined)
check('路径与浏览器半一致（/custom-mode）', route?.path === '/custom-mode', String(route?.path))
check('kind 是 exact（决定它只接这一个路径）', route?.kind === 'exact', String(route?.kind))
check('handler 是函数', typeof route?.handler === 'function')

/** 跑一次请求，返回 res。 */
async function call(req) {
  const res = makeRes()
  await route.handler(req, res)
  return res
}

console.log()
console.log('=== 1. 栅栏优先：被拒的请求不能产生任何副作用 ===')
{
  route = mount({ rejection: 401 })
  const before = readFileSync(promptPath, 'utf8')
  const getRes = await call(makeReq('GET', { headers: { host: '127.0.0.1:3080' } }))
  check('GET 被拒时返回 401', getRes.statusCode === 401, String(getRes.statusCode))
  check('401 的响应体是 unauthorized', getRes.body === 'unauthorized', getRes.body)
  check('401 时没有泄露状态（不含 ok:true）', !getRes.body.includes('ok'), getRes.body.slice(0, 60))

  const postRes = await call(makeReq('POST', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'standard', prompt: 'PWNED' }) }))
  check('POST 被拒时返回 401', postRes.statusCode === 401, String(postRes.statusCode))
  check('被拒的 POST 没有改写 prompt.md', readFileSync(promptPath, 'utf8') === before)
  check('被拒的 POST 没有改写组合文件', existsSync(compositionPath))

  route = mount({ rejection: 403 })
  const forbidden = await call(makeReq('GET', {}))
  check('跨站/不可信来源返回 403', forbidden.statusCode === 403, String(forbidden.statusCode))
  check('403 的响应体是 forbidden', forbidden.body === 'forbidden', forbidden.body)
}

console.log()
console.log('=== 2. connection 服务缺失时失败关闭 ===')
{
  route = mount({ connectionAvailable: false })
  const res = await call(makeReq('GET', {}))
  check('返回 503 而不是放行', res.statusCode === 503, String(res.statusCode))
  check('响应体说明是 unavailable（不是 forbidden）', res.body === 'unavailable', res.body)
}

console.log()
console.log('=== 3. GET：把状态交给页面 ===')
{
  route = mount({ rejection: undefined })
  const res = await call(makeReq('GET', { headers: { host: '127.0.0.1:3080' } }))
  check('200', res.statusCode === 200, String(res.statusCode))
  check('content-type 是 JSON', String(res.headers?.['content-type']).includes('application/json'), String(res.headers?.['content-type']))
  check('cache-control: no-store（保存后不能读回旧状态）', res.headers?.['cache-control'] === 'no-store', String(res.headers?.['cache-control']))
  check('声明了 content-length', Number(res.headers?.['content-length']) === Buffer.byteLength(res.body, 'utf8'))

  const state = JSON.parse(res.body)
  check('ok: true', state.ok === true)
  check('带基础模式列表（四个）', Array.isArray(state.modes) && state.modes.length === 4, JSON.stringify(state.modes?.map((m) => m.id)))
  check('当前模式是 standard', state.mode === 'standard', state.mode)
  check('带行树', Array.isArray(state.rows) && state.rows.length > 0, String(state.rows?.length))
  check('带提示词文本', state.prompt === 'PROMPT-ORIGINAL\n', JSON.stringify(state.prompt))
  check('行里有首次出现的 group 结构', state.rows.some((row) => row.id === 'planning' && row.group === true))
  check('带路径信息（页面底部显示）', state.compositionPath === compositionPath, String(state.compositionPath))
  check('平台条件在宿主端求值为"已停用"（Linux 上 pwsh）', state.rows.find((row) => row.id === 'tool-pwsh')?.disabledExpression !== null)
}

console.log()
console.log('=== 4. POST：写盘与校验 ===')
{
  route = mount({ rejection: undefined })
  const good = await call(
    makeReq('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'standard', overrides: { 'tool-web': false, 'tool-off-by-default': true }, prompt: 'PROMPT-NEW\n' }),
    }),
  )
  check('合法保存返回 200', good.statusCode === 200, String(good.statusCode))
  check('响应体 ok:true 且带 note', JSON.parse(good.body).ok === true && typeof JSON.parse(good.body).note === 'string')
  check('提示词已落盘', readFileSync(promptPath, 'utf8') === 'PROMPT-NEW\n', JSON.stringify(readFileSync(promptPath, 'utf8')))

  const written = readFileSync(compositionPath, 'utf8')
  check('组合文件带生成表头', written.startsWith('# 本文件由'), written.slice(0, 40))
  const webRow = written.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-web'))
  check('显式关闭的行写成 disabled: true', webRow !== undefined && /^\s*disabled: true$/m.test(webRow))
  const offRow = written.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-off-by-default'))
  check('显式打开出厂关闭的行 → 删掉 disabled', offRow !== undefined && !/^\s*disabled:/.test(offRow))
  const bashRow = written.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-bash'))
  check('未触碰的行保留 !!js 平台条件', bashRow !== undefined && /disabled: !!js process\.platform/.test(bashRow))

  const badJson = await call(makeReq('POST', { headers: { 'content-type': 'application/json' }, body: '{not json' }))
  check('非法 JSON → 400', badJson.statusCode === 400, String(badJson.statusCode))
  check('400 的说明提到 JSON', /JSON/.test(badJson.body))

  const badMode = await call(makeReq('POST', { headers: {}, body: JSON.stringify({ mode: 'nope', prompt: 'x' }) }))
  check('未知基础模式 → 400', badMode.statusCode === 400, String(badMode.statusCode))
  check('400 的说明提到未知模式', /未知/.test(badMode.body), badMode.body.slice(0, 80))

  const emptyPrompt = await call(makeReq('POST', { headers: {}, body: JSON.stringify({ mode: 'standard', prompt: '   ' }) }))
  check('空提示词 → 400', emptyPrompt.statusCode === 400, String(emptyPrompt.statusCode))
  check('拒绝说明解释了为什么不能留空', /空/.test(emptyPrompt.body), emptyPrompt.body.slice(0, 80))

  const before = readFileSync(promptPath, 'utf8')
  const badVar = await call(makeReq('POST', { headers: {}, body: JSON.stringify({ mode: 'standard', prompt: 'x {{foo}} y' }) }))
  check('未注册的 {{变量}} → 400', badVar.statusCode === 400, String(badVar.statusCode))
  check('被拒时文件未被改动', readFileSync(promptPath, 'utf8') === before)

  const withName = await call(
    makeReq('POST', {
      headers: {},
      body: JSON.stringify({ mode: 'standard', prompt: 'NAMED\n', name: '我的模式: 测试', description: 'a "quoted" one' }),
    }),
  )
  check('带模式名保存成功', withName.statusCode === 200, String(withName.statusCode))
  const meta = readFileSync(join(presetDir, 'preset.yml'), 'utf8')
  check('preset.yml 被写入且值被引号包裹', meta.includes('name: "我的模式: 测试"'), JSON.stringify(meta))
  check('preset.yml 里的引号被转义', meta.includes('description: "a \\"quoted\\" one"'), JSON.stringify(meta))
}

console.log()
console.log('=== 5. 其他方法与异常输入 ===')
{
  route = mount({ rejection: undefined })
  const put = await call(makeReq('PUT', {}))
  check('PUT → 405', put.statusCode === 405, String(put.statusCode))
  check('405 说明了只支持 GET/POST', /GET/.test(put.body) && /POST/.test(put.body), put.body)

  const huge = 'x'.repeat(4_000_001)
  const oversize = await call(makeReq('POST', { headers: {}, body: JSON.stringify({ mode: 'standard', prompt: huge }) }))
  check('超过 4MB 的请求体被拒（500 + 说明）', oversize.statusCode === 500 && /过大/.test(oversize.body), `${oversize.statusCode} ${oversize.body.slice(0, 60)}`)

  const undefinedMode = await call(makeReq('POST', { headers: {}, body: JSON.stringify({ prompt: 'x' }) }))
  check('缺少 mode → 400（不崩）', undefinedMode.statusCode === 400, String(undefinedMode.statusCode))

  const notObject = await call(makeReq('POST', { headers: {}, body: '"just a string"' }))
  check('请求体是字符串而不是对象 → 400（不崩）', notObject.statusCode === 400, String(notObject.statusCode))
}

console.log()
console.log('=== 6. 缺文件时的行为（不能崩） ===')
{
  const saved = readFileSync(compositionPath, 'utf8')
  rmSync(compositionPath, { force: true })
  route = mount({ rejection: undefined })
  const res = await call(makeReq('GET', {}))
  check('缺组合文件 → 200 且 ok:false + 明确错误', res.statusCode === 200 && JSON.parse(res.body).ok === false, res.body.slice(0, 90))
  writeFileSync(compositionPath, saved, 'utf8')
}

rmSync(dir, { recursive: true, force: true })

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
