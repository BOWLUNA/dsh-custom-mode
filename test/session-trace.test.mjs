/**
 * Unit tests for `tools/session-trace.mjs` — the session trace reader.
 *
 * Run: node test/session-trace.test.mjs
 *
 * Why this exists: the reader was written because a CHANGELOG line claimed "one tool call" while the session
 * had two, and nothing in the repository could show that without opening a browser. The pieces that can break
 * silently are exactly the ones tested here:
 *
 *   - **multi-frame decoding**: a session log is one Zstandard frame per record, and Node's one-shot decoder
 *     returns only the first frame *without an error* — the failure mode is "a session that looks empty";
 *   - **false frame magics**: the four magic bytes can appear inside compressed data; the reader must skip
 *     those candidates without duplicating or losing records;
 *   - **the summary**: calls paired with results, denials classified, tool+action counted;
 *   - **loud failure**: undecodable input yields an empty string (so the CLI exits 2) instead of "".
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { decodeSessionLog, parseRecords, summarize } from '../tools/session-trace.mjs'

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

/** One append like dsh writes it: a single frame per record. */
const frameOf = (record) => zstdCompressSync(Buffer.from(JSON.stringify(record) + '\n', 'utf8'))

const records = [
  { type: 'session', version: 3, id: 'session-test-0000', createdAt: 0, cwd: '/tmp' },
  { type: 'tool/call', seq: 1, time: 1, data: { turn: 0, step: 0, callId: 'c1', name: 'custom_prompt', arguments: { action: 'read' } } },
  { type: 'tool/result', seq: 2, time: 2, data: { turn: 0, step: 0, message: { text: '当前系统提示词：…' } }, sourceEventSeqs: [1] },
  { type: 'tool/call', seq: 3, time: 3, data: { turn: 0, step: 1, callId: 'c2', name: 'custom_prompt', arguments: { action: 'append', text: '回复结尾不要问句' } } },
  { type: 'tool/result', seq: 4, time: 4, data: { turn: 0, step: 1, message: { error: 'the user rejected tool "custom_prompt"' } }, sourceEventSeqs: [3] },
  { type: 'tool/call', seq: 5, time: 5, data: { turn: 0, step: 2, callId: 'c3', name: 'bash', arguments: { command: 'ls' } } },
  { type: 'tool/result', seq: 6, time: 6, data: { turn: 0, step: 2, message: { text: 'ok' } }, sourceEventSeqs: [5] },
]

console.log('=== 1. 多帧解码：一次解压只给第一帧，逐帧扫描才能拿全 ===')
const multiFrame = Buffer.concat(records.map(frameOf))
{
  const naive = zstdDecompressSync(multiFrame).toString('utf8')
  check('对照：一次性解码确实只拿到第一帧（这正是会"看起来像空会话"的原因）', naive.includes('session-test-0000') && naive.includes('custom_prompt') === false, naive.slice(0, 60))
  const decoded = decodeSessionLog(multiFrame)
  const parsed = parseRecords(decoded)
  check('逐帧扫描解出全部记录', parsed.length === records.length, `${String(parsed.length)} vs ${String(records.length)}`)
  check('记录顺序不变', parsed[0]?.type === 'session' && parsed[parsed.length - 1]?.seq === 6, JSON.stringify(parsed.map((r) => r.seq)))
}

console.log()
console.log('=== 2. 摘要：工具 + action 计数、被拒归类 ===')
{
  const trace = summarize(parseRecords(decodeSessionLog(multiFrame)))
  check('会话 id 取自 header', trace.sessionId === 'session-test-0000', trace.sessionId)
  check('统计到 3 次工具调用', trace.callCount === 3, String(trace.callCount))
  check(
    '按 工具(action) 计数',
    // 排序是"次数降序，其次按名字"（localeCompare），所以同次数下 bash 在前。
    JSON.stringify(trace.totals) === JSON.stringify([
      { key: 'bash', count: 1 },
      { key: 'custom_prompt(append)', count: 1 },
      { key: 'custom_prompt(read)', count: 1 },
    ]),
    JSON.stringify(trace.totals),
  )
  check('被拒绝的那次被归类成 denied', trace.calls.filter((call) => call.outcome === 'denied').length === 1, JSON.stringify(trace.calls.map((c) => c.outcome)))
  check('其余是 ok', trace.calls.filter((call) => call.outcome === 'ok').length === 2, JSON.stringify(trace.calls.map((c) => c.outcome)))
  check('参数原样带出（用于核对"模型到底传了什么"）', trace.calls[1]?.args?.text === '回复结尾不要问句', JSON.stringify(trace.calls[1]?.args))
}

console.log()
console.log('=== 3. 假魔数：压缩数据里出现 28 B5 2F FD 时不能重复也不能丢 ===')
{
  // 故意在两帧之间插一段裸魔数：它不是帧起点，解码必然失败，必须被跳过。
  const stray = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const withStray = Buffer.concat([frameOf(records[0]), stray, frameOf(records[1])])
  const parsed = parseRecords(decodeSessionLog(withStray))
  check('两条真实记录都在', parsed.length === 2, JSON.stringify(parsed.map((r) => r.type)))
  check('没有因为假魔数而重复', parsed.filter((r) => r.type === 'tool/call').length === 1, JSON.stringify(parsed.map((r) => r.type)))
}

console.log()
console.log('=== 4. 明文兜底与"解不出来" ===')
{
  const plain = Buffer.from(records.slice(0, 2).map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  check('没有魔数时按明文读（.jsonl 变体）', parseRecords(decodeSessionLog(plain)).length === 2)
  check('坏数据解出空串（CLI 会据此以退出码 2 报错，而不是假装空会话）', decodeSessionLog(Buffer.from('not a session log at all')) === 'not a session log at all')
  check('解析时跳过坏行、保留好行', parseRecords('{"type":"session"}\n坏行\n{"seq":2}\n').length === 2)
}

console.log()
console.log('=== 5. CLI：真跑一遍（合成日志写进一次性 home）===')
{
  const home = mkdtempSync(join(tmpdir(), 'dsh-trace-'))
  const dir = join(home, 'sessions', '--project--', 'session-abc')
  execFileSync('mkdir', ['-p', dir])
  writeFileSync(join(dir, 'session.v3.jsonl.zstd'), multiFrame)
  const out = execFileSync(process.execPath, ['tools/session-trace.mjs', '--home', home], { encoding: 'utf8' })
  check('CLI 打出汇总行', /汇总：共 3 次工具调用/.test(out), out.slice(-160))
  check('CLI 列出被拒的调用（✗ 标记）', out.includes('✗'), out.slice(0, 200))
  const summary = execFileSync(process.execPath, ['tools/session-trace.mjs', '--home', home, '--summary'], { encoding: 'utf8' })
  check('--summary 只给计数，不含消息文本', summary.includes('custom_prompt(append)') && summary.includes('当前系统提示词') === false, summary.slice(0, 200))
  const json = JSON.parse(execFileSync(process.execPath, ['tools/session-trace.mjs', '--home', home, '--json'], { encoding: 'utf8' }))
  check('--json 可被程序消费', json.callCount === 3 && Array.isArray(json.totals))

  let exitCode = 0
  try {
    execFileSync(process.execPath, ['tools/session-trace.mjs', '--home', join(home, 'nope')], { encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    exitCode = error.status
  }
  check('找不到日志时以退出码 2 结束（不是静默成功）', exitCode === 2, String(exitCode))
  rmSync(home, { recursive: true, force: true })
}

console.log()
console.log(`结果: ${String(passed)} 通过, ${String(failed)} 失败`)
process.exit(failed === 0 ? 0 : 1)
