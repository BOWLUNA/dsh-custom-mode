#!/usr/bin/env node
/**
 * Regenerate the dictionaries inlined in `editor/client.js` from `editor/locales.mjs`.
 *
 * Why this exists: the browser bundle cannot import (it is a plain script the module
 * system evaluates), so its ZH/EN copies are written into the file. Hand-copying them
 * is what `test/locales.test.mjs` guards against — and the guard is right to exist, but
 * it only tells you that you forgot. This closes the loop: one source of truth
 * (`locales.mjs`), one command to propagate it.
 *
 * Usage: node tools/sync-client-dictionaries.mjs [--check]
 *   (no flag)  rewrite client.js in place
 *   --check    exit 1 when client.js is out of date, without writing
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zh, en } from '../editor/locales.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(REPO, 'editor', 'client.js')
const OPEN = '      const ZH = {'
const TRANSLATIONS = '      const TRANSLATIONS = { zh: ZH, en: EN }'

/** Render one dictionary exactly as it appears in the bundle. */
const block = (name, obj) =>
  '      const ' + name + ' = ' + JSON.stringify(obj, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : '      ' + line))
    .join('\n')

const current = readFileSync(CLIENT, 'utf8')
const start = current.indexOf(OPEN)
const end = current.indexOf(TRANSLATIONS)
if (start === -1 || end === -1 || end < start) {
  console.error('sync-client-dictionaries: 找不到 client.js 里的 ZH / TRANSLATIONS 区块。')
  console.error('若 bundle 结构变了，请同步更新本工具。')
  process.exit(1)
}

const next = current.slice(0, start) + block('ZH', zh) + '\n\n' + block('EN', en) + '\n\n' + current.slice(end)
const stale = next !== current

if (process.argv.includes('--check')) {
  if (stale) {
    console.error('client.js 的内联词典与 locales.mjs 不一致；运行 node tools/sync-client-dictionaries.mjs 同步。')
    process.exit(1)
  }
  console.log('内联词典与 locales.mjs 一致。')
  process.exit(0)
}

if (!stale) {
  console.log('内联词典已经是最新的，无需改动。')
  process.exit(0)
}
writeFileSync(CLIENT, next)
console.log('已从 locales.mjs 重新生成 client.js 的内联词典。')
