/**
 * Browser-half contract tests.
 *
 * Run: node test/client-bundle.test.mjs
 *
 * Why this exists: `editor/client.js` is a hand-written client bundle, and the way it fails is
 * **silent**. `docs/ARCHITECTURE.md` §3 records the one that actually happened: the bundle was in the
 * module graph, served, and at the right revision — but the page never appeared, because the client
 * registry guards service reads and `apply` was rejected. The fix was exporting `inject`. Nothing
 * tested that, and nothing tested any of the rest of the registration contract either.
 *
 * It also pins the two-module contract the bundle relies on: `react` always, and the shell's shared
 * atom library — which must be OPTIONAL, because a shell that does not seed it has to degrade to the
 * built-in plain controls rather than lose the page. Both branches are exercised below.
 *
 * What this does NOT do: render the component. That needs a browser, and emulating React here would
 * prove nothing about the real shell. It loads the bundle the way the client module loader does,
 * runs `apply` against a stand-in `ctx`, and asserts the registration the settings shell depends on.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(REPO, 'editor', 'client.js')
const ATOMS = '@deepseek-ai/dsh-client-ui-primitives'

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

const pkg = JSON.parse(readFileSync(join(REPO, 'editor', 'package.json'), 'utf8'))

/** Enough React for a factory that only DEFINES components — nothing is rendered here. */
const reactStub = {
  createElement: (...args) => ({ type: args[0], props: args[1], children: args.slice(2) }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}

/** Stand-ins for the shell's atoms: only `typeof === "function"` is contract-checked. */
const atomsStub = {
  Button: function Button() {},
  Input: function Input() {},
  Switch: function Switch() {},
  Tag: function Tag() {},
  Pill: function Pill() {},
  RiskConfirmation: function RiskConfirmation() {},
  IconPlusOutline16: function IconPlusOutline16() {},
  IconTrashOutline16: function IconTrashOutline16() {},
  IconCopyOutline16: function IconCopyOutline16() {},
  IconRefreshOutline16: function IconRefreshOutline16() {},
  IconCheckOutline14: function IconCheckOutline14() {},
}

/**
 * Load the bundle the way the client module loader does.
 *
 * `withAtoms` decides whether the shell "seeds" the atom module; a false value makes `require`
 * throw for it, which is what an older shell does. The cache-busting query gives each case a
 * fresh module instance, since the bundle registers itself as a side effect.
 */
async function loadBundle({ withAtoms, caseName }) {
  const requested = []
  let entry = null
  globalThis.window = { __ModuleLoader__: { load: (loaded) => { entry = loaded } } }
  const requireStub = (name) => {
    requested.push(name)
    if (name === 'react') return reactStub
    if (name === ATOMS) {
      if (!withAtoms) throw new Error(`Cannot find module '${ATOMS}'`)
      return atomsStub
    }
    throw new Error(`本测试没有为 ${JSON.stringify(name)} 准备桩`)
  }
  await import(pathToFileURL(BUNDLE).href + '?case=' + encodeURIComponent(caseName))
  const exports = entry === null ? undefined : entry.factory(requireStub)
  return { entry, exports, requested }
}

const withAtoms = await loadBundle({ withAtoms: true, caseName: 'atoms' })
const loaded = withAtoms.entry
const exports = withAtoms.exports

check('bundle 向 __ModuleLoader__ 注册了自己', loaded !== null && loaded !== undefined)
check('bundle id 等于包名（客户端注册表按它找模块）', loaded?.id === pkg.name, String(loaded?.id))
check('factory 是函数', typeof loaded?.factory === 'function')
check('factory 返回 exports', exports !== undefined && exports !== null)
check('导出了 apply', typeof exports?.apply === 'function')
check(
  '导出了 inject，且声明了 slots 与 locale（缺了它注册会被守卫拒绝，页面静默不出现）',
  Array.isArray(exports?.inject) && exports.inject.includes('slots') && exports.inject.includes('locale'),
  JSON.stringify(exports?.inject),
)
check('向壳要了 react', withAtoms.requested.includes('react'), JSON.stringify(withAtoms.requested))
check('向壳要了共享原子组件库', withAtoms.requested.includes(ATOMS), JSON.stringify(withAtoms.requested))

// ── 用桩 ctx 跑一次 apply ───────────────────────────────────────────────────
/**
 * `localeMode` says what the shell's locale service does:
 *  - `working`      the shipped behaviour (a bound `t` that answers)
 *  - `returns-keys` the OBSERVED failure: the dictionary never lands, so `t` echoes the key
 *  - `absent`       no locale service at all
 */
function makeCtx({ withLocale = true, withSlots = true, localeMode = 'working' } = {}) {
  const seen = { dictionaries: null, navNs: null, injected: null, registered: null }
  const slots = {
    inject(name, callback) {
      seen.injected = name
      callback()
    },
    register(options, component) {
      seen.registered = { options, component }
      return () => {}
    },
  }
  const ctx = {
    effect(fn) {
      return fn()
    },
    get(name) {
      if (name === 'locale' && withLocale) {
        return {
          bind(ns) {
            seen.navNs = ns
            if (localeMode === 'returns-keys') return (key) => key
            return (key) => `t:${key}`
          },
          getLocale() {
            return { active: 'zh', locales: [], revision: 0 }
          },
          register(ns, dictionaries) {
            seen.dictionaries = { ns, dictionaries }
            return () => {}
          },
        }
      }
      if (name === 'slots' && withSlots) return slots
      return undefined
    },
  }
  return { ctx, seen }
}

console.log()
console.log('=== 1. 注册进 settings.section 的那一条 ===')
{
  const { ctx, seen } = makeCtx()
  let threw = null
  try {
    exports.apply(ctx)
  } catch (error) {
    threw = error
  }
  check('apply 不抛异常', threw === null, String(threw && threw.message))
  check('向 settings.section 注入', seen.injected === 'settings.section', String(seen.injected))

  const { options, component } = seen.registered ?? {}
  check('注册了组件', typeof component === 'function')
  check('slot 名与注入的一致', options?.name === 'settings.section', String(options?.name))
  check('有稳定的 id（设置面板按它去重）', options?.id === 'custom-system-prompt', String(options?.id))
  check('声明了 locale 命名空间（shell 才会递进来绑定的 t）', options?.locale === 'settings.customMode', String(options?.locale))
  check(
    '注册了中英两份词典',
    seen.dictionaries?.ns === 'settings.customMode' && typeof seen.dictionaries?.dictionaries === 'object',
    JSON.stringify(Object.keys(seen.dictionaries?.dictionaries ?? {})),
  )
  check('label 是 thunk 而不是字符串', typeof options?.label === 'function')
  check('label() 返回本地化后的导航名', options?.label() === 't:nav', String(options?.label?.()))
}

console.log()
console.log('=== 2. 失败策略：缺服务也不能把整页拖垮 ===')
{
  // 没有 locale：标签要退回内置中文词典，而不是抛异常。
  const noLocale = makeCtx({ withLocale: false })
  let threwLocale = null
  try {
    exports.apply(noLocale.ctx)
  } catch (error) {
    threwLocale = error
  }
  check('缺 locale 时不抛异常', threwLocale === null, String(threwLocale && threwLocale.message))
  check('缺 locale 时仍然完成注册', noLocale.seen.registered !== null)

  // 没有 slots：整块不注册，但页面（以及其它设置页）不受影响。
  const noSlots = makeCtx({ withSlots: false })
  let threwSlots = null
  try {
    exports.apply(noSlots.ctx)
  } catch (error) {
    threwSlots = error
  }
  check('缺 slots 时不抛异常', threwSlots === null, String(threwSlots && threwSlots.message))
  check('缺 slots 时没有注册任何东西', noSlots.seen.registered === null)
}

console.log()
console.log('=== 3. 壳的词典查不到时：内置词典兜底，绝不显示键名 ===')
{
  // 这是线上实测到的失败：页面能开、插槽也在，但 `t()` 一律回显键名，
  // 于是整页变成 assistant.heading / btn.create 这种原始键。bundle 自带词典，
  // 所以它必须自己兜住——导航标签这个 thunk 是最容易断言的一处。
  const broken = makeCtx({ localeMode: 'returns-keys' })
  let threw = null
  try {
    exports.apply(broken.ctx)
  } catch (error) {
    threw = error
  }
  check('词典查不到时 apply 仍不抛异常', threw === null, String(threw && threw.message))
  const label = broken.seen.registered?.options?.label
  check('仍然注册了设置项', broken.seen.registered !== null)
  check('label 是 thunk', typeof label === 'function')
  check('导航标签不再是裸键 nav', label?.() !== 'nav', String(label?.()))
  check('导航标签落到内置中文词典', label?.() === '自定义模式', String(label?.()))

  // 完全没有 locale 服务时同理。
  const none = makeCtx({ withLocale: false })
  exports.apply(none.ctx)
  check('没有 locale 服务时导航标签也是中文', none.seen.registered?.options?.label?.() === '自定义模式', String(none.seen.registered?.options?.label?.()))
}

console.log()
console.log('=== 4. 壳没有共享原子组件时：降级，而不是白屏 ===')
{
  // 老壳的种子表里没有 ui-primitives。bundle 必须照常注册，并退回内置朴素控件。
  let fallback = null
  let threw = null
  try {
    fallback = await loadBundle({ withAtoms: false, caseName: 'no-atoms' })
  } catch (error) {
    threw = error
  }
  check('模块缺失时装载不抛异常', threw === null, String(threw && threw.message))
  check('仍然导出了 apply', typeof fallback?.exports?.apply === 'function')
  check('确实尝试过原子组件库（否则这个降级测试是空跑）', fallback?.requested?.includes(ATOMS), JSON.stringify(fallback?.requested))

  const { ctx, seen } = makeCtx()
  let applyThrew = null
  try {
    fallback.exports.apply(ctx)
  } catch (error) {
    applyThrew = error
  }
  check('降级路径下 apply 也不抛异常', applyThrew === null, String(applyThrew && applyThrew.message))
  check('降级路径下照常注册', seen.registered?.options?.id === 'custom-system-prompt', JSON.stringify(seen.registered?.options?.id))
}

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
