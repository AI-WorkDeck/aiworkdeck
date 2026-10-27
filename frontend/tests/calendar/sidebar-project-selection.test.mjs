// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import * as Vue from 'vue'
import * as Ssr from 'vue/server-renderer'
import { upcomingTasks } from '../../src/components/calendar/workspaceState.js'
import { isDone } from '../../src/components/calendar/taskUtils.js'

const { descriptor } = parse(readFileSync(new URL('../../plugin-app/calendar/Sidebar.vue', import.meta.url), 'utf8'))
const script = descriptor.script.content.replace(/^import .*$/gm, '').replace('export default', 'return')
const options = new Function('TaskRow', 'upcomingTasks', 'isDone', script)({}, upcomingTasks, isDone)
const compiled = compileTemplate({ source: descriptor.template.content, filename: 'Sidebar.vue', id: 'sidebar-project-selection', ssr: true, ssrCssVars: [] })
assert.deepEqual(compiled.errors, [])
const body = compiled.code.replace(/^import \{([\s\S]*?)\} from "vue"$/m, 'const {$1} = Vue')
  .replace(/^import \{([\s\S]*?)\} from "vue\/server-renderer"$/m, 'const {$1} = Ssr')
  .replace(/\bas\b/g, ':').replace('export function ssrRender', 'function ssrRender')
const Sidebar = { ...options, ssrRender: new Function('Vue', 'Ssr', body + '\nreturn ssrRender')(Vue, Ssr) }
async function render(projectIds, projects) {
  const app = Vue.createSSRApp({ render: () => Vue.h(Sidebar, { state: { projectIds, recentDays: 3 }, projects, tasks: [], today: '2026-10-27' }) })
  app.config.globalProperties.$t = key => key
  return Ssr.renderToString(app)
}

test('multi-project placeholder names the selected projects in selection order and cannot be chosen as a project', async () => {
  const html = await render(['8', '7'], [{ id: 7, name: 'Alpha <case>' }, { id: 8, name: 'Beta' }])
  assert.match(html, /<option[^>]*value="__multiple__"[^>]*disabled[^>]*>Beta · Alpha &lt;case&gt;<\/option>/)
  assert.match(html, /<option value="">calendar.filterAllProjects<\/option>/)
  assert.match(html, /<option value="7">Alpha &lt;case&gt;<\/option>/)
})

test('missing project names keep their IDs rather than claiming all projects', async () => {
  const html = await render(['7', '9'], [{ id: 7, name: '' }])
  assert.match(html, /<option[^>]*disabled[^>]*>#7 · #9<\/option>/)
  for (const ids of [[], ['7']]) assert.doesNotMatch(await render(ids, [{ id: 7, name: 'Alpha' }]), /<option[^>]*disabled/)
})

