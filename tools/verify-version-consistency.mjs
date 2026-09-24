#!/usr/bin/env node
/**
 * Assert that the claim "this package supports dsh X" is true.
 *
 * The versioning policy changed on 2026-09-18: the package version is now its **own** line
 * (`1.0.0`, then `1.0.1`, …), not a mirror of the DSH release. Two things follow, and this script
 * checks both:
 *
 *  1. **The version must be a bare `x.y.z`.** Several directories and markets refuse to auto-install
 *     a version with a prerelease tag (one desktop market resolves npm `latest` and requires
 *     `prerelease(value) === null`), so "which DSH does this support" moved out of the version
 *     string and into `engines.dsh` / the peer range.
 *  2. **The DSH version CI actually installs and tests must satisfy those declarations.** That is
 *     the real invariant: a range that does not cover the tested runtime is a false claim, and
 *     nothing else links the two. Bumping the CI pin without widening the range, or lowering the
 *     range, fails here instead of shipping a package that claims support it never had.
 *
 * Two modes:
 *
 *   node tools/verify-version-consistency.mjs              # CI: the pinned DSH version must satisfy the ranges
 *   node tools/verify-version-consistency.mjs --dsh <ver>  # is THIS installed dsh inside the declared ranges?
 *
 * The second mode exists for `install.sh`: it used to compare the DSH version with the package version
 * (which were the same thing under the old policy) and now asks the same question the only way it can
 * still be answered — against the declared range, with one implementation of the range logic.
 *
 * Exit: 0 when consistent, 1 when not.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const PEER = '@deepseek-ai/dsh'

const pkg = JSON.parse(readFileSync(join(REPO, 'editor', 'package.json'), 'utf8'))
const workflow = readFileSync(join(REPO, '.github', 'workflows', 'test.yml'), 'utf8')

/**
 * Every dsh version the CI matrix will install, in declaration order.
 *
 * **Why the matrix rather than a literal** — see the call site for the full story. Short version:
 * a literal can be found inside a *comment*, so writing one there silently changes what this script
 * asserts about. Reading the matrix asserts the thing CI actually installs.
 *
 * Both spellings are handled: the base list (`dsh: ['a', 'b']`) and an include leg's singular form
 * (`dsh: 'a'`). Comments are stripped first, so `# dsh: 'x'` is never read as a declaration.
 *
 * @param {string} text - the workflow file's contents.
 * @returns {string[]} version strings, deduplicated, in order.
 */
function pinnedDshVersions(text) {
  const stripped = text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n')
  const out = []
  for (const match of stripped.matchAll(/^\s*dsh:\s*\[([^\]]*)\]/gm)) {
    for (const item of match[1].matchAll(/['"]([^'"]+)['"]/g)) out.push(item[1])
  }
  for (const match of stripped.matchAll(/^\s*dsh:\s*['"]([^'"]+)['"]\s*$/gm)) out.push(match[1])
  return [...new Set(out)]
}

const fail = (lines) => {
  for (const line of lines) console.error(line)
  process.exit(1)
}

/** `1.2.3-rc.4` → `{ tuple: [1,2,3], prerelease: ['rc','4'] }`; null when it is not a version. */
function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return null
  return { tuple: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] === undefined ? [] : match[4].split('.') }
}

/** Semver precedence (spec §11): tuple, then "a prerelease is lower than its release". */
function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.tuple[i] !== b.tuple[i]) return a.tuple[i] < b.tuple[i] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i += 1) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/**
 * A range: one or more `||`-separated alternatives, each a conjunction of comparators
 * separated by spaces (`>=0.1.6-alpha.1`, `>=0.1.0 <0.2.0`, `1.2.3`).
 *
 * Anything else (`^`, `~`, `x`-ranges) is refused **loudly** rather than silently answered
 * wrong — extend this function if the declared range ever needs it.
 *
 * **The prerelease gate below is not optional.** The declared range is consumed by npm, pnpm and
 * the marketplaces — i.e. by node-semver — not by this script. node-semver lets a prerelease
 * version satisfy a comparator set only when some comparator in that set carries a prerelease
 * **and** its `[major,minor,patch]` tuple equals the version's. Concretely
 * `>=0.1.5-rc.2 <0.2.0-0` does **not** match `0.1.7-alpha.2`: the only prerelease-bearing
 * comparators have tuples 0.1.5 and 0.2.0, while the version's is 0.1.7 — even though every
 * comparator compares true in isolation. Without this rule the check is **looser than npm** and
 * reports OK for a range npm refuses, which is exactly the failure this script exists to prevent.
 * (The same defect was found in dsh-zcode-git's copy of this script and fixed there.)
 */
function satisfies(version, range) {
  const alternatives = String(range).split('||')
  if (alternatives.some((a) => a.trim() === '')) throw new Error('范围里有空的 || 分支')
  return alternatives.some((alternative) => satisfiesConjunction(version, alternative))
}

/** One `||` branch: every comparator must hold, and the prerelease gate must allow the version. */
function satisfiesConjunction(version, range) {
  const parts = String(range).trim().split(/\s+/).filter((p) => p !== '')
  if (parts.length === 0) throw new Error('范围是空的')
  const comparators = []
  for (const part of parts) {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(part)
    const operator = match[1] ?? '='
    const bound = parseVersion(match[2])
    if (bound === null) throw new Error(`不支持的比较符或版本：${part}`)
    comparators.push({ operator, bound })
  }
  for (const { operator, bound } of comparators) {
    const order = compare(version, bound)
    const ok = operator === '>=' ? order >= 0
      : operator === '<=' ? order <= 0
        : operator === '>' ? order > 0
          : operator === '<' ? order < 0
            : order === 0
    if (!ok) return false
  }
  // node-semver 的预发布门：见函数头的说明。少了它，本脚本会比 npm 宽松。
  if (version.prerelease.length > 0) {
    const unlocked = comparators.some(
      (c) => c.bound.prerelease.length > 0 && c.bound.tuple.join('.') === version.tuple.join('.'),
    )
    if (!unlocked) return false
  }
  return true
}

// 自检：这四条就是本仓真正踩过的坑（见文件头与 README 的兼容范围一节）。
// 它们变红说明 satisfies 又和 node-semver 脱节了 —— 那是"守卫开始说谎"的信号。
for (const [label, expected, version, range] of [
  ['旧范围不覆盖更新的 alpha（预发布门生效）', false, '0.1.7-alpha.2', '>=0.1.5-rc.2 <0.2.0-0'],
  ['显式 || 分支覆盖它', true, '0.1.7-alpha.2', '>=0.1.5-rc.2 <0.2.0-0 || >=0.1.7-alpha.1 <0.2.0-0'],
  ['元组一致时预发布放行', true, '0.1.6-alpha.2', '>=0.1.6-alpha.1 <0.2.0-0'],
  ['正式版不受预发布门影响', true, '0.1.5', '>=0.1.5-rc.2 <0.2.0-0'],
  ['下界之前的版本仍被拒', false, '0.1.4', '>=0.1.5-rc.2 <0.2.0-0'],
]) {
  let got
  try {
    got = satisfies(parseVersion(version), range)
  } catch (error) {
    got = `throw:${error.message}`
  }
  if (got !== expected) {
    fail([
      `范围自检失败：${label}`,
      `  satisfies(${version}, ${JSON.stringify(range)}) = ${got}，期望 ${expected}`,
      '  这四条对应 node-semver 的真实语义；改坏它们等于让本脚本比 npm 宽松。',
    ])
  }
}

const declared = []
if (typeof pkg.engines?.dsh === 'string') declared.push({ where: 'engines.dsh', range: pkg.engines.dsh })
if (typeof pkg.peerDependencies?.[PEER] === 'string') declared.push({ where: `peerDependencies["${PEER}"]`, range: pkg.peerDependencies[PEER] })

if (declared.length === 0) {
  fail([
    '版本一致性: editor/package.json 里没有声明 dsh 兼容范围。',
    '至少要有 engines.dsh（目录与市场用它显示宿主兼容性）。',
  ])
}

// 1. The published version must be a bare x.y.z — see the file header.
const own = parseVersion(pkg.version)
if (own === null) {
  fail([
    `版本一致性: editor/package.json 的 version 不是合法语义化版本：${JSON.stringify(pkg.version)}`,
    '（四段号如 0.1.6.2 不是合法 semver，npm 会直接拒绝发布。）',
  ])
}
if (own.prerelease.length > 0) {
  fail([
    `版本一致性: 包版本 ${pkg.version} 带预发布标签（-${own.prerelease.join('.')}）。`,
    '有目录与市场以此判定"不自动安装"（例如要求 npm latest 满足 prerelease(value) === null）。',
    '本项目的约定是：版本号走自己的稳定线（1.0.0、1.0.1 …），',
    '"适配哪个 dsh" 由 engines.dsh 与 peer 范围声明，并由本脚本校验它覆盖 CI 实测的版本。',
  ])
}

// Mode `--dsh <version>`: answer the question for an arbitrary installed version. Used by
// `install.sh`, which must not carry a second copy of the range logic.
const dshFlag = process.argv.indexOf('--dsh')
if (dshFlag !== -1) {
  const given = process.argv[dshFlag + 1]
  const parsed = parseVersion(given)
  if (parsed === null) {
    console.error(`版本兼容性: 装了 dsh ${JSON.stringify(given)}，这不是一个能解析的版本号。`)
    process.exit(1)
  }
  const outside = []
  for (const { where, range } of declared) {
    let ok
    try {
      ok = satisfies(parsed, range)
    } catch (error) {
      console.error(`版本兼容性: 无法解析 ${where} 的范围 ${JSON.stringify(range)} —— ${error.message}`)
      process.exit(1)
    }
    if (!ok) outside.push({ where, range })
  }
  if (outside.length > 0) {
    console.error(`版本兼容性: 装了 dsh ${given}，但声明的兼容范围不覆盖它：`)
    for (const m of outside) console.error(`  ${m.where.padEnd(26)} ${m.range}`)
    console.error('  本项目深度依赖 DSH 内部 API：版本不在范围内时，请先核对 README 的「耦合点清单」。')
    process.exit(1)
  }
  console.log(`版本兼容性: dsh ${given} 在声明的兼容范围内（${declared.map((d) => d.range).join(' / ')}）。`)
  process.exit(0)
}

// 2. Every DSH version CI installs must be inside every declared range.
//
// ★ 从**矩阵**读，不从字面量读。
//
// 早先这里抓的是「全 workflow 里第一个 `@deepseek-ai/dsh@<版本>` 字面量」。那个写法有两个洞，
// 而本仓 2026-09-24 实际撞上过：
//   · 注释里也能捞到 —— 在注释里写个版本号就**换掉了断言标的**，而检查照样绿（"静默改标准"）。
//   · 真正的矩阵值写作 `@deepseek-ai/dsh@${{ matrix.dsh }}`，字符类匹配不到 `$`，所以能过的
//     唯一原因就是**恰好有一处注释写着字面量**。把那句注释改掉，守卫立刻报"找不到钉定" ——
//     它一直在检查注释，而不是检查 CI 真正会装什么。
// 现在：两种矩阵写法都读（主轴列表 + include 腿），先剥掉整行/行尾注释，并断言**每一条腿**。
const testedVersions = pinnedDshVersions(workflow)
if (testedVersions.length === 0) {
  fail([
    '版本一致性: 无法从 CI workflow 的矩阵里读出任何 dsh 版本。',
    "  期望写法：主轴 `dsh: ['x', 'y']` 或 include 腿里的 `dsh: 'x'`。",
    '  若 CI 改成从别处取版本，请同步更新本脚本。',
  ])
}
const parsedTested = testedVersions.map((raw) => ({ raw, version: parseVersion(raw) }))
const unparsable = parsedTested.filter((p) => p.version === null)
if (unparsable.length > 0) {
  fail([`版本一致性: CI 矩阵里有不是合法语义化版本的 dsh：${unparsable.map((p) => JSON.stringify(p.raw)).join('、')}`])
}

const misses = []
for (const { raw, version } of parsedTested) {
  for (const { where, range } of declared) {
    let ok
    try {
      ok = satisfies(version, range)
    } catch (error) {
      fail([
        `版本一致性: 无法解析 ${where} 的范围 ${JSON.stringify(range)} —— ${error.message}`,
        '本脚本只支持用空格连接的 >= > <= < = 比较符；扩了写法就要同步扩本脚本。',
      ])
    }
    if (!ok) misses.push({ where, range, tested: raw })
  }
}

if (misses.length > 0) {
  fail([
    '版本一致性: CI 实测的 dsh 版本不在声明的兼容范围内。',
    '  CI 安装并测试的 dsh         ' + parsedTested.map((p) => p.raw).join('、'),
    ...misses.map((m) => `  ${m.where.padEnd(26)} ${m.range}   ← 不覆盖 ${m.tested}`),
    '',
    '升 dsh 时把范围放宽到覆盖新版本，或在真的不再支持旧版本时改写下界；',
    '否则发布的包会声称支持一个从未跑过测试的运行时。',
  ])
}

console.log(`版本一致性: OK —— 包版本 ${pkg.version}（稳定线）；`)
for (const { where, range } of declared) console.log(`  ${where} = ${range}`)
console.log(`  覆盖 CI 实测的 dsh ${parsedTested.map((p) => p.raw).join('、')} ✔（共 ${parsedTested.length} 条腿）`)
