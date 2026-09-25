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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const PACKAGE = '@deepseek-ai/dsh-agent-presets'

// 与产品同一条解析/派生实现（base-composition.mjs），避免"测试里能跑、真机上不行"。
const { BASE_MODE_IDS, extractPluginsBlock, patchPresetsDir } = await import('../editor/base-composition.mjs')

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
    // 全局安装（`npm i -g`）把包放在 node 自己的前缀下。这一条是给"机器上只有全局装的 dsh、
    // 且 dsh 还没启动过（$DSH_HOME/profiles 还是空的）"用的 —— 审阅方实测踩到过 exit 2。
    // 两种形态都要看：dsh 的依赖可能被提升到前缀顶层，也可能嵌套在 dsh 自己下面。
    [
      'node 前缀下的全局安装',
      () => {
        const prefix = join(dirname(process.execPath), '..', 'lib', 'node_modules')
        const hoisted = join(prefix, PACKAGE, 'presets')
        if (existsSync(hoisted)) return hoisted
        const anchor = createRequire(join(prefix, 'noop.js')).resolve('@deepseek-ai/dsh/package.json')
        return join(dirname(anchor), 'node_modules', PACKAGE, 'presets')
      },
    ],
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

/**
 * 第四路：从**已安装主机**的声明式 patch 派生一份 presets 目录（dsh ≥ 0.1.7）。
 *
 * 为什么需要它：0.1.7 起 `@deepseek-ai/dsh-agent-presets`（复数）不再发布，出厂定义改成
 * `@deepseek-ai/dsh-web-app/presets/<mode>.patch.yml` 里的声明。CI 从前靠
 * `npm i @deepseek-ai/dsh-agent-presets@0.1.6-alpha.2` 补一份夹具，而那一步在 0.1.7 的 peer 树上
 * **ERESOLVE 失败**（GitHub 的 `bash -e` 直接判该步失败）—— 0.1.7 的三条 CI 腿因此自 1.9.10 起
 * 一直是红的，也正好没人发现设置页在那条线上整体不可用。这里改用**与产品同一条**派生代码：
 * 不装旧包，也不依赖任何上游文件被复制过。
 *
 * 落点选在 <repo>/node_modules/…（而不是 tmp）：`unresolvableRows()` 的"本行能不能在本机运行"
 * 判定是从 presets 目录往上推三层找 node_modules 的，夹具放在 tmp 下会让那个根变成 `/`，
 * 于是**每一行都判不出来**、断言静默变松。node_modules 不入版本库，写进去是安全的。
 */
function deriveFromDeclarativePatches() {
  const patches = patchPresetsDir()
  if (patches === undefined) return undefined
  const out = join(REPO, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets')
  try {
    for (const mode of BASE_MODE_IDS) {
      const text = extractPluginsBlock(readFileSync(join(patches, mode + '.patch.yml'), 'utf8'))
      if (text === null) return undefined
      mkdirSync(join(out, mode), { recursive: true })
      writeFileSync(join(out, mode, 'agent.cordis.yml'), text + '\n', 'utf8')
      writeFileSync(join(out, mode, 'preset.yml'), `name: ${mode}\n`, 'utf8')
    }
    writeFileSync(
      join(REPO, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'package.json'),
      JSON.stringify({ name: PACKAGE, version: '0.0.0-derived', private: true }, null, 2) + '\n',
      'utf8',
    )
    return out
  } catch {
    return undefined
  }
}

const found = resolvePresetsDir() ?? attempt('从声明式 patch 派生（0.1.7+）', deriveFromDeclarativePatches)
if (found === undefined) {
  console.error('找不到出厂 preset（shipped presets）。已尝试：')
  console.error(`  - ${'DSH_SHIPPED_PRESETS_DIR'} 环境变量（当前未设置）`)
  console.error('  - 从本文件做 Node 解析')
  console.error(`  - $DSH_HOME/profiles/node_modules 里的 ${PACKAGE}`)
  console.error('  - 嵌套在 @deepseek-ai/dsh 里的依赖副本')
  console.error('')
  console.error('四种解法任选：')
  console.error('  1) 本机装了 dsh 0.1.7+：直接跑就行（会从 dsh-web-app/presets/*.patch.yml 派生）；')
  console.error('  2) 本机装的是旧线（≤0.1.6）：它会自带 @deepseek-ai/dsh-agent-presets；')
  console.error('  3) 没有 dsh（例如 CI）：npm install @deepseek-ai/dsh@0.1.7-rc.2')
  console.error('  4) 手工指定：DSH_SHIPPED_PRESETS_DIR=/path/to/presets node test/run.mjs')
  console.error('')
  console.error(`提示：${'~/.dsh'}/profiles/node_modules 只有在 dsh 至少启动过一次之后才会被填充。`)
  process.exit(2)
}

console.log(`出厂 preset 目录: ${found.dir}`)
console.log(`（来源：${found.label}）`)
console.log('')

const suites = [
  'composition.test.mjs',
  'composition-edge.test.mjs',
  'base-composition.test.mjs',
  'prompt-reader.test.mjs',
  'prompt-tool.test.mjs',
  'meta.test.mjs',
  'assistants.test.mjs',
  'editor-route.test.mjs',
  'preset-backend.test.mjs',
  'journal.test.mjs',
  'session-trace.test.mjs',
  'seed.test.mjs',
  'locales.test.mjs',
  'client-bundle.test.mjs',
  'manifests.test.mjs',
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
