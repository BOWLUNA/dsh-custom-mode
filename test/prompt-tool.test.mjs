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
check('参数里 action 是 read|write 枚举', JSON.stringify(definition?.parameters?.properties?.action?.enum) === '["read","write"]')
check('参数里声明了 text', definition?.parameters?.properties?.text?.type === 'string')
check('输出 schema 是 string', definition?.output?.schema?.type === 'string')
check('execute 是函数', typeof definition?.execute === 'function')

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
