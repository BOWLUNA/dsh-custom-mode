/**
 * The repository root IS the published package (since 1.10.0), and every install channel
 * reads that one manifest.
 *
 * Before 1.10.0 this repository carried **two** manifests: a `private: true` wrapper at the root
 * (what a GitHub-URL install read) and `editor/package.json` (what an npm publish carried). That
 * split was the reason the plugin showed up in third-party catalogues as `dsh-custom-mode#editor`
 * and why dshfind-derived cards said "not published to npm" — a detector reading the root manifest
 * saw `private: true` and concluded exactly that. Flattening made one manifest, and this suite is
 * the guard that keeps it one.
 *
 * Measured before the split was fixed: pasting the repository URL installed the whole repo, whose
 * root manifest had **no `dsh` field at all** — so pnpm reported success, no bundle row was
 * inserted, the host half never ran, and the setup silently did nothing.
 *
 * Run: node test/manifests.test.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))

let passed = 0
let failed = 0
const check = (label, condition, detail = '') => {
  if (condition) { passed += 1; console.log(`PASS  ${label}`) }
  else { failed += 1; console.log(`FAIL  ${label}${detail === '' ? '' : '  → ' + detail}`) }
}

/** Resolve a repo-relative declared path and report whether the file is there. */
const exists = (rel) => existsSync(resolve(REPO, rel))

console.log('=== 1. 仓库根清单就是发布清单（单一事实来源）===')
check('package.json 在仓库根', exists('package.json'))
check(
  '仓库里不再有第二份清单（回归守卫：不允许把 editor/ 那份加回来）',
  !exists(join('editor', 'package.json')),
  'editor/package.json 又出现了 —— 第三方平台会重新开始看到 #editor 后缀',
)
// dshfind 之类的探测器读的就是根清单的 private：标了 true 就会被判成"作者尚未发布到 npm"。
check('根清单不是 private（否则第三方平台读不出"已发布到 npm"）', pkg.private !== true, String(pkg.private))
check('包名是 dsh-custom-mode', pkg.name === 'dsh-custom-mode', String(pkg.name))

console.log()
console.log('=== 2. 这一份清单必须让所有安装渠道真的可用（npm / GitHub 地址 / 本地目录）===')
// 这是核心：没有 dsh.bundle，loader 不会插入任何行，安装等于空转。
check('清单声明了 dsh.bundle.patch', typeof pkg.dsh?.bundle?.patch === 'string', JSON.stringify(pkg.dsh ?? null))
check('清单声明了 dsh.client.platform = web', pkg.dsh?.client?.platform === 'web', String(pkg.dsh?.client?.platform))
check('清单声明了 exports["./client"]', typeof pkg.exports === 'object' && typeof pkg.exports['./client'] === 'string')
check('清单声明了 main', typeof pkg.main === 'string')
check('engines.dsh 与 peer 范围都存在且完全一致', typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh === pkg.peerDependencies?.['@deepseek-ai/dsh'], `${pkg.engines?.dsh} vs ${pkg.peerDependencies?.['@deepseek-ai/dsh']}`)
check('peer 被标为 optional（否则装完第一眼是 WARN）', pkg.peerDependenciesMeta?.['@deepseek-ai/dsh']?.optional === true)

console.log()
console.log('=== 3. 声明的路径必须真实存在 ===')
check('dsh.bundle.patch 指向的文件存在', exists(pkg.dsh.bundle.patch), pkg.dsh.bundle.patch)
check('exports["./client"] 指向的文件存在', exists(pkg.exports['./client']), pkg.exports['./client'])
check('main 指向的文件存在', exists(pkg.main), pkg.main)
check('screenshots.json 存在（商店卡片从仓库读它）', exists('screenshots.json'))
{
  const shots = JSON.parse(readFileSync(join(REPO, 'screenshots.json'), 'utf8')).screenshots ?? []
  check('screenshots.json 里的图都真实存在', shots.length > 0 && shots.every((rel) => exists(rel)), JSON.stringify(shots))
}

console.log()
console.log('=== 4. 两个 shell 脚本不得把绝对路径嵌进 node -e/-p 字符串 ===')
{
  // 来自一次 Windows 实测：Git Bash 里 `$(pwd)` 是 `/c/Users/…`，把它嵌进
  // `node -e "require('/c/…')"` 之后不再触发 MSYS 的路径转换，Windows 的 node 直接
  // MODULE_NOT_FOUND —— install.sh 崩在读包名上，而版本自检那行还因为 `|| echo '?'`
  // 静默降级成了 "?"，等于在最需要自检的环境里失去了自检。
  //
  // 正确写法：把路径**当参数**传给 node（脚本里用 process.argv），或把相对路径交给
  // tools/ 下的脚本。这条检查不依赖平台，所以在任何 CI 上都拦得住这类回归。
  for (const script of ['install.sh', 'uninstall.sh']) {
    const source = readFileSync(join(REPO, script), 'utf8')
    const inline = [...source.matchAll(/node\s+-[ep]\s+"([^"]*)"/g)].map((match) => match[1])
    const offenders = inline.filter((code) => /\$ROOT|\$\(pwd\)|\$PWD/.test(code))
    check(
      `${script} 的 node -e/-p 字符串里没有绝对路径`,
      offenders.length === 0,
      offenders.map((code) => code.slice(0, 70)).join(' | '),
    )
    check(
      `${script} 读到了内容（避免空集假通过）`,
      inline.length > 0 || source.includes('node tools/'),
      String(inline.length),
    )
  }

  // install.sh 必须认得出**新线**的 preset 机制。实测（2026-09-25，0.1.7-rc.2，干净实例）：组合树里
  // 根本没有 'dsh-agent-presets' 字样（0 次），而模式确实注册成功、也出现在选择器里 —— 只按复数包名
  // 判断会给最新线的用户一句"「自定义模式」无法被选中"的假警报，而那条线正是官方桌面端内置的。
  {
    const source = readFileSync(join(REPO, 'install.sh'), 'utf8')
    check('install.sh 认得出声明式注册表（dsh-agent-preset-registry）', source.includes('dsh-agent-preset-registry'))
    check('install.sh 仍认旧线的复数包（dsh-agent-presets）', source.includes('@deepseek-ai/dsh-agent-presets'))
  }

  // 桌面端的 `profiles/desktop` 由 Electron 独占，**运行时就会拒**（实测 0.1.7-rc.2：
  // `dsh plugin --profile desktop add .` → 'profile "desktop" is managed exclusively by the
  // Electron application'）。脚本必须站在同一边，而不是绕过去写那个 profile —— 那会与应用的包管理
  // 及启动恢复（重命名 cordis.patch.yml）打架。测试读源码即可：真正执行要一个 dsh 实例。
  for (const script of ['install.sh', 'uninstall.sh']) {
    const source = readFileSync(join(REPO, script), 'utf8')
    check(
      `${script} 拒绝 desktop profile`,
      source.includes('[ "$PROFILE" = "desktop" ]') && source.includes('DSH_ALLOW_DESKTOP_PROFILE'),
    )
    check(`${script} 指向桌面端应用内安装（不是 CLI）`, source.includes('managed exclusively') || source.includes('Plugins') || source.includes('插件'))
  }
}

console.log()
console.log('=== 5. npm 的 files 白名单必须覆盖运行时真正会 import 的模块 ===')
// 这条是实战教训：多助手新增 `assistants.mjs` 时忘了加进 `files`，本地一切正常
// （仓库里文件就在那儿），而 npm 装出来的包一激活就 import 失败。白名单少一个文件 =
// 插件坏掉，所以把依赖图走一遍来断言，而不是靠人记得。
{
  const PACKAGE_ROOT = REPO
  const shipped = new Set(pkg.files ?? [])
  const covered = (rel) => shipped.has(rel) || [...shipped].some((entry) => entry.endsWith('/') && rel.startsWith(entry))
  const reachable = new Set()
  const pending = [join(PACKAGE_ROOT, 'index.mjs')]
  const unshipped = []
  while (pending.length > 0) {
    const file = pending.pop()
    if (reachable.has(file) || !existsSync(file)) continue
    reachable.add(file)
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = resolve(dirname(file), match[1])
      const rel = relative(PACKAGE_ROOT, target).split(sep).join('/')
      if (!covered(rel)) unshipped.push(rel)
      pending.push(target)
    }
  }
  check('走了一遍 main 的依赖图（不是空跑）', reachable.size >= 6, String(reachable.size))
  check('main 能 import 到的模块都在 files 里', unshipped.length === 0, JSON.stringify([...new Set(unshipped)]))
  check('preset/ 在 files 白名单里（npm 包里必须带着预设）', covered('preset/prompt.md'))
  const clientFile = pkg.exports?.['./client']
  check(
    'exports["./client"] 的那份文件也在 files 里',
    typeof clientFile === 'string' && covered(relative(PACKAGE_ROOT, resolve(PACKAGE_ROOT, clientFile)).split(sep).join('/')),
    String(clientFile),
  )
}

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
