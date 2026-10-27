<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  macOS 系统权限引导弹窗（Codex 式首启权限排查 + 自动打开系统设置 + 拖拽应用浮窗，dev-board#1433）。
  由 App.vue 经 utils/permissionOnboarding.js 单独 createApp 挂在 <body> 下，
  遵循 FeedbackWidget.vue 同一标签纪律：一律用 div / span / img，不用会被 uni-h5 改写的 button。
-->
<template>
  <div class="awd-perm-root">
    <div v-if="visible" class="awd-perm-mask" @click.self="dismissModal">
      <div class="awd-perm-dialog" role="dialog" aria-modal="true">
        <div class="awd-perm-header">
          <div class="awd-perm-header-top">
            <span class="awd-perm-badge">{{ $t('admin.permissionsOnboardingBadge') }}</span>
            <div class="awd-perm-close" role="button" :title="$t('common.close')" @click="dismissModal">✕</div>
          </div>
          <div class="awd-perm-title">{{ $t('admin.permissionsOnboardingTitle') }}</div>
          <div class="awd-perm-subtitle">{{ $t('admin.permissionsOnboardingSubtitle') }}</div>
        </div>

        <div v-if="triggerReason === 'wechat-drop'" class="awd-perm-banner">
          <span class="awd-perm-banner-dot">!</span>
          <span class="awd-perm-banner-text">{{ $t('admin.permissionsWeChatDropBanner') }}</span>
        </div>

        <div class="awd-perm-list">
          <div
            v-for="item in displayItems"
            :key="item.id"
            class="awd-perm-row"
            :class="{
              'is-granted': item.status === 'granted',
              'is-focused': focusedId === item.id && item.status !== 'granted'
            }"
          >
            <div class="awd-perm-row-main">
              <div class="awd-perm-row-title-line">
                <span class="awd-perm-row-title">{{ item.title }}</span>
                <span v-if="item.requiredForWeChatDrop" class="awd-perm-tag awd-perm-tag--primary">
                  {{ $t('admin.permissionsTagWeChatRequired') }}
                </span>
                <span v-else-if="item.recommended" class="awd-perm-tag">
                  {{ $t('admin.permissionsTagRecommended') }}
                </span>
                <span v-else class="awd-perm-tag awd-perm-tag--muted">
                  {{ $t('admin.permissionsTagOptional') }}
                </span>
              </div>
              <div class="awd-perm-row-desc">{{ item.description }}</div>
            </div>

            <div class="awd-perm-row-right">
              <span
                class="awd-perm-status"
                :class="item.status === 'granted' ? 'awd-perm-status--ok' : 'awd-perm-status--pending'"
              >
                {{ item.status === 'granted' ? '✓ ' + $t('admin.permissionsStatusGranted') : $t('admin.permissionsStatusMissing') }}
              </span>
              <div
                class="awd-perm-btn"
                :class="item.status === 'granted' ? 'awd-perm-btn--ghost' : 'awd-perm-btn--primary'"
                role="button"
                @click="onRequestItem(item)"
              >
                {{ item.status === 'granted' ? $t('admin.permissionsReopenBtn') : $t('admin.permissionsGrantBtn') }}
              </div>
            </div>
          </div>
        </div>

        <div class="awd-perm-drag-box">
          <div class="awd-perm-drag-hint">{{ $t('admin.permissionsDragCardHint') }}</div>
          <div
            class="awd-perm-drag-card"
            draggable="true"
            @dragstart="onAppCardDragStart"
          >
            <div class="awd-perm-drag-app">
              <img v-if="appIconDataUrl" class="awd-perm-drag-icon" :src="appIconDataUrl" alt="AI WorkDeck" />
              <div v-else class="awd-perm-drag-icon-fallback">AW</div>
              <div class="awd-perm-drag-meta">
                <div class="awd-perm-drag-name">{{ appBundleName }}</div>
                <div class="awd-perm-drag-path">{{ appBundlePath || '/Applications/AI WorkDeck.app' }}</div>
              </div>
            </div>
            <div class="awd-perm-drag-pill">{{ $t('admin.permissionsDragActionPill') }}</div>
          </div>
        </div>

        <div class="awd-perm-footer">
          <div class="awd-perm-footer-left">
            <div class="awd-perm-btn awd-perm-btn--ghost" role="button" @click="refreshStatus">
              {{ $t('admin.permissionsRefreshBtn') }}
            </div>
          </div>
          <div class="awd-perm-footer-right">
            <div class="awd-perm-btn awd-perm-btn--ghost" role="button" @click="dismissModal">
              {{ allRecommendedGranted ? $t('admin.permissionsDoneBtn') : $t('admin.permissionsSkipBtn') }}
            </div>
            <div
              v-if="!allGranted"
              class="awd-perm-btn awd-perm-btn--primary"
              role="button"
              @click="setupAllMissing"
            >
              {{ $t('admin.permissionsSetupAllBtn') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { host } from '@/services/host.js'
import { setGlobalOverlay } from '@/utils/overlayState.js'
import {
  PERMISSION_ONBOARDING_EVENT,
  PERMISSION_ONBOARDING_PREF_KEY,
  normalizePermissionItems,
  shouldAutoPromptPermissionOnboarding,
  nextMissingPermissionId,
} from '@/utils/permissionOnboarding.js'

const OVERLAY_KEY = 'permission-onboarding'

export default {
  name: 'PermissionOnboardingModal',
  data() {
    return {
      visible: false,
      supported: false,
      items: [],
      appBundleName: 'AI WorkDeck.app',
      appBundlePath: '',
      appIconDataUrl: '',
      focusedId: 'fullDiskAccess',
      triggerReason: '',
      autoStepQueue: [],
    }
  },
  computed: {
    displayItems() {
      const normalized = normalizePermissionItems(this.items)
      const metaById = {
        fullDiskAccess: {
          title: this.$t('admin.permFullDiskAccessTitle'),
          description: this.$t('admin.permFullDiskAccessDesc'),
        },
        screenRecording: {
          title: this.$t('admin.permScreenRecordingTitle'),
          description: this.$t('admin.permScreenRecordingDesc'),
        },
        microphone: {
          title: this.$t('admin.permMicrophoneTitle'),
          description: this.$t('admin.permMicrophoneDesc'),
        },
        accessibility: {
          title: this.$t('admin.permAccessibilityTitle'),
          description: this.$t('admin.permAccessibilityDesc'),
        },
      }
      return normalized.map((item) => ({
        ...item,
        ...(metaById[item.id] || { title: item.id, description: '' }),
      }))
    },
    allGranted() {
      return this.displayItems.length > 0 && this.displayItems.every((i) => i.status === 'granted')
    },
    allRecommendedGranted() {
      return this.displayItems.filter((i) => i.recommended).every((i) => i.status === 'granted')
    },
  },
  watch: {
    visible(v) {
      setGlobalOverlay(!!v, OVERLAY_KEY)
    },
  },
  mounted() {
    this._onOpenEvent = (payload) => this.openModal(payload || {})
    try { uni.$on(PERMISSION_ONBOARDING_EVENT, this._onOpenEvent) } catch (_) { /* ignore */ }
    if (host.permissions && typeof host.permissions.onUpdated === 'function') {
      this._unsubUpdated = host.permissions.onUpdated((state) => {
        this.applyPermissionsState(state, true)
      })
    }
    this.checkStartupOnboarding()
  },
  beforeUnmount() {
    setGlobalOverlay(false, OVERLAY_KEY)
    if (this._onOpenEvent) {
      try { uni.$off(PERMISSION_ONBOARDING_EVENT, this._onOpenEvent) } catch (_) { /* ignore */ }
      this._onOpenEvent = null
    }
    if (this._unsubUpdated) {
      this._unsubUpdated()
      this._unsubUpdated = null
    }
  },
  methods: {
    applyPermissionsState(state, fromUpdate = false) {
      if (!state || typeof state !== 'object') return
      this.supported = !!state.supported
      this.items = Array.isArray(state.items) ? state.items : []
      if (state.appBundleName) this.appBundleName = state.appBundleName
      if (state.appBundlePath) this.appBundlePath = state.appBundlePath
      if (state.appIconDataUrl) this.appIconDataUrl = state.appIconDataUrl

      if (fromUpdate && this.autoStepQueue.length > 0) {
        const currentTarget = this.autoStepQueue[0]
        const found = this.items.find((i) => i.id === currentTarget)
        if (found && found.status === 'granted') {
          this.autoStepQueue.shift()
          const nextId = nextMissingPermissionId(this.items, this.autoStepQueue[0] || '')
          if (nextId && this.autoStepQueue.length > 0) {
            this.focusedId = nextId
            setTimeout(() => {
              if (this.visible) this.requestPermissionById(nextId)
            }, 600)
          } else {
            this.autoStepQueue = []
          }
        }
      }
    },
    async refreshStatus() {
      if (!host.permissions || typeof host.permissions.getStatus !== 'function') return null
      try {
        const state = await host.permissions.getStatus()
        this.applyPermissionsState(state)
        return state
      } catch (_) {
        return null
      }
    },
    async checkStartupOnboarding() {
      const state = await this.refreshStatus()
      if (!state || !state.supported) return
      let done = false
      try {
        if (host.prefs && typeof host.prefs.get === 'function') {
          const r = await host.prefs.get({ key: PERMISSION_ONBOARDING_PREF_KEY })
          done = !!(r && r.value)
        }
      } catch (_) { /* ignore */ }
      if (shouldAutoPromptPermissionOnboarding(state, done)) {
        this.focusedId = nextMissingPermissionId(state.items, 'fullDiskAccess') || 'fullDiskAccess'
        this.triggerReason = 'startup'
        this.visible = true
      }
    },
    async openModal(payload = {}) {
      const state = await this.refreshStatus()
      if (!state || !state.supported) return
      const focus = payload && payload.focus ? String(payload.focus) : ''
      this.focusedId = focus || nextMissingPermissionId(state.items, 'fullDiskAccess') || 'fullDiskAccess'
      this.triggerReason = (payload && payload.reason) || 'manual'
      this.visible = true
      if (payload && payload.autoOpenSettings && this.focusedId) {
        this.requestPermissionById(this.focusedId)
      }
    },
    async markOnboardingSeen() {
      try {
        if (host.prefs && typeof host.prefs.set === 'function') {
          await host.prefs.set({ key: PERMISSION_ONBOARDING_PREF_KEY, value: true })
        }
      } catch (_) { /* ignore */ }
    },
    dismissModal() {
      this.autoStepQueue = []
      this.visible = false
      this.markOnboardingSeen()
      try {
        if (host.permissions && typeof host.permissions.closeHelper === 'function') {
          host.permissions.closeHelper()
        }
      } catch (_) { /* ignore */ }
    },
    async onRequestItem(item) {
      if (!item || !item.id) return
      this.focusedId = item.id
      await this.requestPermissionById(item.id, item.status === 'granted')
    },
    async requestPermissionById(id, forceOpenSettings = false) {
      if (!host.permissions) return
      try {
        if (forceOpenSettings && typeof host.permissions.openSettings === 'function') {
          await host.permissions.openSettings(id, { showFloatingHelper: true })
        } else if (typeof host.permissions.request === 'function') {
          await host.permissions.request(id, { showFloatingHelper: true })
        }
        await this.refreshStatus()
      } catch (_) { /* ignore */ }
    },
    async setupAllMissing() {
      const missing = this.displayItems.filter((i) => i.status !== 'granted').map((i) => i.id)
      if (!missing.length) {
        this.dismissModal()
        return
      }
      this.autoStepQueue = missing.slice()
      const firstId = this.autoStepQueue[0]
      this.focusedId = firstId
      await this.requestPermissionById(firstId, false)
    },
    onAppCardDragStart(e) {
      const native = (e && e.dataTransfer ? e : (typeof window !== 'undefined' && window.event)) || e
      if (native && typeof native.preventDefault === 'function') {
        native.preventDefault()
      }
      if (host.permissions && typeof host.permissions.startAppDrag === 'function') {
        host.permissions.startAppDrag()
      }
    },
  },
}
</script>

<style scoped>
.awd-perm-mask {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(20, 18, 15, 0.48);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.awd-perm-dialog {
  width: 100%;
  max-width: 580px;
  background: var(--awd-surface, #FCFBF7);
  color: var(--awd-text, #2B2A26);
  border: 1px solid var(--awd-border, #DDD8CA);
  border-radius: 16px;
  box-shadow: 0 22px 56px rgba(0, 0, 0, 0.24);
  padding: 22px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.awd-perm-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.awd-perm-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(46, 90, 80, 0.12);
  color: var(--awd-accent-text, #2E5A50);
}

.awd-perm-close {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--awd-text-2, #6B675C);
  font-size: 15px;
}
.awd-perm-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--awd-text, #2B2A26);
}

.awd-perm-title {
  margin-top: 8px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.awd-perm-subtitle {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--awd-text-2, #6B675C);
}

.awd-perm-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 13px;
  border-radius: 10px;
  background: rgba(196, 127, 23, 0.12);
  border: 1px solid rgba(196, 127, 23, 0.32);
  font-size: 12.5px;
  line-height: 1.45;
}

.awd-perm-banner-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #C47F17;
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.awd-perm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.awd-perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--awd-surface-2, #F4F1E8);
  border: 1px solid var(--awd-border, #DDD8CA);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.awd-perm-row.is-focused {
  border-color: var(--awd-accent-text, #2E5A50);
  box-shadow: 0 0 0 2px rgba(46, 90, 80, 0.12);
}

.awd-perm-row.is-granted {
  opacity: 0.92;
}

.awd-perm-row-main {
  flex: 1;
  min-width: 0;
}

.awd-perm-row-title-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.awd-perm-row-title {
  font-size: 14px;
  font-weight: 600;
}

.awd-perm-tag {
  padding: 1px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(46, 90, 80, 0.12);
  color: var(--awd-accent-text, #2E5A50);
}

.awd-perm-tag--primary {
  background: #2E5A50;
  color: #fff;
}

.awd-perm-tag--muted {
  background: rgba(107, 103, 92, 0.14);
  color: var(--awd-text-2, #6B675C);
}

.awd-perm-row-desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--awd-text-2, #6B675C);
}

.awd-perm-row-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.awd-perm-status {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.awd-perm-status--ok {
  color: #256F46;
}

.awd-perm-status--pending {
  color: #B86E14;
}

.awd-perm-drag-box {
  padding: 11px 14px;
  border-radius: 12px;
  border: 1.5px dashed var(--awd-accent-text, #2E5A50);
  background: rgba(46, 90, 80, 0.05);
}

.awd-perm-drag-hint {
  font-size: 11.5px;
  color: var(--awd-text-2, #6B675C);
  margin-bottom: 8px;
}

.awd-perm-drag-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--awd-surface, #FCFBF7);
  border: 1px solid var(--awd-border, #DDD8CA);
  cursor: grab;
}
.awd-perm-drag-card:active {
  cursor: grabbing;
}

.awd-perm-drag-app {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.awd-perm-drag-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: contain;
}

.awd-perm-drag-icon-fallback {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #2E5A50;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.awd-perm-drag-name {
  font-size: 13px;
  font-weight: 600;
}

.awd-perm-drag-path {
  font-size: 11px;
  color: var(--awd-text-2, #6B675C);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

.awd-perm-drag-pill {
  padding: 5px 10px;
  border-radius: 8px;
  background: #2E5A50;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.awd-perm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
}

.awd-perm-footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.awd-perm-btn {
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.awd-perm-btn--primary {
  background: #2E5A50;
  color: #fff;
}
.awd-perm-btn--primary:hover {
  opacity: 0.92;
}

.awd-perm-btn--ghost {
  background: transparent;
  border: 1px solid var(--awd-border, #DDD8CA);
  color: var(--awd-text, #2B2A26);
}
.awd-perm-btn--ghost:hover {
  background: rgba(0, 0, 0, 0.04);
}
</style>
