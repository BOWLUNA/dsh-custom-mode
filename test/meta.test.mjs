/**
 * preset.yml round-trip tests.
 *
 * Run: node test/meta.test.mjs
 *
 * Why this exists: the README has claimed 「YAML 安全：值一律双引号包裹 + 反斜杠转义，
 * 换行压平。preset.yml 写坏会让模式**从选择器里消失**，所以这里必须转义，**且有往返测试**」
 * — and no test touched `meta.mjs` at all. The failure mode it describes is silent and
 * total (the mode disappears from every picker), so the claim needs to be real.
 *
 * The path is redirected through `DSH_CUSTOM_PROMPT_PATH` BEFORE importing the module,
 * because `meta.mjs` derives `preset.yml`'s location from the prompt path at import
 * time. That keeps the test off the repo's own `preset/preset.yml`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const dir = mkdtempSync(join(tmpdir(), 'dsh-custom-meta-'))
process.env.DSH_CUSTOM_PROMPT_PATH = join(dir, 'custom', 'prompt.md')
// 生产里 preset 目录一定是存在的（install.sh 建的，设置页也只在已安装的 preset 上工作），
// 所以这里复现同样的前提，而不是让 writePresetMeta 去猜目录。
mkdirSync(join(dir, 'custom'), { recursive: true })

const { writePresetMeta, readPresetMeta, PRESET_META_PATH } = await import('../editor/meta.mjs')

console.log()
console.log('=== 0. 路径确实被重定向到临时目录（否则会写进仓库） ===')
check('PRESET_META_PATH 落在临时目录内', PRESET_META_PATH.startsWith(dir), PRESET_META_PATH)
check('临时文件一开始不存在', (() => {
  try {
    readFileSync(PRESET_META_PATH, 'utf8')
    return false
  } catch {
    return true
  }
})())

console.log()
console.log('=== 1. 往返：写进去什么，读出来就是什么 ===')
/** Write, read back, and compare — the property the README promises. */
const roundTrip = (label, name, description) => {
  const written = writePresetMeta(name, description)
  if (written.ok !== true) {
    check(label, false, '写入被拒: ' + written.error)
    return
  }
  const back = readPresetMeta()
  check(`${label}: name 往返一致`, back.name === name, JSON.stringify(back.name))
  if (description === undefined || description.trim() === '') {
    check(`${label}: 无描述时不写 description`, back.description === '', JSON.stringify(back.description))
  } else {
    check(`${label}: description 往返一致`, back.description === description, JSON.stringify(back.description))
  }
}

roundTrip('纯 ASCII', 'Custom Mode', 'A mode built for testing')
roundTrip('中文', '我的模式', '中文描述，带逗号')
roundTrip('冒号与井号', 'a: b # c', 'x: y # z')
roundTrip('前导短横与问号', '- dash', '? question')
roundTrip('引号', 'he said "hi"', 'quote " inside')
roundTrip('反斜杠', 'back\\slash', 'trail\\')
roundTrip('结尾一个反斜杠', 'ends\\', undefined)
roundTrip('花括号（提示词变量那种）', '{{model}} mode', undefined)
roundTrip('emoji', '模式 🚀 测试', 'ok ✅')
roundTrip('YAML 特殊字面量', 'true', 'null')
roundTrip('看起来像引号包裹', '"quoted"', undefined)

console.log()
console.log('=== 2. 换行被压平（YAML 里没有裸换行，否则文档会被重构） ===')
{
  const result = writePresetMeta('line1\nline2', 'desc1\ndesc2')
  check('含换行的名字写入成功', result.ok === true, JSON.stringify(result))
  const text = readFileSync(PRESET_META_PATH, 'utf8')
  check('文件恰好两行（name + description），换行被压平成空格', text.split('\n').filter((line) => line !== '').length === 2, JSON.stringify(text))
  // 注意：这里要断言的是「**值内部**没有裸换行」，而不是「文件里没有换行」——
  // name 与 description 之间本来就该有一个换行。
  const nameLine = text.split('\n')[0]
  check('name 行是压平后的完整标量', nameLine === 'name: "line1 line2"', JSON.stringify(nameLine))
  const back = readPresetMeta()
  check('压平后往返为空格分隔', back.name === 'line1 line2', JSON.stringify(back.name))
  check('description 同样压平', back.description === 'desc1 desc2', JSON.stringify(back.description))
}

console.log()
console.log('=== 3. 结构：name 必须第一行，且值是被引号包裹的单行标量 ===')
{
  writePresetMeta('结构测试', '描述')
  const lines = readFileSync(PRESET_META_PATH, 'utf8').split('\n')
  check('第一行是 name:', lines[0].startsWith('name: "'), lines[0])
  check('第二行是 description:', lines[1].startsWith('description: "'), lines[1])
  check('值以双引号收尾', lines[0].endsWith('"') && lines[1].endsWith('"'))
  check('文件以换行结尾', readFileSync(PRESET_META_PATH, 'utf8').endsWith('\n'))
}

console.log()
console.log('=== 4. 只写 name 时没有 description 行 ===')
{
  writePresetMeta('只有名字', undefined)
  const text = readFileSync(PRESET_META_PATH, 'utf8')
  check('没有 description 键', !text.includes('description:'), JSON.stringify(text))
  check('读回的描述为空串', readPresetMeta().description === '')
}

console.log()
console.log('=== 5. 拒绝空名字（会让模式在界面上显示成裸目录 id） ===')
{
  writePresetMeta('保留值', 'k')
  const before = readFileSync(PRESET_META_PATH, 'utf8')
  for (const [label, value] of [
    ['空串', ''],
    ['只有空格', '   '],
    ['只有换行', '\n'],
    ['非字符串', 123],
  ]) {
    const result = writePresetMeta(value, 'x')
    check(`拒绝空名字（${label}）`, result.ok === false, JSON.stringify(result))
  }
  check('被拒时没有改动文件', readFileSync(PRESET_META_PATH, 'utf8') === before)
}

console.log()
console.log('=== 6. 文件缺失或不完整时的读取行为（不能崩） ===')
{
  rmSync(PRESET_META_PATH, { force: true })
  const missing = readPresetMeta()
  check('缺文件 → 两个空串', missing.name === '' && missing.description === '', JSON.stringify(missing))

  writeFileSync(PRESET_META_PATH, 'name: 裸标量\n', 'utf8')
  check('无引号的裸标量也能读', readPresetMeta().name === '裸标量', JSON.stringify(readPresetMeta()))

  writeFileSync(PRESET_META_PATH, 'description: "只有描述"\n', 'utf8')
  check('只有 description 时 name 为空串', readPresetMeta().name === '')

  writeFileSync(PRESET_META_PATH, 'name: "单引号"\n', 'utf8')
  check('双引号值', readPresetMeta().name === '单引号')

  writeFileSync(PRESET_META_PATH, "name: 'single'\n", 'utf8')
  check('单引号值也能读', readPresetMeta().name === 'single', JSON.stringify(readPresetMeta()))
}

rmSync(dir, { recursive: true, force: true })

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
