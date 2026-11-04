#!/usr/bin/env node
/** Read only, public npm identity gate. Never reads npm configuration or credentials. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const digest = (bytes, algorithm, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
const failure = (message, code, retryable = false) => Object.assign(new Error(message), { code, retryable })
export async function verifyPublicPackage({ version, commit, archive, fetcher = fetch, observe = () => {} }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^[a-f0-9]{40}$/.test(commit ?? '') || !Buffer.isBuffer(archive)) throw failure('Invalid local release identity', 'invalid-input')
  const response = await fetcher(`https://registry.npmjs.org/dsh-custom-mode/${version}`, { signal: AbortSignal.timeout(30000), cache: 'no-store', redirect: 'error' })
  observe({ resource: 'metadata', status: response.status })
  if (response.status === 404) throw failure('Exact npm version is absent', 'missing', true)
  if (!response.ok) throw failure('Public npm metadata request failed', 'metadata-http', response.status >= 500)
  const metadata = await response.json()
  if (metadata.name !== 'dsh-custom-mode' || metadata.version !== version || metadata.gitHead !== commit) throw failure('Published package identity or gitHead differs from the release commit', 'identity-mismatch')
  const url = new URL(metadata.dist?.tarball ?? '')
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.search || url.hash) throw failure('Published tarball is not an unauthenticated public npm URL', 'tarball-location')
  const download = await fetcher(url.href, { signal: AbortSignal.timeout(30000), cache: 'no-store', redirect: 'error' })
  observe({ resource: 'tarball', status: download.status })
  if (!download.ok) throw failure('Public npm tarball request failed', 'tarball-http', download.status >= 500)
  const bytes = Buffer.from(await download.arrayBuffer())
  if (!bytes.equals(archive)) throw failure('Published tarball bytes differ from the fixed release archive', 'bytes-mismatch')
  if (metadata.dist.integrity !== 'sha512-' + digest(bytes, 'sha512', 'base64') || metadata.dist.shasum !== digest(bytes, 'sha1')) throw failure('Published integrity metadata differs from the verified tarball', 'integrity-mismatch')
  return { name: metadata.name, version, gitHead: commit, bytes: bytes.length, sha256: digest(bytes, 'sha256') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = (name) => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] }
  const file = option('archive'), commit = option('commit'), attempts = Number(option('attempts') ?? 1), delay = Number(option('delay-ms') ?? 10000)
  if (!file || !/^[a-f0-9]{40}$/.test(commit ?? '') || !Number.isInteger(attempts) || attempts < 1 || attempts > 12 || !Number.isInteger(delay) || delay < 0 || delay > 10000) throw new Error('Use --archive <fixed .tgz> --commit <full SHA> [--attempts 1..12 --delay-ms 0..10000]')
  const version = /^dsh-custom-mode-(\d+\.\d+\.\d+)\.tgz$/.exec(basename(file))?.[1]
  const archive = readFileSync(file)
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const verified = await verifyPublicPackage({ version, commit, archive, observe: (event) => console.log(JSON.stringify({ attempt, ...event })) })
      console.log(JSON.stringify({ verified: true, attempt, ...verified }))
      break
    } catch (error) {
      console.error(JSON.stringify({ verified: false, attempt, code: error.code ?? 'request-failed', error: error.message }))
      if (!error.retryable || attempt === attempts) { process.exitCode = error.code === 'missing' ? 3 : 1; break }
      await new Promise((done) => setTimeout(done, delay))
    }
  }
}
