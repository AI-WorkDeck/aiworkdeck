// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../../src/'+p,import.meta.url),'utf8')
const pane=read('components/project-list/ProjectListPane.vue')
const catalog=read('components/project-list/AccountProjectCatalog.vue')
const styles=read('components/project-list/project-list-pane.scss')
const script=catalog.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'').replace('export default','return')
const component=new Function(script)()
test('sidebar has one compact list and never reads obsolete grid preferences',()=>{
  assert.doesNotMatch(pane,/view-toggle|viewMode|VIEW_MODE_KEY|restoreViewMode|project-grid|project-item-card/)
  assert.equal((pane.match(/v-for="project in visibleProjects"/g)||[]).length,1)
  assert.match(pane,/<view v-else class="project-table">/)
  assert.match(pane,/class="project-sort"/,'date sorting remains available when date columns are hidden')
  assert.doesNotMatch(catalog,/viewMode|catalog-grid/)
})
test('ProjectListPane is only mounted in sidebar; the former full-page route redirects there',()=>{
  assert.match(read('pages/project-overview/project-overview.vue'),/<ProjectListPane/)
  const route=read('pages/project-list/project-list.vue')
  assert.doesNotMatch(route,/<ProjectListPane/)
  assert.match(route,/project-overview\?pane=projects/)
})
test('availability stays brief in the row and full location detail remains in tooltip',()=>{
  const vm={$t:key=>key}
  const availability=component.methods.availabilityText.bind(vm)
  assert.equal(availability({localProjectId:7,locations:[{kind:'desktop',online:false}]}),'projects.catalogAvailabilityLocal')
  assert.equal(availability({locations:[{kind:'cloud'},{kind:'desktop',online:false}]}),'projects.catalogAvailabilityCloud')
  assert.equal(availability({locations:[{kind:'desktop',online:true}]}),'projects.catalogAvailabilityRemote')
  assert.equal(availability({locations:[{kind:'desktop',online:false}]}),'projects.catalogAvailabilityWaiting')
  assert.match(catalog,/project.name \+ ' · ' \+ locationHelp\(project\)/)
  assert.match(catalog,/catalog-project-title/)
  assert.match(catalog,/catalog-other-locations" role="button" tabindex="0"[^>]+:aria-label=/)
  assert.match(catalog,/@tap="openLocations\(project\)"/)
})
test('compact catalog styling references only defined theme tokens and does not restore large cards',()=>{
  const definitions=read('App.vue')+'\n'+read('utils/appTheme.js')
  const known=new Set([...definitions.matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1]))
  for(const [,token] of catalog.split('<style scoped>')[1].matchAll(/var\((--[\w-]+)/g))assert.ok(known.has(token),`undefined theme token ${token}`)
  assert.doesNotMatch(styles,/\.project-grid|\.project-item-card|\.view-toggle/)
  assert.match(styles,/\.ptable-row\s*\{\s*min-height: var\(--awd-control-height\)/)
})

test('wide desktop window with a 640px pane hides secondary columns by pane width',()=>{
  const responsive=[...styles.matchAll(/@(media|container)(?: project-list-pane)? \(max-width: (\d+)px\)\s*\{([\s\S]*?)\n\}/g)]
  function hidden(selector,windowWidth,paneWidth){
    return responsive.some(([,kind,max,body])=>
      (kind==='container'?paneWidth:windowWidth)<=Number(max)
      && body.includes(`${selector} { display: none; }`))
  }
  assert.equal(hidden('.col-client',1280,640),true)
  assert.equal(hidden('.col-created',1280,640),true)
  assert.equal(hidden('.col-client',1600,1200),false)
  assert.equal(hidden('.col-created',1600,1200),false)
  assert.doesNotMatch(styles, /@media \(max-width: (?:1080|900)px\)/)
})
