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

import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderComposition, collectRows, readBaseComposition, BASE_MODES, BASE_MODE_IDS, UNION_MODE_ID, EXCLUSIVE_ROW_SETS, applyRowExclusivity, exclusiveSetsActive, shippedPresetsDir, modeOf, overridesOf, ROW_META, disableRowsInPlace } from '../composition.mjs'

let passed = 0
let failed = 0
/** 把行树压平（含分组子行）—— 2d 与 2f 都要用，所以放在模块级而不是某个块里。 */
const flatRows = (rows) => rows.flatMap((row) => [row, ...flatRows(row.children ?? [])])
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
console.log('=== 2d. 并集模式（第五个基础模式）：全部出厂行都要能开关 ===')
{
  // 这一节断言的是**属性**，不是某几个行 id：出厂组成会随 dsh 版本变，而"并集就是四个模式的并集"
  // 必须永远成立。写死 tool-cordis 之类的 id，会在上游调整行的那天变成假红。
  const idsOf = (text) => flatRows(collectRows(text)).map((row) => row.id)

  const perMode = BASE_MODE_IDS.map((modeId) => new Set(idsOf(readBaseComposition(modeId))))
  const unionIds = idsOf(readBaseComposition(UNION_MODE_ID))

  const missing = [...new Set(perMode.flatMap((set) => [...set]))].filter((id) => !new Set(unionIds).has(id))
  check('并集覆盖四个出厂模式的每一行', missing.length === 0, `缺 ${JSON.stringify(missing)}`)

  const duplicated = [...new Set(unionIds.filter((id, index) => unionIds.indexOf(id) !== index))]
  check('并集里没有重复行 id', duplicated.length === 0, JSON.stringify(duplicated))

  // 顶层重复是另一件事：`applyLevel` 保证"一个 id 只作用于第一个匹配的行"，但顶层真出现两个同 id
  // 会让其中一行永远拨不动（页面按 id 开关），所以这里单独钉住。
  const topIds = [...readBaseComposition(UNION_MODE_ID).matchAll(/^- id: (.+?)\s*$/gm)].map((match) => match[1])
  check('并集顶层没有重复 id', new Set(topIds).size === topIds.length, JSON.stringify(topIds))

  // 只有别的模式才有的行 —— 也就是旧设计里"拨不到"的那些。集合为空说明上游已把 standard 变成真超集，
  // 功能仍在但收益为零；把条数打在详情里，让它看得见（而不是靠它判断对错）。
  const standardIds = perMode[BASE_MODE_IDS.indexOf('standard')]
  const onlyElsewhere = unionIds.filter((id) => !standardIds.has(id))
  check('并集确实比单独选 standard 多出行来', onlyElsewhere.length > 0, `多出 ${onlyElsewhere.length} 行: ${onlyElsewhere.join(', ')}`)

  // ★ 用户可见的承诺：并集里**每一行**都能拨动、且拨完能被读回来。旧设计的失败形态正是
  //   "行在列表里、却拨不动"—— 合成器只能改写基础文本里已经有的行。
  //
  //   两个方向必须分开：出厂开着的行验"关掉"，出厂关着的行验"打开"。拿"关掉"去验一个出厂就关着的行
  //   是恒真的空操作 —— 状态与出厂相同，本来就该被判成"未触碰"，那样的断言什么都没测。
  const flat = flatRows(collectRows(readBaseComposition(UNION_MODE_ID)))
  const onByDefault = flat.filter((row) => row.disabled !== true).map((row) => row.id)
  // 只取**字面** `disabled: true`：`!!js` 平台条件那类（Linux 上的 pwsh）由第 4 节专门覆盖。
  const offByDefault = flat
    .filter((row) => row.disabled === true && (row.disabledExpression === null || row.disabledExpression === undefined))
    .map((row) => row.id)
  const platformRows = flat
    .filter((row) => row.disabledExpression !== null && row.disabledExpression !== undefined)
    .map((row) => row.id)

  const notSwitchable = onByDefault.filter((id) => overridesOf(renderComposition(UNION_MODE_ID, new Map([[id, false]])), UNION_MODE_ID)[id] !== false)
  check('并集里出厂开着的行都能关掉并读回', notSwitchable.length === 0, `${onByDefault.length} 行候选 → ${JSON.stringify(notSwitchable)}`)

  // README 对用户承诺过 tool-plugin-manager 之类「出厂关闭、在这里拨一下就能打开」，这就是那句话的断言。
  const notOpenable = offByDefault.filter((id) => overridesOf(renderComposition(UNION_MODE_ID, new Map([[id, true]])), UNION_MODE_ID)[id] !== true)
  check('并集里出厂关闭的行都能打开并读回', notOpenable.length === 0, `候选 ${JSON.stringify(offByDefault)} → 打不开的 ${JSON.stringify(notOpenable)}`)

  // 上面两条只证明"被挑中的那些行"没问题。这一条证明**没有行被漏在桶外** ——
  // 38/40 测过而没人发现，正是这类测试最典型的退化方式（上游加一行，安静地没人管）。
  const uncovered = unionIds.filter((id) => !new Set([...onByDefault, ...offByDefault, ...platformRows]).has(id))
  check('并集里每一行都落进验过的三个桶之一', uncovered.length === 0, `漏掉 ${JSON.stringify(uncovered)}`)

  const renderedUnion = renderComposition(UNION_MODE_ID, new Map())
  check('渲染出来的并集回读仍是并集模式', modeOf(renderedUnion) === UNION_MODE_ID, modeOf(renderedUnion))

  // ★★ 互斥：两套壳注册同名工具（bash / pwsh），同时启用会让整个预设被挂载方判 **broken**，
  //    而 broken 的预设被从所有选择器里静默丢掉 —— 设置页却全绿（实测 2026-10-01，0.2.0-rc.2）。
  //    这条断言把"表要维护"变成 CI 上的事实：上游删掉其中一行，这里就红，而不是让表静默失效。
  const allShipped = new Set(BASE_MODE_IDS.flatMap((modeId) => idsOf(readBaseComposition(modeId))))
  const stale = EXCLUSIVE_ROW_SETS.flatMap((set) => set.sides.flatMap((side) => side.rows)).filter((id) => allShipped.has(id) === false)
  check('互斥表里的行 id 都真的存在于出厂组成里', stale.length === 0, `出厂里没有：${JSON.stringify(stale)}`)

  // ★★ 而且并集的**默认组成必须是合法的**：每一组互斥里默认只能有一侧是启用的。
  //    不能指望"取原模式的出厂默认"—— persistent-shell 在极简模式里出厂就是启用的，
  //    照搬出厂状态合出来的并集实测是 broken（`overrides` 为空时也 broken）。
  //
  //    写成"**恰好一侧**"而不是"该关的都关了"：后者是空洞断言 —— 把 `unionDefaultOff` 清空
  //    它照样绿（实测 M7 变异：清空后全绿）。"恰好一侧"对上游换哪一侧都不敏感，但两侧同时启用
  //    一定变红，这正是要防的那件事。
  const unionRows = new Map(flatRows(collectRows(readBaseComposition(UNION_MODE_ID))).map((row) => [row.id, row]))
  const bothOn = EXCLUSIVE_ROW_SETS.filter((set) =>
    set.sides.filter((side) => side.rows.some((id) => unionRows.get(id)?.disabled !== true)).length > 1,
  ).map((set) => `${set.id}(${set.sides.map((side) => side.label).join(' + ')})`)
  check('并集默认在每一组互斥里只留一侧启用', bothOn.length === 0, `默认同时启用了：${JSON.stringify(bothOn)}`)
}

console.log()
console.log('=== 2f. 自动互斥（applyRowExclusivity）：两套壳不能同时启用 ===')
{
  // 为什么要自动：两套壳注册同名工具 ⇒ 同时启用时平台把整个预设判 broken ⇒ **从所有选择器里静默
  // 丢掉**，而设置页全绿。开关自己动一下用户能接受，模式凭空消失不能（实测依据见 EXCLUSIVE_ROW_SETS）。
  const enabledOf = (text, id) => {
    const row = flatRows(collectRows(text)).find((each) => each.id === id)
    return row === undefined ? undefined : row.disabled !== true
  }
  const base = readBaseComposition(UNION_MODE_ID)
  check('并集默认标准壳开着', enabledOf(base, 'tool-bash') === true, String(enabledOf(base, 'tool-bash')))
  check('并集默认持久终端壳关着', enabledOf(base, 'persistent-shell') === false, String(enabledOf(base, 'persistent-shell')))

  // 用户打开持久终端壳 ⇒ 标准壳让开，且如实报出被关掉的行
  //
  // ⚠️ 断言只点名 `tool-bash`，**不点名 `tool-pwsh`**：后者出厂带 `disabled: !!js process.platform
  // === 'win32'`，在 Linux 上本来就关着，所以没有"要关的东西"。写死它会让这个用例变成**平台相关**的
  // 假红（第一次就是这么红的）。下面用"只动本来就启用着的行"这条不变量把它盖住。
  const flipped = applyRowExclusivity(UNION_MODE_ID, new Map([['persistent-shell', true]]))
  check('自动让开标准壳', flipped.overrides.get('tool-bash') === false, JSON.stringify([...flipped.overrides]))
  check('如实报出被关掉的行', flipped.moved.includes('tool-bash'), JSON.stringify(flipped.moved))
  check('没有连用户要的那一侧一起关掉', flipped.overrides.get('persistent-shell') === true, String(flipped.overrides.get('persistent-shell')))
  // ★ 只动**当前确实启用着**的行：给本来就关着的行写一遍 `false`，会在 `overridesOf` 里变成一条
  //   用户从未做过的"改动"——历史、往返、以及"未保存"标记都会因此说谎。
  const enabledBefore = new Set(
    flatRows(collectRows(readBaseComposition(UNION_MODE_ID))).filter((row) => row.disabled !== true).map((row) => row.id),
  )
  check('只动本来就启用着的行', flipped.moved.length > 0 && flipped.moved.every((id) => enabledBefore.has(id)), JSON.stringify(flipped.moved))

  // 只开一侧时**不碰任何东西** —— 否则每次保存都写出一堆用户没做过的"改动"，往返和历史都会说谎。
  const quiet = applyRowExclusivity(UNION_MODE_ID, new Map())
  check('只有一个壳时不动任何开关', quiet.moved.length === 0 && quiet.overrides.size === 0, JSON.stringify([...quiet.overrides]))

  // 两边都在同一次请求里显式打开 ⇒ 退回避让 unionDefaultOff 的那一侧
  const bothOn = applyRowExclusivity(UNION_MODE_ID, new Map([['persistent-shell', true], ['tool-bash', true], ['tool-pwsh', true]]))
  check('两边都要时保留出厂偏好的一侧', bothOn.overrides.get('persistent-shell') === false && bothOn.overrides.get('tool-bash') === true, JSON.stringify([...bothOn.overrides]))

  // 磁盘上已经存在的互斥组合（手工编辑 / 别的工具写的）必须查得出来 —— 页面据此点名
  const illegalText = renderComposition(UNION_MODE_ID, new Map([['persistent-shell', true], ['tool-bash', true], ['tool-pwsh', true]]))
  check('exclusiveSetsActive() 认得出磁盘上的互斥组合', exclusiveSetsActive(illegalText).length > 0, JSON.stringify(exclusiveSetsActive(illegalText)))
  check('exclusiveSetsActive() 不误报合法组成', exclusiveSetsActive(renderComposition(UNION_MODE_ID, new Map())).length === 0, JSON.stringify(exclusiveSetsActive(renderComposition(UNION_MODE_ID, new Map()))))
  check('exclusiveSetsActive() 认得出并集出厂默认（合法）', exclusiveSetsActive(readBaseComposition(UNION_MODE_ID)).length === 0, JSON.stringify(exclusiveSetsActive(readBaseComposition(UNION_MODE_ID))))
}

console.log()
console.log('=== 2e. 并集有一个源读不到时必须类型化失败，不许静默少行 ===')
{
  // 「四个源里少了一个」是最危险的失败形态：并集照样渲染、照样看起来完整，只是少了那位模式独有的行
  // —— 页面却仍然告诉用户"全部行都能开关"。所以它必须是类型化失败，走已有的降级路径。
  // 这两个环境变量是**排他**的，在本进程里改会污染同一套件后面所有用例，因此放子进程里孤立地验。
  const solo = mkdtempSync(join(tmpdir(), 'dsh-custom-union-solo-'))
  mkdirSync(join(solo, 'standard'), { recursive: true })
  writeFileSync(
    join(solo, 'standard', 'agent.cordis.yml'),
    readFileSync(join(shippedPresetsDir(), 'standard', 'agent.cordis.yml'), 'utf8'),
    'utf8',
  )
  const emptyPatch = mkdtempSync(join(tmpdir(), 'dsh-custom-union-nopatch-'))
  const verdictPath = join(solo, 'verdict.txt')
  const moduleUrl = new URL('../composition.mjs', import.meta.url).href
  const script = [
    `import { writeFileSync } from 'node:fs'`,
    `const { readBaseComposition, UNION_MODE_ID, isBaseCompositionUnavailable } = await import(${JSON.stringify(moduleUrl)})`,
    `const lines = []`,
    `const say = (label, fn) => { try { fn(); lines.push(label + '=ok') } catch (error) { lines.push(label + '=' + (isBaseCompositionUnavailable(error) ? 'typed' : 'raw:' + String(error && error.message))) } }`,
    `say('standard', () => readBaseComposition('standard'))`,
    `say('union', () => readBaseComposition(UNION_MODE_ID))`,
    // ★ 判决写**文件**，不走 stdout：写管道是异步的，子进程随即退出会把没刷出去的行丢掉。
    //   初版就是靠 stdout 的，实测每次只拿到第一行 —— 断言看似还对，但那是碰巧（它们都只看
    //   "某个串在不在"），换一条断言就会变成假绿。写文件是同步的，退出前一定落盘。
    `writeFileSync(${JSON.stringify(verdictPath)}, lines.join('\\n') + '\\n', 'utf8')`,
  ].join('\n')
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, DSH_SHIPPED_PRESETS_DIR: solo, DSH_PRESET_PATCH_DIR: emptyPatch },
    encoding: 'utf8',
  })
  const verdict = existsSync(verdictPath) ? readFileSync(verdictPath, 'utf8').trim() : ''
  check(
    '夹具就位：同一个残缺目录里 standard 仍读得到',
    verdict.includes('standard=ok'),
    `判决=${JSON.stringify(verdict)} stderr=${String(probe.stderr ?? '').trim().slice(0, 200)}`,
  )
  check('并集在残缺目录里是类型化失败（不是静默少行）', verdict.includes('union=typed'), `判决=${JSON.stringify(verdict)}`)
}

console.log()
console.log('=== 末. 「按本线修复」是就地手术：persona 段必须逐字节保留 ===')
{
  // 外部评审实测：disableRowsInPlace 曾经无条件重写 persona 段 → 丢注释 / 多复制一行身份注释。
  const original = readFileSync(join(shippedPresetsDir(), 'standard', 'agent.cordis.yml'), 'utf8')
  const withNote = original.replace(/(- id: persona\n)/, '$1      # hand-written note\n')
  check('夹具：persona 段里有一行注释', withNote.includes('# hand-written note'))
  const ids = [...withNote.matchAll(/^- id: ([\w-]+)/gm)].map((mm) => mm[1])
  const victim = ids.find((id) => id !== 'persona') ?? ids[0]
  const after = disableRowsInPlace(withNote, [victim])
  const segment = (text) => {
    const i = text.indexOf('- id: persona')
    const j = text.indexOf('- id: ', i + 10)
    return j === -1 ? text.slice(i) : text.slice(i, j)
  }
  check('persona 段逐字节不变（注释还在）', segment(after) === segment(withNote),
    JSON.stringify(segment(after).slice(0, 90)))
  // 行的 `disabled` 不一定紧跟在 id 后面（name/config 可能在前），所以按"这一行自己的块"判定。
  const rowBlock = (text, id) => {
    const i = text.indexOf('- id: ' + id)
    const j = text.indexOf('- id: ', i + 6)
    return j === -1 ? text.slice(i) : text.slice(i, j)
  }
  check(`目标行 ${victim} 被关掉`, /disabled: true/.test(rowBlock(after, victim)),
    JSON.stringify(rowBlock(after, victim).slice(0, 90)))
  check('没有别的行被顺手关掉', (after.match(/disabled: true/g) ?? []).length === (withNote.match(/disabled: true/g) ?? []).length + 1)
}

console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)


