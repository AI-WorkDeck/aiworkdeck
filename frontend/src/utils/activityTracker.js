// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logActivity } from '@/services/api.js'
import { host } from '@/services/host.js'

// 「工作记录」开关跨启动保留（全局，不分项目）
export const RECORDING_STORAGE_KEY = 'awd_work_log_recording'
// 连续这么久没有动作（或主窗口不在前台 / 不可见）算空闲，整段从时长里扣掉
export const IDLE_THRESHOLD_MS = 5 * 60 * 1000
const PRESENCE_POLL_MS = 30 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']

function storage() {
    return typeof uni !== 'undefined' ? uni : null
}

/**
 * 工作记录：打开文件 / 网页标签时按会话（OPEN_FILE / OPEN_URL）计时，切走、停止或页面隐藏时上报。
 *
 * 空闲检测并在会话里（dev-board#1713）：
 * - 「最后一次有动作」lastActiveAt 由宿主 DOM 的键鼠事件推进；桌面端另外每 30 秒问一次主进程
 *   （主窗口是否在前台 + 系统空闲秒数），这样在编辑器 webview / 网页 BrowserView 里打字、滚动
 *   也算有动作。不用宿主 window 的 blur：编辑器 webview 获得焦点就会触发它，编辑时间会被切碎。
 * - 主窗口不在前台或页面不可见时不推进 lastActiveAt；距上次动作满 5 分钟即视为空闲，
 *   空闲段 = [上次动作, 恢复动作]，从会话时长里扣掉，并以
 *   `IdleSegments: <开始毫秒>-<结束毫秒>;...` 写进 metaInfo，供工作记录面板解析展示。
 */
export class ActivityTracker {
    constructor({ log = logActivity, presence = null } = {}) {
        this._log = log
        this._presence = presence
        this.isRecording = false
        this.suspended = false
        this.activeSession = null // { actionType, targetId, targetName, startTime, projectId, projectMeta, idleSegments }
        this.lastActiveAt = Date.now()
        this._watching = false
        this._pollTimer = null
        this.noteActivity = this.noteActivity.bind(this)
        this._onVisibility = this._onVisibility.bind(this)
        this._onDomActivity = this._onDomActivity.bind(this)
        try {
            const s = storage()
            this.isRecording = !!(s && s.getStorageSync(RECORDING_STORAGE_KEY))
        } catch (e) {
            this.isRecording = false
        }
    }

    setRecording(isRecording) {
        this.isRecording = !!isRecording
        try {
            const s = storage()
            if (s) s.setStorageSync(RECORDING_STORAGE_KEY, this.isRecording)
        } catch (e) {
            // ignore
        }
        if (this.isRecording) {
            this.lastActiveAt = Date.now()
            if (!this.suspended) this._watch()
        } else {
            this.flushActiveSession()
            this._unwatch()
        }
    }

    toggleRecording() {
        this.setRecording(!this.isRecording)
        return this.isRecording
    }

    getRecordingState() {
        return this.isRecording
    }

    // 页面级挂起 / 恢复：离开工作台、无项目工作区时停止计时，但不改用户的录制开关
    start() {
        this.suspended = false
        if (this.isRecording) this._watch()
    }

    stop() {
        this.flushActiveSession()
        this.suspended = true
        this._unwatch()
    }

    // projectId：结构化项目归属，供后端 /api/activity/history 按项目分类；
    // projectMeta 是旧的 "Project: 名称" 自由文本，为老展示逻辑保留兼容
    trackActivePage(actionType, targetId, targetName, projectId, projectMeta = '') {
        if (!this.isRecording || this.suspended) return
        this.flushActiveSession()
        this._watch()
        const now = Date.now()
        // 切标签 / 打开文件本身就是一次动作
        this.lastActiveAt = now
        this.activeSession = {
            actionType,
            targetId,
            targetName,
            startTime: now,
            projectId,
            projectMeta,
            idleSegments: []
        }
    }

    flushActiveSession() {
        const session = this.activeSession
        if (!session) return
        this.activeSession = null
        const endTime = Date.now()
        if (endTime - this.lastActiveAt >= IDLE_THRESHOLD_MS) {
            this._addIdle(session, this.lastActiveAt, endTime)
        }
        const idleMs = session.idleSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
        const duration = endTime - session.startTime - idleMs
        if (duration <= 100) return

        let metaInfo = session.projectMeta || ''
        if (session.idleSegments.length) {
            const segs = session.idleSegments.map(seg => `${seg.start}-${seg.end}`).join(';')
            metaInfo = (metaInfo ? metaInfo + '. ' : '') + `IdleSegments: ${segs}`
        }
        Promise.resolve()
            .then(() => this._log(session.actionType, session.targetId, session.targetName, duration, metaInfo, session.projectId))
            .catch(e => console.error('[ActivityTracker] Log active session failed', e))
    }

    // Log instant action (like OPEN_FILE, OPEN_URL)
    // Only logs if recording is enabled
    async logAction(actionType, targetId, targetName, duration = 0, metaInfo = '') {
        // Deprecated for session based tracking, but kept for compatibility if needed
        if (!this.isRecording) return
        try {
            await this._log(actionType, targetId, targetName, duration, metaInfo)
        } catch (e) {
            console.error('[ActivityTracker] Failed to log action', e)
        }
    }

    // 观察到一次动作（at 可以早于现在：由系统空闲秒数换算出的最后动作时刻）
    noteActivity(at) {
        const t = typeof at === 'number' ? at : Date.now()
        if (t <= this.lastActiveAt) return
        if (t - this.lastActiveAt >= IDLE_THRESHOLD_MS && this.activeSession) {
            this._addIdle(this.activeSession, this.lastActiveAt, t)
        }
        this.lastActiveAt = t
    }

    // 桌面端：主窗口在前台且页面可见时，用系统空闲秒数推算最后一次动作
    async pollPresence() {
        if (!this._presence) return
        let p = null
        try {
            p = await this._presence()
        } catch (e) {
            return
        }
        if (!p || !p.focused || !this._isVisible()) return
        const idleMs = Math.max(0, Number(p.idleSeconds) || 0) * 1000
        this.noteActivity(Date.now() - idleMs)
    }

    _addIdle(session, start, end) {
        const s = Math.max(start, session.startTime)
        if (end - s <= 0) return
        session.idleSegments.push({ start: s, end })
    }

    // 页面里的鼠标键盘事件：窗口不在前台时不算（macOS 上鼠标划过后台窗口也会收到 mousemove）
    _onDomActivity() {
        if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus()) return
        this.noteActivity()
    }

    _isVisible() {
        return typeof document === 'undefined' || document.visibilityState !== 'hidden'
    }

    _onVisibility() {
        if (this._isVisible()) this.noteActivity()
    }

    _watch() {
        if (this._watching) return
        this._watching = true
        if (typeof window !== 'undefined' && window.addEventListener) {
            ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, this._onDomActivity, { capture: true, passive: true }))
        }
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('visibilitychange', this._onVisibility)
        }
        if (this._presence) {
            this._pollTimer = setInterval(() => { this.pollPresence() }, PRESENCE_POLL_MS)
        }
    }

    _unwatch() {
        if (!this._watching) return
        this._watching = false
        if (typeof window !== 'undefined' && window.removeEventListener) {
            ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, this._onDomActivity, { capture: true }))
        }
        if (typeof document !== 'undefined' && document.removeEventListener) {
            document.removeEventListener('visibilitychange', this._onVisibility)
        }
        if (this._pollTimer) clearInterval(this._pollTimer)
        this._pollTimer = null
    }
}

// 桌面端才有；网页端 host.app 不存在，轮询拿到 null 什么都不做
function desktopPresence() {
    const app = host.app
    return app && typeof app.getPresence === 'function' ? app.getPresence() : null
}

export const activityTracker = new ActivityTracker({ presence: desktopPresence })
