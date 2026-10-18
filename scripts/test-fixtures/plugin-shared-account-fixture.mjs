// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated synthetic boundary for real AccountService / PlatformAiChannel HTTP. Never forwards traffic.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

// node scripts/test-fixtures/plugin-shared-account-fixture.mjs [--port 19854] [--audit-output /tmp/audit.json]
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '19854' },
  'audit-output': { type: 'string', default: path.join(os.tmpdir(), 'plugin-shared-account-fixture-audit.json') }
} })
const port = Number(values.port), auditFile = path.resolve(values['audit-output'])
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535')
fs.mkdirSync(path.dirname(auditFile), { recursive: true })
const accounts = new Map([
  ['awdk_fixture_shared_a', {id:'fixture-account-a', label:'Synthetic account A', creditsCents:10000, rejected:false, entitlements:[], runtime:'sk-fixture-platform-a'}],
  ['awdk_fixture_shared_b', {id:'fixture-account-b', label:'Synthetic account B', creditsCents:0, rejected:false, entitlements:[], runtime:'sk-fixture-platform-b'}]
])
const demoFeature = 'plugin:plugin-service-demo'
const stats={startedAt:new Date().toISOString(),pid:process.pid,port,requests:[],counts:{},chat:{shared:0,byok:0},usage:{},delayMs:0}
function persist(){fs.writeFileSync(auditFile,JSON.stringify(stats,null,2),{mode:0o600})}
function reply(res,status,body){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body))}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://127.0.0.1:${port}`), path=url.pathname
    let raw=''; for await(const chunk of req){raw+=chunk;if(raw.length>2*1024*1024){reply(res,413,{error:'too_large'});return}}
    let body={};if(raw){try{body=JSON.parse(raw)}catch{reply(res,400,{error:'invalid_json'});return}}
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'')
    const account=accounts.get(token)
    const runtime=[...accounts.values()].find(a=>a.runtime===token)
    const byok=token==='sk-fixture-byok'
    const channel=runtime?'shared':byok?'byok':null
    const key=`${req.method} ${path}`;stats.counts[key]=(stats.counts[key]||0)+1
    stats.requests.push({at:new Date().toISOString(),method:req.method,path,account:account?.id||runtime?.id||null,channel,model:body.model||null,stream:body.stream===true});persist()
    if(path==='/__fixture'&&req.method==='GET'){reply(res,200,{...stats,accounts:[...accounts.values()].map(({runtime,...a})=>a)});return}
    if ((path === '/zh/marketplace/plugins' || path === '/en/marketplace/plugins') && req.method === 'GET') {
      res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'})
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic plugin checkout — no charge</title>
<body><main><h1>合成插件购买页 / Synthetic plugin checkout</h1><p>仅隔离测试，不收费，不连接支付服务。No charge. No payment provider is contacted.</p>
<p>Fixed demo: plugin-service-demo · Synthetic account A</p><button id="grant" type="button">模拟授予权益 / Grant synthetic entitlement</button><p id="result" role="status"></p></main>
<script>document.getElementById('grant').addEventListener('click', async function () {
  this.disabled = true; const result = document.getElementById('result'); result.textContent = 'Applying synthetic entitlement…';
  try { const response = await fetch('/__fixture', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({accountId:'fixture-account-a',entitlements:['plugin:plugin-service-demo']}) });
    if (!response.ok) throw new Error('Synthetic update failed');
    result.textContent = '合成权益已启用，请返回宿主刷新。Synthetic entitlement enabled; return to the host and refresh. No payment occurred.';
  } catch (error) { result.textContent = error.message; this.disabled = false; }
});</script></body></html>`)
      return
    }
    if(path==='/__fixture'&&req.method==='POST'){
      if(body.accountId){const a=[...accounts.values()].find(a=>a.id===body.accountId);if(!a){reply(res,400,{error:'unknown_account'});return}if(Number.isFinite(body.creditsCents))a.creditsCents=body.creditsCents;if(typeof body.rejected==='boolean')a.rejected=body.rejected
        if (body.entitlements !== undefined) {
          if (!Array.isArray(body.entitlements) || body.entitlements.some(feature => feature !== demoFeature)) { reply(res,400,{error:'only_fixed_demo_entitlement_allowed'}); return }
          a.entitlements = [...new Set(body.entitlements)].map(feature => ({feature,purchasedAt:new Date().toISOString(),orderId:'synthetic-no-charge'}))
        }
      }
      if(Number.isFinite(body.delayMs))stats.delayMs=Math.max(0,Math.min(10000,body.delayMs))
      if(body.resetCounters===true){stats.requests=[];stats.counts={};stats.chat={shared:0,byok:0};stats.usage={}}
      persist();reply(res,200,{ok:true});return
    }
    if(path==='/health'){reply(res,200,{ok:true,synthetic:true,port});return}
    if(path==='/api/license/verify-key'){
      const a=accounts.get(body.key);reply(res,a&&!a.rejected?200:401,{valid:!!a&&!a.rejected,plan:'free'});return
    }
    if(path.startsWith('/v1/')){
      if(!channel||runtime?.rejected){reply(res,401,{error:{message:'Synthetic credential rejected',type:'authentication_error'}});return}
      if(path==='/v1/key'){reply(res,200,{data:{usage:stats.usage[token]||0,limit:100,is_free_tier:false}});return}
      if(path==='/v1/models'){reply(res,200,{object:'list',data:[{id:'fixture-model',object:'model',owned_by:'synthetic'}]});return}
      if(path!=='/v1/chat/completions'||req.method!=='POST'){reply(res,404,{error:'unsupported_fixture_route'});return}
      if(runtime&&runtime.creditsCents<=0){reply(res,402,{error:{message:'Synthetic balance exhausted',type:'insufficient_quota'}});return}
      stats.chat[channel]++;stats.usage[token]=(stats.usage[token]||0)+0.001;persist()
      const id=`chatcmpl-fixture-${channel}-${stats.chat[channel]}`,created=Math.floor(Date.now()/1000),model=body.model||'fixture-model'
      const content=`Synthetic ${channel==='shared'?'shared host AI':'BYOK AI'} response ${stats.chat[channel]}. No external model or payment was used.`
      if(stats.delayMs)await new Promise(r=>setTimeout(r,stats.delayMs))
      if(body.stream===true){
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'})
        const event=(delta,finish_reason=null,usage)=>res.write(`data: ${JSON.stringify({id,object:'chat.completion.chunk',created,model,choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})}\n\n`)
        event({role:'assistant',content:''});event({content});event({},'stop',{prompt_tokens:12,completion_tokens:18,total_tokens:30});res.end('data: [DONE]\n\n')
      }else reply(res,200,{id,object:'chat.completion',created,model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:18,total_tokens:30}})
      return
    }
    if(!account||account.rejected){reply(res,401,{error:'unauthorized'});return}
    const me={accountId:account.id,username:account.id,displayName:account.label,balanceCents:account.creditsCents,creditsCents:account.creditsCents,plan:'free',subscription:null,avatarUpdatedAt:null,displayNameIsDefault:false}
    if(path==='/api/account/me'){reply(res,200,me);return}
    if(path==='/api/account/entitlements'){reply(res,200,{entitlements:account.entitlements});return}
    if(path==='/api/account/ledger'){reply(res,200,{entries:[]});return}
    if(path==='/api/account/ai-usage'){reply(res,200,{creditsCents:account.creditsCents,limitUsd:100,usageUsd:stats.usage[account.runtime]||0,available:true});return}
    if(path==='/api/account/ai-key'&&req.method==='POST'){reply(res,account.creditsCents>0?200:409,account.creditsCents>0?{openrouterKey:account.runtime,limitUsd:100}:{error:'no_credits'});return}
    if(path==='/api/account/membership'){reply(res,200,{tier:{level:0,key:'free',nameZh:'合成免费账户',nameEn:'Synthetic free account'},points:0});return}
    if(path==='/api/account/trial'){reply(res,200,{available:false,remainingTurns:0,totalTurns:0,usedTurns:0});return}
    if(path==='/api/account/trial/turns'&&req.method==='POST'){reply(res,200,{ok:true});return}
    if(path==='/api/account/team'){reply(res,200,{team:null,invites:[]});return}
    if(path==='/api/account/team/usage'&&req.method==='POST'){reply(res,200,{ok:true});return}
    reply(res,404,{error:'unsupported_fixture_route',path})
  }catch(error){if(!res.headersSent)reply(res,500,{error:'fixture_failure'});else res.end();console.error(error.message)}
})
server.listen(port,'127.0.0.1',()=>{persist();console.log(JSON.stringify({ready:true,pid:process.pid,port,auditFile}))})
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)))
