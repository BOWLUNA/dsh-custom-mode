#!/usr/bin/env node
/** Inspect the real mounted settings page, keeping the existing browser page. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { connect } from './screenshots/cdp.mjs'
const args = process.argv.slice(2)
const option = name => args[args.indexOf('--' + name) + 1]
const version = option('version'), url = option('url'), out = option('out')
assert.ok(['0.2.0-rc.2', '0.2.1-alpha.5', '0.2.1-rc.2'].includes(version))
const session = await connect(), checks = []
const check = (name, value) => { assert.ok(value, name); checks.push(name) }
try {
  const saved = await session.evaluate(`(async () => {
    const before = await (await fetch('/api/custom-mode/state?id=custom')).json();
    const response = await fetch('/api/custom-mode/state', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id:'custom',mode:'all',overrides:{},prompt:'Synthetic plugin lifecycle prompt {{model}}.\\n',name:before.name,description:before.description || ''}) });
    return {status:response.status,body:await response.json()};
  })()`)
  check('real API saves union composition for synthetic default assistant', saved.status === 200 && saved.body.ok)
  check('existing real settings panel remains open', await session.evaluate(`document.querySelector('.cpfe') !== null`))
  const reload = await session.evaluate(`(() => { const button=[...document.querySelectorAll('.cpfe button')].find(b=>/^(重新读取|Reload)$/.test(b.textContent.trim())); if(!button)return null;button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
  check('native reload button is available', reload !== null)
  await session.clickAt(reload.x,reload.y)
  await session.sleep(1800)
  await session.evaluate(`(() => {const b=document.querySelector('[data-cap="toggle"]');if(b&&b.getAttribute('aria-expanded')!=='true')b.click();return true})()`)
  await session.sleep(400)
  const observed = await session.evaluate(`(async () => {
    const state=await(await fetch('/api/custom-mode/state?id=custom')).json();
    const flatten=rows=>rows.flatMap(r=>[r,...flatten(r.children||[])]);
    const market=flatten(state.rows||[]).find(r=>r.id==='tool-plugin-market');
    const row=[...document.querySelectorAll('.cpfe-row')].find(r=>/插件市场检索|Plugin marketplace search/.test(r.innerText));
    return {ok:state.ok,broken:state.broken,unavailable:state.baseUnavailable,market:market?{id:market.id,disabled:market.disabled}:null,label:row?.querySelector('.cpfe-row-head')?.textContent||null,checked:row?.querySelector('[role=switch]')?.getAttribute('aria-checked')||null,panel:document.querySelector('.cpfe')!==null};
  })()`)
  check('real settings panel and healthy preset load', observed.panel && observed.ok && !observed.broken && !observed.unavailable)
  if (version !== '0.2.0-rc.2') {
    check('new marketplace row comes from mounted host composition', observed.market?.id === 'tool-plugin-market')
    check('new localized marketplace label is rendered in real DOM', /插件市场检索|Plugin marketplace search/.test(observed.label ?? ''))
    check('new marketplace row remains off by default', observed.market.disabled === true && observed.checked === 'false')
    const clickControl = async (selector) => {
      const point = await session.evaluate(`(() => {${selector};if(!button)return null;button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
      assert.ok(point,'native control exists');await session.clickAt(point.x,point.y);await session.sleep(400)
    }
    const marketSwitch = "const row=[...document.querySelectorAll('.cpfe-row')].find(r=>/插件市场检索|Plugin marketplace search/.test(r.innerText));const button=row?.querySelector('[role=switch]')"
    const saveButton = "const button=[...document.querySelectorAll('.cpfe button')].find(b=>/^(保存|Save)$/.test(b.textContent.trim())&&!b.disabled)"
    const readback = () => session.evaluate(`(async()=>{const s=await(await fetch('/api/custom-mode/state?id=custom')).json();return {ok:s.ok,broken:s.broken,overrides:s.overrides}})()`)
    await clickControl(marketSwitch);await clickControl(saveButton);await session.sleep(700)
    const enabled = await readback()
    check('native marketplace switch saves on and mounts healthy', enabled.ok && !enabled.broken && enabled.overrides?.['tool-plugin-market'] === true)
    await clickControl(marketSwitch);await clickControl(saveButton);await session.sleep(700)
    const disabled = await readback()
    check('native marketplace switch saves back off', disabled.ok && !disabled.broken && disabled.overrides?.['tool-plugin-market'] !== true)

  } else check('0.2.0-rc.2 does not acquire a nonexistent marketplace row', observed.market === null && observed.label === null)
  const targets = await session.send('Target.getTargets')
  check('one browser page only', targets.targetInfos.filter(x=>x.type==='page').length === 1)
  await session.evaluate(`(() => {const row=[...document.querySelectorAll('.cpfe-row')].find(r=>/插件市场检索|Plugin marketplace search/.test(r.innerText));row?.scrollIntoView({block:'center'});return true})()`)
  await session.screenshot(out)
  writeFileSync(out + '.json', JSON.stringify({ version, checks, observed, realHost:true, modelCalled:false },null,2)+'\n')
  console.log(JSON.stringify({ version, passed:checks.length, realHost:true }))
} finally { session.close() }

process.exit(0)
