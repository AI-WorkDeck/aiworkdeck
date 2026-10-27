<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="calendar-shortcuts">
    <view class="shortcut-actions">
      <button class="shortcut-primary" @click="$emit('create')">+ {{ $t('calendar.newTask') }}</button>
      <button class="shortcut-link" @click="$emit('open')">{{ $t('calendar.viewFullSchedule') }} ↗</button>
    </view>
    <view class="shortcut-section">
      <text class="shortcut-heading">{{ $t('calendar.filterProjects') }}</text>
      <view class="shortcut-segments">
        <button :class="{ selected: !state.projectIds.length }" @click="selectProject('')">{{ $t('calendar.workspaceAll') }}</button>
        <button v-if="currentProjectId" :class="{ selected: state.projectIds.length === 1 && state.projectIds[0] === currentProjectId }" @click="selectProject(currentProjectId)">{{ $t('calendar.workspaceCurrent') }}</button>
      </view>
      <select class="shortcut-project" :value="state.projectIds.length > 1 ? '__multiple__' : state.projectIds[0] || ''" :title="selectedProjectNames" :aria-label="$t('calendar.filterProjects')" @change="selectProject($event.target.value)">
        <option v-if="state.projectIds.length > 1" value="__multiple__" disabled>{{ selectedProjectNames }}</option>
        <option value="">{{ $t('calendar.filterAllProjects') }}</option>
        <option v-for="project in projects" :key="project.id" :value="String(project.id)">{{ project.name }}</option>
      </select>
      <view v-if="state.fileId" class="shortcut-file">
        <text :title="state.fileName">{{ $t('calendar.paneOnlyFile', { name: state.fileName || '#' + state.fileId }) }}</text>
        <button :aria-label="$t('calendar.paneClearFilter')" @click="$emit('change', { fileId: '' })">×</button>
      </view>
    </view>
    <view class="shortcut-section shortcut-upcoming-head">
      <view class="shortcut-heading-row">
        <text class="shortcut-heading">{{ $t('calendar.workspaceUpcoming') }}</text>
        <text class="shortcut-count">{{ upcoming.length }}</text>
      </view>
      <view class="shortcut-segments">
        <button v-for="days in [3, 5]" :key="days" :class="{ selected: state.recentDays === days }" @click="$emit('change', { recentDays: days })">{{ $t('calendar.workspaceDays', { count: days }) }}</button>
      </view>
    </view>
    <view class="shortcut-list" aria-live="polite">
      <view v-if="loading" class="shortcut-empty">{{ $t('calendar.loading') }}</view>
      <view v-else-if="error" class="shortcut-empty">
        <text>{{ $t('calendar.loadFailed') }}</text>
        <button class="shortcut-link" @click="$emit('retry')">{{ $t('calendar.workspaceRetry') }}</button>
      </view>
      <template v-else>
        <button v-if="overdue" class="shortcut-overdue" @click="$emit('overdue')">{{ $t('calendar.workspaceOverdue', { count: overdue }) }} →</button>
        <view v-if="!upcoming.length" class="shortcut-empty">{{ $t('calendar.workspaceNoUpcoming', { count: state.recentDays }) }}</view>
        <TaskRow v-for="task in upcoming" :key="task.id" :task="task" :show-project="true" density="compact"
          tabindex="0" role="button" @keydown.enter.prevent="$emit('open-task', task)"
          @open="$emit('open-task', task)" @open-project="selectProject(task.projectId)" @toggle="$emit('toggle', task)" @open-file="$emit('open-file', $event)" @delete="$emit('delete', task)" />
      </template>
    </view>
    <text class="shortcut-footer">{{ $t('calendar.workspaceLinked') }}</text>
  </view>
</template>
<script>
import TaskRow from '@/components/calendar/TaskRow.vue'
import { upcomingTasks } from '@/components/calendar/workspaceState.js'
import { isDone } from '@/components/calendar/taskUtils.js'
export default {
  components: { TaskRow },
  props: { state: { type: Object, required: true }, projects: { type: Array, default: () => [] }, tasks: { type: Array, default: () => [] },
    currentProjectId: { type: String, default: '' }, today: { type: String, required: true }, loading: Boolean, error: Boolean },
  emits: ['change', 'open', 'create', 'open-task', 'toggle', 'open-file', 'delete', 'retry', 'overdue'],
  computed: {
    selectedProjectNames() { return this.state.projectIds.map(id => this.projects.find(project => String(project.id) === String(id))?.name || '#' + id).join(' · ') },
    upcoming() { return upcomingTasks(this.tasks, this.today, this.state.recentDays) },
    overdue() { return this.tasks.filter(task => !isDone(task) && task.dueDate && task.dueDate < this.today).length },
  },
  methods: { selectProject(id) { this.$emit('change', { projectIds: id ? [String(id)] : [], fileId: '' }) } },
}
</script>
<style scoped>
.calendar-shortcuts { height:100%; min-height:0; display:flex; flex-direction:column; color:var(--awd-text); background:var(--awd-surface); font-size:var(--awd-font-size-body); }
button { margin:0; padding:0; border:0; background:transparent; font:inherit; line-height:1.5; color:inherit; cursor:pointer; }
button::after { border:0; }
button:focus-visible, select:focus-visible { outline:2px solid var(--awd-accent); outline-offset:2px; }
.shortcut-actions { padding:16px 14px 12px; display:flex; flex-direction:column; gap:8px; }
.shortcut-primary { min-height:34px; background:var(--awd-accent); color:var(--awd-text-on-accent); border-radius:var(--awd-radius-md); font-weight:600; }
.shortcut-link { font-size:12px; color:var(--awd-accent-text); padding:3px; }
.shortcut-section { padding:14px; border-top:1px solid var(--awd-border); display:flex; flex-direction:column; gap:10px; }
.shortcut-heading-row { display:flex; justify-content:space-between; align-items:center; }
.shortcut-heading { font-size:12px; font-weight:650; color:var(--awd-text-2); }
.shortcut-count { font-size:12px; color:var(--awd-text-3); font-variant-numeric:tabular-nums; }
.shortcut-segments { display:flex; padding:3px; gap:3px; background:var(--awd-surface-2); border:1px solid var(--awd-border); border-radius:var(--awd-radius-md); }
.shortcut-segments button { flex:1; min-width:0; min-height:28px; border-radius:var(--awd-radius-sm); font-size:12px; color:var(--awd-text-2); }
.shortcut-segments .selected { background:var(--awd-surface); color:var(--awd-accent-text); font-weight:650; box-shadow:0 1px 3px var(--awd-border); }
.shortcut-project { width:100%; min-width:0; box-sizing:border-box; padding:8px; border:1px solid var(--awd-border); border-radius:var(--awd-radius-md); background:var(--awd-surface); color:var(--awd-text); font:inherit; font-size:12px; }
.shortcut-file { display:flex; align-items:center; gap:6px; padding:6px; background:var(--awd-accent-soft); border-radius:var(--awd-radius-sm); font-size:11px; }
.shortcut-file uni-text { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.shortcut-file button { width:22px; flex:none; }
.shortcut-upcoming-head { padding-bottom:8px; }
.shortcut-list { flex:1; min-height:0; overflow-y:auto; padding:0 6px 12px; }
.shortcut-empty { display:flex; flex-direction:column; gap:8px; padding:24px 14px; color:var(--awd-text-3); font-size:12px; text-align:center; line-height:1.7; }
.shortcut-overdue { display:block; width:calc(100% - 12px); margin:3px 6px 10px; text-align:start; padding:8px; background:var(--awd-danger-bg); color:var(--awd-danger-text); border-radius:var(--awd-radius-sm); font-size:12px; }
.shortcut-footer { flex:none; padding:10px 14px; border-top:1px solid var(--awd-border); color:var(--awd-text-3); font-size:11px; line-height:1.5; }
</style>
