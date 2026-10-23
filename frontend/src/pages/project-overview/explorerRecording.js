// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { getMeetingRecordings, getMeetingAsrNotice } from '@/services/api.js'
import { recorderState, isRecordingActive, startRecording } from '@/utils/meetingRecorder.js'

// The explorer click is a host-owned recording action. Plugin-initiated starts
// still go through their existing permission checks and confirmation dialog.
export default {
  onHide() {
    // Minimizing the window also calls onHide; only navigation cancels a start.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    this.cancelExplorerRecordingStart()
  },
  onUnload() { this.cancelExplorerRecordingStart() },
  beforeUnmount() { this.cancelExplorerRecordingStart() },
  methods: {
    cancelExplorerRecordingStart() {
      this._explorerRecordingRequest?.abort()
    },
    async openExplorerRecordingPanel(isCurrent = () => true) {
      if (!this.dynamicPluginsLoaded) await this.loadDynamicPlugins()
      if (!isCurrent()) return false
      if (!this.meetingRecorderEnabled) {
        this.openMarketDetail({ kind: 'plugin', id: 'voice', name: this.$t('config.sidebar.voice') })
        uni.showToast({ title: this.$t('fileTree.recordingPluginRequired'), icon: 'none' })
        return false
      }
      this.openPanelInItsDock('voice')
      // PluginPane queues this command until the iframe has subscribed.
      await this.$nextTick()
      if (!isCurrent()) return false
      this.sendExplorerRecordingFocus()
      return true
    },
    sendExplorerRecordingFocus() {
      const meetingId = String(recorderState.projectId) === String(this.projectId)
        ? recorderState.meetingId : null
      uni.$emit('awd:plugin-sidebar-command', { pluginId: 'voice', command: 'recording-focus', meetingId })
    },
    async focusExplorerRecording() {
      await this.openExplorerRecordingPanel(() => this.isActiveOverviewInstance())
      if (isRecordingActive() && String(recorderState.projectId) !== String(this.projectId)) {
        uni.showToast({ title: this.$t('meeting.otherProjectRecording'), icon: 'none' })
      }
    },
    async onCreateRecording() {
      if (isRecordingActive()) return this.focusExplorerRecording()
      if (!this.projectId || !this.canWriteProject || this._explorerRecordingRequest) return
      const projectId = this.projectId
      const controller = new AbortController()
      this._explorerRecordingRequest = controller
      const isCurrent = () => !controller.signal.aborted
        && String(this.projectId) === String(projectId) && this.isActiveOverviewInstance()
      try {
        if (!(await this.openExplorerRecordingPanel(isCurrent))) return
        // Resolve the project's actual tier before asking for the microphone.
        // Keep the same cloud notice gate as pluginVoiceServices.start.
        const data = await getMeetingRecordings(projectId)
        if (!isCurrent()) return
        if (data.tier !== 'local') {
          const notice = await getMeetingAsrNotice()
          if (!isCurrent()) return
          if (data.tier === 'platform' && notice && !notice.acknowledged) {
            uni.showToast({ title: this.$t('fileTree.recordingNoticeRequired'), icon: 'none' })
            return
          }
        }
        if (isRecordingActive()) return this.focusExplorerRecording()
        if (!this.canWriteProject || !this.meetingRecorderEnabled) return
        // A fresh explorer start follows the system default microphone.
        // The singleton cancels safely if navigation happens during permission
        // or meeting creation, and continues independently once recording.
        await startRecording(projectId, undefined, { signal: controller.signal, isCurrent })
        if (isCurrent()) this.sendExplorerRecordingFocus()
      } catch (error) {
        if (isCurrent() && error?.code !== 'cancelled') {
          uni.showToast({ title: error?.message || this.$t('meeting.cannotStartRecording'), icon: 'none' })
        }
      } finally {
        if (this._explorerRecordingRequest === controller) this._explorerRecordingRequest = null
      }
    },
  },
}
