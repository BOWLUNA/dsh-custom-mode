#!/usr/bin/env node
/** Run the shipped plugin against one exact host in an isolated copy.
 * node tools/compat-check.mjs --host-install /path/to/host --out /path/to/evidence --port 32110
 * The host directory must already contain node_modules/@deepseek-ai/dsh.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] }
const host = option('host-install') && resolve(option('host-install'))
const output = option('out') && resolve(option('out'))
const port = option('port') ?? '32110'
const insideSource = output && relative(source, output)
if (!host || !output || insideSource === '' || (!isAbsolute(insideSource) && !insideSource.startsWith('..' + sep))) {
  console.error('Use --host-install <isolated host directory> --out <new evidence directory> [--port <n>]')
  process.exit(2)
}
const entry = join(host, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const hostManifest = join(host, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
if (!existsSync(entry)) { console.error('The exact host is not installed: ' + entry); process.exit(2) }
const version = JSON.parse(readFileSync(hostManifest, 'utf8')).version
const candidate = join(output, 'candidate')
if (existsSync(candidate)) { console.error('Evidence directory already has a candidate; use a fresh --out.'); process.exit(2) }
mkdirSync(output, { recursive: true })
cpSync(source, candidate, {
  recursive: true,
  filter: (path) => !['.git', 'node_modules'].includes(path.slice(source.length + 1).split(/[\\/]/)[0]),
})
symlinkSync(join(host, 'node_modules'), join(candidate, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const npmrc = join(output, 'npmrc')
writeFileSync(npmrc, 'registry=https://registry.npmjs.org/\n')
const env = {
  ...process.env,
  DSH_HOME: join(output, 'unit-home'),
  DSH_INSTALL: host,
  DSH_SHIPPED_PRESETS_DIR: '',
  DSH_PRESET_PATCH_DIR: join(host, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets'),
  NPM_CONFIG_USERCONFIG: npmrc,
  NPM_CONFIG_CACHE: join(output, 'npm-cache'),
  PATH: join(host, 'node_modules', '.bin') + (process.platform === 'win32' ? ';' : ':') + process.env.PATH,
}
const report = { hostVersion: version, nodeVersion: process.version, platform: process.platform, packageVersion: JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version, checks: [] }
const redact = (value) => String(value ?? '').replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]')
function run(label, executable, argv, timeout = 300000) {
  const result = spawnSync(executable, argv, { cwd: candidate, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true })
  const log = redact((result.stdout ?? '') + (result.stderr ?? '') + (result.error ? '\n' + result.error.message : ''))
  writeFileSync(join(output, label + '.log'), log)
  report.checks.push({ name: label, passed: result.status === 0, exitCode: result.status })
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${version} ${label}`)
  if (result.status !== 0) console.error(log.split('\n').filter((line) => /FAIL|failed|失败|Error|error:|^x /.test(line)).slice(-18).join('\n'))
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  return { result, log }
}
for (const script of ['test/run.mjs', 'tools/verify-version-consistency.mjs', 'tools/verify-translation-pairing.mjs', 'tools/verify-doc-numbers.mjs', 'tools/verify-browser-literals.mjs', 'tools/market-check.mjs']) {
  run(script.replace(/[/.]/g, '-'), process.execPath, [script, ...(script.includes('version-consistency') ? ['--dsh', version] : script.includes('market-check') ? ['--self-test'] : [])])
}
const npm = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((path) => path && existsSync(path))
if (!npm) { console.error('Cannot resolve npm-cli.js'); process.exit(2) }
const packed = run('package', process.execPath, [npm, 'pack', '--json', '--pack-destination', output])
if (packed.result.status === 0) {
  const files = JSON.parse(packed.result.stdout)[0]
  const archive = join(output, files.filename)
  run('boot', process.execPath, ['tools/boot-check.mjs', '--dsh-bin', entry, '--package', archive, '--port', port, '--home', join(output, 'boot-home'), '--keep'], 180000)
}
process.exitCode = report.checks.some((check) => !check.passed) ? 1 : 0
