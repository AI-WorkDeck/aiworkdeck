// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../../src/components/welcome/FolderCatalog.vue', import.meta.url), 'utf8')
function fixture() {
  const calls = [], events = []
  let modal
  const context = { renameProject: async (...args) => calls.push(['rename', ...args]), uni: { showToast() {}, showModal(value) { modal = value } } }
  const code = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =')
  vm.runInNewContext(code, context)
  const component = context.component
  const state = { ...component.data(), removeProject: async id => { calls.push(['delete', id]); return true }, client: false, projects: [], $t: key => key, $emit: (...args) => events.push(args) }
  for (const [name, method] of Object.entries(component.methods)) state[name] = method.bind(state)
  return { state, calls, events, modal: () => modal, component }
}
test('all-folder search is case insensitive and keeps full matching entries', () => {
  const {state, component} = fixture()
  state.projects = [{id:1,name:'Alpha'}, {id:2,name:'Other'}]; state.query = ' ALP '
  assert.deepEqual(component.computed.filteredProjects.call(state), [state.projects[0]])
})
test('rename captures identity before blur and reads confirmed input', async () => {
  const {state,calls,events} = fixture()
  state.startRename({id:3,name:'Before'})
  const request = state.confirmRename({detail:{value:'After'}})
  state.cancelRename()
  await request
  assert.deepEqual(calls, [['rename',3,'After']])
  assert.equal(events[0][0], 'renamed'); assert.equal(events[0][1].id,3); assert.equal(events[0][1].name,'After')
})
test('delete requires confirmation and emits only after successful deletion', async () => {
  const {state,calls,events,modal} = fixture()
  state.remove({id:4}); await modal().success({confirm:false}); assert.equal(calls.length,0)
  state.remove({id:4}); await modal().success({confirm:true})
  assert.deepEqual(calls,[['delete',4]]); assert.deepEqual(events,[['deleted',4]])
})
test('CLIENT cannot invoke mutation methods even outside the hidden controls', async () => {
  const {state,calls,modal} = fixture(); state.client = true
  state.startRename({id:1,name:'x'}); state.remove({id:1}); await state.confirmRename()
  assert.equal(modal(),undefined); assert.equal(state.renamingId,null); assert.equal(calls.length,0)
})

const welcomeSource = readFileSync(new URL('../../src/components/welcome/WelcomePane.vue', import.meta.url), 'utf8')
function welcomeFixture() {
  const code = welcomeSource.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =')
  const context = { CloudAcceptDialog: {}, FolderCatalog: {}, AccountProjectCatalog: {}, buildRecentProjects: list => list, getRecentProjectIds: () => [] }
  vm.runInNewContext(code, context)
  const state = { currentProjectId: 7, allProjects: [{id:7,name:'old'}], $emit: (...args) => events.push(args), leaveWorkbench: url => visits.push(url) }
  const visits = [], events = []
  for (const [name, method] of Object.entries(context.component.methods)) state[name] = method.bind(state)
  return {state, visits, events, component:context.component}
}
test('current folder activates its files while catalog imports use the same navigation', () => {
  const {state,visits,events} = welcomeFixture()
  state.openProject({id:7}); assert.deepEqual(events,[['activate-current-project']]); assert.equal(visits.length,0)
  state.onCatalogImported({projectId:8}); assert.deepEqual(visits,['/pages/project-overview/project-overview?id=8&pane=files'])
})
test('rename refreshes recent objects and deletion only updates welcome lists', () => {
  const {state,visits,events} = welcomeFixture()
  state.recentProjects = [state.allProjects[0]]
  state.onFolderRenamed({id:7,name:'new'}); assert.equal(state.recentProjects[0].name,'new'); assert.equal(events[0][0],'project-renamed')
  state.onFolderDeleted(7); assert.equal(state.allProjects.length,0); assert.deepEqual(visits,[])
})
test('host catalog request expands welcome list both initially and on repeated requests', () => {
  const {component,state} = welcomeFixture()
  assert.equal(component.data.call({catalogRequest:1}).showAllFolders,true)
  state.showAllFolders = false; component.watch.catalogRequest.call(state,2); assert.equal(state.showAllFolders,true)
})

test('host cancellation leaves the list intact and clears busy state', async () => {
  const {state,events,modal} = fixture()
  state.removeProject = async () => false
  state.remove({id:4}); await modal().success({confirm:true})
  assert.deepEqual(events,[]); assert.equal(state.busy,false)
})
test('host deletion failure does not announce deletion and can be retried', async () => {
  const {state,events,modal} = fixture()
  state.removeProject = async () => { throw new Error('synthetic failure') }
  state.remove({id:4}); await modal().success({confirm:true})
  assert.deepEqual(events,[]); assert.equal(state.busy,false)
})
