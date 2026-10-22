// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const executablePath = process.env.IM_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Synthetic service responses exercise the actual plugin, SDK, opaque iframe and native browser input.
const host = `<!doctype html><meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-forms" src="/index.html"></iframe><script>
const frame=document.querySelector('iframe');window.calls=[];
const agent={scope:'project',scopeKey:'project-uuid',name:'项目助手',title:'合成测试项目'};
const group={id:'group',title:'合成测试项目',type:'GROUP',role:'OWNER',agent:{...agent,private:false}};
const privateChat={id:'private',title:'项目助手私聊',type:'AGENT_DIRECT',role:'OWNER',agent:{...agent,private:true}};
let conversations=[],messages=[],status=null,attempts=0;
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context:{projectId:1,pluginId:'project-im',theme:'light'}},'*');
addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.data?.type!=='call')return;
const {seq,method,params={}}=e.data;calls.push({method,...params});let result={};
if(method==='im.request'&&params.action==='agentReply'&&window.rejectAdmissions){frame.contentWindow.postMessage({awd:1,type:'result',seq,ok:false,error:{code:'BUSY',message:'合成测试：助手繁忙，请稍后重试'}},'*');return;}
if(method==='context.get')result={projectId:1,pluginId:'project-im'};
if(method==='im.directory')result={me:{id:9},organization:null,firm:null,projectColleagues:[],friends:[]};
if(method==='im.request'){const p=params.params||{};switch(params.action){
case 'self':result={id:9,displayName:'合成律师'};break;
case 'agentScopes':result={agents:[agent]};break;
case 'ensureAgent':result=p.private?privateChat:group;if(!conversations.some(c=>c.id===result.id))conversations.push(result);break;
case 'list':result={conversations};break;
case 'members':result={humanCount:1,members:[{id:9,role:'OWNER',displayName:'合成律师',actorType:'HUMAN'},{id:'agent:group',displayName:'项目助手',actorType:'AGENT'}]};break;
case 'send':result={id:messages.length+1,senderId:9,actorType:'HUMAN',senderName:'合成律师',text:p.text,clientMessageId:p.clientMessageId};messages.push(result);break;
case 'messages':result={messages:p.conversationId==='group'?messages:[],agentStatus:p.conversationId==='group'?status:null};break;
case 'agentReply':attempts++;status={status:attempts===1?'failed':'completed',messageId:p.messageId,error:attempts===1?'合成测试：模型连接失败':undefined};if(attempts>1)messages.push({id:messages.length+1,senderId:0,actorType:'AGENT',senderName:'项目助手',text:'合成助手回复：可以继续项目讨论。'});result={accepted:true,status:'queued',messageId:p.messageId};break;
}}
frame.contentWindow.postMessage({awd:1,type:'result',seq,ok:true,result},'*');});
</script>`;

test('assistant group, retry and private chat work through native browser input and opaque SDK bridge', { skip: !existsSync(executablePath), timeout: 30000 }, async (t) => {
  const server = createServer((req, res) => {
    let text, type = 'text/html';
    if (req.url === '/') text = host;
    else if (req.url === '/awd-plugin-sdk.js') { text = readFileSync(new URL('../../../sdk/plugin-sdk/awd-plugin-sdk.js', import.meta.url)); type = 'text/javascript'; }
    else if (['/index.html', '/panel.js', '/panel.css'].includes(req.url)) { text = readFileSync(new URL('../web' + req.url, import.meta.url)); type = req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : type; }
    else { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', type + '; charset=utf-8'); res.end(text);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage(), errors = []; page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1120, height: 760 }); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const frame = await (await page.$('iframe')).contentFrame();
  await frame.waitForFunction(() => !document.getElementById('active-chat').hidden);
  assert.match(await frame.$eval('#chat-subtitle', el => el.textContent), /群成员可见/);
  assert.equal(await frame.$eval('#directory', el => el.open), false);
  await frame.type('#draft', '单人测试：请回复这条消息。'); await frame.focus('#draft'); await page.keyboard.press('Enter');
  await frame.waitForFunction(() => document.getElementById('agent-status').textContent.includes('模型连接失败'));
  await frame.click('#agent-status button');
  await frame.waitForFunction(() => document.getElementById('messages').textContent.includes('合成助手回复'));
  assert.match(await frame.$eval('#messages', el => el.textContent), /项目助手 · AI 助手/);
  assert.equal(await page.evaluate(() => calls.filter(c => c.action === 'send').length), 1);
  assert.deepEqual(await page.evaluate(() => calls.filter(c => c.action === 'agentReply').map(c => c.params.messageId)), [1, 1]);
  if (process.env.IM_SCREENSHOT_DIR) { mkdirSync(process.env.IM_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: process.env.IM_SCREENSHOT_DIR + '/assistant-group.png' }); }
  await frame.click('#agent-private');
  await frame.waitForFunction(() => document.getElementById('chat-subtitle').textContent.includes('仅你可见'));
  assert.match(await frame.$eval('#agent-info-summary', el => el.textContent), /使用平台 AI 额度.*当前项目资料在云端回复/);
  assert.match(await frame.$eval('#agent-info-detail', el => el.textContent), /材料正文会随提问发送.*不使用本机选择的模型/);
  assert.equal(await frame.$eval('#agent-info details', el => el.open), false);
  assert.equal(await frame.$eval('#members-button', el => el.hidden), true);
  assert.equal(await frame.$eval('.composer-tools', el => el.hidden), true);
  assert.equal(await page.evaluate(() => calls.some(c => c.action === 'invite')), false);
  for (const width of [220, 260, 420, 960]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 760 });
    await page.evaluate(theme => document.querySelector('iframe').contentWindow.postMessage({ awd: 1, type: 'theme', theme, tokens: {} }, '*'), theme);
    await frame.waitForFunction(theme => document.documentElement.dataset.theme === theme, {}, theme);
    const layout = await frame.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, send: document.getElementById('send').getBoundingClientRect().right <= innerWidth, composerVisible: document.getElementById('send').getBoundingClientRect().bottom <= innerHeight }));
    assert.deepEqual(layout, { overflow: false, send: true, composerVisible: true }, `${width} ${theme}`);
  }
  await page.setViewport({ width: 220, height: 760 }); await frame.focus('#agent-info summary'); await page.keyboard.press('Enter');
  assert.equal(await frame.$eval('#agent-info details', el => el.open), true);
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('send').getBoundingClientRect().bottom <= innerHeight), true);
  if (process.env.IM_SCREENSHOT_DIR) await page.screenshot({ path: process.env.IM_SCREENSHOT_DIR + '/assistant-private-narrow.png' });
  await page.evaluate(() => { window.rejectAdmissions = true; });
  for (let i = 0; i < 3; i++) { await frame.type('#draft', `第${i + 1}条待重试问题`); await frame.focus('#draft'); await page.keyboard.press('Enter'); }
  await frame.waitForFunction(() => document.querySelectorAll('#agent-status button').length === 3);
  assert.equal(await frame.evaluate(() => document.getElementById('agent-status').scrollHeight > document.getElementById('agent-status').clientHeight && document.getElementById('send').getBoundingClientRect().bottom <= innerHeight), true, 'multiple retry rows scroll while the narrow composer stays accessible');
  await page.setViewport({ width: 260, height: 760 }); await frame.click('#back');
  await frame.focus('#directory summary'); await page.keyboard.press('Enter');
  assert.equal(await frame.$eval('#directory', el => el.open), true);
  assert.doesNotMatch(await frame.$eval('body', el => el.textContent), /我的组织|切换组织|我的朋友/);
  assert.deepEqual(errors, []);
});
