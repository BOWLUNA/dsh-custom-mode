/**
 * Fill `agent-presets.default` only when the user has not set it.
 *
 * The host hard-codes `standard` in the profile composition. The same key in
 * `$DSH_HOME/settings.yaml` is the runtime override. Writing it on every boot
 * would undo a user who chose Standard on purpose, so an existing `default`
 * is left untouched — including `default: standard`.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from './atomic.mjs'

/**
 * @param {string} home - `DSH_HOME`.
 * @param {string} presetId - assistant directory id, normally `custom`.
 * @returns {{ wrote: boolean, reason: string }}
 */
export function ensureUnsetDefaultPreset(home, presetId) {
  if (typeof home !== 'string' || home === '' || typeof presetId !== 'string' || !/^[a-z0-9-]+$/.test(presetId)) {
    return { wrote: false, reason: 'bad-args' }
  }
  if (!existsSync(join(home, '.agent-presets', presetId, 'prompt.md'))) {
    return { wrote: false, reason: 'no-preset' }
  }
  const file = join(home, 'settings.yaml')
  if (!existsSync(file)) {
    mkdirSync(home, { recursive: true })
    writeAtomic(file, 'agent-presets:\n  default: ' + presetId + '\n')
    return { wrote: true, reason: 'created' }
  }
  const text = readFileSync(file, 'utf8')
  if (text.includes('\0')) return { wrote: false, reason: 'binary' }
  const lines = text.split('\n')
  let section = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    if (/^agent-presets\s*:/.test(line)) {
      if (/default\s*:/.test(line)) return { wrote: false, reason: 'inline' }
      section = i
      break
    }
  }
  if (section === -1) {
    const suffix = (text.endsWith('\n') || text === '' ? '' : '\n') + 'agent-presets:\n  default: ' + presetId + '\n'
    writeAtomic(file, text + suffix)
    return { wrote: true, reason: 'appended' }
  }
  for (let i = section + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    if (/^\S/.test(line)) break
    if (/^\s+default\s*:/.test(line)) return { wrote: false, reason: 'present' }
  }
  lines.splice(section + 1, 0, '  default: ' + presetId)
  const next = lines.join('\n')
  writeAtomic(file, next.endsWith('\n') ? next : next + '\n')
  return { wrote: true, reason: 'inserted' }
}
