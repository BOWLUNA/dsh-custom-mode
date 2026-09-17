/**
 * 双语配对一致性校验（对应 DSH 官方仓库的 `verify-translation-pairing`）。
 *
 * 上游的做法：`README.md` 与 `README.zh.md` 是**有同等权威**的两份文档，谁改了都得把另一份
 * 带上，然后用 `README.i18n.yaml` 记录两边当时的 git blob 哈希。这样"某一侧悄悄落后"会被
 * 直接拦住，而不是等到有人切语言时才发现。
 *
 * 用法:
 *   node tools/verify-translation-pairing.mjs           # 校验，不一致则退出 1
 *   node tools/verify-translation-pairing.mjs --write   # 把当前哈希重新记录进 i18n.yaml
 *
 * 这里不依赖 git 命令行：git 的 blob 哈希就是 sha1("blob <字节数>\0" + 内容)，自己算即可。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))

/** 需要成对维护的文档：记录文件 → 两侧正文。 */
const PAIRS = [
  { record: 'README.i18n.yaml', files: ['README.md', 'README.zh.md'] },
  { record: 'CONTRIBUTING.i18n.yaml', files: ['CONTRIBUTING.md', 'CONTRIBUTING.zh.md'] },
]

/** git 的 blob 哈希：sha1("blob <len>\0" + content)。与 `git hash-object` 一致。 */
function blobHash(text) {
  const body = Buffer.from(text, 'utf8')
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`, 'utf8'), body])).digest('hex')
}

/** 从 i18n.yaml 里读出 `文件: 哈希` 记录（只认这两种行，别的都当注释）。 */
function readRecord(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([^\s#][^:]*):\s*([0-9a-f]{40})\s*$/.exec(line)
    if (match !== null) out[match[1].trim()] = match[2]
  }
  return out
}

const write = process.argv.includes('--write')
let failures = 0

for (const pair of PAIRS) {
  const recordPath = join(REPO, pair.record)
  const recorded = readRecord(recordPath)
  const actual = {}
  let missing = false
  for (const file of pair.files) {
    const full = join(REPO, file)
    if (!existsSync(full)) {
      console.error(`✗ ${pair.record}: 缺少 ${file}`)
      missing = true
      failures += 1
      continue
    }
    actual[file] = blobHash(readFileSync(full, 'utf8'))
  }
  if (missing) continue

  if (write) {
    const lines = [
      '# 双语配对一致性记录：两侧在「上次确认一致」时的 git blob 哈希。',
      '# 两份文档权威相同——改完任意一侧，请把另一侧也改掉，然后重新记录：',
      '#   node tools/verify-translation-pairing.mjs --write',
      ...pair.files.map((file) => `${file}: ${actual[file]}`),
      '',
    ]
    writeFileSync(recordPath, lines.join('\n'), 'utf8')
    console.log(`✓ ${pair.record} 已重新记录`)
    continue
  }

  const drifted = pair.files.filter((file) => recorded[file] !== actual[file])
  if (recorded[pair.files[0]] === undefined) {
    console.error(`✗ ${pair.record} 里没有 ${pair.files[0]} 的记录`)
    failures += 1
  } else if (drifted.length > 0) {
    console.error(`✗ ${pair.record}: 这些文件在上次记录之后被改过 → ${drifted.join('、')}`)
    console.error('  两份文档权威相同：请确认另一侧也跟上了，然后执行')
    console.error('    node tools/verify-translation-pairing.mjs --write')
    failures += 1
  } else {
    console.log(`✓ ${pair.record} 两侧与记录一致`)
  }
}

if (failures > 0 && !write) {
  console.error('')
  console.error(`${failures} 组配对不一致。这不是"格式问题"：它保证两种语言不会悄悄分叉。`)
  process.exit(1)
}
