#!/usr/bin/env node
/** Read the actual test page's settings affordance; no product acceptance claim. */
import { writeFileSync } from 'node:fs'
import { connect } from './screenshots/cdp.mjs'
const args=process.argv.slice(2), option=n=>args[args.indexOf('--'+n)+1]
const session=await connect(), out=option('out')
const snapshot=()=>session.evaluate(`({body:document.body.innerText.slice(0,2000),buttons:[...document.querySelectorAll('button,[role=button]')].map(b=>({text:b.innerText?.trim().slice(0,80),aria:b.getAttribute('aria-label'),title:b.getAttribute('title'),testId:b.getAttribute('data-testid')})).filter(x=>x.text||x.aria||x.title||x.testId).slice(0,70)})`)
try {
  await session.goto(option('url'),{waitMs:3500})
  const before=await snapshot();await session.screenshot(out+'.before.png')
  const close=await session.evaluate(`(() => {const b=document.querySelector('button[aria-label="Close"]');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
  if(close){await session.clickAt(close.x,close.y);await session.sleep(500)}
  const more=await session.evaluate(`(() => {const b=document.querySelector('button[aria-label="Account menu"]');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
  if(more){await session.clickAt(more.x,more.y);await session.sleep(500)}
  const menu=await snapshot()
  await session.screenshot(out+'.menu.png')

  const point=await session.evaluate(`(() => {const b=[...document.querySelectorAll('button,[role=button],[role=menuitem]')].find(b=>[b.innerText,b.getAttribute('aria-label'),b.getAttribute('title')].some(t=>/^(设置|Settings)$/.test(t?.trim()||'')));if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
  if(point){await session.clickAt(point.x,point.y);await session.sleep(1800)}
  const after=await snapshot();await session.screenshot(out)
  writeFileSync(out+'.json',JSON.stringify({scope:'read actual UI navigation; diagnostic only',settingsPoint:point,before,menu,after},null,2)+'\n')
  console.log(JSON.stringify({settingsPoint:point,before,menu,after}))
} finally {session.close()}
process.exit(0)
