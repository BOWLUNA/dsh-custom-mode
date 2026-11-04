#!/usr/bin/env node
/** Official pluginManager API integration; no browser, model, credentials or production profile.
 * node tools/native-update-check.mjs --host-install <isolated exact host> --old-package <public 2.2.6.tgz> --out <new directory>
 * Requires pnpm in that host's node_modules (or --pnpm <pnpm.mjs/cjs>).
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve, delimiter, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fixturePackages, hash, startRegistry, packageName, matchesUpdateOutcome } from './native-update-fixture.mjs'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..'), args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] }
const host = option('host-install') && resolve(option('host-install')), output = option('out') && resolve(option('out')), oldFile = option('old-package') && resolve(option('old-package'))
const rel = output && relative(source, output)
if (!host || !output || !oldFile || !rel || (!isAbsolute(rel) && !rel.startsWith('..' + sep)) || existsSync(output)) throw new Error('Pass an isolated --host-install, public --old-package and a new --out outside this repository')
const bin = join(host, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const targetVersion = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version
const pnpm = option('pnpm') ?? [join(host, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'), join(host, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')].find(existsSync)
const npm = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((file) => file && existsSync(file))
if (![bin, pnpm, npm, oldFile].every((file) => file && existsSync(file))) throw new Error('Host, pnpm, npm or public old archive is missing')
mkdirSync(output)
const report = { hostVersion: JSON.parse(readFileSync(join(host, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version, boundary: 'official manager API, isolated loopback registry; no Plugins UI/browser/model/Electron acceptance', checks: [] }
const redact = (value) => String(value ?? '').replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]').replace(/(Cookie|Authorization|Set-Cookie):[^\r\n]*/gi, '$1: [redacted]')
const saveReport = () => writeFileSync(join(output, 'native-update-report.json'), JSON.stringify(report, null, 2) + '\n')
const check = (label, okay, detail) => { report.checks.push({ label, passed: Boolean(okay), ...(detail ? { detail } : {}) }); saveReport(); console.log(`${okay ? 'PASS' : 'FAIL'} ${label}`); assert.ok(okay, label) }
function recordOutcome(scenario, response, versions = {}) {
  const value = response?.data?.value
  const application = (input) => ['applied', 'restart-required', 'failed', 'cancelled'].includes(input) ? input : null
  const version = (input) => ['2.2.6', '2.2.7', targetVersion].includes(input) ? input : null
  report.outcomes ??= []
  report.outcomes.push({ scenario, status: Number.isInteger(response?.status) ? response.status : null, ok: response?.data?.ok === true, from: version(value?.from), to: version(value?.to), step: ['check', 'remove', 'install'].includes(value?.step) ? value.step : null, application: application(value?.result?.application), restoreApplication: application(value?.restore?.application), ...Object.fromEntries(Object.entries(versions).map(([key, input]) => [key, version(input)])) })
  saveReport()
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
async function command(label, argv, cwd, env) {
  const child = spawn(process.execPath, argv, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', (bytes) => { stdout += bytes }); child.stderr.on('data', (bytes) => { stderr += bytes })
  const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
  const status = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', (code) => done(code)) }).finally(() => clearTimeout(timer))
  writeFileSync(join(output, label + '.log'), redact(stdout + '\n' + stderr))
  assert.equal(status, 0, label + ' failed; see sanitized log')
  return stdout
}
const baseEnv = Object.fromEntries(['SystemRoot', 'windir', 'SystemDrive', 'ComSpec', 'PATHEXT', 'PATH', 'LANG'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]))
const packHome = join(output, 'pack-home'); mkdirSync(packHome)
const packEnv = { ...baseEnv, HOME: packHome, USERPROFILE: packHome, NPM_CONFIG_USERCONFIG: join(packHome, 'npmrc'), NPM_CONFIG_GLOBALCONFIG: join(packHome, 'global-npmrc'), NPM_CONFIG_CACHE: join(packHome, 'cache') }
writeFileSync(packEnv.NPM_CONFIG_USERCONFIG, ''); writeFileSync(packEnv.NPM_CONFIG_GLOBALCONFIG, '')
let registry, live, processNumber = 0
const registryEvents = []
try {
  const packed = JSON.parse(await command('candidate-pack', [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], source, packEnv))[0]
  const packages = fixturePackages(readFileSync(oldFile), readFileSync(join(output, packed.filename)))
  report.packages = packages.map(({ role, version, sha256 }) => ({ role, version, sha256 }))
  registry = await startRegistry(packages, (event) => { registryEvents.push(event); appendFileSync(join(output, 'registry-requests.jsonl'), JSON.stringify(event) + '\n') })
  const observer = join(output, 'observer'); mkdirSync(observer)
  writeFileSync(join(observer, 'package.json'), JSON.stringify({ name: 'dsh-native-update-observer', version: '1.0.0', type: 'module', main: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(observer, 'cordis.patch.yml'), '- insert:\n    - id: native-update-observer\n      name: dsh-native-update-observer\n')
  writeFileSync(join(observer, 'index.mjs'), `
export function apply(ctx) {
  ctx.inject(['connection', 'pluginManager'], (scope) => {
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/native-update-check',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await request.json(), manager = scope.pluginManager
          let value = null
          if (body.action === 'status') value = { hmr: scope.get('hmr') !== undefined, bundles: await manager.listBundles() }
          if (body.action === 'versions') value = await manager.listVersions('dsh-custom-mode', {})
          if (body.action === 'update') value = await manager.updateBundle('dsh-custom-mode', ${JSON.stringify(targetVersion)}, { requestId: 'synthetic-native-update' })
          return Response.json({ ok: true, value })
        } catch (error) {
          return Response.json({ ok: false, error: String(error) }, { status: 500 })
        }
      },
    }))
  })
}
`)
  const entry = join(output, 'host-entry.mjs')
  writeFileSync(entry, `import {pathToFileURL} from 'node:url';const {runCli}=await import(pathToFileURL(process.env.DSH_NATIVE_HOST_BIN).href);process.argv=[process.execPath,process.env.DSH_NATIVE_HOST_BIN,...process.argv.slice(2)];await runCli({packageManager:{command:process.execPath,args:[process.env.DSH_NATIVE_PNPM],env:JSON.parse(process.env.DSH_NATIVE_PM_ENV)}})`)
  await command('observer-syntax', ['--check', join(observer, 'index.mjs')], output, packEnv)
  await command('host-entry-syntax', ['--check', entry], output, packEnv)
  async function scenario(label, version, hmr) {
    const directory = join(output, label); mkdirSync(directory)
    const home = join(directory, 'dsh-home'), isolated = join(directory, 'isolation'); mkdirSync(home); mkdirSync(isolated)
    const env = { ...baseEnv, DSH_HOME: home, HOME: isolated, USERPROFILE: isolated, APPDATA: join(isolated, 'appdata'), LOCALAPPDATA: join(isolated, 'localappdata'), XDG_CONFIG_HOME: join(isolated, 'config'), XDG_CACHE_HOME: join(isolated, 'cache'), PNPM_HOME: join(isolated, 'pnpm-home'), NPM_CONFIG_USERCONFIG: join(isolated, 'npmrc'), NPM_CONFIG_GLOBALCONFIG: join(isolated, 'global-npmrc'), NPM_CONFIG_CACHE: join(isolated, 'npm-cache'), NPM_CONFIG_REGISTRY: registry.base, PNPM_CONFIG_REGISTRY: registry.base, PNPM_CONFIG_STORE_DIR: join(isolated, 'store'), PNPM_CONFIG_UPDATE_NOTIFIER: 'false', DSH_TELEMETRY_DISABLED: '1', DSH_NATIVE_HOST_BIN: bin, DSH_NATIVE_PNPM: pnpm, PATH: join(host, 'node_modules', '.bin') + delimiter + (baseEnv.PATH ?? ''), NODE_OPTIONS: '--import=' + pathToFileURL(join(source, 'tools', 'loopback-test-guard.mjs')).href, DSH_TEST_GUARD_LOG: join(directory, 'blocked-network.jsonl') }
    writeFileSync(env.NPM_CONFIG_USERCONFIG, `registry=${registry.base}\n@deepseek-ai:registry=${registry.base}\nfetch-retries=0\nstore-dir=${join(isolated, 'store').replaceAll('\\', '/')}\n`); writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '')
    env.DSH_NATIVE_PM_ENV = JSON.stringify(Object.fromEntries(Object.entries(env).filter(([key]) => /^(NPM_|PNPM_|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|XDG_|NODE_OPTIONS$|DSH_TEST_GUARD_LOG$)/.test(key))))
    await command(label + '-install-old', [entry, 'plugin', '--profile', 'web', 'add', '--save-exact', `${packageName}@${version}`], directory, env)
    await command(label + '-install-observer', [entry, 'plugin', '--profile', 'web', 'add', observer], directory, env)
    writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), `- id: plugin-manager\n  config:\n    registry: ${registry.base}\n    fallbackRegistries: []\n${hmr ? '' : '- id: hmr\n  disabled: true\n'}`)
    writeFileSync(join(home, 'settings.yaml'), 'locale: en\n')
    const port = await new Promise((done, fail) => { const socket = createServer(); socket.once('error', fail); socket.listen(0, '127.0.0.1', () => { const n = socket.address().port; socket.close(() => done(n)) }) })
    async function start() {
      const sequence = ++processNumber, child = spawn(process.execPath, [entry, '--profile', 'web', '--port', String(port), '--no-open'], { cwd: directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      child.stdout.on('data', (data) => { stdout += data }); child.stderr.on('data', (data) => { stderr += data }); child.on('error', (error) => { stderr += error.message })
      live = { child, async stop() { if (child.exitCode === null && child.signalCode === null) { const exit = new Promise((done) => child.once('exit', done)); child.kill('SIGTERM'); await Promise.race([exit, pause(15000)]); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([exit, pause(3000)]) } } writeFileSync(join(output, `${label}-host-${sequence}.log`), redact(stdout + '\n' + stderr)); live = undefined } }
      let auth, cookie
      const deadline = Date.now() + 90000
      while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) { auth = stdout.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)?.[0]; if (auth) break; await pause(200) }
      assert.ok(auth, 'isolated host startup URL missing')
      const login = await fetch(auth, { redirect: 'manual' }); cookie = login.headers.getSetCookie().map((part) => part.split(';')[0]).join('; ')
      async function request(path, body) { const response = await fetch(`http://127.0.0.1:${port}` + path, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: `http://127.0.0.1:${port}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180000) }); const data = await response.json(); return { status: response.status, data } }
      for (let n = 0; n < 100; n++) { const ready = await request('/api/native-update-check', { action: 'status' }).catch(() => null); if (ready?.data.ok) return request; await pause(200) }
      throw new Error('Official manager observer did not become ready')
    }
    let request = await start()
    check(label + ': exact HMR capability', (await request('/api/native-update-check', { action: 'status' })).data.value.hmr === hmr)
    const created = await request('/api/custom-mode/create', { name: 'Synthetic native update', posture: 'chat', locale: 'en' }); assert.ok(created.data.id)
    const id = created.data.id
    const assistant = join(home, '.agent-presets', id)
    const userSnapshot = () => Object.fromEntries(readdirSync(assistant).filter((name) => !['prompt-reader.mjs', 'prompt-tool.mjs'].includes(name) && !name.startsWith('.')).map((name) => [name, hash(readFileSync(join(assistant, name)))]))
    async function canSave(marker) { const state = (await request('/api/custom-mode/state?id=' + id)).data; const response = await request('/api/custom-mode/state', { id, mode: state.mode, overrides: state.overrides, prompt: marker, name: state.name, description: state.description ?? '', baseRevision: state.revision, baseN: Math.max(0, ...(state.history ?? []).map((item) => item.n)) }); const after = (await request('/api/custom-mode/state?id=' + id)).data; return response.data.ok === true && after.ok === true && !after.broken && after.prompt === marker && readFileSync(join(assistant, 'prompt.md'), 'utf8') === marker }
    check(label + ': old package edits and saves', await canSave('SYNTHETIC BEFORE UPDATE\n'))
    const before = userSnapshot()
    const versions = await request('/api/native-update-check', { action: 'versions' })
    check(label + ': official manager finds candidate', versions.status === 200 && versions.data?.ok === true && versions.data.value?.status === 'listed' && versions.data.value.versions?.some((item) => item.version === targetVersion))
    if (label === 'failure-recovery') {
      const eventStart = registryEvents.length
      registry.failTarget(true)
      const failed = await request('/api/native-update-check', { action: 'update' })
      const installedAfterRestore = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'node_modules', packageName, 'package.json'), 'utf8')).version
      const restoredRuntime = await request('/api/custom-mode')
      const runningAfterRestore = restoredRuntime.data?.version
      const restoredOutcome = matchesUpdateOutcome(failed, { from: version, to: targetVersion, application: 'failed', restoreApplication: 'applied' })
      const targetDownload503 = registryEvents.slice(eventStart).some((event) => event.route === 'tarball' && event.version === targetVersion && event.status === 503)
      const restoredVersions = installedAfterRestore === version && restoredRuntime.status === 200 && restoredRuntime.data?.ok === true && runningAfterRestore === version
      const preserved = JSON.stringify(userSnapshot()) === JSON.stringify(before)
      const savesWithoutRestart = targetDownload503 && restoredOutcome && restoredVersions && preserved && await canSave('SYNTHETIC AFTER RESTORE\n')
      recordOutcome(label + '-restore', failed, { installedVersion: installedAfterRestore, runningVersion: runningAfterRestore })
      report.outcomes.at(-1).targetDownload503 = targetDownload503
      saveReport()
      check(label + ': target tar 503 restores installed/running fixed-old, preserves files and saves without restart', targetDownload503 && restoredOutcome && restoredVersions && preserved && savesWithoutRestart)
      registry.failTarget(false)
    }
    const baseline = userSnapshot(), updateResponse = await request('/api/native-update-check', { action: 'update' })
    recordOutcome(label, updateResponse)
    check(label + ': official manager installs candidate with exact outcome', matchesUpdateOutcome(updateResponse, { from: version, to: targetVersion, application: hmr ? 'applied' : 'restart-required' }))
    const installed = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'node_modules', packageName, 'package.json'), 'utf8')).version
    const running = (await request('/api/custom-mode')).data.version
    check(label + ': installed version and unchanged user files', installed === targetVersion && JSON.stringify(userSnapshot()) === JSON.stringify(baseline))
    if (!hmr) check(label + ': installed and running versions differ before restart', running === version)
    if (label === 'failure-recovery') check(label + ': healthy HMR candidate runs and saves', running === targetVersion && await canSave('SYNTHETIC HEALTHY HMR\n'))
    const preRestart = userSnapshot(); await live.stop(); request = await start()
    check(label + ': one restart runs candidate and preserves files', (await request('/api/custom-mode')).data.version === targetVersion && JSON.stringify(userSnapshot()) === JSON.stringify(preRestart))
    check(label + ': candidate saves after restart', await canSave('SYNTHETIC AFTER RESTART\n'))
    await live.stop()
  }
  await scenario('public-226-migration', '2.2.6', true)
  await scenario('failure-recovery', '2.2.7', true)
  await scenario('no-hmr', '2.2.7', false)
} catch (error) {
  report.checks.push({ label: 'integration exception', passed: false, error: redact(error.message) }); saveReport(); console.error(redact(error.stack)); process.exitCode = 1
} finally { if (live) await live.stop(); if (registry) await registry.close(); saveReport() }
