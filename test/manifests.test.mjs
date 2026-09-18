/**
 * The repository has TWO manifests, and a storefront can reach the plugin through either.
 *
 * `package.json` at the root is what a GitHub-URL install reads (the new Plugins page takes a repo
 * URL as one of its three inputs); `editor/package.json` is what an npm publish carries. Measured
 * before this test existed: pasting the repository URL installed the whole repo, whose root manifest
 * had **no `dsh` field at all** — so pnpm reported success, no bundle row was inserted, the host half
 * never ran, and the setup silently did nothing. The two versions had already drifted (root said
 * `0.1.6-alpha.1`, editor said `0.1.6-alpha.1.rev2`) before anyone noticed.
 *
 * Two manifests describing one plugin is a drift hazard, so it is asserted rather than trusted.
 *
 * Run: node test/manifests.test.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
const editor = JSON.parse(readFileSync(join(REPO, 'editor', 'package.json'), 'utf8'))

let passed = 0
let failed = 0
const check = (label, condition, detail = '') => {
  if (condition) { passed += 1; console.log(`PASS  ${label}`) }
  else { failed += 1; console.log(`FAIL  ${label}${detail === '' ? '' : '  → ' + detail}`) }
}

/** Resolve a repo-relative declared path and report whether the file is there. */
const exists = (rel) => existsSync(resolve(REPO, rel))

console.log('=== 1. 两个清单必须描述同一个插件 ===')
check('包名一致', root.name === editor.name, `${root.name} vs ${editor.name}`)
check('版本一致', root.version === editor.version, `${root.version} vs ${editor.version}`)

console.log()
console.log('=== 2. 根清单必须让「GitHub 地址安装」真的可用 ===')
// 这是本次修复的核心：没有 dsh.bundle，loader 不会插入任何行，安装等于空转。
check('根清单声明了 dsh.bundle.patch', typeof root.dsh?.bundle?.patch === 'string', JSON.stringify(root.dsh ?? null))
check('根清单声明了 dsh.client.platform = web', root.dsh?.client?.platform === 'web', String(root.dsh?.client?.platform))
check('根清单声明了 exports["./client"]', typeof root.exports === 'object' && typeof root.exports['./client'] === 'string')
check('根清单声明了 main', typeof root.main === 'string')

console.log()
console.log('=== 3. 声明的路径必须真实存在 ===')
check('dsh.bundle.patch 指向的文件存在', exists(root.dsh.bundle.patch), root.dsh.bundle.patch)
check('exports["./client"] 指向的文件存在', exists(root.exports['./client']), root.exports['./client'])
check('main 指向的文件存在', exists(root.main), root.main)

console.log()
console.log('=== 3.5 两个 shell 脚本不得把绝对路径嵌进 node -e/-p 字符串 ===')
{
  // 来自一次 Windows 实测：Git Bash 里 `$(pwd)` 是 `/c/Users/…`，把它嵌进
  // `node -e "require('/c/…')"` 之后不再触发 MSYS 的路径转换，Windows 的 node 直接
  // MODULE_NOT_FOUND —— install.sh 崩在读包名上，而版本自检那行还因为 `|| echo '?'`
  // 静默降级成了 "?"，等于在最需要自检的环境里失去了自检。
  //
  // 正确写法：把路径**当参数**传给 node（脚本里用 process.argv），或把相对路径交给
  // tools/ 下的脚本。这条检查不依赖平台，所以在任何 CI 上都拦得住这类回归。
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  for (const script of ['install.sh', 'uninstall.sh']) {
    const source = readFileSync(join(root, script), 'utf8')
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
}

console.log('=== 4. 两个清单指向同一批文件（防漂移）===')
check(
  '根 dsh.bundle.patch 与 editor 的 patch 是同一个文件',
  resolve(REPO, root.dsh.bundle.patch) === resolve(REPO, 'editor', editor.dsh.bundle.patch),
  `${root.dsh.bundle.patch} vs editor/${editor.dsh.bundle.patch}`,
)
check(
  '根 exports["./client"] 与 editor 的 client 是同一个文件',
  resolve(REPO, root.exports['./client']) === resolve(REPO, 'editor', editor.exports['./client']),
)
check(
  '根 main 与 editor 的 main 是同一个文件',
  resolve(REPO, root.main) === resolve(REPO, 'editor', editor.main),
)

console.log()
console.log('=== 5. 根清单不应被误发布到 npm ===')
// 发的是 editor/ 的内容；根清单 private 是防手滑的安全带。
check('根清单仍然是 private', root.private === true, String(root.private))

console.log()
console.log('=== 6. npm 的 files 白名单必须覆盖运行时真正会 import 的模块 ===')
// 这条是实战教训：多助手新增 `editor/assistants.mjs` 时忘了加进 `files`，本地一切正常
// （仓库里文件就在那儿），而 npm 装出来的包一激活就 import 失败。白名单少一个文件 =
// 插件坏掉，所以把依赖图走一遍来断言，而不是靠人记得。
{
  const PACKAGE_ROOT = join(REPO, 'editor')
  const shipped = new Set(editor.files ?? [])
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
  const clientFile = editor.exports?.['./client']
  check(
    'exports["./client"] 的那份文件也在 files 里',
    typeof clientFile === 'string' && covered(relative(PACKAGE_ROOT, resolve(PACKAGE_ROOT, clientFile)).split(sep).join('/')),
    String(clientFile),
  )
}

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
