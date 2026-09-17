/**
 * Locale dictionary tests.
 *
 * Run: node test/locales.test.mjs
 *
 * Why this exists: a key present in one language but missing in the other
 * degrades to rendering the raw key (`row.tool-fs.label`) in that locale — a
 * silent, language-specific bug that only appears when someone switches language.
 * These assertions make that impossible to ship.
 *
 * Section 6 additionally guards the COPY of the dictionaries that lives in
 * `editor/client.js`: the browser half cannot import them, so drift between the
 * two files is a real, silent failure mode.
 */

import { readFileSync } from 'node:fs'
import { zh, en } from '../editor/locales.mjs'
import { ROW_META, BASE_MODES } from '../editor/composition.mjs'

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

const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()

console.log('=== 1. 键集完全一致 ===')
const missingInEn = zhKeys.filter((key) => !(key in en))
const missingInZh = enKeys.filter((key) => !(key in zh))
check('英文不缺键', missingInEn.length === 0, JSON.stringify(missingInEn))
check('中文不缺键', missingInZh.length === 0, JSON.stringify(missingInZh))
check(`键总数一致（${zhKeys.length}）`, zhKeys.length === enKeys.length)

console.log()
console.log('=== 2. 每个基础模式都有标签与说明 ===')
for (const mode of BASE_MODES) {
  check(`base.${mode.id}.label`, typeof zh[`base.${mode.id}.label`] === 'string' && typeof en[`base.${mode.id}.label`] === 'string')
  check(`base.${mode.id}.note`, typeof zh[`base.${mode.id}.note`] === 'string' && typeof en[`base.${mode.id}.note`] === 'string')
}

console.log()
console.log('=== 3. 每个行 id 都有标签 ===')
const rowIds = Object.keys(ROW_META)
for (const id of rowIds) {
  check(
    `row.${id}.label`,
    typeof zh[`row.${id}.label`] === 'string' && typeof en[`row.${id}.label`] === 'string',
    '缺失时该行会显示成裸 id',
  )
}

console.log()
console.log('=== 4. 没有空字符串（空值等于漏翻） ===')
const empties = []
for (const [key, value] of Object.entries(zh)) if (typeof value === 'string' && value.trim() === '') empties.push(`zh:${key}`)
for (const [key, value] of Object.entries(en)) if (typeof value === 'string' && value.trim() === '') empties.push(`en:${key}`)
check('无空值', empties.length === 0, JSON.stringify(empties))

console.log()
console.log('=== 5. 界面关键文案都在两份里 ===')
const required = ['nav', 'mode.heading', 'rows.heading', 'prompt.heading', 'name.heading', 'btn.save', 'status.enabled', 'status.disabled']
for (const key of required) {
  check(key, typeof zh[key] === 'string' && typeof en[key] === 'string')
}

console.log()
console.log('=== 6. client.js 里的手抄字典与 locales.mjs 不漂移 ===')
/**
 * Why this section exists: `editor/locales.mjs` is documented as the single
 * source of truth, but the browser half cannot import it — the client bundle is
 * hand-written and has no bundler — so `client.js` carries a COPY of both
 * dictionaries. Nothing used to compare the copy against the original, which
 * means editing one and forgetting the other would ship silently: the page would
 * keep rendering the old copy while the tests kept passing against the new file.
 *
 * So: extract the literals out of `client.js` as text and diff them.
 */
function extractDictionary(source, variable) {
  const start = source.indexOf(`const ${variable} = {`)
  if (start === -1) throw new Error(`client.js 里找不到 const ${variable} = {`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return new Function(`return (${source.slice(open, i + 1)})`)()
    }
  }
  throw new Error(`client.js 里 ${variable} 的花括号不闭合`)
}

let clientZh
let clientEn
try {
  const clientSource = readFileSync(new URL('../editor/client.js', import.meta.url), 'utf8')
  clientZh = extractDictionary(clientSource, 'ZH')
  clientEn = extractDictionary(clientSource, 'EN')
  check('能从 client.js 解析出 ZH / EN', true)
} catch (error) {
  check('能从 client.js 解析出 ZH / EN', false, String(error.message))
}

if (clientZh !== undefined && clientEn !== undefined) {
  /** Report which keys are missing on either side plus which values differ. */
  const drift = (clientDict, moduleDict, label) => {
    const onlyClient = Object.keys(clientDict).filter((key) => !(key in moduleDict))
    const onlyModule = Object.keys(moduleDict).filter((key) => !(key in clientDict))
    const differing = Object.keys(clientDict).filter(
      (key) => key in moduleDict && clientDict[key] !== moduleDict[key],
    )
    check(
      `${label}: 键集与 locales.mjs 一致`,
      onlyClient.length === 0 && onlyModule.length === 0,
      `client.js 多 ${JSON.stringify(onlyClient)} / locales.mjs 多 ${JSON.stringify(onlyModule)}`,
    )
    check(`${label}: 文案与 locales.mjs 逐条一致`, differing.length === 0, `不同 ${JSON.stringify(differing)}`)
  }
  drift(clientZh, zh, 'ZH')
  drift(clientEn, en, 'EN')
}

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
