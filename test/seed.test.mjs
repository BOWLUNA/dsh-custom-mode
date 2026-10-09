/**
 * Preset seeding tests.
 *
 * Run: node test/seed.test.mjs
 *
 * Why this exists: every storefront installs a plugin with one command, and the npm package
 * is all that command carries. If seeding is wrong in any direction the result is a bad
 * first impression — a settings page that cannot open, or worse, a user's own `prompt.md`
 * silently replaced by the shipped one. Since 1.10.0 the packaged copy IS the repository's
 * `preset/` (npm publishes the repository root), so a guard here pins that they are one and
 * the same directory rather than two that must not drift.
 *
 * Everything runs in temporary directories; the repository's own `preset/` is only read.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureUnsetDefaultPreset } from '../defaults.mjs'

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

const { seedPreset, seedPresetWithLog, packagedPresetDir, starterComposition, PRESET_FILES, dropShippedDescription, SHIPPED_DESCRIPTIONS } = await import('../seed.mjs')
const { baseCompositionPath, unresolvableRows } = await import('../composition.mjs')
const { readPresetMeta, writePresetMeta } = await import('../meta.mjs')

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
console.log('=== 8. 守卫：包内预设就是仓库 preset/（1.10.0 起只有一份）===')
{
  // 1.10.0 之前，包内那五个文件是 preset/ 的**第二份拷贝**（npm 只能带包目录内的文件，而包在 editor/），
  // 漂移风险靠逐字节比对来防。1.10.0 把发布包搬到仓库根，拷贝消失：packagedPresetDir() 现在必须
  // 正好指回仓库自己的 preset/ —— 指到别处，就说明有人又把一份拷贝加了回来。
  const source = packagedPresetDir()
  check('packagedPresetDir() 指向仓库自己的 preset/', resolve(source) === resolve(join(REPO, 'preset')), source)
  for (const name of PRESET_FILES) {
    check(`preset/${name} 存在且是同一份`, existsSync(join(REPO, 'preset', name)) && existsSync(join(source, name)))
  }
}

console.log()
console.log('=== 6. 派生出来的组成文件，在**当前这条线**上必须是健康的（P0 回归）===')
{
  // 实测过的 P0：播种文件照搬了另一条线的模板，模板里启用的一行（`workflow-ptc`）在稳定线上根本没有对应
  // 包 → 平台把整个预设判为 broken → **模式从所有选择器里静默消失**，而设置页照常能打开，所以当时的 UI
  // 测试全绿。这条检查就是那次缺掉的覆盖。
  // 这条判定**直接用产品里那份**（composition.mjs 的 unresolvableRows），不再在测试里抄一份：
  // 抄出来的副本曾经只看"根 + @deepseek-ai/<pkg>"这种扁平布局，于是在依赖**嵌套**安装的线上
  // （实测 npm 装 dsh 0.1.7 就是这个形态）把每一行都报成"本机装不了" —— 一个把健康预设说成 broken
  // 的假警报，而它正是这条 P0 回归检查的执行者。产品那份已经认嵌套布局。

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

    const problems = unresolvableRows(derived)
    check('派生结果里未禁用的行，包都能在本机安装里解析（broken 预设的成因）', problems.length === 0, JSON.stringify(problems))

    // 让这条检查"有牙齿"：包内模板在同一条线上确实有问题时，把它打出来 —— 那正是不能照搬它的原因。
    const packedProblems = unresolvableRows(readFileSync(join(packagedPresetDir(), 'agent.cordis.yml'), 'utf8'))
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
console.log('=== 描述迁移：只清我们自己写过的那条（中英拼接）===')
{
  // 实测来源（2026-10-01，BOWLUNA 的反馈）：模式选择器里那条 `中文 / English` 拼接被读成
  // "一种语言夹在另一种里"。描述是**产品数据**，壳能本地化自己的出厂预设、不能本地化我们的。
  // 所以模板不再写描述，并把我们早年写进去的那两条**逐字**清掉；用户自己写的，一个字都不动。
  const dir = mkdtempSync(join(tmpdir(), 'dsh-seed-desc-'))

  const shippedMeta = readPresetMeta(packagedPresetDir())
  check('包内模板不再带描述', shippedMeta.description.trim() === '', JSON.stringify(shippedMeta.description))

  for (const shipped of SHIPPED_DESCRIPTIONS) {
    writePresetMeta('自定义模式', shipped, dir)
    const out = dropShippedDescription(dir)
    check(
      `清掉我们当年写的那条（${shipped.slice(0, 12)}…）`,
      out.migrated === true && readPresetMeta(dir).description.trim() === '',
      JSON.stringify(out) + ' -> ' + JSON.stringify(readPresetMeta(dir).description),
    )
    check('名字没被动过', readPresetMeta(dir).name === '自定义模式', String(readPresetMeta(dir).name))
  }

  writePresetMeta('自定义模式', '我自己的描述', dir)
  const kept = dropShippedDescription(dir)
  check('用户自己写的描述一个字都不动', kept.migrated === false && readPresetMeta(dir).description === '我自己的描述', JSON.stringify(kept))

  writePresetMeta('自定义模式', '', dir)
  check('本来就是空的：无操作且不报错', dropShippedDescription(dir).migrated === false)

  rmSync(dir, { recursive: true, force: true })
  check('没有 preset.yml 时不抛', dropShippedDescription(join(tmpdir(), 'dsh-seed-nope-' + String(Date.now()))).migrated === false)
}

console.log()
console.log('=== agent-presets.default：只填空缺 ===')
{
  const home = mkdtempSync(join(tmpdir(), 'dsh-default-'))
  const preset = join(home, '.agent-presets', 'custom')
  mkdirSync(preset, { recursive: true })
  const missing = ensureUnsetDefaultPreset(home, 'custom')
  check('没有 prompt.md 时不写 settings.yaml', missing.wrote === false && missing.reason === 'no-preset' && existsSync(join(home, 'settings.yaml')) === false, JSON.stringify(missing))
  writeFileSync(join(preset, 'prompt.md'), 'hello\n', 'utf8')
  const created = ensureUnsetDefaultPreset(home, 'custom')
  check('空 home 写成 custom', created.wrote === true && readFileSync(join(home, 'settings.yaml'), 'utf8').includes('default: custom'), JSON.stringify(created))
  writeFileSync(join(home, 'settings.yaml'), 'locale: zh\nagent-presets:\n  default: standard\n', 'utf8')
  const kept = ensureUnsetDefaultPreset(home, 'custom')
  check('已有 standard 时不改', kept.wrote === false && readFileSync(join(home, 'settings.yaml'), 'utf8').includes('default: standard'), JSON.stringify(kept))
  writeFileSync(join(home, 'settings.yaml'), 'locale: zh\n', 'utf8')
  const appended = ensureUnsetDefaultPreset(home, 'custom')
  const appendedText = readFileSync(join(home, 'settings.yaml'), 'utf8')
  check('没有该键时追加，并保留原有键', appended.wrote === true && appendedText.includes('locale: zh') && appendedText.includes('default: custom'), appendedText)
  for (const sample of [
    'agent-presets: {}\n',
    'agent-presets: {default: standard}\n',
    'agent-presets: null\n',
    'base: &presetSettings {}\nagent-presets: *presetSettings\n',
    '"agent-presets":\n  "default": standard\n',
    "'agent-presets':\n  'default': standard\n",
  ]) {
    writeFileSync(join(home, 'settings.yaml'), sample, 'utf8')
    const preserved = ensureUnsetDefaultPreset(home, 'custom')
    check('已有 YAML 表达保留原字节：' + sample.split('\n')[0], preserved.wrote === false && readFileSync(join(home, 'settings.yaml'), 'utf8') === sample, JSON.stringify(preserved))
  }
  writeFileSync(join(home, 'settings.yaml'), '"agent-presets": # existing section\n  order: 1\nlocale: en\n', 'utf8')
  const quoted = ensureUnsetDefaultPreset(home, 'custom')
  const quotedText = readFileSync(join(home, 'settings.yaml'), 'utf8')
  check('带引号的空缺区块只插入默认值，不重复根键', quoted.wrote === true && quotedText === '"agent-presets": # existing section\n  default: custom\n  order: 1\nlocale: en\n', quotedText)
  check('重复启动不再写入', ensureUnsetDefaultPreset(home, 'custom').wrote === false && readFileSync(join(home, 'settings.yaml'), 'utf8') === quotedText)
  rmSync(home, { recursive: true, force: true })
}

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
