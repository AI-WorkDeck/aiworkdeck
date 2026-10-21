// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Run with Electron (not node --test); no backend or user profile is loaded.
const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-about-smoke-'))
app.setPath('userData', path.join(root, 'profile'))
app.setPath('sessionData', path.join(root, 'session'))
app.setPath('logs', path.join(root, 'logs'))
app.setVersion(require('../package.json').version)
const palette = require('../../design/tokens/awd-palette.json')
const external = []
shell.openExternal = async (url) => { external.push(url) }
const { initAppMenu } = require('../main/app-menu')
const { setAppLanguage } = require('../main/app-language')

async function openAbout(parent) {
  Menu.getApplicationMenu().items[0].submenu.items[0].click()
  const win = BrowserWindow.getAllWindows().find((item) => item !== parent)
  assert.ok(win, 'application About menu must create the actual window')
  await once(win.webContents, 'did-finish-load')
  return win
}
async function inspect(win) {
  return win.webContents.executeJavaScript(`(() => {
    const doc = document.documentElement;
    const end = document.querySelector('main > p:last-child');
    return { text: document.body.innerText, width: innerWidth, scrollWidth: doc.scrollWidth,
      height: innerHeight, scrollHeight: doc.scrollHeight, endBottom: end.getBoundingClientRect().bottom,
      scrollY, tokens: Object.fromEntries(['text', 'text-2', 'surface', 'border', 'accent-text'].map(key => [key, getComputedStyle(doc).getPropertyValue('--awd-' + key).trim()])), links: [...document.querySelectorAll('a')].map(a => a.href) };
  })()`)
}
app.whenReady().then(async () => {
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  setAppLanguage('zh-CN')
  initAppMenu(() => parent)
  nativeTheme.themeSource = 'light'
  let win = await openAbout(parent)
  const normal = await inspect(win)
  for (const [role, value] of Object.entries(normal.tokens)) assert.equal(value, palette.roles.light[role])
  assert.equal(normal.text.split(app.getVersion()).length - 1, 1)
  assert.ok(normal.scrollWidth <= normal.width, 'text must wrap without horizontal clipping')
  assert.ok(normal.endBottom <= normal.height, 'default window must show the final trademark paragraph')
  fs.writeFileSync(path.join(root, 'about-zh.png'), (await win.webContents.capturePage()).toPNG())
  Menu.getApplicationMenu().items[0].submenu.items[0].click()
  assert.equal(BrowserWindow.getAllWindows().length, 2, 'repeat clicks must reuse About')
  win.setSize(380, 360)
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const small = await inspect(win)
  assert.ok(small.scrollHeight > small.height, 'small window must scroll')
  assert.ok(small.scrollWidth <= small.width, 'small window must not crop long lines')
  await win.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)')
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const bottom = await inspect(win)
  assert.ok(bottom.scrollY > 0 && bottom.endBottom <= bottom.height, 'final text must be reachable by scrolling')
  fs.writeFileSync(path.join(root, 'about-zh-small-bottom.png'), (await win.webContents.capturePage()).toPNG())
  for (let i = 0; i < 3; i++) {
    await win.webContents.executeJavaScript(`document.querySelectorAll('a')[${i}].click()`)
  }
  assert.deepEqual(external, normal.links, 'all legal links must route to the system browser')
  assert.ok(win.webContents.getURL().startsWith('data:text/html'), 'links must not replace About content')
  const firstClosed = once(win, 'closed')
  win.close()
  await firstClosed
  setAppLanguage('en-US')
  nativeTheme.themeSource = 'dark'
  win = await openAbout(parent)
  const english = await inspect(win)
  for (const [role, value] of Object.entries(english.tokens)) assert.equal(value, palette.roles.dark[role])
  assert.match(english.text, /Version /)
  assert.equal(win.getTitle(), 'About AI WorkDeck')
  assert.ok(english.endBottom <= english.height)
  fs.writeFileSync(path.join(root, 'about-en-dark.png'), (await win.webContents.capturePage()).toPNG())
  const closed = once(win, 'closed')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await closed
  fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ normal, small, bottom, english, external }, null, 2))
  console.log(JSON.stringify({ passed: true, artifacts: root }))
  app.exit(0)
}).catch((error) => {
  console.error(error)
  console.error('Artifacts:', root)
  app.exit(1)
})
setTimeout(() => { console.error('About smoke timed out:', root); app.exit(1) }, 20000).unref()
