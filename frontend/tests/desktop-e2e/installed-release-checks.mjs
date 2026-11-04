// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real signed bundle only. API calls below create synthetic local fixtures, never mock responses.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export async function captureDesktop(run, name) {
  const dest = path.join(run, `${name}-desktop.png`)
  if (process.platform === 'darwin') execFileSync('/usr/sbin/screencapture', ['-x', dest], { timeout: 15000 })
  else {
    const script = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
$b = [Windows.Forms.SystemInformation]::VirtualScreen
$i = New-Object Drawing.Bitmap($b.Width, $b.Height)
$g = [Drawing.Graphics]::FromImage($i)
try { $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size); $i.Save($env:AWD_SCREENSHOT_PATH, [Drawing.Imaging.ImageFormat]::Png) } finally { $g.Dispose(); $i.Dispose() }`
    execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 20000, env: { ...process.env, AWD_SCREENSHOT_PATH: dest } })
  }
  assert.ok(fs.statSync(dest).size > 0)
  return path.basename(dest)
}

export function nativeClose(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0)
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  if (process.platform === 'darwin') {
    execFileSync('/usr/bin/osascript', ['-e', `tell application "System Events"
set targetProcess to first application process whose unix id is ${pid}
tell targetProcess
set frontmost to true
click (first button of front window whose subrole is "AXCloseButton")
end tell
end tell`], { timeout: 15000 })
    return 'macOS System Events AXCloseButton click (accessibility action; not physical mouse)'
  }
  assert.equal(process.platform, 'win32')
  const script = `Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
$p = Get-Process -Id ${pid}
$w = [Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$c = $w.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, 'Close')))
if ($null -eq $c) { throw 'Native Close button not exposed by UIAutomation' }
$c.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()`
  execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 15000 })
  return 'Windows native Close button UIAutomation InvokePattern (accessibility action; not physical mouse)'
}

export async function checkWelcomeModel({ page, run }) {
  await page.waitForSelector('[data-quick="model"]', { visible: true })
  await captureDesktop(run, 'release-welcome-model')
  const catalog = page.waitForResponse(r => new URL(r.url()).pathname === '/api/ai/models')
  await page.click('[data-quick="model"]')
  await catalog
  await page.waitForSelector('.welcome-model-dropdown', { visible: true })
  // The real anonymous catalog may require account login. Never inject model data.
  await page.waitForFunction(() => document.querySelector('.awd-login-mask') || document.querySelector('.welcome-model-dropdown .model-auto-option'))
  const login = await page.$('.awd-login-mask')
  if (login) {
    await captureDesktop(run, 'release-welcome-model-account-required')
    await page.click('.awd-login-close')
    await page.click('[data-quick="model"]')
    return { catalogRequiredAccount: true, transfer: 'not exercised: real anonymous catalog requires account; no fabricated catalog or paid generation' }
  }
  await page.waitForSelector('.welcome-model-dropdown .model-auto-option', { visible: true })
  const selectedName = await page.$eval('.welcome-model-dropdown .model-auto-name', el => el.textContent.trim())
  await page.click('.welcome-model-dropdown .model-auto-option') // automatic mode, no paid request
  await page.waitForSelector('.welcome-model-dropdown', { hidden: true })
  await page.click('[data-quick="send"]') // empty prompt creates conversation without generation
  await page.waitForFunction(selectedName => (localStorage.getItem('ai_selected_model') || '').includes('auto') && [...document.querySelectorAll('.model-name')].some(el => el.getBoundingClientRect().width > 0 && el.textContent.trim() === selectedName), {}, selectedName)
  await captureDesktop(run, 'release-welcome-model-transferred')
  return { selected: 'auto', generationRequested: false, catalogRequiredAccount: !!login, transfer: 'actual empty-prompt entry; persisted auto and visible ChatInterface model name' }
}


export function assertDocumentBinding(state, ext) {
  assert.equal(state.insightDocFileId || null, ext === 'docx' ? state.fileId : null)
  if (state.insightInstalled) assert.equal(state.insightAvailable, ext === 'docx')
}

export async function checkWriterReplacement({ page, run, previousId }) {
  const id = await page.evaluate(() => window.__checkbaActiveOverviewVm.insightDocFileId)
  assert.ok(id && id !== previousId, 'Opening a different Writer must replace the evidence document id')
  return { previousId, fileId: id, screenshot: await captureDesktop(run, 'release-second-writer-binding') }
}

export async function checkClosedDocument({ page, run, ext }) {
  await page.waitForFunction(() => {
    const v = window.__checkbaActiveOverviewVm
    return !v.insightDocFileId && v.rightPaneKey !== 'plugin-insight' && v.leftPaneKey !== 'plugin-insight'
  })
  return captureDesktop(run, `release-${ext}-closed-evidence-hidden`)
}

export async function checkDocumentChrome({ page, run, ext }) {
  const state = await page.evaluate(() => {
    const v = window.__checkbaActiveOverviewVm
    return { fileId: v.activeFileLeft?.id, insightDocFileId: v.insightDocFileId,
      insightInstalled: v.dynamicPlugins.some(p => p.pluginId === 'insight'),
      insightAvailable: v.documentAvailablePlugins.some(p => p.pluginId === 'insight') }
  })
  assertDocumentBinding(state, ext)
  const screenshots = [await captureDesktop(run, `release-${ext}-first-visible`)]
  if (ext === 'docx' && state.insightInstalled) {
    const label = await page.evaluate(() => window.__checkbaActiveOverviewVm.dynamicPlugins.find(p => p.pluginId === 'insight').label)
    const candidates = await page.$$('.rail-btn, .right-dock-tab')
    let entry
    for (const candidate of candidates) {
      if (await candidate.isVisible() && await candidate.evaluate((el, label) => el.title === label || el.textContent.trim() === label, label)) { entry = candidate; break }
    }
    assert.ok(entry, 'Writer must expose a visible evidence entry')
    await entry.click()
    await page.waitForFunction(() => window.__checkbaActiveOverviewVm.insightPaneOpen)
    screenshots.push(await captureDesktop(run, 'release-writer-evidence-panel'))
  }
  // Toggle the real top-bar control twice; no fullscreen resize workaround.
  for (let i = 0; i < 2; i++) {
    const title = await page.evaluate(() => {
      const v = window.__checkbaActiveOverviewVm
      return v.$t(v.sidebarCollapsed ? 'workbench.expandSidebar' : 'workbench.collapseSidebar')
    })
    const before = await page.evaluate(() => window.__checkbaActiveOverviewVm.sidebarCollapsed)
    const button = await page.$(`.top-bar-btn[title=${JSON.stringify(title)}]`)
    assert.ok(button, 'Actual sidebar control must be rendered')
    await button.click()
    await page.waitForFunction(before => window.__checkbaActiveOverviewVm.sidebarCollapsed !== before, {}, before)
    await new Promise(resolve => setTimeout(resolve, 1000))
    screenshots.push(await captureDesktop(run, `release-${ext}-sidebar-${i}`))
  }
  let tabSwitchCovered = false
  const activeTab = await page.$('.tab-item.active')
  if (activeTab) {
    const other = (await activeTab.evaluateHandle(el => [...el.parentElement.children].find(node => node.classList.contains('tab-item') && !node.classList.contains('active') && node.getBoundingClientRect().width > 0))).asElement()
    if (other) {
      await other.click()
      await page.waitForFunction(id => window.__checkbaActiveOverviewVm.activeFileLeft?.id !== id, {}, state.fileId)
      await activeTab.click()
      await page.waitForFunction(id => window.__checkbaActiveOverviewVm.activeFileLeft?.id === id, {}, state.fileId)
      await new Promise(resolve => setTimeout(resolve, 1000))
      screenshots.push(await captureDesktop(run, `release-${ext}-tab-return`))
      tabSwitchCovered = true
    }
  }
  return { ...state, screenshots, tabSwitchCovered, visualReviewRequired: 'Inspect first body and after-toggle top/left edges; screenshots alone do not prove absence of black bars' }
}

export async function checkExitList({ page, installed, run, base }) {
  assert.equal(await page.evaluate(() => !!localStorage.getItem('checkba_session_id')), false, 'Exit QA must remain anonymous; do not inject a session to bypass local-user behavior')
  const api = async (route, body) => {
    const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
    assert.ok(r.ok, `${route}: HTTP ${r.status}`)
    const result = await r.json()
    if (Object.hasOwn(result, 'code')) assert.equal(result.code, 0, route)
    return result.data ?? result
  }
  const projects = []
  for (let i = 0; i < 2; i++) {
    const localRoot = path.join(run, `exit-project-${i}`)
    fs.mkdirSync(localRoot)
    fs.writeFileSync(path.join(localRoot, 'fixture.txt'), 'Synthetic initial content\n')
    const p = await api('/api/projects/open-local', { localRoot, name: `Installed exit QA ${i}` })
    await api(`/api/projects/${p.projectId}/version/enable`, {})
    fs.writeFileSync(path.join(localRoot, 'fixture.txt'), 'Synthetic changed content\n')
    const status = await api(`/api/projects/${p.projectId}/version/exit-status`)
    assert.ok(status.canCommit && status.changedCount > 0, 'Synthetic project must have genuine committable changes')
    projects.push({ id: p.projectId, name: `Installed exit QA ${i}`, count: status.changedCount })
  }
  const method = nativeClose(installed.child.pid)
  await page.waitForSelector('.project-exit-mask', { visible: true, timeout: 30000 })
  await page.waitForFunction(() => document.querySelectorAll('.project-exit-list input:not(:disabled)').length >= 2)
  const rows = await page.$$eval('.project-exit-list label', els => els.map(el => ({ name: el.querySelector('.project-exit-name')?.textContent, selected: el.querySelector('input').checked, text: el.textContent })))
  for (const project of projects) assert.ok(rows.some(r => r.name === project.name && !r.selected))
  // Check actual packaged Uni CSS against the native dynamic label/button elements.
  const layout = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.project-exit-list label')].map(el => ({ display: getComputedStyle(el).display, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })),
    buttons: [...document.querySelectorAll('.project-exit-mask footer button')].map(el => ({ paddingTop: getComputedStyle(el).paddingTop, paddingLeft: getComputedStyle(el).paddingLeft, borderRadius: getComputedStyle(el).borderRadius })),
  }))
  for (const row of layout.rows) assert.equal(row.display, 'flex', 'Compiled dialog row CSS must match the native label')
  for (let i = 1; i < layout.rows.length; i++) assert.ok(layout.rows[i].top >= layout.rows[i - 1].bottom - 0.5, 'Projects must occupy separate non-overlapping rows')
  for (const button of layout.buttons) assert.deepEqual(button, { paddingTop: '8px', paddingLeft: '12px', borderRadius: '6px' }, 'Compiled dialog button CSS must match the native button')
  await captureDesktop(run, 'release-native-close-project-list')
  await page.click('.project-exit-mask footer button:first-child')
  await page.waitForSelector('.project-exit-mask', { hidden: true })
  assert.equal(installed.child.exitCode, null, 'Cancel must keep the process alive')
  // Fixture cleanup uses the real commit API; interactive multi-project submission is separately covered by component tests.
  for (const project of projects) await api(`/api/projects/${project.id}/version/session/end`, { title: 'Installed QA fixture cleanup' })
  return { method, projects, rows, layout, cancelKeptProcessAlive: true, submissionCoverage: 'real API cleanup only; interactive selection/partial failure not covered here' }
}
