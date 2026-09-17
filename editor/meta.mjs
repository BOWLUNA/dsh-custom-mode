/**
 * The preset's display metadata: `preset.yml` next to the composition.
 *
 * This file is what every picker shows — the session's mode chooser and the
 * settings nav. `agent-presets` re-reads the preset roots on each roster read, so
 * a change here appears without a process restart; only a NEW session picks it up,
 * exactly like a composition change.
 *
 * Only two scalar keys are handled, so a full YAML parser is unnecessary. Writing
 * always emits double-quoted, escaped scalars: a user-supplied colon, leading
 * dash, or newline would otherwise restructure the document, and a malformed
 * `preset.yml` makes the mode vanish from the pickers.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRESET_DIR } from './paths.mjs'

/** Absolute path of the preset's metadata file. */
export const PRESET_META_PATH = join(PRESET_DIR, 'preset.yml')

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
 * Read the preset's display name and description.
 *
 * @returns {{name: string, description: string}} both empty when the file is absent.
 */
export function readPresetMeta() {
  let text = ''
  try {
    text = readFileSync(PRESET_META_PATH, 'utf8')
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
  return { name: read('name'), description: read('description') }
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
 * @returns {{ok: true, name: string} | {ok: false, error: string}} the outcome.
 */
export function writePresetMeta(name, description) {
  const cleanName = typeof name === 'string' ? name.replace(/\r?\n/g, ' ').trim() : ''
  if (cleanName === '') return { ok: false, error: '模式名称不能为空。' }
  const lines = ['name: ' + yamlScalar(cleanName)]
  if (typeof description === 'string' && description.trim() !== '') {
    lines.push('description: ' + yamlScalar(description))
  }
  try {
    writeFileSync(PRESET_META_PATH, lines.join('\n') + '\n', 'utf8')
  } catch (error) {
    return { ok: false, error: '写入 preset.yml 失败：' + String((error && error.message) || error) }
  }
  return { ok: true, name: cleanName }
}
