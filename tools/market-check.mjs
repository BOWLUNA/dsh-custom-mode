#!/usr/bin/env node
/** Read-only adapters for the three documented DSH market catalogs.
 * --out <report.json> [--fixture-dir <directory>] or --self-test.
 * Catalog commands are informational only and are never executed.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const repository = 'BOWLUNA/dsh-custom-mode'
const repoUrl = 'https://github.com/' + repository
const sources = [
  { id: 'dshmarket', url: 'https://awesome-dsh-plugin.com/plugins.json', repo: 'https://github.com/dsh-market/dsh-market' },
  { id: 'hub', url: 'https://api.dsh-plugin.org/plugins.en.json', repo: 'https://github.com/dshplugin/dsh-plugin-hub' },
  { id: 'store', url: 'https://dshmarketplace.dev/api/v1/plugins?q=dsh-custom-mode&limit=5', repo: 'https://github.com/DshMarketPlace/dsh-plugins-store' },
]
const rows = (payload) => {
  if (Array.isArray(payload)) return payload
  for (const key of ['plugins', 'results', 'items']) if (Array.isArray(payload?.[key])) return payload[key]
  throw new Error('Unsupported catalog envelope')
}
function normalize(id, raw) {
  if (id === 'dshmarket') return { name: raw.name, repo: raw.url, npm: raw.npm, version: raw.version, verified: null }
  if (id === 'hub') {
    const short = typeof raw.s === 'string'
    const source = short ? raw.r : raw.source
    return { name: short ? raw.s : raw.slug, repo: typeof source === 'string' ? source : source?.repo,
      npm: typeof source === 'object' && source ? source.npmPackage : undefined,
      version: short ? raw.vr : raw.version, verified: true,
      webInstallable: (short ? raw.wi : raw.install?.webInstallable) !== false }
  }
  if (id === 'store') return { name: raw.fullName, repo: raw.repoUrl ?? raw.url, npm: raw.npmPackage,
    verified: raw.installCheck === 'passed', webInstallable: raw.installable === true, subpath: raw.subpath }
  throw new Error('Unknown market: ' + id)
}
function ownEntry(entry) {
  if (typeof entry.repo !== 'string') return false
  if (entry.repo.toLowerCase() === repository.toLowerCase()) return true
  try {
    const url = new URL(entry.repo)
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.replace(/\/$/, '').replace(/\.git$/, '').toLowerCase() === '/' + repository.toLowerCase()
  } catch { return false }
}
function installation(entry) {
  if (!ownEntry(entry) || entry.subpath || /#editor$/.test(entry.name ?? '')) return null
  // Only our verified repository/package identity may produce a plan. Never interpret ic/cmd/install.
  if (entry.npm === manifest.name) return ['plugin', '--profile', 'web', 'add', `${manifest.name}@${manifest.version}`]
  if (!entry.npm) return ['plugin', '--profile', 'web', 'add', 'github:' + repository]
  return null
}
function contract() {
  const problems = []
  if (manifest.name !== 'dsh-custom-mode' || manifest.private === true || manifest.license !== 'MIT') problems.push('Public package identity/license')
  if (manifest.repository?.url !== 'git+' + repoUrl + '.git') problems.push('Repository identity')
  if (!manifest.dsh?.bundle?.patch || !existsSync(join(root, manifest.dsh.bundle.patch))) problems.push('Bundle patch missing')
  if (manifest.dsh?.client?.platform !== 'web' || !existsSync(join(root, manifest.exports?.['./client'] ?? '__missing'))) problems.push('Browser export missing')
  if (manifest.engines?.dsh !== manifest.peerDependencies?.['@deepseek-ai/dsh']) problems.push('Compatibility declarations disagree')
  if (['preinstall', 'install', 'postinstall', 'prepare'].some((key) => manifest.scripts?.[key])) problems.push('Install requires build scripts')
  return problems
}
const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] }
if (args.includes('--self-test')) {
  assert.deepEqual(contract(), [])
  const registry = normalize('dshmarket', { name: repository, url: repoUrl, npm: manifest.name })
  const hub = normalize('hub', { s: repository, r: { repo: repoUrl, npmPackage: manifest.name }, ic: 'echo untrusted; exit 1' })
  const longHub = normalize('hub', { slug: repository, source: { repo: repoUrl }, install: { webInstallable: false } })
  const store = normalize('store', { fullName: repository, repoUrl, npmPackage: manifest.name, installable: true, installCheck: 'passed' })
  for (const entry of [registry, hub, store]) assert.deepEqual(installation(entry), ['plugin', '--profile', 'web', 'add', 'dsh-custom-mode@' + manifest.version])
  assert.equal(longHub.webInstallable, false)
  assert.deepEqual(installation(longHub), ['plugin', '--profile', 'web', 'add', 'github:' + repository])
  assert.equal(installation({ ...registry, repo: repoUrl + '/tree/main/editor' }), null)
  assert.equal(installation({ ...registry, subpath: 'editor' }), null)
  assert.equal(installation({ ...registry, name: repository + '#editor' }), null)
  assert.equal(installation({ ...registry, npm: 'other-package' }), null)
  assert.equal(installation({ ...registry, repo: repoUrl + '-spoof' }), null)
  assert.deepEqual(installation({ ...registry, repo: repoUrl.toLowerCase() }), installation(registry))
  assert.equal(installation({ ...registry, repo: 'https://github.com.evil.example/' + repository }), null)
  assert.equal(normalize('store', { installCheck: null }).verified, false)
  assert.equal(rows({ results: [store] }).length, 1)
  assert.throws(() => rows({ error: 'temporarily unavailable' }), /Unsupported catalog envelope/)
  console.log('PASS market contracts: three schemas, root-only identity, stale paths, verification, safe install argv')
} else {
  if (!option('out')) { console.error('Use --out <report.json> or --self-test'); process.exit(2) }
  const report = { checkedAt: new Date().toISOString(), package: `${manifest.name}@${manifest.version}`, contractProblems: contract(), markets: [] }
  for (const source of sources) {
    try {
      let payload
      if (option('fixture-dir')) payload = JSON.parse(readFileSync(join(resolve(option('fixture-dir')), source.id + '.json'), 'utf8'))
      else {
        const response = await fetch(source.url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        payload = await response.json()
      }
      const all = rows(payload)
      if (!Array.isArray(all)) throw new Error('Unsupported catalog envelope')
      const matches = all.map((raw) => normalize(source.id, raw)).filter((entry) => ownEntry(entry) || (entry.name ?? '').toLowerCase().includes(repository.toLowerCase()))
      report.markets.push({ ...source, status: matches.length ? 'found' : 'not-listed', entries: matches.map((entry) => ({ ...entry, installArgv: installation(entry),
        issue: !installation(entry) ? 'obsolete-or-untrusted-identity' : entry.verified === false ? 'not-install-verified' : entry.webInstallable === false ? 'cli-only' : null })) })
    } catch (error) { report.markets.push({ ...source, status: 'unavailable', error: error.message }) }
  }
  writeFileSync(resolve(option('out')), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.contractProblems.length ? 1 : 0
}
