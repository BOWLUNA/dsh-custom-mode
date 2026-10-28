/** Original component handlers, real RemoteResult shapes, controlled permissions and deferred I/O.
 * No registry, browser, installation or HMR is run. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { harness, deferred, fixture, roster, text } from './client-async.test.mjs'
import { en } from '../locales.mjs'

const permissions = Object.fromEntries(['listBundles', 'listVersions', 'updateBundle'].map((name) => ['pluginManager/' + name, true]))
const bundle = (patch = {}) => ({ name: 'dsh-custom-mode', installed: true, availability: 'profile', official: false, version: '2.2.6', source: '2.2.6', updatable: true, ...patch })
const version = (value, patch = {}) => ({ version: value, bundle: true, prerelease: false, tags: [], ...patch })
const listed = (versions = [], patch = {}) => ({ ok: true, value: { status: 'listed', installed: '2.2.6', registry: null, attempts: [], versions, omitted: 0, ...patch } })
async function setup(options = {}) {
  const inventory = [], versions = [], navigation = []
  let installing = 0
  const manager = {
    listBundles(...args) { assert.equal(args.length, 0); const result = deferred(); inventory.push(result); return result.promise },
    listVersions(...args) { assert.equal(args[0], 'dsh-custom-mode'); assert.equal(JSON.stringify(args[1]), '{}'); const result = deferred(); versions.push(result); return result.promise },
    updateBundle() { installing++; throw new Error('the custom page must never install') },
  }
  if (options.legacy) { delete manager.listVersions; delete manager.updateBundle }
  const app = await harness({
    manager: options.noManager ? undefined : manager,
    navigation: options.noNavigation ? undefined : { openBundle(name) { navigation.push(name); if (options.navigationError?.()) throw new Error('synthetic navigation error') } },
    permissions: { ...permissions, ...options.permissions }, noAccess: options.noAccess, deferState: options.deferState,
    nativeRisk: options.nativeRisk, confirm: options.confirm, sourceOnlyAccess: options.sourceOnlyAccess,
  }).ready(options.ids || ['a', 'b'])
  const region = () => app.find((node) => node.props?.className === 'cpfe-update')
  const check = () => app.button(en['update.check']).props.onClick()
  const answerInventory = async (value = [bundle()]) => { inventory.shift().resolve({ ok: true, value }); await app.flush() }
  const finish = async (reply = listed([version('2.2.7')]), packageInfo = bundle()) => {
    const pending = check(); await answerInventory([packageInfo]); versions.shift().resolve(reply); await pending; await app.flush()
  }
  return { app, manager, inventory, versions, navigation, region, check, answerInventory, finish, installing: () => installing }
}
async function orphanSetup(options = {}) {
  const s = await setup(options)
  const changeA = s.app.prompt().props.onChange
  changeA({ target: { value: 'A UNSAVED\n合成草稿' } }); s.app.render()
  s.app.selector().props.onSelect('b'); await s.app.flush()
  s.app.request('/state?id=b').result.resolve(fixture('b')); await s.app.flush()
  s.app.prompt().props.onChange({ target: { value: 'B SAVED' } }); s.app.render()
  const save = s.app.button(en['btn.save']).props.onClick()
  s.app.request('/state', 'POST').result.resolve({ ok: true, code: 'saved', synchronized: true }); await s.app.flush()
  s.app.request('/state?id=b').result.resolve(fixture('b', 'B SAVED', 2)); await s.app.flush()
  s.app.request('').result.resolve(roster(['b'])); await save; await s.app.flush()
  return { ...s, changeA }
}
const viewOrphan = (s) => {
  s.app.button(en['update.orphanView']).props.onClick(); s.app.render()
  return s.app.find((node) => node.type === 'textarea' && node.props.className === 'cpfe-editor cpfe-orphan-editor')
}
const orphanDialog = (s) => s.app.find((node) => node.type === s.app.atoms.RiskConfirmation && node.props.open === true)
const tests = {
  async manualEmptyRoster() {
    const s = await setup({ ids: [] })
    assert.equal(s.inventory.length, 0, 'mount never polls the registry or manager')
    assert.match(text(s.region()), /Running plugin version: 2\.2\.6/)
    assert.equal(s.app.render().props.children[0].props.className, 'cpfe-update', 'updates belong before the assistant list')
    assert.equal(s.app.all((node) => node.props?.className === 'cpfe-version').length, 1)
    const guide = s.app.find((node) => node.type === 'a' && text(node) === en['update.guide'])
    assert.equal(guide.props.href, 'https://github.com/BOWLUNA/dsh-custom-mode/blob/main/README.md#plugin-updates')
    assert.equal(guide.props.target, '_blank')
    assert.equal(guide.props.rel, 'noopener noreferrer')
    assert.equal(guide.props.tabIndex, undefined, 'the semantic anchor retains native keyboard focus')
    assert.equal(guide.props['aria-disabled'], false)
    let prevented = false
    guide.props.onClick({ preventDefault() { prevented = true } })
    assert.equal(prevented, false, 'a clean guide link keeps normal new-tab navigation')
  },
  async officialCandidateAndNavigation() {
    const s = await setup()
    const beforePrompt = s.app.prompt().props.value
    await s.finish(listed([
      version('3.0.0', { incompatible: {} }), version('2.9.0', { deprecated: '' }),
      version('2.8.0-alpha.1', { prerelease: true }), version('2.7.0', { bundle: false }), version('2.6.0'), version('2.5.0'),
    ]))
    assert.ok(text(s.region()).includes('Update available: 2.6.0.'))
    s.app.button(en['update.inPlugins']).props.onClick()
    assert.deepEqual(s.navigation, ['dsh-custom-mode'])
    assert.equal(s.installing(), 0)
    assert.equal(s.app.prompt().props.value, beforePrompt)
    assert.equal(s.app.requests.length, 0, 'checking never reloads assistant state')
  },
  async completeAndPartialResults() {
    for (const [reply, expected] of [
      [listed([]), en['update.current']],
      [listed([version('3.0.0', { incompatible: {} })]), en['update.filtered']],
      [listed([version('3.0.0-alpha.1', { prerelease: true })]), en['update.filtered']],
      [listed([], { omitted: 2 }), en['update.partial']],
    ]) {
      const s = await setup(); await s.finish(reply)
      assert.ok(text(s.region()).includes(expected))
      assert.equal(s.app.all((node) => node.type === s.app.atoms.Button && text(node) === en['update.inPlugins']).length, 0)
    }
    const s = await setup(); await s.finish(listed([version('2.2.7')], { omitted: 4 }))
    assert.ok(text(s.region()).includes('4 additional newer releases were omitted.'))
    assert.ok(!text(s.region()).includes(en['update.current']))
  },
  async originalSourceIsPreserved() {
    for (const source of ['link:../source', 'file:plugin.tgz', 'https://example.invalid/plugin.tgz']) {
      const s = await setup(); const pending = s.check()
      await s.answerInventory([bundle({ source, updatable: false })]); await pending; await s.app.flush()
      assert.ok(text(s.region()).includes(en['update.managed']))
      assert.equal(s.versions.length, 0, 'local/tarball sources never become registry updates')
      assert.equal(s.installing(), 0)
    }
  },
  async fixedPackageAndEligibility() {
    const s = await setup(); const pending = s.check()
    await s.answerInventory([bundle({ name: 'different-package' })]); await pending; await s.app.flush()
    assert.ok(text(s.region()).includes(en['update.notFound']))
    assert.equal(s.versions.length, 0)
    const readonly = await setup(); const denied = readonly.check()
    await readonly.answerInventory([bundle({ readOnlyReason: 'manager' })]); await denied; await readonly.app.flush()
    assert.ok(text(readonly.region()).includes(en['update.managed']))
  },
  async permissionAndOldHost() {
    for (const option of [{ noManager: true }, { legacy: true }, { noAccess: true }, { permissions: { 'pluginManager/listBundles': false } }, { permissions: { 'pluginManager/listVersions': false } }]) {
      const s = await setup(option)
      assert.equal(s.app.button(en['update.check']).props.disabled, true)
      await s.check()
      assert.equal(s.inventory.length, 0)
      assert.equal(s.app.prompt().props.value, 'OLD a', 'optional capabilities cannot remove the editor')
    }
    const old = await setup({ legacy: true, noAccess: true })
    assert.ok(text(old.region()).includes(en['update.unavailable']))
    old.app.button(en['update.details']).props.onClick()
    assert.deepEqual(old.navigation, ['dsh-custom-mode'])
    const sourceOnly = await setup({ legacy: true, sourceOnlyAccess: true })
    sourceOnly.app.button(en['update.details']).props.onClick()
    assert.deepEqual(sourceOnly.navigation, ['dsh-custom-mode'], 'the rc2/rc4 resource source API is not an alpha global whenAccess API')
    const deniedOld = await setup({ legacy: true, permissions: { 'pluginManager/listBundles': false } })
    deniedOld.app.button(en['update.details']).props.onClick()
    assert.equal(deniedOld.navigation.length, 0, 'an old host with access support must still respect an explicit denial')
    const readOnly = await setup({ permissions: { 'pluginManager/updateBundle': false } })
    await readOnly.finish()
    assert.equal(readOnly.app.button(en['update.inPlugins']).props.disabled, true)
    readOnly.app.button(en['update.inPlugins']).props.onClick()
    assert.equal(readOnly.navigation.length, 0, 'list access never implies update permission')
    assert.ok(text(readOnly.region()).includes(en['update.updatePermission']))
  },
  async failuresNeverMeanCurrent() {
    for (const reply of [
      { ok: false, error: { code: 'remote-access/denied' } },
      { ok: true, value: { status: 'refused', problem: 'network', reason: 'synthetic', attempts: [] } },
      { ok: true, value: { status: 'refused', problem: 'not-found', reason: 'synthetic', attempts: [] } },
      { ok: true, value: { status: 'listed', versions: [] } },
      listed([], { installed: '2.2.8' }),
    ]) {
      const s = await setup(); await s.finish(reply)
      assert.ok(!text(s.region()).includes(en['update.current']))
      assert.equal(s.app.button(en['update.check']).props.disabled, false)
      assert.equal(s.app.prompt().props.value, 'OLD a')
    }
    const s = await setup(); const pending = s.check()
    s.inventory.shift().resolve({ ok: false, error: { code: 'remote-access/denied' } }); await pending; await s.app.flush()
    assert.equal(s.versions.length, 0, 'a failed inventory cannot trigger a registry lookup')
    assert.ok(text(s.region()).includes(en['update.failed']))
    assert.equal(s.app.button(en['update.check']).props.disabled, false)
    const rejected = s.check(); s.inventory.shift().reject(new Error('synthetic assembly fault')); await rejected; await s.app.flush()
    await s.finish(listed([]))
    assert.ok(text(s.region()).includes(en['update.current']), 'an exception does not leave a permanent lock')
  },
  async noOverlappingChecks() {
    const s = await setup(), oldButton = s.app.button(en['update.check'])
    const first = oldButton.props.onClick(), second = oldButton.props.onClick()
    assert.equal(s.inventory.length, 1, 'the synchronous ref gates clicks before disabled renders')
    await s.answerInventory(); s.versions.shift().resolve(listed([])); await Promise.all([first, second]); await s.app.flush()
    assert.equal(s.app.button(en['update.check']).props.disabled, false)
  },
  async permissionRevocationAndLateResponses() {
    const s = await setup(); const old = s.check(); await s.answerInventory()
    const stale = s.versions.shift()
    s.app.permission('pluginManager/listVersions', false); await s.app.flush()
    s.app.permission('pluginManager/listVersions', true); await s.app.flush()
    const fresh = s.check(); await s.answerInventory()
    stale.resolve(listed([version('9.9.9')])); await old; await s.app.flush()
    assert.ok(!text(s.region()).includes('9.9.9'))
    assert.equal(s.app.button(en['update.checking']).props.disabled, true, 'old finally cannot unlock a newer check')
    s.versions.shift().resolve(listed([])); await fresh; await s.app.flush()
    assert.ok(text(s.region()).includes(en['update.current']))
    const next = s.check(); await s.answerInventory()
    s.app.cleanup(); const writes = s.app.writes
    s.versions.shift().resolve(listed([version('9.9.9')])); await next
    assert.equal(s.app.writes, writes, 'unmounted checks never update state or release a newer lock')
  },
  async diskAndRunningVersionsStayDistinct() {
    const s = await setup()
    await s.finish(listed([version('2.2.9')], { installed: '2.2.8' }), bundle({ version: '2.2.8' }))
    assert.ok(text(s.region()).includes('Running plugin version: 2.2.6'))
    assert.ok(text(s.region()).includes('Installed on disk: 2.2.8'))
  },
  async synchronousInputGuard() {
    for (const input of ['prompt', 'newName']) {
      const s = await setup({ deferState: true }), oldNavigation = s.app.button(en['update.details'])
      if (input === 'prompt') s.app.prompt().props.onChange({ target: { value: 'LAST KEYSTROKE' } })
      else s.app.find((node) => node.type === s.app.atoms.Input && node.props.placeholder === en['assistant.newPlaceholder']).props.onChange({ target: { value: 'UNSUBMITTED NAME' } })
      oldNavigation.props.onClick()
      assert.equal(s.navigation.length, 0, 'navigation sees input before React commits state: ' + input)
      let prevented = false
      s.app.find((node) => node.type === 'a' && text(node) === en['update.guide']).props.onClick({ preventDefault() { prevented = true } })
      assert.equal(prevented, true, 'documentation navigation uses the same draft guard')
      s.app.render()
      assert.ok(text(s.region()).includes(en['update.saveDrafts']))
    }
  },
  async backgroundAndUnlistedDrafts() {
    const s = await setup()
    s.app.prompt().props.onChange({ target: { value: 'A UNSAVED' } }); s.app.render()
    const switched = s.app.selector().props.onSelect('b'); await s.app.flush()
    s.app.request('/state?id=b').result.resolve(fixture('b')); await switched; await s.app.flush()
    s.app.button(en['update.details']).props.onClick()
    assert.equal(s.navigation.length, 0, 'a clean current assistant cannot hide another dirty draft')
    s.app.prompt().props.onChange({ target: { value: 'B SAVED' } }); s.app.render()
    const save = s.app.button(en['btn.save']).props.onClick()
    s.app.request('/state', 'POST').result.resolve({ ok: true, code: 'saved', synchronized: true }); await s.app.flush()
    s.app.request('/state?id=b').result.resolve(fixture('b', 'B SAVED', 2)); await s.app.flush()
    s.app.request('').result.resolve(roster(['b'])); await save; await s.app.flush()
    s.app.button(en['update.details']).props.onClick()
    assert.equal(s.navigation.length, 0, 'all held entries are checked even if their id left the current roster')
    assert.equal(s.app.prompt().props.value, 'B SAVED')
  },
  async checkingKeepsDrafts() {
    const s = await setup()
    s.app.prompt().props.onChange({ target: { value: 'A UNSAVED' } }); s.app.render()
    const check = s.check(); await s.answerInventory()
    s.app.prompt().props.onChange({ target: { value: 'A NEWER INPUT' } }); s.app.render()
    s.versions.shift().resolve(listed([version('2.2.7')])); await check; await s.app.flush()
    assert.equal(s.app.prompt().props.value, 'A NEWER INPUT')
    s.app.button(en['update.inPlugins']).props.onClick()
    assert.equal(s.navigation.length, 0)
    assert.equal(s.app.requests.length, 0)
  },
  async operationAndRecoveryGuard() {
    const s = await setup(), nav = s.app.button(en['update.details'])
    const reading = s.app.button(en['btn.reload']).props.onClick()
    nav.props.onClick(); assert.equal(s.navigation.length, 0)
    s.app.request('').result.reject(new Error('synthetic offline')); await reading; await s.app.flush()
    s.app.button(en['update.details']).props.onClick(); assert.equal(s.navigation.length, 1, 'failed read unlocks navigation')
    for (const syncFailure of [true, false]) {
      const c = await setup({ ids: [] })
      c.app.find((node) => node.type === c.app.atoms.Input && node.props.placeholder === en['assistant.newPlaceholder']).props.onChange({ target: { value: 'B' } }); c.app.render()
      const create = c.app.button(en['btn.create']).props.onClick()
      c.app.request('/create', 'POST').result.resolve(syncFailure
        ? { ok: false, code: 'savedButSyncFailed', persisted: true, synchronized: false, id: 'b' }
        : { ok: true, code: 'created', synchronized: true, id: 'b' }); await c.app.flush()
      if (syncFailure) {
        c.app.request('').result.resolve(roster(['b'])); await c.app.flush()
        c.app.request('/state?id=b').result.resolve(fixture('b'))
      } else c.app.request('').result.reject(new Error('synthetic refresh failure'))
      await create; await c.app.flush()
      c.app.button(en['update.details']).props.onClick()
      assert.equal(c.navigation.length, 0, 'clean persisted state still blocks unresolved sync/refresh')
      assert.ok(text(c.region()).includes(en['update.finishRecovery']))
    }
  },
  async navigationFailurePreservesResult() {
    let fail = true
    const s = await setup({ navigationError: () => fail }); await s.finish()
    s.app.button(en['update.inPlugins']).props.onClick(); s.app.render()
    assert.ok(text(s.region()).includes(en['update.navigationFailed']))
    assert.ok(text(s.region()).includes('Update available: 2.2.7.'))
    assert.equal(s.app.prompt().props.value, 'OLD a')
    fail = false; s.app.button(en['update.inPlugins']).props.onClick()
    assert.deepEqual(s.navigation, ['dsh-custom-mode', 'dsh-custom-mode'])
    assert.equal(s.installing(), 0)
  },
  async orphanFallbackRecoveryAndCancel() {
    let allow = false
    const confirmations = []
    const s = await orphanSetup({ confirm: (message) => { confirmations.push(message); return allow } })
    assert.ok(text(s.region()).includes('A (ID: a)'))
    assert.equal(s.app.button(en['update.details']).props.disabled, true)
    const copy = viewOrphan(s)
    assert.equal(copy.props.readOnly, true)
    assert.deepEqual(JSON.parse(copy.props.value), { id: 'a', name: 'A', description: '', mode: 'standard', overrides: {}, prompt: 'A UNSAVED\n合成草稿' })
    s.app.button(en['update.orphanDiscard']).props.onClick(); s.app.render()
    assert.ok(confirmations[0].includes('"A" (ID: a)'))
    assert.ok(confirmations[0].includes('cannot recover'))
    assert.equal(s.app.button(en['update.details']).props.disabled, true, 'cancel keeps the complete draft')
    assert.equal(s.app.find((node) => node.props?.className === 'cpfe-editor cpfe-orphan-editor').props.value, copy.props.value)
    allow = true; s.app.button(en['update.orphanDiscard']).props.onClick(); s.app.render()
    assert.ok(text(s.region()).includes(en['update.orphanDiscarded']))
    assert.equal(s.app.all((node) => node.props?.className === 'cpfe-editor cpfe-orphan-editor').length, 0)
    assert.equal(s.app.button(en['update.details']).props.disabled, false)
    s.app.button(en['update.details']).props.onClick()
    assert.deepEqual(s.navigation, ['dsh-custom-mode'], 'the explicit discard completes the previously impossible recovery path')
    assert.equal(s.app.requests.length, 0, 'discard affects browser memory only')
  },
  async orphanNativeConfirmation() {
    const s = await orphanSetup({ nativeRisk: true })
    viewOrphan(s); s.app.button(en['update.orphanDiscard']).props.onClick(); s.app.render()
    const first = orphanDialog(s)
    first.props.onConfirm(); s.app.render()
    assert.equal(s.app.button(en['update.details']).props.disabled, true, 'unacknowledged confirmation cannot delete')
    first.props.onCancel(); s.app.render()
    assert.equal(s.app.all((node) => node.type === s.app.atoms.RiskConfirmation && node.props.open === true).length, 0)
    s.app.button(en['update.orphanDiscard']).props.onClick(); s.app.render()
    const second = orphanDialog(s)
    first.props.onAcknowledgedChange(true)
    second.props.onConfirm(); s.app.render()
    assert.equal(s.app.button(en['update.details']).props.disabled, true, 'a stale cancelled dialog cannot acknowledge a newer one')
    second.props.onAcknowledgedChange(true); second.props.onConfirm(); s.app.render()
    assert.equal(s.app.button(en['update.details']).props.disabled, false)
    assert.equal(s.app.prompt().props.value, 'B SAVED')
    const gone = await orphanSetup({ nativeRisk: true })
    viewOrphan(gone); gone.app.button(en['update.orphanDiscard']).props.onClick(); gone.app.render()
    const stale = orphanDialog(gone); gone.app.cleanup(); const writes = gone.app.writes
    stale.props.onAcknowledgedChange(true); stale.props.onCancel(); stale.props.onConfirm()
    assert.equal(gone.app.writes, writes, 'unmounted confirmation callbacks do not mutate component state')
  },
  async orphanConfirmationRejectsNewInput() {
    const s = await orphanSetup({ nativeRisk: true, deferState: true })
    viewOrphan(s)
    const oldDiscard = s.app.button(en['update.orphanDiscard'])
    s.changeA({ target: { value: 'A CHANGED BEFORE DIALOG' } })
    oldDiscard.props.onClick(); s.app.render()
    assert.equal(s.app.all((node) => node.type === s.app.atoms.RiskConfirmation && node.props.open === true).length, 0, 'stale viewed content cannot authorize a different draft')
    s.app.button(en['update.orphanDiscard']).props.onClick(); s.app.render()
    const dialog = orphanDialog(s); dialog.props.onAcknowledgedChange(true)
    s.changeA({ target: { value: 'A CHANGED DURING DIALOG' } })
    dialog.props.onConfirm(); s.app.render()
    assert.ok(text(s.region()).includes(en['update.orphanChanged']))
    const kept = JSON.parse(s.app.find((node) => node.props?.className === 'cpfe-editor cpfe-orphan-editor').props.value)
    assert.equal(kept.prompt, 'A CHANGED DURING DIALOG')
    assert.equal(s.app.button(en['update.details']).props.disabled, true)
    s.app.button(en['update.orphanDiscard']).props.onClick(); s.app.render()
    const reviewed = orphanDialog(s); reviewed.props.onAcknowledgedChange(true); reviewed.props.onConfirm(); s.app.render()
    assert.equal(s.app.button(en['update.details']).props.disabled, false, 'a fresh explicit review can still recover')
  },
  async orphanConfirmationRejectsRosterChangeAndPending() {
    const s = await orphanSetup({ nativeRisk: true })
    viewOrphan(s); s.app.button(en['update.orphanDiscard']).props.onClick(); s.app.render()
    const old = orphanDialog(s); old.props.onAcknowledgedChange(true)
    const check = s.check()
    old.props.onConfirm(); s.app.render()
    assert.ok(text(s.region()).includes(en['update.finishOperation']))
    await s.answerInventory(); s.versions.shift().resolve(listed([])); await check; await s.app.flush()
    s.app.button(en['update.orphanDiscard']).props.onClick(); s.app.render()
    const next = orphanDialog(s); next.props.onAcknowledgedChange(true)
    const read = s.app.button(en['btn.reload']).props.onClick()
    s.app.request('').result.resolve(roster(['a', 'b'])); await s.app.flush()
    s.app.request('/state?id=b').result.resolve(fixture('b', 'B SAVED', 2)); await read; await s.app.flush()
    next.props.onConfirm(); s.app.render()
    assert.ok(text(s.region()).includes(en['update.orphanChanged']))
    s.app.selector().props.onSelect('a'); await s.app.flush()
    assert.equal(s.app.prompt().props.value, 'A UNSAVED\n合成草稿', 'a reappearing assistant retains its draft after stale confirmation')
    assert.equal(s.navigation.length, 0)
  },
  async orphanSurvivesEmptyRoster() {
    const s = await orphanSetup()
    s.app.button(en['btn.delete']).props.onClick()
    s.app.request('/delete', 'POST').result.resolve({ ok: true, code: 'deleted', synchronized: true }); await s.app.flush()
    s.app.request('').result.resolve(roster([])); await s.app.flush()
    assert.equal(s.app.all((node) => node.type === 'textarea' && node.props.className === 'cpfe-editor').length, 0)
    assert.equal(JSON.parse(viewOrphan(s).props.value).prompt, 'A UNSAVED\n合成草稿', 'an empty remote roster must not silently clear another draft')
    assert.equal(s.app.button(en['update.details']).props.disabled, true)
  },
  async stylesheetSurvivesActualApplyAndLateCleanup() {
    const tags = [], writes = []
    const remove = (tag) => { const at = tags.indexOf(tag); if (at >= 0) tags.splice(at, 1) }
    const document = {
      querySelector(selector) { return tags.find((tag) => selector === 'style[data-plugin-css="' + tag.dataset.pluginCss + '"]') || null },
      createElement(kind) {
        assert.equal(kind, 'style')
        let value = ''
        return { dataset: {}, get textContent() { return value }, set textContent(next) { value = next; writes.push(next) }, remove() { remove(this) } }
      },
      head: { appendChild(tag) { tags.push(tag) }, removeChild: remove },
    }
    const currentSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
    const oldSource = currentSource.replace('.cpfe-update{', '.cpfe-old-layout-fixture{')
    assert.notEqual(oldSource, currentSource)
    const previous = harness({ document, bundleSource: oldSource })
    assert.equal(tags.length, 1)
    assert.ok(tags[0].textContent.includes('.cpfe-old-layout-fixture{'))
    const sameTag = tags[0]
    const current = harness({ document })
    assert.equal(tags.length, 1, 'the new module applies into the old document without a duplicate tag')
    assert.equal(tags[0], sameTag)
    assert.ok(tags[0].textContent.includes('.cpfe-update{'))
    assert.ok(!tags[0].textContent.includes('.cpfe-old-layout-fixture{'), 'stale layout is replaced without a document reload')
    const currentCSS = tags[0].textContent, writeCount = writes.length
    current.applyAgain()
    assert.equal(tags.length, 1)
    assert.equal(writes.length, writeCount, 'repeated apply of identical CSS does not rewrite it')
    previous.disposeModule()
    assert.equal(tags.length, 1, 'late old-scope cleanup cannot delete the new stylesheet')
    assert.equal(tags[0].textContent, currentCSS)
  },
}
let passed = 0, failed = 0
const selectedCase = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7)
for (const [name, run] of Object.entries(tests)) {
  if (selectedCase && name !== selectedCase) continue
  try { await run(); passed++; console.log('PASS  ' + name) }
  catch (error) { failed++; console.error('FAIL  ' + name + '\n' + error.stack) }
}
if (passed + failed === 0) { failed++; console.error('FAIL  no selected update case exists') }
console.log(`结果: ${passed} 通过, ${failed} 失败（更新查询/权限/导航组件；未运行真实包仓库、安装、浏览器或 HMR）`)
process.exit(failed ? 1 : 0)
