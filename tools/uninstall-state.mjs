#!/usr/bin/env node
/** Verify the host's successful removal before bounded cleanup of its leftover package link. */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const [home, profile, name] = process.argv.slice(2)
if (!home || !/^[a-z0-9][a-z0-9_-]*$/.test(profile ?? '') || name !== 'dsh-custom-mode') throw new Error('Invalid uninstall target')
const profiles = join(resolve(home), 'profiles')
const readManifest = (directory) => {
  const file = join(directory, 'package.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}
const declared = (pkg) => ['dependencies', 'devDependencies', 'optionalDependencies'].some((key) => Object.hasOwn(pkg[key] ?? {}, name)) || (pkg.dsh?.profile?.bundles ?? []).includes(name)
if (declared(readManifest(join(profiles, profile)))) throw new Error('Host reported success but the plugin dependency or bundle remains; installation files were preserved')

function clean(directory) {
  const target = resolve(directory, name)
  if (relative(resolve(directory), target) !== name) throw new Error('Cleanup target escapes node_modules')
  let info
  try { info = lstatSync(target) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  // Check identity for real directories. A broken link is safe to unlink by its exact package path.
  if ((!info.isSymbolicLink() || existsSync(target)) && readManifest(target).name !== name) throw new Error('Leftover package identity cannot be verified; preserved: ' + target)
  if (info.isSymbolicLink()) unlinkSync(target) // Also unlinks Windows junctions; never walks their target.
  else {
    const rel = relative(realpathSync(directory), realpathSync(target))
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Real cleanup target escapes node_modules')
    rmSync(target, { recursive: true })
  }
  console.log('    已清理本包残留: ' + target)
}
clean(join(profiles, profile, 'node_modules'))
// Older hosts share node_modules. Another profile's live package must remain usable.
const sharedInUse = existsSync(profiles) && readdirSync(profiles, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== profile).some((entry) => declared(readManifest(join(profiles, entry.name))))
if (!sharedInUse) clean(join(profiles, 'node_modules'))
else console.log('    共享安装仍被其他 profile 引用，已保留。')
