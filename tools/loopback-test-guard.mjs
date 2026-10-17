/** Test child only: stop network egress before any external TCP/fetch request. */
import net from 'node:net'
import { appendFileSync } from 'node:fs'
const local = host => host === undefined || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)
function reject(host) {
  if (process.env.DSH_TEST_GUARD_LOG) appendFileSync(process.env.DSH_TEST_GUARD_LOG, JSON.stringify({ blockedHost: String(host), beforeConnect: true }) + '\n', { mode:0o600 })
  throw new Error('Isolated plugin acceptance blocks external network access')
}
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const host = typeof first === 'object' && first !== null && 'port' in first ? first.host : typeof first === 'number' && typeof args[1] === 'string' ? args[1] : undefined
  if (!local(host)) reject(host)
  return connect.apply(this,args)
}
const originalFetch = globalThis.fetch
globalThis.fetch = (input,init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  if (!local(url.hostname)) reject(url.hostname)
  return originalFetch(input,init)
}
