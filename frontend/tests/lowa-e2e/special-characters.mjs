// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated production toolbar + real LOWA; uni storage/tap adapters supplied by fixture.
// H5 compilation is checked separately. No backend, account or user document.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { preflight, startServer, launchBrowser, loadPuppeteer, openEditor } from './_boot.mjs'
preflight()
const src = path.resolve('src'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-marks-'))
const output = process.env.LOWA_MARKS_OUTPUT || '/tmp/awd-1235-special-characters'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(temp, 'entry.js'), `
import { createApp, h } from 'vue';
import Toolbar from ${JSON.stringify(path.join(src, 'components/EditorToolbar.vue'))};
import zh from ${JSON.stringify(path.join(src, 'locales/zh-CN/editor.js'))};
window.uni = { getStorageSync: k => localStorage.getItem(k), setStorageSync: (k,v) => localStorage.setItem(k,v), showToast: m => { throw Error(m.title) } };
document.addEventListener('click', e => e.target.dispatchEvent(new Event('tap', { bubbles: true })));
window.__mountToolbar = () => {
 window.__toolbarApp?.unmount(); document.getElementById('toolbar-fixture')?.remove();
 const node = document.createElement('div'); node.id = 'toolbar-fixture'; document.body.prepend(node);
 const app = createApp({ render: () => h(Toolbar, { ref: 'toolbar', executor: window.__loExecutor, onChanged: () => window.__contentChanged++ }) });
 app.config.globalProperties.$t = key => key.split('.').slice(1).reduce((v,k) => v?.[k], zh) || key;
 window.__contentChanged = 0; window.__toolbarApp = app; window.__toolbarRoot = app.mount(node);
}; window.__mountToolbar();`)
await build({ configFile: false, root: temp, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, plugins: [vue({ template: { compilerOptions: { isCustomElement: tag => ['view','text','scroll-view'].includes(tag) } } })],
  resolve: { alias: { '@': src, vue: path.resolve('node_modules/vue/dist/vue.esm-bundler.js') } },
  build: { outDir: path.join(temp, 'out'), lib: { entry: path.join(temp,'entry.js'), formats: ['es'], fileName: () => 'fixture.js' } } })
const fontRoot = process.env.LOWA_FONT_DIR || path.resolve(process.env.LOWA_ENGINE_DIR || 'dist/zetaoffice/lowa', '..')
const server = await startServer({ extraFiles: {
  '/fixture.js': path.join(temp,'out/fixture.js'), '/fixture.css': path.join(temp,'out',fs.readdirSync(path.join(temp,'out')).find(f=>f.endsWith('.css'))),
  '/office_thread.js': path.resolve('src/zetaoffice/public/office_thread.js'),
  ...Object.fromEntries(['cjk.ttc','cjk-serif.otf','cjk-kai.ttf','cjk-fangsong.ttf'].map(f => ['/'+f,path.join(fontRoot,f)])),
}, patchServed(url, bytes) {
  if (url !== '/office_thread.js') return bytes
  return Buffer.from(bytes.toString().replace('  set_view_options(p) {', `  set_view_options(p) {
    if (p && p.__fixture) {
      xModel.getText().insertString(ctrl.getViewCursor(), '段落 空格\\t制表符', false);
      xModel.getText().insertControlCharacter(ctrl.getViewCursor(), css.text.ControlCharacter.LINE_BREAK, false);
      xModel.getText().insertString(ctrl.getViewCursor(), '手动换行之后', false);
      xModel.getText().insertControlCharacter(ctrl.getViewCursor(), css.text.ControlCharacter.PARAGRAPH_BREAK, false);
      xModel.getText().insertString(ctrl.getViewCursor(), '第二段', false);
    }
    if (p && p.__clean) xModel.setModified(false);`).replace('    const out = { success: true };\n    for (const [key, property] of Object.entries(marks))', '    const out = { success: true, modified: xModel.isModified() };\n    for (const [key, property] of Object.entries(marks))'))
} })
const browser = await launchBrowser(await loadPuppeteer(), { headed: true })
try {
  const page = await openEditor(browser, { clipboard: false, viewport: { width: 1500, height: 1000 } })
  page.on('pageerror', e => console.error('PAGE ERROR', e.message))
  const exec = (a,p={}) => page.evaluate((a,p) => window.__loExecutor.executeCommand(a,p),a,p)
  const fixture = await exec('set_view_options', { __fixture:true, __clean:true }); assert.equal(fixture.success,true,JSON.stringify(fixture))
  const read = async () => (await exec('get_document_text')).paragraphs.map(p => p.text)
  const original = await read()
  await page.addStyleTag({ content: 'view,scroll-view{display:block} text{display:inline} #toolbar-fixture{position:fixed;top:0;left:0;right:0;z-index:2000} .etb-scroll{overflow:auto} :root{--awd-surface:#fff;--awd-surface-2:#f3f4f4;--awd-text:#202722;--awd-text-2:#45534c;--awd-text-3:#77847d;--awd-border:#d9dfdc;--awd-accent-text:#2e5a50;--awd-accent-soft:#e3efea;--awd-space-1:4px;--awd-space-2:8px;--awd-font-size-body:13px}' })
  await page.addStyleTag({ content: fs.readFileSync(path.join(temp,'out',fs.readdirSync(path.join(temp,'out')).find(f=>f.endsWith('.css'))),'utf8') }); await page.addScriptTag({ type:'module', url:'/fixture.js' })
  const ready = () => page.waitForFunction(() => window.__toolbarRoot?.$refs.toolbar?.viewPrefsReady === true)
  await ready()
  await page.waitForFunction(() => window.__toolbarRoot.$refs.toolbar.state.view.formattingMarks === true)
  const settle = () => page.waitForFunction(() => !window.__toolbarRoot.$refs.toolbar.viewPrefsBusy)
  const menu = async () => { await page.$eval('.etb-marks-trigger',el=>el.scrollIntoView({block:'nearest',inline:'nearest'})); await page.click('.etb-marks-trigger'); await page.waitForSelector('.etb-marks-menu') }
  const action = async text => { await page.evaluate(text => [...document.querySelectorAll('.etb-marks-menu button')].find(n => n.textContent === text).click(),text); await settle() }
  await menu(); await page.screenshot({ path:path.join(output,'01-all.png') })
  const keys = ['paragraphMarks','lineBreaks','spaces','tabs']
  for (const key of keys) {
    await action('全部隐藏')
    assert.equal((await exec('set_view_options')).formattingMarks,false)
    await page.click('[data-mark="'+key+'"]'); await settle()
    const state = await exec('set_view_options'), ui = (await exec('get_ui_state')).view
    assert.equal(state.formattingMarks,true); assert.equal(state.modified,false)
    for (const k of keys) { assert.equal(state[k],key===k); assert.equal(ui[k],key===k) }
    await page.screenshot({ path:path.join(output,key+'.png') })
  }
  await page.keyboard.press('Escape'); assert.equal(await page.$('.etb-marks-menu'),null)
  const bytes = await page.evaluate(async () => Array.from((await window.__loExecutor.executeCommand('export_document',{name:'marks.docx'})).bytes))
  await exec('load_document',{bytes,name:'marks.docx'})
  await page.evaluate(() => window.__mountToolbar()); await ready()
  // Wait for bootstrap's complete preference application, not only initial readback.
  await page.waitForFunction(() => window.__toolbarRoot.$refs.toolbar.state.view.spaces === false)
  const restored = await exec('set_view_options')
  for (const key of keys) assert.equal(restored[key],key==='tabs')
  assert.deepEqual(await read(),original)
  assert.equal(await page.evaluate(() => window.__contentChanged),0)
  await menu(); await page.setViewport({width:750,height:900})
  await page.waitForFunction(() => !document.querySelector('.etb-marks-menu'))
  await page.$eval('.etb-marks-trigger',el=>el.scrollIntoView()); await menu()
  await page.addStyleTag({content:':root{--awd-surface:#202722;--awd-surface-2:#2a342d;--awd-text:#edf3ef;--awd-text-2:#c1cec6;--awd-text-3:#9caea2;--awd-border:#46564b;--awd-accent-text:#a9d4ba;--awd-accent-soft:#30493a}'})
  const rect = await page.$eval('.etb-marks-menu',el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom}})
  assert.ok(rect.left>=0 && rect.right<=750 && rect.bottom<=900)
  await page.screenshot({path:path.join(output,'02-narrow-dark.png')})
  await exec('insert_at_cursor',{text:'未保存内容'}); await action('全部显示')
  assert.equal((await exec('set_view_options')).modified,true)
  console.log('PASS four classes, toolbar, persistence/reload, text, clean/dirty, narrow/dark, Escape/resize')
} finally { await browser.close(); await new Promise(r=>server.close(r)); fs.rmSync(temp,{recursive:true,force:true}) }
