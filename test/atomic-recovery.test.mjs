/** Crash recovery uses whole generations, before assistant discovery or template repair. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { restoreBackups } from '../atomic.mjs'
import { scanManagedDirs, seedOnActivation } from '../assistants.mjs'
import { seedPreset } from '../seed.mjs'

const names = ['agent.cordis.yml', 'prompt.md', 'preset.yml']
const content = (generation, name) => `${generation}: ${name}\n`
const point = process.argv[2]
if (point?.startsWith('child:')) {
  const directory = process.argv[3]
  const stop = point.slice(6)
  let backups = 0
  let installs = 0
  let journalWrites = 0
  const rename = fs.renameSync
  const remove = fs.rmSync
  const pause = () => {
    fs.writeFileSync(join(directory, 'ready'), String(process.pid))
    const deadline = Date.now() + 15000
    while (!fs.existsSync(join(directory, 'release'))) {
      if (Date.now() > deadline) process.exit(74)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
  fs.renameSync = (from, to) => {
    const result = rename(from, to)
    if (stop === 'legacy-recovery-first' && String(from).includes('.bak-')) process.exit(73)
    if (String(to).includes('.bak-')) {
      backups += 1
      if (stop === 'backup-all-live' && backups === 3) pause()
      if ((stop === 'backup-first' && backups === 1) || (stop === 'backup-all' && backups === 3)) process.exit(73)
    }
    if (names.some((name) => String(to) === join(directory, name)) && String(from).includes('.tmp-')) {
      installs += 1
      if ((stop === 'install-first' && installs === 1) || (stop === 'install-second' && installs === 2)) process.exit(73)
    }
    if (String(to).includes('.custom-mode-transaction-') && String(to).endsWith('.json')) {
      journalWrites += 1
      if (stop === 'commit-marker-live' && journalWrites === 2) pause()
      if (stop === 'commit-marker' && journalWrites === 2) process.exit(73)
    }
    return result
  }
  fs.rmSync = (file, options) => {
    const result = remove(file, options)
    if (stop === 'cleanup-first' && String(file).includes('.bak-') && journalWrites === 2) process.exit(73)
    return result
  }
  syncBuiltinESMExports()
  if (stop === 'legacy-recovery-first') {
    restoreBackups(directory)
    process.exit(2)
  }
  const { writeAtomicPair } = await import('../atomic.mjs')
  writeAtomicPair(names.map((name) => [join(directory, name), content('NEW', name)]))
  process.exit(stop.endsWith('-live') ? 0 : 2)
}

let passed = 0
const check = (label, test) => {
  assert.ok(test, label)
  passed += 1
  console.log('PASS  ' + label)
}
const root = fs.mkdtempSync(join(tmpdir(), 'dsh-recovery-'))
const deadOwner = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
assert.equal(deadOwner.status, 0)
const legacyStamp = deadOwner.stdout + '-1234abcd'
try {
  for (const stop of ['backup-first', 'backup-all', 'install-first', 'install-second', 'commit-marker', 'cleanup-first']) {
    const directory = join(root, stop)
    fs.mkdirSync(directory)
    fs.writeFileSync(join(directory, 'prompt-reader.mjs'), 'export default {}\n')
    for (const name of names) fs.writeFileSync(join(directory, name), content('OLD', name))
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child:' + stop, directory], { encoding: 'utf8' })
    check(`${stop}: fixture stopped in the requested transaction phase`, child.status === 73)
    // Discovery itself must recover, even when prompt.md is one of the missing targets.
    check(`${stop}: assistant remains discoverable after recovery`, scanManagedDirs(root).includes(directory))
    const expected = ['commit-marker', 'cleanup-first'].includes(stop) ? 'NEW' : 'OLD'
    check(`${stop}: all three files belong to ${expected}`, names.every((name) => fs.readFileSync(join(directory, name), 'utf8') === content(expected, name)))
    check(`${stop}: transaction evidence is cleared after successful recovery`, !fs.readdirSync(directory).some((name) => name.includes('.bak-') || name.startsWith('.custom-mode-transaction-') || name.includes('.tmp-')))
  }

  const broken = join(root, 'rollback-failed')
  fs.mkdirSync(broken)
  fs.writeFileSync(join(broken, 'prompt-reader.mjs'), 'export default {}\n')
  for (const name of names) fs.writeFileSync(join(broken, name), content('OLD', name))
  spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child:install-first', broken])
  const rename = fs.renameSync
  fs.renameSync = (from, to) => {
    if (String(from).includes('.bak-')) throw Object.assign(new Error('fixture restore denied'), { code: 'EIO' })
    return rename(from, to)
  }
  syncBuiltinESMExports()
  try {
    check('failed recovery is explicit', restoreBackups(broken).ok === false)
    check('failed recovery remains visible as a managed assistant', scanManagedDirs(root).includes(broken))
    const seeded = seedPreset(broken)
    check('template repair refuses to replace missing user data', seeded.errors.length > 0 && !fs.existsSync(join(broken, 'prompt.md')))
    check('failed recovery keeps the journal and original backups', fs.readdirSync(broken).some((name) => name.startsWith('.custom-mode-transaction-')) && fs.readdirSync(broken).filter((name) => name.includes('.bak-')).length === 3)
  } finally {
    fs.renameSync = rename
    syncBuiltinESMExports()
  }
  check('a later permitted recovery restores the entire original generation', restoreBackups(broken).ok && names.every((name) => fs.readFileSync(join(broken, name), 'utf8') === content('OLD', name)))

  const legacy = join(root, 'legacy')
  fs.mkdirSync(legacy)
  fs.writeFileSync(join(legacy, 'prompt-reader.mjs'), 'export default {}\n')
  for (const name of names) fs.writeFileSync(join(legacy, name + '.bak-' + legacyStamp), content('OLD', name))
  fs.writeFileSync(join(legacy, 'agent.cordis.yml'), content('NEW', 'agent.cordis.yml'))
  check('pre-journal partial installation restores the entire unique backup group', scanManagedDirs(root).includes(legacy) && names.every((name) => fs.readFileSync(join(legacy, name), 'utf8') === content('OLD', name)))

  const makeLegacyRecovery = (id) => {
    const directory = join(root, id)
    fs.mkdirSync(directory)
    for (const name of names) fs.writeFileSync(join(directory, name + '.bak-' + legacyStamp), content('OLD', name))
    for (const name of names.slice(1)) fs.writeFileSync(join(directory, name), content('NEW', name))
    return directory
  }
  const interruptedLegacy = makeLegacyRecovery('legacy-recovery-interrupted')
  const interrupted = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child:legacy-recovery-first', interruptedLegacy])
  check('legacy recovery can be interrupted after restoring its only missing file', interrupted.status === 73 && names.every((name) => fs.existsSync(join(interruptedLegacy, name))))
  check('reentry still restores all legacy files, using the journal instead of missing-file inference', restoreBackups(interruptedLegacy).ok && names.every((name) => fs.readFileSync(join(interruptedLegacy, name), 'utf8') === content('OLD', name)))

  const deniedLegacy = makeLegacyRecovery('legacy-recovery-denied')
  fs.renameSync = (from, to) => {
    if (String(from).endsWith('preset.yml.bak-' + legacyStamp)) throw new Error('fixture later legacy restore denied')
    return rename(from, to)
  }
  syncBuiltinESMExports()
  try {
    check('a later legacy restore failure remains explicit even after every target exists', restoreBackups(deniedLegacy).ok === false && names.every((name) => fs.existsSync(join(deniedLegacy, name))))
    check('failed legacy recovery retains its new recovery journal', fs.readdirSync(deniedLegacy).some((name) => name.startsWith('.custom-mode-transaction-')))
  } finally {
    fs.renameSync = rename
    syncBuiltinESMExports()
  }
  check('legacy recovery retries the remaining group instead of accepting a mixed generation', restoreBackups(deniedLegacy).ok && names.every((name) => fs.readFileSync(join(deniedLegacy, name), 'utf8') === content('OLD', name)))

  const untrusted = join(root, 'untrusted-journal')
  fs.mkdirSync(untrusted)
  const outside = join(root, 'outside.md')
  fs.writeFileSync(outside, 'PRESERVE')
  fs.writeFileSync(join(untrusted, '.custom-mode-transaction-123-1234abcd.json'), JSON.stringify({ version: 1, stamp: '123-1234abcd', phase: 'prepared', entries: [{ name: '../outside.md', backup: '../outside.md.bak-123-1234abcd', temporary: '../outside.md.tmp-123-1234abcd', existed: false }] }))
  check('untrusted recovery paths are rejected before any filesystem mutation', restoreBackups(untrusted).ok === false && fs.readFileSync(outside, 'utf8') === 'PRESERVE')
  fs.writeFileSync(join(untrusted, '.custom-mode-transaction-123-1234abcd.json'), JSON.stringify({ version: 1, stamp: '123-1234abcd', phase: 'prepared', entries: [null] }))
  check('malformed journal entries return a typed failure without throwing', restoreBackups(untrusted).code === 'recoveryRequired' && fs.readFileSync(outside, 'utf8') === 'PRESERVE')
  const readdir = fs.readdirSync
  let reads = 0
  fs.readdirSync = (...args) => {
    if (++reads === 2) throw new Error('fixture second directory read failed')
    return readdir(...args)
  }
  syncBuiltinESMExports()
  try {
    check('a second directory-read failure is a typed recovery result', restoreBackups(legacy).code === 'recoveryRequired')
  } finally {
    fs.readdirSync = readdir
    syncBuiltinESMExports()
  }

  const snapshot = (directory) => Object.fromEntries(fs.readdirSync(directory).sort().map((name) => [name, fs.readFileSync(join(directory, name)).toString('base64')]))
  for (const stop of ['backup-all-live', 'commit-marker-live']) {
    const liveRoot = join(root, stop)
    const directory = join(liveRoot, 'example')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(join(liveRoot, '.custom-mode.json'), '{}\n')
    fs.writeFileSync(join(directory, 'prompt-reader.mjs'), 'export default {}\n')
    for (const name of names) fs.writeFileSync(join(directory, name), content('OLD', name))
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'child:' + stop, directory], { stdio: 'ignore' })
    const finished = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (status) => resolve(status))
    })
    try {
      const deadline = Date.now() + 5000
      while (!fs.existsSync(join(directory, 'ready'))) {
        if (Date.now() > deadline) throw new Error('Live transaction fixture did not reach barrier')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const before = snapshot(directory)
      check(`${stop}: a live foreign owner is deferred`, restoreBackups(directory).code === 'recoveryRequired')
      check(`${stop}: discovery retains the assistant without consuming its transaction`, scanManagedDirs(liveRoot).includes(directory))
      const { readState } = await import('../index.mjs')
      check(`${stop}: state read reports retry/recovery rather than applying a live transaction`, readState([{ id: 'example', trust: 'user', path: join(directory, 'agent.cordis.yml') }], 'example').code === 'recoveryRequired')
      seedOnActivation({ root: liveRoot, composition: '- id: persona\n  name: ./prompt-reader.mjs\n', log: () => {}, info: () => {} })
      check(`${stop}: reading, discovery and seeding leave every live transaction file byte-identical`, JSON.stringify(snapshot(directory)) === JSON.stringify(before))
      const kill = process.kill
      try {
        for (const code of ['EPERM', 'EIO']) {
          process.kill = () => { throw Object.assign(new Error('fixture owner status unknown'), { code }) }
          check(`${stop}: ${code} never counts as owner death`, restoreBackups(directory).code === 'recoveryRequired' && JSON.stringify(snapshot(directory)) === JSON.stringify(before))
        }
      } finally { process.kill = kill }
      const liveLegacy = join(liveRoot, 'legacy')
      fs.mkdirSync(liveLegacy)
      for (const name of names) fs.writeFileSync(join(liveLegacy, name + '.bak-' + child.pid + '-1234abcd'), content('OLD', name))
      const legacyBefore = snapshot(liveLegacy)
      check(`${stop}: legacy backups also wait for their live owner`, restoreBackups(liveLegacy).code === 'recoveryRequired' && JSON.stringify(snapshot(liveLegacy)) === JSON.stringify(legacyBefore))
    } finally {
      fs.writeFileSync(join(directory, 'release'), 'continue')
      assert.equal(await finished, 0)
    }
    check(`${stop}: released writer completes one coherent new generation`, names.every((name) => fs.readFileSync(join(directory, name), 'utf8') === content('NEW', name)) && restoreBackups(directory).ok === true)
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
console.log(`结果: ${passed} 通过, 0 失败`)
