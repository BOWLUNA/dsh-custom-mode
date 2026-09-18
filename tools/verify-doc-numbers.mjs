#!/usr/bin/env node
/**
 * The documented numbers must match reality.
 *
 * **Why**: an external review found three drifts in one pass — `test/README.md` still advertised "8 suites",
 * `README.md` "12 suites, 588 checks", `CONTRIBUTING.md` "588 checks across twelve suites" — none of which the
 * test suite could see, because documentation is not executed. A number in a README is a claim like any other,
 * and this repository's rule is that claims are checked rather than remembered.
 *
 * What it does:
 *   1. runs `node test/run.mjs` and reads the real totals (checks + suites);
 *   2. extracts every count claim from the English documentation and compares it;
 *   3. asserts the declared dsh range appears in the package README and the repository README, and that the
 *      SECURITY support table's first row names the current package version.
 *
 * Run: node tools/verify-doc-numbers.mjs   (CI runs it after the suite)
 * Exit: 0 when every claim matches, 1 with the exact file:line and both values otherwise.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []

/** Run the suite and return the real totals. */
function measure() {
  const output = execFileSync(process.execPath, [join(REPO, 'test', 'run.mjs')], { cwd: REPO, encoding: 'utf8' })
  let checks = 0
  const suites = []
  for (const line of output.split('\n')) {
    const match = /^结果: (\d+) 通过, (\d+) 失败/.exec(line)
    if (match !== null) {
      checks += Number(match[1]) + Number(match[2])
      suites.push(match[0])
    }
  }
  const files = readdirSync(join(REPO, 'test')).filter((name) => name.endsWith('.test.mjs'))
  return { checks, suiteRuns: suites.length, suiteFiles: files.length, failed: /失败/.test(output) === false ? 0 : 1 }
}

/**
 * Count claims in a file.
 *
 * @param {string} rel - repository-relative path.
 * @param {RegExp} pattern - must capture the number in group 1.
 * @param {string} what - label used in the failure message.
 * @param {number} expected - the real value.
 */
function checkCount(rel, pattern, what, expected) {
  const text = readFileSync(join(REPO, rel), 'utf8')
  text.split('\n').forEach((line, index) => {
    const match = pattern.exec(line)
    if (match === null) return
    if (Number(match[1]) !== expected) {
      problems.push(`${rel}:${String(index + 1)} 说 ${what} 是 ${match[1]}，实际是 ${String(expected)}\n    ${line.trim()}`)
    }
  })
}

const real = measure()
if (real.suiteFiles !== real.suiteRuns) {
  problems.push(`test/ 下有 ${String(real.suiteFiles)} 个套件文件，但 run.mjs 只跑了 ${String(real.suiteRuns)} 个 —— 某个套件没被登记`)
}
console.log(`实际：${String(real.suiteRuns)} 个套件，${String(real.checks)} 项检查`)

// 1) 套件数与检查数
for (const rel of ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'test/README.md']) {
  checkCount(rel, /(\d+) suites?\b/, '套件数（suites）', real.suiteRuns)
  checkCount(rel, /(\d+) checks?\b/, '检查数（checks）', real.checks)
}
checkCount('README.zh.md', /(\d+) 个套件/, '套件数', real.suiteRuns)
checkCount('README.zh.md', /(\d+) 项检查/, '检查数', real.checks)

// 2) 声明的 dsh 范围必须出现在包 README 与仓库 README 里
const manifest = JSON.parse(readFileSync(join(REPO, 'editor', 'package.json'), 'utf8'))
const range = manifest.engines.dsh
for (const rel of ['README.md', 'editor/README.md']) {
  const text = readFileSync(join(REPO, rel), 'utf8')
  if (text.includes(range) === false) problems.push(`${rel} 里没有出现声明的 dsh 范围 ${range}`)
}

// 3) SECURITY 的支持表第一行必须写当前版本
const security = readFileSync(join(REPO, 'SECURITY.md'), 'utf8')
const firstRow = security.split('\n').find((line) => line.startsWith('| `') && line.includes('Supported'))
if (firstRow === undefined) {
  problems.push('SECURITY.md 的支持表里找不到第一行')
} else if (firstRow.includes(`\`${manifest.version}\``) === false) {
  problems.push(`SECURITY.md 支持表的第一行不是当前版本 ${manifest.version}\n    ${firstRow.trim()}`)
}

if (problems.length > 0) {
  console.error('')
  for (const problem of problems) console.error(`✗ ${problem}`)
  console.error('')
  console.error(`文档数字与实际不一致：${String(problems.length)} 处。改文档，不要改检查（检查读的是真实运行结果）。`)
  process.exit(1)
}
console.log(`✓ 文档里的数字与实际一致（${String(real.suiteRuns)} 套件 / ${String(real.checks)} 项 / dsh ${range} / 版本 ${manifest.version}）`)
