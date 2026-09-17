/**
 * One entry point for both suites.
 *
 * Run: node test/run.mjs
 *
 * Why this exists: the composition tests need the SHIPPED preset text, which is
 * not in this repo — it lives in the installed `@deepseek-ai/dsh-agent-presets`.
 * Every doc used to hand the reader a different hard-coded path
 * (`/usr/lib/node_modules/...`, a `find ~/.dsh -name dsh-agent-presets`, …), and
 * all of them were wrong on somebody's machine. So resolve it once, here, trying
 * the same three routes the plugin itself uses, and print which one won.
 *
 * Routes, in order:
 *   1. `DSH_SHIPPED_PRESETS_DIR`                — explicit override, wins always
 *   2. Node resolution from this file           — works when the repo sits inside
 *                                                 a tree that can see the package
 *                                                 (e.g. CI, or a profile link)
 *   3. `<DSH_HOME>/profiles/node_modules/...`   — a machine with dsh installed
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const PACKAGE = '@deepseek-ai/dsh-agent-presets'

/** The four modes this repo compiles against; a presets dir without them is wrong. */
const REQUIRED_MODES = ['standard', 'ptc', 'minimal', 'cordis']

/** Whether a directory really is a shipped-presets dir (rather than just named like one). */
function looksRight(dir) {
  if (typeof dir !== 'string' || dir === '') return false
  try {
    return existsSync(dir) && REQUIRED_MODES.every((mode) => existsSync(join(dir, mode, 'agent.cordis.yml')))
  } catch {
    return false
  }
}

/** Attempt one resolution route; returns a directory or undefined. */
function attempt(label, fn) {
  try {
    const dir = fn()
    if (looksRight(dir)) return { label, dir }
    if (dir !== undefined) console.log(`    （${label} 命中了 ${dir}，但不是有效的 presets 目录）`)
  } catch {
    /* route unavailable; the next one may work */
  }
  return undefined
}

function resolvePresetsDir() {
  const override = process.env.DSH_SHIPPED_PRESETS_DIR
  if (override !== undefined && override !== '') {
    if (!looksRight(override)) {
      console.error(`DSH_SHIPPED_PRESETS_DIR=${override} 不是一个有效的 presets 目录`)
      console.error(`它应当含有：${REQUIRED_MODES.map((mode) => `${mode}/agent.cordis.yml`).join('、')}`)
      process.exit(2)
    }
    return { label: 'DSH_SHIPPED_PRESETS_DIR', dir: override }
  }

  const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  const routes = [
    ['Node 解析', () => join(dirname(createRequire(import.meta.url).resolve(`${PACKAGE}/package.json`)), 'presets')],
    ['$DSH_HOME/profiles/node_modules', () => join(dirname(createRequire(join(dshHome, 'profiles', 'package.json')).resolve(`${PACKAGE}/package.json`)), 'presets')],
    // A locally installed dsh keeps its own dependency copy nested; npm hoists it
    // to the top level instead. Both shapes are worth a look.
    [
      '嵌套的 dsh 依赖',
      () => {
        const anchor = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
        return join(dirname(anchor), 'node_modules', PACKAGE, 'presets')
      },
    ],
  ]
  for (const [label, fn] of routes) {
    const hit = attempt(label, fn)
    if (hit !== undefined) return hit
  }
  return undefined
}

const found = resolvePresetsDir()
if (found === undefined) {
  console.error('找不到出厂 preset（shipped presets）。已尝试：')
  console.error(`  - ${'DSH_SHIPPED_PRESETS_DIR'} 环境变量（当前未设置）`)
  console.error('  - 从本文件做 Node 解析')
  console.error(`  - $DSH_HOME/profiles/node_modules 里的 ${PACKAGE}`)
  console.error('  - 嵌套在 @deepseek-ai/dsh 里的依赖副本')
  console.error('')
  console.error('三种解法任选：')
  console.error('  1) 本机装了 dsh：直接跑就行，说明解析链需要修，请提 issue；')
  console.error('  2) 没有 dsh（例如 CI）：npm install @deepseek-ai/dsh@0.1.6-alpha.1')
  console.error('  3) 手工指定：DSH_SHIPPED_PRESETS_DIR=/path/to/presets node test/run.mjs')
  console.error('')
  console.error(`提示：${'~/.dsh'}/profiles/node_modules 只有在 dsh 至少启动过一次之后才会被填充。`)
  process.exit(2)
}

console.log(`出厂 preset 目录: ${found.dir}`)
console.log(`（来源：${found.label}）`)
console.log('')

const suites = [
  'composition.test.mjs',
  'prompt-reader.test.mjs',
  'prompt-tool.test.mjs',
  'meta.test.mjs',
  'locales.test.mjs',
]
const env = { ...process.env, DSH_SHIPPED_PRESETS_DIR: found.dir }
let failed = 0
for (const suite of suites) {
  console.log(`──────── ${suite} ────────`)
  const result = spawnSync(process.execPath, [join(HERE, suite)], { stdio: 'inherit', env })
  if (result.status !== 0) failed += 1
  console.log('')
}

if (failed > 0) {
  console.error(`${failed} / ${suites.length} 个测试套件失败`)
  process.exit(1)
}
console.log(`${suites.length} 个套件全部通过（presets 来源：${found.label}）`)
