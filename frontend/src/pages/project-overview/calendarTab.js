// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// calendarTab.js — 中栏「日程」标签（dev-board#1048，spec 2026-09-29-defer-login-welcome-tab-design §7）。
//
// 形制照 welcomeTab.js：零依赖（不 import Vue / uni / '@/' 别名），方法组里的 this 就是
// project-overview 页面实例，node --test 拿一个假 this 就能跑（tests/project-home/calendar-tab.test.mjs）。
//
// 契约：
//   1. 单例：id 恒为 'calendar'，左右两个窗格任一边开着就只激活并更新深链，不开第二个；
//   2. 不是文档：tabType 'calendar' 在 fileKind.js 的 NON_FILE_TAB_TYPES 里，id 非数字，
//      activeTabContext.isContextEligibleTab 对它恒为 false；
//   3. 全局视图：标签里的 CalendarPane 恒传 projectId=null（跨项目事项，筛选弹层里可按项目收窄），
//      有项目态与无项目态一样；
//   4. 深链 focus（事项 id）/ group（overdue|today|week|later）挂在标签对象上的
//      calendarFocus / calendarGroup，CalendarPane 消费一次即清（watch 值变化再生效）。
//      同值再次打开要先清空、下一拍写回，否则 watch 不触发（同 openSettingsTab 的 adminNav）。
//      深链不进标签快照（tabSnapshot.js）：重启时再弹一次事项编辑框是打扰。

import { createCalendarWorkspaceState, patchCalendarWorkspaceState } from '../../components/calendar/workspaceState.js'

export const CALENDAR_TAB_ID = 'calendar'
export const CALENDAR_TAB_TYPE = 'calendar'

const GROUPS = ['overdue', 'today', 'week', 'later']

function normFocus(v) {
  return v === null || v === undefined ? '' : String(v)
}

function normGroup(v) {
  return GROUPS.includes(v) ? v : ''
}

export const calendarTabMethods = {
  calendarWorkspace(params = {}) {
    const previous = this.calendarWorkspaceState || createCalendarWorkspaceState()
    const state = patchCalendarWorkspaceState(previous, params.patch)
    this.calendarWorkspaceState = state
    if (params.open === true || params.focus || params.create === true) this.openPluginTab('calendar')
    // The workbench makes stored arrays reactive; sandbox postMessage needs plain arrays.
    const result = { ...state, projectIds: [...state.projectIds], types: [...state.types], currentProjectId: this.hasProject ? String(this.projectId) : '' }
    if (state.revision !== previous.revision || params.focus || params.create === true) {
      this.$nextTick(() => uni.$emit('awd:plugin-sidebar-command', {
        pluginId: 'calendar', command: 'calendar-state', state: result,
        focus: normFocus(params.focus), create: params.create === true,
      }))
    }
    return result
  },
  /** 打开（或激活）日程标签。opts.focus / opts.group 是一次性深链。 */
  openCalendarTab(opts) {
    if (!this.dynamicPluginsLoaded) { this.pendingCalendarOpen = opts || {}; return }
    this.openPluginTab('calendar')
    const payload = { pluginId: 'calendar', command: 'calendar-focus', focus: normFocus(opts?.focus), group: normGroup(opts?.group) }
    this.$nextTick(() => uni.$emit('awd:plugin-sidebar-command', payload))
  },

  /** 标签里的「关闭」（页头返回在标签形态下隐藏，保留给键盘 / 程序调用） */
  closeCalendarTab() {
    for (const pane of ['left', 'right']) {
      const list = pane === 'left' ? this.leftFiles : this.rightFiles
      const tab = list.find(f => f.id === CALENDAR_TAB_ID || (f.tabType === 'plugin' && f.pluginId === 'calendar'))
      if (tab) this.closeFile(tab.id, pane)
    }
  },

  /**
   * 标签里「进入项目」：同项目就地不动（CalendarPane 已先关掉自己的弹窗），
   * 跨项目走 leaveWorkbench（先落盘再 reLaunch，工作台参与的跳转一律 reLaunch）。
   */
  onCalendarOpenProject(payload) {
    const pid = payload && payload.projectId
    if (pid === null || pid === undefined || pid === '') return
    if (this.hasProject && String(pid) === String(this.projectId)) return
    this.leaveWorkbench(`/pages/project-overview/project-overview?id=${pid}`)
  },

  /** 标签里的文件芯片：同项目就地打开（onTaskOpenFile），跨项目 reLaunch 带 openFileId。 */
  onCalendarOpenFile(payload) {
    const pid = payload && payload.projectId
    const fileId = payload && payload.fileId
    if (pid === null || pid === undefined || pid === '' || fileId === null || fileId === undefined) return
    if (this.hasProject && String(pid) === String(this.projectId)) {
      this.onTaskOpenFile({ fileId })
      return
    }
    this.leaveWorkbench(`/pages/project-overview/project-overview?id=${pid}&openFileId=${fileId}`)
  },
}
