/**
 * 对抗性探针 · 模糊测试与压测
 *
 *   P. renderComposition 随机 override 模糊
 *   Q. 两份 checkPromptText 的**差分**模糊（随机花括号汤）
 *   R. CRLF 行尾（用户在 Windows 上手工编辑过的组成文件）
 *   S. 组成文件里出现重复的行 id
 *   T. 三层嵌套（页面只能看见两层）
 *   U. 规模：600 行组成文件上各路径的耗时
 *
 * 用法：node probe-fuzz.mjs
 */
import { pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = process.env.PROBE_REPO ?? '/home/bowluna/dsh/dsh-custom-mode'
const REAL_SHIPPED = process.env.DSH_SHIPPED_PRESETS_DIR ?? join(
  process.env.HOME ?? '/root', '.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets',
)
process.env.DSH_SHIPPED_PRESETS_DIR = REAL_SHIPPED
// ★ 2026-10-01：布局探测（1.10.0 把 editor/ 并入仓库根）。原先硬编码 'editor/...'，
//   那次重构之后**整套探针静默跑不起来** —— 它不在 CI 里，坏了 6 天没人知道。
const SRC = existsSync(join(REPO, 'composition.mjs')) ? REPO : join(REPO, 'editor')
if (existsSync(join(SRC, 'composition.mjs')) === false) {
  console.error(`x  找不到 composition.mjs（既不在仓库根也不在 editor/）— PROBE_REPO=${REPO}`)
  process.exit(2)
}
const load = (rel) => import(pathToFileURL(join(SRC, rel)).href)

const comp = await load('composition.mjs')
const editor = await load('index.mjs')
const {
  BASE_MODES, collectRows, readBaseComposition, renderComposition,
  disableRowsInPlace, overridesOf,
} = comp

const results = []
const record = (id, pass, detail) => results.push({ id, pass, detail })
const check = (id, cond, detail) => record(id, cond === true, detail)
const TMP = mkdtempSync(join(tmpdir(), 'probe-fuzz-'))
const flatten = (rows, into = new Map()) => {
  for (const r of rows) { into.set(r.id, r); flatten(r.children ?? [], into) }
  return into
}
/** 确定性伪随机，让失败可复现。 */
let seed = 0x2f6e2b1
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 100000) / 100000 }

// ═══ P. renderComposition 模糊 ════════════════════════════════════
console.log('── P. renderComposition 随机 override ──')
{
  let checked = 0, threw = 0, rowLoss = 0, firstBad = null
  for (let round = 0; round < 400; round += 1) {
    const mode = BASE_MODES[Math.floor(rnd() * BASE_MODES.length)].id
    const baseRows = [...flatten(collectRows(readBaseComposition(mode))).keys()]
    const ov = new Map()
    for (const id of baseRows) if (rnd() < 0.35) ov.set(id, rnd() < 0.5)
    // 掺入垃圾键
    if (rnd() < 0.3) ov.set('zzz-' + String(round), rnd() < 0.5)
    let out
    try { out = renderComposition(mode, ov, { modeName: '名' + String(round), assistantId: 'a' + String(round) }) }
    catch (error) { threw += 1; if (firstBad === null) firstBad = `mode=${mode} 抛错 ${String(error.message ?? error)}`; continue }
    checked += 1
    const seen = flatten(collectRows(out))
    // 每个 base 行都必须仍然出现在产物里
    const lost = baseRows.filter((id) => !seen.has(id))
    if (lost.length > 0) { rowLoss += 1; if (firstBad === null) firstBad = `mode=${mode} 丢了行 ${lost.join(',')}` }
    // 行数必须与 base + 自有行一致
    const extras = comp.extraRowIds()
    if (seen.size !== new Set([...baseRows, ...extras]).size) {
      rowLoss += 1
      if (firstBad === null) firstBad = `mode=${mode} 行数 ${seen.size} ≠ ${new Set([...baseRows, ...extras]).size}`
    }
  }
  check('P/400 轮随机渲染不抛错', threw === 0, `${checked} 轮完成，${threw} 轮抛错${firstBad ? '；首例 ' + firstBad : ''}`)
  check('P/随机渲染不丢行', rowLoss === 0, rowLoss ? `${rowLoss} 轮丢了行；首例 ${firstBad}` : '行集合每轮都完整')
}

// ═══ Q. 两份 checkPromptText 的差分模糊 ═══════════════════════════
console.log('\n── Q. 两份 checkPromptText 差分模糊 ──')
{
  const src = readFileSync(join(REPO, 'preset/prompt-tool.mjs'), 'utf8')
  const start = src.indexOf('function checkPromptText(')
  const end = src.indexOf('\n}\n', start)
  const body = src.slice(start, end + 2)
  const varLine = src.slice(src.indexOf('const VARIABLE_NAME'), src.indexOf('\n', src.indexOf('const VARIABLE_NAME')))
  const kvStart = src.indexOf('const KNOWN_VARIABLES')
  const kvLine = src.slice(kvStart, src.indexOf(']', kvStart) + 1)
  const presetVerdict = new Function(`${varLine};\n${kvLine};\n${body};\nreturn checkPromptText`)()

  const alphabet = ['{', '}', ' ', 'a', 'z', '0', '_', 'm', 'o', 'd', 'e', 'l', '\n', '{', '}']
  let diverged = 0, cases = 0
  const samples = []
  for (let round = 0; round < 20000; round += 1) {
    const n = 1 + Math.floor(rnd() * 24)
    let s = ''
    for (let i = 0; i < n; i += 1) s += alphabet[Math.floor(rnd() * alphabet.length)]
    cases += 1
    let a, b
    try { a = editor.checkPromptText(s).ok } catch { a = 'throw' }
    try { b = presetVerdict(s).ok } catch { b = 'throw' }
    if (a !== b) { diverged += 1; if (samples.length < 6) samples.push({ s, editor: a, preset: b }) }
  }
  check('Q/两份校验器判定一致', diverged === 0, `${cases} 例中 ${diverged} 例分歧 ${JSON.stringify(samples)}`)
}

// ═══ R. CRLF 行尾 ═════════════════════════════════════════════════
console.log('\n── R. CRLF 行尾 ──')
{
  const lf = readBaseComposition('standard')
  const crlf = lf.replace(/\n/g, '\r\n')
  const rows = collectRows(crlf)
  check('R/CRLF 下仍能收集到行', rows.length > 0, `收到 ${rows.length} 个顶层行`)

  const before = flatten(collectRows(crlf))
  const target = [...before.keys()].find((id) => id !== 'persona')
  const after = disableRowsInPlace(crlf, [target])
  const endings = { crlf: (after.match(/\r\n/g) ?? []).length, loneLf: (after.match(/(?<!\r)\n/g) ?? []).length }
  check('R/CRLF 下不混入裸 LF', endings.loneLf === 0,
    `CRLF ${endings.crlf} 个 / 裸 LF ${endings.loneLf} 个` + (endings.loneLf ? '（混行尾：下一个读它的工具会看到不一致的文件）' : ''))

  let same
  try { same = rows.length === collectRows(disableRowsInPlace(crlf, [target])).length } catch { same = false }
  check('R/CRLF 下手术不改变行数', same === true, same ? '行数一致' : '行数变了')
}

// ═══ S. 重复行 id ═════════════════════════════════════════════════
console.log('\n── S. 重复行 id ──')
{
  const dup = [
    '- id: alpha',
    "  name: '@deepseek-ai/dsh-tool-web'",
    '',
    '- id: alpha',
    "  name: '@deepseek-ai/dsh-tool-fs'",
    '',
    '- id: beta',
    "  name: '@deepseek-ai/dsh-tool-skill'",
    '',
    '',
  ].join('\n')
  const rows = collectRows(dup)
  const after = disableRowsInPlace(dup, ['alpha'])
  const disabledCount = collectRows(after).filter((r) => r.id === 'alpha' && r.disabled === true).length
  const bothDisabled = disabledCount === 2
  check('S/同 id 的两行都被改动（应只改一行或拒绝）', bothDisabled === false,
    `collectRows 看到 ${rows.length} 行（id: ${rows.map((r) => r.id).join(',')}）；关掉 alpha 后有 ${disabledCount} 个 alpha 被关` +
    (bothDisabled ? ' → 一个 id 的开关同时作用于两处，而页面只显示一行' : ''))
}

// ═══ T. 缩进不是 4 空格时，分组内的行会整体消失 ═══════════════════
console.log('\n── T. 缩进敏感：分组子行的可见性 ──')
{
  const deep = [
    '- id: g2sp',
    '  name: cordis:group',
    '  group: true',
    '  - id: child-2sp',                    // 2 空格缩进：合法 YAML
    "    name: '@deepseek-ai/dsh-tool-web'",
    '',
    '- id: g4sp',
    '  name: cordis:group',
    '  group: true',
    '    - id: child-4sp',                  // 4 空格缩进：出厂文件的形状
    "      name: '@deepseek-ai/dsh-tool-web'",
    '',
    '',
  ].join('\n')
  const ids = [...flatten(collectRows(deep)).keys()]
  console.log(`  页面可见行 = [${ids.join(', ')}]`)
  check('T/分组里每一行都可见（不论缩进几格）', ids.includes('child-2sp'),
    `child-2sp ${ids.includes('child-2sp') ? '可见' : '**不可见**'}：` +
    '行 id 的识别写死了"嵌套行必须正好 4 空格"（rowIdAt 的 /^ {4}- id: /），' +
    '而 YAML 允许任意统一缩进 —— 这类文件里的行动不了、页面也看不见，但文件里还在')
}

// ═══ U. 规模 ═════════════════════════════════════════════════════
console.log('\n── U. 规模（600 行组成）──')
{
  const synth = join(TMP, 'node_modules/@deepseek-ai/dsh-agent-presets/presets')
  mkdirSync(join(synth, 'standard'), { recursive: true })
  mkdirSync(join(TMP, 'node_modules/@deepseek-ai/dsh-tool-web'), { recursive: true })
  const lines = ['# 合成大文件']
  for (let i = 0; i < 200; i += 1) {
    lines.push(`- id: row-${String(i)}`, "  name: '@deepseek-ai/dsh-tool-web'", '')
    if (i % 5 === 0) {
      lines.push(`- id: grp-${String(i)}`, '  name: cordis:group', '  group: true')
      for (let j = 0; j < 2; j += 1) lines.push(`  - id: child-${String(i)}-${String(j)}`, "    name: '@deepseek-ai/dsh-tool-web'", '')
      lines.push('')
    }
  }
  const big = lines.join('\n')
  for (const m of ['standard', 'ptc', 'minimal', 'cordis']) {
    mkdirSync(join(synth, m), { recursive: true })
    writeFileSync(join(synth, `${m}/agent.cordis.yml`), big)
  }
  process.env.DSH_SHIPPED_PRESETS_DIR = synth
  comp.setShippedPresetsDir(synth)
  const time = (label, fn) => { const t = process.hrtime.bigint(); const r = fn(); const ms = Number(process.hrtime.bigint() - t) / 1e6; console.log(`  ${label.padEnd(28)} ${ms.toFixed(1)} ms`); return { r, ms } }

  const rows = collectRows(big)
  console.log(`  行数：顶层 ${rows.length}，展开 ${flatten(rows).size}`)
  const t1 = time('collectRows', () => collectRows(big))
  const t2 = time('renderComposition', () => renderComposition('standard', new Map()))
  time('overridesOf', () => overridesOf(t2.r, 'standard'))
  time('disableRowsInPlace(1 id)', () => disableRowsInPlace(big, ['row-7']))
  time('unresolvableRows', () => comp.unresolvableRows(big))
  check('U/200 行规模下 renderComposition 在 250ms 内', t2.ms < 250, `${t2.ms.toFixed(1)} ms`)
  check('U/大文件行集合完整', flatten(t1.r).size === flatten(rows).size, `${flatten(t1.r).size} 行`)
  process.env.DSH_SHIPPED_PRESETS_DIR = REAL_SHIPPED
  comp.setShippedPresetsDir(REAL_SHIPPED)
}

rmSync(TMP, { recursive: true, force: true })
const failed = results.filter((r) => !r.pass)
console.log(`\n${'═'.repeat(64)}`)
console.log(`断言 ${results.length} 条：通过 ${results.length - failed.length}，失败 ${failed.length}`)
for (const f of failed) console.log(`  ✗ ${f.id} — ${f.detail}`)
console.log('═'.repeat(64))
process.exit(failed.length === 0 ? 0 : 1)
