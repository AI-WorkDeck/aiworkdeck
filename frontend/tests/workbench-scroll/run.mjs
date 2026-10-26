// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real layout regression for dev-board#1503; synthetic content, no account/backend.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import puppeteer from 'puppeteer-core'

const css = sass.compile(fileURLToPath(new URL('../../src/pages/project-overview/project-overview.scss', import.meta.url)), {
  logger: sass.Logger.silent,
}).css
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome'),
  headless: true,
})
try {
  const page = await browser.newPage()
  for (const [width, height] of [[1440, 900], [1024, 600], [1920, 962]]) {
    await page.setViewport({ width, height })
    await page.setContent(`<style>
      html,body{margin:0}
      html{--awd-titlebar-safe-inline-start:0px;--awd-titlebar-safe-inline-end:0px}
      ${css}
      .sidebar-left{width:260px}.tree-content{height:100%;overflow:auto}.row{height:32px}
    </style>
    <div class="page-project-overview ${width < 1360 ? 'compact-mode' : ''}">
      <header class="project-header">测试项目</header>
      <main class="main-layout">
        <nav class="left-rail">${'<button class="rail-btn">入口</button>'.repeat(24)}</nav>
        <aside class="sidebar-left"><header class="sidebar-header">文件</header>
          <div class="sidebar-content"><div class="tree-content">
            ${Array.from({ length: 100 }, (_, i) => `<div class="row" tabindex="0" id="file-${i}">测试文件 ${i}</div>`).join('')}
          </div></div>
        </aside>
        <section class="workbench"><header class="tab-bar">文档标签</header><div class="workbench-main"></div></section>
      </main><footer class="status-bar">已保存</footer>
    </div>`)
    const geometry = () => page.evaluate(() => Object.fromEntries(
      ['.project-header', '.sidebar-header', '.tab-bar', '.status-bar'].map(selector => {
        const r = document.querySelector(selector).getBoundingClientRect()
        return [selector, { top: r.top, bottom: r.bottom }]
      }),
    ))
    const initial = await geometry()
    const stable = async label => {
      assert.deepEqual(await geometry(), initial, `${width}×${height}: ${label} must not move shell headers`)
      assert.equal(await page.$eval('.main-layout', el => el.scrollTop), 0)
      assert.equal(initial['.status-bar'].bottom, height, 'status bar stays inside viewport')
    }
    // FileTree's reveal uses this native API. A tall rail gives the hidden shell
    // overflow; centering a file must scroll its list, never the shell as well.
    await page.evaluate(() => document.querySelector('#file-80').scrollIntoView({ block: 'center' }))
    assert.ok(await page.$eval('.tree-content', el => el.scrollTop) > 0, 'file reveal still scrolls the list')
    assert.ok(await page.evaluate(() => {
      const row = document.querySelector('#file-80').getBoundingClientRect()
      const list = document.querySelector('.tree-content').getBoundingClientRect()
      return row.top >= list.top && row.bottom <= list.bottom
    }), 'revealed file is visible')
    await stable('file reveal')
    await page.evaluate(() => document.querySelector('#file-99').focus())
    await stable('focus below viewport')
    const list = await page.$eval('.tree-content', el => {
      const r = el.getBoundingClientRect(); return { x: r.x + 100, y: r.y + 100 }
    })
    await page.mouse.move(list.x, list.y)
    await page.mouse.wheel({ deltaY: -10000 })
    await page.waitForFunction(() => document.querySelector('.tree-content').scrollTop === 0)
    await stable('wheel back to top')
    await page.mouse.wheel({ deltaY: 500 })
    await page.waitForFunction(() => document.querySelector('.tree-content').scrollTop > 0)
    await page.mouse.wheel({ deltaY: -10000 })
    await page.waitForFunction(() => document.querySelector('.tree-content').scrollTop === 0)
    await stable('wheel down and back up')
    console.log(`PASS ${width}×${height}: reveal, focus, wheel down/up; headers and footer stay fixed`)
  }
} finally {
  await browser.close()
}
