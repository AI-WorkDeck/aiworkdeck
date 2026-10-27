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

  publish(state, reason = '', verifiedLaunch) {
    const owned = this.services.isOwned('backend')
    if (this.snapshot.state === state && this.snapshot.reason === reason &&
        this.snapshot.attempts === this.attempts && this.snapshot.owned === owned &&
        (state !== 'healthy' || this.verifiedLaunch === verifiedLaunch)) return
    this.verifiedLaunch = state === 'healthy' ? verifiedLaunch : undefined
    this.snapshot = { state, ok: state === 'healthy', owned, attempts: this.attempts, reason, updatedAt: this.now() }
    // The launch is internal evidence, not part of the renderer-visible health snapshot.
    this.onChange(this.getHealth(), this.verifiedLaunch)
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
    if (this.monitoring || this.stopped) return
    this.monitoring = true
    this.poll()
  }

  poll() {
    clearTimeout(this.timer)
    this.timer = null
    this.check().catch(() => {}).finally(() => this.scheduleNextCheck())
  }

  scheduleNextCheck() {
    if (!this.monitoring || this.stopped) return
    clearTimeout(this.timer)
    const launch = this.services.getLaunch?.('backend')
    const remaining = launch?.deadline - this.now()
    const pendingStartup = !this.suspended && this.services.isOwned('backend') &&
      launch?.splitReadiness && !launch.fullReady && remaining > 0 &&
      this.services.procs.get('backend') === launch.process &&
      launch.process.exitCode == null && launch.process.signalCode == null
    // The renderer holds non-core requests until fullReady. Do not leave them waiting
    // for the normal ten-second runtime health interval after Spring becomes ready.
    const delay = pendingStartup ? Math.min(500, remaining, this.options.intervalMs) : this.options.intervalMs
    this.timer = setTimeout(() => this.poll(), delay)
    this.timer.unref?.()
  }

  async check() {
    if (this.stopped || this.suspended || this.checking || this.recovering || this.services.isBusy('backend')) return
    this.checking = true
    const generation = this.generation
    const owned = this.services.isOwned('backend')
    const checkedLaunch = owned ? this.services.getLaunch?.('backend') : undefined
    const checkedProcess = owned ? this.services.procs.get('backend') : undefined
    const current = () => owned === this.services.isOwned('backend') && (!owned ||
      (this.services.procs.get('backend') === checkedProcess &&
        (!this.services.getLaunch || this.services.getLaunch('backend') === checkedLaunch)))
    try {
      const port = this.services.ports.backend
      // 自己的 child 退出时不被同端口的陌生 HTTP 响应冒充为健康。
      let external
      const healthy = owned
        ? !!checkedProcess && await this.services.checkHealth('backend', checkedLaunch)
        : (external = await probeExternalBackendHealth(port)).healthy
      if (this.stopped || this.suspended || generation !== this.generation || !current()) return
      if (healthy) {
        this.failures = 0
        this.nextAttemptAt = null
        if (this.healthySince == null) this.healthySince = this.now()
        if (this.now() - this.healthySince >= this.options.stableMs) this.attempts = 0
        this.publish('healthy', '', checkedLaunch)
        return
      }
      this.healthySince = null
      if (external?.legacy) { this.publish('degraded', 'external-health-unverified'); return }
      const launch = checkedLaunch
      const pendingStartup = owned && launch?.splitReadiness && !launch.fullReady
      if (pendingStartup && this.services.procs.get('backend') === launch.process && this.now() < launch.deadline) {
        this.publish('starting', 'full-backend-starting')
        return
      }
      if (pendingStartup) {
        await this.reportStartupFailure(launch, 'full-startup-failed')
        if (this.stopped || this.suspended || generation !== this.generation || !current()) return
        // The original start deadline already elapsed (or the child exited); do not add
        // another three-probe grace window before scheduling the bounded recovery.
        this.failures = Math.max(this.failures, this.options.failureThreshold - 1)
      }
      if (this.now() < this.graceUntil) return
      this.failures++
      if (!owned) { this.publish('failed', 'external-backend'); return }
      if (this.attempts >= this.options.retryDelays.length) { this.publish('failed', 'retry-limit'); return }
      this.publish('degraded', pendingStartup ? 'full-startup-failed' : 'health-check-failed')
      if (this.failures < this.options.failureThreshold) return
      if (this.nextAttemptAt == null) this.nextAttemptAt = this.now() + this.options.retryDelays[this.attempts]
      if (this.now() >= this.nextAttemptAt) await this.recover(false)
    } catch (e) {
      if (!this.stopped && !this.suspended && generation === this.generation && current()) this.publish('failed', 'health-check-error')
    } finally { this.checking = false }
  }

  async reportStartupFailure(launch, reason) {
    if (!launch || launch.fullReady || launch.startupFailureReported) return
    launch.startupFailureReported = true
    await this.options.onStartupFailure?.(launch, reason)
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
    this.recovering = this.services.restart('backend').then(async (result) => {
      if (this.stopped || this.suspended) return result
      this.failures = 0
      this.nextAttemptAt = null
      const verifiedLaunch = result.launch
      const fullReady = result.ok && result.fullReady !== false && (!this.services.getLaunch ||
        (verifiedLaunch && this.services.getLaunch('backend') === verifiedLaunch && this.services.procs.get('backend') === verifiedLaunch.process))
      this.healthySince = fullReady ? this.now() : null
      if (!result.ok) await this.reportStartupFailure(this.services.getLaunch?.('backend'), 'restart-failed')
      if (!this.stopped && !this.suspended) this.publish(fullReady ? 'healthy' : result.ok ? 'starting' : 'failed',
        fullReady ? '' : result.ok ? 'full-backend-starting' : 'restart-failed', fullReady ? verifiedLaunch : undefined)
      return { ...result, fullReady: !!fullReady }
    }).catch(async (e) => {
      this.healthySince = null
      this.nextAttemptAt = null
      if (!this.stopped && !this.suspended) await this.reportStartupFailure(this.services.getLaunch?.('backend'), 'restart-failed')
      if (!this.stopped && !this.suspended) this.publish(this.attempts >= this.options.retryDelays.length ? 'failed' : 'degraded', 'restart-failed')
      return { ok: false, error: String(e.message || e) }
    }).finally(() => { this.recovering = null; this.scheduleNextCheck() })
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
    this.poll()
  }

  stop() {
    this.stopped = true
    this.monitoring = false
    this.generation++
    this.detachPowerMonitor?.()
    clearTimeout(this.timer)
    this.timer = null
    this.publish('stopped')
  }
}

module.exports = { BackendSupervisor }
