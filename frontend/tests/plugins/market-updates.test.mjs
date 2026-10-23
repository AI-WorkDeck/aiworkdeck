// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPluginUpdateAvailable, mergePluginCatalog } from '../../src/utils/marketUpdates.js'

test('update decisions follow SemVer and require a known installed version', () => {
  for (const [remote, local, expected] of [
    ['0.2.0', '0.1.1', true], ['1.10.0', '1.9.0', true], ['1.0.0', '2.0.0', false],
    ['1.0.0+build.2', '1.0.0+build.1', false], ['1.0.0', '1.0.0-rc.1', true],
    ['1.0.0-rc.2', '1.0.0-rc.10', false], ['1.0.0-alpha', '1.0.0-1', true],
    ['dev', '0.1.0', false], ['1.0.0', '', false], ['1.0.0', 'invalid', false],
    ['01.0.0', '0.1.0', false], ['1.0.0-01', '0.1.0', false],
  ]) assert.equal(isPluginUpdateAvailable({version:remote}, {version:local}), expected, `${local} → ${remote}`)
  assert.equal(isPluginUpdateAvailable({version:'2.0.0'}, {version:'1.0.0',revokedReason:'revoked'}), false)
})

test('remote versions replace bundled entries without routing updates to the old bundle', () => {
  const catalog = mergePluginCatalog([{id:'chat',version:'0.2.0'}], [{id:'chat',version:'0.1.0',bundled:true},{id:'local',bundled:true}])
  assert.equal(catalog.length, 2)
  assert.equal(catalog[0].version, '0.2.0')
  assert.equal(catalog[0].bundled, undefined)
  assert.equal(catalog[1].bundled, true)
  const newerBundle = {id:'chat',version:'0.3.0',bundled:true,installed:false}
  assert.equal(mergePluginCatalog([{id:'chat',version:'0.2.0',installed:false}],[newerBundle])[0].bundled,true)
  assert.equal(mergePluginCatalog([{id:'chat',version:'0.2.0',installed:true}],[newerBundle])[0].bundled,undefined)
})

const source = readFileSync(new URL('../../src/composables/usePluginUpdates.js', import.meta.url), 'utf8')
function harness() {
  let local = [{id:'chat',version:'0.1.1'}], remote = [{id:'chat',version:'0.2.0'}], failure = false, pending
  let requests = 0
  const events = new Map(), focus = new Map(), timers = new Set()
  const deps = {
    reactive: value => value, isPluginUpdateAvailable, mergePluginCatalog,
    getPlugins: async () => structuredClone(local), getBundledPlugins: async () => ({plugins:[{id:'chat',version:'0.1.0',bundled:true}]}),
    getPluginMarket: async options => {
      assert.equal(options.accountPrompt, false)
      requests++
      if (pending) { const p=pending; pending=null; return p }
      if(failure) throw Error('offline')
      return {plugins:structuredClone(remote)}
    },
    uni: {$on:(key,fn)=>events.set(key,fn),$off:(key)=>events.delete(key),$emit:key=>events.get(key)?.()},
    window: {addEventListener:(key,fn)=>focus.set(key,fn),removeEventListener:key=>focus.delete(key)},
    document: {visibilityState:'visible'},
    setInterval: fn=>{timers.add(fn);return fn},clearInterval:fn=>timers.delete(fn),
  }
  const code = source.replace(/^import .*$/gm,'').replace(/^export /gm,'')
  const api = new Function(...Object.keys(deps), `${code}; return {pluginUpdates,refreshPluginUpdates,startPluginUpdateChecks}`)(...Object.values(deps))
  return {...api,events,focus,timers,get requests(){return requests},setLocal:value=>{local=value},setRemote:value=>{remote=value},fail:()=>{failure=true},delay:p=>{pending=p}}
}

test('workbench checks without marketplace mounted and cleans up shared listeners', async () => {
  const h=harness(), stop=h.startPluginUpdateChecks(), stopSecond=h.startPluginUpdateChecks()
  await h.refreshPluginUpdates()
  assert.equal(h.pluginUpdates.count, 1)
  assert.equal(h.requests, 1)
  assert.equal(h.timers.size, 1)
  h.focus.get('focus')()
  assert.equal(h.requests, 1, 'frequent focus does not spam the registry')
  stop(); assert.equal(h.timers.size,1)
  stopSecond(); assert.equal(h.timers.size,0);assert.equal(h.events.size,0);assert.equal(h.focus.size,0)
})

test('successful update and uninstall clear the badge using local readback', async () => {
  const h=harness(), stop=h.startPluginUpdateChecks()
  let detailRefreshes=0
  h.events.set('awd:market-update-checked',()=>detailRefreshes++)
  await h.refreshPluginUpdates()
  h.setLocal([{id:'chat',version:'0.2.0'}])
  await h.events.get('awd:market-changed')()
  assert.equal(h.pluginUpdates.count,0)
  assert.ok(detailRefreshes>=2, 'open details refresh after a background check too')
  h.setLocal([])
  await h.events.get('awd:market-changed-from-sidebar')()
  assert.equal(h.pluginUpdates.count,0)
  stop()
})

test('offline check preserves known updates and reports failure instead of all-up-to-date', async () => {
  const h=harness()
  await h.refreshPluginUpdates(true)
  h.fail()
  await h.refreshPluginUpdates(true)
  assert.equal(h.pluginUpdates.count,1)
  assert.match(h.pluginUpdates.error,/offline/)
  assert.equal(h.pluginUpdates.checking,false)
})

test('mutation during an old in-flight check triggers a fresh read before completion', async () => {
  const h=harness()
  let resolve
  h.delay(new Promise(r=>{resolve=r}))
  const stop=h.startPluginUpdateChecks()
  const task=h.refreshPluginUpdates()
  h.setLocal([{id:'chat',version:'0.2.0'}])
  h.events.get('awd:market-changed')()
  resolve({plugins:[{id:'chat',version:'0.2.0'}]})
  await task
  assert.equal(h.pluginUpdates.count,0)
  assert.equal(h.requests,2)
  stop()
})

test('offline cached registry does not hide a bundled installation after uninstall', async () => {
  const h=harness()
  await h.refreshPluginUpdates(true)
  h.setLocal([])
  h.fail()
  await h.refreshPluginUpdates(true)
  assert.equal(h.pluginUpdates.catalog[0].bundled,true)
  assert.equal(h.pluginUpdates.count,0)
  assert.match(h.pluginUpdates.error,/offline/)
})

test('workbench badge and mounted plugin frames follow the shared count and version', () => {
  const page=readFileSync(new URL('../../src/pages/project-overview/project-overview.vue',import.meta.url),'utf8')
  assert.match(page,/p.key === 'market' && pluginUpdateState.count > 0/)
  assert.match(page,/_stopPluginUpdateChecks = startPluginUpdateChecks\(\)/)
  assert.match(page,/_stopPluginUpdateChecks\?\.\(\)/)
  assert.match(page,/version: p.version/)
  assert.equal((page.match(/:key="entry.plugin.pluginId \+ ':' \+ entry.plugin.version"/g)||[]).length,2)
})
