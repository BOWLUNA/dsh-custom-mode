/**
 * 改动日志（`editor/journal.mjs`）的单元测试。
 *
 * Run: node test/journal.test.mjs
 *
 * 为什么单独一套：这个文件是"提示词被谁改过、还能不能回去"的唯一依据，而它的失效是**静默**的
 * —— 日志写坏了，页面只会少几行历史，没有任何报错。所以几条不变量要钉住：
 *
 *   - 只追加：旧条目在新条目写入后仍然可读；
 *   - 相同内容不重复记（保存两次而文本没变，不该产生两条历史）；
 *   - 上限生效，且裁剪后最新的那条仍在；
 *   - **坏行不牵连整箱**：半行、非 JSON、缺 text 的行全部跳过，其余照常读出；
 *   - `recordExternalChange` 只在"磁盘文本与日志末条不同"时才记 —— 这是会话内工具改动能被
 *     看见的机制。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HISTORY_MAX,
  HISTORY_NAME,
  HISTORY_SOURCE,
  historyFile,
  listHistory,
  readEntries,
  readVersion,
  recordExternalChange,
  recordPrompt,
} from '../editor/journal.mjs'

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

const dir = mkdtempSync(join(tmpdir(), 'dsh-journal-'))

console.log('=== 1. 空目录：没有日志也不报错 ===')
{
  check('readEntries 返回空数组', Array.isArray(readEntries(dir)) && readEntries(dir).length === 0)
  check('listHistory 返回空数组', listHistory(dir).length === 0)
  check('readVersion 找不到时返回 null', readVersion(dir, '2026-01-01T00:00:00.000Z') === null)
}

console.log()
console.log('=== 2. 追加与去重 ===')
{
  const first = recordPrompt(dir, '第一版提示词\n第二行\n', HISTORY_SOURCE.settings)
  check('第一次记录写了盘', first.recorded === true && first.at !== '')
  const again = recordPrompt(dir, '第一版提示词\n第二行\n', HISTORY_SOURCE.settings)
  check('相同内容不重复记', again.recorded === false && again.at === first.at)
  check('日志里只有一条', readEntries(dir).length === 1)

  recordPrompt(dir, '第二版提示词\n', HISTORY_SOURCE.settings)
  const entries = readEntries(dir)
  check('旧条目仍然在（只追加）', entries.length === 2 && entries[0].text.includes('第一版'))
  check('新条目在最后', entries[1].text === '第二版提示词\n')
  check('来源被记下来', entries[1].by === HISTORY_SOURCE.settings)
}

console.log()
console.log('=== 2.5 同毫秒内的两版必须能分别取回 ===')
{
  const same = mkdtempSync(join(tmpdir(), 'dsh-journal-'))
  const a = recordPrompt(same, 'A\n', HISTORY_SOURCE.settings)
  const b = recordPrompt(same, 'B\n', HISTORY_SOURCE.settings)
  check('两版序号不同（时间戳可能相同）', a.n !== b.n, `${String(a.n)} vs ${String(b.n)}`)
  check('按序号各自取回正确正文', readVersion(same, a.n) === 'A\n' && readVersion(same, b.n) === 'B\n')
  rmSync(same, { recursive: true, force: true })
}

console.log()
console.log('=== 3. listHistory：最新在前，且不带正文 ===')
{
  const list = listHistory(dir)
  check('最新在前', list[0].preview.includes('第二版'), JSON.stringify(list.map((e) => e.preview)))
  check('列表项不含正文', list.every((entry) => entry.text === undefined))
  check('带字节数与来源（bytes 是 UTF-8 字节）', list[0].bytes === Buffer.byteLength('第二版提示词\n', 'utf8') && list[0].by === HISTORY_SOURCE.settings, String(list[0].bytes))
  check('带版本序号', Number.isInteger(list[0].n) && list[0].n > 0, String(list[0].n))
  check('preview 取第一行非空内容', list[0].preview === '第二版提示词')
}

console.log()
console.log('=== 4. readVersion：按时间戳取回正文 ===')
{
  const entries = readEntries(dir)
  check('取回第一版正文', readVersion(dir, entries[0].n) === '第一版提示词\n第二行\n')
  check('取回第二版正文', readVersion(dir, entries[1].n) === '第二版提示词\n')
  check('未知序号返回 null', readVersion(dir, 999) === null)
  check('非法序号返回 null', readVersion(dir, '') === null && readVersion(dir, null) === null && readVersion(dir, 'abc') === null)
}

console.log()
console.log('=== 5. 坏行不牵连整箱 ===')
{
  const file = historyFile(dir)
  const good = readFileSync(file, 'utf8')
  writeFileSync(file, good + '这不是 JSON\n' + '{"at":"2026-01-01T00:00:00.000Z"}\n' + '{"text":123}\n' + good.split('\n')[0] + '\n', 'utf8')
  const entries = readEntries(dir)
  check('坏行被跳过，好行仍在', entries.length === 3, String(entries.length))
  check('缺 text 的行被跳过', entries.every((entry) => typeof entry.text === 'string'))
  check('listHistory 同样不抛', Array.isArray(listHistory(dir)))
}

console.log()
console.log('=== 6. recordExternalChange：会话内/手工改动也能留痕 ===')
{
  const other = mkdtempSync(join(tmpdir(), 'dsh-journal-'))
  recordPrompt(other, '设置页写的\n', HISTORY_SOURCE.settings)
  check('磁盘与末条一致时不记', recordExternalChange(other, '设置页写的\n') === false)
  check('不一致时记一条 external', recordExternalChange(other, '会话内工具改的\n') === true)
  const entries = readEntries(other)
  check('两条都在，且来源区分开', entries.length === 2 && entries[1].by === HISTORY_SOURCE.external)
  check('external 的内容是磁盘当前文本', entries[1].text === '会话内工具改的\n')
  rmSync(other, { recursive: true, force: true })
}

console.log()
console.log('=== 7. 上限：超出后只保留最后 N 条，且最新那条一定在 ===')
{
  const many = mkdtempSync(join(tmpdir(), 'dsh-journal-'))
  for (let i = 0; i < HISTORY_MAX + 5; i += 1) recordPrompt(many, `版本 ${String(i)}\n`, HISTORY_SOURCE.settings)
  const entries = readEntries(many)
  check(`条目数被裁到 ${String(HISTORY_MAX)}`, entries.length === HISTORY_MAX, String(entries.length))
  check('保留的是最新的', entries[entries.length - 1].text === `版本 ${String(HISTORY_MAX + 4)}\n`)
  check('最旧的已被丢弃', entries.some((entry) => entry.text === '版本 0\n') === false)
  check('裁剪后仍能按序号取回正文', readVersion(many, entries[0].n) === entries[0].text)
  rmSync(many, { recursive: true, force: true })
}

console.log()
console.log('=== 7.5 bytes 是 UTF-8 字节，不是 UTF-16 码元（界面标注 "B"）===')
{
  const cjk = mkdtempSync(join(tmpdir(), 'dsh-journal-'))
  const text = '你好，世界\n'                      // 6 个 CJK 码元 + 换行
  recordPrompt(cjk, text, HISTORY_SOURCE.settings)
  const entry = listHistory(cjk)[0]
  check('CJK 文案按 UTF-8 计字节', entry.bytes === Buffer.byteLength(text, 'utf8'), `${String(entry.bytes)} vs ${String(Buffer.byteLength(text, 'utf8'))}`)
  check('确实不同于 UTF-16 码元数', entry.bytes !== text.length, `${String(entry.bytes)} vs ${String(text.length)}`)
  rmSync(cjk, { recursive: true, force: true })
}

console.log()
console.log('=== 7.6 写入不留下临时文件，且临时名带随机性 ===')
{
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-journal-'))
  recordPrompt(tmp, '一版\n', HISTORY_SOURCE.settings)
  const left = readdirSync(tmp).filter((name) => name.includes('.tmp-'))
  check('目录里没有 .tmp- 残留', left.length === 0, JSON.stringify(left))
  // 连续两次写入会产生两个不同的临时名（进程内并发才不会互踩）——用源码断言钉住这条意图。
  const source = readFileSync(new URL('../editor/journal.mjs', import.meta.url), 'utf8')
  check('临时名含随机后缀', /\.tmp-\$\{String\(process\.pid\)\}-\$\{randomBytes/.test(source), 'no random suffix in journal.mjs')
  rmSync(tmp, { recursive: true, force: true })
}

console.log()
console.log('=== 8. 文件名固定，且不写进临时文件 ===')
{
  check('日志文件名稳定（文档与测试都依赖它）', HISTORY_NAME === 'prompt-history.jsonl')
  const file = historyFile(dir)
  check('就在助手目录下', file === join(dir, HISTORY_NAME))
  const clean = mkdtempSync(join(tmpdir(), 'dsh-journal-'))
  recordPrompt(clean, '干净的一版\n', HISTORY_SOURCE.settings)
  const raw = readFileSync(historyFile(clean), 'utf8')
  check('每行都是合法 JSON', raw.split('\n').filter((l) => l.trim() !== '').every((l) => { try { JSON.parse(l); return true } catch { return false } }))
  check('没有留下 .tmp 残留', raw.includes('.tmp-') === false)
  rmSync(clean, { recursive: true, force: true })
}

rmSync(dir, { recursive: true, force: true })
console.log()
console.log(`结果: ${String(passed)} 通过, ${String(failed)} 失败`)
process.exit(failed === 0 ? 0 : 1)
