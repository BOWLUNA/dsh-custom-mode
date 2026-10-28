/** Real Bash installer + real offline npm pack; only the DSH package-manager interface is synthetic. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(join(tmpdir(), 'dsh-install-test-'))
const bin = join(root, 'bin')
mkdirSync(bin)
const bash = process.env.DSH_TEST_BASH ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
const currentVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
let passed = 0, failed = 0
const check = (label, okay, detail = '') => { console.log(`${okay ? 'PASS' : 'FAIL'}  ${label}${detail ? ' → ' + detail : ''}`); okay ? passed++ : failed++ }
const slash = value => value.replaceAll('\\', '/')
const mock = join(root, 'mock-dsh.mjs')
writeFileSync(mock, `
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync,appendFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
const home=process.env.DSH_HOME, mode=process.env.DSH_TEST_MODE, a=process.argv.slice(2);
const manifest=join(home,'profiles','web','package.json'), target=join(home,'profiles','web','node_modules','dsh-custom-mode');
appendFileSync(join(home,'calls.jsonl'),JSON.stringify(a)+'\\n');
if(a[0]==='--version'){console.log('0.2.1-rc.2');process.exit(0)}
function clear(){if(!resolve(target).startsWith(resolve(home)+'/')&&!resolve(target).startsWith(resolve(home)+'\\\\'))throw Error('outside synthetic home');rmSync(target,{recursive:true,force:true})}
function untar(file){const b=gunzipSync(readFileSync(file));for(let o=0;o+512<=b.length;){const h=b.subarray(o,o+512),name=h.subarray(0,100).toString().replace(/\\0.*$/s,''),n=parseInt(h.subarray(124,136).toString().replace(/\\0.*$/s,'').trim()||'0',8);if(!name)break;const rel=name.replace(/^package\\//,'');if(h[156]!==53&&rel&& !rel.includes('..')){const dest=join(target,rel);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,b.subarray(o+512,o+512+n))}o+=512+Math.ceil(n/512)*512}}
if(a[0]==='plugin'){
 const p=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):{private:true,dependencies:{},dsh:{profile:{bundles:['@deepseek-ai/dsh-base']}}};
 p.dependencies??={};p.dsh??={};p.dsh.profile??={};p.dsh.profile.bundles??=[];
 if(a[3]==='remove'){delete p.dependencies['dsh-custom-mode'];p.dsh.profile.bundles=p.dsh.profile.bundles.filter(x=>x!=='dsh-custom-mode');clear()}
 else if(a[3]==='add'){
  const archive=a[4].endsWith('.tgz');if(archive&&mode==='rollback-fail'){console.error('SYNTHETIC_ROLLBACK_FAILURE');process.exit(19)}
  clear();mkdirSync(target,{recursive:true});if(archive)untar(a[4]);else cpSync(a[4],target,{recursive:true,filter:p=>!['.git','node_modules'].includes(p.slice(a[4].length+1).split(/[\\\\/]/)[0])});
  p.dependencies['dsh-custom-mode']='file:'+a[4];if(!p.dsh.profile.bundles.includes('dsh-custom-mode'))p.dsh.profile.bundles.push('dsh-custom-mode');
  mkdirSync(dirname(manifest),{recursive:true});writeFileSync(manifest,JSON.stringify(p,null,2)+'\\n');
  if(!archive&&['add-fail','rollback-fail','first-fail'].includes(mode)){console.error('SYNTHETIC_ADD_FAILURE_AFTER_PARTIAL_STATE');process.exit(17)}
 }else process.exit(99);
 mkdirSync(dirname(manifest),{recursive:true});writeFileSync(manifest,JSON.stringify(p,null,2)+'\\n');process.exit(0);
}
if(a.includes('--dump-config')){if(mode==='dump-fail')process.exit(18);console.log('- id: custom-mode\\n  name: dsh-custom-mode');for(let i=0;i<20;i++)console.log('- id: synthetic-'+i+'\\n  name: synthetic');console.log('# @deepseek-ai/dsh-host-webserver @deepseek-ai/dsh-agent-preset-registry @deepseek-ai/dsh-agent-preset');process.exit(0)}
process.exit(99);
`)
writeFileSync(join(bin, 'dsh'), '#!/usr/bin/env bash\nexec node "$DSH_TEST_MOCK" "$@"\n', { mode: 0o755 })
writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
writeFileSync(join(root, 'npm-user.ini'), '')
writeFileSync(join(root, 'npm-global.ini'), '')
const metadata = 'name: Synthetic custom name\ndescription: Synthetic description\norder: 73\n'
const prompt = 'SYNTHETIC USER PROMPT\n', composition = '# SYNTHETIC USER COMPOSITION\n'
function fixture(mode) {
  const home = join(root, mode), preset = join(home, '.agent-presets', 'custom'), profile = join(home, 'profiles', 'web')
  mkdirSync(preset, { recursive: true }); mkdirSync(profile, { recursive: true }); mkdirSync(join(home, 'transactions'))
  for (const [name, body] of Object.entries({ 'preset.yml': metadata, 'prompt.md': prompt, 'agent.cordis.yml': composition, 'prompt-reader.mjs': '// OLD READER\n', 'prompt-tool.mjs': '// OLD TOOL\n' })) writeFileSync(join(preset, name), body)
  const first = mode === 'first-fail'
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ private: true, dependencies: first ? {} : { 'dsh-custom-mode': 'file:previous' }, dsh: { profile: { bundles: first ? ['@deepseek-ai/dsh-base'] : ['@deepseek-ai/dsh-base', 'dsh-custom-mode'] } } }, null, 2))
  if (!first && mode !== 'missing-old') {
    const installed = join(profile, 'node_modules', 'dsh-custom-mode'); mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'dsh-custom-mode', version: '2.2.5', main: './index.mjs', files: ['index.mjs'] }, null, 2))
    writeFileSync(join(installed, 'index.mjs'), 'export const oldRuntime = "2.2.5-snapshot"\n')
  }
  const env = { ...process.env, DSH_HOME: slash(home), HOME: slash(home), DSH_TEST_MOCK: slash(mock), DSH_TEST_MODE: mode, TMPDIR: slash(join(home, 'transactions')), NPM_CONFIG_USERCONFIG: join(root, 'npm-user.ini'), NPM_CONFIG_GLOBALCONFIG: join(root, 'npm-global.ini'), NPM_CONFIG_CACHE: join(root, 'npm-cache'), NODE_AUTH_TOKEN: '', NPM_TOKEN: '', PATH: bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH }
  return { home, preset, profile, env }
}
try {
  for (const mode of ['success', 'add-fail', 'dump-fail', 'rollback-fail', 'first-fail', 'missing-old']) {
    const f = fixture(mode)
    const run = spawnSync(bash, ['--noprofile', '--norc', 'install.sh'], { cwd: repo, env: f.env, encoding: 'utf8', timeout: 60000, windowsHide: true })
    writeFileSync(join(f.home, 'output.log'), (run.stdout ?? '') + (run.stderr ?? '') + (run.error?.message ?? ''))
    const expected = mode === 'success' ? 0 : mode === 'rollback-fail' ? 5 : 1
    check(`${mode}: installer exit ${expected}`, run.status === expected, run.status === expected ? '' : (run.stderr ?? '').slice(-600))
    for (const [file, body] of [['preset.yml', metadata], ['prompt.md', prompt], ['agent.cordis.yml', composition]]) check(`${mode}: preserves ${file} byte-for-byte`, readFileSync(join(f.preset, file), 'utf8') === body)
    const installed = join(f.profile, 'node_modules', 'dsh-custom-mode')
    const calls = readFileSync(join(f.home, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    if (mode === 'success') {
      check('success: no preemptive remove', !calls.some(a => a[3] === 'remove'))
      check('success: expected candidate installed', JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version === currentVersion)
      check('success: managed code refreshed', readFileSync(join(f.preset, 'prompt-reader.mjs'), 'utf8') === readFileSync(join(repo, 'preset', 'prompt-reader.mjs'), 'utf8'))
    } else if (mode === 'add-fail' || mode === 'dump-fail') {
      check(`${mode}: actual previous package restored`, readFileSync(join(installed, 'index.mjs'), 'utf8').includes('2.2.5-snapshot'))
      check(`${mode}: previous preset code kept`, readFileSync(join(f.preset, 'prompt-reader.mjs'), 'utf8') === '// OLD READER\n' && readFileSync(join(f.preset, 'prompt-tool.mjs'), 'utf8') === '// OLD TOOL\n')
      check(`${mode}: rollback uses local archive`, calls.some(a => a[3] === 'add' && a[4].endsWith('.tgz')))
    } else if (mode === 'first-fail') {
      check('first-fail: partial dependency removed', !JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')).dependencies['dsh-custom-mode'])
      check('first-fail: existing user code untouched', readFileSync(join(f.preset, 'prompt-reader.mjs'), 'utf8') === '// OLD READER\n')
    } else if (mode === 'missing-old') check('missing-old: stops before mutation', !calls.some(a => a[0] === 'plugin'))
    else {
      const transactions = readdirSync(join(f.home, 'transactions')).map(name => join(f.home, 'transactions', name))
      const state = JSON.parse(readFileSync(join(transactions[0], 'state.json'), 'utf8'))
      check('rollback-fail: keeps previous archive and evidence', existsSync(state.previous.path) && state.rollback.packageRestored === false && (run.stderr ?? '').includes('回滚未验证'))
    }
  }
  const f = fixture('code-rollback'), transaction = join(f.home, 'transactions', 'direct')
  const helper = join(repo, 'tools', 'install-transaction.mjs')
  const invoke = (action, args = []) => spawnSync(process.execPath, [helper, action, transaction, ...args], { cwd: repo, env: f.env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  check('code rollback: prepare local archives', invoke('prepare', [repo, f.home, 'web', 'custom']).status === 0)
  invoke('attempt'); check('code rollback: managed refresh executes', invoke('seed').status === 0)
  check('code rollback: restored and verified', invoke('rollback', ['0']).status === 0)
  check('code rollback: both old modules restored', readFileSync(join(f.preset, 'prompt-reader.mjs'), 'utf8') === '// OLD READER\n' && readFileSync(join(f.preset, 'prompt-tool.mjs'), 'utf8') === '// OLD TOOL\n')

  const preload = join(root, 'seed-faults.mjs')
  writeFileSync(preload, `
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
if(process.argv[2]==='seed'){
 const mode=process.env.DSH_TEST_SEED_FAULT, handles=new Map();
 const open=fs.openSync, write=fs.writeFileSync, link=fs.linkSync;
 let published=false, injected=false;
 fs.openSync=function(path,...args){const fd=open(path,...args);if(String(path).includes('.custom-install-user-'))handles.set(fd,path);return fd};
 fs.writeFileSync=function(path,data,...args){
  if(mode==='partial-eio'&&typeof path==='number'&&handles.has(path)&&!injected){injected=true;write(path,Buffer.from(data).subarray(0,7));throw Object.assign(new Error('Synthetic partial staged write'),{code:'EIO'})}
  if(mode==='receipt-fail'&&published&&!injected&&String(path).endsWith('state.json.tmp')){injected=true;throw Object.assign(new Error('Synthetic receipt failure after publication'),{code:'EIO'})}
  return write(path,data,...args);
 };
 fs.linkSync=function(from,to){
  if(['concurrent-eexist','concurrent-identical'].includes(mode)&&String(to).endsWith('preset.yml')&&!injected){injected=true;write(to,mode==='concurrent-identical'?fs.readFileSync(from):'name: CONCURRENT USER FILE\\n',{flag:'wx'})}
  const value=link(from,to);if(String(to).endsWith('preset.yml'))published=true;return value;
 };
 syncBuiltinESMExports();
}else if(process.argv[2]==='rollback'&&process.env.DSH_TEST_SEED_FAULT==='rollback-replacement'){
 const rename=fs.renameSync;
 fs.renameSync=function(from,to){if(String(from).endsWith('preset.yml')&&String(to).includes('.custom-install-recovered-')){fs.rmSync(from);fs.writeFileSync(from,'name: CONCURRENT USER FILE\\n',{flag:'wx'})}return rename(from,to)};
 syncBuiltinESMExports();
}
`)
  for (const fault of ['partial-eio', 'concurrent-eexist', 'concurrent-identical', 'receipt-fail', 'rollback-replacement']) {
    const f = fixture(fault), transaction = join(f.home, 'transactions', 'fault')
    rmSync(join(f.preset, 'preset.yml')) // Deliberately missing synthetic metadata.
    const helper = join(repo, 'tools', 'install-transaction.mjs')
    const invoke = (action, args = [], inject = false) => spawnSync(process.execPath, [helper, action, transaction, ...args], { cwd: repo, env: { ...f.env, ...(inject ? { NODE_OPTIONS: '--import=' + pathToFileURL(preload).href, DSH_TEST_SEED_FAULT: fault === 'rollback-replacement' && action === 'seed' ? 'receipt-fail' : fault } : {}) }, encoding: 'utf8', timeout: 60000, windowsHide: true })
    check(`${fault}: prepare actual package snapshots`, invoke('prepare', [repo, f.home, 'web', 'custom']).status === 0)
    invoke('attempt')
    const seeded = invoke('seed', [], true)
    check(`${fault}: injected outcome observed`, seeded.status === (fault.startsWith('concurrent-') ? 0 : 1))
    if (fault === 'partial-eio') check('partial-eio: incomplete bytes never published', !existsSync(join(f.preset, 'preset.yml')))
    if (fault === 'receipt-fail' || fault === 'rollback-replacement') check(`${fault}: complete file published before failed receipt`, readFileSync(join(f.preset, 'preset.yml'), 'utf8') === readFileSync(join(repo, 'preset', 'preset.yml'), 'utf8'))
    check(`${fault}: rollback verified`, invoke('rollback', ['0'], fault === 'rollback-replacement').status === 0)
    const finalText = existsSync(join(f.preset, 'preset.yml')) ? readFileSync(join(f.preset, 'preset.yml'), 'utf8') : null
    check(`${fault}: preserves concurrent file or restores absence`, fault === 'concurrent-identical' ? finalText === readFileSync(join(repo, 'preset', 'preset.yml'), 'utf8') : fault === 'concurrent-eexist' || fault === 'rollback-replacement' ? finalText === 'name: CONCURRENT USER FILE\n' : finalText === null)
    check(`${fault}: all owned staging links removed`, !readdirSync(f.preset).some(name => name.startsWith('.custom-install-user-')))
    check(`${fault}: existing prompt and composition preserved`, readFileSync(join(f.preset, 'prompt.md'), 'utf8') === prompt && readFileSync(join(f.preset, 'agent.cordis.yml'), 'utf8') === composition)
  }

  const oldUserFiles = { 'preset.yml': metadata, 'prompt.md': prompt, 'agent.cordis.yml': composition }
  const deadOwner = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', windowsHide: true })
  if (deadOwner.status !== 0) throw new Error('Could not create an exited legacy owner fixture')
  const userSnapshot = directory => JSON.stringify(readdirSync(directory).sort().filter(name => !name.startsWith('.custom-install-')).map(name => [name, readFileSync(join(directory, name), 'utf8')]))
  for (const mode of ['legacy-interrupted', 'legacy-active', 'legacy-ambiguous', 'legacy-late-owner']) {
    const f = fixture(mode), transaction = join(f.home, 'transactions', 'legacy')
    const helper = join(repo, 'tools', 'install-transaction.mjs')
    const invoke = (action, args = []) => spawnSync(process.execPath, [helper, action, transaction, ...args], { cwd: repo, env: f.env, encoding: 'utf8', timeout: 60000, windowsHide: true })
    if (mode === 'legacy-late-owner') {
      check('late recovery: initial preparation completes', invoke('prepare', [repo, f.home, 'web', 'custom']).status === 0)
      invoke('attempt')
    }
    const owner = mode === 'legacy-active' || mode === 'legacy-late-owner' ? process.pid : Number(deadOwner.stdout)
    for (const [name, body] of Object.entries(oldUserFiles)) writeFileSync(join(f.preset, name + '.bak-' + owner + '-1234abcd'), body)
    rmSync(join(f.preset, 'prompt.md'))
    if (mode === 'legacy-interrupted') {
      writeFileSync(join(f.preset, 'preset.yml'), 'name: PARTIALLY INSTALLED METADATA\n')
      writeFileSync(join(f.preset, 'agent.cordis.yml'), '# PARTIALLY INSTALLED COMPOSITION\n')
    }
    if (mode === 'legacy-ambiguous') writeFileSync(join(f.preset, 'prompt.md.bak-' + owner + '-abcd1234'), 'ANOTHER USER GENERATION\n')
    const before = userSnapshot(f.preset)
    if (mode === 'legacy-interrupted') {
      check('legacy recovery: prepare succeeds using shared recovery', invoke('prepare', [repo, f.home, 'web', 'custom']).status === 0)
      check('legacy recovery: whole old generation restored before fill', Object.entries(oldUserFiles).every(([name, body]) => readFileSync(join(f.preset, name), 'utf8') === body))
      invoke('attempt')
      check('legacy recovery: seed succeeds', invoke('seed').status === 0)
      check('legacy recovery: original prompt is never replaced by template', readFileSync(join(f.preset, 'prompt.md'), 'utf8') === prompt)
      check('legacy recovery: old backup group is consumed coherently', !readdirSync(f.preset).some(name => name.includes('.bak-') || name.startsWith('.custom-mode-transaction-')))
      check('legacy recovery: later installer rollback still preserves recovered generation', invoke('rollback', ['0']).status === 0 && Object.entries(oldUserFiles).every(([name, body]) => readFileSync(join(f.preset, name), 'utf8') === body))
    } else {
      const action = mode === 'legacy-late-owner' ? 'seed' : 'prepare'
      const run = invoke(action, action === 'prepare' ? [repo, f.home, 'web', 'custom'] : [])
      check(`${mode}: unresolved recovery fails closed`, run.status === 1 && (run.stderr ?? '').includes('recovery must finish'))
      check(`${mode}: no default prompt is filled`, !existsSync(join(f.preset, 'prompt.md')))
      check(`${mode}: every user/recovery file stays unchanged`, userSnapshot(f.preset) === before)
      if (mode === 'legacy-late-owner') check('late recovery: package rollback does not consume active user transaction', invoke('rollback', ['0']).status === 0 && userSnapshot(f.preset) === before)
      else check(`${mode}: stops before package transaction is prepared`, !existsSync(join(transaction, 'state.json')))
    }
  }
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith('dsh-install-test-')) throw new Error('Refusing cleanup outside the generated synthetic test directory')
  if (failed === 0) rmSync(root, { recursive: true, force: true })
  else console.error(`Synthetic evidence retained: ${root}`)
}
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
