<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  「工作记录 › 计费工时」：律师不另填工时表。把工作记录（活动记录器按文件/网页会话写入、
  已扣空闲、带项目）按「项目 × 日」汇总成草稿工时，在这里改描述、改时长、标是否可收费，
  或手动补录，再提交给合伙人审核。审核、出账单在律所管理插件「计时收费」里做。
  数据走 /api/lawfirm/action 的 time* 动作（后端 LawFirmBillingService），只在桌面端本机台账可用。
-->
<template>
  <view class="te">
    <view class="awd-set-note info te-hint">
      <text>{{ $t('account.teHint') }}</text>
    </view>
    <view v-if="unavailable" class="awd-set-note">{{ unavailable }}</view>
    <template v-else>
      <view class="te-toolbar">
        <button class="awd-set-btn-primary" :disabled="busy" @tap="importFromWorkLog">{{ $t('account.teImportBtn') }}</button>
        <button class="awd-set-btn-secondary" :disabled="busy" @tap="toggleAdd">{{ $t('account.teAddBtn') }}</button>
        <button class="awd-set-btn-secondary" :disabled="busy || !selectedIds.length" @tap="submitSelected">
          {{ $t('account.teSubmitBtn', { count: selectedIds.length }) }}
        </button>
        <text class="te-summary">{{ summaryText }}</text>
      </view>
      <view v-if="status" class="te-status">{{ status }}</view>

      <view v-if="adding" class="te-add">
        <AwdSelect class="te-add-target" :range="targetLabels" :value="addForm.targetIndex" :aria-label="$t('account.teColMatter')"
          :empty-text="$t('account.teNoTargets')" @change="i => (addForm.targetIndex = i)" />
        <picker mode="date" :value="addForm.workDate" :end="today" @change="e => (addForm.workDate = e.detail.value)">
          <view class="awd-set-input te-add-date">{{ addForm.workDate }}</view>
        </picker>
        <input class="awd-set-input te-add-hours" v-model="addForm.hours" type="digit" :placeholder="$t('account.teHoursPlaceholder')" />
        <input class="awd-set-input te-add-desc" v-model="addForm.description" :placeholder="$t('account.teDescPlaceholder')" />
        <label class="te-check"><checkbox :checked="addForm.billable" @tap="addForm.billable = !addForm.billable" />{{ $t('account.teBillable') }}</label>
        <button class="awd-set-btn-primary" :disabled="busy" @tap="addManual">{{ $t('account.teAddConfirm') }}</button>
      </view>

      <view class="te-table">
        <view class="te-row te-head">
          <text class="tc tc-sel"></text>
          <text class="tc tc-date">{{ $t('account.teColDate') }}</text>
          <text class="tc tc-matter">{{ $t('account.teColMatter') }}</text>
          <text class="tc tc-hours">{{ $t('account.teColHours') }}</text>
          <text class="tc tc-desc">{{ $t('account.teColDesc') }}</text>
          <text class="tc tc-bill">{{ $t('account.teColBillable') }}</text>
          <text class="tc tc-status">{{ $t('account.teColStatus') }}</text>
          <text class="tc tc-ops"></text>
        </view>
        <view v-if="loading" class="te-empty">{{ $t('account.loadingEllipsis') }}</view>
        <view v-else-if="!rows.length" class="te-empty">{{ $t('account.teEmpty') }}</view>
        <view v-for="r in rows" v-else :key="r.id" class="te-row" :data-entry-id="r.id">
          <view class="tc tc-sel">
            <checkbox v-if="r.editable" :checked="selected[r.id]" @tap="toggleSelect(r.id)" />
          </view>
          <text class="tc tc-date">{{ r.workDate }}</text>
          <view class="tc tc-matter">
            <text class="te-strong">{{ r.matterTitle || r.projectName || '-' }}</text>
            <text class="te-sub">{{ r.clientName || (r.intakeId ? '' : $t('account.teNoMatter')) }}</text>
          </view>
          <view class="tc tc-hours">
            <input v-if="r.editable" class="awd-set-input te-cell-input" v-model="edits[r.id].hours" type="digit" />
            <text v-else>{{ hours(r.minutes) }}</text>
            <text class="te-sub">{{ sourceText(r) }}</text>
          </view>
          <view class="tc tc-desc">
            <input v-if="r.editable" class="awd-set-input te-cell-input" v-model="edits[r.id].description" />
            <text v-else class="te-desc-text" :title="r.description">{{ r.description }}</text>
            <text v-for="(a, i) in r.reviewNotes" :key="i" class="te-sub te-review">{{ a }}</text>
          </view>
          <view class="tc tc-bill">
            <checkbox v-if="r.editable" :checked="edits[r.id].billable" @tap="edits[r.id].billable = !edits[r.id].billable" />
            <text v-else>{{ r.billable ? $t('account.teYes') : $t('account.teNo') }}</text>
          </view>
          <view class="tc tc-status"><text class="awd-set-pill" :class="statusClass(r.status)">{{ statusText(r.status) }}</text></view>
          <view class="tc tc-ops">
            <button v-if="r.editable && isDirty(r)" class="awd-set-btn-secondary" :disabled="busy" @tap="saveRow(r)">{{ $t('account.teSave') }}</button>
            <button v-if="r.editable" class="awd-set-btn-danger-text" :disabled="busy" @tap="removeRow(r)">{{ $t('account.teDelete') }}</button>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script>
import { requestLawFirmAction } from '@/services/api.js'
import AwdSelect from '@/components/AwdSelect.vue'

const STATUS_KEYS = {
  DRAFT: 'teStatusDraft',
  SUBMITTED: 'teStatusSubmitted',
  RETURNED: 'teStatusReturned',
  APPROVED: 'teStatusApproved',
  BILLED: 'teStatusBilled',
}

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default {
  name: 'WorkLogTimeEntries',
  components: { AwdSelect },
  props: {
    from: { type: String, required: true },
    to: { type: String, required: true },
  },
  data() {
    const today = localDate(new Date())
    return {
      today,
      loading: false,
      busy: false,
      unavailable: '',
      status: '',
      entries: [],
      targets: [],
      edits: {},
      selected: {},
      adding: false,
      addForm: { targetIndex: 0, workDate: today, hours: '', description: '', billable: true },
    }
  },
  computed: {
    rows() {
      return this.entries.map(e => ({
        ...e,
        editable: e.status === 'DRAFT' || e.status === 'RETURNED',
        reviewNotes: this.reviewNotes(e),
      }))
    },
    selectedIds() {
      return this.rows.filter(r => r.editable && this.selected[r.id]).map(r => r.id)
    },
    targetLabels() {
      return this.targets.map(t => (t.clientName ? `${t.label}（${t.clientName}）` : t.label))
    },
    summaryText() {
      const sum = s => this.entries.filter(e => s.includes(e.status)).reduce((n, e) => n + (e.minutes || 0), 0)
      return this.$t('account.teSummary', {
        draft: this.hours(sum(['DRAFT', 'RETURNED'])),
        submitted: this.hours(sum(['SUBMITTED'])),
        approved: this.hours(sum(['APPROVED', 'BILLED'])),
      })
    },
  },
  watch: {
    from() { this.load() },
    to() { this.load() },
  },
  mounted() {
    this.load()
  },
  methods: {
    hours(minutes) {
      // 分钟是整数，÷60 后最多两位小数即可精确表达 6 分钟单位与手填的两位小数
      return String(Number(((minutes || 0) / 60).toFixed(2)))
    },
    sourceText(r) {
      if (r.source === 'WORK_RECORD') return this.$t('account.teSourceWorkLog', { hours: this.hours(r.capturedMinutes) })
      return this.$t('account.teSourceManual')
    },
    statusText(s) {
      return STATUS_KEYS[s] ? this.$t('account.' + STATUS_KEYS[s]) : s
    },
    statusClass(s) {
      if (s === 'APPROVED' || s === 'BILLED') return 'ok'
      if (s === 'RETURNED') return 'warn'
      return ''
    },
    // 合伙人的审核结论给律师看：退回理由、核减后的时长、不收费
    reviewNotes(e) {
      const notes = []
      for (const a of e.audit || []) {
        const who = a.actorName || ''
        const reason = a.reason ? this.$t('account.teReasonSuffix', { reason: a.reason }) : ''
        if (a.action === 'RETURN') notes.push(this.$t('account.teNoteReturned', { who }) + reason)
        else if (a.action === 'WRITE_DOWN' || a.action === 'WRITE_DOWN_EDIT') {
          notes.push(this.$t('account.teNoteWrittenDown', { who, hours: this.hours(a.detail?.billedMinutes?.to) }) + reason)
        } else if (a.action === 'NO_CHARGE') notes.push(this.$t('account.teNoteNoCharge', { who }) + reason)
        else if (a.action === 'EDIT') notes.push(this.$t('account.teNoteEdited', { who }))
      }
      return notes
    },
    resetEdits() {
      const edits = {}
      for (const e of this.entries) {
        edits[e.id] = { hours: this.hours(e.minutes), description: e.description || '', billable: e.billable !== false }
      }
      this.edits = edits
    },
    isDirty(r) {
      const ed = this.edits[r.id]
      return !!ed && (ed.hours !== this.hours(r.minutes) || ed.description !== (r.description || '') || ed.billable !== (r.billable !== false))
    },
    unwrap(res) {
      return res && res.data && typeof res.data === 'object' ? res.data : res
    },
    apply(data) {
      this.entries = data.entries || []
      this.targets = data.targets || this.targets
      this.resetEdits()
      const alive = new Set(this.entries.map(e => e.id))
      for (const id of Object.keys(this.selected)) if (!alive.has(Number(id))) delete this.selected[id]
    },
    async call(action, params) {
      return this.unwrap(await requestLawFirmAction(action, params))
    },
    async load() {
      this.loading = true
      try {
        this.apply(await this.call('timeMine', { from: this.from, to: this.to }))
        this.unavailable = ''
      } catch (e) {
        this.unavailable = e?.message || this.$t('account.teLoadFailed')
      } finally {
        this.loading = false
      }
    },
    async run(fn) {
      this.busy = true
      this.status = ''
      try {
        await fn()
      } catch (e) {
        this.status = e?.message || this.$t('account.teActionFailed')
      } finally {
        this.busy = false
      }
    },
    importFromWorkLog() {
      return this.run(async () => {
        const data = await this.call('timeImport', { from: this.from, to: this.to })
        this.apply(data)
        this.status = this.$t('account.teImported', { created: data.created || 0, updated: data.updated || 0, kept: data.kept || 0 })
      })
    },
    toggleAdd() {
      this.adding = !this.adding
    },
    addManual() {
      return this.run(async () => {
        const target = this.targets[this.addForm.targetIndex]
        if (!target) throw new Error(this.$t('account.teNoTargets'))
        await this.call('timeSave', {
          target: target.key,
          workDate: this.addForm.workDate,
          hours: this.addForm.hours,
          description: this.addForm.description,
          billable: this.addForm.billable,
        })
        this.addForm.hours = ''
        this.addForm.description = ''
        await this.load()
        this.status = this.$t('account.teAdded')
      })
    },
    saveRow(r) {
      return this.run(async () => {
        const ed = this.edits[r.id]
        await this.call('timeSave', { id: r.id, hours: ed.hours, description: ed.description, billable: ed.billable })
        await this.load()
        this.status = this.$t('account.teSaved')
      })
    },
    removeRow(r) {
      return this.run(async () => {
        await this.call('timeDelete', { id: r.id })
        await this.load()
        this.status = this.$t('account.teDeleted')
      })
    },
    toggleSelect(id) {
      this.selected = { ...this.selected, [id]: !this.selected[id] }
    },
    submitSelected() {
      return this.run(async () => {
        const dirty = this.rows.filter(r => this.selectedIds.includes(r.id) && this.isDirty(r))
        if (dirty.length) throw new Error(this.$t('account.teSaveFirst'))
        const data = await this.call('timeSubmit', { ids: this.selectedIds })
        this.selected = {}
        await this.load()
        this.status = this.$t('account.teSubmitted', { count: data.submitted || 0 })
      })
    },
  },
}
</script>

<style lang="scss" scoped>
@import '@/components/settings/settings.scss';

.te { display: block; }
.te-hint { margin-bottom: var(--awd-space-2); }
.te-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--awd-space-2);
  margin-bottom: var(--awd-space-2);
}
.te-summary {
  margin-inline-start: auto;
  font-size: var(--awd-panel-fs-sec);
  color: var(--awd-text-2);
}
.te-status {
  margin-bottom: var(--awd-space-2);
  font-size: var(--awd-panel-fs-sec);
  color: var(--awd-text-2);
}
.te-add {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--awd-space-2);
  padding: var(--awd-space-2);
  margin-bottom: var(--awd-space-2);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
}
.te-add-target { min-width: 220px; flex: 1 1 220px; }
.te-add-date { line-height: 28px; font-variant-numeric: tabular-nums; }
.te-add-hours { width: 80px; }
.te-add-desc { flex: 2 1 240px; }
.te-check { display: inline-flex; align-items: center; gap: 4px; font-size: var(--awd-panel-fs); }

.te-table {
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  overflow-x: auto;
}
.te-row {
  display: flex;
  align-items: flex-start;
  min-width: 900px;
  padding: 6px 0;
  border-bottom: 1px solid var(--awd-border-subtle);
  font-size: var(--awd-panel-fs);
  color: var(--awd-text);
  &:last-child { border-bottom: none; }
}
.te-head {
  background: var(--awd-bg);
  font-size: var(--awd-panel-fs-sec);
  font-weight: 600;
  color: var(--awd-text-2);
}
.tc {
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tc-sel { width: 36px; }
.tc-date { width: 96px; font-variant-numeric: tabular-nums; }
.tc-matter { width: 180px; }
.tc-hours { width: 110px; }
.tc-desc { flex: 1 1 220px; min-width: 220px; }
.tc-bill { width: 70px; }
.tc-status { width: 90px; }
.tc-ops { width: 120px; flex-direction: row; gap: 4px; }
.te-strong { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.te-sub { font-size: var(--awd-panel-fs-sec); color: var(--awd-text-3); }
.te-review { color: var(--awd-warning-text); }
.te-desc-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.te-cell-input { width: 100%; box-sizing: border-box; }
.te-empty {
  padding: 32px;
  text-align: center;
  color: var(--awd-text-3);
}
</style>
