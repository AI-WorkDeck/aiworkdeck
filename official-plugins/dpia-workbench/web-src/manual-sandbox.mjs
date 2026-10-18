// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated synthetic host for manual browser checks; never opens a real backend or model.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const fixture = {
  id: 'synthetic-case', title: '合成隐私评估', version: 1, evidence: [], assets: [], events: [], answerDrafts: [], answerStates: [],
  presentation: { rules: { 'EU-C01': '目的与范围' }, sources: [{ id: 'GDPR', title: 'GDPR 原文', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' }] },
  result: { record: { revisionId: 'synthetic-revision', inputVersion: 1 }, assessment: { jurisdictions: [{ code: 'EU' }], facts: [], questions: [], risks: [], actions: [], controls: [], rule_assessments: [], sources: [] }, sourceIndex: { sources: [], passages: [] }, intake: { checks: [], fact_links: [] }, warnings: [], dimensions: [{ rule_id: 'EU-C01', analysis: '合成界面验证，不是法律判断。', review: { progress: 'complete', finding: 'met' }, source_refs: [{ source_id: 'GDPR', locator: '5' }] }] },
};
const html = `<!doctype html><meta charset="utf-8"><title>DPIA 独立沙箱验收</title>
<style>body{margin:0;font:14px system-ui}header{padding:10px;display:flex;gap:8px;align-items:center;background:#eee}button{padding:6px 10px}iframe{display:block;border:0;width:100%;height:calc(100vh - 150px)}pre{margin:0;padding:10px;height:80px;overflow:auto;font-size:11px}</style>
<header>合成测试宿主 <button id="light">浅色</button><button id="dark">深色</button><button id="narrow">窄分屏</button><button id="wide">宽工作区</button><button id="switch">切换账号</button></header>
<iframe title="DPIA 工作台沙箱" sandbox="allow-scripts allow-forms" src="/plugin/index.html"></iframe><pre id="calls" aria-label="桥调用记录"></pre>
<script>
const frame=document.querySelector('iframe'),log=document.querySelector('#calls'),records=[];
const current=${JSON.stringify(fixture)};
function post(data){frame.contentWindow.postMessage({awd:1,...data},'*');}
frame.onload=()=>post({type:'init',context:{pluginId:'dpia-workbench',projectId:1,theme:'light'}});
document.querySelector('#dark').onclick=()=>post({type:'theme',theme:'dark',tokens:{}});
document.querySelector('#light').onclick=()=>post({type:'theme',theme:'light',tokens:{}});
document.querySelector('#narrow').onclick=()=>{frame.style.width='390px';};
document.querySelector('#wide').onclick=()=>{frame.style.width='100%';};
document.querySelector('#switch').onclick=()=>post({type:'event',event:'account.changed',data:{}});
window.addEventListener('message',event=>{
 if(event.source!==frame.contentWindow||event.data?.awd!==1||event.data.type!=='call')return;
 const {seq,method,params}=event.data;let result={};
 records.push({method,...(method==='tools.invoke'?JSON.parse(params.args.json):params)});log.textContent=JSON.stringify(records.slice(-4),null,2);log.scrollTop=log.scrollHeight;
 if(method==='events.subscribe')result={subscribed:params.events};
 if(method==='tools.invoke'){
  const p=JSON.parse(params.args.json);let value;
  if(p.action==='list')value={cases:[{...current,resultStatus:'synced',openGaps:0,riskCount:0}],testFixtures:[],errors:[]};
  else if(p.action==='get')value=current;
  else if(p.action==='execution')value={sessionId:'session-synthetic',phase:'ready',revision:1,stoppedAt:'2026-10-18T00:00:00Z',running:false,statusKnown:true};
  else if(p.action==='reportList')value=[];
  else if(p.action==='report')value={revisionId:'synthetic-revision',inputVersion:1,content:'# 合成内部报告',blocks:[{type:'heading',level:1,text:'合成内部报告'},{type:'paragraph',text:'这是沙箱界面验证，不包含真实材料。'}]};
  else if(p.action==='downloadInternalWord'||p.action==='exportInternalMarkdown')value={fileId:9,path:'DPIA/合成报告.'+(p.action==='exportInternalMarkdown'?'md':'docx'),filename:'合成报告'};
  else if(p.action==='sessionInfo')value={conversationId:'conv-synthetic'};
  else{result={output:JSON.stringify({ok:false,error:{message:'SYNTHETIC_ACTION_NOT_IMPLEMENTED'}})};post({type:'result',seq,ok:true,result});return;}
  result={output:JSON.stringify({ok:true,value})};
 }
 post({type:'result',seq,ok:true,result});
});
</script>`;
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
  const name = request.url?.replace(/^\/plugin\//, '');
  if (!['index.html', 'panel.css', 'panel.js', 'awd-plugin-sdk.js'].includes(name)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/javascript');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(await readFile(new URL('../web/' + name, import.meta.url)));
});
server.listen(0, '127.0.0.1', () => console.log('DPIA sandbox: http://127.0.0.1:' + server.address().port));
