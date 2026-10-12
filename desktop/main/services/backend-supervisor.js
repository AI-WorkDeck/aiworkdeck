// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const { probeExternalBackendHealth } = require('./backend-service')

// 只监督本壳创建的子进程；外部开发后端只检测，不接管、不杀进程。
class BackendSupervisor {
  constructor(services, onChange, options = {}) {
    this.services = services
    this.onChange = onChange
    this.options = { intervalMs: 10000, failureThreshold: 3, resumeGraceMs: 30000,
      stableMs: 300000, retryDelays: [5000, 15000, 45000], ...options }
    this.now = options.now || Date.now
    this.snapshot = { state: 'starting', ok: false, owned: false, attempts: 0, reason: '', updatedAt: this.now() }
    this.failures = 0
    this.attempts = 0
    this.healthySince = null
    this.nextAttemptAt = null
    this.graceUntil = 0
    this.stopped = false
    this.suspended = false
    this.generation = 0
  }

  getHealth() { return { ...this.snapshot } }

  publish(state, reason = '') {
    const owned = this.services.isOwned('backend')
    if (this.snapshot.state === state && this.snapshot.reason === reason &&
        this.snapshot.attempts === this.attempts && this.snapshot.owned === owned) return
    this.snapshot = { state, ok: state === 'healthy', owned, attempts: this.attempts, reason, updatedAt: this.now() }
    this.onChange(this.getHealth())
  }

  bindPowerMonitor(monitor) {
    const suspend = () => this.suspend()
    const resume = () => this.resume()
    monitor.on('suspend', suspend)
    monitor.on('resume', resume)
    this.detachPowerMonitor = () => {
      monitor.removeListener('suspend', suspend)
      monitor.removeListener('resume', resume)
    }
  }

  start() {
    if (this.timer || this.stopped) return
    this.timer = setInterval(() => { this.check().catch(() => {}) }, this.options.intervalMs)
    this.timer.unref?.()
    this.check().catch(() => {})
  }

  async check() {
    if (this.stopped || this.suspended || this.checking || this.recovering || this.services.isBusy('backend')) return
    this.checking = true
    const generation = this.generation
    try {
      const owned = this.services.isOwned('backend')
      const port = this.services.ports.backend
      // 自己的 child 退出时不被同端口的陌生 HTTP 响应冒充为健康。
      let external
      const healthy = owned
        ? !!this.services.procs.get('backend') && await this.services.checkHealth('backend')
        : (external = await probeExternalBackendHealth(port)).healthy
      if (this.stopped || this.suspended || generation !== this.generation) return
      if (healthy) {
        this.failures = 0
        this.nextAttemptAt = null
        if (this.healthySince == null) this.healthySince = this.now()
        if (this.now() - this.healthySince >= this.options.stableMs) this.attempts = 0
        this.publish('healthy')
        return
      }
      this.healthySince = null
      if (external?.legacy) { this.publish('degraded', 'external-health-unverified'); return }
      if (this.now() < this.graceUntil) return
      this.failures++
      if (!owned) { this.publish('failed', 'external-backend'); return }
      if (this.attempts >= this.options.retryDelays.length) { this.publish('failed', 'retry-limit'); return }
      this.publish('degraded', 'health-check-failed')
      if (this.failures < this.options.failureThreshold) return
      if (this.nextAttemptAt == null) this.nextAttemptAt = this.now() + this.options.retryDelays[this.attempts]
      if (this.now() >= this.nextAttemptAt) await this.recover(false)
    } catch (e) {
      if (!this.stopped && !this.suspended && generation === this.generation) this.publish('failed', 'health-check-error')
    } finally { this.checking = false }
  }

  recover(manual = true) {
    if (this.recovering) return this.recovering
    if (this.stopped || this.suspended) return Promise.resolve({ ok: false, error: 'backend supervision paused' })
    // 故障的复用后端可能仍握着用户数据库，禁止另起 JVM 或按端口杀它。
    if (!this.services.isOwned('backend')) return Promise.resolve({ ok: false, error: 'external backend is not owned by this application' })
    this.generation++
    if (manual) this.attempts = 0
    this.attempts++
    this.publish('restarting', manual ? 'manual' : 'automatic')
    this.recovering = this.services.restart('backend').then((result) => {
      if (this.stopped || this.suspended) return result
      this.failures = 0
      this.nextAttemptAt = null
      this.healthySince = this.now()
      this.publish(result.ok ? 'healthy' : 'failed', result.ok ? '' : 'restart-failed')
      return result
    }).catch((e) => {
      this.healthySince = null
      this.nextAttemptAt = null
      if (!this.stopped && !this.suspended) this.publish(this.attempts >= this.options.retryDelays.length ? 'failed' : 'degraded', 'restart-failed')
      return { ok: false, error: String(e.message || e) }
    }).finally(() => { this.recovering = null })
    return this.recovering
  }

  suspend() {
    this.suspended = true
    this.generation++
    this.publish('suspended')
  }

  resume() {
    if (this.stopped) return
    this.suspended = false
    this.failures = 0
    this.nextAttemptAt = null
    this.healthySince = null
    this.graceUntil = this.now() + this.options.resumeGraceMs
    this.publish('starting', 'resume')
    this.check().catch(() => {})
  }

  stop() {
    this.stopped = true
    this.generation++
    this.detachPowerMonitor?.()
    clearInterval(this.timer)
    this.timer = null
    this.publish('stopped')
  }
}

module.exports = { BackendSupervisor }
