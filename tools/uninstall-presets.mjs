#!/usr/bin/env node
/** Preserve raw directory names during listing/purge: never round-trip paths through shell lines. */
import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export function presetTarget(root, name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0]/.test(name)) throw new Error('Invalid preset directory name')
  const base = resolve(root), target = resolve(base, name)
  if (relative(base, target) !== name) throw new Error('Preset target escapes the explicit root')
  return target
}
const info = (file) => { try { return lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } }
const regular = (file) => info(file)?.isFile() === true
function within(root, target) {
  const rel = relative(realpathSync(root), realpathSync(target))
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
}
export function managePresets(root, { purge = false, explicitId } = {}) {
  const base = resolve(root), rootInfo = info(base)
  if (!rootInfo) return []
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Preset root is not an ordinary directory; preserved: ' + JSON.stringify(base))
  const selected = []
  for (const name of readdirSync(base)) {
    if (name.startsWith('.')) continue
    const target = presetTarget(base, name), stat = info(target)
    // Do not inspect a symlink's target, including for ownership discovery.
    if (!stat?.isDirectory() || stat.isSymbolicLink()) continue
    if (!within(base, target)) throw new Error('Preset directory resolves outside its explicit root')
    const managed = regular(join(target, 'prompt.md')) && (regular(join(target, 'prompt-reader.mjs')) || (regular(join(target, 'agent.cordis.yml')) && readFileSync(join(target, 'agent.cordis.yml'), 'utf8').includes("'./prompt-reader.mjs'")))
    if (managed) selected.push(target)
  }
  if (purge && explicitId !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(explicitId)) throw new Error('Invalid explicit preset id')
    const target = presetTarget(base, explicitId)
    if (info(target) && !selected.includes(target)) selected.push(target)
  }
  for (const target of selected) {
    if (purge) {
      const stat = info(target)
      if (!stat) continue
      if (stat.isSymbolicLink()) unlinkSync(target)
      else {
        if (!stat.isDirectory() || !within(base, target)) throw new Error('Purge target changed or escaped its root; preserved')
        rmSync(target, { recursive: true }) // Node unlinks nested symlinks; it does not follow them.
      }
    }
    console.log('    ' + JSON.stringify(purge ? target : join(target, 'prompt.md')))
  }
  if (purge) {
    const marker = presetTarget(base, '.custom-mode.json'), stat = info(marker)
    if (stat && (stat.isFile() || stat.isSymbolicLink())) unlinkSync(marker)
    else if (stat) throw new Error('Unexpected seeding marker type; preserved')
  }
  return selected
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, root, explicitId] = process.argv.slice(2)
  if (!root || !['list', 'purge'].includes(action)) throw new Error('Use uninstall-presets.mjs <list|purge> <explicit preset root> [explicit preset id]')
  const selected = managePresets(root, { purge: action === 'purge', explicitId })
  if (selected.length === 0) console.log('    （没有找到本工具创建的模式）')
}
