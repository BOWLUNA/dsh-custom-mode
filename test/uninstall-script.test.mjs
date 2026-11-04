/** Execute the real Bash uninstaller against synthetic host transactions and disposable homes. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { presetTarget } from '../tools/uninstall-presets.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(join(tmpdir(), 'dsh-uninstall-test-'))
const bash = process.env.DSH_TEST_BASH ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
const slash = (value) => value.replaceAll('\\', '/')
let passed = 0, failed = 0
const check = (label, okay) => { console.log(`${okay ? 'PASS' : 'FAIL'}  ${label}`); okay ? passed++ : failed++ }
const bin = join(root, 'bin'), mock = join(root, 'mock.mjs')
mkdirSync(bin)
writeFileSync(join(bin, 'dsh'), '#!/usr/bin/env bash\nexec node "$DSH_TEST_MOCK" "$@"\n', { mode: 0o755 })
writeFileSync(mock, `import fs from 'node:fs';import path from 'node:path';
const home=process.env.DSH_HOME,mode=process.env.DSH_TEST_MODE;
fs.writeFileSync(path.join(home,'called'),'yes');
if(mode==='failure')process.exit(73);
if(mode==='unchanged')process.exit(0);
const file=path.join(home,'profiles','web','package.json'),pkg=JSON.parse(fs.readFileSync(file,'utf8'));
delete pkg.dependencies['dsh-custom-mode'];pkg.dsh.profile.bundles=pkg.dsh.profile.bundles.filter(x=>x!=='dsh-custom-mode');
fs.writeFileSync(file,JSON.stringify(pkg));`)
function fixture(label) {
  const home = join(root, label), profile = join(home, 'profiles', 'web'), target = join(profile, 'node_modules', 'dsh-custom-mode'), preset = join(home, '.agent-presets', 'custom')
  mkdirSync(target, { recursive: true }); mkdirSync(preset, { recursive: true })
  const manifest = join(profile, 'package.json')
  writeFileSync(manifest, JSON.stringify({ dependencies: { 'dsh-custom-mode': '2.3.0' }, dsh: { profile: { bundles: ['base', 'dsh-custom-mode'] } } }))
  writeFileSync(join(target, 'package.json'), '{"name":"dsh-custom-mode","version":"2.3.0"}')
  writeFileSync(join(preset, 'prompt.md'), 'SYNTHETIC USER CONTENT'); writeFileSync(join(preset, 'prompt-reader.mjs'), '// managed')
  const env = { ...process.env, DSH_HOME: slash(home), DSH_TEST_MOCK: slash(mock), PATH: bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH }
  return { home, profile, target, preset, manifest, env }
}
function run(f, mode, args = []) {
  const options = { cwd: f.cwd ?? repo, env: { ...f.env, DSH_TEST_MODE: mode }, encoding: 'utf8', timeout: 15000, windowsHide: true }
  return mode === 'missing-cli'
    ? spawnSync(bash, ['-c', 'command() { if [ "$1" = "-v" ] && [ "$2" = "dsh" ]; then return 1; else builtin command "$@"; fi; }; script="$1"; shift; source "$script"', '_', slash(join(repo, 'uninstall.sh'))], options)
    : spawnSync(bash, [slash(join(repo, 'uninstall.sh')), ...args], options)
}
try {
  for (const [label, mode, args, status] of [['failure', 'failure', ['--purge'], 73], ['missing', 'missing-cli', [], 1], ['bad-id', 'success', ['--preset-id', '../escape'], 2], ['bad-profile', 'success', ['--profile', '../desktop'], 2], ['desktop', 'success', ['--profile', 'desktop'], 2], ['unchanged', 'unchanged', [], 1]]) {
    const f = fixture(label), before = readFileSync(f.manifest, 'utf8'), result = run(f, mode, args)
    check(label + ': reports failure', result.status === status)
    check(label + ': preserves package, declaration and user data', existsSync(f.target) && readFileSync(f.manifest, 'utf8') === before && readFileSync(join(f.preset, 'prompt.md'), 'utf8') === 'SYNTHETIC USER CONTENT')
    if (['bad-id', 'bad-profile', 'desktop', 'missing'].includes(label)) check(label + ': never invokes host mutation', !existsSync(join(f.home, 'called')))
  }
  const linked = fixture('linked'), source = join(root, 'linked-source')
  mkdirSync(source); writeFileSync(join(source, 'package.json'), '{"name":"dsh-custom-mode"}'); writeFileSync(join(source, 'keep'), 'SOURCE MUST SURVIVE')
  rmSync(linked.target, { recursive: true }); symlinkSync(source, linked.target, process.platform === 'win32' ? 'junction' : 'dir')
  check('successful removal unlinks package residue', run(linked, 'success').status === 0 && !existsSync(linked.target))
  check('link cleanup never deletes its source', readFileSync(join(source, 'keep'), 'utf8') === 'SOURCE MUST SURVIVE')
  check('ordinary uninstall preserves assistant data', existsSync(join(linked.preset, 'prompt.md')))
  const shared = fixture('shared'), sharedTarget = join(shared.home, 'profiles', 'node_modules', 'dsh-custom-mode'), other = join(shared.home, 'profiles', 'other')
  mkdirSync(sharedTarget, { recursive: true }); writeFileSync(join(sharedTarget, 'package.json'), '{"name":"dsh-custom-mode"}')
  mkdirSync(other); writeFileSync(join(other, 'package.json'), '{"dependencies":{"dsh-custom-mode":"2.3.0"}}')
  check('other profiles retain shared installation', run(shared, 'success').status === 0 && existsSync(sharedTarget))
  const unknown = fixture('unknown'); writeFileSync(join(unknown.target, 'package.json'), '{"name":"another-package"}')
  check('unverified leftover identity fails closed', run(unknown, 'success').status === 1 && existsSync(unknown.target))
  const explicitRoot = join(root, 'planner-root'), newlineName = 'line\nvictim\n'
  check('path planner preserves a newline-bearing name as one absolute target', presetTarget(explicitRoot, newlineName) === join(explicitRoot, newlineName))
  for (const invalid of ['..', '../victim', '..\\victim', '/victim', 'nested/child', '']) {
    let rejected = false
    try { presetTarget(explicitRoot, invalid) } catch { rejected = true }
    check('path planner rejects escape ' + JSON.stringify(invalid), rejected)
  }
  const purged = fixture('purge-safe'), external = join(root, 'external-preset-source')
  mkdirSync(external); writeFileSync(join(external, 'keep'), 'EXTERNAL MUST SURVIVE')
  symlinkSync(external, join(purged.preset, 'external'), process.platform === 'win32' ? 'junction' : 'dir')
  check('purge removes managed directory but never traverses its nested link', run(purged, 'success', ['--purge']).status === 0 && !existsSync(purged.preset) && readFileSync(join(external, 'keep'), 'utf8') === 'EXTERNAL MUST SURVIVE')
  const namedLink = fixture('purge-named-link')
  symlinkSync(external, join(namedLink.home, '.agent-presets', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  check('explicit linked preset is unlinked without deleting its target', run(namedLink, 'success', ['--purge', '--preset-id', 'linked']).status === 0 && !existsSync(join(namedLink.home, '.agent-presets', 'linked')) && existsSync(join(external, 'keep')))
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid synthetic cleanup target')
  if (failed === 0) rmSync(root, { recursive: true, force: true })
  else console.error('Synthetic evidence retained: ' + root)
}
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exitCode = failed ? 1 : 0
