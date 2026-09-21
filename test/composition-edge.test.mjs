/**
 * Composition compiler edge cases, on synthetic input.
 *
 * Run: node test/composition-edge.test.mjs
 *
 * `composition.test.mjs` asserts behaviour against the REAL shipped presets — that is what keeps it
 * honest about the thing it optimises for. This file is the complement: inputs a shipped file does
 * not happen to contain today, but that a hand-edited or future file might.
 *
 * The compiler's failures are silent (a platform condition lost, a group switch landing on a child,
 * a comment glued to a key), so unexpected input is exactly where the damage would go unnoticed.
 *
 * Self-contained: the shipped-preset directory is a fixture built here, so this needs no dsh.
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

const dir = mkdtempSync(join(tmpdir(), 'dsh-custom-edge-'))
const shippedDir = join(dir, 'presets')
// 四个模式都要存在：BASE_MODES 是固定的四个，渲染时会去读对应的文件。
const PLACEHOLDER = '- id: persona\n  name: ./x.mjs\n'
for (const mode of ['standard', 'ptc', 'minimal', 'cordis']) {
  mkdirSync(join(shippedDir, mode), { recursive: true })
  writeFileSync(join(shippedDir, mode, 'agent.cordis.yml'), PLACEHOLDER, 'utf8')
}
process.env.DSH_SHIPPED_PRESETS_DIR = shippedDir

const { renderComposition, collectRows, modeOf, overridesOf } = await import('../editor/composition.mjs')

/** 把某个模式的基础文件换成给定内容，再渲染它。 */
function renderWith(text, overrides = new Map()) {
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), text, 'utf8')
  return renderComposition('standard', overrides)
}

/** 渲染结果去掉生成表头（前 7 行 + 一个空行）。 */
function body(text) {
  return text.split('\n').slice(8).join('\n')
}

console.log()
console.log('=== 1. CRLF 换行（用户在 Windows 上手工编辑过） ===')
{
  const crlf = [
    '# crlf base',
    '',
    '- id: persona',
    '  name: ./x.mjs',
    '',
    '- id: tool-bash',
    '  name: ./bash.mjs',
    "  disabled: !!js process.platform === 'win32'",
    '',
    '- id: tool-web',
    '  name: ./web.mjs',
    '',
  ].join('\r\n')
  const out = renderComposition('standard', new Map([['tool-web', false]]))
  // 先写 CRLF 再渲染
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), crlf, 'utf8')
  const rendered = renderComposition('standard', new Map([['tool-web', false]]))
  const ids = collectRows(rendered).map((row) => row.id)
  check('CRLF 输入下仍能识别出行', ids.includes('tool-bash') && ids.includes('tool-web'), JSON.stringify(ids))
  check('CRLF 输入下未触碰的行仍带平台条件', rendered.includes("disabled: !!js process.platform === 'win32'"))
  const webChunk = rendered.split(/- id: /).find((chunk) => chunk.startsWith('tool-web'))
  check('CRLF 输入下显式关闭写成 disabled: true', webChunk !== undefined && /disabled: true/.test(webChunk))
  // 这不是"没清干净"，而是与"未触碰的行逐字节保留"同一件事：编译器只替换 disabled 行，
  // 不会顺手把用户的 CRLF 规范化掉。生成表头与本插件追加的行是 LF。
  // 值得知道的事实：**输出不保证全是 LF**，输入是 CRLF 时输出是混合行尾。
  check('未触碰的行连 \\r 一起保留（与"逐字节不变"一致）', rendered.includes('!!js process.platform === \'win32\'\r'))
  check('生成表头仍是 LF', rendered.startsWith('# 本文件由') && !rendered.slice(0, 200).includes('\r'))
  void out
}

console.log()
console.log('=== 2. 末行没有换行符 ===')
{
  const text = '- id: persona\n  name: ./x.mjs\n\n- id: tool-web\n  name: ./web.mjs'
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), text, 'utf8')
  const rendered = renderComposition('standard', new Map([['tool-web', false]]))
  const ids = collectRows(rendered).map((row) => row.id)
  check('无末尾换行时行仍齐全', ids.includes('persona') && ids.includes('tool-web'), JSON.stringify(ids))
  const webChunk = rendered.split(/- id: /).find((chunk) => chunk.startsWith('tool-web'))
  check('无末尾换行时仍能改写该行', webChunk !== undefined && /disabled: true/.test(webChunk))
}

console.log()
console.log('=== 3. 没有行 / 只有前导注释 ===')
{
  const onlyPreamble = '# 只有注释，没有任何 - id:\n# 第二行注释\n'
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), onlyPreamble, 'utf8')
  const rendered = renderComposition('standard', new Map())
  check('只有前导注释时不抛错', typeof rendered === 'string')
  check('仍然带上生成表头', rendered.startsWith('# 本文件由'))
  check('仍然追加本插件自己的行', collectRows(rendered).some((row) => row.id === 'custom-prompt-tool'))
  check('前导注释被保留', rendered.includes('第二行注释'))
}

console.log()
console.log('=== 4. 行缺 name / 缺可插入位置 ===')
{
  const noName = '- id: persona\n  # 这一行没有 name:\n  config:\n    a: 1\n'
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), noName, 'utf8')
  const off = renderComposition('standard', new Map([['persona', false]]))
  // persona 会被本插件替换，所以换一个普通行来试
  const text = '# base\n\n- id: weird\n  config:\n    a: 1\n'
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), text, 'utf8')
  const rendered = renderComposition('standard', new Map([['weird', false]]))
  check('行没有 name: 时不会被改坏（保持原样）', rendered.includes('    a: 1'))
  check('行没有 name: 时不会凭空插入 disabled', !rendered.includes('disabled: true'))
  void off
}

console.log()
console.log('=== 5. 分组的缩进必须精确：改分组不能动到子行 ===')
{
  const text = [
    '# base',
    '',
    '- id: delegation',
    '  name: ./delegation.mjs',
    '  group: true',
    '  config:',
    '    label: 委派',
    '  children:',
    '    - id: child-a',
    '      name: ./a.mjs',
    '      disabled: true',
    '    - id: child-b',
    '      name: ./b.mjs',
    '',
  ].join('\n')
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), text, 'utf8')

  const offGroup = renderComposition('standard', new Map([['delegation', false]]))
  const groupChunk = offGroup.split(/^- id: /m).find((chunk) => chunk.startsWith('delegation'))
  check('关闭分组写在分组自己的缩进上', groupChunk !== undefined && /^  disabled: true$/m.test(groupChunk), groupChunk?.slice(0, 120))
  check('子行原有的 disabled: true 未被破坏', offGroup.includes('      disabled: true'))

  const offChild = renderComposition('standard', new Map([['child-a', true]]))
  check('显式打开子行 → 写死 disabled: false（不是删掉那一行）', /^ {6}disabled: false$/m.test(offChild))
  const parentChunk = offChild.split(/^- id: /m).find((chunk) => chunk.startsWith('delegation'))
  check('子行的开关不会写到分组上', parentChunk !== undefined && !/^ {2}disabled:/m.test(parentChunk))
}

console.log()
console.log('=== 6. 比子行更深/更浅的缩进都不算行 ===')
{
  const text = [
    '# base',
    '',
    '- id: top',
    '  name: ./top.mjs',
    '',
    '  # 更深缩进的 - id: 属于注释或嵌套数据，不是本层的行',
    '        - id: too-deep',
    '          name: ./deep.mjs',
    '',
  ].join('\n')
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), text, 'utf8')
  const rows = collectRows(renderComposition('standard', new Map()))
  const ids = rows.map((row) => row.id)
  check('只认出顶层行（不含 8 空格缩进的那条）', ids.includes('top') && !ids.includes('too-deep'), JSON.stringify(ids))
}

console.log()
console.log('=== 7. 带引号的 id 与重复 id ===')
{
  const text = ["# base", '', '- id: "quoted-id"', '  name: ./q.mjs', '', '- id: dup', '  name: ./d1.mjs', '', '- id: dup', '  name: ./d2.mjs', ''].join('\n')
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), text, 'utf8')
  const rows = collectRows(renderComposition('standard', new Map()))
  const ids = rows.map((row) => row.id)
  check('带引号的 id 被去掉引号', ids.includes('quoted-id'), JSON.stringify(ids))
  check('重复 id 不抛错（两条都在）', ids.filter((id) => id === 'dup').length === 2, JSON.stringify(ids))
}

console.log()
console.log('=== 8. 往返：反推的开关再渲染，行集合一致 ===')
{
  const text = [
    '# base',
    '',
    '- id: persona',
    '  name: ./x.mjs',
    '',
    '- id: tool-bash',
    '  name: ./bash.mjs',
    "  disabled: !!js process.platform === 'win32'",
    '',
    '- id: tool-web',
    '  name: ./web.mjs',
    '',
  ].join('\n')
  writeFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), text, 'utf8')
  const first = renderComposition('standard', new Map([['tool-web', false], ['tool-bash', true]]))
  const derived = overridesOf(first, modeOf(first))
  check('模式可反推', modeOf(first) === 'standard')
  check('显式关闭的行被反推出来', derived['tool-web'] === false, JSON.stringify(derived))
  // tool-bash 在基线上是 `!!js process.platform === 'win32'`。在 Linux 上它本来就求值为
  // "已启用"，所以"显式打开"是一个**无操作**，反推时不该被记成 override —— 这正是三态语义：
  // 只有与基线不同的状态才需要记录。（在 Windows 上这条会是 true。）
  const bashBase = collectRows(readFileSync(join(shippedDir, 'standard', 'agent.cordis.yml'), 'utf8')).find((row) => row.id === 'tool-bash')
  const expected = bashBase?.disabled === true // 基线在本平台上是否停用
  check(
    `显式打开是否为无操作取决于基线在本平台的状态（此处基线 disabled=${String(bashBase?.disabled)}）`,
    expected ? derived['tool-bash'] === true : derived['tool-bash'] === undefined,
    JSON.stringify(derived),
  )
  // 与上一条同源：本机出厂为开 → 恢复出厂表达式；本机出厂为关 → 写死 false。
  check(
    expected
      ? '显式打开（本机出厂为关）→ 磁盘上写死 disabled: false'
      : '显式打开（本机出厂为开）→ 磁盘形态回到出厂表达式，与"未触碰"一致',
    expected
      ? /^\s*disabled: false\s*$/m.test(first.split(/^- id: /m).find((c) => c.startsWith('tool-bash')) ?? '')
      : /disabled: !!js process\.platform/.test(first.split(/^- id: /m).find((c) => c.startsWith('tool-bash')) ?? ''),
  )
  const second = renderComposition(modeOf(first), derived)
  check('再渲染行集合一致', collectRows(second).length === collectRows(first).length)
  const bashChunk = second.split(/^- id: /m).find((chunk) => chunk.startsWith('tool-bash'))
  check(
    expected ? '再渲染仍写死 false' : '再渲染仍保持出厂表达式',
    expected
      ? bashChunk !== undefined && /^\s*disabled: false\s*$/m.test(bashChunk)
      : bashChunk !== undefined && /disabled: !!js process\.platform/.test(bashChunk),
  )
}

// ── 「按本线修复」的两条不变量（issue #2 / #3）──────────────────────────────
//
// 背景：`disableRowsInPlace` 是「按本线修复」的落地实现 —— 它必须**只**关掉被点名的那几行。
// 实测（对抗性审阅，2026-09-21）发现它会连带关掉无关的分组：嵌套层只用「下一个 4 空格 - id:」
// 界定片段，于是**分组的最后一个子行吞掉了后续内容**（含顶层行的 name: 头），
// `ownKeyIndent` 随即算出缩进 2，把 disabled 写进了**下一个分组**。
// 现有用例恰好绕开了它（受害者取的是顶层行 / 往文件尾追加），所以这一节补齐：
// **每个行 id 都试一遍**，且用"分组在中间、后面还跟着顶层行"的形状。
{
  const { disableRowsInPlace, unresolvableRows } = await import('../editor/composition.mjs')

  // ★ 嵌套行必须是**正好 4 个空格**：`collectRows` 的 rowIdAt 只认 `^ {4}- id: `
  //   （出厂文件就是这个形状，bug 也正出在这里）。用 2 空格的话子行会整个不可见，
  //   下面的逐 id 扫描就白跑了 —— 第一版就踩了这个坑。
  const SHAPE = [
    '- id: head-row',
    "  name: '@deepseek-ai/dsh-real-pkg'",
    '',
    '- id: grp',
    '  name: cordis:group',
    '  group: true',
    '    - id: child-a',
    "      name: '@deepseek-ai/dsh-real-pkg'",
    '',
    '    - id: child-last',
    "      name: '@deepseek-ai/dsh-no-such-package'",
    '',
    '- id: tail-row',
    "  name: '@deepseek-ai/dsh-real-pkg'",
    '',
    '',
  ].join('\n')

  /** 行集合（含被关状态），用于逐 id 比对 */
  const state = (text) => {
    const out = new Map()
    const walk = (rows) => { for (const r of rows) { out.set(r.id, r.disabled); walk(r.children ?? []) } }
    walk(collectRows(text))
    return out
  }

  const ids = [...state(SHAPE).keys()]
  check('合成形状里能看到全部 5 行（含两个嵌套子行）', ids.length === 5, JSON.stringify(ids))

  for (const target of ids) {
    const before = state(SHAPE)
    const after = state(disableRowsInPlace(SHAPE, [target]))

    const collaterals = [...after.entries()].filter(([id, off]) => id !== target && before.get(id) !== off).map(([id]) => id)
    check(`关闭 ${target} 不牵连其它行`, collaterals.length === 0, `被牵连：${collaterals.join(', ')}`)
    check(`关闭 ${target} 真的关掉了它`, after.get(target) === true, `实际 ${String(after.get(target))}`)

    const beforeLines = SHAPE.split('\n').length
    const afterLines = disableRowsInPlace(SHAPE, [target]).split('\n').length
    check(`关闭 ${target} 行数增量 ≤ 1（不丢行也不多插）`, afterLines - beforeLines <= 1 && afterLines - beforeLines >= 0,
      `Δ${String(afterLines - beforeLines)}`)
    check(`关闭 ${target} 行集合不变`, after.size === before.size, `${String(before.size)} → ${String(after.size)}`)
  }

  // ── #3：`unresolvableRows` 报出的 (id, name) 必须真的是那一行自己的 ──────────
  // 用受控的假安装布局：<dir>/node_modules/@deepseek-ai/dsh-agent-presets/presets/<mode>，
  // 并让 dsh-real-pkg 存在、dsh-does-not-exist 不存在。
  const prevShipped = process.env.DSH_SHIPPED_PRESETS_DIR
  const fakeRoot = join(dir, 'fake-install')
  const fakePresets = join(fakeRoot, 'node_modules/@deepseek-ai/dsh-agent-presets/presets')
  mkdirSync(join(fakeRoot, 'node_modules/@deepseek-ai/dsh-real-pkg'), { recursive: true })
  for (const mode of ['standard', 'ptc', 'minimal', 'cordis']) {
    mkdirSync(join(fakePresets, mode), { recursive: true })
    writeFileSync(join(fakePresets, mode, 'agent.cordis.yml'), SHAPE, 'utf8')
  }
  process.env.DSH_SHIPPED_PRESETS_DIR = fakePresets
  {
    const found = unresolvableRows(SHAPE)
    check('只报真正缺失的那一行', found.map((r) => r.id).join(',') === 'child-last',
      `实际：[${found.map((r) => r.id).join(', ')}]（分组 grp 被误报 = 它从最后一个子行读了 name）`)
    check('报出的名字属于它自己那一行', found.length === 1 && found[0].name === '@deepseek-ai/dsh-no-such-package',
      JSON.stringify(found))

    // 修复必须真的把问题解决干净 —— 这正是"按本线修复"对用户的承诺。
    // （它也是本轮修复的端到端断言：把报出来的行关掉之后，本线上不该再有任何解析不了的行。）
    const repaired = disableRowsInPlace(SHAPE, found.map((r) => r.id))
    const leftover = unresolvableRows(repaired)
    check('按报出的行修复之后，不再有解析不了的行', leftover.length === 0, JSON.stringify(leftover))
    check('修复只动了被报出的那一行', /- id: child-last[\s\S]{0,120}?disabled: true/.test(repaired) && !/- id: grp[\s\S]{0,40}?disabled: true/.test(repaired),
      repaired)
  }
  process.env.DSH_SHIPPED_PRESETS_DIR = prevShipped
}

rmSync(dir, { recursive: true, force: true })

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
