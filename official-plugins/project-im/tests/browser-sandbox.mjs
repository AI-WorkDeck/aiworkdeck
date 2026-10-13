// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const executablePath = process.env.IM_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const host = `<!doctype html><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-forms" src="/index.html"></iframe><script>
const frame=document.querySelector('iframe');window.calls=[];let removed=false,left=false,clientVisible=false;
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context:{projectId:1,pluginId:'project-im',theme:'light'}},'*');
addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.data?.type!=='call')return;
const {seq,method,params}=e.data;calls.push({method,...params});let result={};
if(method==='context.get')result={projectId:1,pluginId:'project-im'};
if(method==='files.prepareDrag'&&window.dragHelpers)result=dragHelpers.preparePluginImDrag(window.dragOwner,{id:6,name:'合成合同.docx',fileType:'docx'},1,window,{frame,rect:params.rect});
if(method==='files.endDrag'&&window.dragHelpers)dragHelpers.endPluginImDrag(window.dragOwner);
if(method==='im.request'){const p=params.params;switch(params.action){
case 'self':result={id:9,displayName:'合成律师'};break;
case 'list':result={conversations:left?[]:[{id:'a',title:'合成法律项目',role:'OWNER',type:'GROUP'}]};break;
case 'messages':result={messages:[{id:1,senderId:10,senderName:'合成客户',text:'请查收合同。',createdAt:'2026-10-13T00:00:00Z',attachment:{id:'f1',name:'合成合同.docx',size:1024,available:true,clientVisible,canManageAccess:true,source:{projectUid:'p1',fileUid:'u1'}}},{id:2,senderId:10,text:'另一份材料稍后开放',attachment:{id:'f2',available:false,message:'抱歉文件还在准备中，请联系您的律师。'}}]};break;
case 'members':result={members:[{id:9,displayName:'律师',role:'OWNER'},...(removed?[]:[{id:10,displayName:'客户',role:'CLIENT'}])]};break;
case 'import':result={path:'项目沟通/a/合同.docx',id:6,uid:'file6'};break;
case 'export':result={path:'项目沟通/a/聊天记录.md'};break;
case 'fileAccess':clientVisible=p.clientVisible;break;
case 'removeMember':removed=true;break;
case 'leave':left=true;break;
}}
frame.contentWindow.postMessage({awd:1,type:'result',seq,ok:true,result},'*');});
</script>`;
const webRoot = new URL('../web/', import.meta.url);
test('real sandbox SDK bridge supports explicit import/export/member/leave confirmations and both theme layouts', { skip: !existsSync(executablePath), timeout: 30000 }, async (t) => {
  const server = createServer((req, res) => {
    let text, type = 'text/html';
    if (req.url === '/') text = host;
    else if (req.url === '/drag-helper.js') { text = readFileSync(new URL('../../../frontend/src/utils/pluginImDrag.js', import.meta.url)); type = 'text/javascript'; }
    else if (req.url === '/awd-plugin-sdk.js') { text = readFileSync(new URL('../../../sdk/plugin-sdk/awd-plugin-sdk.js', import.meta.url)); type = 'text/javascript'; }
    else if (['/index.html','/panel.js','/panel.css'].includes(req.url)) { text = readFileSync(new URL(req.url.slice(1), webRoot)); type = req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : type; }
    else { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', type + '; charset=utf-8'); res.end(text);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const browser = await puppeteer.launch({ executablePath, headless: true }); t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const page = await browser.newPage(), errors = []; page.setDefaultTimeout(5000); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const frame = await (await page.$('iframe')).contentFrame();
  await frame.waitForSelector('.conversation'); await frame.click('.conversation'); await frame.waitForSelector('.file-card');
  const clickText = async (text) => { const handle = await frame.waitForFunction((text) => [...document.querySelectorAll('button')].find((el) => el.textContent === text && el.getBoundingClientRect().width > 0), {}, text); await handle.asElement().click(); };
  const confirmedAction = async (text, action) => {
    await clickText(text); await frame.waitForSelector('#confirmation[open]');
    assert.equal(await page.evaluate((a) => calls.filter((c) => c.action === a).length, action), 0);
    await frame.click('#confirmation-ok'); await page.waitForFunction((a) => calls.some((c) => c.action === a), {}, action);
  };
  await confirmedAction('存入项目', 'import'); await clickText('打开');
  await page.waitForFunction(() => calls.some((c) => c.method === 'ui.openFile' && c.path.endsWith('合同.docx')));
  await confirmedAction('归档聊天', 'export');
  await clickText('查看文件');
  assert.equal(await frame.$eval('#notice', (el) => el.textContent), '抱歉文件还在准备中，请联系您的律师。');
  assert.equal(await page.evaluate(() => calls.some((c) => c.action === 'import' && c.params.attachmentId === 'f2')), false);
  await confirmedAction('客户可见', 'fileAccess');
  await clickText('设为内部'); await frame.waitForSelector('#confirmation[open]');
  assert.match(await frame.$eval('#confirmation-text', (el) => el.textContent), /副本无法收回/);
  await frame.click('#confirmation-ok'); await page.waitForFunction(() => calls.filter((c) => c.action === 'fileAccess').length === 2);
  await frame.waitForFunction(() => [...document.querySelectorAll('.file-actions button')].some((b) => b.textContent === '客户可见'));
  for (const width of [220, 260, 420, 960]) for (const theme of ['light','dark']) {
    await page.setViewport({ width, height: 760 });
    await page.evaluate((theme) => document.querySelector('iframe').contentWindow.postMessage({ awd:1,type:'theme',theme,tokens:{} }, '*'), theme);
    await frame.waitForFunction((theme) => document.documentElement.dataset.theme === theme, {}, theme);
    const layout = await frame.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, send: document.getElementById('send').getBoundingClientRect().right <= innerWidth }));
    assert.equal(layout.overflow, false, `${width} ${theme}`); assert.equal(layout.send, true);
  }
  // Actual plugin button + actual SDK request + host helper + physical mouse drop.
  await page.setViewport({ width: 1000, height: 760 });
  await page.evaluate(async () => {
    window.dragHelpers = await import('/drag-helper.js'); window.dragOwner = { sessionGeneration: 1 };
    document.querySelector('iframe').style.width = '700px';
    const drop = document.createElement('div'); drop.id = 'ai-drop'; drop.textContent = '合成 AI 材料区';
    Object.assign(drop.style, { position: 'fixed', left: '740px', top: '120px', width: '220px', height: '300px', background: '#ddd' });
    drop.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
    drop.addEventListener('drop', (event) => { event.preventDefault(); window.nativeDrop = dragHelpers.consumePluginImDrag(event.dataTransfer, 1); });
    document.body.append(drop);
  });
  const dragButton = await frame.waitForSelector('.drag-file'); const bounds = await dragButton.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.waitForSelector('[data-awd-plugin-drag-handle]');
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2, { steps: 5 });
  await page.mouse.move(810, 230, { steps: 30 }); await page.mouse.up();
  await page.waitForFunction(() => window.nativeDrop?.file?.id === 6);
  assert.equal(await page.evaluate(() => nativeDrop.file.name), '合成合同.docx');
  assert.equal(await page.$$eval('[data-awd-plugin-drag-handle]', (els) => els.length), 0);
  await frame.click('#members-button'); await confirmedAction('移除', 'removeMember');
  await frame.waitForFunction(() => document.querySelectorAll('.member-row').length === 1);
  await confirmedAction('退出会话', 'leave'); await frame.waitForFunction(() => document.getElementById('active-chat').hidden);
  assert.deepEqual(errors, []);
});
