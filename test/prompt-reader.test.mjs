/**
 * The hot-reload contract of the preset's persona row.
 *
 * Run: node test/prompt-reader.test.mjs
 *
 * Why this exists: the entire feature rests on one claim — "edit prompt.md, and the
 * NEXT model step uses the new text". Everything else (the settings page, the
 * custom_prompt tool) is only a way to write that file. But the claim was only ever
 * checked by hand, in a live session; a regression in the reader would be invisible
 * until someone noticed their prompt edits silently not landing.
 *
 * So assert the mechanism directly: drive `prompt-reader.mjs` exactly the way the
 * prompt registry does — call the section's `text` provider — and check that it
 * re-reads the file when it changes, serves the last good text on a read error, and
 * registers the suffix only when it should.
 *
 * No dsh process and no model call is involved: the provider IS the contract.
 */

import { mkdtempSync, writeFileSync, rmSync, renameSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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

/**
 * A stand-in for the real Cordis context: just enough surface for the module's
 * `ctx.effect` / `ctx.systemPrompt.section` calls.
 */
function makeCtx() {
  const sections = []
  const effects = []
  return {
    sections,
    effects,
    effect(fn, label) {
      effects.push(label)
      return fn()
    },
    systemPrompt: {
      section(options) {
        sections.push(options)
        return () => {}
      },
    },
  }
}

/** Import the reader fresh (it caches per module instance, so each case needs its own). */
async function loadReader(tag) {
  const source = new URL('../preset/prompt-reader.mjs', import.meta.url)
  return import(`${source.href}?case=${tag}`)
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-custom-prompt-'))
const promptPath = join(dir, 'prompt.md')

console.log()
console.log('=== 1. 基本形状：注册前身段，文本来自文件 ===')
{
  writeFileSync(promptPath, 'VERSION-ONE', 'utf8')
  const reader = await loadReader('basic')
  const ctx = makeCtx()
  reader.apply(ctx, { path: promptPath })

  const prefix = ctx.sections.find((section) => section.name === 'deployment:persona-prefix')
  const suffix = ctx.sections.find((section) => section.name === 'deployment:persona-suffix')
  check('注册了 deployment:persona-prefix', prefix !== undefined)
  check('注册了 deployment:persona-suffix', suffix !== undefined)
  check('prefix 的 text 是函数（每步重新求值）', typeof prefix?.text === 'function')
  check('prefix 读到了文件内容', prefix?.text() === 'VERSION-ONE', String(prefix?.text()))
}

console.log()
console.log('=== 2. 核心契约：改文件后，下一次求值就是新文本 ===')
{
  writeFileSync(promptPath, 'VERSION-ONE', 'utf8')
  const reader = await loadReader('hot')
  const ctx = makeCtx()
  reader.apply(ctx, { path: promptPath })
  const prefix = ctx.sections.find((section) => section.name === 'deployment:persona-prefix')

  const first = prefix.text()
  // 时间戳必须真的变：文件系统的 mtime 精度有限，写入太快会被缓存判定为「没变」。
  // 这里直接写不同长度的内容来同时改变 size，跟真实编辑的情况一致。
  writeFileSync(promptPath, 'VERSION-TWO-IS-LONGER', 'utf8')
  const second = prefix.text()

  check('第一次求值读到旧文本', first === 'VERSION-ONE', first)
  check('改文件后下一次求值读到新文本（无需重启）', second === 'VERSION-TWO-IS-LONGER', second)
}

console.log()
console.log('=== 3. 稳态不重读：同一份文件连续求值返回同一文本 ===')
{
  writeFileSync(promptPath, 'STABLE', 'utf8')
  const reader = await loadReader('stable')
  const ctx = makeCtx()
  reader.apply(ctx, { path: promptPath })
  const prefix = ctx.sections.find((section) => section.name === 'deployment:persona-prefix')
  const a = prefix.text()
  // 把文件删掉：如果实现是「每次都读文件」，这里就会退化成 fallback；
  // 只有「mtime/size 未变则复用缓存」的实现才会继续给出 STABLE。
  renameSync(promptPath, join(dir, 'prompt.hidden.md'))
  const b = prefix.text()
  check('未变化时不重新读盘（删除后仍给出缓存文本）', a === 'STABLE' && b === 'STABLE', `${a} / ${b}`)
  renameSync(join(dir, 'prompt.hidden.md'), promptPath)
}

console.log()
console.log('=== 4. 文件缺失：给 fallback，而不是把提示词变成空串 ===')
{
  const reader = await loadReader('missing')
  const ctx = makeCtx()
  reader.apply(ctx, { path: join(dir, 'nope.md') })
  const prefix = ctx.sections.find((section) => section.name === 'deployment:persona-prefix')
  const text = prefix.text()
  check('缺文件时不返回空串', typeof text === 'string' && text.trim() !== '', JSON.stringify(text))
  check('缺文件时给出可读的 fallback（含引导语）', text.includes('No custom system prompt') || text.includes('系统提示词'), text.slice(0, 60))
}

console.log()
console.log('=== 5. 文件被清空：保留上一版，不要让身份消失 ===')
{
  writeFileSync(promptPath, 'KEEP-ME', 'utf8')
  const reader = await loadReader('emptied')
  const ctx = makeCtx()
  reader.apply(ctx, { path: promptPath })
  const prefix = ctx.sections.find((section) => section.name === 'deployment:persona-prefix')
  const before = prefix.text()
  writeFileSync(promptPath, '   \n\n  ', 'utf8')
  const after = prefix.text()
  check('先读到内容', before === 'KEEP-ME', before)
  check('被清空后仍给出上一版内容', after === 'KEEP-ME', JSON.stringify(after))
}

console.log()
console.log('=== 6. complete: true 时不再注册 suffix ===')
{
  writeFileSync(promptPath, 'X', 'utf8')
  const reader = await loadReader('complete')
  const ctx = makeCtx()
  reader.apply(ctx, { path: promptPath, complete: true })
  const prefix = ctx.sections.find((section) => section.name === 'deployment:persona-prefix')
  const suffix = ctx.sections.find((section) => section.name === 'deployment:persona-suffix')
  check('prefix 仍然注册', prefix !== undefined)
  check('prefix 带 complete: true', prefix?.complete === true)
  check('suffix 不再注册', suffix === undefined)
}

console.log()
console.log('=== 7. 默认路径就是模块旁边的 prompt.md ===')
{
  const reader = await loadReader('default-path')
  const ctx = makeCtx()
  reader.apply(ctx, {})
  const prefix = ctx.sections.find((section) => section.name === 'deployment:persona-prefix')
  const text = prefix.text()
  // 仓库里 preset/prompt.md 的正文以这句开头。
  check(
    '默认读取 preset/prompt.md',
    typeof text === 'string' && text.includes('You are a coding agent powered by'),
    String(text).slice(0, 60),
  )
}

rmSync(dir, { recursive: true, force: true })

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
