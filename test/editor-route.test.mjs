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
 *   - every endpoint: list / state read / state write / create / delete, including the
 *     per-path method table (a GET must never reach `create`) and unknown sub-paths;
 *   - the validation branches: bad JSON, bad mode, empty prompt, rejected interpolation,
 *     oversized body, unknown assistant id;
 *   - what the client half depends on: path, `kind: prefix`, JSON + `no-store` headers.
 *
 * The roster stand-in below mirrors `@deepseek-ai/dsh-agent-presets` closely enough to matter:
 * every directory under the user root becomes a row (even one whose composition is missing, which
 * discovery reports as BROKEN rather than skipping), and `remove` deletes the directory.
 *
 * Self-contained on purpose: the shipped presets come from a fixture directory this test builds,
 * so it needs neither dsh nor `@deepseek-ai/dsh-agent-presets` installed.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
const userRoot = join(dir, 'agent-presets')
const presetDir = join(userRoot, 'custom')
const promptPath = join(presetDir, 'prompt.md')
const compositionPath = join(presetDir, 'agent.cordis.yml')
const presetMetaPath = join(presetDir, 'preset.yml')

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
// 用户模式：本工具「拥有」一个模式的判据是 prompt.md + prompt-reader.mjs，
// 所以夹具必须两样都有，否则它会被当成别人手写的模式而不出现在管理列表里。
mkdirSync(presetDir, { recursive: true })
writeFileSync(join(presetDir, 'prompt-reader.mjs'), '// fixture reader\nexport function apply() {}\n', 'utf8')
writeFileSync(join(presetDir, 'prompt-tool.mjs'), '// fixture tool\nexport function apply() {}\n', 'utf8')

// 路径在 import 时求值，所以这两个环境变量必须在 import 之前设好。
process.env.DSH_CUSTOM_PROMPT_PATH = promptPath
process.env.DSH_SHIPPED_PRESETS_DIR = shippedDir

const { renderComposition } = await import('../editor/composition.mjs')
const { readPresetMeta } = await import('../editor/meta.mjs')
const editor = await import('../editor/index.mjs')

// 装上一份生成好的组合文件，让 readState() 有东西可读（和真实安装后的状态一致）
writeFileSync(compositionPath, renderComposition('standard', new Map()), 'utf8')
writeFileSync(promptPath, 'PROMPT-ORIGINAL\n', 'utf8')
writeFileSync(presetMetaPath, 'name: "自定义模式"\n', 'utf8')

// ── 桩：ctx / req / res ─────────────────────────────────────────────────────
const registeredRoutes = []

/**
 * Mirror `agent-presets` discovery: every id-shaped directory under the root is a row, and the
 * roster is ordered by `order` first, then id — which is why reordering writes `order` into
 * `preset.yml` instead of keeping a list of its own.
 */
function rosterRows() {
  const rows = [{ id: 'standard', trust: 'system', path: join(shippedDir, 'standard', 'agent.cordis.yml') }]
  const user = []
  for (const entry of readdirSync(userRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue
    const directory = join(userRoot, entry.name)
    const composition = join(directory, 'agent.cordis.yml')
    const meta = readPresetMeta(directory)
    user.push({
      id: entry.name,
      trust: 'user',
      path: composition,
      ...meta,
      ...existsSync(composition) ? {} : { broken: 'the composition file agent.cordis.yml is missing' },
    })
  }
  user.sort((left, right) => ((left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY)) || left.id.localeCompare(right.id))
  return [...rows, ...user]
}

function makeCtx({ rejection, connectionAvailable = true } = {}) {
  const webServer = {
    register(route) {
      registeredRoutes.push(route)
      return () => {}
    },
  }
  const agentPresets = {
    async list() {
      return rosterRows()
    },
    async remove(id) {
      const row = rosterRows().find((entry) => entry.id === id)
      if (row === undefined) throw new Error(`agent-presets: no configured root supplies ${id}`)
      if (row.trust !== 'user') throw new Error(`agent-presets: ${id} ships with the deployment`)
      rmSync(dirname(row.path), { recursive: true, force: true })
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

function makeReq(method, { url, headers = {}, body } = {}) {
  const req = { method, headers }
  if (url !== undefined) req.url = url
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
check('kind 是 prefix（一条路由覆盖列表与三个子路径）', route?.kind === 'prefix', String(route?.kind))
check('handler 是函数', typeof route?.handler === 'function')

console.log()
console.log('=== 0. 浏览器半与宿主半的路由常量不许漂移 ===')
{
  // 两半各自硬写了一份路径（bundle 不能 import 宿主半）。改一边忘一边 = 页面 404 或
  // 打到别的路由上，而且症状是「页面能开、功能全废」，所以直接对文本断言。
  const clientSource = readFileSync(new URL('../editor/client.js', import.meta.url), 'utf8')
  const match = /const ROUTE = "([^"]+)"/.exec(clientSource)
  check('能从 client.js 里读出 ROUTE', match !== null)
  check(
    'client.js 的 ROUTE 与宿主半的 ROUTE_PATH 一致',
    match !== null && match[1] === editor.ROUTE_PATH,
    `${match === null ? '(none)' : match[1]} vs ${editor.ROUTE_PATH}`,
  )
}

/** 跑一次请求，返回 res。 */
async function call(req) {
  const res = makeRes()
  await route.handler(req, res)
  return res
}

const post = (path, payload) =>
  makeReq('POST', { url: path, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })

console.log()
console.log('=== 1. 栅栏优先：被拒的请求不能产生任何副作用 ===')
{
  route = mount({ rejection: 401 })
  const before = readFileSync(promptPath, 'utf8')
  const getRes = await call(makeReq('GET', { headers: { host: '127.0.0.1:3080' } }))
  check('GET 被拒时返回 401', getRes.statusCode === 401, String(getRes.statusCode))
  check('401 的响应体是 unauthorized', getRes.body === 'unauthorized', getRes.body)
  check('401 时没有泄露状态（不含 ok:true）', !getRes.body.includes('ok'), getRes.body.slice(0, 60))

  const postRes = await call(post('/custom-mode/state', { id: 'custom', mode: 'standard', prompt: 'PWNED' }))
  check('POST 被拒时返回 401', postRes.statusCode === 401, String(postRes.statusCode))
  check('被拒的 POST 没有改写 prompt.md', readFileSync(promptPath, 'utf8') === before)
  check('被拒的 POST 没有改写组合文件', existsSync(compositionPath))

  const createRes = await call(post('/custom-mode/create', { name: 'PWNED' }))
  check('被拒的 create 返回 401', createRes.statusCode === 401, String(createRes.statusCode))
  check('被拒的 create 没有建目录', !existsSync(join(userRoot, 'pwned')))

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
console.log('=== 3. GET /custom-mode：助手列表 ===')
{
  route = mount({ rejection: undefined })
  const res = await call(makeReq('GET', { headers: { host: '127.0.0.1:3080' } }))
  check('200', res.statusCode === 200, String(res.statusCode))
  check('content-type 是 JSON', String(res.headers?.['content-type']).includes('application/json'), String(res.headers?.['content-type']))
  check('cache-control: no-store（保存后不能读回旧状态）', res.headers?.['cache-control'] === 'no-store', String(res.headers?.['cache-control']))
  check('声明了 content-length', Number(res.headers?.['content-length']) === Buffer.byteLength(res.body, 'utf8'))

  const payload = JSON.parse(res.body)
  check('ok: true', payload.ok === true)
  check('只列出本工具拥有的模式（custom），不含出厂模式', Array.isArray(payload.assistants) && payload.assistants.length === 1, JSON.stringify(payload.assistants))
  check('带显示名', payload.assistants[0]?.name === '自定义模式', JSON.stringify(payload.assistants[0]))
  check('带用户预设根目录', payload.root === userRoot, String(payload.root))
}

console.log()
console.log('=== 4. GET /custom-mode/state：一个助手的完整状态 ===')
{
  route = mount({ rejection: undefined })
  const res = await call(makeReq('GET', { url: '/custom-mode/state?id=custom' }))
  check('200', res.statusCode === 200, String(res.statusCode))
  const state = JSON.parse(res.body)
  check('ok: true 且带 id', state.ok === true && state.id === 'custom', JSON.stringify({ ok: state.ok, id: state.id }))
  check('带基础模式列表（四个）', Array.isArray(state.modes) && state.modes.length === 4, JSON.stringify(state.modes?.map((m) => m.id)))
  check('当前模式是 standard', state.mode === 'standard', state.mode)
  check('带行树', Array.isArray(state.rows) && state.rows.length > 0, String(state.rows?.length))
  check('带提示词文本', state.prompt === 'PROMPT-ORIGINAL\n', JSON.stringify(state.prompt))
  check('行里有首次出现的 group 结构', state.rows.some((row) => row.id === 'planning' && row.group === true))
  check('带路径信息（页面底部显示）', state.compositionPath === compositionPath, String(state.compositionPath))
  check('平台条件在宿主端求值为"已停用"（Linux 上 pwsh）', state.rows.find((row) => row.id === 'tool-pwsh')?.disabledExpression !== null)

  const unknown = await call(makeReq('GET', { url: '/custom-mode/state?id=nope' }))
  const unknownBody = JSON.parse(unknown.body)
  check('未知 id → 200 且 ok:false（页面能显示原因）', unknown.statusCode === 200 && unknownBody.ok === false, unknown.body.slice(0, 90))
  check('未知 id 的说明指出这是本工具不管理的模式', /找不到助手/.test(String(unknownBody.error)), String(unknownBody.error).slice(0, 80))

  const noId = await call(makeReq('GET', { url: '/custom-mode/state' }))
  check('缺 id → ok:false，不崩', JSON.parse(noId.body).ok === false, noId.body.slice(0, 80))
}

console.log()
console.log('=== 5. POST /custom-mode/state：写盘与校验 ===')
{
  route = mount({ rejection: undefined })
  const good = await call(
    post('/custom-mode/state', {
      id: 'custom',
      mode: 'standard',
      overrides: { 'tool-web': false, 'tool-off-by-default': true },
      prompt: 'PROMPT-NEW\n',
      name: '我的模式: 测试',
      description: 'a "quoted" one',
    }),
  )
  check('合法保存返回 200', good.statusCode === 200, String(good.statusCode))
  check('响应体 ok:true 且带 note', JSON.parse(good.body).ok === true && typeof JSON.parse(good.body).note === 'string')
  check('提示词已落盘', readFileSync(promptPath, 'utf8') === 'PROMPT-NEW\n', JSON.stringify(readFileSync(promptPath, 'utf8')))

  const written = readFileSync(compositionPath, 'utf8')
  check('组合文件带生成表头', written.startsWith('# 本文件由'), written.slice(0, 40))
  check('表头记录了这是哪个助手', /^# 助手: 我的模式: 测试 \(custom\)$/m.test(written), written.split('\n').slice(0, 4).join(' | '))
  const webRow = written.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-web'))
  check('显式关闭的行写成 disabled: true', webRow !== undefined && /^\s*disabled: true$/m.test(webRow))
  const offRow = written.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-off-by-default'))
  check('显式打开出厂关闭的行 → 删掉 disabled', offRow !== undefined && !/^\s*disabled:/.test(offRow))
  const bashRow = written.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-bash'))
  check('未触碰的行保留 !!js 平台条件', bashRow !== undefined && /disabled: !!js process\.platform/.test(bashRow))
  check('custom_prompt 行带上了本助手的名字', /modeName: "我的模式: 测试"/.test(written), written.slice(-260))

  const meta = readFileSync(presetMetaPath, 'utf8')
  check('preset.yml 被写入且值被引号包裹', meta.includes('name: "我的模式: 测试"'), JSON.stringify(meta))
  check('preset.yml 里的引号被转义', meta.includes('description: "a \\"quoted\\" one"'), JSON.stringify(meta))

  const badJson = await call(makeReq('POST', { url: '/custom-mode/state', headers: { 'content-type': 'application/json' }, body: '{not json' }))
  check('非法 JSON → 400', badJson.statusCode === 400, String(badJson.statusCode))
  check('400 的说明提到 JSON', /JSON/.test(badJson.body))

  const badMode = await call(post('/custom-mode/state', { id: 'custom', mode: 'nope', prompt: 'x' }))
  check('未知基础模式 → 400', badMode.statusCode === 400, String(badMode.statusCode))
  check('400 的说明提到未知模式', /未知/.test(badMode.body), badMode.body.slice(0, 80))

  const emptyPrompt = await call(post('/custom-mode/state', { id: 'custom', mode: 'standard', prompt: '   ' }))
  check('空提示词 → 400', emptyPrompt.statusCode === 400, String(emptyPrompt.statusCode))
  check('拒绝说明解释了为什么不能留空', /空/.test(emptyPrompt.body), emptyPrompt.body.slice(0, 80))

  const before = readFileSync(promptPath, 'utf8')
  const badVar = await call(post('/custom-mode/state', { id: 'custom', mode: 'standard', prompt: 'x {{foo}} y' }))
  check('未注册的 {{变量}} → 400', badVar.statusCode === 400, String(badVar.statusCode))
  check('被拒时文件未被改动', readFileSync(promptPath, 'utf8') === before)

  const unknownId = await call(post('/custom-mode/state', { id: 'standard', mode: 'standard', prompt: 'x' }))
  check('出厂模式不可被本工具改写 → 400', unknownId.statusCode === 400, String(unknownId.statusCode))

  const longName = await call(post('/custom-mode/state', { id: 'custom', mode: 'standard', prompt: 'x', name: 'x'.repeat(200) }))
  check('超长名称 → 400', longName.statusCode === 400, String(longName.statusCode))
}

console.log()
console.log('=== 6. POST /custom-mode/create：从模板建一个助手 ===')
{
  route = mount({ rejection: undefined })
  const empty = await call(post('/custom-mode/create', { name: '   ' }))
  check('空名字 → 400', empty.statusCode === 400, String(empty.statusCode))
  check('空名字的说明要用户起名', /名字/.test(empty.body), empty.body.slice(0, 80))

  const created = await call(post('/custom-mode/create', { name: '写作助手', description: '写文档' }))
  check('创建返回 200', created.statusCode === 200, `${created.statusCode} ${created.body.slice(0, 80)}`)
  const body = JSON.parse(created.body)
  check('中文名回落到 custom-2（custom 已被占用）', body.id === 'custom-2', String(body.id))
  const createdDir = join(userRoot, 'custom-2')
  check('目录已建立', existsSync(createdDir))
  for (const name of ['agent.cordis.yml', 'prompt.md', 'prompt-reader.mjs', 'prompt-tool.mjs', 'preset.yml']) {
    check(`模板文件就位：${name}`, existsSync(join(createdDir, name)))
  }
  const createdMeta = readFileSync(join(createdDir, 'preset.yml'), 'utf8')
  check('preset.yml 带上了名字', createdMeta.includes('name: "写作助手"'), JSON.stringify(createdMeta))
  check('preset.yml 带上了描述', createdMeta.includes('description: "写文档"'), JSON.stringify(createdMeta))
  const createdComposition = readFileSync(join(createdDir, 'agent.cordis.yml'), 'utf8')
  check('新助手的组成文件是 standard 底子', /^# 基础模式: standard$/m.test(createdComposition))
  check('新助手的 custom_prompt 行认识自己', /modeName: "写作助手"/.test(createdComposition))
  check('新助手出现在列表接口里', JSON.parse((await call(makeReq('GET', { url: '/custom-mode' }))).body).assistants.some((item) => item.id === 'custom-2'))

  // 名字本身是合法 id 时就用它，目录名可读。
  const latin = await call(post('/custom-mode/create', { name: 'Writer' }))
  check('英文名直接用作用户目录名', JSON.parse(latin.body).id === 'writer', latin.body.slice(0, 80))

  const clash = await call(post('/custom-mode/create', { name: 'Writer' }))
  check('重名不覆盖：换一个可用 id', clash.statusCode === 200 && JSON.parse(clash.body).id === 'writer-2', clash.body.slice(0, 90))

  // 必须能真的被读到（新会话就是这样拿到它的）
  const opened = await call(makeReq('GET', { url: '/custom-mode/state?id=custom-2' }))
  check('新助手可被读取', JSON.parse(opened.body).ok === true, opened.body.slice(0, 90))

  // ── 复制：源是第 5 节保存过的 custom（非默认提示词 + 非空开关）──────────────
  const sourceState = JSON.parse((await call(makeReq('GET', { url: '/custom-mode/state?id=custom' }))).body)
  const duplicated = await call(post('/custom-mode/create', { name: '测试副本', from: 'custom' }))
  check('复制返回 200', duplicated.statusCode === 200 && JSON.parse(duplicated.body).ok === true, duplicated.body.slice(0, 90))
  const dupId = JSON.parse(duplicated.body).id
  check('复制体拿到新 id（不与源同目录）', dupId !== 'custom' && dupId !== undefined, String(dupId))
  const dupState = JSON.parse((await call(makeReq('GET', { url: '/custom-mode/state?id=' + dupId }))).body)
  check('复制来的提示词与源逐字一致', dupState.prompt === sourceState.prompt, JSON.stringify([dupState.prompt, sourceState.prompt]))
  check('复制来的基础模式与源一致', dupState.mode === sourceState.mode, `${dupState.mode} vs ${sourceState.mode}`)
  check(
    '复制来的行开关与源一致',
    JSON.stringify(dupState.overrides) === JSON.stringify(sourceState.overrides),
    `${JSON.stringify(dupState.overrides)} vs ${JSON.stringify(sourceState.overrides)}`,
  )
  check('复制体是两个独立文件', dupState.promptPath !== sourceState.promptPath)
  check('复制体的组成文件报的是自己的名字', /^# 助手: 测试副本 \(/m.test(readFileSync(dupState.compositionPath, 'utf8')), dupState.compositionPath)

  const badFrom = await call(post('/custom-mode/create', { name: 'X', from: 'nope' }))
  check('源不存在时拒绝复制 → 400', badFrom.statusCode === 400, String(badFrom.statusCode))
}

console.log()
console.log('=== 7. POST /custom-mode/reorder：顺序即 roster 的 order ===')
{
  route = mount({ rejection: undefined })
  const before = JSON.parse((await call(makeReq('GET', { url: '/custom-mode' }))).body).assistants.map((item) => item.id)
  check('排序前已有多个助手', before.length >= 3, JSON.stringify(before))

  const second = before[1]
  const moved = await call(post('/custom-mode/reorder', { id: second, direction: 'up' }))
  check('上移返回 200', moved.statusCode === 200 && JSON.parse(moved.body).ok === true, moved.body.slice(0, 90))
  const after = JSON.parse((await call(makeReq('GET', { url: '/custom-mode' }))).body).assistants.map((item) => item.id)
  check('列表顺序真的变了（前两名互换）', after[0] === second && after[1] === before[0], JSON.stringify({ before, after }))
  check(
    'order 落在 preset.yml 里（重启后仍然生效，不靠插件自己的状态）',
    /^order: 1$/m.test(readFileSync(join(userRoot, second, 'preset.yml'), 'utf8')),
    readFileSync(join(userRoot, second, 'preset.yml'), 'utf8'),
  )

  const atTop = await call(post('/custom-mode/reorder', { id: after[0], direction: 'up' }))
  check('已是最前再上移 → 400', atTop.statusCode === 400, String(atTop.statusCode))
  const unknown = await call(post('/custom-mode/reorder', { id: 'nope', direction: 'up' }))
  check('未知 id → 400', unknown.statusCode === 400, String(unknown.statusCode))
  const badDirection = await call(post('/custom-mode/reorder', { id: second, direction: 'sideways' }))
  check('未知方向 → 400', badDirection.statusCode === 400, String(badDirection.statusCode))

  const getReorder = await call(makeReq('GET', { url: '/custom-mode/reorder' }))
  check('GET reorder → 405（顺序不能被预取链接改动）', getReorder.statusCode === 405, String(getReorder.statusCode))
}

console.log()
console.log('=== 8. POST /custom-mode/delete：只能删自己管理的模式 ===')
{
  route = mount({ rejection: undefined })
  const system = await call(post('/custom-mode/delete', { id: 'standard' }))
  check('删出厂模式 → 400', system.statusCode === 400, String(system.statusCode))
  check('说明里点出「找不到助手」而不是笼统失败', /找不到助手/.test(system.body), system.body.slice(0, 90))

  const unknown = await call(post('/custom-mode/delete', { id: 'nope' }))
  check('删不存在的 → 400', unknown.statusCode === 400, String(unknown.statusCode))

  const removed = await call(post('/custom-mode/delete', { id: 'writer' }))
  check('删除自己创建的 → 200', removed.statusCode === 200, `${removed.statusCode} ${removed.body.slice(0, 80)}`)
  check('目录真的没了', !existsSync(join(userRoot, 'writer')))
  check('列表里也没了', !JSON.parse((await call(makeReq('GET', { url: '/custom-mode' }))).body).assistants.some((item) => item.id === 'writer'))
  check('其它助手不受影响', existsSync(join(userRoot, 'custom-2')))
}

console.log()
console.log('=== 9. 方法与子路径 ===')
{
  route = mount({ rejection: undefined })
  const put = await call(makeReq('PUT', {}))
  check('PUT → 405', put.statusCode === 405, String(put.statusCode))
  check('405 列出了该路径允许的方法', /GET/.test(put.body), put.body)

  const getCreate = await call(makeReq('GET', { url: '/custom-mode/create' }))
  check('GET create → 405（预设抓取不能建助手）', getCreate.statusCode === 405, String(getCreate.statusCode))
  check('create 目录未被创建', !existsSync(join(userRoot, 'get-create')))

  const getDelete = await call(makeReq('GET', { url: '/custom-mode/delete' }))
  check('GET delete → 405', getDelete.statusCode === 405, String(getDelete.statusCode))

  const deep = await call(makeReq('GET', { url: '/custom-mode/whatever' }))
  check('未知子路径 → 404', deep.statusCode === 404, String(deep.statusCode))

  const sibling = await call(makeReq('GET', { url: '/custom-mode-other' }))
  check('前缀不吞掉兄弟路径之外的东西（仍归本路由，但子路径未知）', sibling.statusCode === 404, String(sibling.statusCode))
}

console.log()
console.log('=== 10. 其他异常输入 ===')
{
  route = mount({ rejection: undefined })
  const huge = 'x'.repeat(4_000_001)
  const oversize = await call(post('/custom-mode/state', { id: 'custom', mode: 'standard', prompt: huge }))
  check('超过 4MB 的请求体被拒（500 + 说明）', oversize.statusCode === 500 && /过大/.test(oversize.body), `${oversize.statusCode} ${oversize.body.slice(0, 60)}`)

  const undefinedMode = await call(post('/custom-mode/state', { id: 'custom', prompt: 'x' }))
  check('缺少 mode → 400（不崩）', undefinedMode.statusCode === 400, String(undefinedMode.statusCode))

  const notObject = await call(makeReq('POST', { url: '/custom-mode/state', headers: {}, body: '"just a string"' }))
  check('请求体是字符串而不是对象 → 400（不崩）', notObject.statusCode === 400, String(notObject.statusCode))
}

console.log()
console.log('=== 11. 缺文件时的行为（不能崩） ===')
{
  // 注意顺序：`apply()` 现在会补全 preset 里缺失的模板文件，所以"文件不见了"这个场景
  // 必须是**激活之后**才发生的——删在前会被补回来。
  const saved = readFileSync(compositionPath, 'utf8')
  route = mount({ rejection: undefined })
  rmSync(compositionPath, { force: true })
  const res = await call(makeReq('GET', { url: '/custom-mode/state?id=custom' }))
  check('缺组合文件 → 200 且 ok:false + 明确错误', res.statusCode === 200 && JSON.parse(res.body).ok === false, res.body.slice(0, 90))
  check('缺文件时说明是哪个文件', String(JSON.parse(res.body).error).includes(compositionPath), res.body.slice(0, 140))
  writeFileSync(compositionPath, saved, 'utf8')
}

rmSync(dir, { recursive: true, force: true })

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
