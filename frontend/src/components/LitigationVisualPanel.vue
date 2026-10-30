<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <!-- Vue 3 多根节点：与 DdFilesPanel / ShareholderMeetingPanel 同构 -->

  <!-- 面板标题由外壳的 sidebar-header 统一出，这里不再自画一份（重复两次的老毛病） -->

  <!-- 原生资源包（native pack）状态条：skill 已启用（面板打得开=已启用）但资源
       还没就绪时显示；ready 或没有 packId（旧后端/自检失败）都不渲染一个字节。
       见 docs/NATIVE_PACK_DISTRIBUTION.md §5/§7.1。 -->
  <view class="lv-pack-bar" :class="{ failed: litPackStatus && litPackStatus.state === 'failed' }" v-if="showPackBar">
    <text class="lv-pack-text">{{ packBarText }}</text>
    <view
      v-if="canInstallPack"
      class="lv-pack-retry"
      :class="{ disabled: litPackRetrying }"
      @tap="retryPackInstall"
    >
      <text>{{ litPackRetrying ? $t('panels.litPackRetrying') : $t(litPackStatus.state === 'not_installed' ? 'market.install' : 'common.retry') }}</text>
    </view>
  </view>

  <!-- 环境降级提示。graphviz 缺失只挡流程图一种布局，不能说成整体不可用 -->
  <view class="lv-notice" v-if="status && !status.available">
    <text class="lv-notice-text">{{ status.reason }}</text>
  </view>
  <view class="lv-notice subtle" v-else-if="status && !status.graphviz">
    <text class="lv-notice-text">{{ $t('panels.litNoGraphvizNotice') }}</text>
  </view>
  <view class="lv-notice" v-if="status && status.available && status.timelineAvailable === false">
    <text class="lv-notice-text">{{ $t('panels.litTimelineNeedsUpdate') }}</text>
    <view class="lv-link" :class="{ disabled: litPackRetrying || (showPackBar && litPackStatus.state !== 'failed') }" @tap="updateTimelinePack">
      <text>{{ $t('panels.litUpdatePack') }}</text>
    </view>
  </view>

  <!-- 出图 -->
  <view class="lv-sec-head">
    <text class="lv-sec-title">{{ $t('panels.litNewDiagramSectionTitle') }}</text>
  </view>
  <view class="lv-sec-body">
    <component :is="'button'" type="button" class="lv-field lv-native-button" :disabled="generationLocked" @click.stop="pickScope">
      <text class="lv-field-label">{{ $t('panels.litScopeLabel') }}</text>
      <text class="lv-field-value" :class="{ placeholder: !scopeLabel }">
        {{ scopeLabel || $t('panels.litScopeDefault') }}
      </text>
      <text class="lv-field-caret">›</text>
    </component>

    <view class="lv-kinds">
      <component :is="'button'" type="button"
        v-for="k in KINDS"
        :key="k.value"
        class="lv-kind lv-native-button"
        :class="{ active: diagramHint === k.value }"
        :aria-pressed="diagramHint === k.value"
        :disabled="generationLocked"
        @click.stop="selectKind(k.value)"
      >{{ k.label }}</component>
    </view>
    <text class="lv-tip">{{ $t('panels.litKindTip') }}</text>

    <component :is="'button'" type="button" class="lv-btn primary lv-native-button" :disabled="generationLocked" @click.stop="start">
      {{ generationStartLabel }}
    </component>

    <view v-if="generation.phase !== 'idle'" class="lv-generation" :class="{ failed: generation.phase === 'failed' }" :aria-busy="generationBusy">
      <view class="lv-generation-status" role="status" aria-live="polite">
        <text class="lv-generation-title">{{ generationPhaseLabel }}</text>
        <text v-if="generation.message" class="lv-generation-message">{{ generation.message }}</text>
      </view>
      <text v-if="generationBusy && generation.startedAt" class="lv-generation-meta">{{ $t('panels.litGenerationElapsed', { seconds: generationElapsed }) }}</text>
      <text v-if="generationBusy && generationElapsed >= 45" class="lv-generation-meta">{{ $t('panels.litGenerationSlow') }}</text>
      <text v-if="generationBusy" class="lv-generation-meta">{{ $t('panels.litGenerationBackground') }}</text>

      <view v-if="generation.phase === 'waiting' && generation.question" class="lv-question">
        <text class="lv-question-text">{{ generation.question.text }}</text>
        <view class="lv-question-options" role="group" :aria-label="generation.question.text">
          <component :is="'button'" v-for="(option, index) in generation.question.options || []" :key="index" type="button"
            class="lv-question-option lv-native-button" :class="{ selected: generationSelected.includes(option) }"
            :aria-pressed="generationSelected.includes(option)" :disabled="starting" @click.stop="selectAnswer(option)">
            <text>{{ option }}</text>
            <text v-if="generation.question.descriptions && generation.question.descriptions[index]" class="lv-option-description">{{ generation.question.descriptions[index] }}</text>
          </component>
        </view>
        <component :is="'textarea'" class="lv-answer-input" :value="generationOther" :disabled="starting" maxlength="4000" rows="3"
          :aria-label="$t('panels.litGenerationOther')" :placeholder="$t('panels.litGenerationOther')" @input="generationOther = $event.target.value" />
        <component :is="'button'" type="button" class="lv-btn primary lv-native-button" :disabled="starting || !canAnswerGeneration" @click.stop="answerGeneration">
          {{ $t('panels.litGenerationAnswer') }}
        </component>
      </view>
      <component :is="'button'" v-if="generation.phase === 'paused'" type="button" class="lv-btn primary lv-native-button" :disabled="starting" @click.stop="continueGeneration">
        {{ $t('panels.litGenerationContinue') }}
      </component>
      <component :is="'button'" v-if="generationActive && generation.phase !== 'stopping'" type="button" class="lv-generation-stop lv-native-button" :disabled="starting" @click.stop="stopGeneration">
        {{ $t('panels.litGenerationStop') }}
      </component>
    </view>
    <view v-if="generationError || generationSyncError" class="lv-generation-error" role="alert">
      <text>{{ generationError || generationSyncError }}</text>
      <component :is="'button'" v-if="generationSyncError" type="button" class="lv-generation-stop lv-native-button" :disabled="generationLoading" @click.stop="refreshGeneration">
        {{ $t('panels.litGenerationRefresh') }}
      </component>
    </view>
  </view>

  <!-- 图廊 -->
  <view class="lv-sec-head">
    <text class="lv-sec-title">{{ $t('panels.litGalleryLabel') }}</text>
    <text class="lv-sec-count">{{ diagrams.length }}</text>
    <view class="lv-sec-spacer"></view>
    <view class="lv-sec-action" @tap="reload" :title="$t('panels.litRefresh')">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        <path d="M21 3v6h-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </view>
  </view>

  <view class="lv-empty" v-if="!loading && diagrams.length === 0">
    <text class="lv-empty-text">{{ $t('panels.litEmptyText') }}</text>
  </view>

  <!-- 行式列表（对齐插件广场的 msb-row 密度）：整行点开，动作只在悬停时露出 -->
  <view v-for="d in diagrams" :key="d.folderId" class="lv-row">
    <view class="lv-row-head" @tap="openDiagram(d)">
      <view class="lv-row-main">
        <text class="lv-row-name">{{ d.name }}</text>
        <text class="lv-row-meta">
          {{ layoutLabel(d.layout) }}<template v-if="d.mode"> · {{ modeLabel(d.mode) }}</template
          ><template v-if="d.formats && d.formats.length"> · {{ d.formats.join(' ') }}</template>
        </text>
      </view>
      <text class="lv-badge draft" v-if="d.draft">{{ $t('panels.litDraftBadge') }}</text>
      <text class="lv-badge edited" v-else-if="d.handEdited">{{ $t('panels.litHandEditedBadge') }}</text>
    </view>

    <view class="lv-row-actions">
      <!-- 整行点开已经是「可编辑版」（.drawio）。这里留的是只读母版那条路：
           打印、核对，以及内嵌 draw.io 起不来时的退路。没有 .drawio 的老图
           整行点开本来就是母版，这个入口就没必要重复出现。 -->
      <text class="lv-link" v-if="d.drawioFileId && d.svgFileId" @tap.stop="openMaster(d)">{{ $t('panels.litViewMaster') }}</text>
      <!-- 换风格是三选一而不是三个并列按钮：它们互斥，摆成一排等权按钮会把
           「打开/编辑」这两个真正的主动作挤到第二行去。
           没有语义地图的图（时间轴大师管线的产物）换不了风格——后端要拿
           .map.json 重画，没有就只会报错，入口干脆不出现。 -->
      <template v-if="d.mapFileId">
        <text class="lv-restyle-label">{{ $t('panels.litRestyleLabel') }}</text>
        <view class="lv-modes">
          <text
            v-for="m in MODES"
            :key="m"
            class="lv-mode"
            :class="{ active: d.mode === m, disabled: restylingId === d.folderId }"
            @tap.stop="restyle(d, m)"
          >{{ modeLabel(m) }}</text>
        </view>
      </template>
    </view>
  </view>

  <!-- MIT 许可要求保留版权声明：出图引擎 vendor 自 mqc-litigation-visual-redraw，见 litviz/UPSTREAM.md -->
  <view class="lv-credit">
    <text class="lv-credit-text">{{ $t('panels.litCreditText') }}</text>
  </view>
</template>

<script>
import {
  getLitigationVisualStatus,
  getLitigationDiagrams,
  restyleLitigationDiagram,
  packStatus,
  packInstall
} from '@/services/api.js'
import { t } from '@/i18n'

// 这个面板只服务诉讼可视化一个功能，资源包 id 与 skill id 同名，见 skill.yml 的 requires_pack
const PACK_ID = 'litigation-visual'

// 与引擎的三种视觉模式一一对应（litviz/engine/references/visual-style.md）
const MODES = ['奇川风', '歸藏风', '白描']

// 面板只给"用户会用自己的话说出来"的图种。七种布局里 comparison_table
// 不单列——它是关系族的 A/B 变体，用户想要时在对话里说就行，
// 摆在这里会让这排按钮看起来像一份需要先学习的分类表。
// value 是发给服务端拼 prompt 的触发词（必须原样中文，不翻译）；label 是面板按钮展示文案
const KINDS = [
  { value: '事实经过时间轴', get label() { return t('panels.litKindTimeline') } },
  { value: '诉讼时效/保证期间甘特图', get label() { return t('panels.litKindPeriod') } },
  { value: '案件流程图', get label() { return t('panels.litKindFlowchart') } },
  { value: '当事人法律关系图', get label() { return t('panels.litKindRelation') } },
  { value: '股权控制结构树', get label() { return t('panels.litKindEquity') } }
]

// key 为引擎输出的布局标识符（数据，不翻译），value 走 i18n 键名（下方 layoutLabel() 里取值）
const LAYOUT_LABEL_KEYS = {
  numbered_point_timeline: 'litLayoutNumberedTimeline',
  dated_point_timeline: 'litLayoutDatedTimeline',
  proportional_gantt: 'litLayoutGantt',
  graphviz_flow: 'litLayoutFlow',
  graphviz_relation: 'litLayoutRelation',
  relation_tree: 'litLayoutTree',
  comparison_table: 'litLayoutComparison'
}

export default {
  name: 'LitigationVisualPanel',
  props: {
    projectId: { type: [String, Number], default: null },
    generationRequest: { type: Function, default: null }
  },
  emits: ['open-file', 'request-scope-select'],
  data() {
    return {
      MODES,
      KINDS,
      status: null,
      diagrams: [],
      loading: false,
      starting: false,
      generation: { phase: 'idle' },
      generationLoading: true,
      generationError: '',
      generationSyncError: '',
      generationSelected: [],
      generationOther: '',
      generationTimer: null,
      generationEpoch: 0,
      generationRevision: 0,
      generationAlive: false,
      generationNow: Date.now(),
      generationSubmission: null,
      restylingId: null,
      diagramHint: '',
      scope: null,            // { label, description } —— 由父页面的文件选择器回填
      // 原生资源包状态条：见 docs/NATIVE_PACK_DISTRIBUTION.md §5/§7.1
      litPackStatus: null,   // packStatus() 结果 {state, bytesDownloaded, bytesTotal, error}；null=未知/无 pack
      litPackTimer: null,
      litPackRetrying: false
    }
  },
  computed: {
    generationActive() {
      return ['starting', 'running', 'waiting', 'checking', 'stopping', 'paused'].includes(this.generation.phase)
    },
    generationBusy() {
      return ['starting', 'running', 'checking', 'stopping'].includes(this.generation.phase)
    },
    generationLocked() {
      return this.starting || this.generationLoading || !!this.generationSyncError || this.generationActive
    },
    generationElapsed() {
      return Math.max(0, Math.floor((this.generationNow - Number(this.generation.startedAt || this.generationNow)) / 1000))
    },
    generationPhaseLabel() {
      return this.$t('panels.litGenerationPhase' + this.generation.phase[0].toUpperCase() + this.generation.phase.slice(1))
    },
    generationStartLabel() {
      if (this.starting) return this.$t('panels.litStarting')
      if (this.generationLoading) return this.$t('panels.litGenerationLoading')
      if (this.generationActive) return this.$t('panels.litGenerationInProgress')
      return this.$t(this.generation.phase === 'failed' || this.generationError ? 'panels.litGenerationRetry' : 'panels.litStart')
    },
    canAnswerGeneration() {
      return this.generationSelected.length > 0 || this.generationOther.trim().length > 0
    },
    scopeLabel() {
      return this.scope ? this.scope.label : ''
    },
    showPackBar() {
      return !!this.litPackStatus && this.litPackStatus.state !== 'ready'
    },
    canInstallPack() {
      return !!this.litPackStatus && ['not_installed', 'failed'].includes(this.litPackStatus.state)
    },
    packBarText() {
      const s = this.litPackStatus
      if (!s) return ''
      if (s.state === 'not_installed') return this.$t('panels.litPackNotInstalled')
      if (s.state === 'revoked') return this.$t('panels.litPackRevoked')
      if (s.state === 'failed') return s.error || this.$t('panels.litPackFailedText')
      const total = s.bytesTotal || 0
      if (total > 0) {
        return this.$t('panels.litPackDownloadingProgress', {
          downloaded: ((s.bytesDownloaded || 0) / (1024 * 1024)).toFixed(1),
          total: (total / (1024 * 1024)).toFixed(1)
        })
      }
      return this.$t('panels.litPackDownloading')
    }
  },
  watch: {
    projectId: {
      immediate: true,
      handler() {
        this.generationEpoch++
        this.generation = { phase: 'idle' }
        this.generationSubmission = null
        this.generationError = ''
        this.generationSyncError = ''
        this.generationLoading = true
        this.starting = false
        this.scope = null
        this.reload()
        if (this.generationAlive) this.refreshGeneration()
      }
    }
  },
  mounted() {
    uni.$on('awd:litviz-restyled', this.onDiagramChanged)
    // 换风格事件只覆盖「已有图被重画」这一种情形。AI 出新图落盘后后端发 refresh_files，
    // 本面板显示时左栏互斥链里 FileTree 没挂载，由 agentClientActions.js 替它补发
    // 'awd:files-changed'（树挂着时则由 FileTree.loadFiles() 发）。画廊靠它才知道该重拉，
    // 不然计数永远停在第一张（dev-board BUG-21）。
    uni.$on('awd:files-changed', this.onFilesChanged)
    this.refreshPackStatus()
    this.generationAlive = true
    this.refreshGeneration()
    this.generationTimer = setInterval(() => {
      this.generationNow = Date.now()
      this.refreshGeneration()
    }, 1000)
  },
  beforeUnmount() {
    uni.$off('awd:litviz-restyled', this.onDiagramChanged)
    uni.$off('awd:files-changed', this.onFilesChanged)
    this.stopPackPoll()
    this.generationAlive = false
    this.generationEpoch++
    if (this.generationTimer) clearInterval(this.generationTimer)
  },
  methods: {
    // ---- 原生资源包（native pack）状态条 ----
    async refreshPackStatus() {
      const previousState = this.litPackStatus && this.litPackStatus.state
      try {
        const res = await packStatus(PACK_ID)
        this.litPackStatus = (res && res.status) || null
      } catch (e) {
        // 拉不到状态：旧后端没有这个端点，或本机压根没有这个 pack——按「不渲染」处理
        this.litPackStatus = null
        this.stopPackPoll()
        return
      }
      const state = this.litPackStatus && this.litPackStatus.state
      if (['ready', 'failed', 'not_installed', 'revoked'].includes(state)) {
        this.stopPackPoll()
        if (state === 'ready' && previousState && previousState !== 'ready') await this.reload()
      } else if (state && !this.litPackTimer) {
        this.startPackPoll()
      }
    },
    startPackPoll() {
      this.stopPackPoll()
      this.litPackTimer = setInterval(() => { this.refreshPackStatus() }, 1000)
    },
    stopPackPoll() {
      if (this.litPackTimer) { clearInterval(this.litPackTimer); this.litPackTimer = null }
    },
    async retryPackInstall() {
      if (this.litPackRetrying || this.litPackStatus?.state === 'revoked') return
      this.litPackRetrying = true
      try {
        await packInstall(PACK_ID)
        await this.refreshPackStatus()
        if (this.litPackStatus && this.litPackStatus.state === 'ready') await this.reload()
      } catch (e) {
        uni.showToast({ title: (e && e.message) || this.$t('panels.litPackRetryFailedFallback'), icon: 'none' })
      } finally {
        this.litPackRetrying = false
      }
    },
    async updateTimelinePack() {
      if (this.litPackRetrying || (this.showPackBar && this.litPackStatus.state !== 'failed')) return
      await this.retryPackInstall()
    },
    layoutLabel(layout) {
      const key = LAYOUT_LABEL_KEYS[layout]
      return key ? this.$t(`panels.${key}`) : this.$t('panels.litLayoutFallback')
    },

    modeLabel(mode) {
      const map = {
        '奇川风': 'panels.litModeQichuan',
        '歸藏风': 'panels.litModeGuizang',
        '白描': 'panels.litModeLineArt'
      }
      return map[mode] ? this.$t(map[mode]) : mode
    },

    async reload() {
      if (!this.projectId) return
      this.loading = true
      try {
        // 两件事互不依赖，环境自检慢一点不该拖住图廊
        const [st, list] = await Promise.all([
          getLitigationVisualStatus().catch(() => null),
          getLitigationDiagrams(this.projectId).catch(() => [])
        ])
        this.status = st
        this.diagrams = Array.isArray(list) ? list : []
      } finally {
        this.loading = false
      }
    },

    pickScope() {
      if (this.generationLocked) return
      const epoch = this.generationEpoch
      this.$emit('request-scope-select', (picked) => {
        if (epoch === this.generationEpoch && !this.generationLocked) this.scope = picked
      })
    },

    selectKind(value) {
      if (!this.generationLocked) this.diagramHint = this.diagramHint === value ? '' : value
    },

    applyGeneration(snapshot) {
      if (!snapshot || !snapshot.phase) throw new Error(this.$t('panels.litGenerationInvalid'))
      const previous = this.generation
      if (previous.taskId !== snapshot.taskId || previous.question?.key !== snapshot.question?.key) {
        this.generationSelected = []
        this.generationOther = ''
      }
      this.generation = snapshot
      this.generationNow = Date.now()
      if (snapshot.phase === 'completed' && (previous.taskId !== snapshot.taskId || previous.phase !== 'completed')) this.reload()
    },

    async refreshGeneration() {
      if (!this.generationAlive || !this.projectId || this.starting || this._generationRefreshing) return
      const epoch = this.generationEpoch
      const revision = this.generationRevision
      this._generationRefreshing = true
      try {
        if (!this.generationRequest) throw new Error(this.$t('panels.litGenerationUnavailable'))
        const snapshot = await this.generationRequest('generation', {})
        if (!this.generationAlive || epoch !== this.generationEpoch || revision !== this.generationRevision) return
        this.applyGeneration(snapshot)
        this.generationSyncError = ''
      } catch (e) {
        if (this.generationAlive && epoch === this.generationEpoch && revision === this.generationRevision) this.generationSyncError = e?.message || this.$t('panels.litGenerationSyncFailed')
      } finally {
        this._generationRefreshing = false
        if (epoch === this.generationEpoch) this.generationLoading = false
      }
    },

    async generationCommand(operation, params) {
      if (this.starting) return
      const epoch = this.generationEpoch
      this.generationRevision++
      this.starting = true
      this.generationError = ''
      try {
        if (!this.generationRequest) throw new Error(this.$t('panels.litGenerationUnavailable'))
        const snapshot = await this.generationRequest(operation, params)
        if (this.generationAlive && epoch === this.generationEpoch) this.applyGeneration(snapshot)
      } catch (e) {
        if (this.generationAlive && epoch === this.generationEpoch) this.generationError = e?.message || this.$t('panels.litStartFailedFallback')
      } finally {
        if (epoch === this.generationEpoch) this.starting = false
      }
    },

    async start() {
      if (this.generationLocked || !this.projectId) return
      if (this.status && !this.status.available) {
        this.generationError = this.status.reason || this.$t('panels.litUnavailableFallback')
        return
      }
      const input = { scope: this.scope ? this.scope.description : '', diagramHint: this.diagramHint }
      const signature = JSON.stringify(input)
      if (!this.generationSubmission || this.generationSubmission.signature !== signature
          || (['completed', 'cancelled'].includes(this.generation.phase) && this.generationSubmission.fromTaskId !== this.generation.taskId)) {
        const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        this.generationSubmission = { signature, fromTaskId: this.generation.taskId, clientRequestId: 'litviz-' + id }
      }
      await this.generationCommand('generate', { ...input, clientRequestId: this.generationSubmission.clientRequestId })
    },

    selectAnswer(option) {
      if (this.starting || this.generation.phase !== 'waiting') return
      if (this.generation.question.multiSelect) {
        this.generationSelected = this.generationSelected.includes(option)
          ? this.generationSelected.filter(value => value !== option) : [...this.generationSelected, option]
      } else {
        this.generationSelected = this.generationSelected.includes(option) ? [] : [option]
      }
    },

    async answerGeneration() {
      if (this.starting || this.generation.phase !== 'waiting' || !this.canAnswerGeneration) return
      await this.generationCommand('answer', {
        taskId: this.generation.taskId,
        questionKey: this.generation.question.key,
        answer: { selected: [...this.generationSelected], other: this.generationOther.trim() }
      })
    },

    async stopGeneration() {
      if (!this.generationActive || this.generation.phase === 'stopping') return
      await this.generationCommand('stop', { taskId: this.generation.taskId })
    },

    async continueGeneration() {
      if (this.generation.phase !== 'paused') return
      await this.generationCommand('continue', { taskId: this.generation.taskId })
    },

    // 整行点开 = 打开可继续编辑的那份（.drawio，走内嵌 draw.io）。
    // 律师拿到图后的下一个动作多半是"这里挪一下、那个字改一下"，落在只读的 SVG 上
    // 就得先自己去文件树里翻可编辑版。没有 .drawio（老图/只出了 svg）时退回母版。
    openDiagram(d) {
      if (!d) return
      const fileId = d.drawioFileId || d.svgFileId
      if (!fileId) return
      this.$emit('open-file', { fileId, name: d.name })
    },

    // 只读母版（.svg）。仍留一个入口：打印、核对、以及 draw.io 起不来时的退路。
    openMaster(d) {
      if (!d || !d.svgFileId) return
      this.$emit('open-file', { fileId: d.svgFileId, name: d.name })
    },

    onDiagramChanged(event) {
      if (String(event.projectId) === String(this.projectId) && !event.failed) this.reload()
    },

    // 'awd:files-changed'：AI 出图（或任何文件树变更）落盘后的通用刷新信号
    onFilesChanged(event) {
      if (event && String(event.projectId) === String(this.projectId)) this.reload()
    },

    async restyle(d, mode) {
      if (this.restylingId) return
      // 地图无法反映当前画布；时间戳也不可靠，所以每次覆盖都需明确确认。
      const modeText = this.modeLabel(mode)
      const ok = await new Promise((resolve) => {
        uni.showModal({
          title: this.$t('panels.litHandEditedConfirmTitle'),
          content: this.$t('panels.litHandEditedConfirmBody', { mode: modeText }),
          confirmText: this.$t('panels.litContinueRedraw'),
          cancelText: this.$t('panels.litCancel'),
          success: (res) => resolve(!!res.confirm),
          fail: () => resolve(false)
        })
      })
      if (!ok) return
      this.restylingId = d.folderId
      uni.showLoading({ title: this.$t('panels.litRedrawing'), mask: true })
      try {
        const pendingSaves = []
        uni.$emit('awd:litviz-restyling', { projectId: this.projectId, folderId: d.folderId, pendingSaves })
        await Promise.all(pendingSaves)
        await restyleLitigationDiagram(this.projectId, d.folderId, mode, true)
        // 图变了但文件 ID 没变，已打开的标签要重新拉一次
        uni.$emit('awd:litviz-restyled', { projectId: this.projectId, folderId: d.folderId, svgFileId: d.svgFileId, kind: 'restyle' })
        uni.showToast({ title: this.$t('panels.litRestyledTo', { mode: modeText }), icon: 'none' })
      } catch (e) {
        uni.$emit('awd:litviz-restyled', { projectId: this.projectId, folderId: d.folderId, kind: 'restyle', failed: true })
        uni.showToast({ title: (e && e.message) || this.$t('panels.litRedrawFailedFallback'), icon: 'none' })
      } finally {
        uni.hideLoading()
        this.restylingId = null
      }
    }
  }
}
</script>

<style scoped>
/* 密度令牌见 App.vue 的 --awd-panel-*（基准 = 插件广场 MarketSidebarPanel）。
   这个面板此前是 12-14px 边距 + 每张图一个独立卡片，260px 宽的左栏里
   一张图就吃掉三行，五个动作按钮还要换行——现在改成行式列表。 */

.lv-notice {
  margin: var(--awd-panel-gap) var(--awd-panel-pad-x) 0;
  padding: 6px 8px;
  border-radius: var(--awd-panel-radius);
  background: var(--awd-danger-soft);
  border: 1px solid var(--awd-danger);
}
.lv-notice.subtle { background: var(--awd-bg); border-color: var(--awd-border); }
.lv-notice-text { font-size: var(--awd-panel-fs-meta); line-height: 1.55; color: var(--awd-text-2); }

/* 原生资源包状态条：常态是中性下载提示，失败态借用 .lv-notice 同一套暖红 */
.lv-pack-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px var(--awd-panel-pad-x);
  background: var(--awd-panel-hover);
  border-bottom: 1px solid var(--awd-panel-border);
}
.lv-pack-bar.failed { background: var(--awd-danger-soft); border-color: var(--awd-danger); }
.lv-pack-text {
  flex: 1;
  min-width: 0;
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-panel-text-2);
  line-height: 1.5;
}
.lv-pack-bar.failed .lv-pack-text { color: var(--awd-text-2); }
.lv-pack-retry {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--awd-panel-radius);
  background: var(--awd-panel-accent);
  cursor: pointer;
}
.lv-pack-retry text { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-on-accent); font-weight: 600; }
.lv-pack-retry.disabled { opacity: .5; pointer-events: none; }

/* 分组头：与插件广场同形（26px / 11px-700 / 计数徽章 / 右侧动作） */
.lv-sec-head {
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--awd-panel-sec-h);
  padding: 0 var(--awd-panel-pad-x);
  margin-top: 2px;
}
.lv-sec-title {
  font-size: var(--awd-panel-fs-sec);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--awd-panel-text-2);
}
.lv-sec-count {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-panel-text-3);
  background: var(--awd-panel-hover);
  border-radius: 999px;
  padding: 0 6px;
  line-height: 14px;
  margin-left: 2px;
}
.lv-sec-spacer { flex: 1; }
.lv-sec-action {
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  color: var(--awd-panel-text-3); cursor: pointer; border-radius: var(--awd-radius-sm);
}
.lv-sec-action:hover { background: var(--awd-panel-hover); color: var(--awd-panel-text); }
.lv-sec-action svg { width: 13px; height: 13px; }

.lv-sec-body {
  padding: 0 var(--awd-panel-pad-x) var(--awd-panel-gap-lg);
  border-bottom: 1px solid var(--awd-panel-border);
}

/* 「材料」收成一行：标签在左、值在右、末尾一个 ›，不再占两行 */
.lv-field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--awd-panel-row-h);
  padding: 4px 8px;
  border: 1px solid var(--awd-panel-border);
  border-radius: var(--awd-panel-radius);
  background: var(--awd-surface);
  cursor: pointer;
  margin-bottom: var(--awd-panel-gap);
}
.lv-field:hover { border-color: var(--awd-panel-accent-2); }
.lv-field-label { flex-shrink: 0; font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-3); }
.lv-field-value {
  flex: 1; min-width: 0; font-size: var(--awd-panel-fs); color: var(--awd-panel-text);
  line-height: 1.45; text-align: right;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.lv-field-value.placeholder { color: var(--awd-panel-text-4); }
.lv-field-caret { flex-shrink: 0; font-size: var(--awd-font-size-body); color: var(--awd-panel-text-4); line-height: 1; }

.lv-kinds { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.lv-kind {
  padding: 3px 8px; font-size: var(--awd-panel-fs-meta); border-radius: var(--awd-radius-sm); cursor: pointer;
  border: 1px solid var(--awd-panel-border); color: var(--awd-panel-text-2); background: var(--awd-surface);
}
.lv-kind:hover { border-color: var(--awd-border-strong); }
.lv-kind.active {
  border-color: var(--awd-panel-accent); color: var(--awd-panel-accent); background: var(--awd-accent-wash);
}
.lv-tip {
  display: block; font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-4);
  line-height: 1.5; margin-bottom: var(--awd-panel-gap);
}

.lv-btn {
  width: 100%; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  height: var(--awd-panel-row-h); font-size: var(--awd-panel-fs);
  border-radius: var(--awd-panel-radius); cursor: pointer; user-select: none;
}
.lv-btn.primary { background: var(--awd-panel-accent); color: var(--awd-text-on-accent); font-weight: 500; }
.lv-btn.primary:hover { background: var(--awd-accent-hover); }
.lv-btn.disabled, .lv-native-button:disabled { opacity: .5; cursor: default; }
.lv-native-button { appearance: none; font-family: inherit; line-height: inherit; margin: 0; }
.lv-native-button::after { border: 0; }
.lv-btn.lv-native-button, .lv-generation-stop { border: 0; }
.lv-field.lv-native-button { width: 100%; box-sizing: border-box; margin-bottom: var(--awd-panel-gap); }
.lv-native-button:focus-visible, .lv-answer-input:focus-visible { outline: 2px solid var(--awd-panel-accent); outline-offset: 2px; }
.lv-generation { margin-top: var(--awd-panel-gap-lg); padding: var(--awd-panel-gap); border: 1px solid var(--awd-panel-border); border-radius: var(--awd-panel-radius); background: var(--awd-surface); }
.lv-generation.failed { border-color: var(--awd-danger); }
.lv-generation-title, .lv-generation-message, .lv-generation-meta, .lv-question-text, .lv-option-description { display: block; line-height: 1.55; overflow-wrap: anywhere; }
.lv-generation-title { font-size: var(--awd-panel-fs); font-weight: 600; color: var(--awd-panel-text); }
.lv-generation-message, .lv-question-text { margin-top: 4px; white-space: pre-wrap; font-size: var(--awd-panel-fs); color: var(--awd-panel-text-2); }
.lv-generation-meta, .lv-option-description { margin-top: 4px; font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-3); }
.lv-question { margin-top: var(--awd-panel-gap); }
.lv-question-options { display: flex; flex-direction: column; gap: 4px; margin-top: var(--awd-panel-gap); }
.lv-question-option { width: 100%; box-sizing: border-box; padding: 6px 8px; text-align: left; border: 1px solid var(--awd-panel-border); border-radius: var(--awd-panel-radius); background: var(--awd-surface); color: var(--awd-panel-text); font-size: var(--awd-panel-fs); white-space: normal; overflow-wrap: anywhere; cursor: pointer; }
.lv-question-option.selected { border-color: var(--awd-panel-accent); background: var(--awd-accent-wash); }
.lv-question-option:hover:not(:disabled) { border-color: var(--awd-panel-accent); }
.lv-answer-input { display: block; box-sizing: border-box; width: 100%; margin: var(--awd-panel-gap) 0; padding: 6px 8px; min-height: 64px; resize: vertical; font: inherit; font-size: var(--awd-panel-fs); line-height: 1.55; color: var(--awd-panel-text); background: var(--awd-surface); border: 1px solid var(--awd-panel-border); border-radius: var(--awd-panel-radius); }
.lv-generation-stop { margin-top: var(--awd-panel-gap); padding: 4px 0; color: var(--awd-panel-accent); background: transparent; font-size: var(--awd-panel-fs); text-align: left; cursor: pointer; }
.lv-generation-error { margin-top: var(--awd-panel-gap); padding: 6px 8px; background: var(--awd-danger-soft); border: 1px solid var(--awd-danger); border-radius: var(--awd-panel-radius); font-size: var(--awd-panel-fs); line-height: 1.55; color: var(--awd-text); overflow-wrap: anywhere; }
.lv-generation-error text { display: block; }

.lv-empty { padding: 14px var(--awd-panel-pad-x); text-align: center; }
.lv-empty-text { font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-4); line-height: 1.6; }

/* 行式列表：整行可点＝打开；动作行悬停才浮起来，静态时只剩名字与元信息 */
.lv-row { padding: 4px var(--awd-panel-pad-x) 6px; }
.lv-row:hover { background: var(--awd-panel-accent-wash); }
.lv-row-head { display: flex; align-items: flex-start; gap: 6px; cursor: pointer; }
.lv-row-main { flex: 1; min-width: 0; }
.lv-row-name {
  display: block; font-size: var(--awd-panel-fs); color: var(--awd-panel-text); font-weight: 500;
  line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lv-row-meta {
  display: block; font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-4); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lv-badge {
  flex-shrink: 0; padding: 0 5px; font-size: var(--awd-panel-fs-meta); line-height: 15px; border-radius: var(--awd-radius-sm);
}
.lv-badge.edited { color: var(--awd-panel-accent); background: var(--awd-accent-soft); }
.lv-badge.draft { color: var(--awd-warning-text); background: var(--awd-warning-soft); }

.lv-row-actions {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
  margin-top: 3px; opacity: 0; transition: opacity 0.12s ease;
}
.lv-row:hover .lv-row-actions { opacity: 1; }
.lv-link {
  font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-accent); cursor: pointer; margin-right: 4px;
}
.lv-link:hover { text-decoration: underline; }
.lv-restyle-label { font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-4); }
.lv-modes { display: flex; gap: 0; border: 1px solid var(--awd-panel-border); border-radius: var(--awd-radius-sm); overflow: hidden; }
.lv-mode {
  padding: 1px 6px; font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-2); background: var(--awd-surface); cursor: pointer;
  border-right: 1px solid var(--awd-panel-border);
}
.lv-mode:last-child { border-right: none; }
.lv-mode:hover { background: var(--awd-panel-hover); }
.lv-mode.active { background: var(--awd-accent-soft); color: var(--awd-panel-accent); font-weight: 600; }
.lv-mode.disabled { opacity: .5; pointer-events: none; }

.lv-credit { padding: var(--awd-panel-gap-lg) var(--awd-panel-pad-x); }
.lv-credit-text { display: block; font-size: var(--awd-panel-fs-meta); color: var(--awd-text-3); text-align: center; line-height: 1.5; }
</style>
