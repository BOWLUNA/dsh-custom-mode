#!/usr/bin/env node
/** Synthetic public-registry responses exercise the same identity gate used by release.yml. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { verifyPublicPackage } from './verify-published-package.mjs'

const archive = Buffer.from('SYNTHETIC FIXED RELEASE ARCHIVE'), commit = 'a'.repeat(40), version = '2.3.1'
const hash = (algorithm, encoding = 'hex') => createHash(algorithm).update(archive).digest(encoding)
const metadata = () => ({ name: 'dsh-custom-mode', version, gitHead: commit, dist: { tarball: `https://registry.npmjs.org/dsh-custom-mode/-/dsh-custom-mode-${version}.tgz`, integrity: 'sha512-' + hash('sha512', 'base64'), shasum: hash('sha1') } })
let passed = 0, failed = 0
async function scenario(label, patch, expectedCode) {
  let calls = 0
  const fetcher = async () => {
    calls++
    if (calls === 1) return { status: patch.metadataStatus ?? 200, ok: (patch.metadataStatus ?? 200) === 200, json: async () => ({ ...metadata(), ...patch.metadata }) }
    return { status: patch.tarStatus ?? 200, ok: (patch.tarStatus ?? 200) === 200, arrayBuffer: async () => patch.bytes ?? archive }
  }
  try {
    let code
    try {
      const result = await verifyPublicPackage({ archive, version, commit, fetcher })
      assert.equal(result.gitHead, commit); assert.equal(result.sha256, hash('sha256'))
    } catch (error) { code = error.code ?? error.message }
    assert.equal(code, expectedCode)
    passed++; console.log('PASS ' + label)
  } catch (error) { failed++; console.error('FAIL ' + label + ': ' + error.message) }
}
await scenario('existing exact package accepted', {}, undefined)
await scenario('wrong gitHead rejected', { metadata: { gitHead: 'b'.repeat(40) } }, 'identity-mismatch')
await scenario('different tar bytes rejected', { bytes: Buffer.from('DIFFERENT SYNTHETIC ARCHIVE') }, 'bytes-mismatch')
await scenario('metadata HTTP failure rejected', { metadataStatus: 503 }, 'metadata-http')
await scenario('tarball HTTP failure rejected', { tarStatus: 503 }, 'tarball-http')
await scenario('absent exact package distinguished', { metadataStatus: 404 }, 'missing')
await scenario('wrong package version rejected', { metadata: { version: '2.3.0' } }, 'identity-mismatch')
await scenario('wrong integrity metadata rejected', { metadata: { dist: { ...metadata().dist, integrity: 'sha512-invalid' } } }, 'integrity-mismatch')
await scenario('external tarball host rejected', { metadata: { dist: { ...metadata().dist, tarball: 'https://example.invalid/package.tgz' } } }, 'tarball-location')
console.log(`Release package identity self-test: ${passed} passed, ${failed} failed (synthetic responses only)`)
process.exitCode = failed ? 1 : 0
