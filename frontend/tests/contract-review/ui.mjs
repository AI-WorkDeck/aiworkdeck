// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real Vue + Chrome smoke using the actual InsightPane/ContractReviewPane sources.
// Synthetic API and editor only: no paid model, production account or document writes.
// The fixture maps uni-app tags/tap to native HTML/click; full uni/LOWA integration is separate.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../..', import.meta.url))
const out = process.env.CONTRACT_REVIEW_UI_OUT || path.join(os.tmpdir(), 'contract-review-ui')
fs.mkdirSync(out, { recursive: true })
const modules = {
  'qa-api': `
const clone = value => JSON.parse(JSON.stringify(value));
const qa = window.__reviewQa = { standards: [], run: null, writes: [], prepared: [], located: [] };
async function request(options) {
  const {url,method,data}=options;
  if(method==='GET' && url.endsWith('/standards')) return {code:0,data:clone(qa.standards)};
  if(method==='GET' && url.endsWith('/runs')) return {code:0,data:clone(qa.run)};
  qa.writes.push({url,method,data:clone(data)});
  if(url.endsWith('/standards') && method==='POST') {
    const row={...clone(data),id:3,version:(data.expectedVersion||0)+1,confirmedVersion:null};
    qa.standards=[row]; return {code:0,data:clone(row)};
  }
  if(url.endsWith('/confirm')) {qa.standards[0].confirmedVersion=data.version;return {code:0,data:clone(qa.standards[0])};}
  if(url.endsWith('/runs') && method==='POST') {
    const standard=clone(qa.standards[0]);
    qa.run={id:7,docFileId:data.docFileId,standard,status:'PARTIAL',stale:false,finishedAt:'2026-10-17T15:00:00',results:standard.rules.map((rule,i)=>({ruleId:rule.id,status:i===0?'ISSUE':'UNREVIEWED',quote:i===0?'买方应于签署当日支付全部价款。':'',reason:i===0?'付款早于交付，未满足规则要求。':'本规则尚未完成检查。',suggestion:i===0?'建议付款与验收合格挂钩。':''}))};
    return {code:0,data:clone(qa.run)};
  }
  throw new Error('Unexpected synthetic request: '+method+' '+url);
}
export default {request};
export const getDocInsight=async()=>({run:null,entities:[],findings:[]});
export const parseDocInsight=async()=>{throw new Error('Unexpected insight run')};
export const getDocInsightEntity=async()=>({});
export const refreshDocInsightEntity=async()=>({});
`,
  'qa-i18n': `import messages from '/src/locales/zh-CN/contractReview.js';
import insight from '/src/locales/zh-CN/insight.js';
export function t(key,params={}){let value=key.split('.').reduce((v,k)=>v?.[k],{contractReview:messages,insight});if(typeof value!=='string') return key;return value.replace(/\\{(\\w+)\\}/g,(_,k)=>params[k]??'');}
`,
  'qa-entry': `import {createApp,h,reactive} from 'vue';
import InsightPane from '/src/components/InsightPane.vue';import {t} from 'qa-i18n';
const state=window.__reviewState=reactive({projectId:1,docFileId:9,docName:'采购合同.docx',canWrite:true});
const app=createApp({render(){return h(InsightPane,{...state,prepareDocument:async did=>{window.__reviewQa.prepared.push(did);return true},getExecutor:()=>async(action,args)=>{window.__reviewQa.located.push({action,args});return {success:true,found:true}}})}});
app.config.globalProperties.$t=t;app.mount('#app');
`,
}
const html = `<!doctype html><html lang="zh"><head><meta charset="UTF-8"><style>
:root{--awd-text:#38382f;--awd-text-2:#6b675c;--awd-text-3:#858176;--awd-border:#ddd8ca;--awd-border-subtle:#eae7dd;--awd-surface:#fff;--awd-surface-2:#f6f5f0;--awd-bg:#faf9f5;--awd-accent:#2e5a50;--awd-accent-text:#2e5a50;--awd-accent-soft:#e3ede9;--awd-mint:#89a8a0;--awd-warning-text:#8a6320;--awd-danger-text:#9a3a30;--awd-danger-soft:#faf0ee;--awd-panel-fs:13px;--awd-panel-fs-meta:12px;--awd-panel-fs-sec:12px;--awd-panel-row-h:30px;--awd-panel-sec-h:28px;--awd-radius-sm:4px}
*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f5f3ed;margin:0;padding:20px}#app{width:410px;height:920px;border:1px solid #ddd8ca;display:flex;background:white}.cr,.ip-body{overflow:auto}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default}.cr-primary{width:100%}textarea{resize:vertical}h1{font-size:18px}
</style></head><body><h1>AI WorkDeck · 合同审查</h1><div id="app"></div><script type="module" src="/qa-entry"></script></body></html>`
const server = await createServer({ root, configFile: false, logLevel: 'error',
  server:{host:'127.0.0.1',port:0},
  resolve:{alias:[{find:'@/services/api.js',replacement:'qa-api'},{find:'@/i18n',replacement:'qa-i18n'},{find:'@',replacement:path.join(root,'src')}]},
  plugins:[{
    name:'contract-review-fixture',enforce:'pre',
    resolveId(id){const key=id.replace(/^\//,'');return key in modules ? '\0'+key : null},
    load(id){return modules[id.replace(/^\0/,'')]},
    transform(code,id){if(!id.endsWith('.vue'))return;return code.replace(/<(\/?)(view|scroll-view)(?=[\s>])/g,'<$1div').replace(/<(\/?)(text)(?=[\s>])/g,'<$1span').replace(/@tap/g,'@click')},
    configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html)}else next()})},
  },vue()],
})
let browser
try {
  await server.listen()
  const address=server.httpServer.address()
  browser=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox'],defaultViewport:{width:1050,height:1050}})
  const page=await browser.newPage(), errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`,{waitUntil:'networkidle0'})
  async function clickText(text){
    const buttons=await page.$$('button,.ip-tab')
    for(const button of buttons){if((await button.evaluate(el=>el.textContent.trim()))===text){await button.click();return}}
    throw new Error('No button: '+text)
  }
  await clickText('合同审查')
  await page.waitForFunction(()=>document.querySelector('.cr')?.textContent.includes('尚无审查标准'))
  await clickText('新建标准')
  const fields=await page.$$('.cr-input')
  for(const [index,value] of ['采购合同审查标准','代表买方','中国大陆','付款条件','价款应在交付并验收合格后支付。'].entries()) await fields[index].type(value)
  await clickText('添加规则（最多 20 条）')
  const moreFields=await page.$$('.cr-input')
  await moreFields[5].type('违约责任');await moreFields[6].type('卖方迟延交付应承担合理违约责任。')
  await clickText('保存标准')
  await page.waitForFunction(()=>window.__reviewQa.standards[0]?.version===1)
  assert.equal(await page.evaluate(()=>window.__reviewQa.standards[0].confirmedVersion),null)
  await clickText('确认本版本')
  await page.waitForFunction(()=>!document.querySelector('.cr-primary').disabled)
  await clickText('按已确认标准审查当前文档（可能产生费用）')
  await page.waitForSelector('.cr-quote')
  assert.deepEqual(await page.evaluate(()=>window.__reviewQa.prepared),[9])
  assert.match(await page.$eval('.cr',el=>el.textContent),/仅完成部分规则检查/)
  assert.match(await page.$eval('.cr',el=>el.textContent),/未完成检查/)
  await page.$eval('.cr',el=>{el.scrollTop=el.scrollHeight})
  await page.click('.cr-quote')
  assert.deepEqual(await page.evaluate(()=>window.__reviewQa.located),[{action:'find_navigate',args:{keyword:'买方应于签署当日支付全部价款。',direction:'next'}}])
  await page.screenshot({path:path.join(out,'results.png')})
  await page.$eval('.cr',el=>{el.scrollTop=0})
  await page.screenshot({path:path.join(out,'standard.png')})
  await page.$eval('.cr-input',el=>{el.value='更新后的标准';el.dispatchEvent(new Event('input',{bubbles:true}))})
  assert.equal(await page.$eval('.cr-primary',el=>el.disabled),true)
  await clickText('外部检索')
  await clickText('合同审查')
  assert.equal(await page.$eval('.cr-input',el=>el.value),'更新后的标准')
  await clickText('放弃未保存修改')
  await page.waitForFunction(()=>!document.querySelector('.cr-primary').disabled)
  await page.evaluate(()=>{window.__reviewQa.run.stale=true})
  await clickText('刷新')
  await page.waitForFunction(()=>document.querySelector('.cr-quote')?.disabled)
  await page.evaluate(()=>{window.__reviewState.canWrite=false})
  await page.waitForFunction(()=>document.querySelector('.cr-primary').disabled)
  assert.equal(await page.$eval('.cr-input',el=>el.disabled),true)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:true,scenario:'actual Vue components with synthetic API/editor and native tag adapter',screenshots:[path.join(out,'standard.png'),path.join(out,'results.png')]}))
} finally { if(browser)await browser.close();await server.close() }
