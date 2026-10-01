/**
 * 对抗性探针 · 组成手术（composition.mjs）
 *
 * 目标：不是「跑通测试」，而是**试图证伪**这个模块写在注释里的每一条不变量。
 *
 *   A. 未触碰的行必须逐字节保留（含 !!js 平台条件）
 *   B. 渲染幂等：render(mode, ov) → overridesOf → render 结果稳定
 *   C. disableRowsInPlace 只应改动被点名的行 —— 它是"按本线修复"的落地实现
 *   D. 手术不得改变行集合、不得丢注释、不得产生重复行
 *   E. unresolvableRows 报出的 (id, name) 必须真的是那一行自己的
 *   F. overridesOf 对"用户在 base 之外加的行"的行为
 *
 * 用法（在 WSL 内）：
 *   export PATH="$HOME/.local/bin:$PATH"
 *   node probe-composition.mjs            # 用本机安装的出厂 presets
 *   DSH_SHIPPED_PRESETS_DIR=/path node probe-composition.mjs
 */
import { pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = process.env.PROBE_REPO ?? '/home/bowluna/dsh/dsh-custom-mode'
// ★ 2026-10-01：仓库布局变过一次 —— 1.10.0 把 editor/ 并入了仓库根（发布包 = 仓库根），
//   而原先这里硬编码 'editor/...'，于是那次重构之后**整套探针静默跑不起来了**：
//   它不在 CI 里，所以坏了 6 天没人知道（"跑不起来"和"全过"在没人执行时是同一个状态）。
//   改成探测，并且**找不到就响亮失败**（exit 2），别再静默。
const SRC = existsSync(join(REPO, 'composition.mjs')) ? REPO : join(REPO, 'editor')
if (existsSync(join(SRC, 'composition.mjs')) === false) {
  console.error(`x  找不到 composition.mjs（既不在仓库根也不在 editor/）— PROBE_REPO=${REPO}`)
  console.error('   探针无法运行。若仓库又搬了布局，改这里的 SRC 探测即可。')
  process.exit(2)
}
const load = (rel) => import(pathToFileURL(join(SRC, rel)).href)

const comp = await load('composition.mjs')
const {
  BASE_MODES, collectRows, readBaseComposition, renderComposition,
  disableRowsInPlace, unresolvableRows, overridesOf, modeOf,
} = comp

// ── 结果记账 ────────────────────────────────────────────────────────
const results = []
const record = (id, pass, detail) => results.push({ id, pass, detail })
const check = (id, cond, detail) => record(id, cond === true, detail)

// ── 小工具 ─────────────────────────────────────────────────────────
const flatten = (rows, into = new Map()) => {
  for (const r of rows) { into.set(r.id, r); flatten(r.children ?? [], into) }
  return into
}
/** 去掉会变的生成时间戳，使两次渲染可比。 */
const stripTs = (s) => s.replace(/# 生成时间: [^\n]*\n/, '')

/** 独立实现的「行段」切分（不复用被测代码），用于结构性断言。 */
function ownSegments(text) {
  const lines = text.split('\n')
  const top = [], nested = []
  lines.forEach((line, i) => {
    const t = /^- id: (.+?)\s*$/.exec(line)
    if (t) top.push({ id: t[1].replace(/^['"]|['"]$/g, ''), line: i })
    const n = /^ {4}- id: (.+?)\s*$/.exec(line)
    if (n) nested.push({ id: n[1].replace(/^['"]|['"]$/g, ''), line: i })
  })
  return { top, nested, lineCount: lines.length }
}

/** 行级差异：返回变化的行号与前后内容。 */
function lineDiff(before, after) {
  const a = before.split('\n'), b = after.split('\n')
  const out = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) out.push({ line: i + 1, before: a[i], after: b[i] })
    if (out.length > 6) break
  }
  return { diffs: out, lineDelta: b.length - a.length }
}

const shipped = process.env.DSH_SHIPPED_PRESETS_DIR ?? join(
  process.env.HOME ?? '/root', '.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets',
)
const REAL_SHIPPED = shipped
if (!existsSync(join(shipped, 'standard/agent.cordis.yml'))) {
  console.error('找不到出厂 presets：' + shipped)
  process.exit(2)
}
console.log(`出厂 presets: ${shipped}\n`)

// ═══════════════════════════════════════════════════════════════════
// A. 未触碰的行逐字节保留
// ═══════════════════════════════════════════════════════════════════
for (const mode of BASE_MODES.map((m) => m.id)) {
  const base = readBaseComposition(mode)
  const rendered = stripTs(renderComposition(mode, new Map(), { modeName: '', assistantId: '' }))
  const baseSeg = ownSegments(base)
  let lost = []
  for (const seg of baseSeg.top) {
    if (seg.id === 'persona') continue          // 这一行按设计被替换
    const nextLine = baseSeg.top.find((s) => s.line > seg.line)?.line ?? base.split('\n').length
    const segText = base.split('\n').slice(seg.line, nextLine).join('\n')
    if (!rendered.includes(segText)) lost.push(seg.id)
  }
  check(`A/${mode}/顶层行逐字节`, lost.length === 0, lost.length ? `未原样出现: ${lost.join(', ')}` : `${baseSeg.top.length - 1} 行全部原样`)

  // !!js 平台条件必须原样
  const jsCond = base.match(/disabled: !!js[^\n]*/g) ?? []
  const missing = jsCond.filter((c) => !rendered.includes(c))
  check(`A/${mode}/平台条件保留`, missing.length === 0, missing.length ? `丢了 ${missing.join(' | ')}` : `${jsCond.length} 条 !!js 都在`)
}

// ═══════════════════════════════════════════════════════════════════
// B. 渲染幂等（含对抗性 override 集）
// ═══════════════════════════════════════════════════════════════════
const adversarialSets = [
  { name: '空', map: new Map() },
  { name: '全开', map: new Map() },
  { name: '全关', map: new Map() },
]
for (const mode of BASE_MODES.map((m) => m.id)) {
  const rows = flatten(collectRows(readBaseComposition(mode)))
  for (const id of rows.keys()) {
    adversarialSets[1].map.set(id, true)
    adversarialSets[2].map.set(id, false)
  }
  // 混入不存在的 id 与插件自有行
  const hostile = new Map([...adversarialSets[1].map])
  hostile.set('no-such-row', false)
  hostile.set('custom-prompt-tool', false)
  adversarialSets.push({ name: '全开+不存在id', map: hostile })
}
for (const set of adversarialSets) {
  for (const mode of BASE_MODES.map((m) => m.id)) {
    let first, second, ov
    try {
      first = stripTs(renderComposition(mode, set.map, { modeName: '甲', assistantId: 'jia' }))
      ov = overridesOf(first, mode)
      second = stripTs(renderComposition(mode, ov, { modeName: '甲', assistantId: 'jia' }))
    } catch (error) {
      check(`B/${mode}/${set.name}/幂等`, false, `抛错: ${String(error.message ?? error)}`)
      continue
    }
    check(`B/${mode}/${set.name}/幂等`, first === second,
      first === second ? '两次渲染逐字节相同' : `差异 ${lineDiff(first, second).diffs.length} 处: ${JSON.stringify(lineDiff(first, second).diffs[0] ?? {})}`)
  }
}

// ═══════════════════════════════════════════════════════════════════
// C. disableRowsInPlace 的连带损害（本轮重点）
// ═══════════════════════════════════════════════════════════════════
console.log('── C. disableRowsInPlace 逐行逐 id 扫描 ──')
let collateral = 0, noopBytes = 0, noopClean = 0, clean = 0, structural = 0
const wounds = []
for (const mode of BASE_MODES.map((m) => m.id)) {
  const base = readBaseComposition(mode)
  const before = flatten(collectRows(base))
  const ids = [...before.keys()]
  for (const target of ids) {
    let after
    try {
      after = disableRowsInPlace(base, [target])
    } catch (error) {
      wounds.push({ mode, target, kind: '抛错', detail: String(error.message ?? error) })
      continue
    }
    const afterRows = flatten(collectRows(after))
    const flipped = [...afterRows.entries()].filter(([id, row]) => before.get(id)?.disabled !== row.disabled).map(([id]) => id)
    const targetFlipped = flipped.includes(target)
    const others = flipped.filter((id) => id !== target)
    const diff = lineDiff(base, after)

    // 行集合必须不变
    const setChanged = before.size !== afterRows.size || [...before.keys()].some((k) => !afterRows.has(k))
    if (setChanged) { structural += 1; wounds.push({ mode, target, kind: '行集合改变', detail: `${before.size} → ${afterRows.size}` }) }
    // 行数增量只能是 0 或 +1（插入一条 disabled），且必须只改目标行所在的段
    const maxDelta = 1
    if (diff.lineDelta < 0 || diff.lineDelta > maxDelta) {
      structural += 1; wounds.push({ mode, target, kind: '行数异常', detail: `Δ${diff.lineDelta}，改动行 ${diff.diffs.map((d) => d.line).join(',')}` })
    }

    if (others.length > 0) {
      collateral += 1
      wounds.push({ mode, target, kind: '★连带改动', detail: `无关行被改动: ${others.join(', ')} | 改动行 ${diff.diffs.map((d) => d.line).join(',')}` })
    } else if (!targetFlipped) {
      if (diff.diffs.length > 0) {
        noopBytes += 1
        wounds.push({ mode, target, kind: '改了字节但状态没变', detail: `改动行 ${diff.diffs.map((d) => d.line).join(',')} | ${JSON.stringify(diff.diffs[0])}` })
      } else {
        noopClean += 1
      }
    } else {
      clean += 1
    }
  }
}
console.log(`  正确生效 ${clean} / ★连带损害 ${collateral} / 改了字节但状态没变 ${noopBytes} / 完全无操作 ${noopClean} / 结构异常 ${structural}`)
for (const w of wounds) console.log(`  ✗ [${w.mode}] ${w.target} — ${w.kind}：${w.detail}`)
check('C/无连带损害', collateral === 0, `${collateral} 例连带改动了无关行`)
check('C/结构完整', structural === 0, `${structural} 例改变了行集合/行数`)

// ═══════════════════════════════════════════════════════════════════
// D. 手术丢不丢注释
// ═══════════════════════════════════════════════════════════════════
for (const mode of BASE_MODES.map((m) => m.id)) {
  const base = readBaseComposition(mode)
  const commentsBefore = (base.match(/^\s*#.*$/gm) ?? []).length
  const ids = [...flatten(collectRows(base)).keys()]
  let worst = 0, worstId = null, worstAfter = null
  for (const target of ids) {
    const after = disableRowsInPlace(base, [target])
    const afterCount = (after.match(/^\s*#.*$/gm) ?? []).length
    if (afterCount < commentsBefore && commentsBefore - afterCount > worst) {
      worst = commentsBefore - afterCount; worstId = target; worstAfter = afterCount
    }
  }
  check(`D/${mode}/注释不丢`, worst === 0, worst === 0 ? `${commentsBefore} 条注释全部保留` : `目标 ${worstId} 时注释 ${commentsBefore} → ${worstAfter}`)
}

// ═══════════════════════════════════════════════════════════════════
// E. unresolvableRows 的归属是否正确（受控假布局）
// ═══════════════════════════════════════════════════════════════════
const TMP = join(tmpdir(), `probe-unres-${String(process.pid)}`)
rmSync(TMP, { recursive: true, force: true })
// 造一个看起来像真的安装布局：<TMP>/node_modules/@deepseek-ai/dsh-agent-presets/presets/<mode>/
const fakePresets = join(TMP, 'node_modules/@deepseek-ai/dsh-agent-presets/presets')
mkdirSync(join(fakePresets, 'standard'), { recursive: true })
mkdirSync(join(TMP, 'node_modules/@deepseek-ai/dsh-real-pkg'), { recursive: true })
const SYNTH = [
  '# 合成组成：结构照抄出厂形状',
  '- id: healthy-a',
  "  name: '@deepseek-ai/dsh-real-pkg'",
  '',
  '- id: grp',
  '  name: cordis:group',
  '  group: true',
  '  # 注释',
  '  - id: child-ok',
  "    name: '@deepseek-ai/dsh-real-pkg'",
  '',
  '  - id: child-missing',
  "    name: '@deepseek-ai/dsh-does-not-exist'",
  '',
  '- id: tail-row',
  "  name: '@deepseek-ai/dsh-real-pkg'",
  '',
  '',
].join('\n')
writeFileSync(join(fakePresets, 'standard/agent.cordis.yml'), SYNTH)
for (const m of ['ptc', 'minimal', 'cordis']) {
  mkdirSync(join(fakePresets, m), { recursive: true })
  writeFileSync(join(fakePresets, `${m}/agent.cordis.yml`), SYNTH)
}
process.env.DSH_SHIPPED_PRESETS_DIR = fakePresets
comp.setShippedPresetsDir(fakePresets)
const found = unresolvableRows(SYNTH)
console.log('\n── E. unresolvableRows 归属 ──')
console.log('  报告：' + JSON.stringify(found))
const expectIds = ['child-missing']
const expectName = '@deepseek-ai/dsh-does-not-exist'
check('E/只报真正缺失的那一行',
  found.map((r) => r.id).sort().join(',') === expectIds.join(','),
  `期望 [${expectIds.join(',')}]，实际 [${found.map((r) => r.id).join(',')}]`)
check('E/报出的 name 属于它自己的行',
  found.every((r) => r.name === expectName),
  JSON.stringify(found))
// 恢复真实出厂目录，供后面的小节使用
process.env.DSH_SHIPPED_PRESETS_DIR = REAL_SHIPPED
comp.setShippedPresetsDir(REAL_SHIPPED)

// ═══════════════════════════════════════════════════════════════════
// F. overridesOf 对 base 之外的自有行
// ═══════════════════════════════════════════════════════════════════
{
  const base = readBaseComposition('minimal')
  const withExtra = base.replace(/\n/g, '\n') + [
    '',
    '# 用户手工加的一行',
    '- id: my-extra-row',
    "  name: '@deepseek-ai/dsh-tool-web'",
    '',
  ].join('\n')
  let ov
  try { ov = overridesOf(withExtra, 'minimal') } catch (error) { ov = { __throw: String(error.message) } }
  // 这一条只作观察、不作断言：把自有行记成 override 不会写坏任何东西（重渲染只处理 base 行），
  // 真正已知的取舍是"重渲染会丢掉自有行"，那正是 disableRowsInPlace 存在的原因。
  record('F/自有行行为（观察）', true,
    `overridesOf 记为 override=${String(Object.hasOwn(ov, 'my-extra-row'))}；${JSON.stringify(ov)}`)
}

// ── 汇总 ───────────────────────────────────────────────────────────
rmSync(TMP, { recursive: true, force: true })
const failed = results.filter((r) => !r.pass)
console.log(`\n${'═'.repeat(64)}`)
console.log(`断言 ${results.length} 条：通过 ${results.length - failed.length}，失败 ${failed.length}`)
for (const f of failed) console.log(`  ✗ ${f.id} — ${f.detail}`)
console.log(`${'═'.repeat(64)}`)
process.exit(failed.length === 0 ? 0 : 1)
