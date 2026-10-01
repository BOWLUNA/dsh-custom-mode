/**
 * 对抗性探针 · 文件层（meta / journal / atomic / assistants / index）
 *
 * 每条都试图**证伪**一个承诺。断言写的是"正确行为"，因此在有缺陷的代码上会红 —— 这正是它的用途。
 *
 *   G. preset.yml 往返：写入 → 读回必须得到同一个名字（含控制字符）
 *   I. 旧日志（部分条目没有 n）的版本号是否会撞车
 *   J. 提示词日志坏掉时，GET state 会不会 500（1.9.7 修的是"读"，那"写透"呢）
 *   K. writeAtomicPair 的"半提交"是否真的会发生
 *   L. stageAtomic 抛错时临时文件会不会残留
 *   M. createAssistantDir 失败会不会留下幽灵目录
 *   N. 复制助手时源文件读不出来会怎样
 *   O. reorderAssistant 的"已回滚 N 个"是否等于真的回滚了几个
 *
 * 用法：node probe-io.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// ⚠️ 必须在 import 之前设好：paths.mjs 在模块加载时就把路径算死了
const HOME = mkdtempSync(join(tmpdir(), 'probe-io-home-'))
process.env.DSH_HOME = HOME

// 默认值 = **探针自己所在的仓库**（`<repo>/tools/probes/`），不写死开发机路径 —— 理由同
// probe-composition.mjs：写死的那个在 CI 上必然不存在，会让整套探针以 exit 2 全红。
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.PROBE_REPO ?? resolve(HERE, '..', '..')
// 出厂 presets：本机安装目录；离了它 renderComposition 定位不到基础模式
if (process.env.DSH_SHIPPED_PRESETS_DIR === undefined) {
  process.env.DSH_SHIPPED_PRESETS_DIR = join(
    process.env.HOME ?? '/root', '.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets',
  )
}
// ★ 2026-10-01：布局探测（1.10.0 把 editor/ 并入仓库根）。原先这里硬编码 'editor/...'，
//   那次重构之后**整套探针静默跑不起来** —— 而它不在 CI 里，坏了 6 天没人知道。
const SRC = existsSync(join(REPO, 'meta.mjs')) ? REPO : join(REPO, 'editor')
if (existsSync(join(SRC, 'meta.mjs')) === false) {
  console.error(`x  找不到 meta.mjs（既不在仓库根也不在 editor/）— PROBE_REPO=${REPO}`)
  process.exit(2)
}
const load = (rel) => import(pathToFileURL(join(SRC, rel)).href)

const meta = await load('meta.mjs')
const journal = await load('journal.mjs')
const atomic = await load('atomic.mjs')
const assistants = await load('assistants.mjs')
const index = await load('index.mjs')

const results = []
const record = (id, pass, detail) => results.push({ id, pass, detail })
const check = (id, cond, detail) => record(id, cond === true, detail)
const TMP = mkdtempSync(join(tmpdir(), 'probe-io-'))
const fresh = (name) => { const d = join(TMP, name); mkdirSync(d, { recursive: true }); return d }

console.log(`DSH_HOME = ${HOME}\n`)

// ═══ G. preset.yml 往返 ═══════════════════════════════════════════
console.log('── G. preset.yml 往返 ──')
{
  const dir = fresh('meta')
  const names = [
    '普通中文',
    'ascii-name',
    '带 空格',
    'quote"inside',
    "apostrophe'inside",
    'back\\slash',
    'colon: inside',
    '- leading dash',
    '# leading hash',
    'emoji 🙂',
    'tab\there',
    'cr\rhere',
    'bel\u0007here',
    'vt\u000bhere',
  ]
  for (const n of names) {
    let back
    try {
      meta.writePresetMeta(n, '', dir)
      back = meta.readPresetMeta(dir).name
    } catch (error) {
      back = `__throw: ${String(error.message ?? error)}`
    }
    const expected = n.replace(/\r?\n/g, ' ').trim()
    check(`G/往返 ${JSON.stringify(n)}`, back === expected, `写入 ${JSON.stringify(n)} → 读回 ${JSON.stringify(back)}`)
  }
  // 文件本身长什么样（给人看）
  meta.writePresetMeta('tab\there', '', dir)
  console.log('  提示词：写入 "tab\\there" 后 preset.yml 是 → ' + JSON.stringify(readFileSync(join(dir, 'preset.yml'), 'utf8')))
}

// ═══ I. 旧日志的版本号撞车 ═══════════════════════════════════════
console.log('\n── I. 旧日志（部分条目无 n）──')
{
  const dir = fresh('journal-legacy')
  // 手工构造一个真正会撞车的形状：先来一条 n=5，再来一条无 n（被补成 entries.length+1），再来一条 n=2
  writeFileSync(join(dir, journal.HISTORY_NAME), [
    JSON.stringify({ n: 5, at: 't1', by: 'settings', text: '版本甲' }),
    JSON.stringify({ at: 't2', by: 'settings', text: '版本乙' }),
    JSON.stringify({ n: 2, at: 't3', by: 'settings', text: '版本丙' }),
  ].join('\n') + '\n')
  const entries = journal.readEntries(dir)
  console.log('  读出的版本号：' + JSON.stringify(entries.map((e) => ({ n: e.n, text: e.text }))))
  const ns = entries.map((e) => e.n)
  check('I/版本号唯一', new Set(ns).size === ns.length,
    `序号 ${JSON.stringify(ns)}${new Set(ns).size !== ns.length ? '（有重复 → readVersion 会取到隔壁那条，"回到某一版"会取错）' : ''}`)
  // ⚠️ "递增"不能对**读出来的旧日志**断言：这份日志里显式写着 n=5（甲）与 n=2（丙），
  //    任何保留原号的策略都不可能把 [5, ?, 2] 排成递增的 —— 这条断言在原输入上不可满足。
  //    递增的真正契约在**写入侧**：新记录那一版必须严格大于所有已有版本号，
  //    否则新记录会与某条旧记录撞车 —— 那才是会让"回到某一版"取错内容的情形。
  //    （唯一性与 readVersion 的正确性仍按读出来的结果断言，见上两条。）
  const appended = journal.recordPrompt(dir, '版本丁', journal.HISTORY_SOURCE.settings)
  const maxBefore = Math.max(...ns)
  check('I/新增记录的序号严格大于已有最大号', appended.n > maxBefore,
    `已有最大号 ${maxBefore}，新记录 ${appended.n}`)
  const got = journal.readVersion(dir, 2)
  check('I/readVersion(2) 取到版本丙', got === '版本丙', `实际取到 ${JSON.stringify(got)}`)
}

// ═══ J. 日志坏掉时的 GET state ═══════════════════════════════════
console.log('\n── J. 日志被换成目录时的 GET state ──')
{
  const dir = fresh('journal-dir')
  writeFileSync(join(dir, 'prompt.md'), '我的提示词\n')
  writeFileSync(join(dir, 'prompt-reader.mjs'), '// reader\n')
  const comp = ['- id: persona', "  name: './prompt-reader.mjs'", ''].join('\n')
  writeFileSync(join(dir, 'agent.cordis.yml'), comp)
  mkdirSync(join(dir, journal.HISTORY_NAME))            // ← 日志路径被换成一个目录
  const rows = [{ id: 'a', trust: 'user', path: join(dir, 'agent.cordis.yml'), name: 'A' }]
  let outcome
  try {
    const st = index.readState(rows, 'a')
    outcome = st.ok === true ? 'ok' : `ok:false code=${st.code}`
  } catch (error) {
    outcome = `抛错（HTTP 层会变成 500）: ${String(error.message ?? error)}`
  }
  console.log('  readState → ' + outcome)
  check('J/坏日志不阻断打开助手', outcome === 'ok', outcome)
}

// ═══ K. writeAtomicPair 半提交 ═══════════════════════════════════
console.log('\n── K. writeAtomicPair 半提交 ──')
{
  const dir = fresh('atomic-pair')
  const a = join(dir, 'a.txt'), b = join(dir, 'b.txt')
  writeFileSync(a, 'OLD-A')
  mkdirSync(b)                                          // 目标 b 是目录 → rename 必失败
  let threw = false
  try { atomic.writeAtomicPair([[a, 'NEW-A'], [b, 'NEW-B']]) } catch { threw = true }
  const nowA = readFileSync(a, 'utf8')
  console.log(`  a.txt 现在是 ${JSON.stringify(nowA)}；抛错=${String(threw)}`)
  check('K/失败时两个文件都不变', nowA === 'OLD-A',
    nowA === 'OLD-A' ? '未半提交' : `半提交：a 已被换成新内容，而调用方会看到 ok:false —— 正是 saveState 注释承诺不会发生的那种状态`)
}

// ═══ L. stageAtomic 失败时的临时文件残留 ═════════════════════════
console.log('\n── L. 暂存失败时的 .tmp 残留 ──')
{
  const dir = fresh('atomic-leak')
  const ok = join(dir, 'ok.txt')
  const bad = join(dir, 'no-such-dir', 'x.txt')         // 目标目录不存在 → writeFileSync 抛 ENOENT
  let threw = false
  try { atomic.writeAtomicPair([[ok, '1'], [bad, '2']]) } catch { threw = true }
  const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
  console.log(`  抛错=${String(threw)}；残留: ${JSON.stringify(leftovers)}`)
  check('L/失败不留 .tmp', leftovers.length === 0,
    leftovers.length === 0 ? '干净' : `残留 ${leftovers.join(', ')}（roster 会扫描该目录，模块自己的注释也说这不算小事）`)
}

// ═══ M. createAssistantDir 失败留痕 ══════════════════════════════
console.log('\n── M. createAssistantDir 失败留痕 ──')
{
  const root = fresh('presets-m')
  const tmpl = fresh('tmpl-m')
  writeFileSync(join(tmpl, 'prompt.md'), '模板提示词\n')
  writeFileSync(join(tmpl, 'prompt-reader.mjs'), '// reader\n')
  // 故意不提供 agent.cordis.yml（"老版本写的模板 / 包内缺文件"的形状）
  const r = assistants.createAssistantDir({ root, id: 'writer', composition: '# 组成', templateDir: tmpl })
  const dir = join(root, 'writer')
  console.log(`  返回 ok=${String(r.ok)} code=${String(r.code)}；目录存在=${String(existsSync(dir))}`)
  check('M/失败不留幽灵目录', !existsSync(dir),
    existsSync(dir) ? '失败但目录已建（重启后 seedOnActivation 会把它补全 → 用户被告知"没创建"的助手会冒出来，且名字被永久占用）' : '未留痕')
}

// ═══ N. 复制助手时源文件读不出来 ═════════════════════════════════
console.log('\n── N. 复制助手：源文件读不出来 ──')
{
  const root = join(HOME, '.agent-presets')             // userPresetRoot([]) 的回退点
  mkdirSync(root, { recursive: true })
  const realTmpl = join(SRC, 'preset')          // 用真模板，保证"创建"这一步本身能成功
  // 源助手：prompt.md 是一个目录（读不出来），组成文件正常
  const src = join(root, 'src')
  mkdirSync(join(src, 'prompt.md'), { recursive: true })
  writeFileSync(join(src, 'prompt-reader.mjs'), '// reader\n')
  writeFileSync(join(src, 'agent.cordis.yml'), ['- id: persona', "  name: './prompt-reader.mjs'", ''].join('\n'))
  writeFileSync(join(src, 'preset.yml'), 'name: "源助手"\n')
  const rows = [{ id: 'src', trust: 'user', path: join(src, 'agent.cordis.yml'), name: '源助手' }]

  let outcome
  try {
    const r = index.createAssistant(rows, { name: '目标助手', from: 'src' }, realTmpl)
    if (r.ok === true) {
      const newPrompt = readFileSync(join(root, r.id, 'prompt.md'), 'utf8')
      outcome = `ok code=${String(r.code)}；新助手的 prompt.md 长度=${String(newPrompt.length)}`
    } else {
      outcome = `ok:false code=${String(r.code)}`
    }
  } catch (error) {
    outcome = `抛错: ${String(error.message ?? error)}`
  }
  console.log('  ' + outcome)
  check('N/源提示词读不出来时应报错，而不是静默复制出空提示词',
    outcome.includes('ok:false') || outcome.includes('抛错'),
    outcome)
}
{
  // N2：源的组成文件是目录 → readFileSync 未守卫
  const root = join(HOME, '.agent-presets')
  const src2 = join(root, 'src2')
  mkdirSync(src2, { recursive: true })
  writeFileSync(join(src2, 'prompt.md'), '源提示词\n')
  writeFileSync(join(src2, 'prompt-reader.mjs'), '// reader\n')
  mkdirSync(join(src2, 'agent.cordis.yml'), { recursive: true })   // 组成文件是目录
  const rows = [{ id: 'src2', trust: 'user', path: join(src2, 'agent.cordis.yml'), name: '源2' }]
  let outcome
  try {
    const r = index.createAssistant(rows, { name: '目标2', from: 'src2' }, join(SRC, 'preset'))
    outcome = r.ok === true ? `ok code=${String(r.code)}` : `ok:false code=${String(r.code)}`
  } catch (error) {
    outcome = `抛错（HTTP 层 500 internalError）: ${String(error.message ?? error)}`
  }
  console.log('  ' + outcome)
  check('N/源组成文件坏掉时给类型化错误', outcome.includes('ok:false'), outcome)
}

// ═══ O. reorder 的回滚计数 ═══════════════════════════════════════
console.log('\n── O. reorderAssistant 的回滚 ──')
{
  const root = fresh('presets-o')
  const mk = (id, metaText) => {
    const d = join(root, id)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'prompt.md'), 'p\n')
    writeFileSync(join(d, 'prompt-reader.mjs'), '// reader\n')
    writeFileSync(join(d, 'agent.cordis.yml'), ['- id: persona', "  name: './prompt-reader.mjs'", ''].join('\n'))
    if (metaText === 'DIR') mkdirSync(join(d, 'preset.yml'))
    else if (metaText === 'UNREADABLE') { writeFileSync(join(d, 'preset.yml'), 'name: "Beta"\n'); chmodSync(join(d, 'preset.yml'), 0) }
    else if (metaText !== null) writeFileSync(join(d, 'preset.yml'), metaText)
  }
  mk('alpha', 'name: "Alpha"\n')
  mk('beta', 'UNREADABLE')    // 读不出来（快照 text=null），但所在目录可写 → rename 覆盖会成功
  mk('gamma', 'DIR')          // preset.yml 是目录 → 写入必失败
  mk('delta', 'name: "Delta"\n')
  const rows = ['alpha', 'beta', 'gamma', 'delta'].map((id) => ({
    id, trust: 'user', path: join(root, id, 'agent.cordis.yml'), name: id[0].toUpperCase() + id.slice(1),
  }))
  // 把 alpha 往下移一位 → next = [beta, alpha, gamma, delta]，beta（快照为 null）先被写入，gamma 处失败
  const r = assistants.reorderAssistant(rows, { id: 'alpha', direction: 'down' })
  const claimed = /已回滚 (\d+) 个/.exec(r.error ?? '')
  const betaText = readFileSync(join(root, 'beta', 'preset.yml'), 'utf8')
  const betaRestored = betaText === 'name: "Beta"\n'
  const admitsGap = /未能还原/.test(r.error ?? '')
  console.log('  返回: ' + JSON.stringify({ ok: r.ok, code: r.code, error: r.error }))
  console.log(`  beta 现在=${JSON.stringify(betaText)}（快照读不到 → 这条本来就回滚不了）`)
  // ★ 契约是"**消息不许夸大**"，不是"数字必须等于某个特定文件的状态"。
  //
  // 上一版断言写成 `Number(claimed[1]) === (beta 是否还原)`，把两件事混成了一件：
  // 本场景里真正被还原的是 **alpha**（快照可用），而 beta 的快照读不到、按设计就回滚不了 ——
  // 于是即便消息完全诚实，这个等式也不会成立。断言本身不可满足。
  //
  // 真正要防的是旧实现那句夸大：它把 `written.length` 写进消息（"已回滚 2 个"），
  // 而两个都没还原。所以判据拆成两条，任一成立即算诚实：
  //   ① beta 真的被还原了；或 ② 消息**明说**有条目没能还原。
  const honest = betaRestored || admitsGap
  check('O/回滚计数不夸大（还原不了就必须明说）', honest,
    `声称回滚 ${claimed?.[1] ?? '?'} 个；beta 还原=${String(betaRestored)}；` +
    `消息里${admitsGap ? '有' : '没有'}「未能还原」字样 — ` +
    (honest ? '诚实' : '旧实现在这里会说"已回滚 N 个"却绝口不提 beta 的 order 没被还原'))
  try { chmodSync(join(root, 'beta', 'preset.yml'), 0o644) } catch { /* 清理用 */ }
}

// ── 汇总 ───────────────────────────────────────────────────────────
rmSync(TMP, { recursive: true, force: true })
rmSync(HOME, { recursive: true, force: true })
const failed = results.filter((r) => !r.pass)
console.log(`\n${'═'.repeat(64)}`)
console.log(`断言 ${results.length} 条：通过 ${results.length - failed.length}，失败 ${failed.length}`)
for (const f of failed) console.log(`  ✗ ${f.id} — ${f.detail}`)
console.log('═'.repeat(64))
process.exit(failed.length === 0 ? 0 : 1)
