<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="plugin-pane">
    <iframe
      v-if="url && (!isWebPlugin || authorizationReady)"
      :key="sessionGeneration"
      ref="pluginFrame"
      :src="url"
      :sandbox="sandboxAttr"
      class="plugin-iframe"
      frameborder="0"
      @load="onFrameLoad"
    ></iframe>
    <view v-else-if="url && isWebPlugin && !authorizationInvalid" class="plugin-error" role="status">
      <text>{{ $t('panels.ppVerifying') }}</text>
    </view>
    <view v-else class="plugin-error">
      <text>{{ $t(authorizationInvalid ? 'panels.ppAuthorizationChanged' : 'panels.ppLoadFailed') }}</text>
    </view>
  </view>
</template>

<script>
// 插件面板：承载 manifest.frontendEntry 指向的页面。两种形态，行为刻意不同。
//
// 1) 绝对 http(s) URL（旧形态）：iframe 直接打开，不加 sandbox、不发握手、不响应桥调用。
//    这类插件从来就是"内嵌一个外部网页"，改动它只会打断存量插件。
// 2) web/ 相对路径（规范 v2.3 的 Web 插件）：后端 /api/plugin-web/ 静态服务，
//    iframe 带 sandbox="allow-scripts allow-forms"，与宿主只通过 postMessage 桥通信。
//
// **sandbox 绝不能加 allow-same-origin。** iframe 一旦与应用同源，插件脚本就能读到
// localStorage 里的 X-Session-Id 并打全部 /api/*，等于把宿主的全部权限白送给插件；
// 没有它，iframe 是 opaque origin，除了这座桥没有第二条路。桥上每个方法都按
// manifest.permissions 逐调用校验——权限声明在这里第一次成为真实的执行边界
// （JAR 插件同 JVM 同权限，做不到这一点）。
//
// 桥协议（与 sdk/plugin-sdk/awd-plugin-sdk.js 及官网模板/宿主模拟器同一份契约，
// 三处任何一处单独改动都会让插件跑不起来）：
//   握手  宿主 -> 插件   { awd: 1, type: 'init', context: { pluginId, projectId, language, theme, themeTokens } }
//   请求  插件 -> 宿主   { awd: 1, type: 'call', seq, method, params }
//   响应  宿主 -> 插件   { awd: 1, type: 'result', seq, ok, result | error: { code, message } }
//   主题  宿主 -> 插件   { awd: 1, type: 'theme', theme, tokens }（v2.6，切换时推送；
//   老 SDK 不认识这个 type 会静默忽略，新 SDK 在老宿主上收不到推送则停在握手快照）
//   事件  宿主 -> 插件   { awd: 1, type: 'event', event, data }（v2.7，显式 events.subscribe 后才推送；
//   payload 刻意为空——事件是「该重拉了」的信号，数据由插件按各自权限闸拉取）
//
// v2.7 实验 API：x- 前缀方法只对本机 dev 免签直装的插件开放（devInstalled prop），
// 广场装的插件调用一律 experimental_not_allowed——运行时闸是真保证，受理扫描只是辅助。
import {
  getPlugins, getProjectFiles, getFileText, getAiConversations, invokePluginTool, pluginAiComplete, getPluginSettings, requestPluginIm,
  requestPluginLawFirm,
  createEvidenceLink, addEvidenceTargets, getEvidenceLink, listEvidenceLinks,
  getTeam, getProjectMembers, getCurrentUser, searchProjectContent, getProjectTags,
  getSensitiveOptions, previewSensitiveFile, desensitizeFile, restoreSensitiveFile,
  getLitigationVisualStatus, getLitigationDiagrams, getLitigationKickoffPrompt, restyleLitigationDiagram, packStatus, packInstall
} from '@/services/api.js'
import { host } from '@/services/host.js'
import { createPluginCollectionServices } from '@/utils/pluginCollectionServices.js'
import { subscribe as subscribeTaskChanges } from '@/utils/taskStore.js'
import { createPluginInsightServices } from '@/utils/pluginInsightServices.js'
import { createPluginVoiceServices } from '@/utils/pluginVoiceServices.js'
import { createPluginBusinessServices, clonePluginData } from '@/utils/pluginBusinessServices.js'
import { createPluginPlatformServices } from '@/utils/pluginPlatformServices.js'
import { PLUGIN_DOC_ACTIONS } from '@/config/pluginDocActions.js'
import { getAppLanguage } from '@/utils/appLanguage.js'
import { getResolvedTheme, collectThemeTokens, APP_THEME_EVENT } from '@/utils/appTheme.js'
import { resolveAnchor, toPluginLink, toTargetInputs } from '@/utils/pluginEvidence.js'
import { createEvidenceLinkForSelection } from '@/pages/project-overview/evidenceLinkCore.js'
import { WPS_INTERNAL_HTTP_LINK_BASE } from '@/config/workbenchActions.js'
import { preparePluginImDrag, endPluginImDrag } from '@/utils/pluginImDrag.js'
import { ACCOUNT_CHANGED_EVENT } from '@/utils/requireAccount.js'
import { loadImDirectory, addImFriend, removeImFriend } from '@/utils/imDirectory.js'

/** 桥协议版本 */
const PROTOCOL = 1

/** files.read 的文本上限，与 SDK 契约/官网宿主模拟器一致 */
const READ_LIMIT = 5 * 1024 * 1024

/** 插件级 KV 的总量上限（序列化后字节数近似），与 SDK 契约一致 */
const STORAGE_LIMIT = 64 * 1024

/** 插件级 KV 在宿主 localStorage 里的键前缀 */
const STORAGE_PREFIX = 'awd_plugin_kv_'

/** ai.request 的 prompt+system 合计字符上限（与后端 PluginController.AI_REQUEST_MAX_CHARS 一致） */
const AI_REQUEST_MAX_CHARS = 16000

/**
 * 事件通道（v2.7）：事件名 -> { permission: 订阅所需权限（null=不需要）, throttleMs: 转发合并窗口 }。
 * 未达权限的事件名在 subscribe 时静默剔除（回声集合里自然缺席），与老宿主 unknown_method 降级同一取向。
 */
const PLUGIN_EVENTS = {
  'speech.progress': { permission: 'speech', throttleMs: 100 },
  'calendar.changed': { permission: 'tasks', throttleMs: 300 },
  'favorites.changed': { permission: 'file_read', throttleMs: 300 },
  'clipboard.changed': { permission: 'clipboard', throttleMs: 300 },
  'files.changed': { permission: 'file_read', throttleMs: 500 },
  'selection.changed': { permission: 'editor', throttleMs: 300 },
  'project.switched': { permission: null, throttleMs: 0 },
  'account.changed': { permission: null, throttleMs: 0 },
  // v2.9：宿主设置表单保存后推送（只推给设置所属的插件，见 mounted 里的过滤）
  'settings.changed': { permission: null, throttleMs: 0 },
  'lawfirm.navigate': { permission: null, throttleMs: 0 },
  // 宿主左栏（PluginWorkspaceSummary）与中栏插件标签联动指令（如切换会话、发起私聊、打开对话框、切换视图）
  'sidebar.command': { permission: null, throttleMs: 0 }
}

// files.read 允许读取的扩展名。后端 /api/files/{id}/text 会对 docx/pdf 这类做文本抽取，
// 所以白名单不止纯文本；名单之外一律当二进制拒绝，避免把一份 zip 的字节当"内容"塞回插件。
const READABLE_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'html', 'htm',
  'yml', 'yaml', 'js', 'ts', 'css', 'sql', 'ini', 'conf', 'properties',
  'doc', 'docx', 'rtf', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx'
])

function extOf(name) {
  const dot = String(name || '').lastIndexOf('.')
  return dot < 0 ? '' : String(name).slice(dot + 1).toLowerCase()
}

export default {
  name: 'PluginPane',
  // chat.send 与 PluginGuidePane 的快捷按钮走同一条 kickoff 路：
  // prompt 作为可见的用户消息进入 AI 对话，用户随时可停，不存在静默注入
  emits: ['kickoff', 'files-changed'],
  props: {
    businessActions: { type: Object, default: () => ({}) },
    url: {
      type: String,
      default: ''
    },
    /** 插件 id（不是左栏的 plugin-<id> 面板 key）：进握手上下文，也是 KV 的分区键 */
    pluginId: {
      type: String,
      default: ''
    },
    /** manifest.permissions，桥按它逐调用裁剪能力 */
    permissions: {
      type: Array,
      default: () => []
    },
    /** 当前项目 id：files.* 的作用域，同时进握手上下文 */
    projectId: {
      type: [String, Number],
      default: ''
    },
    /**
     * 宿主注入的「当前聚焦的 Word 编辑器」适配器：() => { executor(action, params), fileId } | null。
     * evidence.link / evidence.locate 要打书签、跳书签，PluginPane 自己拿不到编辑器，
     * 与 VariablePanel 从 project-overview 拿 getEditor 适配器是同一做法。不给就是没有活动文档。
     */
    getActiveEditor: {
      type: Function,
      default: null
    },
    /** Add a verified project file to the visible AI composer without sending. */
    addFileToAi: {
      type: Function,
      default: null
    },
    /** 是否本机 dev 免签直装（后端按 .awd-dev 标记判定）：实验 API（x- 前缀方法）只对它开放 */
    devInstalled: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      // 会话代次：调用点没给 :key，同一个面板槽位换插件时组件被复用、iframe 只换 src，
      // 于是 A 发起的桥调用可能在 B 已经载入之后才 resolve。响应按 seq 匹配，而新插件的
      // 序号也从 1 起，投错窗口就是把 A 的数据（可能含 B 无权读的文件内容）兑现给 B。
      // 换插件时自增，回响应前比对，代次对不上就丢弃。
      sessionGeneration: 0,
      authorizationReady: false,
      authorizationInvalid: false
    }
  },
  watch: {
    permissions: { deep: true, handler() { this.disposeBusinessServices(); this.sessionGeneration++; this.resetEventChannel(); this.initializeAuthorization() } },
    url() {
      this.disposeBusinessServices()
      this.sessionGeneration++
      this.clearPreparedDrag()
      this.resetEventChannel()
      this.initializeAuthorization()
    },
    pluginId() {
      this.disposeBusinessServices()
      this.sessionGeneration++
      this.clearPreparedDrag()
      this.resetEventChannel()
      this.initializeAuthorization()
    },
    // 当前架构下切项目走 uni.reLaunch 整页重建，本 watch 极少触发；
    // 语义为未来面板持久化预留（规范 v2.7 事件表），触发了就如实推送
    projectId(val) {
      this.disposeBusinessServices()
      this.sessionGeneration++
      this.clearPreparedDrag()
      this.forwardEvent('project.switched', { projectId: val == null ? '' : String(val) })
      this.initializeAuthorization()
    }
  },
  computed: {
    // 只有走 /api/plugin-web/ 的 Web 插件才 sandbox + 握手。
    // 绑定 null 会让 Vue 移除该属性，绝对 URL 形态因此与改造前逐字节一致。
    isWebPlugin() {
      return String(this.url || '').indexOf('/api/plugin-web/') >= 0
    },
    sandboxAttr() {
      return this.isWebPlugin ? 'allow-scripts allow-forms' : null
    }
  },
  created() {
    // 事件通道状态（v2.7）：刻意不进 data——不驱动渲染，Set/定时器也不适合响应式代理
    this._subscribedEvents = new Set()
    this._eventTimers = {}
    this._pendingSidebarCommand = null
  },
  mounted() {
    this.initializeAuthorization()
    window.addEventListener('message', this.onMessage)
    this._onThemeChanged = () => this.pushTheme()
    uni.$on(APP_THEME_EVENT, this._onThemeChanged)
    // 事件源（v2.7）：FileTree.loadFiles 成功后与编辑器选区变化时各发一个应用级事件，
    // 这里按插件的订阅集合转发进 iframe（未订阅不推，见 forwardEvent）
    if (this.hasPermission('speech') && host.model?.onProgress) this._unsubscribeSpeech = host.model.onProgress(event => { if (['kokoro-models', 'asr-models'].includes(event?.id)) this.forwardEvent('speech.progress', event) })
    this._collectionEvents = [['awd:clipboard-saved', 'clipboard.changed'], ['awd:entitlements-changed', 'clipboard.changed'], ['awd:favorites-changed', 'favorites.changed']].map(([source, event]) => {
      const callback = () => this.forwardEvent(event, {})
      uni.$on(source, callback)
      return () => uni.$off(source, callback)
    })
    this._unsubscribeTasks = subscribeTaskChanges(event => { if (['created', 'updated', 'deleted'].includes(event.kind)) this.forwardEvent('calendar.changed', {}) })
    this._onFilesChanged = () => this.forwardEvent('files.changed', {})
    this._onSelectionChanged = () => this.forwardEvent('selection.changed', {})
    // v2.9：设置变更只推给设置所属的插件——别的插件订阅了也收不到别人的
    this._onPluginSettingsChanged = (e) => {
      if (e && e.pluginId === this.pluginId) this.forwardEvent('settings.changed', {})
    }
    this._onSidebarCommand = (e) => {
      if (!e || (e.pluginId && e.pluginId !== this.pluginId)) return
      if (this._subscribedEvents && this._subscribedEvents.has('sidebar.command')) {
        this.forwardEvent('sidebar.command', e)
      } else {
        this._pendingSidebarCommand = e
      }
    }
    uni.$on('awd:files-changed', this._onFilesChanged)
    uni.$on('awd:selection-changed', this._onSelectionChanged)
    uni.$on('awd:plugin-settings-changed', this._onPluginSettingsChanged)
    this._onLawfirmTab = (payload) => {
      if (this.pluginId && this.pluginId !== 'lawfirm-management') return
      const tab = typeof payload === 'string' ? payload : (payload && payload.tab) || ''
      if (!tab) return
      if (this._subscribedEvents && this._subscribedEvents.has('lawfirm.navigate')) {
        this.forwardEvent('lawfirm.navigate', { tab })
      } else {
        this._pendingLawfirmTab = tab
      }
    }
    uni.$on('awd:lawfirm-tab', this._onLawfirmTab)
    uni.$on('awd:plugin-sidebar-command', this._onSidebarCommand)
    this._onAccountChanged = () => {
      this.disposeBusinessServices()
      this.sessionGeneration++
      this.clearPreparedDrag()
      this.forwardEvent('account.changed', {})
      this.initializeAuthorization()
    }
    uni.$on(ACCOUNT_CHANGED_EVENT, this._onAccountChanged)
    // 团队 / 律所切换（utils/orgContext.js 的 ORG_CHANGED_EVENT；此处写字面量，
    // 测试夹具会剥掉 import）：只让插件重拉通讯录，不清会话——项目沟通会话按会话成员身份保留。
    this._onOrgChanged = (e) => {
      // 未订阅的插件下次初始化会自己拉新数据，不占用 _pendingSidebarCommand（那是留给用户点击的）
      if (!this._subscribedEvents || !this._subscribedEvents.has('sidebar.command')) return
      this.forwardEvent('sidebar.command', { pluginId: this.pluginId, command: 'refresh-directory', reason: (e && e.reason) || 'org-changed' })
    }
    uni.$on('awd:org-changed', this._onOrgChanged)
  },
  beforeUnmount() {
    this._authorizationDestroyed = true
    this.authorizationReady = false
    this._collectionEvents?.forEach(off => off())
    this._unsubscribeTasks?.()
    this._unsubscribeSpeech?.()
    this.disposeBusinessServices()
    this.sessionGeneration++
    this.clearPreparedDrag()
    window.removeEventListener('message', this.onMessage)
    if (this._onThemeChanged) { uni.$off(APP_THEME_EVENT, this._onThemeChanged); this._onThemeChanged = null }
    if (this._onFilesChanged) { uni.$off('awd:files-changed', this._onFilesChanged); this._onFilesChanged = null }
    if (this._onSelectionChanged) { uni.$off('awd:selection-changed', this._onSelectionChanged); this._onSelectionChanged = null }
    if (this._onPluginSettingsChanged) { uni.$off('awd:plugin-settings-changed', this._onPluginSettingsChanged); this._onPluginSettingsChanged = null }
    if (this._onLawfirmTab) { uni.$off('awd:lawfirm-tab', this._onLawfirmTab); this._onLawfirmTab = null }
    if (this._onSidebarCommand) { uni.$off('awd:plugin-sidebar-command', this._onSidebarCommand); this._onSidebarCommand = null }
    if (this._onAccountChanged) { uni.$off(ACCOUNT_CHANGED_EVENT, this._onAccountChanged); this._onAccountChanged = null }
    if (this._onOrgChanged) { uni.$off('awd:org-changed', this._onOrgChanged); this._onOrgChanged = null }
    this.resetEventChannel()
  },
  methods: {
    // Capture authority before rendering code. Never adopt new privileges into a running iframe.
    async initializeAuthorization() {
      this.authorizationReady = false
      this.authorizationInvalid = false
      this._pendingSidebarCommand = null
      this._pendingLawfirmTab = null
      this._authorizationSnapshot = null
      this._authorizationBlocked = false
      if (!this.isWebPlugin || this._authorizationDestroyed) return
      const generation = this.sessionGeneration
      try {
        const record = await this.readAuthorization()
        if (generation !== this.sessionGeneration || this._authorizationDestroyed) return
        const permissions = [...(this.permissions || [])].sort()
        if (!record || JSON.stringify(record.permissions) !== JSON.stringify(permissions)
            || record.devInstalled !== !!this.devInstalled) {
          this.invalidateAuthorization(record)
          return
        }
        this._authorizationSnapshot = record
        this.authorizationReady = true
      } catch (_) {
        if (generation === this.sessionGeneration && !this._authorizationDestroyed) this.invalidateAuthorization()
      }
    },
    async readAuthorization() {
      // No TTL: a CLI reinstall/disable need not send any UI event.
      const response = await getPlugins()
      const rows = Array.isArray(response) ? response : response?.data
      if (!Array.isArray(rows)) throw new Error('Plugin authorization unavailable')
      const record = rows.find(row => row.id === this.pluginId)
      if (!record || record.enabled !== true || record.revokedReason || record.incompatibleReason) return null
      return {
        id: record.id, version: record.version, frontendEntry: record.frontendEntry,
        permissions: [...(record.permissions || [])].sort(), devInstalled: !!record.devInstalled,
        contributes: record.contributes, tools: record.tools,
      }
    },
    invalidateAuthorization(record) {
      if (this._authorizationBlocked) return
      this._authorizationBlocked = true
      this.authorizationInvalid = true
      this.authorizationReady = false
      this._authorizationSnapshot = null
      this.sessionGeneration++
      this.disposeBusinessServices()
      this.clearPreparedDrag()
      this.resetEventChannel()
      // External installs do not emit the UI event. Refresh the rail's metadata once
      // per changed state so closing/reopening cannot keep reusing stale props.
      const key = JSON.stringify(record)
      if (record !== undefined && key !== this._authorizationNotified) {
        this._authorizationNotified = key
        uni.$emit('awd:market-changed')
        uni.$emit('awd:market-changed-from-sidebar')
      }
    },
    async verifyAuthorization(generation) {
      if (!this.authorizationReady || this._authorizationBlocked || this._authorizationDestroyed
          || generation !== this.sessionGeneration) return false
      try {
        const record = await this.readAuthorization()
        if (generation !== this.sessionGeneration || this._authorizationDestroyed) return false
        if (!record || JSON.stringify(record) !== JSON.stringify(this._authorizationSnapshot)) {
          this.invalidateAuthorization(record)
          return false
        }
        return true
      } catch (_) {
        if (generation === this.sessionGeneration && !this._authorizationDestroyed) this.invalidateAuthorization()
        return false
      }
    },
    effectivePermissions() {
      return this._authorizationSnapshot?.permissions || (this._authorizationBlocked ? [] : this.permissions)
    },
    disposeBusinessServices() {
      this._businessServices?.dispose()
      this._businessServices = null
      this._platformServices?.dispose()
      this._platformServices = null
    },
    businessServices() {
      if (!this._businessServices) {
        const generation = this.sessionGeneration
        const actions = { ...this.businessActions, emit: (name, data) => uni.$emit(name, data), activeFileId: () => this.activeEditor()?.fileId, download: ({ content, name, type }) => {
          const url = URL.createObjectURL(new Blob([content], { type }))
          const link = document.createElement('a')
          try { link.href = url; link.download = name; document.body.appendChild(link); link.click() }
          finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
        } }
        const voice = createPluginVoiceServices({ projectId: () => this.projectId, permissions: () => this.effectivePermissions(), isCurrent: () => generation === this.sessionGeneration, actions })
        const collections = createPluginCollectionServices({ projectId: () => this.projectId, permissions: () => this.effectivePermissions(), isCurrent: () => generation === this.sessionGeneration, actions, listFiles: () => this.listProjectFiles(), openFile: file => uni.$emit('awd:open-evidence-target', { fileId: file.id }) })
        const insight = createPluginInsightServices({ projectId: () => this.projectId, permissions: () => this.effectivePermissions(), isCurrent: () => generation === this.sessionGeneration, actions, listFiles: () => this.listProjectFiles(), openFile: file => uni.$emit('awd:open-evidence-target', { fileId: file.id }) })
        this._businessServices = createPluginBusinessServices({
          delegates: { ...Object.fromEntries(['calendar', 'favorites', 'clipboard'].map(service => [service, (operation, params, signal) => collections.request(service, operation, params, signal)])), voice: (operation, params, signal) => voice.request(operation, params, signal), insight: (operation, params, signal) => insight.request(operation, params, signal) },
          api: { searchProjectContent, getProjectTags, getSensitiveOptions, previewSensitiveFile, desensitizeFile, restoreSensitiveFile,
            getLitigationVisualStatus, getLitigationDiagrams, getLitigationKickoffPrompt, restyleLitigationDiagram, packStatus, packInstall },
          projectId: () => this.projectId,
          permissions: () => this.effectivePermissions(),
          isCurrent: () => generation === this.sessionGeneration,
          listFiles: () => this.listProjectFiles(),
          openFile: file => uni.$emit('awd:open-evidence-target', { fileId: file.id, locator: null, linkKey: null }),
          actions,
        })
      }
      return this._businessServices
    },
    platformServices() {
      if (!this._platformServices) {
        const generation = this.sessionGeneration
        this._platformServices = createPluginPlatformServices({
          pluginId: () => this.pluginId, projectId: () => this.projectId,
          permissions: () => this.effectivePermissions(), isCurrent: () => generation === this.sessionGeneration,
        })
      }
      return this._platformServices
    },
    clearPreparedDrag() {
      endPluginImDrag(this)
    },
    onFrameLoad() {
      if (!this.isWebPlugin || !this.authorizationReady) return
      const frame = this.$refs.pluginFrame
      if (!frame || !frame.contentWindow) return
      // 时序：load 之后才握手。插件侧 SDK 是同步 <script>，此刻监听已就位。
      frame.contentWindow.postMessage(
        { awd: PROTOCOL, type: 'init', context: this.buildContext() },
        '*'
      )
    },

    buildContext() {
      return {
        pluginId: this.pluginId || '',
        projectId: this.projectId == null ? '' : String(this.projectId),
        language: getAppLanguage(),
        // 外壳自 dev-board#223 起有深浅两态，握手把当前生效的那个告诉插件
        theme: getResolvedTheme(),
        // v2.6：语义色令牌整表随握手注入（SDK 收到即写成 iframe 里的 CSS 变量，
        // 照 VS Code 给 webview 注入 --vscode-* 的机制）。切换时走 pushTheme 推送。
        themeTokens: collectThemeTokens()
      }
    },

    /** 主题切换推送（v2.6）：插件面板开着时切深浅色，iframe 里的令牌跟着换 */
    pushTheme() {
      if (!this.isWebPlugin) return
      const frame = this.$refs.pluginFrame
      if (!frame || !frame.contentWindow) return
      frame.contentWindow.postMessage(
        { awd: PROTOCOL, type: 'theme', theme: getResolvedTheme(), tokens: collectThemeTokens() },
        '*'
      )
    },

    async onMessage(event) {
      if (!this.isWebPlugin) return
      const frame = this.$refs.pluginFrame
      // 唯一的来源校验：只认本 iframe 的窗口。插件侧发的 targetOrigin 是 '*'
      // （opaque origin 拿不到宿主 origin），所以不能靠 event.origin 判断。
      if (!frame || !frame.contentWindow || event.source !== frame.contentWindow) return
      const msg = event.data
      if (!msg || msg.awd !== PROTOCOL || msg.type !== 'call') return

      // 发起调用时的代次，await 之后据此判断这条响应还属不属于当前插件
      const generation = this.sessionGeneration
      if (!await this.verifyAuthorization(generation)) return
      let out
      try {
        out = await this.handleCall(String(msg.method || ''), msg.params || {})
      } catch (e) {
        out = { ok: false, error: { code: 'internal_error', message: (e && e.message) || '调用失败' } }
      }
      if (!await this.verifyAuthorization(generation)) return
      this.reply(msg.seq, out, generation)
    },

    reply(seq, out, generation) {
      // 代次已过期：调用发出后面板换了插件，这条响应属于上一个插件，丢弃
      if (generation !== undefined && generation !== this.sessionGeneration) return
      const frame = this.$refs.pluginFrame
      if (!frame || !frame.contentWindow) return
      const msg = { awd: PROTOCOL, type: 'result', seq, ok: !!out.ok }
      if (out.ok) msg.result = out.result
      else msg.error = out.error
      frame.contentWindow.postMessage(msg, '*')
    },

    hasPermission(name) {
      return Array.isArray(this.effectivePermissions()) && this.effectivePermissions().indexOf(name) >= 0
    },

    denied(permission) {
      return {
        ok: false,
        error: { code: 'permission_denied', message: 'manifest.permissions 未声明 ' + permission }
      }
    },

    async handleCall(method, params) {
      const generation = this.sessionGeneration
      if (/^(settings|connections|mcp|billing)\./.test(method)) {
        const platform = await this.platformServices().request(method, params)
        if (platform) return platform
      }
      if (generation !== this.sessionGeneration) return this.staleContext()
      // 实验 API 闸（v2.7）：x- 前缀方法只对 dev 免签直装插件开放。
      // dev 插件的 x- 方法继续落进 switch（当前没有任何实验方法，得到 unknown_method）。
      if (method.indexOf('x-') === 0 && !this.devInstalled) {
        return {
          ok: false,
          error: { code: 'experimental_not_allowed', message: '实验方法仅对本机开发安装的插件开放：' + method }
        }
      }
      switch (method) {
        case 'services.cancel':
          return { ok: true, result: this.businessServices().cancel(params.requestId) }
        case 'services.request': {
          try {
            const data = { ...(params.params || {}), requestId: params.requestId || params.params?.requestId }
            return { ok: true, result: clonePluginData(await this.businessServices().request(params.service, params.operation, data)) }
          } catch (e) {
            return { ok: false, error: { code: e.code || (e.name === 'AbortError' ? 'cancelled' : 'invoke_failed'), message: e.message } }
          }
        }
        case 'im.downloadAttachment': {
          if (!this.hasPermission('im')) return this.denied('im')
          const conversationId = typeof params.conversationId === 'string' ? params.conversationId.trim() : ''
          const attachmentId = typeof params.attachmentId === 'string' ? params.attachmentId.trim() : ''
          if (!conversationId || !attachmentId || conversationId.length > 128 || attachmentId.length > 128) {
            return { ok: false, error: { code: 'invalid_params', message: '缺少有效的会话或附件标识' } }
          }
          const generation = this.sessionGeneration
          const projectId = this.projectId
          const current = () => generation === this.sessionGeneration && String(projectId) === String(this.projectId)
          try {
            const res = await requestPluginIm(this.pluginId, projectId, 'download', { conversationId, attachmentId })
            if (!current()) return this.staleContext()
            if (!res || res.code !== 0) return { ok: false, error: { code: 'invoke_failed', message: res?.message || '文件下载失败' } }
            const data = res.data
            const maxBytes = 8 * 1024 * 1024
            if (!data || String(data.id) !== attachmentId || typeof data.base64 !== 'string'
                || data.base64.length > Math.ceil(maxBytes / 3) * 4
                || data.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)) {
              throw new Error('附件数据无效或超过 8 MB，未开始下载。')
            }
            const raw = window.atob(data.base64)
            if (raw.length > maxBytes) throw new Error('附件超过 8 MB，未开始下载。')
            const bytes = new Uint8Array(raw.length)
            for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
            let name = String(data.name || 'attachment.bin').replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^[. ]+|[. ]+$/g, '').trim().slice(0, 200)
            if (!name || name === '.') name = 'attachment.bin'
            if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
            if (!current()) return this.staleContext()
            // Same Blob download path as editor Save Copy As; Electron owns the save dialog.
            const url = window.URL.createObjectURL(new window.Blob([bytes], { type: 'application/octet-stream' }))
            const link = window.document.createElement('a')
            try {
              link.href = url
              link.download = name
              window.document.body.appendChild(link)
              link.click()
            } finally {
              link.remove()
              setTimeout(() => window.URL.revokeObjectURL(url), 60000)
            }
            return { ok: true, result: { started: true, name } }
          } catch (e) {
            return { ok: false, error: { code: 'invoke_failed', message: e?.message || '文件下载失败，请重试' } }
          }
        }

        case 'im.request': {
          if (!this.hasPermission('im')) return this.denied('im')
          const action = typeof params.action === 'string' ? params.action.trim() : ''
          if (!action || !this.projectId || (params.params != null
              && (typeof params.params !== 'object' || Array.isArray(params.params)))) {
            return { ok: false, error: { code: 'invalid_params', message: '缺少项目、action 或有效 params' } }
          }
          const generation = this.sessionGeneration
          try {
            const res = await requestPluginIm(this.pluginId, this.projectId, action, params.params || {})
            if (generation !== this.sessionGeneration) return this.staleContext()
            if (!res || res.code !== 0) return { ok: false, error: { code: 'invoke_failed', message: res?.message || '沟通服务请求失败' } }
            if (['import', 'export', 'sendFile', 'binding'].includes(action)) this.$emit('files-changed')
            return { ok: true, result: res.data }
          } catch (e) {
            return { ok: false, error: { code: 'invoke_failed', message: e?.message || '沟通服务暂不可用，请重试' } }
          }
        }

        case 'lawfirm.request': {
          if (!this.hasPermission('lawfirm')) return this.denied('lawfirm')
          const action = typeof params.action === 'string' ? params.action.trim() : ''
          if (!action || (params.params != null
              && (typeof params.params !== 'object' || Array.isArray(params.params)))) {
            return { ok: false, error: { code: 'invalid_params', message: '缺少 action 或有效 params' } }
          }
          const generation = this.sessionGeneration
          try {
            const res = await requestPluginLawFirm(this.pluginId, this.projectId, action, params.params || {})
            if (generation !== this.sessionGeneration) return this.staleContext()
            if (!res || res.code !== 0) {
              return { ok: false, error: { code: 'invoke_failed', message: res?.message || '律所管理服务请求失败' } }
            }
            return { ok: true, result: res.data }
          } catch (e) {
            return { ok: false, error: { code: 'invoke_failed', message: e?.message || '律所管理服务请求失败' } }
          }
        }

        case 'chat.addFile':
        case 'files.prepareDrag': {
          if (!this.hasPermission('file_read')) return this.denied('file_read')
          const path = typeof params.path === 'string' ? params.path : ''
          if (!path) return { ok: false, error: { code: 'invalid_params', message: '缺少项目文件路径 path' } }
          const generation = this.sessionGeneration
          const projectId = this.projectId
          const isCurrent = () => generation === this.sessionGeneration && String(projectId) === String(this.projectId)
          try {
            const hit = (await this.listProjectFiles()).find(f => f.path === path)
            if (!isCurrent()) return this.staleContext()
            if (!hit) return { ok: false, error: { code: 'not_found', message: '文件不存在：' + path } }
            if (method === 'files.prepareDrag') {
              return { ok: true, result: preparePluginImDrag(this, hit, projectId, window, { frame: this.$refs.pluginFrame, rect: params.rect }) }
            }
            if (!this.addFileToAi) return { ok: false, error: { code: 'unavailable', message: '当前工作台无法打开 AI 对话' } }
            await this.addFileToAi({ projectId, file: { id: hit.id, name: hit.name, fileType: hit.fileType, isDir: false }, isCurrent })
            return isCurrent() ? { ok: true, result: {} } : this.staleContext()
          } catch (e) {
            return { ok: false, error: { code: 'invoke_failed', message: e?.message || '文件操作失败，请重试' } }
          }
        }

        case 'files.endDrag':
          if (!this.hasPermission('file_read')) return this.denied('file_read')
          this.clearPreparedDrag()
          return { ok: true, result: {} }

        case 'context.get':
          return { ok: true, result: this.buildContext() }

        case 'files.list':
          if (!this.hasPermission('file_read')) return this.denied('file_read')
          return { ok: true, result: { files: (await this.listProjectFiles()).map(f => ({
            path: f.path, name: f.name, size: f.size
          })) } }

        case 'files.read':
          if (!this.hasPermission('file_read')) return this.denied('file_read')
          return await this.readProjectFile(String(params.path || ''))

        case 'ui.toast':
          uni.showToast({
            title: String(params.message == null ? '' : params.message),
            icon: 'none'
          })
          return { ok: true, result: {} }

        case 'storage.get': {
          const store = this.readStore()
          const key = String(params.key == null ? '' : params.key)
          return { ok: true, result: { key, value: store[key] === undefined ? null : store[key] } }
        }

        case 'storage.set': {
          const store = this.readStore()
          const next = Object.assign({}, store)
          next[String(params.key == null ? '' : params.key)] = params.value
          const serialized = JSON.stringify(next)
          if (serialized.length > STORAGE_LIMIT) {
            return { ok: false, error: { code: 'quota_exceeded', message: '插件存储超过 64 KB 上限' } }
          }
          this.writeStore(serialized)
          return { ok: true, result: {} }
        }

        // ==== 规范 v2.5 新增的三个方法 ====

        case 'tools.invoke': {
          // 直调本插件自己的 JAR 工具：权限/配额/projectId 都在后端端点与 ToolRegistry 里闸，
          // 桥这里只负责转发；插件不可能借这条路调到别的插件或宿主内置工具（端点按 manifest 校验）
          const name = String(params.name == null ? '' : params.name).trim()
          if (!name) return { ok: false, error: { code: 'invalid_params', message: '缺少工具名 name' } }
          let res
          try {
            res = await invokePluginTool(this.pluginId, name, this.projectId, params.args || {})
          } catch (e) {
            return { ok: false, error: { code: 'invoke_failed', message: (e && e.message) || '工具调用失败' } }
          }
          const body = res && res.output !== undefined ? res : (res && res.data) || {}
          if (body.code !== 0) {
            return { ok: false, error: { code: 'invoke_failed', message: String(body.output || body.message || '工具调用失败') } }
          }
          return { ok: true, result: { output: body.output == null ? '' : String(body.output) } }
        }

        case 'chat.send': {
          const prompt = String(params.prompt == null ? '' : params.prompt).trim()
          if (!prompt) return { ok: false, error: { code: 'invalid_params', message: 'prompt 不能为空' } }
          if (prompt.length > 4000) return { ok: false, error: { code: 'quota_exceeded', message: 'prompt 超过 4000 字上限' } }
          this.$emit('kickoff', { prompt })
          return { ok: true, result: {} }
        }

        case 'chat.open': {
          if (!this.hasPermission('ai')) return this.denied('ai')
          const conversationId = String(params.conversationId || '')
          if (!conversationId || conversationId.length > 200) return { ok: false, error: { code: 'invalid_params', message: '无效的会话标识' } }
          const generation = this.sessionGeneration
          const projectId = this.projectId
          const response = await getAiConversations(projectId)
          if (generation !== this.sessionGeneration || String(projectId) !== String(this.projectId)) return this.staleContext()
          const rows = Array.isArray(response) ? response : response?.data
          const conversation = Array.isArray(rows) && rows.find(row => row.conversationId === conversationId)
          if (!conversation) return { ok: false, error: { code: 'not_found', message: '当前项目中尚无该会话记录，请在任务开始后重试' } }
          if (!this.businessActions.openConversation || !await this.businessActions.openConversation(conversation)) {
            return { ok: false, error: { code: 'open_failed', message: '执行会话未能打开，请重试' } }
          }
          return { ok: true, result: {} }
        }

        case 'ui.openUrl': {
          if (!this.hasPermission('network')) return this.denied('network')
          let url
          try { url = new URL(String(params.url || '')) } catch { return { ok: false, error: { code: 'invalid_params', message: '无效的网址' } } }
          if (url.protocol !== 'https:' || url.username || url.password) return { ok: false, error: { code: 'invalid_params', message: '仅支持不含登录信息的 HTTPS 网址' } }
          if (!this.businessActions.openBrowser) return { ok: false, error: { code: 'unavailable', message: '浏览器入口暂不可用' } }
          await this.businessActions.openBrowser(url.href)
          return { ok: true, result: {} }
        }

        case 'ui.openFile': {
          if (!this.hasPermission('file_read')) return this.denied('file_read')
          const path = String(params.path == null ? '' : params.path)
          const generation = this.sessionGeneration
          const hit = (await this.listProjectFiles()).find(f => f.path === path)
          if (generation !== this.sessionGeneration) return this.staleContext()
          if (!hit) return { ok: false, error: { code: 'not_found', message: '文件不存在：' + path } }
          // 与 evidence.locate 打开底稿同一条路：工作台监听后走 openFileLinkTarget
          uni.$emit('awd:open-evidence-target', { fileId: hit.id, locator: null, linkKey: null })
          return { ok: true, result: {} }
        }

        // ==== 规范 v2.7 新增：doc.* / events.* / ai.request ====

        case 'doc.exec': {
          if (!this.hasPermission('editor')) return this.denied('editor')
          const action = String(params.action == null ? '' : params.action).trim()
          if (!action) return { ok: false, error: { code: 'invalid_params', message: '缺少 action' } }
          if (!PLUGIN_DOC_ACTIONS.has(action)) {
            return { ok: false, error: { code: 'action_not_allowed', message: '该原语不对插件开放：' + action } }
          }
          const ed = this.activeEditor()
          if (!ed) return this.noActiveDocument('没有打开的文档，doc.exec 只作用于当前聚焦的编辑器')
          // __agent: 修订署名 "AI WorkDeck"、Writer 修订模式行为与 AI 管线一致——
          // 插件写入可被用户逐条接受/拒绝（executor 之后还有 EDITOR_ACTIONS 第二道既有闸）
          const r = await ed.executor(action, Object.assign({}, params.params || {}, { __agent: true }))
          return { ok: true, result: { result: r == null ? {} : r } }
        }

        case 'doc.active': {
          if (!this.hasPermission('editor')) return this.denied('editor')
          const ed = this.activeEditor()
          if (!ed) return { ok: true, result: { fileId: null, kind: null } }
          let kind = null
          try {
            const r = await ed.executor('get_doc_kind', {})
            kind = (r && (r.kind || (r.result && r.result.kind))) || null
          } catch (e) { /* 诊断失败不影响主返回 */ }
          return { ok: true, result: { fileId: ed.fileId, kind } }
        }

        case 'events.subscribe':
        case 'events.unsubscribe': {
          const names = Array.isArray(params.events) ? params.events.map(e => String(e || '')) : []
          names.forEach(name => {
            const def = PLUGIN_EVENTS[name]
            if (!def) return // 未知事件名静默忽略（向前兼容：新事件名在老宿主上不报错）
            if (def.permission && !this.hasPermission(def.permission)) return // 权限不足静默剔除
            if (method === 'events.subscribe') this._subscribedEvents.add(name)
            else this._subscribedEvents.delete(name)
          })
          if (method === 'events.subscribe' && this._pendingLawfirmTab && this._subscribedEvents.has('lawfirm.navigate')) {
            const pending = this._pendingLawfirmTab
            this._pendingLawfirmTab = ''
            setTimeout(() => this.forwardEvent('lawfirm.navigate', { tab: pending }), 0)
          }
          if (method === 'events.subscribe' && this._subscribedEvents.has('sidebar.command') && this._pendingSidebarCommand) {
            const pending = this._pendingSidebarCommand
            this._pendingSidebarCommand = null
            setTimeout(() => this.forwardEvent('sidebar.command', pending), 0)
          }
          return { ok: true, result: { subscribed: Array.from(this._subscribedEvents) } }
        }

        case 'im.directory': {
          return await this.handleImDirectory(params || {})
        }

        case 'sidebar.sync': {
          try {
            uni.$emit('awd:plugin-state-synced', Object.assign({ pluginId: this.pluginId }, params || {}))
          } catch (e) { /* ignore */ }
          return { ok: true, result: {} }
        }

        case 'settings.get': {
          // v2.9：只读本插件声明过的设置项（secret 的键不进桥，服务端返回 null → not_found）
          const key = String(params.key == null ? '' : params.key).trim()
          if (!key) return { ok: false, error: { code: 'invalid_params', message: '缺少 key' } }
          let res
          try {
            res = await getPluginSettings(this.pluginId)
          } catch (e) {
            return { ok: false, error: { code: 'internal_error', message: (e && e.message) || '设置读取失败' } }
          }
          const body = res && res.settings !== undefined ? res : (res && res.data) || {}
          const rows = Array.isArray(body.settings) ? body.settings : []
          const hit = rows.find(r => r.key === key)
          if (!hit) return { ok: false, error: { code: 'not_found', message: '未声明的设置项：' + key } }
          if (hit.secret) return { ok: false, error: { code: 'permission_denied', message: 'secret 设置项不提供给插件页面' } }
          return { ok: true, result: { key, value: hit.value == null ? '' : String(hit.value) } }
        }

        case 'ai.request': {
          if (!this.hasPermission('ai')) return this.denied('ai')
          const prompt = String(params.prompt == null ? '' : params.prompt)
          const system = params.system == null ? '' : String(params.system)
          if (!prompt.trim()) return { ok: false, error: { code: 'invalid_params', message: 'prompt 不能为空' } }
          if (prompt.length + system.length > AI_REQUEST_MAX_CHARS) {
            return { ok: false, error: { code: 'quota_exceeded', message: 'prompt+system 超过 ' + AI_REQUEST_MAX_CHARS + ' 字符上限' } }
          }
          let res
          try {
            res = await pluginAiComplete(this.pluginId, this.projectId, {
              prompt, system, purpose: String(params.purpose == null ? '' : params.purpose).slice(0, 64)
            })
          } catch (e) {
            return { ok: false, error: { code: 'ai_failed', message: (e && e.message) || 'AI 请求失败' } }
          }
          const body = res && res.code !== undefined ? res : (res && res.data) || {}
          if (body.code !== 0) {
            return { ok: false, error: { code: body.errorCode || 'ai_failed', message: String(body.message || 'AI 请求失败') } }
          }
          return { ok: true, result: { text: body.text == null ? '' : String(body.text), modelId: body.modelId || '' } }
        }

        case 'evidence.list':
          if (!this.hasPermission('file_read')) return this.denied('file_read')
          return await this.evidenceList(params)

        case 'evidence.link':
          if (!this.hasPermission('editor')) return this.denied('editor')
          return await this.evidenceLink(params)

        case 'evidence.locate':
          if (!this.hasPermission('editor')) return this.denied('editor')
          return await this.evidenceLocate(params)

        default:
          return { ok: false, error: { code: 'unknown_method', message: '未知方法：' + method } }
      }
    },

    // ==== 事件通道（v2.7）====

    /** 换插件/卸载时清空订阅与在途定时器：新插件必须自己重新 subscribe */
    resetEventChannel() {
      this._subscribedEvents = new Set()
      const timers = this._eventTimers || {}
      Object.keys(timers).forEach(k => clearTimeout(timers[k]))
      this._eventTimers = {}
    },

    /**
     * 向已订阅的插件推送事件（trailing 合并：窗口内多次触发只推最后一次）。
     * payload 刻意为空/极小——事件是「该重拉了」的信号，数据由插件按各自权限闸拉取。
     */
    forwardEvent(name, data) {
      if (!this.isWebPlugin) return
      if (!this._subscribedEvents || !this._subscribedEvents.has(name)) return
      const def = PLUGIN_EVENTS[name]
      const generation = this.sessionGeneration
      const fire = async () => {
        delete this._eventTimers[name]
        // Empty account/project lifecycle signals may be delivered before resetting the frame.
        if (!['account.changed', 'project.switched'].includes(name) && !await this.verifyAuthorization(generation)) return
        // 定时器落地时可能已换插件：订阅集合在 resetEventChannel 里清过，再查一次
        if (!this._subscribedEvents || !this._subscribedEvents.has(name)) return
        const frame = this.$refs.pluginFrame
        if (!frame || !frame.contentWindow) return
        frame.contentWindow.postMessage(
          { awd: PROTOCOL, type: 'event', event: name, data: data || {} }, '*'
        )
      }
      const throttleMs = def ? def.throttleMs : 0
      if (!throttleMs) { fire(); return }
      if (this._eventTimers[name]) clearTimeout(this._eventTimers[name])
      this._eventTimers[name] = setTimeout(fire, throttleMs)
    },

    // ==== 证据链接（evidence.*）====

    noActiveDocument(message) {
      return { ok: false, error: { code: 'no_active_document', message: message || '没有打开的 Word 文档' } }
    },

    activeEditor() {
      if (typeof this.getActiveEditor !== 'function') return null
      const ed = this.getActiveEditor()
      if (!ed || typeof ed.executor !== 'function' || !ed.fileId) return null
      return { executor: ed.executor, fileId: Number(ed.fileId) }
    },

    /** 一次拉全树，同时给出 path->id 与 id->path 两张表（evidence.* 都要双向查） */
    async pathTables() {
      const files = await this.listProjectFiles()
      const idByPath = new Map()
      const pathById = new Map()
      files.forEach(f => { idByPath.set(f.path, f.id); pathById.set(f.id, f.path) })
      return { idByPath, pathById }
    },

    async evidenceList(params) {
      const { idByPath, pathById } = await this.pathTables()
      let query
      if (params.path) {
        const fileId = idByPath.get(String(params.path))
        if (!fileId) return { ok: false, error: { code: 'not_found', message: '文件不存在：' + params.path } }
        query = { fileId }
      } else {
        let docFileId
        if (params.docPath) {
          docFileId = idByPath.get(String(params.docPath))
          if (!docFileId) return { ok: false, error: { code: 'not_found', message: '文件不存在：' + params.docPath } }
        } else {
          const ed = this.activeEditor()
          if (!ed) return this.noActiveDocument()
          docFileId = ed.fileId
        }
        query = { docFileId, status: params.status, sectionPath: params.sectionPath }
      }
      const res = await listEvidenceLinks(this.projectId, query)
      const links = Array.isArray(res) ? res : (res && res.data) || []
      return { ok: true, result: { links: links.map(l => toPluginLink(l, pathById)) } }
    },

    async evidenceLink(params) {
      const ed = this.activeEditor()
      if (!ed) return this.noActiveDocument()
      const { idByPath } = await this.pathTables()
      if (params.docPath) {
        // 书签只能打在当前聚焦的编辑器里，docPath 指向别的文档无法代劳
        const want = idByPath.get(String(params.docPath))
        if (!want) return { ok: false, error: { code: 'not_found', message: '文件不存在：' + params.docPath } }
        if (want !== ed.fileId) return this.noActiveDocument('docPath 不是当前聚焦的文档，请先切到该文档')
      }
      const ti = toTargetInputs(params.targets, idByPath)
      if (ti.error) return { ok: false, error: ti.error }

      const a = await resolveAnchor(ed.executor, params.anchor)
      if (a.error) return { ok: false, error: a.error }
      if (a.mode === 'quote') {
        const sel = await ed.executor('set_selection', { anchor: a.anchorId })
        if (!sel || !sel.success) {
          // 查找留下的 __ai_anchor_* 书签不能残留在 docx 里
          try { await ed.executor('clear_anchors', {}) } catch (e) { /* ignore */ }
          return { ok: false, error: { code: 'anchor_ambiguous', message: (sel && sel.message) || '引文无法选中' } }
        }
      }

      // 与拖放建链同一份流程（复核 F2）：选区已带 filelink?k= 则复用 linkKey 追加 target，
      // 否则 bookmark_selection + set_selection_hyperlink 成对写入，再落库。
      let res
      try {
        res = await createEvidenceLinkForSelection({
          exec: ed.executor,
          api: { createEvidenceLink, addEvidenceTargets },
          projectId: this.projectId,
          docFileId: ed.fileId,
          internalBase: WPS_INTERNAL_HTTP_LINK_BASE,
          targets: ti.targets,
          createdByKind: 'plugin'
        })
      } finally {
        if (a.mode === 'quote') {
          try { await ed.executor('clear_anchors', {}) } catch (e) { /* ignore */ }
        }
      }
      if (!res.ok) {
        return { ok: false, error: { code: 'no_selection', message: res.message || '无法在选区上建立锚点' } }
      }
      const view = res.view && res.view.linkKey ? res.view : (res.view && res.view.data) || {}
      // 编辑器的 _evidenceCache 与证据面板都只在这个事件上刷新，不发就要重开文档才看得到
      try { uni.$emit('awd:evidence-changed', { docFileId: ed.fileId, linkKey: res.linkKey, source: 'plugin' }) } catch (e) { /* ignore */ }
      return {
        ok: true,
        result: {
          linkKey: view.linkKey || res.linkKey,
          targetIds: (Array.isArray(view.targets) ? view.targets : []).map(t => t.id)
        }
      }
    },

    async evidenceLocate(params) {
      const linkKey = String(params.linkKey || '')
      let link = null
      try {
        const res = await getEvidenceLink(this.projectId, linkKey)
        link = res && res.linkKey ? res : (res && res.data) || null
      } catch (e) {
        link = null
      }
      if (!link) return { ok: false, error: { code: 'not_found', message: '链接不存在：' + linkKey } }
      const targets = Array.isArray(link.targets) ? link.targets : []
      const tgt = params.targetId != null && params.targetId !== ''
        ? targets.find(t => Number(t.id) === Number(params.targetId))
        : null
      if (params.targetId != null && params.targetId !== '' && !tgt) {
        return { ok: false, error: { code: 'not_found', message: '底稿位置不存在：' + params.targetId } }
      }
      if (tgt) {
        // 打开底稿并定位：由工作台（project-overview）监听后调 openFileLinkTarget
        uni.$emit('awd:open-evidence-target', { fileId: tgt.fileId, locator: tgt.locator || null, linkKey })
        return { ok: true, result: {} }
      }
      const ed = this.activeEditor()
      if (!ed || ed.fileId !== Number(link.docFileId)) {
        return this.noActiveDocument('该链接所在文档不是当前聚焦的文档')
      }
      const r = await ed.executor('goto_bookmark', { name: link.linkKey })
      if (!r || !r.success) {
        return { ok: false, error: { code: 'not_found', message: (r && r.message) || '文档里找不到该锚点' } }
      }
      return { ok: true, result: {} }
    },

    // ==== 项目文件 ====

    staleContext() {
      return { ok: false, error: { code: 'stale_context', message: '项目或账户已切换，请重试' } }
    },

    // 后端返回的是一份扁平全树（每条带 parentId），这里就地拼出项目内相对路径——
    // 插件拿到的 path 必须是人看得懂、且能原样喂回 files.read 的东西，不是数据库 id。
    async listProjectFiles() {
      if (!this.projectId) return []
      const res = await getProjectFiles(this.projectId, null, true)
      const rows = Array.isArray(res) ? res : (res && res.data) || []
      const byId = new Map()
      rows.forEach(r => byId.set(r.id, r))
      const pathOf = (row) => {
        const parts = []
        let cur = row
        let guard = 0
        while (cur && guard++ < 64) {
          parts.unshift(cur.name || String(cur.id))
          cur = cur.parentId ? byId.get(cur.parentId) : null
        }
        return parts.join('/')
      }
      return rows
        .filter(r => r && !r.isFolder)
        .map(r => ({ id: r.id, path: pathOf(r), name: r.name || '', size: r.fileSize || 0,
          fileType: r.fileType || extOf(r.name) }))
    },

    async readProjectFile(path) {
      if (!path) {
        return { ok: false, error: { code: 'not_found', message: '文件不存在：' + path } }
      }
      const hit = (await this.listProjectFiles()).find(f => f.path === path)
      if (!hit) {
        return { ok: false, error: { code: 'not_found', message: '文件不存在：' + path } }
      }
      if (!READABLE_EXTS.has(extOf(hit.name))) {
        return {
          ok: false,
          error: {
            code: 'permission_denied',
            message: '不是可读取的文本格式，files.read 只支持文本与可抽取文本的文档：' + hit.name
          }
        }
      }
      const res = await getFileText(hit.id)
      const raw = res && res.data != null ? String(res.data) : ''
      const truncated = raw.length > READ_LIMIT
      return {
        ok: true,
        result: { path: hit.path, content: truncated ? raw.slice(0, READ_LIMIT) : raw, truncated }
      }
    },

    // ==== 插件级 KV ====

    storageKey() {
      return STORAGE_PREFIX + (this.pluginId || 'unknown')
    },

    readStore() {
      try {
        const raw = window.localStorage.getItem(this.storageKey())
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch (e) {
        return {}
      }
    },

    writeStore(serialized) {
      try {
        window.localStorage.setItem(this.storageKey(), serialized)
      } catch (e) {
        console.warn('[PluginPane] 写入插件存储失败:', e)
      }
    },

    // ==== 项目沟通 · 通讯录（组织 / 律所 / 朋友）与宿主左栏同步 ====

    async handleImDirectory(params = {}) {
      // 通讯录数据统一由 utils/imDirectory.js 提供（只用真实数据）。测试夹具会剥掉 import，故先判函数存在。
      if (typeof loadImDirectory !== 'function') {
        return { ok: false, error: { code: 'unknown_method', message: '通讯录不可用' } }
      }
      const action = String(params.action || 'get')
      const deps = {
        getTeam: typeof getTeam === 'function' ? getTeam : null,
        getProjectMembers: typeof getProjectMembers === 'function' ? getProjectMembers : null,
        getCurrentUser: typeof getCurrentUser === 'function' ? getCurrentUser : null
      }
      try {
        if (action === 'openOrgSettings') {
          // 切换团队 / 律所只在宿主「设置 › 团队」完成：插件无权替用户退出团队或律所
          uni.$emit('awd:open-settings', { nav: 'team' })
          return { ok: true, result: { opened: true } }
        }
        if (action === 'addFriend' || action === 'removeFriend') {
          const dir = await loadImDirectory({ projectId: null, deps })
          if (action === 'addFriend') {
            const input = params.friend && typeof params.friend === 'object' ? params.friend : params
            addImFriend(dir.accountKey, input)
          } else {
            removeImFriend(dir.accountKey, String(params.id || ''))
          }
          uni.$emit('awd:im-directory-changed', {})
        } else if (action !== 'get') {
          return { ok: false, error: { code: 'invalid_params', message: '未知的通讯录操作：' + action } }
        }
        const result = await loadImDirectory({ projectId: this.projectId, deps })
        return { ok: true, result }
      } catch (e) {
        return { ok: false, error: { code: (e && e.code) || 'internal_error', message: (e && e.message) || '通讯录读取失败' } }
      }
    }
  }
}
</script>

<style scoped>
.plugin-pane {
  width: 100%;
  height: 100%;
  background-color: var(--awd-surface);
  display: flex;
  flex-direction: column;
}

.plugin-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
}

.plugin-error {
  padding: var(--awd-panel-gap-lg) var(--awd-panel-pad-x);
  text-align: center;
  color: var(--awd-panel-text-2);
  font-size: var(--awd-panel-fs);
  line-height: 1.5;
}
</style>
