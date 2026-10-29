// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// #606/#1597: preedit uses a visible native input above the document caret;
// document pixels below it must stay unchanged.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PNG } from 'pngjs'
import { preflight, startServer, launchBrowser, loadPuppeteer, openEditor } from './_boot.mjs'

const SHOTS = process.env.LOWA_IME_UNDERLINE_SHOTS || ''
const PINYIN = "hao'ren"
const save = (name, png) => { if (SHOTS) fs.writeFileSync(SHOTS + '/' + name + '.png', PNG.sync.write(png)) }
const diffPixels = (a, b) => {
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > 8 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 8 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 8) n++
  }
  return n
}

preflight()
const server = await startServer({ extraFiles: Object.fromEntries(['cjk.ttc', 'cjk-serif.otf', 'cjk-kai.ttf', 'cjk-fangsong.ttf'].map(f => ['/' + f, '/Applications/AI WorkDeck.app/Contents/Resources/frontend/dist/zetaoffice/' + f])) })
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser, { viewport: { width: 1280, height: 900, deviceScaleFactor: 1 } })
  await page.addStyleTag({ content: '#verify,#vlog{display:none!important}' })
  const exec = (action, params = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), action, params)
  const ok = async (action, params) => { const r = await exec(action, params); assert.equal(r.success, true, action + ': ' + JSON.stringify(r)); return r }
  const bounds = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } })

  await ok('set_chrome', { all: false })
  // 光标落在页面中部：预览条贴在光标框上方，顶到画布上边才会翻到下方（那样它就
  // 会落进被检查的那一条里，判据的含义就变了）。
  await ok('insert_at_cursor', { text: '第一段：双方确认本协议的全部内容。\n'.repeat(8) + '这个人真' })

  // 覆盖层的输入框跟着 LO 光标走，但它只在自己经手的动作后重新摆位。先用一次
  // 覆盖层上屏（与用户敲字同一条路径）把框摆到光标处，再开始组合。
  await page.focus('[data-lo-ime]')
  await page.evaluate(() => {
    const e = document.querySelector('[data-lo-ime]')
    e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '的' }))
  })
  await new Promise(r => setTimeout(r, 1500))

  const box = await bounds('[data-lo-ime]')
  assert.ok(box.width > 40 && box.height > 6 && box.height < 100, '输入框应贴在光标处（不是全覆盖）: ' + JSON.stringify(box))
  assert.ok(box.top > 60, '光标应在页面中部，预览条才不会翻到光标下方: ' + JSON.stringify(box))
  // 从光标右侧 12px 起：LO 自己的光标在 box.left 处闪烁，把它让开，检查的才是
  // 「光标之后那一段」——用户看到的那根线正在这里。
  const clip = { x: Math.round(box.left) + 12, y: Math.round(box.top), width: 180, height: Math.max(12, Math.round(box.height)) }
  assert.ok(clip.x + clip.width <= 1280 && clip.y + clip.height <= 900, '取样区必须在视口内: ' + JSON.stringify(clip))

  // 基线里先把预览条摆出来（同一串拼音、同一位置）：它的投影会往下漫进这一条，
  // 两张图都带着它才能抵消，剩下的差异就只剩「输入框自己画了什么」。合成的
  // compositionupdate 只会走到 showPreview，不进组合状态机。
  await page.evaluate(pinyin => document.querySelector('[data-lo-ime]').dispatchEvent(new CompositionEvent('compositionupdate', { data: pinyin, bubbles: true })), PINYIN)
  await new Promise(r => setTimeout(r, 300))
  const before = PNG.sync.read(await page.screenshot({ clip }))
  await new Promise(r => setTimeout(r, 400))
  const idle = PNG.sync.read(await page.screenshot({ clip }))
  save('before', before); save('idle', idle)
  // 空跑守卫：这一条本来就该是静止的；它自己在动的话，下面那条「一模一样」
  // 就不是在证明输入框没画东西。
  assert.equal(diffPixels(before, idle), 0, '组合之前这一条应当是静止的（引擎没在重绘）')

  const cdp = await page.createCDPSession()
  await cdp.send('Input.imeSetComposition', { text: PINYIN, selectionStart: PINYIN.length, selectionEnd: PINYIN.length })
  await new Promise(r => setTimeout(r, 400))

  const during = await page.evaluate(() => {
    const input = document.querySelector('[data-lo-ime]')
    // 预览条是覆盖层紧跟输入框挂上去的那个兄弟节点（attachImeOverlay 里 appendChild 的顺序）
    const preview = input.nextElementSibling
    const r = input.getBoundingClientRect(), p = preview && preview.getBoundingClientRect()
    return {
      value: input.value, focused: document.activeElement === input,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      preview: preview ? { text: preview.textContent, shown: preview.style.display !== 'none', top: p.top, bottom: p.bottom, left: p.left, right: p.right } : null,
    }
  })
  // 不是空跑：确实处在组合态，框里确实有拼音。
  assert.ok(during.value.length > 0, '组合期间输入框里必须有文字（否则这一轮什么都没测）: ' + JSON.stringify(during))
  assert.equal(during.focused, true, '组合期间输入框必须仍持有焦点')
  assert.ok(during.rect.top + during.rect.height <= clip.y + 1, 'native preedit must remain above document pixels')
  assert.equal(await page.$eval('[data-lo-ime]', e => getComputedStyle(e).opacity), '1')
  await cdp.send('Input.imeSetComposition', { text: PINYIN, selectionStart: 2, selectionEnd: 2 })
  assert.equal(await page.$eval('[data-lo-ime]', e => e.selectionStart), 2, 'native middle caret survives rendering')

  const after = PNG.sync.read(await page.screenshot({ clip }))
  save('after', after)
  if (SHOTS) save('context', PNG.sync.read(await page.screenshot({ clip: { x: Math.max(0, clip.x - 220), y: Math.max(0, clip.y - 40), width: 620, height: 120 } })))
  const changed = diffPixels(idle, after)
  assert.equal(changed, 0, '组合期间光标右侧不许多出任何像素（输入法下划线/高亮）：多出 ' + changed + ' 个像素')

  console.log('PASS IME 正文零叠加、原生中间光标：取样区 ' + JSON.stringify(clip) + '，组合串「' + during.value + '」，预览条底边 ' + Math.round(during.preview.bottom) + ' ≤ 取样区顶边 ' + clip.y)
} catch (error) { console.error(error); throw error } finally { await browser.close(); await new Promise(r => server.close(r)) }
