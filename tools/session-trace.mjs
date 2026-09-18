#!/usr/bin/env node
/**
 * Session trace reader: print the **tool-call sequence** of one real session.
 *
 * Why this exists: this repository's rule is that a conclusion comes with the command and its raw output, and
 * measurements often take the shape of "which tool did the model call, and how many times". That is not
 * hypothetical — a CHANGELOG line claimed "one tool call" while the session transcript counted two, and the
 * mistake was only caught by opening the trajectory tab in a browser and reading it by hand. This makes that a
 * single command.
 *
 * **How a session log is stored**: `$DSH_HOME/sessions/<project>/<session-id>/session.v3.jsonl.zstd` — that is
 * **multi-frame** Zstandard (one frame per appended record). Node's one-shot decoder returns the *first* frame
 * and silently ignores the rest, which is why a naive read shows a single record; dsh's own reader sidesteps
 * this with a private stream trick plus a frame index, which is fragile across Node releases. This tool stays
 * on public API: scan for the frame magic and decode from every candidate offset. Real frames decode
 * individually, false magics inside compressed bytes fail to decode and are skipped. Measured on a 9.3 MB log
 * with 5,722 frames: all frames decoded, all 8,915 lines parsed as JSON, ~0.5 s.
 *
 * Usage:
 *   node tools/session-trace.mjs                        # latest session in $DSH_HOME
 *   node tools/session-trace.mjs --home /tmp/dsh-dev    # a throwaway home
 *   node tools/session-trace.mjs --session session-…    # a specific session id (prefix is enough)
 *   node tools/session-trace.mjs --summary              # counts only, no message or argument text
 *   node tools/session-trace.mjs --grep custom_prompt   # only calls whose name or arguments match
 *   node tools/session-trace.mjs --denied               # only calls the user (or policy) refused
 *   node tools/session-trace.mjs --json                 # machine-readable
 *
 * Turn a claim into a check — this is the point of the tool, not a side feature:
 *
 *   node tools/session-trace.mjs --home /tmp/before --expect custom_prompt(read)=1 \
 *        --expect custom_prompt(append)=1
 *
 * …exits non-zero when the tally does not match, so "the model needed one call" stops being a sentence in a
 * changelog and becomes something CI (or a reviewer) can re-run. `--compare` answers the before/after question
 * directly — give it two homes (each one's latest session) or two log paths:
 *
 *   node tools/session-trace.mjs --compare /tmp/before /tmp/after
 *
 * Exit codes: 0 on success, 1 when a `--expect` assertion fails, 2 when a source is missing or nothing could be
 * decoded (loud, never an empty success).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Zstandard frame magic: `28 B5 2F FD`. */
const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
/** Records longer than this are truncated in the human-readable output. */
const ARG_LIMIT = 160

/**
 * Decode a session log, frame by frame.
 *
 * A buffer without any frame magic is returned as UTF-8 text (the plaintext `.jsonl` variant), and a buffer
 * whose frames all fail to decode returns an empty string — callers must treat that as failure rather than as
 * "an empty session".
 *
 * @param {Buffer} buffer - raw file bytes.
 * @returns {string} concatenated record text, in file order.
 */
export function decodeSessionLog(buffer) {
  const starts = []
  for (let index = 0; index + FRAME_MAGIC.length <= buffer.length; index += 1) {
    if (buffer.compare(FRAME_MAGIC, 0, FRAME_MAGIC.length, index, index + FRAME_MAGIC.length) === 0) starts.push(index)
  }
  if (starts.length === 0) return buffer.toString('utf8')
  let text = ''
  for (const start of starts) {
    try {
      // Node stops at the frame boundary, so no end offset is needed; a false magic throws and is skipped.
      text += zstdDecompressSync(buffer.subarray(start)).toString('utf8')
    } catch {
      continue
    }
  }
  return text
}

/**
 * Parse the record text. Unreadable lines are skipped rather than aborting: the log is append-only and a torn
 * last frame is a normal crash artifact, not a reason to lose the whole trace.
 *
 * @param {string} text - decoded session log.
 * @returns {Array<object>} parsed records in order.
 */
export function parseRecords(text) {
  const records = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line)
      if (parsed !== null && typeof parsed === 'object') records.push(parsed)
    } catch {
      continue
    }
  }
  return records
}

/**
 * Tool arguments as an object, when they are one.
 *
 * **Measured on a real log**: a `tool/call` record stores `data.arguments` as a **JSON string**
 * (`"{\"action\": \"read\"}"`), not as an object — so a reader that only accepts objects silently loses the
 * `action` and reports `custom_prompt` instead of `custom_prompt(read)`. (The synthetic logs used in the tests
 * had objects, which is exactly how that difference survived them.) Plain strings that are not JSON are
 * returned as-is.
 */
function argsObject(args) {
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args)
      return parsed !== null && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  }
  return args !== null && typeof args === 'object' ? args : undefined
}

/** The action a tool call carries, from either the object or the JSON-string shape. */
function actionOf(args) {
  const object = argsObject(args)
  return object !== undefined && typeof object.action === 'string' ? object.action : ''
}

/**
 * Pair every `tool/call` with its `tool/result` and summarise the session.
 *
 * Results are matched by the call's `seq` through the result's `sourceEventSeqs` (falling back to "the next
 * result after this call"), and classified as `denied` when the recorded error says the user rejected it.
 *
 * @param {Array<object>} records - {@link parseRecords} output.
 * @returns {{ sessionId: string, calls: Array<object>, totals: Array<object>, callCount: number, recordCount: number }}
 */
export function summarize(records) {
  const header = records.find((record) => record.type === 'session')
  const results = new Map()
  const ordered = []
  for (const record of records) {
    if (record.type === 'tool/call') {
      ordered.push({ seq: record.seq, data: record.data })
    }
    if (record.type === 'tool/result') {
      const source = Array.isArray(record.sourceEventSeqs) ? record.sourceEventSeqs[0] : undefined
      results.set(source, record.data)
    }
  }

  const calls = []
  for (const entry of ordered) {
    const data = entry.data ?? {}
    const result = results.get(entry.seq)
    const text = result === undefined ? '' : JSON.stringify(result.message ?? result)
    const outcome = results.has(entry.seq) === false ? 'no-result' : /rejected|denied|not permitted|取消/i.test(text) ? 'denied' : 'ok'
    calls.push({
      turn: data.turn,
      step: data.step,
      name: String(data.name ?? ''),
      // 展示解析后的对象（可读）；解析不了就原样给出。
      args: argsObject(data.arguments) ?? data.arguments ?? null,
      action: actionOf(data.arguments),
      outcome,
    })
  }

  const counts = new Map()
  for (const call of calls) {
    const key = call.name + (call.action === '' ? '' : `(${call.action})`)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const totals = [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  return {
    sessionId: typeof header?.id === 'string' ? header.id : '',
    calls,
    totals,
    callCount: calls.length,
    recordCount: records.length,
  }
}

/** Session log files, newest first. */
function findLogs(home) {
  const root = join(home, 'sessions')
  const found = []
  let projects
  try {
    projects = readdirSync(root)
  } catch {
    return found
  }
  for (const project of projects) {
    const projectDir = join(root, project)
    let sessions
    try {
      sessions = readdirSync(projectDir)
    } catch {
      continue
    }
    for (const session of sessions) {
      const log = join(projectDir, session, 'session.v3.jsonl.zstd')
      try {
        found.push({ session, log, mtime: statSync(log).mtimeMs })
      } catch {
        continue
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}

function truncate(text) {
  return text.length <= ARG_LIMIT ? text : text.slice(0, ARG_LIMIT) + `…(+${String(text.length - ARG_LIMIT)})`
}

/** Resolve one source: a home directory (its latest session) or a path to a log file. */
function resolveSource(spec) {
  if (spec === undefined) return { ok: false, reason: '缺少来源' }
  try {
    if (statSync(spec).isFile()) return { ok: true, log: spec, label: spec }
  } catch {
    /* not a plain path; try it as a home below */
  }
  const wanted = spec.includes('session-') ? spec.split('/').pop() : undefined
  const logs = findLogs(spec)
  if (logs.length === 0) return { ok: false, reason: `${spec} 下没有会话日志` }
  const chosen = wanted === undefined ? logs[0] : logs.find((entry) => entry.session.includes(wanted))
  if (chosen === undefined) return { ok: false, reason: `${spec} 下没有匹配 ${String(wanted)} 的会话` }
  return { ok: true, log: chosen.log, label: `${spec}（${chosen.session}）` }
}

/** Read and summarise one source, or fail loudly. */
function readSource(source) {
  const text = decodeSessionLog(readFileSync(source.log))
  const records = parseRecords(text)
  if (records.length === 0) return { ok: false, reason: `日志解出来是空的：${source.log}` }
  return { ok: true, trace: summarize(records), source }
}

function printTally(trace) {
  for (const total of trace.totals) console.log(`  ${String(total.count).padStart(4)} × ${total.key}`)
}

/**
 * `--expect name(action)=N` — compare the tally and report every mismatch at once.
 *
 * @returns {string[]} human-readable mismatches (empty when everything matched).
 */
function checkExpectations(trace, expectations) {
  const seen = new Map(trace.totals.map((total) => [total.key, total.count]))
  const problems = []
  for (const expectation of expectations) {
    const match = /^(.+)=(\d+)$/.exec(expectation)
    if (match === null) {
      problems.push(`--expect 的写法应是 名字(action)=次数，收到的是 ${expectation}`)
      continue
    }
    const actual = seen.get(match[1]) ?? 0
    if (actual !== Number(match[2])) problems.push(`${match[1]}：期望 ${match[2]}，实际 ${String(actual)}`)
  }
  return problems
}

function main() {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const all = (name) => argv.flatMap((value, index) => (value === name ? [argv[index + 1]] : [])).filter((value) => value !== undefined)
  const home = flag('--home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const wanted = flag('--session')
  const summaryOnly = argv.includes('--summary')
  const asJson = argv.includes('--json')
  const deniedOnly = argv.includes('--denied')
  const grep = flag('--grep')
  // `--compare A B`：两个来源跟在同一个开关后面，所以取它后面的两个非开关参数。
  const compareIndex = argv.indexOf('--compare')
  const compare = compareIndex === -1
    ? []
    : argv.slice(compareIndex + 1, compareIndex + 3).filter((value) => value !== undefined && value.startsWith('--') === false)
  const expectations = all('--expect')

  // A/B：两边各读一次，给出计数与差值（回答"这次改动让调用变多了还是变少了"）。
  if (compare.length > 0) {
    if (compare.length !== 2) {
      console.error('--compare 需要两个来源：--compare <A> <B>（各自是 home 或日志路径）')
      process.exit(2)
    }
    const sides = compare.map((spec) => resolveSource(spec))
    const failed = sides.find((side) => side.ok !== true)
    if (failed !== undefined) {
      console.error(`读不到来源：${failed.reason}`)
      process.exit(2)
    }
    const reads = sides.map((side) => readSource(side))
    const broken = reads.find((read) => read.ok !== true)
    if (broken !== undefined) {
      console.error(broken.reason)
      process.exit(2)
    }
    const [a, b] = reads
    if (asJson) {
      console.log(JSON.stringify({ a: { label: a.source.label, totals: a.trace.totals, callCount: a.trace.callCount }, b: { label: b.source.label, totals: b.trace.totals, callCount: b.trace.callCount } }, null, 2))
      return
    }
    const keys = [...new Set([...a.trace.totals, ...b.trace.totals].map((total) => total.key))]
    const rows = keys.map((key) => {
      const left = a.trace.totals.find((total) => total.key === key)?.count ?? 0
      const right = b.trace.totals.find((total) => total.key === key)?.count ?? 0
      return { key, left, right, delta: right - left }
    }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.key.localeCompare(y.key))
    console.log(`A ${a.source.label}：${String(a.trace.callCount)} 次调用`)
    console.log(`B ${b.source.label}：${String(b.trace.callCount)} 次调用`)
    console.log(`Δ 总调用数：${b.trace.callCount - a.trace.callCount >= 0 ? '+' : ''}${String(b.trace.callCount - a.trace.callCount)}`)
    console.log('')
    console.log('  工具/动作                  A     B     Δ')
    for (const row of rows) {
      console.log(`  ${row.key.padEnd(24)} ${String(row.left).padStart(4)}  ${String(row.right).padStart(4)}  ${row.delta >= 0 ? '+' : ''}${String(row.delta)}`)
    }
    return
  }

  const logs = findLogs(home)
  if (logs.length === 0) {
    console.error(`没有在 ${join(home, 'sessions')} 下找到会话日志 —— 换个 --home，或先在那个 home 里跑一次会话。`)
    process.exit(2)
  }
  const chosen = wanted === undefined ? logs[0] : logs.find((entry) => entry.session.includes(wanted))
  if (chosen === undefined) {
    console.error(`找不到匹配 "${String(wanted)}" 的会话。可用的有：\n  ${logs.slice(0, 10).map((entry) => entry.session).join('\n  ')}`)
    process.exit(2)
  }

  const text = decodeSessionLog(readFileSync(chosen.log))
  const records = parseRecords(text)
  if (records.length === 0) {
    // 空集必须报错：解不出来和"这次会话没有记录"是两件事，静默返回空会让人以为会话是空的。
    console.error(`日志解出来是空的：${chosen.log}（${String(statSync(chosen.log).size)} 字节）`)
    process.exit(2)
  }
  const trace = summarize(records)

  // 断言模式：把"模型只调了一次"变成会失败的检查。
  if (expectations.length > 0) {
    const problems = checkExpectations(trace, expectations)
    if (asJson) {
      console.log(JSON.stringify({ sessionId: trace.sessionId, totals: trace.totals, expectations, problems }, null, 2))
    } else {
      console.log(`会话 ${trace.sessionId || chosen.session}：${String(trace.callCount)} 次工具调用`)
      printTally(trace)
      if (problems.length > 0) {
        console.error('')
        for (const problem of problems) console.error(`✗ ${problem}`)
      } else {
        console.log(`✓ ${String(expectations.length)} 条期望都成立`)
      }
    }
    process.exit(problems.length === 0 ? 0 : 1)
  }

  let calls = trace.calls
  if (grep !== undefined) {
    const needle = grep.toLowerCase()
    calls = calls.filter((call) => call.name.toLowerCase().includes(needle) || JSON.stringify(call.args ?? '').toLowerCase().includes(needle))
  }
  if (deniedOnly) calls = calls.filter((call) => call.outcome === 'denied')

  if (asJson) {
    console.log(JSON.stringify({ log: chosen.log, ...trace, calls }, null, 2))
    return
  }
  if (summaryOnly) {
    console.log(`会话 ${trace.sessionId || chosen.session}：${String(trace.recordCount)} 条记录，${String(trace.callCount)} 次工具调用`)
    printTally(trace)
    const denied = trace.calls.filter((call) => call.outcome === 'denied').length
    if (denied > 0) console.log(`  其中被拒绝：${String(denied)} 次`)
    return
  }

  console.log(`会话 ${trace.sessionId || chosen.session}（${String(trace.recordCount)} 条记录）`)
  console.log(`日志 ${chosen.log}`)
  if (calls.length !== trace.calls.length) console.log(`筛选后 ${String(calls.length)} / ${String(trace.calls.length)} 次调用`)
  console.log('')
  console.log('工具调用（按时间）：')
  for (const call of calls) {
    const marker = call.outcome === 'ok' ? '  ' : call.outcome === 'denied' ? '  ✗ ' : '  ? '
    const where = `t${String(call.turn ?? '?')}/s${String(call.step ?? '?')}`
    console.log(`${marker}${where}  ${call.name} ${truncate(JSON.stringify(call.args))}`)
  }
  console.log('')
  console.log(`汇总：共 ${String(trace.callCount)} 次工具调用`)
  printTally(trace)
}

main()
