/**
 * `custom_prompt` tool tests — the no-browser editing channel.
 *
 * Run: node test/prompt-tool.test.mjs
 *
 * Why this exists: `preset/prompt-tool.mjs` had no test at all, yet it is the *durable*
 * editing path — the one that survives a process restart, when the settings page (a
 * bundle-provided web UI) may not be there. It also carries its own copy of the
 * `{{…}}` validation that `editor/index.mjs` has, deliberately duplicated; nothing
 * checked that the two still agree, which is the same silent-drift risk as the locale
 * copy in `client.js`. Both are covered here.
 *
 * The module resolves its prompt file relative to ITS OWN location, so the test copies
 * it into a temp directory and imports the copy — writes then land in the temp dir and
 * never touch the repo's `preset/prompt.md`.
 */

import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)

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

const dir = mkdtempSync(join(tmpdir(), 'dsh-custom-tool-'))
const source = join(REPO, 'preset', 'prompt-tool.mjs')
const copy = join(dir, 'prompt-tool.mjs')
copyFileSync(source, copy)
const promptPath = join(dir, 'prompt.md')

/** Import the tool from its temp copy (so its prompt path is the temp one). */
const tool = await import(pathToFileURL(copy).href)

/** Capture the registered definition through a stand-in context, as the registry would. */
function captureDefinition() {
  const registered = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    tools: {
      register(definition) {
        registered.push(definition)
        return () => {}
      },
    },
  }
  tool.apply(ctx)
  return registered[0]
}

const definition = captureDefinition()

console.log()
console.log('=== 1. 工具的形状（模型看到的就是这些） ===')
check('注册了一个工具', definition !== undefined)
check('名字是 custom_prompt（文档里承诺的名字）', definition?.name === 'custom_prompt', String(definition?.name))
check('有描述', typeof definition?.description === 'string' && definition.description.length > 40)
check('参数里 action 是 read|write|append 枚举', JSON.stringify(definition?.parameters?.properties?.action?.enum) === '["read","write","append"]', JSON.stringify(definition?.parameters?.properties?.action?.enum))
check('参数里声明了 text', definition?.parameters?.properties?.text?.type === 'string')
check('输出 schema 是 string', definition?.output?.schema?.type === 'string')
check('execute 是函数', typeof definition?.execute === 'function')

console.log()
console.log('=== 1.4 append：加一条规则不必"先读再整文件覆写" ===')
{
  writeFileSync(promptPath, '原有内容第一行\n', 'utf8')
  const appended = await definition.execute({ action: 'append', text: '新规则：结尾不要征询式问句。' })
  const after = readFileSync(promptPath, 'utf8')
  check('append 返回成功说明（带新增与总字符数）', /已追加/.test(appended) && /现共/.test(appended), String(appended).slice(0, 80))
  check('原有内容原样保留', after.startsWith('原有内容第一行\n'), JSON.stringify(after.slice(0, 24)))
  check('新文本追加在末尾且恰好一个换行分隔', after === '原有内容第一行\n新规则：结尾不要征询式问句。\n', JSON.stringify(after))

  // 追加同样不能把未注册变量带进文件 —— 校验的是**合并后**的完整文本。
  writeFileSync(promptPath, '干净的内容。\n', 'utf8')
  const rejected = await definition.execute({ action: 'append', text: '带一个 {{nope}} 变量。' })
  check('追加含未注册变量 → 被拒绝', /追加被拒绝/.test(rejected), String(rejected).slice(0, 80))
  check('被拒绝时文件未改动', readFileSync(promptPath, 'utf8') === '干净的内容。\n')

  // 空 text 拒绝；文件不存在时从空开始（读取器本来就对缺失文件有回退）。
  check('append 空 text → 拒绝', /追加被拒绝/.test(await definition.execute({ action: 'append', text: '   ' })))
  rmSync(promptPath, { force: true })
  const fromNothing = await definition.execute({ action: 'append', text: '从空文件开始的第一条规则。' })
  check('文件不存在时 append 也能建起来', /已追加/.test(fromNothing) && readFileSync(promptPath, 'utf8') === '从空文件开始的第一条规则。\n', JSON.stringify(readFileSync(promptPath, 'utf8')))
}

console.log()
console.log('=== 1.5 审批闸门：改写提示词必须过平台的审批缝 ===')
{
  // 真机实测（0.1.6-alpha.2）：返回 {kind:'ask'} 后，审批策略为 ask 时会弹「拒绝 / 允许一次」，
  // 允许则工具执行；策略为 never 时**不弹窗、直接判为拒绝**。所以这条闸门最坏是"改不成"。
  const handlers = []
  const warnings = []
  const originalError = console.error
  console.error = (...args) => warnings.push(args.join(' '))
  let ctx = {
    effect: (fn) => fn(),
    on: (event, handler) => { handlers.push({ event, handler }); return () => {} },
    tools: { register: () => () => {} },
  }
  tool.apply(ctx)
  console.error = originalError

  check('注册了一个 tools/pre-execute 监听', handlers.length === 1 && handlers[0].event === 'tools/pre-execute', JSON.stringify(handlers.map((h) => h.event)))
  const gate = handlers[0].handler
  const next = async () => ({ kind: 'gate-passed-through' })

  const writeVerdict = await gate({ name: 'custom_prompt', arguments: { action: 'write', text: '第一行内容\n第二行' } }, next)
  check('write → ask（交给审批策略）', writeVerdict?.kind === 'ask', JSON.stringify(writeVerdict))
  check('理由里带上将被写入的内容预览', typeof writeVerdict?.reason === 'string' && writeVerdict.reason.includes('第一行内容'), String(writeVerdict?.reason))
  check('理由里带上目标文件路径', String(writeVerdict?.reason).includes('prompt.md'), String(writeVerdict?.reason))
  check('理由里带上字符数', /\d+ 字符/.test(String(writeVerdict?.reason)), String(writeVerdict?.reason))

  const longText = 'x'.repeat(500)
  const longVerdict = await gate({ name: 'custom_prompt', arguments: { action: 'write', text: longText } }, next)
  // 判据是"没有把整段塞进去"，而不是某个具体字数：理由是双语的（安全决策界面两种语言都要能读懂），
  // 所以上限跟着放宽，但仍然断言 500 字符的正文没有被整段带进面板。
  // 判据必须与环境无关：理由里会带写入路径，Windows 上路径更长 —— 用"截断到 60 字"来断言，
  // 而不是某个字数上限（那个上限在 Windows 上曾经误报过）。
  check(
    '超长内容只截断展示（不把整段塞进审批理由）',
    String(longVerdict?.reason).includes('x'.repeat(100)) === false && String(longVerdict?.reason).includes('x'.repeat(60)) === true,
    String(String(longVerdict?.reason).length),
  )

  const appendVerdict = await gate({ name: 'custom_prompt', arguments: { action: 'append', text: '新增一条规则\n' } }, next)
  check('append → ask（追加同样在改系统提示词）', appendVerdict?.kind === 'ask', JSON.stringify(appendVerdict))
  check('append 的审批理由说的是"追加"', /追加/.test(String(appendVerdict?.reason)), String(appendVerdict?.reason))
  check('read → 放行（改不了东西的调用不弹窗）', (await gate({ name: 'custom_prompt', arguments: { action: 'read' } }, next))?.kind === 'gate-passed-through')
  check('未指定 action → 放行（工具按 read 处理）', (await gate({ name: 'custom_prompt', arguments: {} }, next))?.kind === 'gate-passed-through')
  check('别的工具 → 放行', (await gate({ name: 'tool-bash', arguments: { command: 'ls' } }, next))?.kind === 'gate-passed-through')
  check('参数不是对象也不崩', (await gate({ name: 'custom_prompt', arguments: null }, next))?.kind === 'gate-passed-through')

  // 工具名漂移 = 闸门静默失效，所以钉住它。
  check('闸门用的名字与工具定义里的名字一致', definition?.name === 'custom_prompt')

  // 宿主没有这个事件时：工具照常注册，但必须**明确**说一声（不许静默降级）。
  const quiet = []
  const originalError2 = console.error
  console.error = (...args) => quiet.push(args.join(' '))
  tool.apply({ effect: (fn) => fn(), tools: { register: () => () => {} } })
  console.error = originalError2
  check('宿主无 tools/pre-execute 时明确告警', quiet.some((line) => line.includes('审批闸门') && line.includes('未启用')), JSON.stringify(quiet.slice(0, 1)))
}

console.log()
console.log('=== 1.6 绕过回归：不认识的 action 既不能静默替换，也不能不弹审批 ===')
{
  // 本轮修复的 P0。闸门过去只拦 `write` / `append` 两个字面量，而 execute 把"既不是 read 也不是
  // append"的**任何** action 都当成整体替换 —— 于是拼成 `replace` / `Write` / 空串 / 末尾多一个
  // 空格就能绕过审批面板直接改掉用户的提示词。两层都要钉住：闸门对"一切非纯读取"发问，
  // execute 拒绝未知动词。只用一层的话，另一层日后被改回原样就没人拦得住。
  const handlers = []
  const ctx = {
    effect: (fn) => fn(),
    on: (event, handler) => { handlers.push({ event, handler }); return () => {} },
    tools: { register: () => () => {} },
  }
  tool.apply(ctx)
  const gate = handlers[0].handler
  const next = async () => ({ kind: 'gate-passed-through' })

  for (const odd of ['replace', 'Write', 'WRITE', 'overwrite', 'set', '', 'append ']) {
    const verdict = await gate({ name: 'custom_prompt', arguments: { action: odd, text: '任意内容' } }, next)
    check(`闸门对未知 action ${JSON.stringify(odd)} 发问（不静默放行）`, verdict?.kind === 'ask', JSON.stringify(verdict))
  }

  const before = await definition.execute({ action: 'read' })
  for (const odd of ['replace', 'Write', 'append ']) {
    const answer = await definition.execute({ action: odd, text: 'SHOULD-NOT-LAND\n' })
    check(`execute 拒绝未知 action ${JSON.stringify(odd)}`, /写入被拒绝/.test(answer), String(answer).slice(0, 80))
  }
  check('未知 action 之后磁盘上的提示词一字未动', (await definition.execute({ action: 'read' })) === before)
}

console.log()
console.log('=== 2. 缺文件时的读取：给出可读提示，而不是空串 ===')
{
  rmSync(promptPath, { force: true })
  const text = await definition.execute({ action: 'read' })
  check('缺文件时不是空串', typeof text === 'string' && text.trim() !== '')
  check('缺文件时说明当前模式会退回上一版', text.includes('不存在'), text.slice(0, 60))
}

console.log()
console.log('=== 3. 默认 action 是 read ===')
{
  writeFileSync(promptPath, 'HELLO-PROMPT', 'utf8')
  const text = await definition.execute({})
  check('不传 action 时读文件', text.includes('HELLO-PROMPT'), text.slice(0, 80))
  check('读取结果里带路径', text.includes(promptPath), text.slice(0, 120))
}

console.log()
console.log('=== 4. 写入：内容逐字节落盘，并说明何时生效 ===')
{
  const text = await definition.execute({ action: 'write', text: 'NEW-PROMPT\n第二行\n' })
  check('写入返回成功说明', /已写入/.test(text) && /下一步/.test(text), text)
  check('文件内容与写入一致', readFileSync(promptPath, 'utf8') === 'NEW-PROMPT\n第二行\n', JSON.stringify(readFileSync(promptPath, 'utf8')))
  const readBack = await definition.execute({ action: 'read' })
  check('再读回来是新内容', readBack.includes('NEW-PROMPT'))
}

console.log()
console.log('=== 5. 校验：会被渲染器拒绝的写法一律不落盘 ===')
{
  writeFileSync(promptPath, 'KEEP-THIS', 'utf8')
  const bad = [
    ['未知变量', 'x {{foo}} y'],
    ['空变量', 'x {{}} y'],
    ['带空格', 'x {{ model }} y'],
    ['大写', 'x {{Model}} y'],
    ['数字开头', 'x {{1a}} y'],
  ]
  for (const [label, text] of bad) {
    const result = await definition.execute({ action: 'write', text })
    check(`拒绝写入（${label}）`, typeof result === 'string' && /写入被拒绝/.test(result), String(result).slice(0, 60))
  }
  check('被拒时文件未被改动', readFileSync(promptPath, 'utf8') === 'KEEP-THIS')

  const good = ['{{model}} {{cwd}} {{provider}}', '单个 { 花括号', '不闭合的 {{ 也算字面量', '结尾没有换行']
  for (const text of good) {
    const result = await definition.execute({ action: 'write', text })
    check(`接受合法写法（${text.slice(0, 18)}）`, /已写入/.test(result), String(result).slice(0, 60))
  }
}

console.log()
console.log('=== 6. 拒绝空文本 ===')
{
  writeFileSync(promptPath, 'STILL-HERE', 'utf8')
  for (const [label, value] of [
    ['空串', ''],
    ['只有空白', '   \n\t '],
    ['不是字符串', 42],
    ['缺失', undefined],
  ]) {
    const result = await definition.execute({ action: 'write', text: value })
    check(`拒绝写入空内容（${label}）`, /写入被拒绝/.test(result), String(result).slice(0, 60))
  }
  check('文件仍是原内容', readFileSync(promptPath, 'utf8') === 'STILL-HERE')
}

console.log()
console.log('=== 7. 两份 checkPromptText 不许漂移 ===')
{
  /**
   * `editor/index.mjs` guards the settings-page write path; `preset/prompt-tool.mjs`
   * guards this tool's. The duplication is deliberate (neither side should depend on
   * the other's install location) — but a divergence would mean one path accepting a
   * `{{…}}` the renderer throws on, i.e. the mode failing every request. So: extract
   * the preset-side function from source and compare VERDICTS on a shared table.
   */
  const sourceText = readFileSync(source, 'utf8')
  const start = sourceText.indexOf('function checkPromptText(')
  check('能在 prompt-tool.mjs 里找到 checkPromptText', start !== -1)
  let presetVerdict
  if (start !== -1) {
    // 用行首的 `}` 作为结束标记，而不是数花括号：函数体里的字符串常量就含 `{{`
    // 和 `}}`（它就是在检查这些），任何不懂字符串的字面匹配都会被它们骗到。
    const end = sourceText.indexOf('\n}\n', start)
    check('能定位函数结尾', end !== -1)
    const body = sourceText.slice(start, end + 2)
    check('截取到的是完整函数体', body.includes('return { ok: true }') && body.trimEnd().endsWith('}'), body.slice(-40))

    // 函数体还依赖两个模块级常量，抽函数时必须一起带上，否则 ReferenceError。
    const varLine = sourceText.slice(sourceText.indexOf('const VARIABLE_NAME'), sourceText.indexOf('\n', sourceText.indexOf('const VARIABLE_NAME')))
    const kvStart = sourceText.indexOf('const KNOWN_VARIABLES')
    const kvEnd = sourceText.indexOf(']', kvStart) + 1
    const kvLine = sourceText.slice(kvStart, kvEnd)
    check('抽到了 VARIABLE_NAME 常量', /^const VARIABLE_NAME = /.test(varLine), varLine)
    check('抽到了 KNOWN_VARIABLES 常量', kvLine.startsWith('const KNOWN_VARIABLES = ['), kvLine)

    const factory = new Function(`${varLine};\n${kvLine};\n${body};\nreturn checkPromptText`)
    presetVerdict = factory()
    // 语义自检：抽出来的函数必须真的在做事，否则后面的比对毫无意义。
    check('抽出的函数能拒绝未知变量', presetVerdict('{{foo}}').ok === false)
    check('抽出的函数接受已注册变量', presetVerdict('{{model}}').ok === true)
  }

  const editor = await import('../editor/index.mjs')
  const table = [
    'plain text',
    '{{model}}',
    '{{cwd}} {{provider}}',
    '{{foo}}',
    '{{}}',
    '{{ model }}',
    '{{Model}}',
    '{{1a}}',
    '{{_x}}',
    '{{a-b}}',
    'lone {{ brace',
    'unopened }} brace',
    '{{model}} then {{nope}}',
    '{{nope}} then {{model}}',
    '',
    '整段中文，没有变量',
    '{{}}{{}}',
    '{{{model}}}',
  ]
  let mismatches = 0
  for (const text of table) {
    const a = editor.checkPromptText(text)
    const b = presetVerdict === undefined ? undefined : presetVerdict(text)
    const same = a.ok === b?.ok
    if (!same) {
      mismatches += 1
      console.log(`       差异: ${JSON.stringify(text)} → editor=${JSON.stringify(a)} preset=${JSON.stringify(b)}`)
    }
  }
  check(`两份校验对 ${table.length} 个输入判定一致`, mismatches === 0, `${mismatches} 处不同`)
}

rmSync(dir, { recursive: true, force: true })

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
