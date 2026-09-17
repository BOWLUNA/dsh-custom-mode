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

const { seedPreset, seedPresetWithLog, packagedPresetDir, PRESET_FILES } = await import('../editor/seed.mjs')

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
  const locked = join(root, 'locked')
  mkdirSync(locked, { recursive: true })
  chmodSync(locked, 0o500) // r-x：可以进入，不能创建
  let threw = false
  let result
  try {
    result = seedPreset(join(locked, 'custom'))
  } catch (error) {
    threw = true
    result = { errors: [String(error)] }
  }
  check('没有抛出异常', threw === false)
  check('记录了错误', result.errors.length > 0, JSON.stringify(result))
  check('没有假装成功', result.created.length === 0, JSON.stringify(result.created))
  chmodSync(locked, 0o700)
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

  // 真的造一个不可写的父目录，否则 mkdir -p 会轻松成功，这一条就测了个寂寞
  const locked = join(root, 'locked')
  mkdirSync(locked, { recursive: true })
  chmodSync(locked, 0o500)
  const infos3 = []
  const logs3 = []
  seedPresetWithLog(join(locked, 'custom'), (m) => logs3.push(m), (m) => infos3.push(m))
  check('失败时给出可读日志', logs3.length > 0 && logs3[0].includes('custom-mode:'), JSON.stringify(logs3))
  chmodSync(locked, 0o700)
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
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
