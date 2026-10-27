/**
 * Execute the original settings component's handlers against deferred HTTP/file
 * reads. Hook storage and native atoms are stand-ins: these assertions cover
 * request ownership and state transitions, not React rendering, CSS or clicks.
 * Run: node test/client-async.test.mjs [--case=reload] [--bundle=/path/client.js]
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { en } from '../locales.mjs'

const option = (name) => process.argv.find((arg) => arg.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const source = readFileSync(option('bundle') || fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const fixture = (id = 'a', prompt = 'OLD ' + id, n = 1) => ({
  ok: true, id, name: id.toUpperCase(), description: '', prompt, mode: 'standard', overrides: {},
  modes: [{ id: 'standard' }, { id: 'minimal' }], rows: [], warnings: [],
  history: [{ n, at: '2026-10-27T00:00:00.000Z', bytes: 5, by: 'settings' }],
})
const roster = (ids = ['a', 'b']) => ({
  ok: true, assistants: ids.map((id) => ({ id, name: id.toUpperCase() })),
  postures: [{ id: 'develop' }, { id: 'write' }, { id: 'chat' }],
})
const text = (node) => node == null ? '' : typeof node !== 'object' ? String(node)
  : (node.props?.text || '') + (node.props?.children || []).map(text).join('')

function harness() {
  const hooks = [], pendingEffects = [], requests = [], files = []
  let cursor = 0, writes = 0, component, tree
  const atoms = Object.fromEntries(['Button', 'Input', 'Switch', 'Tag', 'Pill', 'Menu', 'IconChevronDownOutlineRegular'].map((name) => [name, function Atom() {}]))
  const react = {
    createElement(type, props, ...children) { return { type, key: props?.key, props: { ...props, children: children.flat(Infinity) } } },
    useState(initial) {
      const at = cursor++
      hooks[at] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[at].value, (next) => { writes++; hooks[at].value = typeof next === 'function' ? next(hooks[at].value) : next }]
    },
    useRef(initial) { const at = cursor++; hooks[at] ??= { value: { current: initial } }; return hooks[at].value },
    useEffect(effect, deps) {
      const at = cursor++, before = hooks[at]
      if (before === undefined || deps.some((value, i) => value !== before.deps[i])) {
        hooks[at] = { deps, effect, cleanup: before?.cleanup }
        pendingEffects.push(at)
      }
    },
  }
  let registration
  const sandbox = {
    console, setTimeout, clearTimeout, URL,
    window: { confirm: () => true, __ModuleLoader__: { load: (entry) => { registration = entry } } },
    fetch(url, options = {}) {
      const result = deferred()
      requests.push({ url, options, result })
      return result.promise.then((value) => ({ json: async () => value }))
    },
    FileReader: class {
      constructor() { files.push(this) }
      readAsText() {}
    },
  }
  runInNewContext(source, sandbox)
  const bundle = registration.factory((name) => name === 'react' ? react : atoms)
  const locale = { bind: () => (key) => en[key] || key, getLocale: () => ({ active: 'en' }), register: () => () => {} }
  bundle.apply({ effect: (fn) => fn(), get: (name) => name === 'locale' ? locale : {
    inject: (_name, callback) => callback(), register: (_options, fn) => { component = fn },
  } })
  const api = {
    requests, files, atoms,
    render() { cursor = 0; tree = component({ t: (key) => en[key] || key }); return tree },
    effects() { for (const at of pendingEffects.splice(0)) { hooks[at].cleanup?.(); hooks[at].cleanup = hooks[at].effect() } },
    cleanup() { for (const hook of hooks) hook.cleanup?.() },
    replay() { for (const hook of hooks) if (hook.effect) hook.cleanup = hook.effect() },
    get writes() { return writes },
    all(predicate) {
      const found = []
      const walk = (node) => {
        if (node == null || typeof node !== 'object') return
        if (predicate(node)) found.push(node)
        for (const child of node.props?.children || []) walk(child)
        if (node.props?.anchor) walk(node.props.anchor)
      }
      walk(tree)
      return found
    },
    find(predicate) { const found = api.all(predicate)[0]; assert.ok(found, 'element exists'); return found },
    button(label) { return api.find((node) => node.type === atoms.Button && text(node) === label) },
    prompt() { return api.find((node) => node.type === 'textarea' && node.props.className === 'cpfe-editor') },
    selector() { return api.find((node) => node.type === atoms.Menu && node.props.items?.[0]?.id === 'a') },
    status() { return api.find((node) => node.props?.className?.split(' ').includes('cpfe-status')) },
    request(path, method = 'GET') {
      const index = requests.findIndex((request) => request.url === '/api/custom-mode' + path && (request.options.method || 'GET') === method)
      assert.ok(index >= 0, method + ' ' + path + ' requested')
      return requests.splice(index, 1)[0]
    },
    async flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); api.render() },
    async ready(ids = ['a', 'b']) {
      api.render(); api.effects()
      api.request('').result.resolve(roster(ids)); await api.flush()
      if (ids.length > 0) { api.request('/state?id=' + ids[0]).result.resolve(fixture(ids[0])); await api.flush() }
      return api
    },
  }
  return api
}

const cases = {
  async reload() {
    const app = await harness().ready()
    const oldPrompt = app.prompt()
    const pending = app.button(en['btn.reload']).props.onClick()
    oldPrompt.props.onChange({ target: { value: 'TYPED BEFORE RERENDER' } })
    app.render()
    assert.equal(app.prompt().props.value, 'OLD a', 'synchronous gate rejects edits before the disabled render')
    assert.equal(app.prompt().props.readOnly, true)
    app.selector().props.onSelect('b')
    assert.equal(app.requests.length, 1, 'switch cannot start an overlapping read')
    app.request('').result.resolve(roster()); await app.flush()
    app.request('/state?id=a').result.resolve(fixture()); await pending; await app.flush()
    assert.equal(app.prompt().props.value, 'OLD a')
    assert.equal(app.prompt().props.readOnly, false)
    app.prompt().props.onChange({ target: { value: 'NEW AFTER RELOAD' } }); app.render()
    assert.equal(app.prompt().props.value, 'NEW AFTER RELOAD')
  },
  async reloadFailure() {
    const app = await harness().ready()
    app.prompt().props.onChange({ target: { value: 'KEEP DRAFT' } }); app.render()
    const pending = app.button(en['btn.reloadDiscard']).props.onClick()
    app.request('').result.reject(new Error('synthetic offline')); await pending; await app.flush()
    assert.equal(app.prompt().props.value, 'KEEP DRAFT')
    assert.equal(app.prompt().props.readOnly, false, 'finally unlocks after an exception')
    assert.match(text(app.status()), /synthetic offline/)
    const again = app.button(en['btn.reloadDiscard']).props.onClick()
    app.request('').result.resolve({ ok: false }); await again; await app.flush()
    assert.equal(app.prompt().props.readOnly, false, 'typed read failure also unlocks')
  },
  async initialFailure() {
    const app = harness(); app.render(); app.effects(); app.render()
    assert.equal(text(app.status()), en['status.reading'], 'pending state exists before any editor is loaded')
    app.request('').result.reject(new Error('initial offline')); await app.flush()
    assert.match(text(app.status()), /initial offline/)
    assert.equal(app.button(en['btn.reload']).props.disabled, false)
    const retry = app.button(en['btn.reload']).props.onClick()
    app.request('').result.resolve(roster([])); await retry; await app.flush()
    assert.equal(app.all((node) => node.props?.['aria-busy'] === true).length, 0)
  },
  async staleRead() {
    const app = harness(); app.render(); app.effects()
    const old = app.request('')
    app.cleanup(); app.replay()
    const fresh = app.request('')
    old.result.resolve(roster()); await app.flush()
    assert.equal(app.requests.length, 0, 'stale list response does not start a state read')
    assert.equal(text(app.status()), en['status.reading'], 'old finally cannot release a newer operation')
    fresh.result.resolve(roster(['b'])); await app.flush()
    app.request('/state?id=b').result.resolve(fixture('b')); await app.flush()
    assert.equal(app.prompt().props.value, 'OLD b')
    assert.equal(app.prompt().props.readOnly, false)
  },
  async staleSave() {
    const app = await harness().ready()
    app.prompt().props.onChange({ target: { value: 'SAVE ME' } }); app.render()
    const save = app.button(en['btn.save']).props.onClick()
    app.selector().props.onSelect('b')
    app.prompt().props.onChange({ target: { value: 'DURING SAVE' } }); app.render()
    assert.equal(app.prompt().props.value, 'SAVE ME')
    const post = app.request('/state', 'POST')
    assert.equal(JSON.parse(post.options.body).id, 'a')
    post.result.resolve({ ok: true, code: 'savedPrompt', params: { name: 'A' } }); await app.flush()
    const refresh = app.request('/state?id=a')
    app.cleanup()
    const before = app.writes
    refresh.result.resolve(fixture('a', 'SERVER NORMALIZED')); await save; await app.flush()
    assert.equal(app.writes, before, 'save normalization/finally do not write to an unmounted page')
  },
  async staleSwitch() {
    const app = await harness().ready()
    app.selector().props.onSelect('b')
    const read = app.request('/state?id=b')
    app.cleanup()
    const before = app.writes
    read.result.resolve(fixture('b')); await app.flush()
    assert.equal(app.writes, before, 'a late assistant-switch response cannot mutate an unmounted page')
  },
  async saveRefreshFailure() {
    const app = await harness().ready()
    app.prompt().props.onChange({ target: { value: 'ALREADY SAVED' } }); app.render()
    const save = app.button(en['btn.save']).props.onClick()
    app.request('/state', 'POST').result.resolve({ ok: true, code: 'savedPrompt', synchronized: true, params: { name: 'A' } }); await app.flush()
    app.request('/state?id=a').result.reject(new Error('refresh offline')); await save; await app.flush()
    assert.equal(app.prompt().props.value, 'ALREADY SAVED')
    assert.equal(app.prompt().props.readOnly, false)
    assert.match(text(app.status()), /System prompt saved/)
    assert.match(text(app.status()), /The page could not refresh/)
    assert.doesNotMatch(text(app.status()), /Could not save/)
  },
  async historyAndImport() {
    const app = await harness().ready()
    app.find((node) => node.type === app.atoms.Menu && node.props.items?.[0]?.id === '1').props.onSelect('1'); app.render()
    const load = app.button(en['history.load']).props.onClick()
    app.selector().props.onSelect('b')
    app.request('/history?id=a&n=1').result.resolve({ ok: true, text: 'HISTORY TEXT' }); await load; await app.flush()
    assert.equal(app.prompt().props.value, 'HISTORY TEXT')
    const input = app.find((node) => node.type === 'input' && node.props.type === 'file')
    const imported = input.props.onChange({ target: { files: [{ size: 2 }], value: 'fixture' } })
    app.selector().props.onSelect('b'); app.render()
    assert.equal(app.prompt().props.readOnly, true)
    app.files[0].result = 'IMPORTED TEXT'; app.files[0].onload(); await imported; await app.flush()
    assert.equal(app.prompt().props.value, 'IMPORTED TEXT')
    assert.equal(app.prompt().props.readOnly, false)
    const failed = input.props.onChange({ target: { files: [{ size: 2 }] } })
    app.files[1].error = new Error('synthetic file error'); app.files[1].onerror(); await failed; await app.flush()
    assert.equal(app.prompt().props.value, 'IMPORTED TEXT')
    assert.equal(app.prompt().props.readOnly, false)
  },
  async persistedSaveAndRetry() {
    const app = await harness().ready()
    app.prompt().props.onChange({ target: { value: 'PERSISTED' } }); app.render()
    const save = app.button(en['btn.save']).props.onClick()
    app.request('/state', 'POST').result.resolve({ ok: false, code: 'savedButSyncFailed', persisted: true, synchronized: false, params: { ids: 'a' } })
    await save; await app.flush()
    assert.equal(app.prompt().props.value, 'PERSISTED')
    assert.equal(app.button(en['btn.save']).props.disabled, true)
    assert.match(text(app.status()), /Files are saved/)
    assert.match(app.status().props.className, /cpfe-err/)
    app.prompt().props.onChange({ target: { value: 'NEWER DRAFT' } }); app.render()
    const retry = app.button(en['btn.retrySync']).props.onClick()
    app.request('/sync', 'POST').result.resolve({ ok: true, code: 'synchronized', synchronized: true }); await app.flush()
    app.request('').result.resolve(roster()); await app.flush()
    app.request('/state?id=a').result.resolve(fixture('a', 'PERSISTED', 2)); await retry; await app.flush()
    assert.equal(app.prompt().props.value, 'NEWER DRAFT', 'sync retry preserves edits made since the failed activation')
    const next = app.button(en['btn.save']).props.onClick()
    const post = app.request('/state', 'POST')
    assert.equal(JSON.parse(post.options.body).baseN, 2, 'next save uses the refreshed baseline, not stale draft history')
    post.result.resolve({ ok: false, code: 'badJson' }); await next; await app.flush()
  },
  async persistedCreateAndEmptyFeedback() {
    const app = await harness().ready([])
    app.find((node) => node.type === app.atoms.Input && node.props.placeholder === en['assistant.newPlaceholder']).props.onChange({ target: { value: 'B' } }); app.render()
    const create = app.button(en['btn.create']).props.onClick()
    app.request('/create', 'POST').result.resolve({ ok: false, code: 'savedButSyncFailed', persisted: true, synchronized: false, id: 'b', params: { ids: 'b' } }); await app.flush()
    app.request('').result.resolve(roster(['b'])); await app.flush()
    app.request('/state?id=b').result.resolve(fixture('b')); await create; await app.flush()
    assert.equal(app.prompt().props.value, 'OLD b')
    assert.match(app.status().props.className, /cpfe-err/, 'state refresh must not clear an activation failure')
    const retry = app.button(en['btn.retrySync']).props.onClick()
    app.request('/sync', 'POST').result.reject(new Error('sync offline')); await retry; await app.flush()
    assert.equal(app.button(en['btn.retrySync']).props.disabled, false)
    assert.equal(app.requests.length, 0, 'activation retry never replays create')
  },
  async persistedDeleteEmptyFeedback() {
    const app = await harness().ready(['a'])
    app.button(en['btn.delete']).props.onClick()
    app.request('/delete', 'POST').result.resolve({ ok: false, code: 'savedButSyncFailed', persisted: true, synchronized: false, params: { ids: 'a' } }); await app.flush()
    app.request('').result.resolve(roster([])); await app.flush()
    assert.equal(app.all((node) => node.type === 'textarea').length, 0)
    assert.match(text(app.status()), /Files are saved/)
    const retry = app.button(en['btn.retrySync']).props.onClick()
    app.request('/sync', 'POST').result.resolve({ ok: true, code: 'synchronized', synchronized: true }); await app.flush()
    app.request('').result.resolve(roster([])); await retry; await app.flush()
    assert.equal(app.requests.length, 0, 'retry does not repeat a persisted delete')
    assert.equal(app.all((node) => node.type === app.atoms.Button && text(node) === en['btn.retrySync']).length, 0)
  },
  async createRefreshFailure() {
    const app = await harness().ready([])
    app.find((node) => node.type === app.atoms.Input && node.props.placeholder === en['assistant.newPlaceholder']).props.onChange({ target: { value: 'B' } }); app.render()
    const create = app.button(en['btn.create']).props.onClick()
    app.request('/create', 'POST').result.resolve({ ok: true, code: 'created', synchronized: true, id: 'b', params: { name: 'B' } }); await app.flush()
    app.request('').result.reject(new Error('refresh offline')); await create; await app.flush()
    assert.match(text(app.status()), /Created B/)
    assert.match(text(app.status()), /The page could not refresh/)
    assert.doesNotMatch(text(app.status()), /Could not create/)
    const firstRetry = app.button(en['btn.retryRead']).props.onClick()
    app.request('').result.resolve({ ok: false, code: 'internalError', params: { detail: 'synthetic retry failure' } }); await firstRetry; await app.flush()
    assert.match(text(app.status()), /Created B/, 'another refresh failure still preserves confirmed creation')
    const retry = app.button(en['btn.retryRead']).props.onClick()
    app.request('').result.resolve(roster(['b'])); await app.flush()
    app.request('/state?id=b').result.resolve(fixture('b')); await retry; await app.flush()
    assert.equal(app.prompt().props.value, 'OLD b', 'refresh retry selects the newly created assistant')
    assert.equal(app.requests.length, 0, 'creation is not repeated while refreshing')
    assert.equal(app.all((node) => node.type === app.atoms.Button && text(node) === en['btn.retryRead']).length, 0)
  },
  async deleteRefreshFailure() {
    const app = await harness().ready(['a'])
    app.button(en['btn.delete']).props.onClick()
    app.request('/delete', 'POST').result.resolve({ ok: true, code: 'deleted', synchronized: true, params: { name: 'A' } }); await app.flush()
    app.request('').result.reject(new Error('refresh offline')); await app.flush()
    assert.match(text(app.status()), /Deleted A/)
    assert.match(text(app.status()), /The page could not refresh/)
    assert.doesNotMatch(text(app.status()), /Could not delete/)
    const retry = app.button(en['btn.retryRead']).props.onClick()
    app.request('').result.resolve(roster([])); await retry; await app.flush()
    assert.equal(app.all((node) => node.type === 'textarea').length, 0)
    assert.equal(app.requests.length, 0, 'deletion is not repeated while refreshing')
    assert.equal(app.all((node) => node.type === app.atoms.Button && text(node) === en['btn.retryRead']).length, 0)
  },
  async nativeStructure() {
    const app = await harness().ready()
    const create = app.find((node) => node.props?.className === 'cpfe-create')
    const walk = (node) => node == null || typeof node !== 'object' ? [] : [node, ...(node.props?.children || []).flatMap(walk)]
    assert.equal(walk(create).filter((node) => node.type === app.atoms.Pill && node.props.disabled === true).length, 0, 'fixed Standard base is explanatory text, not five disabled buttons')
    assert.match(text(create), /official Standard mode/)
    assert.match(text(create), /mode menu for a new session/)
    assert.ok(app.all((node) => node.props?.text?.includes('Editing A.')).length > 0, 'the current editing target is named')
    assert.equal(app.status().props['aria-live'], 'polite')
    const longName = 'Synthetic Writing Assistant 文档分析与研究助手'
    const named = harness(); named.render(); named.effects()
    named.request('').result.resolve({ ...roster(['a']), assistants: [{ id: 'a', name: longName }] }); await named.flush()
    named.request('/state?id=a').result.resolve(fixture('a')); await named.flush()
    named.find((node) => node.type === named.atoms.Menu && node.props.items?.[0]?.id === '1').props.onSelect('1'); named.render()
    const triggers = named.all((node) => node.props?.className === 'cpfe-selector')
    assert.equal(triggers.length, 2)
    assert.equal(text(triggers[0]), longName, 'clipping preserves the complete assistant name in the DOM')
    assert.ok(text(triggers[1]).endsWith(' · ' + en['history.by.settings']))
    for (const trigger of triggers) {
      assert.equal(trigger.props.title, text(trigger), 'full selected label remains available as a native title')
      assert.equal(trigger.props.children[0].props.className, 'cpfe-selector-label')
      assert.equal(trigger.props.children[1].type, named.atoms.IconChevronDownOutlineRegular, 'chevron follows the complete text')
      assert.equal(trigger.props.children[1].props['aria-hidden'], true, 'decorative chevron does not change the accessible name')
    }
  },
}

let passed = 0, failed = 0
for (const [name, run] of Object.entries(cases)) {
  if (option('case') && option('case') !== name) continue
  try { await run(); passed++; console.log('PASS  ' + name) }
  catch (error) { failed++; console.error('FAIL  ' + name + '\n' + error.stack) }
}
if (passed + failed === 0) { failed++; console.error('FAIL  no selected case exists') }
console.log(`结果: ${passed} 通过, ${failed} 失败（组件处理函数/模拟 hooks 与 I/O；未验证浏览器渲染）`)
process.exit(failed ? 1 : 0)
