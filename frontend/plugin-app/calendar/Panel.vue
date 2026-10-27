<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- The sidebar is a shortcut surface; the workspace alone owns the calendar and dialogs.
     Both use the host's revisioned presentation state through calendar.workspace. -->
<template>
  <CalendarSidebar v-if="isSidebar" :dir="$i18n.locale === 'ar-SA' ? 'rtl' : 'ltr'" :state="workspaceState" :projects="filterProjects" :tasks="agendaTasks" :today="todayKey"
    :current-project-id="currentProjectId" :loading="!allLoaded" :error="hasLoadError"
    @change="changeWorkspace($event, true)" @open="openWorkspace()" @create="openWorkspace({ create: true })"
    @open-task="openWorkspace({ focus: $event.id })" @toggle="onToggle" @open-file="onOpenFile" @delete="onDelete"
    @retry="retryLoad" @overdue="openOverdue" />
  <view v-else :dir="$i18n.locale === 'ar-SA' ? 'rtl' : 'ltr'" class="calendar-pane" :class="{ 'is-embedded': embedded }">
    <view class="calendar-container">
      <view class="content-header cal-header">
        <view class="cal-header-left">
          <!-- 标签形态（embedded）没有「返回」：关标签走标签条上的 ×（dev-board#1048） -->
          <view v-if="!embedded" class="cal-back" @tap="goBack">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <text>{{ $t('calendar.back') }}</text>
          </view>
          <view class="cal-title-block"><text class="header-title">{{ $t('calendar.schedulePageTitle') }}</text>
            <text class="cal-scope-label">{{ scopeLabel }}</text></view>
        </view>

        <view class="cal-header-center">
          <view class="cal-nav">
            <view class="cal-nav-btn" :title="$t('calendar.prevPeriod')" @tap="navPrev">
              <svg viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </view>
            <view class="cal-today-btn" @tap="navToday">{{ $t('calendar.today') }}</view>
            <view class="cal-nav-btn" :title="$t('calendar.nextPeriod')" @tap="navNext">
              <svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </view>
          </view>
          <text class="cal-period">{{ periodTitle }}</text>
        </view>

        <view class="header-actions cal-header-right">
          <view class="cal-seg">
            <view
              v-for="v in VIEWS"
              role="button" tabindex="0" :aria-pressed="viewType === v.type"
              @keydown.enter.prevent="changeView(v.type)" @keydown.space.prevent="changeView(v.type)"
              :key="v.type"
              class="cal-seg-btn"
              :class="{ active: viewType === v.type }"
              @tap="changeView(v.type)"
            >{{ $t(v.labelKey) }}</view>
          </view>

          <view class="cal-filter-wrap">
            <view class="cal-filter-btn" :class="{ 'is-active': activeFilterCount > 0, 'is-open': filterOpen }" @tap="filterOpen = !filterOpen">
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
              <text>{{ $t('calendar.filter') }}</text>
              <text v-if="activeFilterCount" class="cal-filter-count">{{ activeFilterCount }}</text>
            </view>
            <view v-if="filterOpen" class="cal-filter-mask" @tap="filterOpen = false"></view>
            <view v-if="filterOpen" class="cal-filter-pop" @tap.stop>
              <view v-if="!scopedProjectId" class="fp-section">
                <text class="fp-label">{{ $t('calendar.filterProjects') }}</text>
                <view class="fp-list">
                  <view class="fp-option" :class="{ checked: !filter.projectIds.length }" @tap="filter.projectIds = []">
                    <view class="fp-box"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg></view>
                    <text class="fp-option-text">{{ $t('calendar.filterAllProjects') }}</text>
                  </view>
                  <view
                    v-for="p in filterProjects"
                    :key="p.id"
                    class="fp-option"
                    :class="{ checked: filter.projectIds.includes(String(p.id)) }"
                    @tap="toggleProjectFilter(p.id)"
                  >
                    <view class="fp-box"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg></view>
                    <text class="fp-option-text" :title="p.name">{{ p.name }}</text>
                  </view>
                </view>
              </view>
              <view class="fp-section">
                <text class="fp-label">{{ $t('calendar.filterTypes') }}</text>
                <view class="fp-chips">
                  <view
                    v-for="m in typeMetas"
                    :key="m.key"
                    class="fp-chip"
                    :class="{ checked: filter.types.includes(m.key) }"
                    :style="filter.types.includes(m.key) ? { borderColor: m.color, background: m.soft } : null"
                    @tap="toggleTypeFilter(m.key)"
                  >
                    <text class="fp-chip-dot" :style="{ background: m.color }"></text>
                    <text>{{ m.label }}</text>
                  </view>
                </view>
              </view>
              <view class="fp-row">
                <text class="fp-row-label">{{ $t('calendar.filterIncludeDone') }}</text>
                <AwdSwitch :checked="filter.includeDone" @change="setIncludeDone" />
              </view>
              <view class="fp-foot">
                <text class="fp-reset" :class="{ disabled: !activeFilterCount }" @tap="resetFilter">{{ $t('calendar.filterReset') }}</text>
              </view>
            </view>
          </view>

          <view class="cal-primary-btn" @tap="openCreate()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            <text>{{ $t('calendar.newTask') }}</text>
          </view>
        </view>
      </view>

      <view v-if="!allLoaded || hasLoadError" class="cal-load-state" role="status">
        <text>{{ $t(hasLoadError ? 'calendar.loadFailed' : 'calendar.loading') }}</text>
        <button v-if="hasLoadError" @click="retryLoad">{{ $t('calendar.workspaceRetry') }}</button>
      </view>
      <view v-if="fileScopeId" class="cal-file-scope">
        <text>{{ $t('calendar.paneOnlyFile', { name: fileScopeName || '#' + fileScopeId }) }}</text>
        <button :aria-label="$t('calendar.paneClearFilter')" @click="changeWorkspace({ fileId: '' })">×</button>
      </view>
      <view class="calendar-body">
        <view class="calendar-main">
          <view v-if="viewType === 'year'" class="cal-year">
            <view v-for="month in yearGrid" :key="month.month" class="cal-year-month">
              <button class="cal-year-month-title" @click="openMonth(month.month)">{{ month.label }}</button>
              <view class="cal-year-grid">
                <text v-for="(day, weekday) in weekdayLabels" :key="weekday" class="cal-year-weekday">{{ day }}</text>
                <template v-for="(day, index) in month.days" :key="index">
                  <button v-if="day" class="cal-year-day" :class="{ 'is-today': day.date === todayKey, 'has-events': day.count }"
                    :aria-label="day.date + (day.count ? ' · ' + $t('calendar.workspaceEventCount', { count: day.count }) : '')"
                    @click="changeWorkspace({ date: day.date, viewType: 'timeGridDay' })">
                    {{ day.day }}<span v-if="day.count" class="cal-year-dot"></span>
                  </button><view v-else></view>
                </template>
              </view>
            </view>
          </view>
          <FullCalendar v-else ref="fc" class="fc-host" :options="calendarOptions" />
        </view>

      </view>
    </view>

    <TaskDialog
      :visible="dialogVisible"
      :mode="dialogMode"
      :task="editingTask"
      :project-id="dialogMode === 'create' && filter.projectIds.length === 1 ? filter.projectIds[0] : scopedProjectId"
      :projects="projects"
      :preset-date="presetDate"
      :preset-time="presetTime"
      @close="dialogVisible = false"
      @open-project="(t) => goToProject(t && t.projectId)"
      @open-file="onOpenFile"
    />
  </view>
</template>

<script>
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import calendarLocales from '@fullcalendar/core/locales-all'

import { getTaskProjectOptions, perform, subscribeChanges } from './api.js'
import { i18n } from '@/i18n'
import { getDayMarkType } from '@/components/calendar/holidayMarks.js'
import {
  TASK_TYPES, typeMeta, isDone, isHigh, timeOf, toEventStart, taskFiles, addDaysKey, localDateKey,
} from '@/components/calendar/taskUtils.js'
import { taskStore, loadGlobal, updateTask, deleteTask, subscribe } from '@/utils/taskStore.js'
import TaskDialog from './TaskDialog.vue'
import CalendarSidebar from './Sidebar.vue'
import { createCalendarWorkspaceState, yearMonths } from '@/components/calendar/workspaceState.js'
import AwdSwitch from '@/components/AwdSwitch.vue'

const VIEWS = [
  { type: 'timeGridDay', labelKey: 'calendar.workspaceDay' },
  { type: 'timeGridWeek', labelKey: 'calendar.viewWeek' },
  { type: 'dayGridMonth', labelKey: 'calendar.viewMonth' },
  { type: 'year', labelKey: 'calendar.workspaceYear' },
  { type: 'listMonth', labelKey: 'calendar.viewList' },
]

const FLAG_SVG = '<svg class="fc-awd-flag" viewBox="0 0 24 24" fill="none"><path d="M5 21V4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5 4h11l-2 4 2 4H5" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function defaultFilter() {
  return { projectIds: [], types: [], includeDone: true }
}

export default {
  name: 'CalendarPane',
  components: { FullCalendar, TaskDialog, CalendarSidebar, AwdSwitch },
  props: {
    viewPlacement: { type: String, default: 'workspace' },
    projectId: { type: [Number, String], default: null },
    embedded: { type: Boolean, default: true },
    focus: { type: [Number, String], default: '' },
    group: { type: String, default: '' },
  },
  emits: ['open-project', 'open-file', 'close'],
  data() {
    return {
      VIEWS,
      workspaceState: createCalendarWorkspaceState(),
      currentProjectId: '',
      workspaceReady: false,
      loadFailed: false,
      projectLoadFailed: false,
      workspaceLoadFailed: false,
      currentDate: localDateKey(),
      calendarOptions: {},
      // 当前视图区间内的事项（日历用）；议程直接读 taskStore.global.list
      tasks: [],
      allLoaded: false,
      projects: [],
      filter: defaultFilter(),
      filterOpen: false,
      viewType: 'dayGridMonth',
      periodTitle: '',
      todayKey: '',
      dialogVisible: false,
      dialogMode: 'create',
      editingTask: null,
      presetDate: '',
      presetTime: '',
      currentFrom: '',
      currentTo: '',
      // loadTasks 的请求序号，见该方法里的乱序说明
      loadSeq: 0,
      // 深链参数（props focus / group 收，消费一次即清）
      fileScopeId: null,
      fileScopeName: '',
      focusId: '',
      focusGroup: '',
    }
  },
  computed: {
    hasLoadError() { return this.loadFailed || this.projectLoadFailed || this.workspaceLoadFailed },
    isSidebar() { return this.viewPlacement === 'sidebar' },
    scopeLabel() {
      const names = this.filterProjects.filter(project => this.filter.projectIds.includes(String(project.id))).map(project => project.name)
      return names.length ? names.join(' · ') : this.$t('calendar.filterAllProjects')
    },
    yearGrid() { return yearMonths(Number(this.currentDate.slice(0, 4)), i18n.global.locale, this.agendaTasks) },
    weekdayLabels() { return Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 5 + i).toLocaleDateString(i18n.global.locale, { weekday: 'narrow' })) },
    // 项目收窄：空串与 null 都当全局
    scopedProjectId() {
      return Number(this.projectId) > 0 ? this.projectId : null
    },
    typeMetas() {
      return TASK_TYPES.map((k) => typeMeta(k, (key) => this.$t(key)))
    },
    // 筛选里的项目：我的项目 + 事项里出现过但不在清单里的（被移出的项目也能筛）
    filterProjects() {
      const out = this.projects.map((p) => ({ id: p.id, name: p.name }))
      const seen = new Set(out.map((p) => String(p.id)))
      for (const t of taskStore.global.list) {
        if (t && t.projectId != null && !seen.has(String(t.projectId))) {
          seen.add(String(t.projectId))
          out.push({ id: t.projectId, name: t.projectName || String(t.projectId) })
        }
      }
      return out
    },
    activeFilterCount() {
      let n = 0
      if (this.filter.projectIds.length) n++
      if (this.filter.types.length) n++
      if (!this.filter.includeDone) n++
      return n
    },
    agendaTasks() {
      return taskStore.global.list.filter((t) => this.matchesFilter(t))
    },
  },
  watch: {
    filter: {
      deep: true,
      handler() { this.rebuildEvents(); this.publishFilter() },
    },
    projectId() { this.rebuildEvents() },
    focus() { this.takeDeepLinks(); if (this.allLoaded) this.applyDeepLinks() },
    group() { this.takeDeepLinks(); if (this.allLoaded) this.applyDeepLinks() },
  },
  created() {
    this.takeDeepLinks()
    this.todayKey = localDateKey()
    this.buildCalendarOptions()
    this.loadProjects()
    this.loadAll()
    this.loadWorkspace()
    this.unsubscribe = subscribe(this.onStoreEvent)
    this.unsubscribeChanges = subscribeChanges(() => this.loadAll())
    this.unsubscribeCommands = window.awd.events.on('sidebar.command', this.onWorkspaceCommand)

  },
  beforeUnmount() {
    if (this.unsubscribe) this.unsubscribe()
    this.unsubscribeChanges?.()
    this.unsubscribeCommands?.()
  },
  methods: {
    async loadWorkspace() {
      this.workspaceLoadFailed = false
      try { this.applyWorkspaceState(await perform('workspace')); this.workspaceReady = true }
      catch (error) { this.workspaceLoadFailed = true }
    },
    async changeWorkspace(patch, open = false) {
      try { this.applyWorkspaceState(await perform('workspace', { patch, open })) }
      catch (error) { uni.showToast({ title: error.message || this.$t('calendar.saveFailed'), icon: 'none' }) }
    },
    async openWorkspace(options = {}) {
      try { this.applyWorkspaceState(await perform('workspace', { open: true, ...options })) }
      catch (error) { uni.showToast({ title: error.message || this.$t('calendar.loadFailed'), icon: 'none' }) }
    },
    async retryLoad() { await Promise.all([this.loadAll(), this.loadProjects(), this.loadWorkspace()]) },
    publishFilter() {
      if (!this.workspaceReady) return
      const patch = { projectIds: this.filter.projectIds, types: this.filter.types, includeDone: this.filter.includeDone }
      if (Object.keys(patch).some(key => JSON.stringify(patch[key]) !== JSON.stringify(this.workspaceState[key]))) this.changeWorkspace(patch)
    },
    applyWorkspaceState(state) {
      if (!state || !Number.isFinite(state.revision) || state.revision < this.workspaceState.revision) return
      this.workspaceState = state
      this.currentProjectId = state.currentProjectId || ''
      this.filter = { projectIds: state.projectIds, types: state.types, includeDone: state.includeDone }
      this.fileScopeId = state.fileId
      this.fileScopeName = state.fileName
      const changed = this.viewType !== state.viewType || this.currentDate !== state.date
      this.viewType = state.viewType
      this.currentDate = state.date
      if (this.isSidebar) return
      if (this.viewType === 'year') {
        this.periodTitle = String(Number(state.date.slice(0, 4)))
        this.currentFrom = state.date.slice(0, 4) + '-01-01'
        this.currentTo = String(Number(state.date.slice(0, 4)) + 1) + '-01-01'
        this.syncFromStore()
      } else if (changed) {
        this.calendarOptions.initialView = state.viewType
        this.calendarOptions.initialDate = state.date
        this.$nextTick(() => {
          const api = this.getApi()
          if (!api) return
          if (api.view.type !== state.viewType) api.changeView(state.viewType, state.date)
          else api.gotoDate(state.date)
        })
      }
    },
    onWorkspaceCommand(event) {
      if (event.command === 'calendar-state') {
        this.applyWorkspaceState(event.state)
        if (this.isSidebar) return
        if (event.focus) { this.focusId = String(event.focus); if (this.allLoaded) this.applyDeepLinks() }
        if (event.create) this.openCreate()
      }
      if (event.command === 'calendar-focus' && !this.isSidebar) {
        this.focusId = String(event.focus || ''); this.focusGroup = event.group || ''
        if (this.allLoaded) this.applyDeepLinks()
      }
      if (event.command === 'calendar-file') this.changeWorkspace({ fileId: String(event.fileId), fileName: event.name || '' })
    },
    openOverdue() {
      const task = this.agendaTasks.find(task => !isDone(task) && task.dueDate && task.dueDate < this.todayKey)
      if (task) this.openWorkspace({ focus: task.id })
    },
    openMonth(month) { this.changeWorkspace({ date: this.currentDate.slice(0, 4) + '-' + String(month + 1).padStart(2, '0') + '-01', viewType: 'dayGridMonth' }) },
    takeDeepLinks() {
      if (this.focus !== null && this.focus !== undefined && this.focus !== '') this.focusId = String(this.focus)
      if (['overdue', 'today', 'week', 'later'].includes(this.group)) this.focusGroup = this.group
    },

    updateSize() {
      const api = this.getApi()
      if (api) api.updateSize()
    },

    buildCalendarOptions() {
      const language = i18n.global.locale
      this.calendarOptions = {
        plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
        initialView: 'dayGridMonth',
        headerToolbar: false,
        locales: calendarLocales,
        locale: language.toLowerCase(),
        direction: language === 'ar-SA' ? 'rtl' : 'ltr',
        firstDay: 1,
        height: '100%',
        editable: true,
        eventDurationEditable: false,
        dayMaxEvents: 3,
        eventDisplay: 'block',
        // 月/周视图的时刻由 eventContent 自己画；列表视图用 FullCalendar 的时间列
        displayEventTime: false,
        views: { listMonth: { displayEventTime: true } },
        nowIndicator: true,
        scrollTime: '08:00:00',
        slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        events: [],
        datesSet: this.onDatesSet,
        dateClick: this.onDateClick,
        eventClick: this.onEventClick,
        eventDrop: this.onEventDrop,
        eventContent: this.renderEventContent,
        eventDidMount: this.onEventDidMount,
        dayCellClassNames: this.dayCellClassNames,
        dayCellContent: this.renderDayCellContent,
        dayHeaderClassNames: this.dayHeaderClassNames,
        dayHeaderContent: this.renderDayHeaderContent,
      }
    },

    getApi() {
      return this.$refs.fc && this.$refs.fc.getApi ? this.$refs.fc.getApi() : null
    },

    async loadProjects() {
      this.projectLoadFailed = false
      try {
        this.projects = (await getTaskProjectOptions()) || []
      } catch (e) {
        this.projectLoadFailed = true
        console.error('[calendar] 加载项目列表失败', e)
      }
    },

    // 议程要全部事项（逾期、之后、无日期），与日历视图区间解耦：翻到别的月份浏览时
    // 议程不能跟着漂移（漂了会把本周真正紧迫的事项藏掉）。进页强制重拉一次。
    async loadAll() {
      this.loadFailed = false
      try {
        await loadGlobal({ force: true })
        this.allLoaded = true
        this.syncFromStore()
        if (!this.isSidebar) this.applyDeepLinks()
      } catch (e) {
        this.loadFailed = true
        this.allLoaded = true
      }
    },

    async loadTasks(from, to) {
      // 连点翻月/切视图会连发请求，先发的（旧区间）响应可能后到。FullCalendar 只画
      // 落在当前视图区间内的事件，旧结果落地的表现是当前月份大面积空白（只剩两个
      // 区间重叠的那几条）。只认最后一次请求的结果，被放弃的那次连失败提示也一并咽掉。
      // FullCalendar 的 end 是开区间，loadGlobal 的 to 含端点，减一天。
      const seq = ++this.loadSeq
      try {
        const list = await loadGlobal({ from, to: addDaysKey(to, -1) })
        if (seq !== this.loadSeq) return
        this.tasks = list || []
        this.rebuildEvents()
      } catch (e) {
        if (seq !== this.loadSeq) return
        console.error('[calendar] 加载日程失败', e)
        uni.showToast({ title: this.$t('calendar.loadFailed'), icon: 'none' })
      }
    },

    // store 广播（新建/修改/删除/任一区间加载完）→ 从缓存里重取当前视图区间。
    // 缓存按区间合并，取出来的一定是当前区间的最新状态，不存在乱序问题。
    onStoreEvent(ev) {
      if (!ev || ev.kind === 'summary-loaded' || ev.kind === 'project-loaded') return
      this.syncFromStore()
    },

    syncFromStore() {
      if (!this.currentFrom || !this.currentTo) return
      const from = this.currentFrom
      const to = this.currentTo
      this.tasks = taskStore.global.list.filter((t) => t && t.dueDate && t.dueDate >= from && t.dueDate < to)
      this.rebuildEvents()
    },

    matchesFilter(t) {
      if (!t) return false
      if (this.fileScopeId && !taskFiles(t).some(file => String(file.fileId) === String(this.fileScopeId))) return false
      if (this.scopedProjectId != null && String(t.projectId) !== String(this.scopedProjectId)) return false
      const f = this.filter
      if (!f.includeDone && isDone(t)) return false
      if (f.projectIds.length && !f.projectIds.includes(String(t.projectId))) return false
      if (f.types.length && !f.types.includes(typeMeta(t.type).key)) return false
      return true
    },

    rebuildEvents() {
      this.calendarOptions.events = this.buildEvents()
    },

    buildEvents() {
      return this.tasks
        .filter((t) => t && t.dueDate && this.matchesFilter(t))
        .map((t) => {
          const done = isDone(t)
          const meta = typeMeta(t.type)
          return {
            id: String(t.id),
            title: t.title,
            start: toEventStart(t),
            allDay: !timeOf(t),
            backgroundColor: done ? 'var(--awd-surface-2)' : meta.soft,
            borderColor: done ? 'var(--awd-border-strong)' : meta.color,
            textColor: done ? 'var(--awd-text-3)' : 'var(--awd-text)',
            classNames: done ? ['fc-awd-done'] : [],
            extendedProps: { task: t },
          }
        })
    },

    onDatesSet(info) {
      // FullCalendar can emit a final datesSet while Vue is switching to the year grid.
      if (this.workspaceReady && this.workspaceState.viewType === 'year') return
      this.currentFrom = info.startStr.slice(0, 10)
      this.currentTo = info.endStr.slice(0, 10)
      this.viewType = info.view.type
      this.currentDate = localDateKey(info.view.currentStart)
      this.periodTitle = info.view.title
      this.loadTasks(this.currentFrom, this.currentTo)
      if (this.workspaceReady && (this.workspaceState.date !== this.currentDate || this.workspaceState.viewType !== this.viewType)) {
        this.changeWorkspace({ date: this.currentDate, viewType: this.viewType })
      }
    },

    navPrev() { this.navigatePeriod(-1) },
    navNext() { this.navigatePeriod(1) },
    navigatePeriod(step) {
      if (this.viewType === 'year') this.changeWorkspace({ date: String(Number(this.currentDate.slice(0, 4)) + step) + '-01-01' })
      else { const api = this.getApi(); if (api) step < 0 ? api.prev() : api.next() }
    },
    navToday() { this.changeWorkspace({ date: localDateKey() }) },
    changeView(type) { this.changeWorkspace({ viewType: type }) },

    toggleProjectFilter(id) {
      const key = String(id)
      const list = this.filter.projectIds
      this.filter.projectIds = list.includes(key) ? list.filter((x) => x !== key) : list.concat([key])
    },
    toggleTypeFilter(type) {
      const list = this.filter.types
      this.filter.types = list.includes(type) ? list.filter((x) => x !== type) : list.concat([type])
    },
    setIncludeDone(v) { this.filter.includeDone = !!v },
    resetFilter() { this.filter = defaultFilter() },

    openCreate(date = '', time = '') {
      this.editingTask = null
      this.dialogMode = 'create'
      this.presetDate = date
      this.presetTime = time
      this.dialogVisible = true
    },

    openEdit(task) {
      if (!task) return
      this.editingTask = task
      this.dialogMode = 'edit'
      this.presetDate = ''
      this.presetTime = ''
      this.dialogVisible = true
    },

    onDateClick(info) {
      // 周视图点时间格带时刻；月视图/全天行只有日期
      const time = !info.allDay && info.dateStr.length > 10 ? info.dateStr.slice(11, 16) : ''
      this.openCreate(info.dateStr.slice(0, 10), time)
    },

    onEventClick(info) {
      if (info.jsEvent) info.jsEvent.preventDefault()
      this.openEdit(info.event.extendedProps.task)
    },

    async onEventDrop(info) {
      const task = info.event.extendedProps.task
      if (!task) return
      const startStr = info.event.startStr || ''
      const newDate = startStr.slice(0, 10)
      // 周视图里纵向拖拽会改时刻，startStr 带 T 时以新时刻为准；拖进全天行清掉时刻；
      // 月视图拖拽保持原时刻。
      let newTime = timeOf(task) || null
      if (startStr.length > 10) newTime = startStr.slice(11, 16)
      else if (info.event.allDay && info.oldEvent && !info.oldEvent.allDay && ['timeGridWeek', 'timeGridDay'].includes(info.view.type)) newTime = null
      try {
        await updateTask(task.id, { dueDate: newDate, dueTime: newTime })
      } catch (e) {
        console.error('[calendar] 拖拽改期失败', e)
        uni.showToast({ title: this.$t('calendar.saveFailed'), icon: 'none' })
        info.revert()
      }
    },

    async onToggle(task) {
      if (!task) return
      try {
        await updateTask(task.id, { status: isDone(task) ? 'OPEN' : 'DONE' })
      } catch (e) {
        console.error('[calendar] 切换完成状态失败', e)
        uni.showToast({ title: this.$t('calendar.saveFailed'), icon: 'none' })
      }
    },

    onDelete(task) {
      if (!task) return
      uni.showModal({
        title: this.$t('calendar.deleteConfirmTitle'),
        content: this.$t('calendar.deleteConfirmContent', { title: task.title || '' }),
        cancelText: this.$t('calendar.cancel'),
        confirmText: this.$t('calendar.delete'),
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteTask(task.id)
            uni.showToast({ title: this.$t('calendar.deleted'), icon: 'success' })
          } catch (e) {
            console.error('[calendar] 删除事项失败', e)
            uni.showToast({ title: this.$t('calendar.deleteFailed'), icon: 'none' })
          }
        },
      })
    },

    async onOpenFile(payload) {
      const task = payload?.task
      if (!task?.projectId || payload.fileId == null) return
      try { await perform('openFile', { projectId: task.projectId, fileId: payload.fileId }); this.dialogVisible = false }
      catch (error) { uni.showToast({ title: error.message, icon: 'none' }) }
    },

    applyDeepLinks() {
      if (this.isSidebar) return
      let task = this.focusId ? taskStore.global.list.find(task => task && String(task.id) === this.focusId) : null
      this.focusId = ''
      if (!task && this.focusGroup) {
        const group = this.focusGroup
        task = taskStore.global.list.find(task => !isDone(task) && task.dueDate &&
          (group === 'overdue' ? task.dueDate < this.todayKey : group === 'today' ? task.dueDate === this.todayKey :
            group === 'week' ? task.dueDate >= this.todayKey && task.dueDate < addDaysKey(this.todayKey, 7) : task.dueDate >= addDaysKey(this.todayKey, 7)))
      }
      this.focusGroup = ''
      if (task) {
        this.changeWorkspace({ date: task.dueDate || this.todayKey, viewType: 'timeGridDay', projectIds: [String(task.projectId)], fileId: '' })
        this.openEdit(task)
      }
    },

    renderEventContent(arg) {
      const task = arg.event.extendedProps.task || {}
      const meta = typeMeta(task.type)
      const time = timeOf(task)
      const isList = arg.view && String(arg.view.type).startsWith('list')
      let html = `<div class="fc-awd-ev${isList ? ' is-list' : ''}">`
      if (!isList) html += `<span class="fc-awd-ev-bar" style="background:${meta.color}"></span>`
      if (time && !isList) html += `<span class="fc-awd-ev-time">${escapeHtml(time)}</span>`
      if (isHigh(task)) html += FLAG_SVG
      html += `<span class="fc-awd-ev-title">${escapeHtml(arg.event.title)}</span>`
      if (isList && task.projectName) html += `<span class="fc-awd-ev-project">${escapeHtml(task.projectName)}</span>`
      html += '</div>'
      return { html }
    },

    // hover 原生 title：标题 + 「项目 · 文件名」
    onEventDidMount(info) {
      const task = info.event.extendedProps.task || {}
      const parts = []
      if (task.projectName) parts.push(task.projectName)
      for (const f of taskFiles(task)) parts.push(f.fileName == null ? this.$t('calendar.fileMissing') : f.fileName)
      const meta = typeMeta(task.type, (k) => this.$t(k))
      const head = `[${meta.label}] ${task.title || ''}`
      info.el.title = parts.length ? `${head}\n${parts.join(' · ')}` : head
    },

    dayCellClassNames(arg) {
      const mark = getDayMarkType(arg.date)
      if (mark === 'holiday') return ['fc-day-holiday']
      if (mark === 'makeup') return ['fc-day-makeup']
      if (mark === 'weekend') return ['fc-day-weekend']
      return []
    },

    renderDayCellContent(arg) {
      // 周视图的「全天」行也算 day cell，会命中这个钩子；表头（dayHeaderContent）
      // 已经给每一天单独挂了角标，全天行再挂一遍是同一件事说两遍，只在月视图里挂。
      if (arg.view && arg.view.type !== 'dayGridMonth') return true
      const mark = getDayMarkType(arg.date)
      let html = ''
      if (mark === 'holiday') {
        html += `<span class="fc-holiday-badge fc-holiday-badge-rest">${escapeHtml(this.$t('calendar.holidayRest'))}</span>`
      } else if (mark === 'makeup') {
        html += `<span class="fc-holiday-badge fc-holiday-badge-work">${escapeHtml(this.$t('calendar.holidayWork'))}</span>`
      }
      // zh-cn locale 的 dayNumberText 是「25日」，格子里只要数字
      const num = String(arg.dayNumberText || '').replace(/[^0-9]/g, '') || arg.dayNumberText
      html += `<span class="fc-daynum">${escapeHtml(num)}</span>`
      return { html }
    },

    // 月视图的表头只是「周一/周二…」的通用列标，不对应具体某一天（FullCalendar
    // 内部用一个固定参考周取值），套节假日判定会张冠李戴；只在周视图（表头即具体
    // 某一天）里标节假日。
    dayHeaderClassNames(arg) {
      if (!arg.view || !['timeGridWeek', 'timeGridDay'].includes(arg.view.type)) return []
      const mark = getDayMarkType(arg.date)
      if (mark === 'holiday') return ['fc-day-holiday']
      if (mark === 'makeup') return ['fc-day-makeup']
      if (mark === 'weekend') return ['fc-day-weekend']
      return []
    },

    renderDayHeaderContent(arg) {
      if (!arg.view || !['timeGridWeek', 'timeGridDay'].includes(arg.view.type)) return true
      const mark = getDayMarkType(arg.date)
      // 「周一 21」：星期 + 日，比 locale 默认的「9/21周一」好扫
      const lang = i18n.global.locale
      const weekday = arg.date.toLocaleDateString(lang, { weekday: 'short' })
      let html = `<span class="fc-dh-weekday">${escapeHtml(weekday)}</span><span class="fc-dh-day">${arg.date.getDate()}</span>`
      if (mark === 'holiday') {
        html += `<span class="fc-holiday-badge fc-holiday-badge-rest">${escapeHtml(this.$t('calendar.holidayRest'))}</span>`
      } else if (mark === 'makeup') {
        html += `<span class="fc-holiday-badge fc-holiday-badge-work">${escapeHtml(this.$t('calendar.holidayWork'))}</span>`
      }
      return { html }
    },

    // 页面形态：工作台参与的跳转一律 reLaunch（与 project-list.vue 的 goToProject 同写法）；
    // 标签形态只 emit，宿主决定同项目就地打开还是跨项目 reLaunch。
    async goToProject(projectId) {
      if (!projectId) return
      try { await perform('openProject', { projectId }); this.dialogVisible = false }
      catch (error) { uni.showToast({ title: error.message, icon: 'none' }) }
    },

    // 页面形态不是工作台，返回项目列表按栈深度分流：有上一页 navigateBack，
    // 否则本页是栈底（直链/刷新进来），redirectTo 避免压栈。
    goBack() {
      if (this.embedded) {
        this.$emit('close')
        return
      }
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      if (pages && pages.length > 1) {
        uni.navigateBack()
      } else {
        uni.redirectTo({ url: '/pages/project-list/project-list' })
      }
    },
  },
}
</script>

<style lang="scss" scoped src="../../src/components/calendar/calendar-pane.scss"></style>

<style scoped>
.cal-title-block { display:flex; flex-direction:column; min-width:0; gap:5px; }
.cal-scope-label { font-size:12px; color:var(--awd-text-3); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cal-load-state, .cal-file-scope { display:flex; gap:12px; align-items:center; padding:8px 0; color:var(--awd-text-3); font-size:12px; }
.cal-load-state button, .cal-file-scope button { margin:0; padding:2px 8px; font:inherit; line-height:1.5; color:var(--awd-accent-text); border:1px solid var(--awd-border); background:var(--awd-surface); }
.cal-year { min-height:0; flex:1; overflow-y:auto; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px; padding:10px; }
.cal-year-month-title { padding:0 0 8px; margin:0; font-size:14px; font-weight:650; text-align:start; color:var(--awd-text); background:none; border:0; line-height:1.5; }
.cal-year-month-title::after, .cal-year-day::after { border:0; }
.cal-year-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:2px; }
.cal-year-weekday { text-align:center; font-size:10px; color:var(--awd-text-3); padding:4px 0; }
.cal-year-day { position:relative; min-width:0; padding:5px 0 7px; margin:0; font-size:12px; font-variant-numeric:tabular-nums; line-height:1.5; color:var(--awd-text-2); border:0; background:none; border-radius:var(--awd-radius-sm); cursor:pointer; }
.cal-year-day.has-events { background:var(--awd-accent-wash); color:var(--awd-accent-text); font-weight:600; }
.cal-year-day.is-today { background:var(--awd-accent); color:var(--awd-text-on-accent); }
.cal-year-day:hover, .cal-year-month-title:hover { background:var(--awd-hover-bg); }
.cal-year-day:focus-visible, .cal-year-month-title:focus-visible { outline:2px solid var(--awd-accent); }
.cal-year-dot { width:3px; height:3px; border-radius:50%; position:absolute; inset-inline-start:calc(50% - 1.5px); bottom:3px; background:currentColor; }
@container cal-pane (max-width:800px) { .cal-year { grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; } }
@container cal-pane (max-width:460px) { .cal-year { grid-template-columns:minmax(0,1fr); } }
@media (max-width:600px) {
  .calendar-pane.is-embedded { padding:12px; }
  .content-header { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:12px; }
  .cal-header-left, .cal-header-center, .cal-header-right { min-width:0; width:100%; }
  .cal-header-center, .cal-header-right { flex-wrap:wrap; justify-content:flex-start; gap:8px; }
  .cal-seg { width:100%; }
  .cal-seg-btn { flex:1; text-align:center; padding:0 6px; }
  .calendar-body { overflow:hidden; }
  .calendar-main { flex:1; height:auto; min-height:250px; padding:8px; }
  .cal-filter-pop { inset-inline-start:0; inset-inline-end:auto; max-width:calc(100vw - 24px); box-sizing:border-box; }
}
</style>
