/**
 * Execute the original settings component's handlers against deferred HTTP/file
 * reads. Hook storage and native atoms are stand-ins: these assertions cover
 * request ownership and state transitions, not React rendering, CSS or clicks.
 * Run: node test/client-async.test.mjs [--case=reload] [--bundle=/path/client.js]
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { en } from '../locales.mjs'

const option = (name) => process.argv.find((arg) => arg.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const source = readFileSync(option('bundle') || fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
export const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export const fixture = (id = 'a', prompt = 'OLD ' + id, n = 1) => ({
  ok: true, id, name: id.toUpperCase(), description: '', prompt, mode: 'standard', overrides: {},
  modes: [{ id: 'standard' }, { id: 'minimal' }], rows: [], warnings: [],
  history: [{ n, at: '2026-10-27T00:00:00.000Z', bytes: 5, by: 'settings' }],
  revision: 'revision-' + id + '-' + n,
})
export const roster = (ids = ['a', 'b']) => ({
  ok: true, version: '2.2.6', assistants: ids.map((id) => ({ id, name: id.toUpperCase() })),
  postures: [{ id: 'develop' }, { id: 'write' }, { id: 'chat' }],
})
export const text = (node) => node == null ? '' : typeof node !== 'object' ? String(node)
  : (node.props?.text || '') + (node.props?.children || []).map(text).join('')

export function harness(options = {}) {
  const hooks = [], pendingEffects = [], requests = [], files = [], queuedStates = [], moduleDisposers = []
  const events = new Map()
  let cursor = 0, writes = 0, component, tree
  const atoms = Object.fromEntries(['Button', 'Input', 'Switch', 'Tag', 'Pill', 'Menu', 'IconChevronDownOutlineRegular'].map((name) => [name, function Atom() {}]))
  if (options.nativeRisk) atoms.RiskConfirmation = function RiskConfirmation() {}
  const react = {
    createElement(type, props, ...children) { return { type, key: props?.key, props: { ...props, children: children.flat(Infinity) } } },
    useState(initial) {
      const at = cursor++
      hooks[at] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[at].value, (next) => {
        writes++
        const apply = () => { hooks[at].value = typeof next === 'function' ? next(hooks[at].value) : next }
        if (options.deferState) queuedStates.push(apply)
        else apply()
      }]
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
    window: { confirm: (message) => options.confirm ? options.confirm(message) : true,
      addEventListener(name, callback) { const listeners = events.get(name) || new Set(); listeners.add(callback); events.set(name, listeners) },
      removeEventListener(name, callback) { events.get(name)?.delete(callback) },
      __ModuleLoader__: { load: (entry) => { registration = entry } } },
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
  if (options.document) sandbox.document = options.document
  runInNewContext(options.bundleSource || source, sandbox)
  const bundle = registration.factory((name) => name === 'react' ? react : atoms)
  const locale = { bind: () => (key) => en[key] || key, getLocale: () => ({ active: 'en' }), register: () => () => {} }
  const slots = {
    inject: (_name, callback) => callback(), register: (_options, fn) => { component = fn },
  }
  const permissionObservers = new Map()
  const permissions = { ...options.permissions }
  const access = {
    whenAccess(action, callback) {
      const observers = permissionObservers.get(action) || new Set()
      permissionObservers.set(action, observers)
      const observer = { callback, cleanup: permissions[action] ? callback() : null }
      observers.add(observer)
      return () => { observer.cleanup?.(); observers.delete(observer) }
    },
  }
  const services = { slots, locale, remote: {}, 'remote.pluginManager': options.manager,
    remoteAccess: options.noAccess ? undefined : options.sourceOnlyAccess ? { source() { throw new Error('old resource source is not a global access API') } } : access,
    pluginNavigation: options.navigation }
  const scopedContext = (dependencies) => ({
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') moduleDisposers.push(cleanup); return cleanup },
    get(name) { assert.ok(dependencies.includes(name), 'service reads must belong to an injected scope: ' + name); return services[name] },
    get remote() { assert.ok(dependencies.includes('remote') && dependencies.includes('remote.pluginManager')); return { pluginManager: services['remote.pluginManager'] } },
    get remoteAccess() { assert.ok(dependencies.includes('remoteAccess')); return services.remoteAccess },
    inject(names, callback) {
      if (names.every((name) => services[name] !== undefined)) callback(scopedContext([...dependencies, ...names]))
    },
  })
  const rootContext = scopedContext(['slots', 'locale'])
  bundle.apply(rootContext)
  const api = {
    requests, files, atoms,
    render() { for (const apply of queuedStates.splice(0)) apply(); cursor = 0; tree = component({ t: (key) => en[key] || key }); return tree },
    permission(action, allowed) {
      permissions[action] = allowed
      for (const observer of permissionObservers.get(action) || []) {
        observer.cleanup?.()
        observer.cleanup = allowed ? observer.callback() : null
      }
    },
    effects() { for (const at of new Set(pendingEffects.splice(0))) { hooks[at].cleanup?.(); hooks[at].cleanup = hooks[at].effect() } },
    cleanup() { for (const hook of hooks) hook.cleanup?.() },
    remount() { api.cleanup(); hooks.length = 0; pendingEffects.length = 0; queuedStates.length = 0; return api },
    newContext() { api.remount(); bundle.apply(scopedContext(['slots', 'locale'])); return api },
    beforeUnload() {
      const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true } }
      for (const callback of events.get('beforeunload') || []) callback(event)
      return event
    },
    listenerCount(name) { return events.get(name)?.size || 0 },
    applyAgain() { bundle.apply(rootContext) },
    disposeModule() { for (const dispose of moduleDisposers.splice(0).reverse()) dispose() },
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
    app.request('/state', 'POST').result.resolve({ ok: false, code: 'savedButSyncFailed', persisted: true, synchronized: false, revision: 'revision-a-2', params: { ids: 'a' } })
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
    assert.equal(JSON.parse(post.options.body).baseRevision, 'revision-a-2', 'next save uses its own committed generation after activation retry')
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
  async draftLifecycleAndInstanceIsolation() {
    const app = await harness().ready()
    assert.equal(app.listenerCount('beforeunload'), 1)
    assert.equal(app.beforeUnload().prevented, false)
    app.prompt().props.onChange({ target: { value: 'PRIVATE UNSAVED DRAFT' } }); app.render()
    app.find((node) => node.props?.className === 'cpfe-newinput').props.onChange({ target: { value: 'PENDING NAME' } }); app.render()
    assert.equal(app.beforeUnload().prevented, true)
    await app.remount().ready()
    assert.equal(app.prompt().props.value, 'PRIVATE UNSAVED DRAFT', 'same document and plugin context restores the draft')
    assert.equal(app.find((node) => node.props?.className === 'cpfe-newinput').props.value, 'PENDING NAME')
    app.cleanup()
    assert.equal(app.beforeUnload().prevented, true, 'a cached draft is protected while the section is unmounted')
    await app.remount().ready()
    const discard = app.button(en['btn.reloadDiscard']).props.onClick()
    app.request('').result.resolve(roster()); await app.flush()
    app.request('/state?id=a').result.resolve(fixture()); await discard; await app.flush()
    app.find((node) => node.props?.className === 'cpfe-newinput').props.onChange({ target: { value: '' } }); app.render()
    assert.equal(app.beforeUnload().prevented, false, 'explicit discard and clearing new input remove the warning')
    app.prompt().props.onChange({ target: { value: 'FIRST CONTEXT ONLY' } }); app.render()
    await app.newContext().ready()
    assert.equal(app.prompt().props.value, 'OLD a', 'another ctx using the same module never inherits the first ctx draft')
    app.disposeModule()
    assert.equal(app.listenerCount('beforeunload'), 0, 'plugin disposal clears every owned listener')
    app.cleanup()
    app.applyAgain(); await app.remount().ready()
    assert.equal(app.prompt().props.value, 'OLD a', 'disposed private memory does not reappear on reactivation')
    app.disposeModule(); app.cleanup()
  },
  async replacementGuards() {
    let allow = false, confirmations = 0
    const app = harness({ confirm: () => { confirmations++; return allow } })
    app.render(); app.effects(); app.request('').result.resolve(roster()); await app.flush()
    app.request('/state?id=a').result.resolve({ ...fixture(), factoryPrompt: 'FACTORY' }); await app.flush()
    app.prompt().props.onChange({ target: { value: 'KEEP UNSAVED' } }); app.render()
    app.button(en['btn.reset']).props.onClick(); app.render()
    assert.equal(app.prompt().props.value, 'KEEP UNSAVED')
    app.find((node) => node.type === app.atoms.Menu && node.props.items?.[0]?.id === '1').props.onSelect('1'); app.render()
    await app.button(en['history.load']).props.onClick()
    assert.equal(app.requests.length, 0, 'cancelled history replacement never starts a request')
    const input = app.find((node) => node.type === 'input' && node.props.type === 'file')
    await input.props.onChange({ target: { files: [{ size: 2 }], value: 'fixture' } })
    assert.equal(app.files.length, 0, 'cancelled import does not read a file or change the draft')
    assert.equal(confirmations, 3)
    allow = true; app.button(en['btn.reset']).props.onClick(); app.render()
    assert.equal(app.prompt().props.value, 'FACTORY')
    const load = app.button(en['history.load']).props.onClick()
    app.request('/history?id=a&n=1').result.resolve({ ok: true, text: 'HISTORY' }); await load; await app.flush()
    assert.equal(app.prompt().props.value, 'HISTORY')
    const imported = input.props.onChange({ target: { files: [{ size: 2 }], value: 'fixture' } })
    app.files[0].result = 'IMPORT'; app.files[0].onload(); await imported; await app.flush()
    assert.equal(app.prompt().props.value, 'IMPORT')
    assert.equal(app.requests.length, 0, 'replacement remains a draft until Save')
    app.cleanup(); app.disposeModule()
  },
  async imeAndDiscoverableCreate() {
    const app = await harness().ready()
    let scrolled = 0, focused = 0
    app.find((node) => node.props?.className === 'cpfe-create').props.ref.current = { scrollIntoView() { scrolled++ } }
    app.find((node) => node.props?.className === 'cpfe-newinput').props.ref.current = { focus() { focused++ } }
    app.button(en['btn.newAssistant']).props.onClick()
    assert.equal(scrolled, 1); assert.equal(focused, 1)
    app.find((node) => node.props?.className === 'cpfe-newinput').props.onChange({ target: { value: '合成助手' } }); app.render()
    const input = app.find((node) => node.props?.className === 'cpfe-newinput')
    for (const flags of [{ isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }]) input.props.onKeyDown({ key: 'Enter', ...flags })
    assert.equal(app.requests.length, 0, 'IME Enter never creates, including keyCode 229 fallback')
    input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false } })
    const created = app.request('/create', 'POST')
    assert.equal(JSON.parse(created.options.body).name, '合成助手', 'ordinary Enter still creates')
    created.result.resolve({ ok: true, id: 'c', code: 'created', synchronized: true, params: { name: '合成助手' } }); await app.flush()
    app.request('').result.resolve(roster(['a', 'b', 'c'])); await app.flush()
    app.request('/state?id=c').result.resolve(fixture('c')); await app.flush()
    let editorScroll = 0, editorFocus = 0
    app.find((node) => node.props?.['data-assistant-editor']).props.ref.current = {
      scrollIntoView() { editorScroll++ }, focus() { editorFocus++ },
    }
    app.effects(); app.render()
    assert.equal(editorScroll, 1); assert.equal(editorFocus, 1)
    assert.match(text(app.status()), /choose it in the mode menu for a new session/, 'creation gives the session-selection next step')
    app.cleanup(); app.disposeModule()
  },
  async revisionDoesNotAdvanceUnderDirtyDraft() {
    const app = await harness().ready()
    app.prompt().props.onChange({ target: { value: 'MY CHANGES' } }); app.render()
    app.selector().props.onSelect('a')
    app.request('/state?id=a').result.resolve(fixture('a', 'SOMEONE ELSE', 2)); await app.flush()
    assert.equal(app.prompt().props.value, 'MY CHANGES')
    const save = app.button(en['btn.save']).props.onClick()
    const post = app.request('/state', 'POST')
    assert.equal(JSON.parse(post.options.body).baseRevision, 'revision-a-1', 'a fresh GET cannot authorize overwriting someone else')
    assert.equal(JSON.parse(post.options.body).baseN, undefined, 'new clients use the complete revision')
    post.result.resolve({ ok: false, code: 'conflict' }); await save; await app.flush()
    assert.equal(app.prompt().props.value, 'MY CHANGES')
    assert.equal(app.beforeUnload().prevented, true)
    app.cleanup(); app.disposeModule()
  },
  async savedRevisionSurvivesRefreshFailure() {
    const app = await harness().ready()
    app.prompt().props.onChange({ target: { value: 'SAVED BY ME' } }); app.render()
    const save = app.button(en['btn.save']).props.onClick()
    app.request('/state', 'POST').result.resolve({ ok: true, code: 'saved', synchronized: true, revision: 'revision-a-2' }); await app.flush()
    app.request('/state?id=a').result.reject(new Error('synthetic refresh failure')); await save; await app.flush()
    assert.equal(app.beforeUnload().prevented, false, 'a confirmed write is no longer an unsaved draft')
    app.prompt().props.onChange({ target: { value: 'NEW INPUT AFTER SAVE' } }); app.render()
    assert.equal(app.button(en['btn.save']).props.disabled, true, 'refresh recovery must finish before another save')
    const retry = app.button(en['btn.retryRead']).props.onClick()
    app.request('').result.resolve(roster()); await app.flush()
    app.request('/state?id=a').result.resolve(fixture('a', 'EXTERNAL AFTER MY SAVE', 3)); await retry; await app.flush()
    assert.equal(app.prompt().props.value, 'NEW INPUT AFTER SAVE')
    const next = app.button(en['btn.save']).props.onClick()
    const post = app.request('/state', 'POST')
    assert.equal(JSON.parse(post.options.body).baseRevision, 'revision-a-2', 'new edits use only our precise committed revision, not a later external generation')
    post.result.resolve({ ok: false, code: 'conflict' }); await next; await app.flush()
    app.cleanup(); app.disposeModule()
  },
  async duplicateSavedGuardKeepsDraftAndNewInput() {
    let allow = false, confirmed = ''
    const app = await harness({ confirm: (message) => { confirmed = message; return allow } }).ready()
    app.prompt().props.onChange({ target: { value: 'UNSAVED SOURCE' } }); app.render()
    app.find((node) => node.props?.className === 'cpfe-newinput').props.onChange({ target: { value: 'SEPARATE NEW NAME' } }); app.render()
    app.button(en['btn.duplicate']).props.onClick()
    assert.equal(app.requests.length, 0)
    assert.equal(confirmed, en['assistant.duplicateSavedConfirm'])
    allow = true; const duplicate = app.button(en['btn.duplicate']).props.onClick()
    const post = app.request('/create', 'POST')
    assert.equal(JSON.parse(post.options.body).from, 'a')
    assert.equal(JSON.parse(post.options.body).prompt, undefined, 'copy remains an explicitly confirmed copy of saved data')
    post.result.resolve({ ok: true, id: 'c', code: 'duplicated', synchronized: true }); await app.flush()
    app.request('').result.resolve(roster(['a', 'b', 'c'])); await app.flush()
    app.request('/state?id=c').result.resolve(fixture('c')); await duplicate; await app.flush()
    assert.equal(app.find((node) => node.props?.className === 'cpfe-newinput').props.value, 'SEPARATE NEW NAME', 'copying does not clear unrelated new-assistant input')
    app.selector().props.onSelect('a'); await app.flush()
    assert.equal(app.prompt().props.value, 'UNSAVED SOURCE')
    app.cleanup(); app.disposeModule()
  },
  async reorderAdvancesOnlyItsCheckedGenerations() {
    const app = await harness().ready()
    app.prompt().props.onChange({ target: { value: 'DIRTY A' } }); app.render()
    app.selector().props.onSelect('b')
    app.request('/state?id=b').result.resolve(fixture('b')); await app.flush()
    app.prompt().props.onChange({ target: { value: 'DIRTY B' } }); app.render()
    const moving = app.button(en['btn.moveUp']).props.onClick()
    const post = app.request('/reorder', 'POST')
    assert.deepEqual(JSON.parse(post.options.body).baseRevisions, { a: 'revision-a-1', b: 'revision-b-1' })
    post.result.resolve({ ok: true, code: 'reordered', revisions: { a: 'revision-a-2', b: 'revision-b-2' } }); await app.flush()
    app.request('').result.resolve(roster(['b', 'a'])); await app.flush()
    app.request('/state?id=b').result.resolve(fixture('b', 'EXTERNAL AFTER REORDER', 3)); await moving; await app.flush()
    assert.equal(app.prompt().props.value, 'DIRTY B')
    let saving = app.button(en['btn.save']).props.onClick()
    let save = app.request('/state', 'POST')
    assert.equal(JSON.parse(save.options.body).baseRevision, 'revision-b-2')
    save.result.resolve({ ok: false, code: 'conflict' }); await saving; await app.flush()
    app.find((node) => node.type === app.atoms.Menu && node.props.items?.some((item) => item.id === 'a')).props.onSelect('a'); await app.flush()
    assert.equal(app.prompt().props.value, 'DIRTY A')
    saving = app.button(en['btn.save']).props.onClick(); save = app.request('/state', 'POST')
    assert.equal(JSON.parse(save.options.body).baseRevision, 'revision-a-2', 'reorder updates other checked dirty assistants too')
    save.result.resolve({ ok: false, code: 'conflict' }); await saving; await app.flush()
    const refused = app.button(en['btn.moveDown']).props.onClick()
    app.request('/reorder', 'POST').result.resolve({ ok: false, code: 'conflict' }); await refused; await app.flush()
    assert.equal(app.requests.length, 0, 'a rejected reorder does not reload or advance a draft')
    app.cleanup(); app.disposeModule()
  },
  async repairPreservesDraftAndAdvancesItsGeneration() {
    const app = harness(); app.render(); app.effects()
    app.request('').result.resolve(roster(['a'])); await app.flush()
    app.request('/state?id=a').result.resolve({ ...fixture(), overrides: { ghost: true }, warnings: ['unresolvableRows'] }); await app.flush()
    app.prompt().props.onChange({ target: { value: 'MY UNSAVED PROMPT' } }); app.render()
    const repair = app.button(en['btn.repair']).props.onClick()
    const post = app.request('/repair', 'POST')
    assert.equal(JSON.parse(post.options.body).baseRevision, 'revision-a-1')
    post.result.resolve({ ok: true, code: 'repaired', revision: 'revision-a-2', params: { repairedIds: ['ghost'] } }); await app.flush()
    app.request('').result.resolve(roster(['a'])); await app.flush()
    app.request('/state?id=a').result.resolve({ ...fixture('a', 'OLD a', 2), overrides: { ghost: false } }); await repair; await app.flush()
    assert.equal(app.prompt().props.value, 'MY UNSAVED PROMPT')
    assert.equal(app.all((node) => node.props?.className === 'cpfe-warns').length, 0, 'recovered diagnostics refresh without rebasing the draft')
    const saving = app.button(en['btn.save']).props.onClick()
    const save = app.request('/state', 'POST'), body = JSON.parse(save.options.body)
    assert.equal(body.baseRevision, 'revision-a-2')
    assert.equal(body.overrides.ghost, false)
    assert.equal(body.prompt, 'MY UNSAVED PROMPT')
    save.result.resolve({ ok: false, code: 'conflict' }); await saving; await app.flush()
    app.cleanup(); app.disposeModule()
  },
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  let passed = 0, failed = 0
  for (const [name, run] of Object.entries(cases)) {
    if (option('case') && option('case') !== name) continue
    try { await run(); passed++; console.log('PASS  ' + name) }
    catch (error) { failed++; console.error('FAIL  ' + name + '\n' + error.stack) }
  }
  if (passed + failed === 0) { failed++; console.error('FAIL  no selected case exists') }
  console.log(`结果: ${passed} 通过, ${failed} 失败（组件处理函数/模拟 hooks 与 I/O；未验证浏览器渲染）`)
  process.exit(failed ? 1 : 0)
}
