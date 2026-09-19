/**
 * Preset seeding tests.
 *
 * Run: node test/seed.test.mjs
 *
 * Why this exists: every storefront installs a plugin with one command, and the npm package
 * is all that command carries. If seeding is wrong in any direction the result is a bad
 * first impression — a settings page that cannot open, or worse, a user's own `prompt.md`
 * silently replaced by the shipped one. There is also a second copy of the preset inside
 * the package (`editor/preset/`) whose whole risk is drifting from the repository's
 * `preset/`; a guard for that lives here too.
 *
 * Everything runs in temporary directories; the repository's own `preset/` is only read.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)

let passed = 0
let failed = 0
const check = (label, condition, detail = '') => {
  if (condition) {
    passed += 1
    console.log(`PASS  ${label}`)
  } else {
    failed += 1
    console.log(`FAIL  ${label}${detail === '' ? '' : '  → ' + detail}`)
  }
}

const { seedPreset, seedPresetWithLog, packagedPresetDir, starterComposition, PRESET_FILES } = await import('../editor/seed.mjs')
const { baseCompositionPath } = await import('../editor/composition.mjs')

console.log()
console.log('=== 1. 包内预设施集齐全（发布包里必须有这五个文件）===')
{
  const source = packagedPresetDir()
  check('包内预设施目录存在', existsSync(source), source)
  const missing = PRESET_FILES.filter((name) => !existsSync(join(source, name)))
  check(`五个文件都在（${PRESET_FILES.length}）`, missing.length === 0, JSON.stringify(missing))
  check('agent.cordis.yml 引用了 preset 相对模块', readFileSync(join(source, 'agent.cordis.yml'), 'utf8').includes("name: './prompt-reader.mjs'"))
}

console.log()
console.log('=== 2. 空目录：五个文件全部补上 ===')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-seed-empty-'))
  const target = join(root, 'agent-presets', 'custom')
  const result = seedPreset(target)
  check('没有错误', result.errors.length === 0, JSON.stringify(result.errors))
  check('五个文件都是新建', result.created.length === PRESET_FILES.length && result.kept.length === 0, JSON.stringify(result))
  check('文件真的落盘了', PRESET_FILES.every((name) => existsSync(join(target, name))))
  check('多级目录被创建', existsSync(join(root, 'agent-presets', 'custom')))
  rmSync(root, { recursive: true, force: true })
}

console.log()
console.log('=== 3. 绝不覆盖：用户写的 prompt.md 与设置页生成的组成文件都要留住 ===')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-seed-keep-'))
  const target = join(root, 'custom')
  mkdirSync(target, { recursive: true })
  const userPrompt = 'USER-EDITED-PROMPT\n第二个文件的内容\n'
  const generatedComposition = '# 本文件由「自定义模式」设置页生成\n- id: persona\n  name: ./prompt-reader.mjs\n'
  writeFileSync(join(target, 'prompt.md'), userPrompt, 'utf8')
  writeFileSync(join(target, 'agent.cordis.yml'), generatedComposition, 'utf8')

  const result = seedPreset(target)
  check('用户文件没有被记成新建', !result.created.includes('prompt.md') && !result.created.includes('agent.cordis.yml'), JSON.stringify(result.created))
  check('它们被记为保留', result.kept.includes('prompt.md') && result.kept.includes('agent.cordis.yml'), JSON.stringify(result.kept))
  check('prompt.md 内容一字未改', readFileSync(join(target, 'prompt.md'), 'utf8') === userPrompt)
  check('agent.cordis.yml 内容一字未改', readFileSync(join(target, 'agent.cordis.yml'), 'utf8') === generatedComposition)
  check('其余三个文件补上了', result.created.length === 3, JSON.stringify(result.created))
  rmSync(root, { recursive: true, force: true })
}

console.log()
console.log('=== 4. 幂等：再播一次什么都不写、什么都不改 ===')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-seed-idem-'))
  const target = join(root, 'custom')
  const first = seedPreset(target)
  const before = readFileSync(join(target, 'prompt.md'), 'utf8')
  const second = seedPreset(target)
  check('第二次没有新建', second.created.length === 0, JSON.stringify(second.created))
  check('第二次全部保留', second.kept.length === PRESET_FILES.length, JSON.stringify(second.kept))

console.log('=== 3b. 升级：刷新我们自己的代码模块，但绝不动用户数据 ===')
{
  // 外部评审实测的真实缺口：老版本创建的助手目录里存着一份**旧的可执行模块**，
  // 而升级只补缺失文件 → 1.0.x/1.1.x 首装的用户即使把插件升到最新，会话内改写提示词的
  // 审批闸门仍然是缺的。所以模块要刷新，而 prompt.md / preset.yml / 组成文件仍是用户数据。
  const refreshedDir = mkdtempSync(join(tmpdir(), 'dsh-seed-refresh-'))
  seedPreset(refreshedDir, packagedPresetDir())
  writeFileSync(join(refreshedDir, 'prompt-tool.mjs'), '// old shipped copy\n', 'utf8')
  writeFileSync(join(refreshedDir, 'prompt.md'), '用户自己写的提示词\n', 'utf8')
  const upgraded = seedPreset(refreshedDir, packagedPresetDir())
  check('代码模块被刷新', upgraded.refreshed.includes('prompt-tool.mjs'), JSON.stringify(upgraded.refreshed))
  check('刷新后与包内逐字节一致',
    readFileSync(join(refreshedDir, 'prompt-tool.mjs'), 'utf8') === readFileSync(join(packagedPresetDir(), 'prompt-tool.mjs'), 'utf8'))
  check('用户提示词没有被动过', readFileSync(join(refreshedDir, 'prompt.md'), 'utf8') === '用户自己写的提示词\n')
  check('用户提示词记为"保留"而不是"刷新"',
    upgraded.kept.includes('prompt.md') && !upgraded.refreshed.includes('prompt.md'), JSON.stringify(upgraded))
  rmSync(refreshedDir, { recursive: true, force: true })
}
  check('第二次没有错误', second.errors.length === 0, JSON.stringify(second.errors))
  check('内容与第一次相同', readFileSync(join(target, 'prompt.md'), 'utf8') === before)
  check('第一次确实写过东西', first.created.length === PRESET_FILES.length)
  rmSync(root, { recursive: true, force: true })
}

console.log()
console.log('=== 5. 包内缺文件：记错误，但不抛、不写半个 ===')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-seed-partial-'))
  const source = join(root, 'source')
  mkdirSync(source, { recursive: true })
  copyFileSync(join(packagedPresetDir(), 'prompt.md'), join(source, 'prompt.md'))
  const target = join(root, 'custom')
  const result = seedPreset(target, source)
  check('记录了缺失的文件', result.errors.length === PRESET_FILES.length - 1, JSON.stringify(result.errors))
  check('该有的那个写下来了', result.created.length === 1 && existsSync(join(target, 'prompt.md')), JSON.stringify(result))
  check('没有把错误当成异常抛出', true)
  rmSync(root, { recursive: true, force: true })
}

console.log()
console.log('=== 6. 只读目录：不抛异常（启动不能因此挂掉）===')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-seed-ro-'))
  // 用一个「普通文件」当父目录：mkdir -p 在任何权限下都会 ENOTDIR。
  // 这里不能用 chmod 0o500 模拟只读目录——root 会绕过权限位，于是播种照样成功，
  // 这几条断言在本地（root）恒假红、在 CI（非 root）恒真绿，测出的东西取决于跑测试的人。
  const blocker = join(root, 'not-a-dir')
  writeFileSync(blocker, 'x')
  let threw = false
  let result
  try {
    result = seedPreset(join(blocker, 'custom'))
  } catch (error) {
    threw = true
    result = { errors: [String(error)] }
  }
  check('没有抛出异常', threw === false)
  check('记录了错误', result.errors.length > 0, JSON.stringify(result))
  check('没有假装成功', result.created.length === 0, JSON.stringify(result.created))
  rmSync(root, { recursive: true, force: true })
}

console.log()
console.log('=== 7. 日志只在该说话的时候说话 ===')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-seed-log-'))
  const target = join(root, 'custom')
  const infos = []
  const logs = []
  seedPresetWithLog(target, (m) => logs.push(m), (m) => infos.push(m))
  check('首次播种说了做了什么', infos.length === 1 && infos[0].includes('已播种'), JSON.stringify(infos))
  const infos2 = []
  const logs2 = []
  seedPresetWithLog(target, (m) => logs2.push(m), (m) => infos2.push(m))
  check('第二次完全安静（不刷启动日志）', infos2.length === 0 && logs2.length === 0, JSON.stringify({ infos2, logs2 }))

  // 同上：用普通文件阻断，而不是靠权限位（root 下权限位不起作用）
  const blocker = join(root, 'not-a-dir')
  writeFileSync(blocker, 'x')
  const infos3 = []
  const logs3 = []
  seedPresetWithLog(join(blocker, 'custom'), (m) => logs3.push(m), (m) => infos3.push(m))
  check('失败时给出可读日志', logs3.length > 0 && logs3[0].includes('custom-mode:'), JSON.stringify(logs3))
  void infos3
  rmSync(root, { recursive: true, force: true })
}

console.log()
console.log('=== 8. 守卫：包内预设与仓库 preset/ 不许漂移 ===')
{
  // 包内那份是 npm 打包的载体（npm 只能带上包目录内的文件），仓库 preset/ 是事实来源。
  // 两份拷贝最大的风险就是分叉：改了仓库那份、忘了包里那份，用户装到的还是旧行为。
  const source = packagedPresetDir()
  for (const name of PRESET_FILES) {
    const repoFile = join(REPO, 'preset', name)
    const packedFile = join(source, name)
    check(`editor/preset/${name} 与 preset/${name} 逐字节一致`, readFileSync(repoFile, 'utf8') === readFileSync(packedFile, 'utf8'))
  }
}

console.log()
console.log('=== 6. 派生出来的组成文件，在**当前这条线**上必须是健康的（P0 回归）===')
{
  // 实测过的 P0：播种文件照搬了另一条线的模板，模板里启用的一行（`workflow-ptc`）在稳定线上根本没有对应
  // 包 → 平台把整个预设判为 broken → **模式从所有选择器里静默消失**，而设置页照常能打开，所以当时的 UI
  // 测试全绿。这条检查就是那次缺掉的覆盖。
  /**
   * 未禁用、且包名无法在安装树里解析的行。
   *
   * @param {string} text - a rendered composition.
   * @param {string} nodeModules - the install's `node_modules` directory.
   * @returns {string[]} `id → name` for every problematic row.
   */
  const unresolvableRows = (text, nodeModules) => {
    const lines = text.split('\n')
    const problems = []
    for (let i = 0; i < lines.length; i += 1) {
      const row = /^( {0,4})- id: (.+?)\s*$/.exec(lines[i])
      if (row === null) continue
      let name
      let disabled = false
      for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j += 1) {
        const nm = /^\s+name: ['"]?(.+?)['"]?\s*$/.exec(lines[j])
        if (nm !== null && name === undefined) name = nm[1]
        if (/^\s+disabled: true\s*$/.test(lines[j])) disabled = true
      }
      if (name === undefined || name.startsWith('.') || name.startsWith('cordis:')) continue
      if (disabled) continue
      // 子路径导出（`@scope/pkg/sub`）按包名判断；非 scoped 的 `pkg/sub` 同理。
      const parts = name.split('/')
      const pkg = name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
      if (existsSync(join(nodeModules, pkg)) === false) problems.push(`${row[2]} → ${name}`)
    }
    return problems
  }

  const derived = starterComposition({ assistantId: 'custom' })
  check('能从本机安装的出厂组成派生播种内容', typeof derived === 'string' && derived.length > 500, String(derived === null ? 'null' : derived.length))

  if (typeof derived === 'string') {
    const baseComposition = readFileSync(baseCompositionPath('standard'), 'utf8')
    const baseRows = new Set([...baseComposition.matchAll(/^( {0,4})- id: (.+?)\s*$/gm)].map((m) => m[2]))
    const seededIds = [...derived.matchAll(/^( {0,4})- id: (.+?)\s*$/gm)].map((m) => m[2])
    // 我们自己的两行（persona 读取器与工具）不属于出厂组成，名字是相对模块 —— 由 unresolvableRows 跳过。
    const extra = [...new Set(seededIds)].filter((id) => baseRows.has(id) === false && id !== 'custom-prompt-tool')
    check('播种文件没有引入本线出厂组成之外的其它行', extra.length === 0, JSON.stringify(extra))
    const missing = [...baseRows].filter((id) => seededIds.includes(id) === false)
    check('出厂行一行都没丢', missing.length === 0, JSON.stringify(missing))

    // 5 级向上：standard 目录 → presets → dsh-agent-presets → @deepseek-ai → node_modules
    const nodeModules = join(baseCompositionPath('standard'), '..', '..', '..', '..', '..')
    const problems = unresolvableRows(derived, nodeModules)
    check('派生结果里未禁用的行，包都能在本机安装里解析（broken 预设的成因）', problems.length === 0, JSON.stringify(problems))

    // 让这条检查"有牙齿"：包内模板在同一条线上确实有问题时，把它打出来 —— 那正是不能照搬它的原因。
    const packedProblems = unresolvableRows(readFileSync(join(packagedPresetDir(), 'agent.cordis.yml'), 'utf8'), nodeModules)
    if (packedProblems.length > 0) {
      console.log(`说明：包内模板在本线有 ${String(packedProblems.length)} 处不可解析（${packedProblems.slice(0, 4).join('、')}）—— 这正是播种改为"按本线派生"的原因。`)
    }
  }

  // 派生失败时必须退回包内模板，而不是写出一个空文件。
  const fallbackDir = mkdtempSync(join(tmpdir(), 'dsh-seed-fallback-'))
  const copied = seedPreset(fallbackDir, packagedPresetDir(), { composition: null })
  check('派生失败（composition=null）时仍会播种包内模板', copied.errors.length === 0 && existsSync(join(fallbackDir, 'agent.cordis.yml')), JSON.stringify(copied))
  rmSync(fallbackDir, { recursive: true, force: true })

  // 给定 composition 时用它写，且**永不覆盖**已存在的文件。
  const givenDir = mkdtempSync(join(tmpdir(), 'dsh-seed-given-'))
  const first = seedPreset(givenDir, packagedPresetDir(), { composition: '# 由本机派生\n' })
  check('给定 composition 时写入的是它', readFileSync(join(givenDir, 'agent.cordis.yml'), 'utf8') === '# 由本机派生\n', JSON.stringify(first.created))
  seedPreset(givenDir, packagedPresetDir(), { composition: '# 不该覆盖\n' })
  check('已存在的组成文件不会被覆盖', readFileSync(join(givenDir, 'agent.cordis.yml'), 'utf8') === '# 由本机派生\n')
  rmSync(givenDir, { recursive: true, force: true })
}

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
