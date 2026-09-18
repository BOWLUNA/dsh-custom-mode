/**
 * Composition compiler tests.
 *
 * Run: node test/composition.test.mjs
 *
 * These assert properties, not exact output bytes: the shipped text changes
 * between dsh versions, but "doing nothing changes nothing" must always hold.
 *
 * Set DSH_SHIPPED_PRESETS_DIR when running from a source checkout (the shipped
 * presets are not beside this module there).
 */

import { renderComposition, collectRows, readBaseComposition, BASE_MODES, shippedPresetsDir, modeOf, overridesOf, ROW_META } from '../editor/composition.mjs'

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

/** Pull `id: disabledValue` pairs out of rendered text, at any nesting depth. */
function disabledMap(text) {
  const out = new Map()
  let currentId
  for (const line of text.split('\n')) {
    const idMatch = /^\s*- id: (.+?)\s*$/.exec(line)
    if (idMatch !== null) {
      currentId = idMatch[1]
      continue
    }
    const disabled = /^\s*disabled:\s*(.+?)\s*$/.exec(line)
    if (disabled !== null && currentId !== undefined) out.set(currentId, disabled[1])
  }
  return out
}

console.log(`出厂 preset 目录: ${shippedPresetsDir()}`)
console.log()

console.log('=== 1. 每个基础模式都能渲染 ===')
for (const mode of BASE_MODES) {
  try {
    const text = renderComposition(mode.id, new Map())
    check(`${mode.id} 渲染成功（${text.length} 字节）`, text.length > 100)
  } catch (error) {
    check(`${mode.id} 渲染成功`, false, String(error.message))
  }
}

console.log()
console.log('=== 2. 未改动时：出厂行全部保留，仅 persona 被替换、自有行被追加 ===')
const stripHeader = (text) => {
  const lines = text.split('\n')
  if (!lines[0].startsWith('# 本文件由')) throw new Error('渲染结果缺少生成表头')
  return lines.slice(7).join('\n')
}
for (const mode of BASE_MODES) {
  const base = readBaseComposition(mode.id)
  const body = stripHeader(renderComposition(mode.id, new Map()))
  const baseRows = collectRows(base)
  const bodyRows = collectRows(body)
  const bodyIds = new Set()
  const walk = (list) => {
    for (const row of list) {
      bodyIds.add(row.id)
      walk(row.children)
    }
  }
  walk(bodyRows)
  const baseIds = []
  const walkBase = (list) => {
    for (const row of list) {
      baseIds.push(row.id)
      walkBase(row.children)
    }
  }
  walkBase(baseRows)
  const missing = baseIds.filter((id) => !bodyIds.has(id))
  check(`${mode.id}: 出厂行无丢失`, missing.length === 0, `缺 ${JSON.stringify(missing)}`)
  check(`${mode.id}: persona 换成读文件行`, body.includes("name: './prompt-reader.mjs'"))
  check(`${mode.id}: 不再引用官方 persona`, !body.includes('@deepseek-ai/dsh-persona'))
  check(`${mode.id}: 追加了 custom_prompt 工具行`, bodyIds.has('custom-prompt-tool'))
  check(`${mode.id}: 生成了表头`, body.length > 100)
}

console.log()
console.log('=== 2b. 往返稳定：渲染 → 反推开关 → 再渲染 ===')
for (const mode of BASE_MODES) {
  const first = renderComposition(mode.id, new Map([['persona', false]]))
  const derived = overridesOf(first, modeOf(first))
  check(`${mode.id}: 模式可反推`, modeOf(first) === mode.id)
  check(`${mode.id}: 开关可反推`, derived['persona'] === false, JSON.stringify(derived))
  const second = renderComposition(modeOf(first), derived)
  check(`${mode.id}: 再渲染后行集合一致`, collectRows(second).length === collectRows(first).length)
}

console.log()
console.log('=== 3. 关掉的行带 disabled，其余不带 ===')
{
  const map = disabledMap(renderComposition('standard', ['tool-web', 'tool-fs-search']))
  check('tool-web 已关闭', map.get('tool-web') === 'true', String(map.get('tool-web')))
  check('tool-fs-search 已关闭', map.get('tool-fs-search') === 'true', String(map.get('tool-fs-search')))
  check('tool-fs 未受影响', map.get('tool-fs') === undefined, String(map.get('tool-fs')))
  check('persona 未受影响', map.get('persona') === undefined, String(map.get('persona')))
}

console.log()
console.log('=== 4. 平台表达式行：未触碰保留，显式打开才移除 ===')
{
  const base = readBaseComposition('standard')
  const platformLine = /disabled: !!js process\.platform [^\n]*/.exec(base)
  check('出厂文件里确实有平台表达式', platformLine !== null)

  const untouched = renderComposition('standard', new Map())
  check('未触碰时原样保留', untouched.includes(platformLine[0]))

  const otherRow = renderComposition('standard', ['tool-web'])
  check('关别的行不影响它', otherRow.includes(platformLine[0]))

  const forcedOn = renderComposition('standard', new Map([['tool-bash', true]]))
  // Only tool-bash's own row may lose its condition; the pwsh row must keep its.
  const bashRow = forcedOn.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-bash'))
  const pwshRow = forcedOn.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-pwsh'))
  // 显式打开的行为**取决于该行出厂状态在本机的求值结果**（这正是 1.0.2 修好的语义）：
  //   出厂在本机为开 → 撤销覆盖，恢复出厂平台表达式；
  //   出厂在本机为关 → 真实覆盖，写死 `disabled: false`（恢复表达式反而会违背用户指令）。
  // 断言必须跟着本机平台走：`tool-bash` 的条件是 `process.platform === 'win32'`，
  // Linux/macOS 为开、Windows 为关 —— 按 Linux 硬编码会让整套在 Windows 上假失败。
  const bashShippedOff = collectRows(base).find((row) => row.id === 'tool-bash')?.disabled === true
  check(
    bashShippedOff
      ? '显式打开（本机出厂为关）→ 写死 disabled: false'
      : '显式打开（本机出厂为开）→ 恢复出厂平台表达式',
    bashShippedOff
      ? bashRow !== undefined && /^\s*disabled: false\s*$/m.test(bashRow)
      : bashRow !== undefined && /disabled: !!js process\.platform/.test(bashRow),
  )
  check(
    '写死布尔只在"本机出厂为关"的分支里出现',
    bashShippedOff
      ? bashRow !== undefined && !/disabled: !!js process\.platform/.test(bashRow)
      : bashRow !== undefined && !/^\s*disabled: (true|false)\s*$/m.test(bashRow),
  )
  check('另一平台行不受影响', pwshRow !== undefined && /!!js process\.platform/.test(pwshRow))
}

console.log()
console.log('=== 5. 出厂默认关闭的行，未触碰时必须仍然关闭 ===')
{
  const base = readBaseComposition('standard')
  check('出厂确有默认关闭的行', base.includes('disabled: true'))
  const untouched = renderComposition('standard', new Map())
  const baseTrueCount = (base.match(/disabled: true/g) ?? []).length
  const outTrueCount = (untouched.match(/disabled: true/g) ?? []).length
  check('默认关闭行数量不变', baseTrueCount === outTrueCount, `${baseTrueCount} -> ${outTrueCount}`)
}

console.log()
console.log('=== 6. 分组：关掉分组本身，与关掉组内子行 ===')
{
  const rows = collectRows(readBaseComposition('standard'))
  const group = rows.find((row) => row.id === 'delegation')
  check('delegation 被识别为分组', group?.group === true)
  check('delegation 有子行', (group?.children.length ?? 0) > 0, `${group?.children.length} 个`)

  const offGroup = disabledMap(renderComposition('standard', ['delegation']))
  check('分组可整体关闭', offGroup.get('delegation') === 'true')

  const offChild = disabledMap(renderComposition('standard', new Map([['tool-subagent', false]])))
  check('组内单个子行可关闭', offChild.get('tool-subagent') === 'true', String(offChild.get('tool-subagent')))
  check('同组其它子行未受影响', offChild.get('tool-workflow') === undefined, String(offChild.get('tool-workflow')))
  check('分组本身未被关闭', offChild.get('delegation') === undefined)

  const onChild = disabledMap(renderComposition('standard', new Map([['tool-subagent-codex', true]])))
  // 出厂是字面量 `true`（对所有平台都关）：显式打开就要写死 `false`，否则撤回不了覆盖。
  check('可显式打开出厂关闭的子行（写死 false）', onChild.get('tool-subagent-codex') === 'false')
}

console.log()
console.log('=== 7. 重新生成一定改变内容（mtime/size 检测） ===')
{
  const a = renderComposition('standard', new Map())
  await new Promise((resolve) => setTimeout(resolve, 5))
  const b = renderComposition('standard', new Map())
  check('两次生成内容不同（时间戳）', a !== b)
  check('含生成时间戳注释', b.includes('# 生成时间: '))
}

console.log()
console.log('=== 8. 未知模式应报错 ===')
{
  let threw = false
  try {
    renderComposition('nope', new Map())
  } catch {
    threw = true
  }
  check('未知模式抛错', threw)
}

console.log()
console.log('=== 9. 开关状态可往返（保存后重读一致） ===')
{
  const explicit = new Map([
    ['tool-web', false],
    ['tool-todo', false],
    ['delegation', false],
    ['tool-subagent-codex', true],
  ])
  const text = renderComposition('standard', explicit)
  const flat = []
  const walk = (list) => {
    for (const row of list) {
      flat.push(row)
      walk(row.children)
    }
  }
  walk(collectRows(text))
  const byId = new Map(flat.map((row) => [row.id, row]))
  check('tool-web 关闭已保留', byId.get('tool-web')?.disabled === true)
  check('tool-todo 关闭已保留', byId.get('tool-todo')?.disabled === true)
  check('delegation 关闭已保留', byId.get('delegation')?.disabled === true)
  check('codex 已被显式打开', byId.get('tool-subagent-codex')?.disabled === false)
  check('未触碰的行仍未关闭', byId.get('tool-fs')?.disabled === false)
  check('delegation 子行仍未关闭', byId.get('tool-workflow')?.disabled === false)
}

console.log()
console.log('=== 10. 出厂每一行都有显示标签（升级 DSH 时的漂移警报）===')
{
  // 为什么要有这一条：出厂 preset 会随 DSH 版本新增行（例如 0.1.6-alpha.2 新增了
  // tool-plugin-manager）。编译器是运行时读出厂文件的，所以它会自动带上新行——
  // 但 ROW_META 里没有标签时，界面上会显示成裸 id。
  // 这条断言把「升级后有个新行没人管」从"用户看到怪东西"提前成"CI 变红"。
  // 处理方式就是给 ROW_META 和 locales.mjs 各补一条（两侧键集必须同时加）。
  const unlabeled = []
  for (const mode of BASE_MODES) {
    const walk = (rows) => {
      for (const row of rows) {
        if (ROW_META[row.id] === undefined) unlabeled.push(`${mode.id}:${row.id}`)
        walk(row.children)
      }
    }
    walk(collectRows(readBaseComposition(mode.id)))
  }
  const unique = [...new Set(unlabeled)]
  check(
    '每个出厂行都能查到标签',
    unique.length === 0,
    unique.length === 0 ? '' : `缺标签: ${unique.join(', ')} —— 请补 ROW_META 与 locales.mjs（中英都要）`,
  )
}

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
