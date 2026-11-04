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

async function capture(page, run, name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: path.join(run, `${name}-renderer.png`) })
  return captureDesktop(run, name)
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
  await capture(page, run, 'release-welcome-model')
  const catalog = page.waitForResponse(r => new URL(r.url()).pathname === '/api/ai/models')
  await page.click('[data-quick="model"]')
  await catalog
  await page.waitForSelector('.welcome-model-dropdown', { visible: true })
  // The real anonymous catalog may require account login. Never inject model data.
  await page.waitForFunction(() => document.querySelector('.awd-login-mask') || document.querySelector('.welcome-model-dropdown .model-auto-option'))
  const login = await page.$('.awd-login-mask')
  if (login) {
    await page.waitForSelector('.awd-login-mask', { visible: true })
    await new Promise(resolve => setTimeout(resolve, 350)) // Account overlay transition must finish before native screen capture.
    await capture(page, run, 'release-welcome-model-account-required')
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
  await capture(page, run, 'release-welcome-model-transferred')
  return { selected: 'auto', generationRequested: false, catalogRequiredAccount: !!login, transfer: 'actual empty-prompt entry; persisted auto and visible ChatInterface model name' }
}


export function assertDocumentBinding(state, ext) {
  assert.equal(state.insightDocFileId || null, ext === 'docx' ? state.fileId : null)
  if (state.insightInstalled) assert.equal(state.insightAvailable, ext === 'docx')
}

export async function checkWriterReplacement({ page, run, previousId }) {
  const id = await page.evaluate(() => window.__checkbaActiveOverviewVm.insightDocFileId)
  assert.ok(id && id !== previousId, 'Opening a different Writer must replace the evidence document id')
  return { previousId, fileId: id, screenshot: await capture(page, run, 'release-second-writer-binding') }
}

export async function checkClosedDocument({ page, run, ext, prefix = 'release' }) {
  await page.waitForFunction(() => {
    const v = window.__checkbaActiveOverviewVm
    return !v.insightDocFileId && v.rightPaneKey !== 'plugin-insight' && v.leftPaneKey !== 'plugin-insight'
  })
  return captureDesktop(run, `${prefix}-${ext}-closed-evidence-hidden`)
}

export function assertEvidenceEntryScope(state, entry) {
  if (state.hasNamedProject) assert.ok(entry, 'Writer in a named project must expose a visible evidence entry')
  else {
    assert.equal(state.isLooseWorkspace, true, 'Non-project coverage is the existing loose-file workflow')
    assert.equal(entry, undefined, 'Loose files must retain their current project-tools boundary')
  }
}

async function findEvidenceEntry(page) {
  const label = await page.evaluate(() => { const v = window.__checkbaActiveOverviewVm; const p = v.dynamicPlugins.find(p => p.pluginId === 'insight'); return (p.labelKey && v.$t(p.labelKey)) || p.label })
  for (const candidate of await page.$$('.rail-btn, .right-dock-tab')) {
    if (await candidate.isVisible() && await candidate.evaluate((el, label) => el.title === label || el.textContent.trim() === label, label)) return candidate
  }
}

export async function checkDocumentChrome({ page, run, ext, prefix = 'release' }) {
  const state = await page.evaluate(() => {
    const v = window.__checkbaActiveOverviewVm
    return { fileId: v.activeFileLeft?.id, hasNamedProject: v.hasNamedProject, isLooseWorkspace: v.isLooseWorkspace, insightDocFileId: v.insightDocFileId,
      insightInstalled: v.dynamicPlugins.some(p => p.pluginId === 'insight'),
      insightAvailable: v.documentAvailablePlugins.some(p => p.pluginId === 'insight') }
  })
  assertDocumentBinding(state, ext)
  const screenshots = [await capture(page, run, `${prefix}-${ext}-first-visible`)]
  if (ext === 'docx' && state.insightInstalled) {
    const entry = await findEvidenceEntry(page)
    assertEvidenceEntryScope(state, entry)
    if (state.hasNamedProject) {
      await entry.click()
      await page.waitForFunction(() => window.__checkbaActiveOverviewVm.insightPaneOpen)
      await page.waitForSelector('.plugin-iframe', { visible: true })
      let frame
      for (const element of await page.$$('.plugin-iframe')) if (await element.isVisible()) { frame = await element.contentFrame(); break }
      assert.ok(frame, 'Visible evidence iframe')
      const docName = await page.evaluate(() => window.__checkbaActiveOverviewVm.insightDocName)
      await frame.waitForFunction(name => document.querySelector('.ip-doc')?.textContent.trim() === name, {}, docName)
      state.visibleEvidenceDocument = await frame.$eval('.ip-doc', el => el.textContent.trim())
      state.evidenceLoadError = await frame.evaluate(() => document.querySelector('.ip-error')?.textContent || '')
      // Read-only anonymous access may require an account. Never fabricate a session or invoke paid parsing.
      const login = await page.$('.awd-login-mask')
      if (login && await login.isVisible()) {
        state.evidenceRequiredAccount = true
        await capture(page, run, `${prefix}-evidence-account-required`)
        await page.click('.awd-login-close')
      }
      screenshots.push(await capture(page, run, `${prefix}-writer-evidence-panel`))
    } else {
      state.evidenceScope = 'Loose files: project evidence entry is intentionally unavailable; named-project test below covers it'
    }
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
    screenshots.push(await capture(page, run, `${prefix}-${ext}-sidebar-${i}`))
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
      screenshots.push(await capture(page, run, `${prefix}-${ext}-tab-return`))
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
  await capture(page, run, 'release-native-close-project-list')
  await page.click('.project-exit-mask footer button:first-child')
  await page.waitForSelector('.project-exit-mask', { hidden: true })
  assert.equal(installed.child.exitCode, null, 'Cancel must keep the process alive')
  // Fixture cleanup uses the real commit API; interactive multi-project submission is separately covered by component tests.
  for (const project of projects) await api(`/api/projects/${project.id}/version/session/end`, { title: 'Installed QA fixture cleanup' })
  return { method, projects, rows, cancelKeptProcessAlive: true, submissionCoverage: 'real API cleanup only; interactive selection/partial failure not covered here' }
}

export function looseWorkspaceURL(originalURL, projectId) {
  assert.ok(Number.isSafeInteger(projectId) && projectId > 0, 'Return navigation needs the real loose-file project id')
  return `${originalURL.split('#')[0]}#/pages/project-overview/project-overview?id=${projectId}&loose=1`
}

// Project-scoped evidence is intentionally unavailable in the loose-files workspace.
// Exercise it separately without replacing the four-format loose-file edit/save journey.
export async function checkNamedProjectEvidence({ page, run, base, files }) {
  const originalURL = page.url()
  const originalWorkspace = await page.evaluate(() => {
    const v = window.__checkbaActiveOverviewVm
    return { projectId: v.projectId, isLooseWorkspace: v.isLooseWorkspace }
  })
  assert.equal(originalWorkspace.isLooseWorkspace, true)
  const returnURL = looseWorkspaceURL(originalURL, originalWorkspace.projectId)
  const localRoot = path.join(run, 'evidence-project')
  fs.mkdirSync(localRoot)
  for (const [ext, file] of Object.entries(files)) fs.copyFileSync(file, path.join(localRoot, `Evidence.${ext}`))
  fs.copyFileSync(files.docx, path.join(localRoot, 'Second Writer.docx'))
  const api = async (route, body) => {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
    assert.ok(response.ok, route)
    const value = await response.json()
    if (Object.hasOwn(value, 'code')) assert.equal(value.code, 0, route)
    return value.data ?? value
  }
  const project = await api('/api/projects/open-local', { localRoot, name: 'Installed evidence QA', createFolder: false, openFileName: 'Evidence.docx' })
  assert.ok(project.projectId && project.openFileId)
  const list = await api(`/api/projects/${project.projectId}/files`)
  const waitForFile = async file => {
    await page.waitForFunction(id => window.__checkbaActiveOverviewVm?.activeFileLeft?.id === id, { timeout: 60000 }, file.id)
    if (file.name.endsWith('.pdf')) await page.waitForSelector('.preview-pdf iframe', { visible: true })
    else await page.waitForFunction(id => Object.values(window.__checkbaActiveOverviewVm?._libreRefs || {}).some(e => e.file?.id === id && e.ready && e.statusKey === 'ready'), { timeout: 180000 }, file.id)
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  const openFile = async name => {
    const file = list.find(f => f.name === name)
    assert.ok(file, `Imported fixture ${name}`)
    const title = await page.evaluate(() => { const v = window.__checkbaActiveOverviewVm; const p = v.LEFT_SIDEBAR_PLUGINS.find(p => p.key === 'files'); return (p.labelKey && v.$t(p.labelKey)) || p.label })
    const hidden = await page.evaluate(() => { const v = window.__checkbaActiveOverviewVm; return v.sidebarCollapsed || v.leftPaneKey !== 'files' })
    if (hidden) await page.click(`.rail-btn[title=${JSON.stringify(title)}]`)
    const selector = `.file-tree .tree-item[data-file-id="${file.id}"]`
    await page.waitForSelector(selector, { visible: true })
    await page.click(selector, { clickCount: 2 })
    await waitForFile(file)
    return file
  }
  const closeActive = async ext => {
    if (await page.evaluate(() => !!window.__checkbaActiveOverviewVm.insightDocFileId)) {
      const entry = await findEvidenceEntry(page)
      assert.ok(entry, 'Writer evidence entry remains available before closing document')
      if (!await page.evaluate(() => window.__checkbaActiveOverviewVm.insightPaneOpen)) await entry.click()
      await page.waitForFunction(() => window.__checkbaActiveOverviewVm.insightPaneOpen)
    }
    await page.click('.tabs-pane-left .tab-item.active .tab-close')
    await checkClosedDocument({ page, run, ext, prefix: 'named-project' })
  }
  await page.goto(`${originalURL.split('#')[0]}#/pages/project-overview/project-overview?id=${project.projectId}&openFileId=${project.openFileId}`, { waitUntil: 'domcontentloaded' })
  await waitForFile(list.find(f => f.id === project.openFileId))
  await page.waitForFunction(() => window.__checkbaActiveOverviewVm?.hasNamedProject && window.__checkbaActiveOverviewVm.dynamicPluginsLoaded)
  assert.equal(await page.evaluate(() => window.__checkbaActiveOverviewVm.dynamicPlugins.some(p => p.pluginId === 'insight')), true, 'Named-project fixture must exercise the installed evidence plugin')
  const result = { projectId: project.projectId, documents: {} }
  result.documents.docx = await checkDocumentChrome({ page, run, ext: 'docx', prefix: 'named-project' })
  await closeActive('docx')
  await openFile('Second Writer.docx')
  result.replacement = await checkWriterReplacement({ page, run, previousId: result.documents.docx.fileId })
  await checkDocumentChrome({ page, run, ext: 'docx', prefix: 'named-second-writer' })
  await closeActive('second-writer')
  for (const ext of ['xlsx', 'pptx', 'pdf']) {
    await openFile(`Evidence.${ext}`)
    result.documents[ext] = await checkDocumentChrome({ page, run, ext, prefix: 'named-project' })
    await closeActive(ext)
  }
  const status = await api(`/api/projects/${project.projectId}/version/exit-status`)
  if (status.canCommit) await api(`/api/projects/${project.projectId}/version/session/end`, { title: 'Installed evidence fixture cleanup' })
  // Native open-file changes workspace in-place, so the browser URL can still be the id-less startup shell.
  // Use the normal localOpenCoordinator deep-link contract, then require server-loaded identity.
  await page.goto(returnURL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(id => {
    const v = window.__checkbaActiveOverviewVm
    return v?.projectInfoLoaded && v.isLooseWorkspace && v.projectId === id
  }, {}, originalWorkspace.projectId)
  result.returnedLooseProjectId = originalWorkspace.projectId
  return result
}
