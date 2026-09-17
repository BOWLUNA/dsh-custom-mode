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
import { dirname, join, resolve } from 'node:path'
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
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
