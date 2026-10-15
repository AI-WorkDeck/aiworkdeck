<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="case-intake-panel">
    <SettingsSection
      class="panel-case-intake"
      :title="$t('account.caseIntakeTitle')"
      :description="$t('account.caseIntakeSubtitle')"
    >
      <template #actions>
        <view class="intake-top-actions">
          <button class="intake-btn primary" @tap="openNewIntakeForm">
            {{ $t('account.caseIntakeNewBtn') }}
          </button>
          <button class="intake-btn" :disabled="busy" @tap="onSeedDemoData">
            {{ $t('account.caseIntakeSeedBtn') }}
          </button>
          <button class="intake-btn" :disabled="busy" @tap="onOpenPluginInWorkbench">
            {{ $t('account.caseIntakeOpenPluginBtn') }}
          </button>
        </view>
      </template>

      <!-- 顶部子视图切换胶囊 -->
      <view class="intake-subnav">
        <view
          class="subnav-pill"
          :class="{ active: activeSubView === 'progress' }"
          @tap="activeSubView = 'progress'"
        >
          <text>{{ $t('account.caseIntakeSubProgress') }}</text>
          <text v-if="intakes.length" class="subnav-count">{{ intakes.length }}</text>
        </view>
        <view
          class="subnav-pill"
          :class="{ active: activeSubView === 'clearance' }"
          @tap="activeSubView = 'clearance'"
        >
          <text>{{ $t('account.caseIntakeSubClearance') }}</text>
          <text v-if="pendingClearanceBadgeCount > 0" class="subnav-count warn">
            {{ pendingClearanceBadgeCount }}
          </text>
        </view>
        <view
          class="subnav-pill"
          :class="{ active: activeSubView === 'finance' }"
          @tap="activeSubView = 'finance'"
        >
          <text>{{ $t('account.caseIntakeSubFinance') }}</text>
        </view>
      </view>

      <!-- 子视图 1：我的收案与利冲进展 -->
      <view v-if="activeSubView === 'progress'" class="subview-body">
        <!-- 可展开/折叠：新建收案与利冲预检表单 -->
        <view class="intake-form-card">
          <view class="form-card-head" @tap="showIntakeForm = !showIntakeForm">
            <text class="form-card-title">{{ $t('account.caseIntakeFormTitle') }}</text>
            <text class="form-card-toggle">
              {{ showIntakeForm ? $t('account.caseIntakeCollapse') : $t('account.caseIntakeExpand') }}
            </text>
          </view>

          <view v-if="showIntakeForm" class="form-card-body">
            <view class="form-grid">
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldTitle') }}</text>
                <input
                  v-model="intakeForm.title"
                  class="field-input"
                  :placeholder="$t('account.caseFieldTitlePh')"
                />
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldPracticeArea') }}</text>
                <input
                  v-model="intakeForm.practiceArea"
                  class="field-input"
                  :placeholder="$t('account.caseFieldPracticeAreaPh')"
                />
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldDepartment') }}</text>
                <input
                  v-model="intakeForm.departmentName"
                  class="field-input"
                  :placeholder="$t('account.caseFieldDepartmentPh')"
                />
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldLeadLawyer') }}</text>
                <input
                  v-model="intakeForm.leadLawyerName"
                  class="field-input"
                  :placeholder="$t('account.caseFieldLeadLawyerPh')"
                />
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldClient') }}</text>
                <input
                  v-model="intakeForm.clientName"
                  class="field-input"
                  :placeholder="$t('account.caseFieldClientPh')"
                />
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldCounterparty') }}</text>
                <input
                  v-model="intakeForm.counterpartyName"
                  class="field-input"
                  :placeholder="$t('account.caseFieldCounterpartyPh')"
                />
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldRelatedParty') }}</text>
                <input
                  v-model="intakeForm.relatedPartyName"
                  class="field-input"
                  :placeholder="$t('account.caseFieldRelatedPartyPh')"
                />
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldFeeMode') }}</text>
                <view class="fee-mode-pills">
                  <text
                    v-for="m in feeModeOptions"
                    :key="m.value"
                    class="mode-pill"
                    :class="{ active: intakeForm.feeMode === m.value }"
                    @tap="intakeForm.feeMode = m.value"
                  >{{ m.label }}</text>
                </view>
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldContractAmountWan') }}</text>
                <input
                  v-model="intakeForm.contractAmountWan"
                  class="field-input"
                  type="digit"
                  placeholder="50"
                />
              </view>
              <view class="form-field">
                <text class="field-label">{{ $t('account.caseFieldContingencyRate') }}</text>
                <input
                  v-model="intakeForm.contingencyRatePercent"
                  class="field-input"
                  type="digit"
                  placeholder="15"
                />
              </view>
            </view>

            <view class="form-actions-row">
              <button class="intake-btn" :disabled="busy" @tap="onConflictPreview">
                {{ $t('account.casePreviewConflictBtn') }}
              </button>
              <button class="intake-btn primary" :disabled="busy" @tap="onSubmitIntake">
                {{ $t('account.caseSubmitIntakeBtn') }}
              </button>
            </view>

            <!-- 实时利冲预检结果提示框 -->
            <view
              v-if="previewResult"
              class="statutory-alert-box"
              :class="'risk-' + (previewResult.conflictLevel || 'GREEN').toLowerCase()"
            >
              <view class="alert-head">
                <text class="risk-badge" :class="'badge-' + (previewResult.conflictLevel || 'GREEN').toLowerCase()">
                  {{ conflictLevelLabel(previewResult.conflictLevel) }}
                </text>
                <text class="alert-summary">{{ previewResult.conflictSummary || previewResult.summary }}</text>
              </view>
              <view
                v-for="(hit, idx) in (previewResult.hits || previewResult.conflictHits || [])"
                :key="'phit-' + idx"
                class="alert-hit-row"
              >
                <text class="hit-rule">{{ hit.statutoryCitation || hit.ruleCitation || '《全国律协执业行为规范》第51/52条' }}</text>
                <text class="hit-desc">{{ hit.description || hit.ruleTitle || hit.matchedMatterTitle || hit.conflictingMatterTitle }}</text>
              </view>
              <text v-if="previewResult.feeComplianceWarning" class="fee-warning-line">
                {{ previewResult.feeComplianceWarning }}
              </text>
            </view>
          </view>
        </view>

        <!-- 案件利冲进展卡片列表 -->
        <view v-if="loading" class="empty-state">
          <text>{{ $t('account.loadingEllipsis') }}</text>
        </view>
        <view v-else-if="!intakes.length" class="empty-state">
          <text>{{ $t('account.caseIntakeEmpty') }}</text>
        </view>
        <view v-else class="intake-cards-list">
          <view v-for="item in intakes" :key="item.id || item.intakeNo" class="intake-card">
            <view class="intake-card-head">
              <view class="intake-title-wrap">
                <text class="intake-no">{{ item.intakeNo || ('#' + item.id) }}</text>
                <text class="intake-title">· {{ item.title }}</text>
                <text v-if="item.practiceArea" class="practice-tag">{{ item.practiceArea }}</text>
              </view>
              <view class="intake-badges">
                <text
                  class="risk-badge"
                  :class="'badge-' + (item.conflictLevel || 'GREEN').toLowerCase()"
                >
                  {{ conflictLevelLabel(item.conflictLevel) }}
                </text>
                <text class="status-badge">{{ intakeStatusLabel(item.status) }}</text>
              </view>
            </view>

            <view class="intake-parties-line">
              <text>{{ $t('account.caseFieldClient') }}：{{ item.clientName || '—' }}</text>
              <text class="sep">|</text>
              <text>{{ $t('account.caseFieldCounterparty') }}：{{ item.counterpartyName || '—' }}</text>
              <text class="sep">|</text>
              <text>{{ $t('account.caseContractedLabel') }}：{{ formatAmountCents(item.contractAmountCents, item.contractAmountWan) }}</text>
              <text v-if="item.imConversationId" class="im-collab-badge">
                {{ $t('account.caseImBadge') }} · {{ item.imConversationId }}
              </text>
            </view>

            <!-- 律协规范提示与冲突详情 -->
            <view
              v-if="item.conflictSummary || (item.conflictHits && item.conflictHits.length) || item.feeComplianceWarning"
              class="statutory-alert-box"
              :class="'risk-' + (item.conflictLevel || 'GREEN').toLowerCase()"
            >
              <text v-if="item.conflictSummary" class="alert-summary">{{ item.conflictSummary }}</text>
              <view
                v-for="(hit, hIdx) in (item.conflictHits || item.hits || [])"
                :key="'hit-' + hIdx"
                class="alert-hit-row"
              >
                <text class="hit-rule">{{ hit.statutoryCitation || hit.ruleCitation || '《全国律协执业行为规范》第51/52条' }}</text>
                <text class="hit-desc">{{ hit.description || hit.ruleTitle || hit.matchedMatterTitle || hit.conflictingMatterTitle }}</text>
              </view>
              <text v-if="item.feeComplianceWarning" class="fee-warning-line">
                {{ item.feeComplianceWarning }}
              </text>
            </view>

            <!-- 五步利冲与立案进度条 -->
            <view class="progress-steps-bar">
              <view
                v-for="(step, sIdx) in resolveProgressSteps(item)"
                :key="step.key || sIdx"
                class="step-item"
                :class="'step-' + (step.state || 'pending')"
              >
                <view class="step-dot"></view>
                <view class="step-text-wrap">
                  <text class="step-label">{{ step.label }}</text>
                  <text v-if="step.detail" class="step-detail">{{ step.detail }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 子视图 2：利冲审查与协同放行 -->
      <view v-else-if="activeSubView === 'clearance'" class="subview-body">
        <!-- 待我放行的冲突案件征询 -->
        <view class="clearance-block">
          <text class="block-title">{{ $t('account.caseMyClearanceTitle') }}</text>
          <text class="block-desc">{{ $t('account.caseMyClearanceDesc') }}</text>
          <view v-if="!lawyerClearances.length" class="empty-state compact">
            <text>{{ $t('account.caseNoClearancePending') }}</text>
          </view>
          <view v-for="clr in lawyerClearances" :key="clr.id" class="clearance-card">
            <view class="clearance-head">
              <text class="clearance-title">
                {{ clr.intakeTitle || clr.title || ('收案 #' + clr.intakeId) }}
              </text>
              <text class="status-badge">{{ clr.decision || clr.status || 'PENDING' }}</text>
            </view>
            <text class="clearance-meta">
              {{ clr.ruleCitation || '《全国律协执业行为规范》第51/52条' }} ·
              {{ clr.conflictDescription || clr.conflictingMatterTitle || clr.reason || '' }}
            </text>
            <view class="clearance-action-bar">
              <input
                v-model="clearanceComments[clr.id]"
                class="field-input flex-fill"
                :placeholder="$t('account.caseClearanceCommentPh')"
              />
              <button
                class="intake-btn small primary"
                :disabled="busy"
                @tap="onRespondClearance(clr, 'APPROVED')"
              >{{ $t('account.caseApproveClearance') }}</button>
              <button
                class="intake-btn small"
                :disabled="busy"
                @tap="onRespondClearance(clr, 'APPROVED_WITH_WALL')"
              >{{ $t('account.caseApproveWithWall') }}</button>
              <button
                class="intake-btn small danger"
                :disabled="busy"
                @tap="onRespondClearance(clr, 'REJECTED')"
              >{{ $t('account.caseRejectClearance') }}</button>
            </view>
          </view>
        </view>

        <!-- 利冲委员会终审台 -->
        <view class="clearance-block">
          <text class="block-title">{{ $t('account.caseCommitteeTitle') }}</text>
          <text class="block-desc">{{ $t('account.caseCommitteeDesc') }}</text>
          <view v-if="!committeeQueue.length" class="empty-state compact">
            <text>{{ $t('account.caseNoCommitteePending') }}</text>
          </view>
          <view v-for="cItem in committeeQueue" :key="cItem.id" class="clearance-card">
            <view class="clearance-head">
              <text class="clearance-title">{{ cItem.intakeNo }} · {{ cItem.title }}</text>
              <text class="status-badge">
                {{ $t('account.caseClearanceProgress', { approved: cItem.clearedCount || 0, total: cItem.requiredClearanceCount || 1 }) }}
              </text>
            </view>
            <text class="clearance-meta">{{ cItem.conflictSummary }}</text>
            <view class="committee-checks-row">
              <view
                class="check-pill"
                :class="{ checked: !!committeeWallFlags[cItem.id] }"
                @tap="toggleCommitteeWall(cItem.id)"
              >
                <text>{{ committeeWallFlags[cItem.id] ? '✓ ' : '' }}{{ $t('account.caseEnableInfoWall') }}</text>
              </view>
              <view
                class="check-pill"
                :class="{ checked: !!committeeWaiverFlags[cItem.id] }"
                @tap="toggleCommitteeWaiver(cItem.id)"
              >
                <text>{{ committeeWaiverFlags[cItem.id] ? '✓ ' : '' }}{{ $t('account.caseWaiverUploaded') }}</text>
              </view>
              <button
                class="intake-btn small primary"
                :disabled="busy"
                @tap="onCommitteeReview(cItem, 'APPROVE_AND_FILE')"
              >{{ $t('account.caseCommitteeApproveBtn') }}</button>
              <button
                class="intake-btn small danger"
                :disabled="busy"
                @tap="onCommitteeReview(cItem, 'REJECT')"
              >{{ $t('account.caseCommitteeRejectBtn') }}</button>
            </view>
          </view>
        </view>
      </view>

      <!-- 子视图 3：发票申请与收费台账 -->
      <view v-else-if="activeSubView === 'finance'" class="subview-body">
        <view class="finance-summary-strip">
          <view class="fin-stat">
            <text class="fin-val">{{ formatCentsYuan(financeKpi.totalContractedCents) }}</text>
            <text class="fin-lbl">{{ $t('account.caseFinContracted') }}</text>
          </view>
          <view class="fin-stat">
            <text class="fin-val">{{ formatCentsYuan(financeKpi.totalBilledCents) }}</text>
            <text class="fin-lbl">{{ $t('account.caseFinBilled') }}</text>
          </view>
          <view class="fin-stat">
            <text class="fin-val">{{ formatCentsYuan(financeKpi.totalCollectedCents) }}</text>
            <text class="fin-lbl">{{ $t('account.caseFinCollected') }}</text>
          </view>
          <view class="fin-stat">
            <text class="fin-val">{{ formatPercent(financeKpi.billedCollectionRatePercent) }}</text>
            <text class="fin-lbl">{{ $t('account.caseFinCollectionRate') }}</text>
          </view>
        </view>

        <view class="finance-forms-grid">
          <!-- 开具发票申请 -->
          <view class="intake-form-card">
            <view class="form-card-head">
              <text class="form-card-title">{{ $t('account.caseInvoiceFormTitle') }}</text>
            </view>
            <view class="form-card-body">
              <input
                v-model="invoiceForm.matterTitle"
                class="field-input"
                :placeholder="$t('account.caseInvoiceMatterPh')"
              />
              <input
                v-model="invoiceForm.payerTitle"
                class="field-input"
                :placeholder="$t('account.caseInvoiceTitlePh')"
              />
              <input
                v-model="invoiceForm.taxNo"
                class="field-input"
                :placeholder="$t('account.caseInvoiceTaxNoPh')"
              />
              <input
                v-model="invoiceForm.amountWan"
                class="field-input"
                type="digit"
                :placeholder="$t('account.caseInvoiceAmountWanPh')"
              />
              <button class="intake-btn primary" :disabled="busy" @tap="onSubmitInvoice">
                {{ $t('account.caseSubmitInvoiceBtn') }}
              </button>
            </view>
          </view>

          <!-- 手动登记实收回款与财务同步 -->
          <view class="intake-form-card">
            <view class="form-card-head">
              <text class="form-card-title">{{ $t('account.caseCollectionFormTitle') }}</text>
            </view>
            <view class="form-card-body">
              <input
                v-model="collectionForm.matterTitle"
                class="field-input"
                :placeholder="$t('account.caseInvoiceMatterPh')"
              />
              <input
                v-model="collectionForm.payerName"
                class="field-input"
                :placeholder="$t('account.caseCollectionPayerPh')"
              />
              <input
                v-model="collectionForm.amountWan"
                class="field-input"
                type="digit"
                :placeholder="$t('account.caseCollectionAmountWanPh')"
              />
              <input
                v-model="collectionForm.referenceNo"
                class="field-input"
                :placeholder="$t('account.caseCollectionRefPh')"
              />
              <view class="form-actions-row">
                <button class="intake-btn primary" :disabled="busy" @tap="onRecordCollection">
                  {{ $t('account.caseRecordCollectionBtn') }}
                </button>
                <button class="intake-btn" :disabled="busy" @tap="onSyncErp">
                  {{ $t('account.caseSyncErpBtn') }}
                </button>
                <button class="intake-btn" @tap="onExportFinanceCsv">
                  {{ $t('account.caseExportCsvBtn') }}
                </button>
              </view>
            </view>
          </view>
        </view>

        <!-- 发票与实收台账列表 -->
        <view class="clearance-block">
          <text class="block-title">{{ $t('account.caseFinanceLedgerTitle') }}</text>
          <view v-if="!invoices.length && !collections.length" class="empty-state compact">
            <text>{{ $t('account.noRecords') }}</text>
          </view>
          <view v-for="inv in invoices" :key="'inv-' + inv.id" class="ledger-row">
            <text class="ledger-badge">发票</text>
            <text class="ledger-main">{{ inv.invoiceNo || inv.invoiceNumber || ('INV-' + inv.id) }} · {{ inv.payerTitle || inv.buyerName || inv.matterTitle }}</text>
            <text class="ledger-amount">{{ formatAmountCents(inv.amountCents, inv.amountWan) }}</text>
            <text class="status-badge">{{ inv.status || 'ISSUED' }}</text>
            <button
              v-if="inv.status === 'PENDING_APPROVAL'"
              class="intake-btn"
              :disabled="busy"
              @tap="onIssueInvoice(inv)"
            >
              {{ $t('account.caseIssueInvoiceBtn') }}
            </button>
          </view>
          <view v-for="col in collections" :key="'col-' + col.id" class="ledger-row">
            <text class="ledger-badge collected">到账</text>
            <text class="ledger-main">{{ col.payerName || col.matterTitle }} · {{ col.referenceNo || col.paymentMethod || '银行转账' }}</text>
            <text class="ledger-amount">{{ formatAmountCents(col.amountCents, col.amountWan) }}</text>
            <text class="status-badge">{{ col.erpSyncStatus || 'MANUAL_RECORDED' }}</text>
          </view>
        </view>
      </view>
    </SettingsSection>
  </view>
</template>

<script>
import SettingsSection from '@/components/settings/SettingsSection.vue'
import {
  getLawFirmOverview,
  requestLawFirmAction,
  ensureLawFirmPlugin,
  getLawFirmFinanceCsvUrl,
} from '@/services/api.js'

const DEFAULT_STEP_LABELS = [
  '① 提交收案申请',
  '② 自动利冲检索',
  '③ 关联律师站内信放行',
  '④ 利冲委员终审',
  '⑤ 正式立案并建项',
]

export default {
  name: 'PersonalCaseIntakePanel',
  components: { SettingsSection },
  props: {
    projectId: { type: [String, Number], default: null },
  },
  data() {
    return {
      loading: false,
      busy: false,
      activeSubView: 'progress',
      showIntakeForm: true,
      overview: null,
      previewResult: null,
      intakeForm: {
        title: '',
        practiceArea: '商事争议解决',
        departmentName: '争议解决部',
        leadLawyerName: '',
        clientName: '',
        counterpartyName: '',
        relatedPartyName: '',
        feeMode: 'FIXED',
        contractAmountWan: '50',
        contingencyRatePercent: '0',
      },
      clearanceComments: {},
      committeeWallFlags: {},
      committeeWaiverFlags: {},
      invoiceForm: {
        matterTitle: '',
        payerTitle: '',
        taxNo: '',
        invoiceType: 'VAT_SPECIAL',
        amountWan: '',
      },
      collectionForm: {
        matterTitle: '',
        payerName: '',
        paymentMethod: 'BANK_TRANSFER',
        amountWan: '',
        referenceNo: '',
      },
    }
  },
  computed: {
    feeModeOptions() {
      return [
        { value: 'FIXED', label: this.$t('account.feeModeFixed') },
        { value: 'CONTINGENCY', label: this.$t('account.feeModeContingency') },
        { value: 'HOURLY', label: this.$t('account.feeModeHourly') },
        { value: 'HYBRID', label: this.$t('account.feeModeHybrid') },
      ]
    },
    intakes() {
      return (this.overview && Array.isArray(this.overview.intakes)) ? this.overview.intakes : []
    },
    lawyerClearances() {
      const list = (this.overview && Array.isArray(this.overview.clearances)) ? this.overview.clearances : []
      return list.filter(c => !c.role || c.role === 'CONFLICT_LAWYER' || c.clearanceType === 'CONFLICT_LAWYER')
    },
    committeeQueue() {
      return this.intakes.filter(i =>
        ['PENDING_LAWYER_CLEARANCE', 'PENDING_COMMITTEE_REVIEW'].includes(i.status)
      )
    },
    pendingClearanceBadgeCount() {
      const pendingLawyer = this.lawyerClearances.filter(c => !c.decision || c.decision === 'PENDING').length
      return pendingLawyer + this.committeeQueue.length
    },
    invoices() {
      return (this.overview && Array.isArray(this.overview.invoices)) ? this.overview.invoices : []
    },
    collections() {
      return (this.overview && Array.isArray(this.overview.collections)) ? this.overview.collections : []
    },
    financeKpi() {
      return (this.overview && this.overview.kpi) || {}
    },
  },
  mounted() {
    this.loadOverview()
  },
  methods: {
    unwrapData(res) {
      if (!res) return null
      if (res.data && typeof res.data === 'object') return res.data
      return res
    },
    async loadOverview() {
      this.loading = true
      try {
        const res = await getLawFirmOverview(this.projectId ? { projectId: this.projectId } : {})
        const data = this.unwrapData(res)
        if (data) this.overview = data
      } catch (e) {
        console.warn('[PersonalCaseIntakePanel] loadOverview failed:', e)
      } finally {
        this.loading = false
      }
    },
    openNewIntakeForm() {
      this.activeSubView = 'progress'
      this.showIntakeForm = true
    },
    conflictLevelLabel(level) {
      if (level === 'RED') return this.$t('account.conflictRed')
      if (level === 'YELLOW') return this.$t('account.conflictYellow')
      return this.$t('account.conflictGreen')
    },
    intakeStatusLabel(status) {
      const map = {
        APPROVED_FILED: this.$t('account.statusApprovedFiled'),
        FILED: this.$t('account.statusApprovedFiled'),
        PENDING_LAWYER_CLEARANCE: this.$t('account.statusPendingLawyer'),
        PENDING_COMMITTEE_REVIEW: this.$t('account.statusPendingCommittee'),
        REJECTED_CONFLICT: this.$t('account.statusRejectedConflict'),
        REJECTED: this.$t('account.statusRejectedConflict'),
      }
      return map[status] || status || '已提交'
    },
    resolveProgressSteps(item) {
      if (Array.isArray(item.progressSteps) && item.progressSteps.length) {
        return item.progressSteps
      }
      const status = item.status || ''
      const isFiled = status === 'APPROVED_FILED' || status === 'FILED'
      const isRejected = status === 'REJECTED_CONFLICT' || status === 'REJECTED'
      return DEFAULT_STEP_LABELS.map((label, idx) => {
        let state = 'pending'
        if (isFiled) {
          state = 'done'
        } else if (isRejected) {
          state = idx <= 1 ? 'done' : (idx === 2 ? 'error' : 'pending')
        } else if (status === 'PENDING_COMMITTEE_REVIEW') {
          state = idx < 3 ? 'done' : (idx === 3 ? 'active' : 'pending')
        } else if (status === 'PENDING_LAWYER_CLEARANCE') {
          state = idx < 2 ? 'done' : (idx === 2 ? 'active' : 'pending')
        } else if (idx === 0) {
          state = 'done'
        }
        return { key: 's' + (idx + 1), label, state }
      })
    },
    formatAmountCents(cents, wanFallback) {
      if (typeof cents === 'number' && Number.isFinite(cents)) {
        return '¥' + (cents / 1000000).toFixed(2) + '万'
      }
      if (wanFallback !== undefined && wanFallback !== null && wanFallback !== '') {
        return '¥' + Number(wanFallback).toFixed(2) + '万'
      }
      return '¥0.00万'
    },
    formatCentsYuan(cents) {
      const n = Number(cents || 0)
      return '¥' + (n / 1000000).toFixed(2) + '万'
    },
    formatPercent(val) {
      const n = Number(val || 0)
      return n.toFixed(1) + '%'
    },
    buildIntakePayload() {
      const wan = Number(this.intakeForm.contractAmountWan || 0)
      return {
        ...this.intakeForm,
        contractAmountWan: wan,
        contractAmountCents: Math.round(wan * 1000000),
        contingencyRatePercent: Number(this.intakeForm.contingencyRatePercent || 0),
      }
    },
    async onConflictPreview() {
      if (!this.intakeForm.clientName.trim() && !this.intakeForm.counterpartyName.trim()) {
        uni.showToast({ title: this.$t('account.caseNeedPartiesToast'), icon: 'none' })
        return
      }
      this.busy = true
      try {
        const res = await requestLawFirmAction('conflictPreview', this.buildIntakePayload(), this.projectId)
        this.previewResult = this.unwrapData(res)
      } catch (e) {
        uni.showToast({ title: e?.message || '预检失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    async onSubmitIntake() {
      if (!this.intakeForm.title.trim() || !this.intakeForm.clientName.trim()) {
        uni.showToast({ title: this.$t('account.caseNeedTitleAndClientToast'), icon: 'none' })
        return
      }
      this.busy = true
      try {
        const res = await requestLawFirmAction('submitIntake', this.buildIntakePayload(), this.projectId)
        const data = this.unwrapData(res)
        if (data && data.overview) {
          this.overview = data.overview
        } else {
          await this.loadOverview()
        }
        this.previewResult = null
        this.intakeForm.title = ''
        this.intakeForm.clientName = ''
        this.intakeForm.counterpartyName = ''
        this.intakeForm.relatedPartyName = ''
        uni.showToast({ title: this.$t('account.caseSubmitSuccessToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '提交失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    async onRespondClearance(clr, decision) {
      this.busy = true
      try {
        const comment = this.clearanceComments[clr.id] || ''
        const res = await requestLawFirmAction('respondClearance', {
          clearanceId: clr.id,
          intakeId: clr.intakeId,
          decision,
          comment,
        }, this.projectId)
        const data = this.unwrapData(res)
        if (data && data.overview) this.overview = data.overview
        else await this.loadOverview()
        uni.showToast({ title: this.$t('account.caseClearanceSavedToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '操作失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    toggleCommitteeWall(intakeId) {
      this.committeeWallFlags = {
        ...this.committeeWallFlags,
        [intakeId]: !this.committeeWallFlags[intakeId],
      }
    },
    toggleCommitteeWaiver(intakeId) {
      this.committeeWaiverFlags = {
        ...this.committeeWaiverFlags,
        [intakeId]: !this.committeeWaiverFlags[intakeId],
      }
    },
    async onCommitteeReview(intake, decision) {
      this.busy = true
      try {
        const res = await requestLawFirmAction('committeeReview', {
          intakeId: intake.id,
          decision,
          informationWallRequired: !!this.committeeWallFlags[intake.id],
          waiverLetterUploaded: !!this.committeeWaiverFlags[intake.id],
        }, this.projectId)
        const data = this.unwrapData(res)
        if (data && data.overview) this.overview = data.overview
        else await this.loadOverview()
        uni.showToast({ title: this.$t('account.caseCommitteeSavedToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '终审操作失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    async onSubmitInvoice() {
      if (!this.invoiceForm.payerTitle.trim() || !this.invoiceForm.amountWan) {
        uni.showToast({ title: this.$t('account.caseInvoiceRequiredToast'), icon: 'none' })
        return
      }
      this.busy = true
      try {
        const wan = Number(this.invoiceForm.amountWan || 0)
        const taxNo = (this.invoiceForm.taxNo || '').trim()
        const res = await requestLawFirmAction('submitInvoice', {
          ...this.invoiceForm,
          buyerName: this.invoiceForm.payerTitle.trim(),
          buyerTaxId: taxNo,
          invoiceType: taxNo ? this.invoiceForm.invoiceType : 'DIGITAL_NORMAL',
          amountWan: wan,
          amountCents: Math.round(wan * 1000000),
        }, this.projectId)
        const data = this.unwrapData(res)
        if (data && data.overview) this.overview = data.overview
        else await this.loadOverview()
        this.invoiceForm.payerTitle = ''
        this.invoiceForm.taxNo = ''
        this.invoiceForm.amountWan = ''
        uni.showToast({ title: this.$t('account.caseInvoiceSubmittedToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '提交发票失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    async onIssueInvoice(inv) {
      if (!inv || !inv.id) return
      this.busy = true
      try {
        const res = await requestLawFirmAction('issueInvoice', {
          invoiceId: inv.id,
          invoiceNumber: '261120000000' + String(10000000 + Number(inv.id || 1)),
        }, this.projectId)
        const data = this.unwrapData(res)
        if (data && data.overview) this.overview = data.overview
        else await this.loadOverview()
        uni.showToast({ title: this.$t('account.caseInvoiceIssuedToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '开具发票失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    async onRecordCollection() {
      if (!this.collectionForm.amountWan) {
        uni.showToast({ title: this.$t('account.caseCollectionRequiredToast'), icon: 'none' })
        return
      }
      this.busy = true
      try {
        const wan = Number(this.collectionForm.amountWan || 0)
        const res = await requestLawFirmAction('recordCollection', {
          ...this.collectionForm,
          amountWan: wan,
          amountCents: Math.round(wan * 1000000),
        }, this.projectId)
        const data = this.unwrapData(res)
        if (data && data.overview) this.overview = data.overview
        else await this.loadOverview()
        this.collectionForm.amountWan = ''
        this.collectionForm.referenceNo = ''
        uni.showToast({ title: this.$t('account.caseCollectionSavedToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '登记收款失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    async onSyncErp() {
      this.busy = true
      try {
        const res = await requestLawFirmAction('syncErp', { provider: 'YONYOU_KINGDEE' }, this.projectId)
        const data = this.unwrapData(res)
        if (data && data.overview) this.overview = data.overview
        else await this.loadOverview()
        uni.showToast({ title: this.$t('account.caseErpSyncedToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '财务同步失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    async onExportFinanceCsv() {
      try {
        const res = await requestLawFirmAction('exportCsv', {}, this.projectId)
        const data = this.unwrapData(res)
        if (data && data.csvContent && typeof window !== 'undefined' && window.document && window.Blob) {
          const blob = new window.Blob(['\ufeff' + data.csvContent], { type: 'text/csv;charset=utf-8;' })
          const url = window.URL.createObjectURL(blob)
          const a = window.document.createElement('a')
          a.href = url
          a.download = data.fileName || 'lawfirm-finance-ledger.csv'
          window.document.body.appendChild(a)
          a.click()
          window.document.body.removeChild(a)
          setTimeout(() => window.URL.revokeObjectURL(url), 10000)
          return
        }
      } catch (e) {
        // fallback to direct URL below
      }
      const url = getLawFirmFinanceCsvUrl()
      if (typeof window !== 'undefined' && window.document) {
        const a = window.document.createElement('a')
        a.href = url
        a.download = 'lawfirm-finance-ledger.csv'
        window.document.body.appendChild(a)
        a.click()
        window.document.body.removeChild(a)
      }
    },
    async onSeedDemoData() {
      this.busy = true
      try {
        const res = await requestLawFirmAction('seedDemoData', {}, this.projectId)
        const data = this.unwrapData(res)
        if (data && (data.overview || data.intakes || data.dashboard)) this.overview = data.overview || data
        else await this.loadOverview()
        uni.showToast({ title: this.$t('account.caseDemoSeededToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '加载演示数据失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    async onOpenPluginInWorkbench() {
      this.busy = true
      try {
        await ensureLawFirmPlugin()
        uni.$emit('awd:market-changed')
        uni.$emit('awd:open-lawfirm-plugin')
        uni.showToast({ title: this.$t('account.casePluginOpenedToast'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e?.message || '打开插件失败', icon: 'none' })
      } finally {
        this.busy = false
      }
    },
  },
}
</script>

<style scoped>
.case-intake-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.intake-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.intake-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 12px;
  margin: 0;
  font-size: 12.5px;
  color: var(--awd-text);
  background: var(--awd-surface-2);
  border: 1px solid var(--awd-border);
  border-radius: 6px;
  cursor: pointer;
}

.intake-btn.primary {
  color: var(--awd-text-on-accent, #fff);
  background: var(--awd-accent);
  border-color: var(--awd-accent);
}

.intake-btn.small {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}

.intake-btn.danger {
  color: var(--awd-danger-text, #b42318);
  border-color: var(--awd-danger-text, #b42318);
  background: transparent;
}

.intake-subnav {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.subnav-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12.5px;
  color: var(--awd-text-2);
  background: var(--awd-bg);
  border: 1px solid var(--awd-border);
  border-radius: 999px;
  cursor: pointer;
}

.subnav-pill.active {
  color: var(--awd-accent-text);
  border-color: var(--awd-accent);
  background: var(--awd-accent-wash);
  font-weight: 600;
}

.subnav-count {
  padding: 1px 6px;
  font-size: 11px;
  border-radius: 999px;
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
}

.subnav-count.warn {
  background: var(--awd-danger-text, #b42318);
  color: #fff;
}

.subview-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.intake-form-card {
  background: var(--awd-bg);
  border: 1px solid var(--awd-border);
  border-radius: 8px;
  overflow: hidden;
}

.form-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--awd-surface);
  border-bottom: 1px solid var(--awd-border-subtle);
  cursor: pointer;
}

.form-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--awd-text);
}

.form-card-toggle {
  font-size: 12px;
  color: var(--awd-accent-text);
}

.form-card-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 11.5px;
  color: var(--awd-text-2);
}

.field-input {
  height: 32px;
  padding: 0 10px;
  font-size: 12.5px;
  color: var(--awd-text);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: 6px;
  box-sizing: border-box;
}

.flex-fill {
  flex: 1 1 180px;
}

.fee-mode-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mode-pill {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--awd-text-2);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: 4px;
  cursor: pointer;
}

.mode-pill.active {
  color: var(--awd-accent-text);
  border-color: var(--awd-accent);
  background: var(--awd-accent-wash);
}

.form-actions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.statutory-alert-box {
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--awd-border);
  background: var(--awd-surface);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.statutory-alert-box.risk-red {
  border-left: 3px solid var(--awd-danger-text, #b42318);
}

.statutory-alert-box.risk-yellow {
  border-left: 3px solid #b54708;
}

.statutory-alert-box.risk-green {
  border-left: 3px solid var(--awd-mint, #2e5a50);
}

.alert-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.alert-summary {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--awd-text);
}

.alert-hit-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}

.hit-rule {
  font-weight: 600;
  color: var(--awd-accent-text);
}

.hit-desc {
  color: var(--awd-text-2);
}

.fee-warning-line {
  font-size: 12px;
  color: var(--awd-danger-text, #b42318);
}

.intake-cards-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.intake-card {
  padding: 12px 14px;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.intake-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.intake-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.intake-no {
  font-size: 12px;
  font-weight: 600;
  color: var(--awd-accent-text);
}

.intake-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--awd-text);
}

.practice-tag {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 999px;
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
}

.intake-badges {
  display: flex;
  align-items: center;
  gap: 6px;
}

.risk-badge {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
}

.risk-badge.badge-red {
  color: var(--awd-danger-text, #b42318);
  background: rgba(180, 35, 24, 0.1);
}

.risk-badge.badge-yellow {
  color: #b54708;
  background: rgba(181, 71, 8, 0.12);
}

.risk-badge.badge-green {
  color: var(--awd-accent-text);
  background: var(--awd-accent-wash);
}

.status-badge {
  padding: 2px 8px;
  font-size: 11px;
  color: var(--awd-text-2);
  background: var(--awd-bg);
  border: 1px solid var(--awd-border-subtle);
  border-radius: 4px;
}

.intake-parties-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--awd-text-2);
}

.sep {
  color: var(--awd-border);
}

.im-collab-badge {
  padding: 1px 8px;
  font-size: 11px;
  color: var(--awd-accent-text);
  background: var(--awd-accent-wash);
  border-radius: 999px;
}

.progress-steps-bar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--awd-border-subtle);
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--awd-bg);
  border: 1px solid var(--awd-border-subtle);
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
  background: var(--awd-text-3);
}

.step-item.step-done {
  border-color: var(--awd-accent);
  background: var(--awd-accent-wash);
}

.step-item.step-done .step-dot {
  background: var(--awd-accent);
}

.step-item.step-active {
  border-color: #b54708;
}

.step-item.step-active .step-dot {
  background: #b54708;
}

.step-item.step-error,
.step-item.step-rejected {
  border-color: var(--awd-danger-text, #b42318);
}

.step-item.step-error .step-dot,
.step-item.step-rejected .step-dot {
  background: var(--awd-danger-text, #b42318);
}

.step-text-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.step-label {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--awd-text);
}

.step-detail {
  font-size: 10.5px;
  color: var(--awd-text-3);
}

.clearance-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: var(--awd-bg);
  border: 1px solid var(--awd-border);
  border-radius: 8px;
}

.block-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--awd-text);
}

.block-desc {
  font-size: 12px;
  color: var(--awd-text-2);
}

.clearance-card {
  padding: 10px 12px;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border-subtle);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.clearance-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.clearance-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--awd-text);
}

.clearance-meta {
  font-size: 12px;
  color: var(--awd-text-2);
}

.clearance-action-bar,
.committee-checks-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.check-pill {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--awd-text-2);
  background: var(--awd-bg);
  border: 1px solid var(--awd-border);
  border-radius: 4px;
  cursor: pointer;
}

.check-pill.checked {
  color: var(--awd-accent-text);
  border-color: var(--awd-accent);
  background: var(--awd-accent-wash);
}

.finance-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.fin-stat {
  padding: 10px 12px;
  background: var(--awd-bg);
  border-left: 3px solid var(--awd-accent);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fin-val {
  font-size: 15px;
  font-weight: 600;
  color: var(--awd-accent-text);
}

.fin-lbl {
  font-size: 11px;
  color: var(--awd-text-2);
}

.finance-forms-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.ledger-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border-subtle);
  border-radius: 6px;
}

.ledger-badge {
  padding: 2px 6px;
  font-size: 11px;
  border-radius: 4px;
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
}

.ledger-badge.collected {
  background: var(--awd-accent-wash);
  color: var(--awd-accent-text);
}

.ledger-main {
  flex: 1;
  font-size: 12.5px;
  color: var(--awd-text);
}

.ledger-amount {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--awd-accent-text);
}

.empty-state {
  padding: 24px;
  text-align: center;
  font-size: 12.5px;
  color: var(--awd-text-3);
}

.empty-state.compact {
  padding: 12px;
}
</style>
