/** Controlled loopback npm fixture, extracted from the isolated 2.3.0 native-update lab.
 * The public old archive is kept byte-identical. Only the explicitly synthetic fixed-old
 * archive changes the candidate's package version. Nothing is published or proxied.
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { gunzipSync, gzipSync } from 'node:zlib'

export const packageName = 'dsh-custom-mode'
export const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
/** Fail closed on incomplete, cancelled, wrongly framed or transport-failed manager outcomes. */
export function matchesUpdateOutcome(response, { from, to, application, restoreApplication } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(from ?? '') || !/^\d+\.\d+\.\d+$/.test(to ?? '') || !['applied', 'restart-required', 'failed'].includes(application)) return false
  const value = response?.data?.value
  return response?.status === 200 && response?.data?.ok === true && value !== null && typeof value === 'object'
    && value.from === from && value.to === to && value.step === 'install'
    && value.result?.application === application
    && (restoreApplication === undefined ? value.restore === undefined : restoreApplication === 'applied' && value.restore?.application === restoreApplication)
}
function entries(archive) {
  const bytes = gunzipSync(archive), files = []
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const head = bytes.subarray(offset, offset + 512), name = head.subarray(0, 100).toString().replace(/\0.*$/s, '')
    if (!name) break
    const size = parseInt(head.subarray(124, 136).toString().replace(/\0.*$/s, '').trim() || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length || !name.startsWith('package/') || name.split('/').includes('..')) throw new Error('Unsupported or unsafe fixture archive')
    if (head[156] === 48 || head[156] === 0) files.push({ name, bytes: bytes.subarray(offset + 512, offset + 512 + size), mode: parseInt(head.subarray(100, 108).toString(), 8) })
    else if (head[156] !== 53) throw new Error('Fixture archive must contain only ordinary files/directories')
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}
function tar(files) {
  const buffers = []
  for (const item of files) {
    if (Buffer.byteLength(item.name) > 100) throw new Error('Fixture tar filename too long')
    const header = Buffer.alloc(512)
    header.write(item.name)
    const octal = (at, length, value) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', at, length, 'ascii')
    octal(100, 8, item.mode || 0o644); octal(108, 8, 0); octal(116, 8, 0)
    octal(124, 12, item.bytes.length); octal(136, 12, 1577836800)
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
    buffers.push(header, item.bytes, Buffer.alloc((512 - item.bytes.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...buffers, Buffer.alloc(1024)]))
}
export function fixturePackages(publicOld, candidate) {
  const manifest = (archive) => JSON.parse(entries(archive).find((item) => item.name === 'package/package.json')?.bytes.toString() ?? '{}')
  const old = manifest(publicOld), target = manifest(candidate)
  if (old.name !== packageName || old.version !== '2.2.6' || target.name !== packageName || !/^\d+\.\d+\.\d+$/.test(target.version) || target.version.localeCompare('2.2.7', 'en', { numeric: true }) <= 0) throw new Error('Expected public 2.2.6 and a stable candidate newer than the synthetic 2.2.7 fixture')
  const fixed = { ...target, version: '2.2.7' }
  const low = tar(entries(candidate).map((item) => item.name === 'package/package.json' ? { ...item, bytes: Buffer.from(JSON.stringify(fixed, null, 2) + '\n') } : item))
  return [{ role: 'public-old', manifest: old, bytes: publicOld }, { role: 'fixed-old-fixture', manifest: fixed, bytes: low }, { role: 'candidate', manifest: target, bytes: candidate }].map((item) => ({ ...item, version: item.manifest.version, sha256: hash(item.bytes), shasum: hash(item.bytes, 'sha1'), integrity: 'sha512-' + hash(item.bytes, 'sha512', 'base64') }))
}
export async function startRegistry(packages, record) {
  let failure = false, base
  const server = createServer((request, response) => {
    let route = 'unknown', version, status
    const reply = (code, body, type = 'application/json') => {
      status = code
      const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
      response.writeHead(code, { 'content-type': type, 'content-length': data.length, 'cache-control': 'no-store', connection: 'close' }); response.end(request.method === 'HEAD' ? undefined : data)
    }
    response.once('finish', () => record({ route, ...(version ? { version } : {}), status })) // No URLs, headers, cookies or bodies.
    if (!['GET', 'HEAD'].includes(request.method) || request.headers.host !== new URL(base).host || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return reply(403, { error: 'loopback read-only registry required' })
    const pathname = new URL(request.url, base).pathname
    const found = packages.find((item) => pathname === `/${packageName}/-/dsh-custom-mode-${item.version}.tgz`)
    const metadata = (item) => ({ ...item.manifest, _id: `${packageName}@${item.version}`, dist: { tarball: `${base}${packageName}/-/dsh-custom-mode-${item.version}.tgz`, shasum: item.shasum, integrity: item.integrity } })
    if (found) { route = 'tarball'; version = found.version; return failure && found.role === 'candidate' ? reply(503, { error: 'synthetic target download failure' }) : reply(200, found.bytes, 'application/octet-stream') }
    const selected = packages.find((item) => pathname === `/${packageName}/${item.version}`)
    if (selected) { route = 'version-metadata'; version = selected.version; return reply(200, metadata(selected)) }
    if (pathname !== '/' + packageName && pathname !== '/' + packageName + '/') return reply(404, { error: 'fixture package only' })
    route = 'package-metadata'
    reply(200, { name: packageName, _id: packageName, 'dist-tags': { latest: packages.find((item) => item.role === 'candidate').version }, versions: Object.fromEntries(packages.map((item) => [item.version, metadata(item)])), time: { created: '2020-01-01T00:00:00.000Z', modified: '2020-01-01T00:00:00.000Z', ...Object.fromEntries(packages.map((item) => [item.version, '2020-01-01T00:00:00.000Z'])) } })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}/`
  return { base, failTarget: (value) => { failure = value }, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}
