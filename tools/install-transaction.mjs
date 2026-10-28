#!/usr/bin/env node
/** Clone installer transaction. Local archives only; never restore package.json over pnpm state. */
import { closeSync, copyFileSync, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { restoreBackups } from '../atomic.mjs'

const [action, transaction, ...args] = process.argv.slice(2)
if (!action || !transaction) throw new Error('Use install-transaction.mjs <prepare|attempt|verify|seed|rollback|commit> <transaction> [...]')
const receipt = join(resolve(transaction), 'state.json')
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const identity = (info) => ({ dev: info.dev.toString(), ino: info.ino.toString() })
const sameFile = (path, wanted) => {
  if (!wanted || wanted.ino === '0' || !existsSync(path)) return false
  const actual = identity(statSync(path, { bigint: true }))
  return actual.dev === wanted.dev && actual.ino === wanted.ino
}
function save(state) {
  writeFileSync(receipt + '.tmp', JSON.stringify(state, null, 2) + '\n', 'utf8')
  renameSync(receipt + '.tmp', receipt)
}
function manifest(home, profile) {
  const path = join(home, 'profiles', profile, 'package.json')
  return existsSync(path) ? read(path) : {}
}
function declared(pkg, name) {
  return ['dependencies', 'devDependencies', 'optionalDependencies'].some((key) => pkg[key]?.[name] !== undefined)
    || (pkg.dsh?.profile?.bundles ?? []).includes(name)
}
function requireRecovered(directory) {
  const outcome = restoreBackups(directory)
  if (outcome.ok !== true || outcome.active === true) throw new Error(`Assistant recovery must finish before installation can fill user files: ${outcome.detail ?? outcome.code ?? 'writer is still active'}`)
}
function installed(home, profile, name) {
  for (const directory of [join(home, 'profiles', profile, 'node_modules', name), join(home, 'profiles', 'node_modules', name)]) {
    if (existsSync(join(directory, 'package.json')) && read(join(directory, 'package.json')).name === name) return directory
  }
}
function npmCli() {
  const choices = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  const found = choices.find((path) => path && existsSync(path))
  if (!found) throw new Error('Cannot resolve npm-cli.js. Install Node.js with npm before running install.sh.')
  return found
}
function pack(directory, destination, expected, runtime) {
  mkdirSync(destination, { recursive: true })
  const result = spawnSync(process.execPath, [npmCli(), 'pack', directory, '--ignore-scripts', '--offline', '--json', '--pack-destination', destination], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  writeFileSync(join(destination, 'pack.log'), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''), 'utf8')
  if (result.status !== 0) throw new Error(`Local npm pack failed; see ${join(destination, 'pack.log')}`)
  const item = JSON.parse(result.stdout)[0]
  if (item.name !== expected.name || item.version !== expected.version || item.filename !== `${expected.name}-${expected.version}.tgz`) throw new Error('Packed package identity differs from installed/source package')
  if (runtime) {
    const shipped = new Set(item.files.map((file) => file.path))
    for (const path of ['index.mjs', 'client.js', 'cordis.patch.yml', 'preset/prompt.md', 'preset/preset.yml', 'preset/prompt-reader.mjs', 'preset/prompt-tool.mjs']) {
      if (!shipped.has(path)) throw new Error(`Prepared package is missing ${path}`)
    }
  }
  const path = join(destination, item.filename)
  if (!existsSync(path)) throw new Error('npm did not create the expected local archive')
  // npm normalizes package.json in its tarball; version/name are checked separately.
  return { path, name: item.name, version: item.version, sha256: hash(path), contents: item.files.filter((file) => file.path !== 'package.json').map((file) => ({ path: file.path, sha256: hash(join(directory, file.path)) })) }
}
function restoreCode(state) {
  let okay = true
  for (const item of state.code) {
    if (!item.written) continue
    const path = join(state.preset, item.name)
    if (item.existed && existsSync(path) && hash(path) === item.beforeHash) continue
    if (!item.existed && !existsSync(path)) continue
    if (existsSync(path) && hash(path) !== item.writtenHash) { okay = false; continue }
    if (item.existed) copyFileSync(join(transaction, 'preset-code', item.name), path)
    else rmSync(path, { force: true })
  }
  // Keep the exclusive staging hardlink until commit: its live inode proves ownership,
  // even if receipt writing failed immediately after publication. Hash equality alone
  // must never authorize deleting a concurrently created user's file.
  for (const item of state.createdUserFiles) {
    const path = join(state.preset, item.name)
    const temporary = join(state.preset, item.temporary)
    if (item.skippedExisting) {
      if (sameFile(temporary, item.identity)) rmSync(temporary)
      continue
    }
    if (!sameFile(temporary, item.identity)) {
      if (existsSync(temporary) || sameFile(path, item.identity)) okay = false
      continue
    }
    if (sameFile(path, item.identity)) {
      // Do not check-then-unlink an editable pathname. Move it into an exclusively
      // created same-filesystem directory, then inspect the moved inode. A concurrent
      // replacement is preserved and restored exclusively; another new target wins.
      const recovery = mkdtempSync(join(state.preset, '.custom-install-recovered-'))
      item.recoveryPath = join(recovery, item.name)
      save(state)
      try { renameSync(path, item.recoveryPath) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (existsSync(item.recoveryPath) && !sameFile(item.recoveryPath, item.identity)) {
        try { linkSync(item.recoveryPath, path) }
        catch (error) { if (error.code === 'EEXIST') okay = false; else throw error }
      }
      // Retain the moved file even when it is ours: an open user descriptor may still
      // be writing it. The receipt gives its exact recovery path; no user bytes vanish.
    }
    rmSync(temporary) // Partial writes are ours too, but were never published.
  }
  return okay
}
function fillUserFile(state, name) {
  const path = join(state.preset, name)
  if (existsSync(path)) return
  const data = readFileSync(join(state.source, 'preset', name))
  const item = { name, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length, temporary: '.custom-install-user-' + randomUUID(), identity: null, published: false }
  state.createdUserFiles.push(item)
  save(state)
  const temporary = join(state.preset, item.temporary)
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    item.identity = identity(fstatSync(fd, { bigint: true }))
    if (item.identity.ino === '0') throw new Error('Filesystem cannot prove exclusive staged-file ownership')
    save(state) // Persist ownership before any content can be published.
    writeFileSync(fd, data)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  if (statSync(temporary).size !== item.bytes || hash(temporary) !== item.sha256) throw new Error('Staged user file was not completely written')
  try {
    linkSync(temporary, path) // Atomic exclusive publication; EEXIST never overwrites.
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    item.skippedExisting = true
    save(state) // If this fails, the live staging inode still lets rollback preserve the other file.
    if (sameFile(temporary, item.identity)) rmSync(temporary)
    return
  }
  item.published = true
  save(state)
}

if (action === 'prepare') {
  const [source, home, profile, id] = args
  if (!source || !home || !profile || !/^[a-z0-9][a-z0-9-]*$/.test(id ?? '')) throw new Error('Invalid installer arguments or preset id')
  mkdirSync(transaction, { recursive: true })
  if (existsSync(receipt)) throw new Error('Transaction already exists; use a new temporary directory')
  const pkg = read(join(source, 'package.json'))
  const before = manifest(home, profile)
  const state = { format: 1, startedAt: new Date().toISOString(), source: resolve(source), home: resolve(home), profile, name: pkg.name, version: pkg.version, preset: join(resolve(home), '.agent-presets', id), beforeDeclared: declared(before, pkg.name), beforeBundles: before.dsh?.profile?.bundles ?? [], attempted: false, committed: false, code: [], createdUserFiles: [] }
  requireRecovered(state.preset) // Never hide an interrupted legacy save by filling its missing prompt.
  state.prepared = pack(resolve(source), join(transaction, 'new'), pkg, true)
  const previous = installed(home, profile, pkg.name)
  if (state.beforeDeclared && !previous) throw new Error('Existing plugin is declared but its installed files cannot be archived. Repair that installation before upgrading; nothing was changed.')
  if (state.beforeDeclared) state.previous = pack(previous, join(transaction, 'previous'), read(join(previous, 'package.json')), false)
  mkdirSync(join(transaction, 'preset-code'), { recursive: true })
  for (const name of ['prompt-reader.mjs', 'prompt-tool.mjs']) {
    const path = join(state.preset, name)
    const existed = existsSync(path)
    state.code.push({ name, existed, beforeHash: existed ? hash(path) : undefined, written: false })
    if (existed) copyFileSync(path, join(transaction, 'preset-code', name))
  }
  save(state)
  console.log(`Prepared ${pkg.name}@${pkg.version}; rollback: ${state.previous ? state.previous.version : 'first installation (remove partial plugin)'}`)
} else {
  const state = read(receipt)
  if (action === 'attempt') {
    state.attempted = true
    save(state)
  } else if (action === 'needs-rollback') {
    process.exit(state.attempted && !state.committed ? 0 : 1)
  } else if (action === 'rollback-spec') {
    if (state.previous) console.log(state.previous.path)
  } else if (action === 'verify') {
    const current = installed(state.home, state.profile, state.name)
    const pkg = manifest(state.home, state.profile)
    if (!current || read(join(current, 'package.json')).version !== state.version || !declared(pkg, state.name) || !state.prepared.contents.every((file) => existsSync(join(current, file.path)) && hash(join(current, file.path)) === file.sha256)) throw new Error('Installed plugin identity/version/content was not verified; the source may have changed during installation')
  } else if (action === 'seed') {
    requireRecovered(state.preset) // A writer may have started since package preparation.
    mkdirSync(state.preset, { recursive: true })
    for (const name of ['preset.yml', 'prompt.md']) fillUserFile(state, name)
    for (const item of state.code) {
      const source = join(state.source, 'preset', item.name)
      item.written = true
      item.writtenHash = hash(source)
      save(state)
      const path = join(state.preset, item.name)
      const temporary = path + '.install-' + process.pid
      copyFileSync(source, temporary)
      renameSync(temporary, path)
    }
    console.log('Existing prompt, metadata and composition preserved; managed code refreshed.')
  } else if (action === 'rollback') {
    if (!state.attempted || state.committed) process.exit(0)
    // The caller executes dsh in Bash so Windows .cmd/shebang resolution stays native.
    const packageRestored = args[0] === '0'
    const current = installed(state.home, state.profile, state.name)
    const currentManifest = manifest(state.home, state.profile)
    const identityRestored = state.previous
      ? current && read(join(current, 'package.json')).version === state.previous.version && declared(currentManifest, state.name) === state.beforeDeclared && state.previous.contents.every((file) => existsSync(join(current, file.path)) && hash(join(current, file.path)) === file.sha256)
      : !declared(currentManifest, state.name)
    const bundlesRestored = state.beforeBundles.every((name) => (currentManifest.dsh?.profile?.bundles ?? []).includes(name))
    const codeRestored = restoreCode(state)
    state.rollback = { at: new Date().toISOString(), packageRestored, identityRestored: Boolean(identityRestored), bundlesRestored, codeRestored }
    save(state)
    if (!packageRestored || !identityRestored || !bundlesRestored || !codeRestored) throw new Error(`Rollback is incomplete. Keep ${transaction}; see rollback logs and reinstall the local previous archive through dsh before restarting.`)
    console.error(`Rollback verified${state.previous ? ` to ${state.previous.name}@${state.previous.version}` : ': partial first installation removed'}. Evidence: ${transaction}`)
    for (const item of state.createdUserFiles) if (item.recoveryPath && existsSync(item.recoveryPath)) console.error('New file retained for recovery: ' + item.recoveryPath)
  } else if (action === 'commit') {
    state.committed = true
    state.finishedAt = new Date().toISOString()
    save(state)
    for (const item of state.createdUserFiles) {
      const temporary = join(state.preset, item.temporary)
      if (sameFile(temporary, item.identity)) rmSync(temporary)
    }
  } else throw new Error('Unknown installer transaction action')
}
