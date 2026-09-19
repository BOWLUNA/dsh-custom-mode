/**
 * 提示词改动日志：**只追加**、单写者、可审计。
 *
 * 为什么需要它：一个助手的 `prompt.md` 有三条改动路径 —— 设置页保存、会话内的 `custom_prompt`
 * 工具、以及手工编辑文件。后两条对用户是**不可见**的：提示词变了，页面只会显示"当前文本"，
 * 没有任何地方能看出"谁在什么时候改的、上一版是什么"。这个模块把每一次变化留成一行，于是
 * "恢复出厂"之外还能"回到上一版"，会话内被改动也能被看见。
 *
 * 设计取舍（都写在这里，因为它们看起来可以更简单）：
 *
 * 1. **单写者**：只有宿主半写这个文件。会话内的工具**不**直接写日志 —— 否则文件格式就得在
 *    preset 副本里再实现一遍（那些文件是独立分发的）。改为在读状态时对比"当前文本 vs 日志末条"，
 *    不一致就补记一条 `external`：工具改的、手工改的、甚至别的机器同步过来的，都会以同一种方式
 *    留痕。代价是同一段文本的**中间若干次**改动看不到（我们只能看到"离开时的样子"），这一点
 *    在文档里写明，不假装是版本控制。
 * 2. **只追加 + 上限**：追加而不是覆盖，坏一行不牵连其余（解析时跳过坏行）。超过上限就整文件
 *    重写成最后 N 条 —— 这是唯一的"重写"，且只发生在追加之后，用原子写完成。
 * 3. **相同内容不重复记**：保存两次而文本没变，不该产生两条历史。
 * 4. **版本键是自增序号，不是时间戳**：同一毫秒内落两次记录完全可能（实测：连续两次保存），
 *    时间戳做键会让"取回某一版"取到隔壁那条。时间戳只用于显示。
 *
 * 这个方向借鉴了同生态里 whale-persona 的"收件箱"设计（只追加、坏行不牵连、状态显式），
 * 但这里记录的是**已发生的事实**而不是待确认的提议 —— 我们的场景是"改了什么要看得见、回得去"，
 * 不需要它的确认闸门。
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { writeAtomic } from './atomic.mjs'
import { join } from 'node:path'


/** 每个助手目录下的日志文件名。 */
export const HISTORY_NAME = 'prompt-history.jsonl'

/** 保留的最大版本数。超出后整文件重写为最后这么多条。 */
export const HISTORY_MAX = 30

/** 改动来源。`settings` 是设置页保存；`external` 是日志末条之后发生的任何改动。 */
export const HISTORY_SOURCE = { settings: 'settings', external: 'external' }

/** @param {string} directory - one assistant's preset directory. */
export function historyFile(directory) {
  return join(directory, HISTORY_NAME)
}

/**
 * Parse the log, skipping unreadable lines.
 *
 * A line that is not valid JSON, or lacks a text, is ignored rather than throwing: this file is
 * written across process restarts and may be edited by hand, and one bad line must not cost the
 * user every version (the same reason the inbox design in this ecosystem replays line by line).
 *
 * @returns {Array<{ at: string, by: string, text: string }>} oldest first.
 */
export function readEntries(directory) {
  const file = historyFile(directory)
  if (!existsSync(file)) return []
  const entries = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object') continue
      if (typeof parsed.text !== 'string') continue
      entries.push({
        // 老日志没有 n 时按行序补一个，于是"序号"这个概念对任何日志都成立。
        n: Number.isInteger(parsed.n) && parsed.n > 0 ? parsed.n : entries.length + 1,
        at: typeof parsed.at === 'string' ? parsed.at : '',
        by: typeof parsed.by === 'string' ? parsed.by : HISTORY_SOURCE.external,
        text: parsed.text,
      })
    } catch {
      continue
    }
  }
  return entries
}

/**
 * Append one revision, unless it repeats the newest one.
 *
 * @param {string} directory - one assistant's preset directory.
 * @param {string} text - the prompt content **after** the change.
 * @param {string} by - {@link HISTORY_SOURCE}.
 * @returns {{ recorded: boolean, at: string, n: number }} whether a line was appended.
 */
export function recordPrompt(directory, text, by = HISTORY_SOURCE.settings) {
  if (typeof text !== 'string') return { recorded: false, at: '' }
  const entries = readEntries(directory)
  const newest = entries[entries.length - 1]
  if (newest !== undefined && newest.text === text) return { recorded: false, at: newest.at }

  const at = new Date().toISOString()
  const n = entries.length === 0 ? 1 : entries[entries.length - 1].n + 1
  // `bytes` 是给人看的体积，所以按 **UTF-8 字节**计（原先用 text.length = UTF-16 码元，
  // CJK 内容下显示值只有真实字节的约 1/3，而界面标注是 "B"）。
  const lines = entries.slice(-(HISTORY_MAX - 1)).map((entry) =>
    JSON.stringify({ n: entry.n, at: entry.at, by: entry.by, bytes: Buffer.byteLength(entry.text, 'utf8'), text: entry.text }),
  )
  lines.push(JSON.stringify({ n, at, by, bytes: Buffer.byteLength(text, 'utf8'), text }))

  // 唯一的整文件重写：顺手把上限外的旧条目丢掉，用原子写落盘（读取器不会看到写了一半的文件）。
  const file = historyFile(directory)
  // 与宿主半同一条纪律：随机临时名（消除 tmp-vs-tmp 碰撞）+ 重试（Windows 上目标被并发 rename
  // 持有时会短暂 EPERM）+ 失败清理。
  // 与宿主半共用同一份实现（editor/atomic.mjs）：这里原先自己留了一份重试与清理，两份会各自漂移
  // —— 外部审阅点名了这一点。预设侧（prompt-tool.mjs）仍保留自己的副本，因为那个文件独立分发、不能 import 宿主半。
  writeAtomic(file, lines.join('\n') + '\n')
  return { recorded: true, at, n }
}

/**
 * The log as the page needs it: newest first, **without** the texts.
 *
 * Text is fetched per revision on demand (`readVersion`) — a page that ships 30 prompts on every
 * load would be slower than the thing it is documenting.
 *
 * @returns {Array<{ at: string, by: string, bytes: number, preview: string }>}
 */
export function listHistory(directory, limit = HISTORY_MAX) {
  const entries = readEntries(directory)
  const out = []
  for (const entry of entries.slice(-limit).reverse()) {
    const firstLine = entry.text.split('\n').find((line) => line.trim() !== '') ?? ''
    out.push({
      n: entry.n,
      at: entry.at,
      by: entry.by,
      bytes: Buffer.byteLength(entry.text, 'utf8'),
      preview: firstLine.trim().slice(0, 80),
    })
  }
  return out
}

/**
 * One revision's full text, by its sequence number.
 *
 * The key is `n`, not `at`: two revisions can share a timestamp (measured — two records inside the
 * same millisecond), and keying on it silently returns the neighbour.
 *
 * @param {number|string} n - the revision number shown in {@link listHistory}.
 * @returns {string|null}
 */
export function readVersion(directory, n) {
  const wanted = typeof n === 'string' ? Number(n) : n
  if (!Number.isInteger(wanted)) return null
  for (const entry of readEntries(directory)) {
    if (entry.n === wanted) return entry.text
  }
  return null
}

/**
 * Record `text` as an `external` revision when it is not what the log already ends with.
 *
 * This is how changes made outside the settings page become visible: the page asks for state, and
 * the host notices that what is on disk is not what it last recorded.
 *
 * @returns {boolean} whether something was recorded.
 */
export function recordExternalChange(directory, text) {
  return recordPrompt(directory, text, HISTORY_SOURCE.external).recorded
}
