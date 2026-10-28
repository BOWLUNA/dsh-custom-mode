/**
 * Unit tests for `tools/session-trace.mjs` — the session trace reader.
 *
 * Run: node test/session-trace.test.mjs
 *
 * Why this exists: the reader was written because a CHANGELOG line claimed "one tool call" while the session
 * had two, and nothing in the repository could show that without opening a browser. The pieces that can break
 * silently are exactly the ones tested here:
 *
 *   - **multi-frame decoding**: a session log is one Zstandard frame per record. Node versions differ in
 *     whether a single call decodes one frame or all frames; neither may lose or duplicate records;
 *   - **false frame magics**: the four magic bytes can appear inside compressed data; the reader must skip
 *     those candidates without duplicating or losing records;
 *   - **the summary**: calls paired with results, denials classified, tool+action counted;
 *   - **loud failure**: undecodable input yields an empty string (so the CLI exits 2) instead of "".
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as zlib from 'node:zlib'
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

/**
 * Whether this Node can do zstd at all (22.15 / 23.8+). On older runtimes the frame-based checks are skipped
 * with a printed reason, but the plaintext paths are still exercised — a suite that silently passes by doing
 * nothing would be worse than one that says why it skipped.
 */
const hasZstd = typeof zlib.zstdDecompressSync === 'function' && typeof zlib.zstdCompressSync === 'function'

/** One append like dsh writes it: a single frame per record. */
const frameOf = (record) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(record) + '\n', 'utf8'))
const zstdDecompressSync = (...args) => zlib.zstdDecompressSync(...args)

const records = [
  { type: 'session', version: 3, id: 'session-test-0000', createdAt: 0, cwd: '/tmp' },
  { type: 'tool/call', seq: 1, time: 1, data: { turn: 0, step: 0, callId: 'c1', name: 'custom_prompt', arguments: { action: 'read' } } },
  { type: 'tool/result', seq: 2, time: 2, data: { turn: 0, step: 0, message: { text: '当前系统提示词：…' } }, sourceEventSeqs: [1] },
  { type: 'tool/call', seq: 3, time: 3, data: { turn: 0, step: 1, callId: 'c2', name: 'custom_prompt', arguments: { action: 'append', text: '回复结尾不要问句' } } },
  { type: 'tool/result', seq: 4, time: 4, data: { turn: 0, step: 1, message: { error: 'the user rejected tool "custom_prompt"' } }, sourceEventSeqs: [3] },
  { type: 'tool/call', seq: 5, time: 5, data: { turn: 0, step: 2, callId: 'c3', name: 'bash', arguments: { command: 'ls' } } },
  { type: 'tool/result', seq: 6, time: 6, data: { turn: 0, step: 2, message: { text: 'ok' } }, sourceEventSeqs: [5] },
]

// Node 20 没有 zstd（22.15 / 23.8+ 才有）。这时**不能**让套件崩掉，但也不能"什么都没跑就算过"：
// 打印原因，仍然验证不依赖 zstd 的提取逻辑，然后正常退出。
if (hasZstd !== true) {
  console.log(`=== 当前 Node（${process.version}）没有 zstd：与解压/CLI 相关的检查跳过 ===`)
  const plain = [
    { type: 'session', id: 'session-plain' },
    { type: 'tool/call', seq: 1, data: { turn: 0, step: 0, name: 'custom_prompt', arguments: '{"action":"read"}' } },
    { type: 'tool/result', seq: 2, data: { turn: 0, step: 0, message: { text: 'ok' } }, sourceEventSeqs: [1] },
    { type: 'tool/call', seq: 3, data: { turn: 0, step: 1, name: 'bash', arguments: '{"command":"ls"}' } },
    { type: 'tool/result', seq: 4, data: { turn: 0, step: 1, message: { error: 'the user rejected tool "bash"' } }, sourceEventSeqs: [3] },
  ]
  const trace = summarize(plain)
  check('（无 zstd 分支）仍然统计工具调用', trace.callCount === 2 && trace.sessionId === 'session-plain', JSON.stringify({ n: trace.callCount }))
  check('（无 zstd 分支）JSON 字符串参数仍能取出 action', trace.totals.some((t) => t.key === 'custom_prompt(read)'), JSON.stringify(trace.totals))
  check('（无 zstd 分支）被拒的调用仍被归类', trace.calls.filter((c) => c.outcome === 'denied').length === 1, JSON.stringify(trace.calls.map((c) => c.outcome)))
  check('（无 zstd 分支）坏行仍被跳过', parseRecords('{"a":1}\n坏\n{"b":2}\n').length === 2)
  console.log()
  console.log(`结果: ${String(passed)} 通过, ${String(failed)} 失败（zstd 部分已跳过）`)
  process.exit(failed === 0 ? 0 : 1)
}

console.log('=== 1. 多帧解码：不依赖原生解码器只读一帧还是读全部 ===')
const multiFrame = Buffer.concat(records.map(frameOf))
{
  const naive = zstdDecompressSync(multiFrame).toString('utf8')
  console.log(`原生解码对照（${process.version}）：${String(parseRecords(naive).length)} 条；读取器必须始终输出 ${String(records.length)} 条`)
  check('单帧仍原样解码', decodeSessionLog(frameOf(records[0])) === JSON.stringify(records[0]) + '\n')
  const decoded = decodeSessionLog(multiFrame)
  const parsed = parseRecords(decoded)
  check('逐帧扫描解出全部记录', parsed.length === records.length, `${String(parsed.length)} vs ${String(records.length)}`)
  check('全部记录内容与顺序不变', JSON.stringify(parsed) === JSON.stringify(records), JSON.stringify(parsed.map((r) => r.seq)))
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
console.log('=== 2.5 真实日志的形状：arguments 是 JSON 字符串，不是对象 ===')
{
  // 实测（真机会话）：`tool/call` 的 data.arguments 是 "{\"action\": \"read\"}" 这样的字符串。
  // 只认对象的读取器会静默丢掉 action，于是把 custom_prompt(read) 报成 custom_prompt —— 断言就永远不会成立。
  const stringArgs = [
    { type: 'session', id: 'session-real-shape' },
    { type: 'tool/call', seq: 1, data: { turn: 0, step: 0, callId: 'c1', name: 'custom_prompt', arguments: '{"action": "read"}' } },
    { type: 'tool/result', seq: 2, data: { turn: 0, step: 0, message: { text: 'ok' } }, sourceEventSeqs: [1] },
    { type: 'tool/call', seq: 3, data: { turn: 0, step: 1, callId: 'c2', name: 'custom_prompt', arguments: '{"action":"append","text":"x"}' } },
    { type: 'tool/result', seq: 4, data: { turn: 0, step: 1, message: { text: 'ok' } }, sourceEventSeqs: [3] },
  ]
  const trace = summarize(parseRecords(decodeSessionLog(Buffer.concat(stringArgs.map(frameOf)))))
  check(
    'JSON 字符串参数也能取出 action',
    JSON.stringify(trace.totals) === JSON.stringify([
      { key: 'custom_prompt(append)', count: 1 },
      { key: 'custom_prompt(read)', count: 1 },
    ]),
    JSON.stringify(trace.totals),
  )
  check('展示时用解析后的对象', trace.calls[0]?.args?.action === 'read', JSON.stringify(trace.calls[0]?.args))
  check('非 JSON 的字符串参数不会崩', summarize(parseRecords('{"type":"tool/call","seq":1,"data":{"name":"bash","arguments":"--flag"}}\n')).calls[0]?.name === 'bash')
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
console.log('=== 3.1 消费边界：内部魔数、skippable、坏尾与真实重复调用 ===')
{
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  // RFC 8878 §3.1.1: one single-segment frame with a one-byte content size and one raw block.
  // A raw payload gives us actual frame-magic bytes INSIDE a valid frame, not merely between frames.
  const payload = Buffer.concat([Buffer.from('{"type":"note","text":"'), magic, Buffer.from('"}\n')])
  const blockHeader = Buffer.alloc(3)
  blockHeader.writeUIntLE((payload.length << 3) | 1, 0, 3)
  const raw = Buffer.concat([magic, Buffer.from([0x20, payload.length]), blockHeader, payload])
  const embedded = Buffer.concat([raw, frameOf(records[1])])
  check('有效帧内部的魔数不截断或重复解码', decodeSessionLog(embedded) === payload.toString('utf8') + JSON.stringify(records[1]) + '\n')
  check('内部魔数之后的真实调用恰好一次', summarize(parseRecords(decodeSessionLog(embedded))).callCount === 1)

  const nested = frameOf({ type: 'tool/call', seq: 99, data: { name: 'nested-must-not-count' } })
  const size = Buffer.alloc(4)
  size.writeUInt32LE(nested.length)
  const skipped = Buffer.concat([Buffer.from([0x5f, 0x2a, 0x4d, 0x18]), size, nested])
  check('skippable内完整嵌套帧不得计为调用', JSON.stringify(parseRecords(decodeSessionLog(Buffer.concat([skipped, multiFrame])))) === JSON.stringify(records))
  check('只有skippable帧时不把payload当明文', decodeSessionLog(skipped) === '')
  for (const marker of [0x50, 0x57, 0x5f]) {
    const tornHeader = Buffer.alloc(8)
    tornHeader.set([marker, 0x2a, 0x4d, 0x18])
    tornHeader.writeUInt32LE(nested.length + 20, 4)
    const tornSkip = Buffer.concat([tornHeader, nested])
    check(`截断skippable ${String(marker)}不泄漏嵌套调用且保留完整前缀`, JSON.stringify(parseRecords(decodeSessionLog(Buffer.concat([multiFrame, tornSkip])))) === JSON.stringify(records))
    check(`仅截断skippable ${String(marker)}时不把嵌套帧当日志`, decodeSessionLog(tornSkip) === '')
  }
  const rawSkipPayload = Buffer.concat([Buffer.from('raw payload: '), skipped])
  const rawSkipBlock = Buffer.alloc(3)
  rawSkipBlock.writeUIntLE((rawSkipPayload.length << 3) | 1, 0, 3)
  const rawSkip = Buffer.concat([magic, Buffer.from([0x20, rawSkipPayload.length]), rawSkipBlock, rawSkipPayload])
  check('普通帧内的skip头不能吞掉其后真实帧', decodeSessionLog(Buffer.concat([rawSkip, frameOf(records[1])])) === rawSkipPayload.toString('utf8') + JSON.stringify(records[1]) + '\n')

  const duplicate = summarize(parseRecords(decodeSessionLog(Buffer.concat([frameOf(records[1]), frameOf(records[1])]))))
  check('真实重复事件即使seq和内容相同仍计两次', duplicate.callCount === 2 && duplicate.totals[0]?.count === 2)

  const tail = frameOf({ type: 'tool/call', seq: 100, data: { name: 'torn-must-not-count' } })
  const truncated = Buffer.concat([multiFrame, tail.subarray(0, tail.length - 1)])
  check('截断末帧保留此前全部完整记录', JSON.stringify(parseRecords(decodeSessionLog(truncated))) === JSON.stringify(records))
  check('只有截断帧时不接受宽松解码的部分输出', decodeSessionLog(tail.subarray(0, tail.length - 1)) === '')
  check('仅写出下一帧部分魔数时保留完整前缀', JSON.stringify(parseRecords(decodeSessionLog(Buffer.concat([multiFrame, magic.subarray(0, 2)])))) === JSON.stringify(records))
  check('非帧垃圾尾仍保留完整前缀', JSON.stringify(parseRecords(decodeSessionLog(Buffer.concat([multiFrame, Buffer.from('BAD')])))) === JSON.stringify(records))

  const damaged = zlib.zstdCompressSync(Buffer.from('{"type":"tool/call","data":{"name":"corrupt-must-not-count"}}\n'), { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } })
  damaged[damaged.length - 1] ^= 1
  check('checksum损坏末帧不影响此前完整记录', JSON.stringify(parseRecords(decodeSessionLog(Buffer.concat([multiFrame, damaged])))) === JSON.stringify(records))
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
  mkdirSync(dir, { recursive: true })
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

  const homeV4 = mkdtempSync(join(tmpdir(), 'dsh-trace-v4-'))
  const dirV4 = join(homeV4, 'sessions', '--project--', 'session-v4only')
  mkdirSync(dirV4, { recursive: true })
  writeFileSync(join(dirV4, 'session.v4.jsonl.zstd'), multiFrame)
  const summaryV4 = execFileSync(process.execPath, ['tools/session-trace.mjs', '--home', homeV4, '--summary'], { encoding: 'utf8' })
  check('只有 v4 日志时 CLI 仍能汇总', summaryV4.includes('custom_prompt(append)'), summaryV4.slice(0, 240))
  rmSync(homeV4, { recursive: true, force: true })
}

console.log()
console.log('=== 6. 把"模型只调了一次"变成检查：--expect / --compare / --grep / --denied ===')
{
  const homeA = mkdtempSync(join(tmpdir(), 'dsh-traceA-'))
  const homeB = mkdtempSync(join(tmpdir(), 'dsh-traceB-'))
  const writeHome = (home, list) => {
    const dir = join(home, 'sessions', '--p--', 'session-x')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v3.jsonl.zstd'), Buffer.concat(list.map(frameOf)))
  }
  // A：read + append（append 被拒）；B：只 read —— 用来验对比与筛选。
  writeHome(homeA, records)
  writeHome(homeB, records.slice(0, 3))

  const run = (args, expectFail = false) => {
    try {
      return { out: execFileSync(process.execPath, ['tools/session-trace.mjs', ...args], { encoding: 'utf8' }), status: 0 }
    } catch (error) {
      if (expectFail !== true) throw error
      return { out: String(error.stdout ?? '') + String(error.stderr ?? ''), status: error.status }
    }
  }

  const pass = run(['--home', homeA, '--expect', 'custom_prompt(read)=1', '--expect', 'custom_prompt(append)=1'])
  check('--expect 全部成立 → 退出码 0 且报 ✓', pass.status === 0 && pass.out.includes('✓'), pass.out.slice(-80))
  const fail = run(['--home', homeA, '--expect', 'custom_prompt(append)=2'], true)
  check('--expect 不成立 → 退出码 1 且指出期望与实际', fail.status === 1 && /期望 2，实际 1/.test(fail.out), fail.out.slice(-120))
  const absent = run(['--home', homeA, '--expect', 'custom_prompt(write)=1'], true)
  check('从未出现的调用按 0 计（不是"找不到就跳过"）', absent.status === 1 && /实际 0/.test(absent.out), absent.out.slice(-100))
  const malformed = run(['--home', homeA, '--expect', 'nonsense'], true)
  check('--expect 写法错误会被指出', malformed.status === 1 && /写法/.test(malformed.out), malformed.out.slice(-100))

  const compared = run(['--compare', homeA, homeB])
  check('--compare 给出两边总数与差值', /A .*3 次调用/.test(compared.out) && /B .*1 次调用/.test(compared.out) && /Δ 总调用数：-2/.test(compared.out), compared.out.slice(0, 200))
  // 排序是「按 |Δ| 降序，其次按名字」：append 与 bash 都是 -1，read 是 0 → read 必须排在两者之后。
  check('--compare 按差值排序（Δ=0 的排在后面）', compared.out.indexOf('custom_prompt(read)') > compared.out.indexOf('bash'), compared.out.slice(0, 400))
  const comparedJson = JSON.parse(run(['--compare', homeA, homeB, '--json']).out)
  check('--compare --json 可程序消费', comparedJson.a.callCount === 3 && comparedJson.b.callCount === 1)

  const grepped = run(['--home', homeA, '--grep', 'append'])
  // 汇总行本来就会列出全部工具，所以看的是**调用行**里有没有 read 的那次。
  check('--grep 只保留命中的调用行', grepped.out.includes('"action":"append"') && grepped.out.includes('"action":"read"') === false, grepped.out.slice(-200))
  const denied = run(['--home', homeA, '--denied'])
  check('--denied 只列被拒的那次', denied.out.includes('append') && /共 3 次工具调用/.test(denied.out), denied.out.slice(-200))

  const broken = run(['--compare', homeA, join(homeA, 'nope')], true)
  check('--compare 的来源读不到 → 退出码 2（不是静默成功）', broken.status === 2, String(broken.status))
  rmSync(homeA, { recursive: true, force: true })
  rmSync(homeB, { recursive: true, force: true })
}

console.log()
console.log('=== 6.1 --compare 来源是home或日志文件，不从目录名猜会话 ===')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-trace-sources-'))
  try {
    const parentHome = join(root, 'session-parent', 'home')
    const namedHome = join(root, 'session-old')
    const writeSession = (home, id, count, modifiedSeconds) => {
      const dir = join(home, 'sessions', '--synthetic--', id)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'session.v4.jsonl.zstd')
      const list = [{ type: 'session', id }, ...Array.from({ length: count }, (_, index) => ({ type: 'tool/call', seq: index + 1, data: { name: 'custom_prompt', arguments: { action: 'read' } } }))]
      writeFileSync(file, Buffer.concat(list.map(frameOf)))
      utimesSync(file, modifiedSeconds, modifiedSeconds)
      return file
    }
    const oldFile = writeSession(namedHome, 'session-old', 1, 100)
    const newFile = writeSession(namedHome, 'session-new', 2, 200)
    writeSession(parentHome, 'session-old', 1, 100)
    writeSession(parentHome, 'session-new', 2, 200)
    const json = (args) => JSON.parse(execFileSync(process.execPath, ['tools/session-trace.mjs', ...args, '--json'], { encoding: 'utf8' }))

    const parent = json(['--compare', parentHome, parentHome])
    check('父目录含session-不影响home选择最新日志', parent.a.callCount === 2 && parent.b.callCount === 2)
    const forwardHome = namedHome.replaceAll('\\', '/')
    const named = json(['--compare', forwardHome, forwardHome])
    check('home名恰为session-old也不能静默选旧会话', named.a.callCount === 2 && named.b.callCount === 2)
    const files = json(['--compare', oldFile, newFile])
    check('--compare显式文件来源仍按各自文件读取', files.a.callCount === 1 && files.b.callCount === 2)
    check('--home默认仍选最新日志', json(['--home', namedHome]).callCount === 2)
    const selected = json(['--home', namedHome, '--session', 'session-o'])
    check('显式--session前缀筛选仍可选择旧会话', selected.callCount === 1 && selected.sessionId === 'session-old')
  } finally {
    if (!root.startsWith(join(tmpdir(), 'dsh-trace-sources-'))) throw new Error('Refusing cleanup outside the synthetic source fixture')
    rmSync(root, { recursive: true, force: true })
  }
}

console.log()
console.log('=== 7. 未知位置参数必须报错（不能静默忽略）===')
{
  const { status, out } = (() => {
    try {
      return { status: 0, out: execFileSync(process.execPath, ['tools/session-trace.mjs', '--summary', '/tmp'], { encoding: 'utf8' }) }
    } catch (error) {
      return { status: error.status, out: String(error.stdout ?? '') + String(error.stderr ?? '') }
    }
  })()
  check('传路径当参数 → 退出码 2', status === 2, String(status))
  check('并且说明不认识的参数是什么', /不认识的参数/.test(out) && out.includes('/tmp'), out.slice(0, 120))
}

console.log()
console.log(`结果: ${String(passed)} 通过, ${String(failed)} 失败`)
process.exit(failed === 0 ? 0 : 1)
