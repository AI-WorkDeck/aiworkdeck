<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="session-bar">
    <template v-if="onDraft">
      <view class="session-status">
        <view class="session-dot draft-dot" />
        <text class="session-text">{{ $t('version.workingOnDraft', { name: onDraft.name }) }}</text>
      </view>
      <!-- 稿上同样要能「结束本次工作」并起名字：不给这个入口的话，稿上的改动只剩
           无名的自动存档，采纳之后历史里这一稿全是「修改了《X》」（真机反馈 B2）。
           走的是主线那条一模一样的命名流程（openNaming → end → endWorkSession），
           后端按「当前站在稿上」把它落成这一稿上的一笔命名版本，不并回主线。 -->
      <view class="session-actions">
        <component :is="'button'" type="button" class="session-btn session-btn-main" :disabled="busy" @click="openNaming">{{ $t('version.endSession') }}</component>
        <component :is="'button'" type="button" class="session-btn" :disabled="busy" @click="returnToMainline">{{ $t('version.returnToMainline') }}</component>
        <component :is="'button'" type="button" class="session-btn" :disabled="busy" @click="adopt">{{ $t('version.adoptDraft') }}</component>
        <component :is="'button'" type="button" class="session-btn session-btn-danger" :disabled="busy" @click="confirmAbandon">{{ $t('version.abandonDraft') }}</component>
      </view>
    </template>
    <template v-else-if="working || changedCount > 0">
      <view class="session-status">
        <view class="session-dot" />
        <text class="session-text">{{ changedCount ? $t('version.pendingFileCount', { count: changedCount }) : $t('version.changesAutoRecorded') }}</text>
      </view>
      <view class="session-actions">
        <component :is="'button'" type="button" class="session-btn session-btn-main" :disabled="busy" @click="openNaming">{{ $t('version.endSession') }}</component>
        <component :is="'button'" type="button" v-if="working" class="session-btn session-btn-danger" :disabled="busy" @click="confirmDiscard">{{ $t('version.discard') }}</component>
      </view>
    </template>
    <template v-else>
      <text class="session-text session-idle">{{ $t('version.noActiveSession') }}</text>
    </template>
    <text class="session-help">{{ $t('version.commitHistoryHelp') }}</text>

    <view v-if="naming" class="awd-mask" @tap.self="!busy && (naming = false)">
      <view class="awd-dialog">
        <view class="awd-header"><text class="awd-title">{{ $t('version.nameSessionTitle') }}</text></view>
        <view class="awd-body">
          <text class="session-help">{{ $t(cloudLinked && !onDraft ? 'version.commitCloudHelp' : 'version.commitLocalHelp') }}</text>
          <input
            v-model="title"
            class="awd-input"
            :disabled="busy"
            :placeholder="$t('version.sessionNamePlaceholder')"
          />
        </view>
        <view class="awd-footer">
          <view class="awd-btn awd-btn-secondary" :aria-disabled="busy" @tap="!busy && (naming = false)">{{ $t('common.cancel') }}</view>
          <view class="awd-btn awd-btn-primary" :aria-disabled="busy" @tap="end">{{ $t(busy ? 'version.committingChanges' : 'version.finish') }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import {
  endWorkSession, discardWorkSession,
  switchToMainline, adoptDraft, abandonDraft,
} from '@/services/api.js'

export default {
  name: 'WorkSessionBar',
  props: {
    working: { type: Boolean, default: false },
    changedCount: { type: Number, default: 0 },
    onDraft: { type: Object, default: null },
    beforeCommit: { type: Function, default: null },
    cloudLinked: { type: Boolean, default: false },
  },
  emits: ['ended', 'discarded', 'mainline-resumed', 'draft-adopted', 'draft-abandoned'],
  data() {
    return { naming: false, title: '', busy: false }
  },
  inject: ['projectId'],
  methods: {
    openNaming() {
      this.title = ''
      this.naming = true
    },
    async returnToMainline() {
      if (this.busy) return
      this.busy = true
      try {
        const res = await switchToMainline(this.projectId)
        const affectedFileIds = (res && res.data && res.data.affectedFileIds) || []
        this.$emit('mainline-resumed', affectedFileIds)
      } catch (e) {
        uni.showToast({ title: (e && e.message) || this.$t('version.returnMainlineFailed'), icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    // 成功但没生成版本（稿 tip 是主线祖先，没有实质内容可采纳）时后端带 notice，
    // 冲突（success=false）时不算失败——仓库进入待裁决态，交给三选一弹窗接手，
    // 这里只把已经变化的 affectedFileIds 转发出去（见 AdoptOutcome 注释）。
    async adopt() {
      if (this.busy) return
      this.busy = true
      try {
        const res = await adoptDraft(this.projectId, this.onDraft.id)
        const data = (res && res.data) || {}
        if (data.success && data.notice) {
          uni.showToast({ title: data.notice, icon: 'none' })
        }
        this.$emit('draft-adopted', data.affectedFileIds || [])
      } catch (e) {
        uni.showToast({ title: (e && e.message) || this.$t('version.adoptFailed'), icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    confirmAbandon() {
      uni.showModal({
        title: this.$t('version.abandonDraft'),
        content: this.$t('version.abandonDraftConfirmContent'),
        success: async (r) => {
          if (!r.confirm) return
          if (this.busy) return
          this.busy = true
          try {
            const res = await abandonDraft(this.projectId, this.onDraft.id)
            const affectedFileIds = (res && res.data && res.data.affectedFileIds) || []
            this.$emit('draft-abandoned', affectedFileIds)
          } catch (e) {
            uni.showToast({ title: (e && e.message) || this.$t('version.abandonFailed'), icon: 'none' })
          } finally {
            this.busy = false
          }
        },
      })
    },
    async end() {
      if (this.busy) return
      this.busy = true
      try {
        if (this.beforeCommit && await this.beforeCommit() === false) return
        const res = await endWorkSession(this.projectId, this.title)
        // notice = 结束成功但没生成版本（整段工作一个改动都没有）。后端刻意用返回值
        // 而不是异常表达：它已经把工作段收尾了，走 catch 分支会让弹窗卡开、状态条
        // 停在「工作中」，而后台其实早就结束了。
        const notice = (res && res.data && res.data.notice) || ''
        if (notice) uni.showToast({ title: notice, icon: 'none' })
        this.naming = false
        this.$emit('ended')
      } catch (e) {
        uni.showToast({ title: (e && e.message) || this.$t('version.endFailed'), icon: 'none' })
      } finally {
        this.busy = false
      }
    },
    confirmDiscard() {
      uni.showModal({
        title: this.$t('version.discardSessionTitle'),
        content: this.$t('version.discardSessionContent'),
        success: async (r) => {
          if (!r.confirm) return
          if (this.busy) return
          this.busy = true
          try {
            // 丢弃改写了磁盘（切回主线内容），打开中的编辑器必须跟着重载，
            // 否则下一次 autosave 会把刚被丢弃的工作原样写回去（同退回/切线）。
            const res = await discardWorkSession(this.projectId)
            const affectedFileIds = (res && res.data && res.data.affectedFileIds) || []
            this.$emit('discarded', affectedFileIds)
          } catch (e) {
            uni.showToast({ title: (e && e.message) || this.$t('version.discardFailed'), icon: 'none' })
          } finally {
            this.busy = false
          }
        },
      })
    },
  },
}
</script>

<style lang="scss" scoped>
.session-bar {
  display: flex; flex-direction: column; gap: var(--awd-panel-gap);
  padding: var(--awd-panel-gap) var(--awd-panel-pad-x);
}
.session-status { display: flex; align-items: center; gap: var(--awd-panel-gap); min-width: 0; }
.session-dot {
  flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--awd-warning);
}
.draft-dot { background: var(--awd-info); }
.session-text { min-width: 0; font-size: var(--awd-panel-fs); line-height: 1.5; color: var(--awd-panel-text); overflow-wrap: anywhere; }
.session-idle { color: var(--awd-panel-text-2); }
.session-help { display: block; font-size: var(--awd-panel-fs-meta); line-height: 1.6; color: var(--awd-text-2); margin-bottom: var(--awd-space-1); }
.session-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--awd-space-1) var(--awd-panel-gap); }
.session-btn {
  margin: 0; padding: var(--awd-space-1) var(--awd-panel-gap); max-width: 100%;
  min-height: var(--awd-panel-row-h); border: 0; border-radius: var(--awd-panel-radius);
  background: transparent; color: var(--awd-panel-text-2); font: inherit; font-size: var(--awd-panel-fs);
  line-height: 1.5; text-align: left; white-space: normal; overflow-wrap: anywhere; cursor: pointer;
  &::after { border: 0; }
  &:hover { background: var(--awd-panel-hover); }
  &:focus-visible { outline: var(--awd-focus-width) solid var(--awd-accent-text); outline-offset: var(--awd-focus-offset); }
  &:disabled { opacity: .5; cursor: default; }
}
.session-btn-main { background: var(--awd-panel-accent-wash); color: var(--awd-accent-text); }
.session-btn-danger { color: var(--awd-danger-text); }

.awd-btn {
  padding: 8px 18px; border-radius: 6px; font-size: 13.5px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.awd-btn-primary { background: var(--awd-accent); color: var(--awd-text-on-accent); }
.awd-btn-primary:hover { background: var(--awd-accent-hover); }
.awd-btn-secondary { background: var(--awd-surface); color: var(--awd-text-2); border: 1px solid var(--awd-border-strong); }
.awd-btn-secondary:hover { background: var(--awd-surface-2); }
.awd-btn-danger { background: var(--awd-surface); color: var(--awd-danger-text); border: 1px solid var(--awd-danger); }

.awd-mask {
  position: fixed; inset: 0; background: var(--awd-overlay);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
}
.awd-dialog {
  width: 380px; max-width: 90vw; background: var(--awd-surface); border-radius: 12px; overflow: hidden;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,.1), 0 10px 10px -5px rgba(0,0,0,.04);
}
.awd-header { padding: 18px 24px; border-bottom: 1px solid var(--awd-border-subtle); }
.awd-title { font-size: 16px; font-weight: 600; color: var(--awd-text); }
.awd-body { padding: 20px 24px; }
.awd-input {
  width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--awd-border-strong);
  border-radius: 6px; font-size: 14px; color: var(--awd-text); box-sizing: border-box;
}
.awd-footer {
  display: flex; justify-content: flex-end; gap: 12px;
  padding: 14px 24px; border-top: 1px solid var(--awd-border-subtle); background: var(--awd-bg);
}
</style>
