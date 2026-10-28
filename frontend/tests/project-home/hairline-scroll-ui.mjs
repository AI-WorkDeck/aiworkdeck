// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real Chromium scrollbar paint/style checks with synthetic overflowing content.
// HAIRLINE_APP_SOURCE can point to `git show HEAD:frontend/src/App.vue` for a negative control.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const source = readFileSync(process.env.HAIRLINE_APP_SOURCE || new URL('../../src/App.vue', import.meta.url), 'utf8')
const style = source.slice(source.indexOf('<style'), source.indexOf('</style>', source.indexOf('<style')))
// Include the container's custom-property declarations as well as its pseudo-element rules.
const start = style.indexOf('\n.awd-hairline-scroll')
const end = style.indexOf('/* mac：', start)
assert.ok(start >= 0 && end > start, 'locate the actual global hairline stylesheet')
const css = style.slice(start, end)
const out = process.env.HAIRLINE_SHOTS || '/tmp/hairline-scroll-ui'
mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  // Puppeteer's default hides the bars being verified here.
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
const results = [], failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 600, height: 320 })
  for (const ownership of ['self', 'child']) {
    for (const axis of ['vertical', 'horizontal']) {
      const label = `${ownership}-${axis}`
      await page.setContent(`<style>
        :root { --awd-border-strong: rgb(255, 0, 0); }
        body { margin: 30px; background: white; }
        .box { width: 180px; height: 160px; border: 1px solid black; }
        .vertical { overflow-y: auto; overflow-x: hidden; }
        .horizontal { overflow-x: auto; overflow-y: hidden; }
        .vertical .filler { height: 600px; }
        .horizontal .filler { width: 600px; height: 100%; }
        .filler { background: #eee; }
        .wrapper { width: 182px; }
        ${css}
      </style><div class="wrapper ${ownership === 'child' ? 'awd-hairline-scroll' : ''}">
        <div id="scroll" class="box ${axis} ${ownership === 'self' ? 'awd-hairline-scroll' : ''}">
          <div class="filler">Synthetic ${label}</div>
        </div>
      </div>`)
      const measure = () => page.$eval('#scroll', el => ({
        color: getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor,
        width: getComputedStyle(el, '::-webkit-scrollbar').width,
        height: getComputedStyle(el, '::-webkit-scrollbar').height,
        top: el.scrollTop, left: el.scrollLeft,
        overflowY: el.scrollHeight > el.clientHeight,
        overflowX: el.scrollWidth > el.clientWidth,
      }))
      const settle = () => new Promise(resolve => setTimeout(resolve, 150))
      await page.mouse.move(550, 280); await settle()
      const idle = await measure()
      check(idle.color === 'rgba(0, 0, 0, 0)', `${label}: idle thumb is transparent`)
      check(idle.width === '4px' && idle.height === '4px', `${label}: native bar width and height are 4px`)
      check(axis === 'vertical' ? idle.overflowY : idle.overflowX, `${label}: fixture actually overflows`)
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.hover('#scroll'); await settle()
        const hovered = await measure()
        check(hovered.color === 'rgb(255, 0, 0)', `${label}/${cycle}: hovering reveals the theme-colored thumb`)
        await page.screenshot({ path: `${out}/${label}-${cycle}-hover.png` })
        // A real wheel event must still reach the intended scrollable element.
        await page.mouse.wheel(axis === 'vertical' ? { deltaY: 90 } : { deltaX: 90 })
        await settle()
        const scrolled = await measure()
        check(axis === 'vertical' ? scrolled.top > hovered.top : scrolled.left > hovered.left, `${label}/${cycle}: wheel scrolls content`)
        await page.mouse.move(550, 280); await settle()
        const left = await measure()
        check(left.color === 'rgba(0, 0, 0, 0)', `${label}/${cycle}: leaving hides the thumb again`)
        await page.screenshot({ path: `${out}/${label}-${cycle}-idle.png` })
        results.push({ label, cycle, idle, hovered, scrolled, left })
      }
    }
  }
  writeFileSync(`${out}/report.json`, JSON.stringify({ results, failures }, null, 2))
  assert.deepEqual(failures, [])
  console.log('PASS: self/child × vertical/horizontal; hover/leave, 4px geometry, and real wheel scrolling')
} finally {
  await browser.close()
}
