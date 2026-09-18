/**
 * The preset's display metadata: `preset.yml` next to the composition.
 *
 * This file is what every picker shows — the session's mode chooser and the
 * settings nav. `agent-presets` re-reads the preset roots on each roster read, so
 * a change here appears without a process restart; only a NEW session picks it up,
 * exactly like a composition change.
 *
 * The directory is a parameter because this feature manages SEVERAL assistants:
 * each one owns its own `preset.yml`, and one shared constant would make every save
 * rename the same assistant.
 *
 * Only two scalar keys are handled, so a full YAML parser is unnecessary. Writing
 * always emits double-quoted, escaped scalars: a user-supplied colon, leading
 * dash, or newline would otherwise restructure the document, and a malformed
 * `preset.yml` makes the mode vanish from the pickers.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { writeAtomic } from './atomic.mjs'
import { join } from 'node:path'
import { PRESET_DIR } from './paths.mjs'

/**
 * Absolute path of one preset directory's metadata file.
 *
 * @param {string} [directory] - the preset directory (defaults to the legacy `custom`).
 * @returns {string} absolute path.
 */
export function presetMetaPath(directory = PRESET_DIR) {
  return join(directory, 'preset.yml')
}

/** The legacy single-preset metadata path, kept for callers that address it directly. */
export const PRESET_META_PATH = presetMetaPath()

/** Strip one layer of matching quotes and undo backslash escaping. */
function unquote(value) {
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  if (!quoted) return value
  const inner = value.slice(1, -1)
  let out = ''
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      out += inner[i + 1]
      i += 1
      continue
    }
    out += inner[i]
  }
  return out
}

/**
 * Read one preset directory's display name and description.
 *
 * @param {string} [directory] - the preset directory (defaults to the legacy `custom`).
 * @returns {{name: string, description: string}} both empty when the file is absent.
 */
export function readPresetMeta(directory = PRESET_DIR) {
  let text = ''
  try {
    text = readFileSync(presetMetaPath(directory), 'utf8')
  } catch {
    return { name: '', description: '' }
  }
  /** Read one scalar key. */
  const read = (key) => {
    const lines = text.split('\n')
    for (const line of lines) {
      if (!line.startsWith(key + ':')) continue
      return unquote(line.slice(key.length + 1).trim())
    }
    return ''
  }
  // `order` is the roster's own sort key (`dsh-agent-presets` orders by
  // `order ?? Infinity`, then id), which is what makes it the right home for
  // "which assistant comes first".
  const rawOrder = Number(read('order'))
  const order = read('order') !== '' && Number.isFinite(rawOrder) ? rawOrder : undefined
  return { name: read('name'), description: read('description'), ...order === undefined ? {} : { order } }
}

/** Quote and flatten a value into a single-line YAML scalar. */
function yamlScalar(value) {
  const flat = String(value).replace(/\r?\n/g, ' ').trim()
  return '"' + flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/**
 * Write `preset.yml` with a display name and optional description.
 *
 * The name is required: an empty one would render the mode as its bare directory
 * id everywhere.
 *
 * @param {string} name - display name.
 * @param {string|undefined} description - optional description.
 * @param {string} [directory] - the preset directory (defaults to the legacy `custom`).
 * @param {{order?: number}} [options] - roster position. Omitted means "keep whatever is on
 *   disk": a rename must never reshuffle the pickers.
 * @returns {{ok: true, name: string} | {ok: false, error: string}} the outcome.
 */
export function writePresetMeta(name, description, directory = PRESET_DIR, options = {}) {
  const cleanName = typeof name === 'string' ? name.replace(/\r?\n/g, ' ').trim() : ''
  if (cleanName === '') return { ok: false, error: '模式名称不能为空。' }
  const lines = ['name: ' + yamlScalar(cleanName)]
  if (typeof description === 'string' && description.trim() !== '') {
    lines.push('description: ' + yamlScalar(description))
  }
  const requested = options !== null && typeof options === 'object' ? options.order : undefined
  const order =
    typeof requested === 'number' && Number.isFinite(requested) ? Math.trunc(requested) : readPresetMeta(directory).order
  if (order !== undefined) lines.push('order: ' + String(order))
  try {
    // **非原子写的最坏后果在这里**：preset.yml 写坏 = 这个模式从所有选择器里消失（见本文件头注释）。
    // 实测审阅指出这里原先用的是裸 writeFileSync，与设置页的纪律不一致；现在共用同一份实现。
    writeAtomic(presetMetaPath(directory), lines.join('\n') + '\n')
  } catch (error) {
    return { ok: false, error: '写入 preset.yml 失败：' + String((error && error.message) || error) }
  }
  return { ok: true, name: cleanName }
}
