// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 工作台中栏「日程」标签（dev-board#1048，spec 2026-09-29-defer-login-welcome-tab-design §7）。
//
// 跑法：cd frontend && node --test tests/project-home/calendar-tab.test.mjs（test:project-home 一起跑）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { pluginWorkspaceTabMethods } from '../../src/pages/project-overview/pluginWorkspaceTabs.js'
import { CALENDAR_TAB_ID, CALENDAR_TAB_TYPE, calendarTabMethods } from '../../src/pages/project-overview/calendarTab.js'
import { isContextEligibleTab, pickActiveContextTab } from '../../src/pages/project-overview/activeTabContext.js'
import { NON_FILE_TAB_TYPES, fileKindKey } from '../../src/pages/project-overview/fileKind.js'

const read = (rel) => readFileSync(new URL('../../src/' + rel, import.meta.url), 'utf8')

function fakeWorkbench(overrides = {}) {
  const ticks = []
  const vm = {
    projectId: null,
    dynamicPluginsLoaded: true,
    dynamicPlugins: [{ pluginId: 'calendar', label: '日程', views: [{ scope: 'global' }] }],
    hasProject: false,
    leftFiles: [],
    rightFiles: [],
    activeFileIdLeft: null,
    activeFileIdRight: null,
    focusedPane: 'left',
    splitMode: false,
    resized: 0,
    left: [],
    opened: [],
    closed: [],
    $t: (k) => k,
    $nextTick: (fn) => { ticks.push(fn) },
    flushTicks() { while (ticks.length) ticks.shift()() },
    triggerWorkbenchResize() { this.resized++ },
    leaveWorkbench(url) { this.left.push(url) },
    onTaskOpenFile(p) { this.opened.push(p) },
    closeFile(id, pane) {
      this.closed.push([id, pane])
      const list = pane === 'left' ? this.leftFiles : this.rightFiles
      const i = list.findIndex((f) => f.id === id)
      if (i >= 0) list.splice(i, 1)
    },
    ...overrides,
  }
  for (const [k, fn] of Object.entries({ ...pluginWorkspaceTabMethods, ...calendarTabMethods })) vm[k] = fn.bind(vm)
  return vm
}

const calendarEvents = []
globalThis.uni = { $emit: (...args) => calendarEvents.push(args) }
test('calendar shortcut opens the installed global plugin workspace and forwards normalized deep links', () => {
  calendarEvents.length = 0
  const vm = fakeWorkbench()
  vm.openCalendarTab({ focus: 12, group: 'today' })
  vm.flushTicks()
  assert.deepEqual(vm.leftFiles[0], { id: 'plugin-calendar', tabType: 'plugin', pluginId: 'calendar', name: '日程' })
  assert.equal(vm.activeFileIdLeft, 'plugin-calendar')
  assert.deepEqual(calendarEvents.at(-1)[1], { pluginId: 'calendar', command: 'calendar-focus', focus: '12', group: 'today' })
})
test('invalid calendar group is removed and duplicate deep links remain separate events', () => {
  calendarEvents.length = 0
  const vm = fakeWorkbench()
  vm.openCalendarTab({ focus: 7, group: 'yesterday' }); vm.flushTicks()
  vm.openCalendarTab({ focus: 7 }); vm.flushTicks()
  assert.equal(calendarEvents.length, 2)
  assert.equal(calendarEvents[0][1].group, '')
  assert.equal(vm.leftFiles.length, 1)
})
test('calendar plugin stays singleton across panes and cannot open after removal', () => {
  const vm = fakeWorkbench({ splitMode: true })
  vm.rightFiles.push({ id: 'plugin-calendar', tabType: 'plugin', pluginId: 'calendar', name: '日程' })
  vm.leftFiles.push({ id: 12, name: '合同.docx' }); vm.activeFileIdLeft = 12
  vm.openCalendarTab(); vm.flushTicks()
  assert.equal(vm.rightFiles.length, 1); assert.equal(vm.leftFiles.length, 1)
  assert.equal(vm.activeFileIdRight, 'plugin-calendar'); assert.equal(vm.activeFileIdLeft, 12)
  const removed = fakeWorkbench({ dynamicPlugins: [] }); removed.openCalendarTab(); removed.flushTicks()
  assert.equal(removed.leftFiles.length, 0)
})
test('calendar deep link waits for installed plugin discovery', () => {
  const vm = fakeWorkbench({ dynamicPluginsLoaded: false })
  vm.openCalendarTab({ focus: 7 }); assert.equal(vm.leftFiles.length, 0)
  assert.deepEqual(vm.pendingCalendarOpen, { focus: 7 })
})

test('日程标签不能当活跃文档、不能拖进 AI 上下文，也不按扩展名上色', () => {
  const cal = { id: CALENDAR_TAB_ID, tabType: CALENDAR_TAB_TYPE, name: '日程' }
  assert.ok(NON_FILE_TAB_TYPES.includes('calendar'))
  assert.equal(isContextEligibleTab(cal), false)
  assert.equal(isContextEligibleTab({ ...cal, id: 42 }), false, 'tabType 那道闸挡得住数字 id')
  assert.equal(fileKindKey('docx', 'calendar'), '')
  assert.equal(pickActiveContextTab({ focusedPane: 'left', activeFileLeft: cal, activeFileRight: null }), null)
})

test('进入项目：同项目就地不动，跨项目走 leaveWorkbench；无项目态一律跨项目', () => {
  const vm = fakeWorkbench({ projectId: 5, hasProject: true })
  vm.onCalendarOpenProject({ projectId: 5 })
  vm.onCalendarOpenProject({ projectId: '5' })
  assert.deepEqual(vm.left, [], '同项目（数字 / 字符串）不离开工作台')
  vm.onCalendarOpenProject({ projectId: 9 })
  assert.deepEqual(vm.left, ['/pages/project-overview/project-overview?id=9'])
  const shell = fakeWorkbench()
  shell.onCalendarOpenProject({ projectId: 5 })
  assert.deepEqual(shell.left, ['/pages/project-overview/project-overview?id=5'])
  shell.onCalendarOpenProject({})
  assert.equal(shell.left.length, 1, '没有 projectId 什么都不做')
})

test('打开文件：同项目就地 onTaskOpenFile，跨项目 reLaunch 带 openFileId', () => {
  const vm = fakeWorkbench({ projectId: 5, hasProject: true })
  vm.onCalendarOpenFile({ projectId: 5, fileId: 31 })
  assert.deepEqual(vm.opened, [{ fileId: 31 }])
  assert.deepEqual(vm.left, [])
  vm.onCalendarOpenFile({ projectId: 6, fileId: 40 })
  assert.deepEqual(vm.left, ['/pages/project-overview/project-overview?id=6&openFileId=40'])
})

test('关闭：两侧哪边开着就关哪边', () => {
  const vm = fakeWorkbench({ splitMode: true })
  vm.rightFiles.push({ id: 'calendar', tabType: 'calendar' })
  vm.closeCalendarTab()
  assert.deepEqual(vm.closed, [['calendar', 'right']])
})

// ---------------- 薄壳页与提醒落点 ----------------

function extractFn(src, header) {
  const i = src.indexOf(header)
  assert.ok(i >= 0, '找不到 ' + header)
  const start = src.indexOf('{', i + header.length - 1)
  let depth = 0
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1)
  }
  throw new Error('括号没配上')
}

test('日程薄壳：query 原样透传成工作台 URL（tab=calendar，focus / group / projectId）', () => {
  const page = read('pages/calendar/calendar.vue')
  const fnSrc = extractFn(page, 'export function calendarShellTarget(query) {').replace('export ', '')
  const GROUPS = ['overdue', 'today', 'week', 'later']
  const calendarShellTarget = new Function('GROUPS', fnSrc + '\nreturn calendarShellTarget')(GROUPS)
  assert.equal(calendarShellTarget({}), '/pages/project-overview/project-overview?tab=calendar')
  assert.equal(calendarShellTarget({ focus: '12', group: 'week' }),
    '/pages/project-overview/project-overview?tab=calendar&focus=12&group=week')
  assert.equal(calendarShellTarget({ projectId: '3', group: 'bogus' }),
    '/pages/project-overview/project-overview?id=3&tab=calendar')
  assert.equal(calendarShellTarget({ projectId: 'null' }), '/pages/project-overview/project-overview?tab=calendar')
  assert.match(page, /uni\.reLaunch\(\{ url: calendarShellTarget\(query\) \}\)/)
  assert.doesNotMatch(page, /<CalendarPane/)
})

test('提醒通知点击：在工作台里开日程标签，不在工作台去薄壳页', () => {
  const src = read('utils/taskReminders.js')
  const fnSrc = extractFn(src, 'export function openReminderTarget(taskId) {').replace('export ', '')
  const run = (vm, route) => {
    const nav = []
    const window = { __checkbaActiveOverviewVm: vm }
    const getCurrentPages = () => (route ? [{ route }] : [])
    const uni = { navigateTo: (o) => nav.push(o.url) }
    const f = new Function('window', 'getCurrentPages', 'uni', 'WORKBENCH_ROUTE',
      fnSrc + '\nreturn openReminderTarget')(window, getCurrentPages, uni, 'pages/project-overview/project-overview')
    return { result: f(88), nav }
  }
  const calls = []
  const vm = { openCalendarTab: (o) => calls.push(o) }
  let r = run(vm, 'pages/project-overview/project-overview')
  assert.equal(r.result, 'tab')
  assert.deepEqual(calls, [{ focus: 88 }])
  assert.deepEqual(r.nav, [])
  r = run(vm, 'pages/admin/admin')
  assert.equal(r.result, 'page', '栈顶不是工作台：哪怕指针还在也去薄壳页')
  assert.deepEqual(r.nav, ['/pages/calendar/calendar?focus=88'])
  r = run(null, 'pages/project-overview/project-overview')
  assert.equal(r.result, 'page')
})

test('CalendarPane 标签形态：页头「返回」隐藏；进入项目 / 打开文件先收弹窗再 emit', () => {
  const src = read('components/calendar/CalendarPane.vue')
  assert.match(src, /<view v-if="!embedded" class="cal-back" @tap="goBack">/)
  const goToProject = extractFn(src, '    goToProject(projectId) {')
  assert.match(goToProject, /if \(this\.embedded\) \{\s*\/\/[^\n]*\n\s*this\.dialogVisible = false\s*\n\s*this\.\$emit\('open-project'/)
  const onOpenFile = extractFn(src, '    onOpenFile(payload) {')
  assert.match(onOpenFile, /if \(this\.embedded\) \{\s*this\.dialogVisible = false\s*\n\s*this\.\$emit\('open-file'/)
})

test('日程标签的两个全屏遮罩在 App.vue 的拖拽区退出名单里', () => {
  const app = read('App.vue')
  assert.match(app, /html\.is-desktop \.cal-filter-mask/)
  assert.match(app, /html\.is-desktop \.task-dialog-mask/)
})
