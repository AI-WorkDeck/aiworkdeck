// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual Vue host gate + actual LOWA, with synthetic files. This isolates the
// first-paint handshake; it is not packaged Electron or full-workbench coverage.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import { preflight, loadPuppeteer, startServer, launchBrowser, ORIGIN, here } from './_boot.mjs'
const require = createRequire(import.meta.url)
const out = process.env.CHROME_PAINT_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'awd-first-chrome-'))
fs.mkdirSync(out, { recursive: true })
const source = fs.readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const names = [...script.matchAll(/^import\s+([\s\S]*?)\s+from\s+'[^']+'\s*;?\s*$/gm)].flatMap(([, clause]) => {
  const named = clause.match(/\{([\s\S]*?)\}/)?.[1].split(',').map(s => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean) || []
  const name = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim()
  return name ? [...named, name] : named
})
const options = new Function(...names, script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default', 'return'))(...names.map(() => () => {}))
const hostClass = source.match(/class="libre-host" :class="([^"]+)"/)[1]
const hiddenStyle = source.match(/\.libre-host-loading\s*\{[^}]+\}/)[0]
const hostPage = path.join(out, 'host.html')
fs.writeFileSync(hostPage, `<!doctype html><html><style>body{margin:0;background:#fafafa}.libre-host,iframe{width:100vw;height:100vh;border:0;display:block}${hiddenStyle}</style><div id="app"></div><script type="module">
import { createApp, markRaw } from '/vue.js';
const STATUS_OPEN_FAILED='openFailed';
window.samples=[];
const vm=createApp({
 template:${JSON.stringify(`<div class="libre-host" :class="${hostClass}"><iframe id="guest" :src="guestUrl"></iframe></div>`)},
 data(){return {ready:false,chromeInitialized:false,chromeInitFailed:false,docLoadFailed:false,statusKey:'loadingDoc',docKind:'writer',file:{id:1},executor:null,guestUrl:'/editor.html?verify=1&lowa=/lowa/'+(location.search.includes('blank')?'':'&initialDocument=1')}} ,
 computed:{${options.computed.loadingOverlayVisible.toString()}},
 methods:{${['prepareInitialChrome','finishDocLoad','retryLoad','rehideChromeAfterRetarget'].map(k=>options.methods[k].toString()).join(',')},
  async loadDocument(){const r=await this.executor.executeCommand('load_document',window.payload);if(!r.success)throw Error(JSON.stringify(r));this.docKind=r.kind;window.loadedReceipt=r;},
  initEvidence(){},initWritingAssistance(){},appendLog(){}
 }
}).mount('#app');
window.hostVm=vm;window.bindExecutor=()=>{vm.executor=markRaw(document.querySelector('iframe').contentWindow.__loExecutor)};
function sample(){window.samples.push({t:performance.now(),ready:vm.ready,chrome:vm.chromeInitialized,covered:vm.loadingOverlayVisible,opacity:getComputedStyle(document.querySelector('.libre-host')).opacity});window.sampleFrame=requestAnimationFrame(sample)}sample();
</script></html>`)
async function xlsx() {
  const zip = new JSZip(), ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>FIRST PAINT</t></is></c></row></sheetData></worksheet>`)
  return Array.from(await zip.generateAsync({ type: 'uint8array' }))
}
preflight()
const server = await startServer({ extraFiles: { '/chrome-host.html': hostPage, '/vue.js': require.resolve('vue/dist/vue.esm-browser.js') } })
const browser = await launchBrowser(await loadPuppeteer(), { headed: true })
const results = []
try {
  for (const [kind, name, bytes] of [
    ['blank','blank.docx',[]],
    ['writer','first.docx',Array.from(fs.readFileSync(path.join(here,'fixtures/flexmark-table.docx')))],
    ['calc','first.xlsx',await xlsx()],
    ['impress','first.pptx',Array.from(fs.readFileSync(path.join(here,'fixtures/impress-smoke.pptx')))],
  ]) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1100, height: 760, deviceScaleFactor: 1 })
    page.on('pageerror', e => console.error(kind, e.message))
    await page.goto(ORIGIN+'/chrome-host.html?'+kind)
    await page.waitForFunction('!!document.querySelector("iframe")?.contentWindow.__loExecutor', { timeout: 240000 })
    await page.screenshot({ path: path.join(out,kind+'-covered.png') })
    const result = await page.evaluate(async ({name,bytes}) => {
      window.bindExecutor();window.payload={name,bytes,authorName:'QA'};
      await window.hostVm.finishDocLoad();await window.hostVm.$nextTick();
      const state = await window.hostVm.executor.executeCommand('set_chrome',{});
      return {ready:window.hostVm.ready,initialized:window.hostVm.chromeInitialized,failed:window.hostVm.chromeInitFailed,covered:window.hostVm.loadingOverlayVisible,state,loaded:window.loadedReceipt};
    },{name,bytes})
    assert.equal(result.initialized,true,JSON.stringify(result))
    assert.equal(result.covered,false)
    assert.equal(result.state.visible.all,false)
    assert.equal(result.state.visible.menubar,false)
    await page.screenshot({ path: path.join(out,kind+'-shown.png') })
    const samples=await page.evaluate(()=>window.samples)
    assert.ok(samples.some(s=>s.covered && s.opacity==='0'))
    assert.ok(samples.every(s=>s.chrome || s.opacity==='0'),'no sampled unconfirmed native layout may be visible')
    fs.writeFileSync(path.join(out,kind+'-frames.json'),JSON.stringify(samples,null,2))
    // Existing toolbar escape state remains a real native mode on reload.
    const escape=await page.evaluate(async()=>{
      const vm=window.hostVm, ex=vm.executor;
      await ex.executeCommand('set_chrome',{menubar:true,statusbar:true,toolbars:true});
      await ex.executeCommand('load_document',window.payload);
      vm.$.refs.toolbar={reapplyChrome:()=>ex.executeCommand('set_chrome',{menubar:true,statusbar:true,toolbars:true})};
      await vm.rehideChromeAfterRetarget();
      return ex.executeCommand('set_chrome',{});
    })
    assert.equal(escape.visible.menubar,true)
    results.push({kind,...result,escape,samples:samples.length})
    console.log('PASS',kind)
    await page.close()
  }
} finally {
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2))
  await browser.close();await new Promise(r=>server.close(r));console.log('Artifacts:',out)
}
