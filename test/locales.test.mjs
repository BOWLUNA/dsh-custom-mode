/**
 * Locale dictionary tests.
 *
 * Run: node test/locales.test.mjs
 *
 * Why this exists: a key present in one language but missing in the other
 * degrades to rendering the raw key (`row.tool-fs.label`) in that locale — a
 * silent, language-specific bug that only appears when someone switches language.
 * These assertions make that impossible to ship.
 */

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
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
