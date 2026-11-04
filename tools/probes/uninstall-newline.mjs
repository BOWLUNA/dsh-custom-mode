#!/usr/bin/env node
/** Linux/POSIX-only real filesystem regression, separate from the platform-invariant suite count. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

if (process.platform === 'win32') {
  console.log('SKIP: Windows cannot create newline-bearing filenames; this probe requires POSIX')
  process.exit(0)
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = mkdtempSync(join(tmpdir(), 'dsh-purge-newline-'))
let passed = false
try {
  const home = join(root, 'home'), presets = join(home, '.agent-presets'), directory = join(presets, 'line\nvictim\n'), cwd = join(root, 'working-directory'), victim = join(cwd, 'victim'), bin = join(root, 'bin'), profile = join(home, 'profiles', 'web')
  for (const target of [directory, victim, bin, profile]) mkdirSync(target, { recursive: true })
  writeFileSync(join(directory, 'prompt.md'), 'SYNTHETIC NEWLINE PRESET'); writeFileSync(join(directory, 'prompt-reader.mjs'), '// managed')
  writeFileSync(join(victim, 'keep'), 'UNRELATED CWD DATA')
  writeFileSync(join(profile, 'package.json'), '{"dependencies":{},"dsh":{"profile":{"bundles":["base"]}}}')
  writeFileSync(join(bin, 'dsh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const result = spawnSync('bash', [join(repo, 'uninstall.sh'), '--purge'], { cwd, env: { ...process.env, DSH_HOME: home, PATH: bin + ':' + process.env.PATH }, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(directory), false, 'the one actual newline-bearing managed directory must be removed')
  assert.equal(readFileSync(join(victim, 'keep'), 'utf8'), 'UNRELATED CWD DATA', 'a newline must never become a relative deletion target')
  passed = true
  console.log('PASS: actual POSIX newline-bearing preset purged as one bounded path; unrelated cwd/victim preserved')
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe synthetic cleanup target')
  if (passed) rmSync(root, { recursive: true })
  else console.error('Synthetic evidence retained: ' + root)
}
