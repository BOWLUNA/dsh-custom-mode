/**
 * The assistant registry: many custom modes, one settings page.
 *
 * The feature started as a SINGLE custom preset (`$DSH_HOME/.agent-presets/custom`).
 * This module generalises it to N assistants that live side by side in the same
 * user preset root, which is what the harness already supports: `dsh-agent-presets`
 * scans every directory under the writable root and re-reads the roots on each
 * roster call, so a directory authored while the process runs is selectable in the
 * next session without a restart.
 *
 * What makes a directory an ASSISTANT of this feature is deliberately narrow:
 *
 *   - it carries `prompt.md` (the editable identity), AND
 *   - it carries `prompt-reader.mjs`, or its composition still names
 *     `./prompt-reader.mjs` — the reader that re-reads that file every step.
 *
 * A hand-authored preset that merely has a `prompt.md` is NOT claimed: the page
 * regenerates a composition from a base mode, and doing that to somebody's
 * hand-written composition would destroy it. The second half of the predicate is
 * what keeps a preset repairable after its reader module is deleted by accident.
 *
 * Everything here is a pure function of (roster rows | directory tree) plus the
 * packaged template. The host half owns the roster and the platform's authoring
 * calls (`agentPresets.copy/remove`); this module owns naming, discovery and the
 * file work, so it can be tested without a running harness.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome, PRESET_DIR } from './paths.mjs'
import { readPresetMeta, writePresetMeta } from './meta.mjs'
import { writeAtomic } from './atomic.mjs'
import { seedPreset, seedPresetWithLog } from './seed.mjs'

/**
 * Preset ids a directory may use, mirrored from
 * `@deepseek-ai/dsh-agent-presets`'s `PRESET_ID`.
 *
 * The id becomes a path segment, so this is a containment boundary: `..`, a
 * separator or an absolute-looking name would place a preset outside the root the
 * deployment authorised. A copy is refused by the harness for the same reason, so
 * an id this module hands out must pass the same test.
 */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** The id of the legacy single-mode install, and the first id this feature hands out. */
export const LEGACY_ID = 'custom'

/** The composition file every preset directory is discovered by. */
export const COMPOSITION_FILE = 'agent.cordis.yml'

/**
 * Marker file recording that the one-time seed already happened.
 *
 * It is a FILE directly under the preset root, so discovery's `child.isDirectory()`
 * gate skips it, and its leading dot keeps it out of `PRESET_ID` anyway. Without it,
 * a user who deletes every assistant would find `custom` recreated on the next
 * process start — the seed below is idempotent, not clairvoyant.
 */
export const SEED_MARKER_FILE = '.custom-mode.json'

/** Absolute path of the seed marker inside one preset root. */
export function seedMarkerPath(root) {
  return join(root, SEED_MARKER_FILE)
}

/** Whether the one-time seed already ran for this preset root. */
export function isSeeded(root) {
  try {
    return existsSync(seedMarkerPath(root))
  } catch {
    return false
  }
}

/**
 * Record that the one-time seed ran.
 *
 * Best-effort: an unwritable root must not keep the harness from booting, and the
 * cost of a failed write is only that the next activation repeats an idempotent
 * seed. Never throws.
 *
 * @param {string} root - the preset root.
 * @returns {boolean} whether the marker is now on disk.
 */
export function markSeeded(root) {
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(seedMarkerPath(root), JSON.stringify({ seededAt: new Date().toISOString() }) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

/** Whether `dir` is a directory this feature owns (see the module comment). */
export function isManagedDir(dir) {
  if (typeof dir !== 'string' || dir === '') return false
  if (!existsSync(join(dir, 'prompt.md'))) return false
  if (existsSync(join(dir, 'prompt-reader.mjs'))) return true
  // The reader is gone but the composition still injects it: still ours, and the
  // repair pass below can put the module back.
  try {
    return readFileSync(join(dir, COMPOSITION_FILE), 'utf8').includes("'./prompt-reader.mjs'")
  } catch {
    return false
  }
}

/**
 * Every managed assistant directory under one preset root, ordered by id.
 *
 * A missing root is not an error: it is the state of a machine that has not
 * installed anything yet, and the seed below is what fills it.
 *
 * @param {string} root - the writable preset root.
 * @returns {string[]} absolute directories.
 */
export function scanManagedDirs(root) {
  let children
  try {
    children = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const child of children) {
    if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue
    const dir = join(root, child.name)
    if (isManagedDir(dir)) found.push(dir)
  }
  return found.sort()
}

/** `<root>/<id>/agent.cordis.yml` → `<root>`. */
export function rootOfPresetPath(presetPath) {
  return dirname(dirname(presetPath))
}

/**
 * The writable preset root, resolved from the roster.
 *
 * A user-trust row carries the absolute path of its composition, so its grandparent
 * IS the root the deployment authorised — independent of install layout, and
 * correct even when a profile points `roots` somewhere else. The fallback is the
 * harness-home root `dsh-agent-presets` itself defaults to, and it only applies to
 * a machine with no user preset at all (so nothing can be learned from the roster).
 *
 * @param {Array<{trust?: string, path?: string}>} rows - roster rows.
 * @param {string} [fallback] - root to use when the roster carries no user preset.
 * @returns {string} absolute preset root.
 */
export function userPresetRoot(rows, fallback = dirname(PRESET_DIR)) {
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row === null || typeof row !== 'object') continue
    if (row.trust !== 'user') continue
    if (typeof row.path !== 'string' || row.path === '') continue
    return rootOfPresetPath(row.path)
  }
  return fallback === undefined || fallback === '' ? join(dshHome(), '.agent-presets') : fallback
}

/**
 * The assistants a roster describes, in roster order (which is id order for
 * authored presets, since none of them carries a shipped `order`).
 *
 * @param {Array<{id?: string, trust?: string, path?: string, name?: string, description?: string, broken?: string}>} rows
 * @returns {Array<{id: string, name: string, description: string, broken?: string}>}
 */
export function assistantsFromRoster(rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row === null || typeof row !== 'object') continue
    if (row.trust !== 'user') continue
    if (typeof row.id !== 'string' || row.id === '') continue
    if (typeof row.path !== 'string' || row.path === '') continue
    if (!isManagedDir(dirname(row.path))) continue
    out.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : '',
      description: typeof row.description === 'string' ? row.description : '',
      ...typeof row.broken === 'string' && row.broken !== '' ? { broken: row.broken } : {},
    })
  }
  return out
}

/**
 * Absolute directory of one assistant, or undefined when the roster does not
 * describe a managed one under that id.
 *
 * Resolution goes through the roster rather than string-joining the root, so a
 * request for an id the deployment never discovered cannot address a directory.
 *
 * @param {Array<object>} rows - roster rows.
 * @param {string} id - the assistant id.
 * @returns {string|undefined} the directory, or undefined.
 */
export function assistantDir(rows, id) {
  if (typeof id !== 'string' || id === '') return undefined
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row === null || typeof row !== 'object') continue
    if (row.id !== id) continue
    if (row.trust !== 'user') return undefined
    if (typeof row.path !== 'string' || row.path === '') return undefined
    const dir = dirname(row.path)
    return isManagedDir(dir) ? dir : undefined
  }
  return undefined
}

/**
 * Choose a free preset id for a new assistant.
 *
 * A name that is already a legal id (an English word, say) becomes the id, which
 * keeps the directory readable; a repeat takes `-2`, `-3`, … on that same stem.
 * Anything else — most Chinese names slug to nothing usable — falls back to
 * `custom`, then `custom-2`, `custom-3`, …
 *
 * @param {string} name - the assistant's display name.
 * @param {Set<string>} taken - ids already used by any preset (shipped or authored).
 * @returns {string} a free id.
 */
export function allocateId(name, taken) {
  const used = taken instanceof Set ? taken : new Set(taken ?? [])
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (PRESET_ID.test(slug)) {
    if (!used.has(slug)) return slug
    for (let n = 2; ; n += 1) {
      const id = `${slug}-${n}`
      if (!used.has(id)) return id
    }
  }
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? LEGACY_ID : `${LEGACY_ID}-${n}`
    if (!used.has(id)) return id
  }
}

/**
 * Create one assistant directory from the packaged template.
 *
 * Seeding from the package rather than copying an existing assistant is what makes
 * "new assistant" mean NEW: a copy would inherit whatever prompt, row switches and
 * extra files the source had accumulated. It also keeps creation working when the
 * user has deleted every other assistant.
 *
 * The composition text is passed in by the caller (`renderComposition`) so this
 * module stays free of the base-mode machinery.
 *
 * @param {{root: string, id: string, composition: string, templateDir?: string}} input
 * @returns {{ok: true, id: string, dir: string} | {ok: false, error: string}}
 */
export function createAssistantDir({ root, id, composition, templateDir }) {
  if (!PRESET_ID.test(String(id ?? ''))) {
    return { ok: false, error: `助手标识不合法：${String(id)}（只能是 a-z0-9 与连字符）` }
  }
  const dir = join(root, id)
  if (existsSync(dir)) return { ok: false, error: `目录已存在：${dir}` }

  const seeded = seedPreset(dir, templateDir)
  if (seeded.errors.length > 0) {
    return { ok: false, error: '复制模式模板失败：' + seeded.errors.join('；') }
  }
  try {
    writeFileSync(join(dir, COMPOSITION_FILE), composition, 'utf8')
  } catch (error) {
    return { ok: false, error: '写入组成文件失败：' + describe(error) }
  }
  return { ok: true, id, dir }
}

/**
 * What one activation should do about the preset tree.
 *
 * Two jobs, in this order:
 *
 *  1. **Repair.** Fill in files missing from any managed assistant (never
 *     overwriting one), because a composition row naming a module that no longer
 *     exists makes the whole preset read as BROKEN in discovery — it would vanish
 *     from every picker with no way back.
 *  2. **First run.** Create the legacy `custom` assistant when this feature has
 *     never run here. The marker is what stops a deleted assistant from coming back:
 *     an install that already has assistants is adopted silently, and an install
 *     that deliberately deleted all of them stays empty.
 *
 * @param {{root: string, templateDir?: string, log?: Function, info?: Function}} input
 * @returns {{created: boolean, repaired: number, adopted: boolean}}
 */
export function seedOnActivation({ root, templateDir, composition, log = console.error, info = console.log }) {
  const existing = scanManagedDirs(root)
  let repaired = 0
  for (const dir of existing) {
    // Fill-only, exactly like the original single-preset behaviour.
    const result = seedPreset(dir, templateDir, { composition })
    if (result.created.length > 0) {
      repaired += 1
      info(`custom-mode: 已补全 ${dir} 缺失的模板文件（${result.created.join(', ')}）`)
    }
    for (const error of result.errors) log(`custom-mode: 补全 ${dir} 失败 —— ${error}`)
  }

  if (isSeeded(root)) return { created: false, repaired, adopted: false }
  if (existing.length > 0) {
    markSeeded(root)
    return { created: false, repaired, adopted: true }
  }

  const created = seedPresetWithLog(join(root, LEGACY_ID), log, info, templateDir, { composition })
  markSeeded(root)
  return { created: created.created.length > 0, repaired, adopted: false }
}

/**
 * Move one assistant one slot up or down in the picker order.
 *
 * The order lives in each preset's own `preset.yml` as `order`, which is the roster's declared
 * sort key (`dsh-agent-presets` sorts by `order ?? Infinity`, then id) — the same mechanism the
 * shipped presets use. That makes the order a property of the preset rather than of this plugin,
 * so it survives a restart, is visible in the file, and needs no state file to drift.
 *
 * Writing positions `1..N` for EVERY managed assistant is deliberate: assistants authored before
 * anyone reordered have no `order` at all, and pinning all of them makes the result independent
 * of the id-sort that would otherwise shuffle them back.
 *
 * @param {Array<object>} rows - the current roster (already in display order).
 * @param {{id?: string, direction?: string}} input - which assistant moves, and which way.
 * @param {Function} [write] - metadata writer (tests inject their own).
 * @returns {{ok: true, id: string, order: string[], note: string} | {ok: false, error: string}}
 */
export function reorderAssistant(rows, input, write = writePresetMeta) {
  const id = input !== null && typeof input === 'object' && typeof input.id === 'string' ? input.id : ''
  const direction = input !== null && typeof input === 'object' ? input.direction : undefined
  if (direction !== 'up' && direction !== 'down') {
    return { ok: false, code: 'badDirection', params: { direction: String(direction) }, error: '未知的排序方向：' + String(direction) }
  }
  const list = assistantsFromRoster(rows)
  const index = list.findIndex((item) => item.id === id)
  if (index === -1) return { ok: false, code: 'unknownAssistant', params: { id }, error: '找不到助手「' + id + '」。' }
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0) return { ok: false, code: 'alreadyFirst', params: { name: list[index].name || id }, error: '「' + (list[index].name || id) + '」已经在最前面。' }
  if (target >= list.length) return { ok: false, code: 'alreadyLast', params: { name: list[index].name || id }, error: '「' + (list[index].name || id) + '」已经在最后面。' }

  const next = [...list]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)

  // N 个 preset.yml 无法一次事务化：先记下原值，写失败就回滚已经写过的那些 —— 否则用户会得到一个
  // 只排了一半的顺序（审阅点名）。回滚失败只报告，不掩盖原始错误。
  const snapshot = []
  const written = []
  for (const item of next) {
    const directory = assistantDir(rows, item.id)
    if (directory === undefined) continue
    try {
      snapshot.push({ item, text: readFileSync(presetMetaPath(directory), 'utf8') })
    } catch {
      snapshot.push({ item, text: null })
    }
  }
  for (const [position, item] of next.entries()) {
    const directory = assistantDir(rows, item.id)
    if (directory === undefined) continue
    const result = write(item.name, item.description, directory, { order: position + 1 })
    if (result.ok !== true) {
      const failed = assistantDir(rows, item.id)
      for (const done of written) {
        if (done.text === null) continue
        try {
          writeAtomic(presetMetaPath(done.directory), done.text)
        } catch {
          /* 回滚失败不掩盖原始错误 */
        }
      }
      return {
        ...result,
        error: result.error + `（已回滚 ${String(written.length)} 个已写入的顺序；失败的目录：${String(failed)}）`,
      }
    }
    written.push({ directory, text: snapshot.find((entry) => entry.item.id === item.id)?.text ?? null })
  }
  return {
    ok: true,
    id,
    order: next.map((item) => item.id),
    code: 'reordered',
    note: '顺序已保存：新建会话时的模式选择器按这个顺序排列。',
  }
}

/** `error` as a readable string, without assuming it is an Error. */
function describe(error) {
  return String((error && error.message) || error)
}
