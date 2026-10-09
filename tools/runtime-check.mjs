#!/usr/bin/env node
/** Run API, rendered UI, uninstall and reinstall checks on compat-check's packed install.
 * --host-install <directory> --out <compat evidence> --browser <Chrome executable>
 * [--port 32110] [--cdp-port 9229] [--api-only]. Uses only the generated boot-home.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import net from 'node:net'
import { dirname, join, resolve, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] }
const output = option('out') && resolve(option('out'))
const host = option('host-install') && resolve(option('host-install'))
const browserPath = option('browser') ?? process.env.DSH_TEST_BROWSER
const apiOnly = args.includes('--api-only')
if (!output || !host || (!browserPath && !apiOnly) || !existsSync(join(output, 'report.json'))) {
  console.error('First run compat-check; then pass --host-install, --out and --browser.')
  process.exit(2)
}
const compatibility = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'))
if (compatibility.checks.some((check) => !check.passed)) { console.error('Compatibility checks must pass first.'); process.exit(2) }
const home = join(output, 'boot-home')
const candidate = join(output, 'candidate')
const bin = join(host, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const tools = dirname(fileURLToPath(import.meta.url))
const port = Number(option('port') ?? 32110)
const cdp = Number(option('cdp-port') ?? 9229)
if (![port, cdp].every((value) => Number.isInteger(value) && value >= 1024 && value <= 65535) || port === cdp || home === join(homedir(), '.dsh')) {
  console.error('Use two distinct unprivileged test ports and an isolated home.'); process.exit(2)
}
const env = { ...process.env, DSH_HOME: home, CDP_PORT: String(cdp), NPM_CONFIG_USERCONFIG: join(output, 'npmrc'),
  PATH: join(host, 'node_modules', '.bin') + delimiter + process.env.PATH }
const report = { hostVersion: compatibility.hostVersion, packageVersion: compatibility.packageVersion, browserSkipped: apiOnly, checks: [] }
const redact = (value) => String(value ?? '').replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (label, ok, details = {}) => {
  report.checks.push({ label, passed: Boolean(ok), ...details })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${report.hostVersion} ${label}`)
  writeFileSync(join(output, apiOnly ? 'runtime-api-report.json' : 'runtime-report.json'), JSON.stringify(report, null, 2) + '\n')
}
let server, browser, stdout = '', stderr = '', launch = 0
async function stopServer() {
  if (!server || server.exitCode !== null) return
  const stopped = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  await Promise.race([stopped, pause(15000)])
  if (server.exitCode === null) server.kill('SIGKILL')
  writeFileSync(join(output, `server-${launch}-sanitized.log`), redact(stdout + '\n' + stderr))
}
async function startServer() {
  launch += 1; stdout = ''; stderr = ''
  server = spawn(process.execPath, [bin, '--profile', 'web', '--port', String(port), '--no-open'],
    { cwd: candidate, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  server.stdout.on('data', (data) => { stdout += data })
  server.stderr.on('data', (data) => { stderr += data })
  const deadline = Date.now() + 90000
  let auth
  while (Date.now() < deadline && server.exitCode === null) {
    auth = stdout.match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_-]+`))?.[0]
    if (auth) break
    await pause(250)
  }
  if (!auth) throw new Error('No startup URL: ' + redact(stderr).slice(-1600))
  const login = await fetch(auth, { redirect: 'manual' })
  const cookie = login.headers.getSetCookie().map((part) => part.split(';')[0]).join('; ')
  const base = `http://127.0.0.1:${port}`
  return { auth, base, request: async (path, body) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
      headers: { Cookie: cookie, Origin: base, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : null }
  } }
}
function packageOperation(...argv) {
  const result = spawnSync(process.execPath, [bin, 'plugin', '--profile', 'web', ...argv],
    { cwd: candidate, env, encoding: 'utf8', timeout: 180000, windowsHide: true })
  writeFileSync(join(output, `plugin-${argv[0]}-${report.checks.length}.log`), redact((result.stdout ?? '') + (result.stderr ?? '')))
  check('plugin ' + argv[0], result.status === 0, { exitCode: result.status })
  if (result.status !== 0) throw new Error('Plugin operation failed: ' + argv[0])
}
try {
  for (const testPort of apiOnly ? [port] : [port, cdp]) {
    await new Promise((resolve, reject) => {
      const socket = net.createServer()
      socket.once('error', reject)
      socket.listen(testPort, '127.0.0.1', () => socket.close(resolve))
    })
  }
  const settingsFile = join(home, 'settings.yaml')
  let settings = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : ''
  if (!/^locale:/m.test(settings)) settings += '\nlocale: zh\n'
  writeFileSync(settingsFile, settings)
  let live = await startServer()
  check('unauthenticated state is rejected', (await fetch(live.base + '/api/custom-mode/state?id=custom')).status === 401)
  const roster = await live.request('/api/custom-mode')
  check('plugin roster answers', roster.status === 200 && roster.data.ok)
  const initial = await live.request('/api/custom-mode/state?id=custom')
  check('base rows load without degradation', initial.data.ok && !initial.data.baseUnavailable && !initial.data.broken && initial.data.rows.length > 0)
  const created = await live.request('/api/custom-mode/create', { name: 'Mock lifecycle sample', posture: 'chat', locale: 'en' })
  check('create assistant', created.data.ok)
  if (!created.data.id) throw new Error('No created assistant ID')
  const id = created.data.id
  const promptFile = join(home, '.agent-presets', id, 'prompt.md')
  const sample = 'Mock compatibility prompt. Model: {{model}}.\n'
  for (const mode of ['standard', 'ptc', 'minimal', 'cordis', 'all']) {
    const saved = await live.request('/api/custom-mode/state', { id, mode, overrides: {}, prompt: sample, name: 'Mock lifecycle sample', description: '' })
    const reread = await live.request('/api/custom-mode/state?id=' + encodeURIComponent(id))
    check('save and mount base mode ' + mode, saved.data.ok && reread.data.ok && !reread.data.broken && !reread.data.baseUnavailable && reread.data.mode === mode && reread.data.prompt === sample,
      { saveCode: saved.data.code, actualMode: reread.data.mode, broken: reread.data.broken, unavailable: reread.data.baseUnavailable, unresolvable: reread.data.unresolvable })
  }
  const repeated = await live.request('/api/custom-mode/state', { id, mode: 'all', overrides: {}, prompt: sample, name: 'Mock lifecycle sample', description: '' })
  check('repeated save preserves prompt bytes', repeated.data.ok && readFileSync(promptFile, 'utf8') === sample)
  if (!apiOnly) {
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    `--remote-debugging-port=${cdp}`, `--user-data-dir=${join(output, 'chrome-profile')}`, '--window-size=1440,1000', 'about:blank'],
    { windowsHide: true, stdio: 'ignore' })
  let ready = false
  for (let i = 0; i < 40; i += 1) { try { ready = (await fetch(`http://127.0.0.1:${cdp}/json/version`)).ok } catch {} if (ready) break; await pause(250) }
  if (!ready) throw new Error('Isolated headless browser did not become ready')
  for (const [script, picture, extra] of [['picker-probe.mjs', 'picker.png', ['--expect', '自定义模式']], ['browser-verify.mjs', 'settings.png', []]]) {
    const result = spawnSync(process.execPath, [join(tools, script), '--url', live.auth, '--out', join(output, picture), ...extra],
      { cwd: candidate, env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
    const log = redact((result.stdout ?? '') + (result.stderr ?? ''))
    writeFileSync(join(output, script + '.log'), log)
    check(script, result.status === 0, { exitCode: result.status })
    if (result.status !== 0) console.error(log.split('\n').filter((line) => /^FAIL|Error|failed|结果/.test(line)).slice(-12).join('\n'))
  }
  }
  await stopServer()
  const promptBefore = readFileSync(promptFile, 'utf8')
  const compositionFile = join(home, '.agent-presets', id, 'agent.cordis.yml')
  const compositionBefore = readFileSync(compositionFile, 'utf8')
  packageOperation('remove', 'dsh-custom-mode')
  const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
  check('uninstall removes bundle and keeps user data', !manifest.dependencies?.['dsh-custom-mode'] && !manifest.dsh.profile.bundles.includes('dsh-custom-mode') && readFileSync(promptFile, 'utf8') === promptBefore)
  live = await startServer()
  check('uninstalled settings route is absent', (await live.request('/api/custom-mode')).status === 404)
  await stopServer()
  packageOperation('add', join(output, `dsh-custom-mode-${report.packageVersion}.tgz`))
  packageOperation('add', join(output, `dsh-custom-mode-${report.packageVersion}.tgz`))
  live = await startServer()
  const restored = await live.request('/api/custom-mode/state?id=' + encodeURIComponent(id))
  check('reinstall preserves prompt and composition', restored.data.ok && !restored.data.broken && readFileSync(promptFile, 'utf8') === promptBefore && readFileSync(compositionFile, 'utf8') === compositionBefore)
  const after = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
  check('repeated install has one bundle entry', after.dsh.profile.bundles.filter((name) => name === 'dsh-custom-mode').length === 1)
  const removed = await live.request('/api/custom-mode/delete', { id })
  check('delete unregisters and removes assistant', removed.data.ok && !existsSync(join(home, '.agent-presets', id)))
} catch (error) { check('runtime exception', false, { error: redact(error.message) }) }
finally {
  if (browser) {
    try { process.env.CDP_PORT = String(cdp); const { connect } = await import('./screenshots/cdp.mjs'); const session = await connect(); session.sessionId = undefined; await session.send('Browser.close'); session.close() } catch {}
    browser.kill('SIGTERM')
  }
  await stopServer()
}
process.exitCode = report.checks.some((check) => !check.passed) ? 1 : 0
