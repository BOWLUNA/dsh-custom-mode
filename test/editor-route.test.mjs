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
 * So this drives the real handler with real `Request`/`Response` objects and asserts:
 *
 *   - **the fence is structural**: every route is registered through
 *     `ctx.connection.fetch.register` (the platform's `/api` channel, whose carrier applies the
 *     Host/Origin fence and browser auth before dispatch), and the source contains no hand-rolled
 *     `requestRejection` and no raw `webServer.register` — the exact shape that once let an
 *     unauthenticated caller read and rewrite the prompt;
 *   - a scoped `inject` that never gets its services registers NOTHING (rather than registering
 *     something unfenced, or parking the row in `pending`);
 *   - every endpoint: list / state read / state write / create / delete / reorder, including the
 *     per-path method table (a GET must never reach `create`) and unknown sub-paths;
 *   - the validation branches: bad JSON, bad mode, empty prompt, rejected interpolation,
 *     oversized body, unknown assistant id;
 *   - what the client half depends on: the `/api` prefix on both sides, and JSON responses.
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

const registeredRoutes = []
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

function makeCtx({ connectionAvailable = true } = {}) {
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
  const scope = {
    // Cordis 的作用域上也有 effect：注册路由时用它，disposer 交给宿主。
    effect: (fn) => fn(),
    agentPresets,
    connection: {
      fetch: {
        register(route) {
          registeredRoutes.push(route)
          return async () => {}
        },
      },
    },
  }
  return {
    effect: (fn) => fn(),
    // 作用域化的等待：真实 Cordis 会等到服务就绪再回调；这里用 connectionAvailable 模拟"等不到"。
    inject: (deps, callback) => {
      if (connectionAvailable) callback(scope)
    },
  }
}

/** 请求描述（不是 node 的 req）：call() 会把它变成真正的 Request。 */
function makeReq(method, { url, headers = {}, body } = {}) {
  return { method, url, headers, body }
}

/** 装一次插件，拿到它注册的全部 Fetch 路由。 */
function mount(options = {}) {
  registeredRoutes.length = 0
  editor.apply(makeCtx(options))
  return registeredRoutes
}

let mounted = mount()
check('注册了路由', mounted.length > 0, String(mounted.length))

console.log()
console.log('=== 0. 浏览器半与宿主半的路由常量不许漂移 ===')
{
  // 两半各自硬写了一份路径（bundle 不能 import 宿主半）。改一边忘一边 = 页面 404 或
  // 打到别的路由上，而且症状是「页面能开、功能全废」，所以直接对文本断言。
  const clientSource = readFileSync(new URL('../editor/client.js', import.meta.url), 'utf8')
  const match = /const ROUTE = "([^"]+)"/.exec(clientSource)
  check('能从 client.js 里读出 ROUTE', match !== null)
  check(
    'client.js 的 ROUTE = /api + 宿主半的 ROUTE_PATH',
    match !== null && match[1] === editor.API_PREFIX + editor.ROUTE_PATH,
    `${match === null ? '(none)' : match[1]} vs ${editor.API_PREFIX + editor.ROUTE_PATH}`,
  )

  // 工具是同一组路径的**第三处副本**。1.0.3 把路由迁到 /api 之后，截图工具里还留着旧路径，
  // 结果是"拿空响应当 JSON"（报错信息只有 "Unexpected end of JSON input"），而 CI 看不到 ——
  // 截图工具要浏览器才能跑。所以这里对文本断言：任何 '/custom-mode' 前必须紧跟 /api。
  for (const tool of ['tools/screenshots/screenshots.mjs', 'tools/browser-verify.mjs']) {
    const source = readFileSync(new URL(`../${tool}`, import.meta.url), 'utf8')
    const stale = [...source.matchAll(/(['"])\/custom-mode/g)].map((entry) => entry[0])
    check(`${tool} 里没有漏掉 /api 前缀的路径`, stale.length === 0, stale.join(', '))
  }
}

let handlerCalls = 0

/**
 * 跑一次请求：按"路径 + 方法"找到注册的路由，构造真正的 Request，返回 {statusCode, body}。
 *
 * 方法不匹配时**不调用 handler** 而是返回 404 —— 这正是平台的行为（Fetch 注册表按精确路径与方法
 * 分发，未声明的方法根本到不了 handler）。实测：POST 打到 GET-only 路由 → 404。
 */
async function call(req) {
  const url = new URL(req.url ?? editor.ROUTE_PATH, 'http://127.0.0.1')
  const path = editor.API_PREFIX + url.pathname
  const route = registeredRoutes.find((entry) => entry.path === path && entry.methods.includes(req.method))
  if (route === undefined) return { statusCode: 404, body: '', headers: {} }
  handlerCalls += 1
  const request = new Request(`http://127.0.0.1${route.path}${url.search}`, {
    method: req.method,
    headers: req.headers,
    ...req.body === undefined ? {} : { body: req.body },
  })
  const response = await route.fetch(request)
  return { statusCode: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) }
}

const post = (path, payload) =>
  makeReq('POST', { url: path, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })

console.log()
console.log('=== 0.5 rename 重试：Windows 并发保存的 EPERM 窗口（可注入，因此在 Linux 上也能验）===')
{
  // Windows 上两个 rename 指向同一目标会短暂 EPERM/EBUSY；随机临时名解决不了 dest-vs-dest。
  const attempts = []
  let calls = 0
  const flaky = (from, to) => {
    calls += 1
    attempts.push(calls)
    if (calls < 3) { const error = new Error('EPERM: operation not permitted'); error.code = 'EPERM'; throw error }
  }
  let slept = 0
  editor.renameWithRetry('a.tmp', 'a', { rename: flaky, sleep: (ms) => { slept += ms } })
  check('EPERM 会被重试到成功', calls === 3, String(calls))
  check('重试之间有退避', slept > 0, String(slept))

  let hardCalls = 0
  const hardFail = () => { hardCalls += 1; const error = new Error('ENOENT'); error.code = 'ENOENT'; throw error }
  let thrown = null
  try { editor.renameWithRetry('a.tmp', 'a', { rename: hardFail, sleep: () => {} }) } catch (error) { thrown = error }
  check('非临时性错误立刻抛出，不重试', hardCalls === 1 && thrown !== null, `${String(hardCalls)} ${String(thrown?.code)}`)

  let exhausted = 0
  const alwaysBusy = () => { exhausted += 1; const error = new Error('EBUSY'); error.code = 'EBUSY'; throw error }
  thrown = null
  try { editor.renameWithRetry('a.tmp', 'a', { rename: alwaysBusy, sleep: () => {}, attempts: 4 }) } catch (error) { thrown = error }
  check('一直 EBUSY 时按上限放弃并抛出', exhausted === 4 && thrown?.code === 'EBUSY', `${String(exhausted)}`)
}

console.log()
console.log('=== 1. 结构：注册在平台带围栏的频道上，且源码里没有手搓围栏 ===')
{
  mounted = mount()
  const paths = mounted.map((entry) => entry.path).sort()
  const expected = [
    '/api/custom-mode',
    '/api/custom-mode/create',
    '/api/custom-mode/delete',
    '/api/custom-mode/history',
    '/api/custom-mode/reorder',
    '/api/custom-mode/state',
  ]
  check('注册了 6 条精确路径', mounted.length === 6, String(mounted.length))
  check('路径集合正确（全部在 /api 之下）', JSON.stringify(paths) === JSON.stringify(expected), JSON.stringify(paths))
  check('每条都声明了 requestBody: buffered', mounted.every((entry) => entry.requestBody === 'buffered'))
  check('每条都有一个 fetch 函数', mounted.every((entry) => typeof entry.fetch === 'function'))
  check(
    'create / delete / reorder 只声明 POST（预取的 GET 不可能触发它们）',
    ['/api/custom-mode/create', '/api/custom-mode/delete', '/api/custom-mode/reorder']
      .every((path) => JSON.stringify(mounted.find((entry) => entry.path === path)?.methods) === JSON.stringify(['POST'])),
  )
  check(
    'state 同时声明 GET 与 POST',
    JSON.stringify(mounted.find((entry) => entry.path === '/api/custom-mode/state')?.methods) === JSON.stringify(['GET', 'POST']),
  )
  check(
    'history 只声明 GET（取旧版本是读操作）',
    JSON.stringify(mounted.find((entry) => entry.path === '/api/custom-mode/history')?.methods) === JSON.stringify(['GET']),
  )

  // 结构断言：这两样东西的存在本身就是旧漏洞的成因，所以直接对源码断言。
  const source = readFileSync(new URL('../editor/index.mjs', import.meta.url), 'utf8')
  // 断言"没有调用"而不是"没有出现这个词"：注释里解释历史是应该的。
  check('源码里不再调用手搓的 requestRejection()', !/requestRejection\s*\(/.test(source))
  check('源码里不再注册裸 webServer 路由', !/webServer\s*\.\s*register/.test(source))
  check('源码里确实用了 connection.fetch.register', source.includes('connection.fetch.register'))
}

console.log()
console.log('=== 2. 等不到 connection 时什么都不注册（不是"注册了但没鉴权"）===')
{
  const routes = mount({ connectionAvailable: false })
  check('没有注册任何路由', routes.length === 0, String(routes.length))
  check('也没有抛异常', true)
}

console.log()
console.log('=== 3. GET /custom-mode：助手列表 ===')
{
  mounted = mount()
  const res = await call(makeReq('GET', { headers: { host: '127.0.0.1:3080' } }))
  check('200', res.statusCode === 200, String(res.statusCode))
  check('content-type 是 JSON', String(res.headers?.['content-type']).includes('application/json'), String(res.headers?.['content-type']))
  check('cache-control: no-store（保存后不能读回旧状态）', res.headers?.['cache-control'] === 'no-store', String(res.headers?.['cache-control']))
  // content-length 由载体（平台）在序列化时补齐，不由我们声明 —— 这里只断言内容类型与禁用缓存。

  const payload = JSON.parse(res.body)
  check('ok: true', payload.ok === true)
  check('只列出本工具拥有的模式（custom），不含出厂模式', Array.isArray(payload.assistants) && payload.assistants.length === 1, JSON.stringify(payload.assistants))
  check('带显示名', payload.assistants[0]?.name === '自定义模式', JSON.stringify(payload.assistants[0]))
  check('带用户预设根目录', payload.root === userRoot, String(payload.root))
}

console.log()
console.log('=== 4. GET /custom-mode/state：一个助手的完整状态 ===')
{
  mounted = mount()
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

  // 「配置了却不生效」的告警码：这里的状态是出厂种子（有名字、有描述、身份行开着），
  // 所以一条都不该报 —— 误报比不报更糟（用户会学会忽略它）。
  // 这个夹具的 preset.yml 没写描述，所以「没有描述」这一条是**正确**的告警；
  // 关键是"身份行开着 + 提示词非空"时**不许**报"提示词不生效"。
  check(
    '默认状态只报无害项（没写描述），不误报提示词不生效',
    JSON.stringify(state.warnings) === '["noDescription"]',
    JSON.stringify(state.warnings),
  )

  // 关掉身份行（系统提示词）：此时 prompt.md 根本不会被注入 —— 必须主动点名。
  const personaOff = await call(post('/custom-mode/state', {
    id: 'custom', mode: 'standard', prompt: '我写的提示词\n', overrides: { persona: false },
  }))
  check('保存成功（关掉身份行，准备阶段）', personaOff.statusCode === 200, personaOff.body.slice(0, 80))
  const warned = JSON.parse((await call(makeReq('GET', { url: '/custom-mode/state?id=custom' }))).body)
  check(
    '关掉身份行 + 有提示词 → 报「提示词不生效」',
    warned.warnings.includes('personaOffWithPrompt'),
    JSON.stringify(warned.warnings),
  )
  // 把提示词清空就说不上"不生效"了 —— 告警必须跟着条件消失，否则用户会学会忽略它。
  const cleared = await call(post('/custom-mode/state', {
    id: 'custom', mode: 'standard', prompt: '还是有点内容\n', overrides: { persona: false },
  }))
  check('仍然开着时依旧报警', cleared.statusCode === 200 && JSON.parse((await call(makeReq('GET', { url: '/custom-mode/state?id=custom' }))).body).warnings.includes('personaOffWithPrompt'))

  // 「恢复出厂提示词」的数据来源：宿主必须把出厂模板一起给页面，否则那个按钮只能置灰。
  check(
    'state 带出厂提示词（新建助手时得到的那一份）',
    typeof state.factoryPrompt === 'string' && state.factoryPrompt.includes('{{model}}'),
    JSON.stringify(state.factoryPrompt).slice(0, 70),
  )
  check(
    '出厂提示词与打包模板逐字节一致',
    state.factoryPrompt === readFileSync(new URL('../editor/preset/prompt.md', import.meta.url), 'utf8'),
  )
  // 恢复之后必须能保存：出厂文本若过不了自己的校验，这个按钮就是个陷阱。
  const savedFactory = await call(post('/custom-mode/state', { id: 'custom', mode: 'standard', prompt: state.factoryPrompt }))
  check('出厂提示词能原样保存（恢复 → 保存这条链路成立）', savedFactory.statusCode === 200, `${savedFactory.statusCode} ${savedFactory.body.slice(0, 80)}`)

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
  mounted = mount()
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
console.log()
console.log('=== 5.5 改动历史：谁改过、能不能取回 ===')
{
  mounted = mount()
  // 保存一版 → 历史上必须有它。
  const saved = await call(post('/custom-mode/state', { id: 'custom', mode: 'standard', prompt: '历史第一版\n' }))
  check('保存成功（准备阶段）', saved.statusCode === 200, saved.body.slice(0, 80))

  const withHistory = JSON.parse((await call(makeReq('GET', { url: '/custom-mode/state?id=custom' }))).body)
  check('state 带历史列表', Array.isArray(withHistory.history) && withHistory.history.length >= 1, JSON.stringify(withHistory.history?.length))
  const newest = withHistory.history[0]
  check('历史项带序号/时间/来源/预览', Number.isInteger(newest?.n) && typeof newest.at === 'string' && newest.by === 'settings' && newest.preview === '历史第一版', JSON.stringify(newest))
  check('历史列表不带正文（正文按需取）', newest.text === undefined)

  const version = JSON.parse((await call(makeReq('GET', { url: `/custom-mode/history?id=custom&n=${String(newest.n)}` }))).body)
  check('按序号取回该版正文', version.ok === true && version.text === '历史第一版\n', JSON.stringify(version).slice(0, 80))

  const missing = await call(makeReq('GET', { url: '/custom-mode/history?id=custom&n=99999' }))
  check('未知序号 → 404', missing.statusCode === 404, String(missing.statusCode))
  const unknownId = await call(makeReq('GET', { url: '/custom-mode/history?id=nope&n=1' }))
  check('未知助手 → 404', unknownId.statusCode === 404, String(unknownId.statusCode))

  // 会话内的工具（或手工编辑）直接改盘：下次读状态必须补记一条 external，
  // 否则"提示词被改过"这件事对用户永远不可见 —— 这正是这个功能存在的理由。
  writeFileSync(promptPath, '会话内工具改的\n', 'utf8')
  const afterExternal = JSON.parse((await call(makeReq('GET', { url: '/custom-mode/state?id=custom' }))).body)
  const external = afterExternal.history[0]
  check('设置页之外的改动被记成 external', external.by === 'external' && external.preview === '会话内工具改的', JSON.stringify(external))
  check('旧版本仍在历史里（只追加）', afterExternal.history.some((entry) => entry.preview === '历史第一版'), JSON.stringify(afterExternal.history.map((e) => e.preview)))
  check('再读一次不会重复记（文本没变）', JSON.parse((await call(makeReq('GET', { url: '/custom-mode/state?id=custom' }))).body).history.length === afterExternal.history.length)
}

console.log('=== 6. POST /custom-mode/create：从模板建一个助手 ===')
{
  mounted = mount()
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
  mounted = mount()
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

  const callsBefore = handlerCalls
  const getReorder = await call(makeReq('GET', { url: '/custom-mode/reorder' }))
  check(
    'GET reorder → 404，且根本没进 handler（顺序不能被预取链接改动）',
    getReorder.statusCode === 404 && handlerCalls === callsBefore,
    `${getReorder.statusCode} handlerCalls=${handlerCalls - callsBefore}`,
  )
}

console.log()
console.log('=== 8. POST /custom-mode/delete：只能删自己管理的模式 ===')
{
  mounted = mount()
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
  mounted = mount()
  const put = await call(makeReq('PUT', {}))
  check('PUT → 404（该方法未声明，到不了 handler）', put.statusCode === 404, String(put.statusCode))
  check('未声明的方法返回空体（不是我们的 400/405 —— 根本没进 handler）', put.body === '', JSON.stringify(put.body))

  const getCreate = await call(makeReq('GET', { url: '/custom-mode/create' }))
  check('GET create → 404（预设抓取不能建助手）', getCreate.statusCode === 404, String(getCreate.statusCode))
  check('create 目录未被创建', !existsSync(join(userRoot, 'get-create')))

  const getDelete = await call(makeReq('GET', { url: '/custom-mode/delete' }))
  check('GET delete → 404', getDelete.statusCode === 404, String(getDelete.statusCode))

  const deep = await call(makeReq('GET', { url: '/custom-mode/whatever' }))
  check('未知子路径 → 404', deep.statusCode === 404, String(deep.statusCode))

  const sibling = await call(makeReq('GET', { url: '/custom-mode-other' }))
  check('前缀不吞掉兄弟路径之外的东西（仍归本路由，但子路径未知）', sibling.statusCode === 404, String(sibling.statusCode))
}

console.log()
console.log('=== 10. 其他异常输入 ===')
{
  mounted = mount()
  // 请求体上限不再由我们实现：`requestBody: 'buffered'` 的语义是"遵循平台配置的 JSON 上限"，
  // 超限由载体在分发前拒绝（§1 已断言每条路由都声明了 buffered）。这里只确认小体量解析正常。
  const parsedOk = await call(post('/custom-mode/state', { id: 'custom', mode: 'standard', prompt: 'ok' }))
  check('正常体量仍然解析成功', parsedOk.statusCode === 200, String(parsedOk.statusCode))

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
  mounted = mount()
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
