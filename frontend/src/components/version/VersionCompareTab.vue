<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  版本对比只读标签页（第 2 期 Task 3）。

  与 LibreOfficeEditor 的本质区别（存在理由：绝不能把历史版本字节写回当前真实
  文件，见 CLAUDE.md 顶部说明）——本组件：
  1. 不监听 lo-relay 的 {type:'modified'} 信号，没有任何保存/上传代码路径。
  2. 不进保活池（不注册 _libreRefs/LRU），随标签页关闭即销毁。
  3. beforeUnmount 只 dispose executor + 移除 webview。

  流程：并行下载新旧两版字节 + 启动引擎 → load_document 新版 → compare_document
  一次性生成修订并自动切只读（.uno:EditDoc 是 toggle 语义，同一实例只能调一次，
  失败重试交给父级换 key 整体重建，本组件内部不做 retry）。

  布局照 LibreOfficeEditor 的 overlay 模式：<webview> 宿主容器**始终**渲染，状态
  卡片盖在它上面；就绪前用 opacity 隐去客体内的审阅浮层，保留真实尺寸。
  绝不能把宿主放在 v-show="ready" 里——那样整个 boot 期间宿主是
  display:none，Electron 的 <webview> 在隐藏子树里常常压根不 attach，dom-ready
  永远不来，律师只会等到 150 秒超时。
-->
<template>
  <view class="vcmp-root">
    <view :id="hostId" class="vcmp-host" :style="{ opacity: ready ? 1 : 0 }"></view>
    <view v-show="!ready" class="vcmp-status">
      <text>{{ statusText }}</text>
    </view>
    <view v-if="ready" class="vcmp-banner">
      <text>{{ $t('version.compareTabBanner', { count: redlineCount }) }}</text>
      <!-- 台账 B12：新版自身带修订时默认按接受后的正文比对，可切回原样（两层修订叠在一起） -->
      <text v-if="!rawMode && acceptedExisting > 0" class="vcmp-note">{{ $t('version.compareAcceptedNote', { count: acceptedExisting }) }}</text>
      <text v-if="!rawMode && acceptedExisting > 0" class="vcmp-switch" @tap="restart(true)">{{ $t('version.compareShowRaw') }}</text>
      <text v-if="rawMode" class="vcmp-switch" @tap="restart(false)">{{ $t('version.compareShowAccepted') }}</text>
    </view>
  </view>
</template>

<script>
import { createWebviewEditorExecutor, createIframeEditorExecutor } from '@/composables/useZetaOfficeWebview.js'
import { fetchVersionFileBytes } from '@/services/api.js'
import { host } from '@/services/host.js'
import { assertNotPasswordProtected, isPasswordProtectedError } from '@/utils/officeCompareGuard.js'

let seq = 0

export default {
  name: 'VersionCompareTab',
  props: {
    // {projectId, path, newRef, oldRef}
    compareSpec: { type: Object, required: true },
  },
  data() {
    return {
      hostId: 'vcmp-host-' + (++seq),
      ready: false,
      statusText: '',
      redlineCount: 0,
      // 台账 B12：默认按「接受新版原有修订后的正文」比对；rawMode 时原样比对（原有修订与比对结果叠加显示）
      rawMode: false,
      acceptedExisting: 0,
      webviewEl: null,
      executor: null,
    }
  },
  mounted() {
    this.start(false)
  },
  beforeUnmount() {
    this.teardown()
  },
  methods: {
    // compare_document 每台实例只能调一次（结尾 .uno:EditDoc 是 toggle），切换比对方式就整台重建。
    async restart(raw) {
      this.teardown()
      this.ready = false
      this.redlineCount = 0
      this.acceptedExisting = 0
      await this.start(raw)
    },
    teardown() {
      if (this._bootTimeout) clearTimeout(this._bootTimeout)
      try { if (this.executor && typeof this.executor.dispose === 'function') this.executor.dispose() } catch (e) { /* ignore */ }
      try { if (this.webviewEl && this.webviewEl.remove) this.webviewEl.remove() } catch (e) { /* ignore */ }
      this.webviewEl = null
      this.executor = null
    },
    async start(raw) {
      this.rawMode = !!raw
      this.statusText = this.$t('version.compareTabPreparing')
      try {
        const api = host.zetaoffice
        if (!api || typeof api.getEditor !== 'function') {
          this.statusText = this.$t('version.compareTabUnsupportedEnv')
          return
        }
        const spec = this.compareSpec
        // 字节下载与引擎启动并行——两者互不依赖，串行只会白白拉长等待。
        // catch 必须在 await 引擎之前就挂上：下载先失败（典型是后端回「这一版里
        // 没有这份文件」）时，这个 promise 还没人 await，会变成 unhandledrejection，
        // 而律师看到的是 150 秒后的引擎超时文案——真实原因被埋在后面。先把错误
        // 暂存下来，等下面顺序走到取字节时再抛。
        let bytesError = null
        const bytesPromise = Promise.all([
          fetchVersionFileBytes(spec.projectId, spec.newRef, spec.path),
          fetchVersionFileBytes(spec.projectId, spec.oldRef, spec.path),
        ]).catch((e) => { bytesError = e || new Error(this.$t('version.compareFetchBytesFailed')); return null })
        // { kind:'webview', url, preload, partition } | { kind:'iframe', url }
        const info = await api.getEditor()
        await this.mountEditor(info) // resolves once 引擎端点就绪（onReady 握手），此前不发命令
        const bytes = await bytesPromise
        if (bytesError) throw bytesError
        const [newBytes, oldBytes] = bytes || []
        // 空的新版字节进 load_document 只会得到一个空白文档，再 compare 出满篇「删除」
        // 修订——那是假的对比结果，比报错更糟。直接失败。
        if (!newBytes || !newBytes.length) throw new Error(this.$t('version.compareEmptyContent'))
        assertNotPasswordProtected(spec.path, newBytes, oldBytes)
        this.statusText = this.$t('version.compareTabGenerating')
        const name = spec.path.split('/').pop() || 'compare.docx'
        const loaded = await this.executor.executeCommand('load_document', {
          bytes: newBytes, name, authorName: this.$t('version.compareAuthorName'),
        })
        if (!loaded || loaded.success === false) throw new Error(this.$t('version.compareLoadNewFailed'))
        // 每实例只能调一次：结尾会派发 .uno:EditDoc（toggle）切回只读。
        const cmp = await this.executor.executeCommand('compare_document', { baseBytes: oldBytes, acceptExisting: !this.rawMode })
        if (!cmp || cmp.success !== true) throw new Error(this.$t('version.compareGenerateFailed'))
        this.redlineCount = cmp.redlineCount || 0
        this.acceptedExisting = cmp.acceptedExisting || 0
        this.ready = true
      } catch (e) {
        console.warn('[VersionCompare] 失败', e)
        this.statusText = isPasswordProtectedError(e) ? this.$t('version.officePasswordProtected') : ((e && e.message) || this.$t('version.compareFailedRetry'))
      }
    },
    // 挂载 <webview>，等到引擎端点就绪（lo-relay 的 onReady 握手）才 resolve——
    // 与 LibreOfficeEditor.onDomReady/onEndpointReady 是同一套两段式握手：
    // dom-ready 只说明 webview 渲染进程起来了，onReady 才说明 office 端点起来、
    // 命令不会被丢——真实签名见 useZetaOfficeWebview.js:54 起
    // （createWebviewEditorExecutor(el, {onReady}) ，没有 whenReady()）。
    mountEditor(info) {
      return new Promise((resolve, reject) => {
        const mountEl = document.getElementById(this.hostId)
        if (!mountEl) { reject(new Error('host missing')); return }
        // 引擎启动超时：150秒（WASM 编译 + 排版引擎约 90秒，留余量）。
        // onReady / did-fail-load 先到时清除，防止引擎挂死时 Promise 永不 settle。
        this._bootTimeout = setTimeout(() => {
          reject(new Error(this.$t('version.compareTimeout')))
        }, 150000)
        const onReady = () => {
          clearTimeout(this._bootTimeout)
          resolve()
        }
        let el
        if (info.kind === 'iframe') {
          // Web 服务器版：同源 iframe，跨源隔离靠站点级 COOP/COEP（不能加 sandbox）。
          el = document.createElement('iframe')
          try {
            // 只读宿主：不订阅 modified（没有自动保存这回事）。
            this.executor = createIframeEditorExecutor(el, { onReady })
          } catch (e) {
            clearTimeout(this._bootTimeout)
            reject(e)
            return
          }
          el.addEventListener('error', () => {
            clearTimeout(this._bootTimeout)
            reject(new Error(this.$t('version.compareIframeLoadFailed')))
          })
          el.src = info.url
        } else {
          el = document.createElement('webview')
          el.setAttribute('partition', info.partition)
          if (info.preload) el.setAttribute('preload', info.preload)
          el.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no')
          el.addEventListener('dom-ready', () => {
            if (this.executor) return // dom-ready 可能因页内导航重复触发
            try {
              this.executor = createWebviewEditorExecutor(el, { onReady })
            } catch (e) {
              clearTimeout(this._bootTimeout)
              reject(e)
            }
          })
          el.addEventListener('did-fail-load', (e) => {
            clearTimeout(this._bootTimeout)
            reject(new Error('did-fail-load: ' + (e.errorDescription || e.errorCode)))
          })
          el.src = info.url
        }
        el.style.width = '100%'; el.style.height = '100%'; el.style.border = '0'
        mountEl.appendChild(el)
        this.webviewEl = el
      })
    },
  },
}
</script>

<style lang="scss" scoped>
.vcmp-root { position: relative; display: flex; flex-direction: column; height: 100%; }
// 状态卡片是叠在宿主上的覆盖层，不是它的兄弟占位块——宿主必须一直有真实尺寸，
// 否则隐藏子树里的 <webview> 不 attach（见模板顶部注释）。
.vcmp-status {
  position: absolute; inset: 0; z-index: 2;
  display: flex; align-items: center; justify-content: center;
  background: var(--awd-surface); color: var(--awd-text-3); font-size: 26rpx;
}
.vcmp-host { flex: 1; min-height: 0; }
.vcmp-banner {
  padding: 10rpx 20rpx; background: var(--awd-warning-soft); border-top: 1px solid var(--awd-border);
  font-size: 23rpx; color: var(--awd-text-2);
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4rpx 16rpx;
}
.vcmp-note { color: var(--awd-text-3); }
.vcmp-switch { color: var(--awd-accent); cursor: pointer; text-decoration: underline; }
</style>
