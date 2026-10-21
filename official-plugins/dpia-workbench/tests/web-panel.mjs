// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../web/panel.js', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(check, label = 'UI update') {
  for (let i = 0; i < 150; i++) { if (check()) return; await tick(); }
  assert.ok(check(), label);
}
function caseFixture() {
  const assessment = { jurisdictions: [{ code: 'EU' }], facts: [{ id: 'F1', value: '<script>原始材料</script>', source_ids: [] }], questions: [{ id: 'Q1', status: 'open', question: '保留期限？', compliance_impact: '范围尚待确认' }], risks: [], actions: [], controls: [], rule_assessments: [], sources: [] };
  return { id: 'case-a', title: '合成评估项目', version: 3, evidence: [{ id: 'SRC1', title: '合成材料', locator: '原始文本' }], assets: [], events: [], answerDrafts: [], answerStates: [], presentation: { rules: { 'EU-C01': '目的与范围' }, sources: [{ id: 'EU-GDPR', title: 'GDPR 原文', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' }] }, result: { record: { revisionId: 'rev-a', inputVersion: 3 }, assessment, sourceIndex: { sources: [], passages: [] }, intake: { checks: [], fact_links: [] }, warnings: [], dimensions: [{ rule_id: 'EU-C01', analysis: '合成分析', review: { progress: 'complete', finding: 'met' }, source_refs: [{ source_id: 'EU-GDPR', locator: '5' }] }] } };
}
async function panel(t, options = {}) {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://plugin.invalid/', pretendToBeVisual: true, virtualConsole });
  const calls = [], events = {};
  let current = caseFixture();
  let execution = { sessionId: 'session-case', phase: 'ready', revision: 1, statusKnown: true, running: false, stoppedAt: '2026-10-18T00:00:00Z' };
  const report = { requestId: 'report-a', phase: 'ready', reportType: 'draft', language: 'en', template: '合成模板', revisionId: 'rev-a' };
  dom.window.awd = {
    ready: async () => options.context || { projectId: 1, pluginId: 'dpia-workbench' },
    events: { on: (name, fn) => { events[name] = fn; } },
    call: async (method, args) => { calls.push({ method, ...args }); },
    ui: { openFile: async (path) => { calls.push({ method: 'ui.openFile', path }); if (options.openError) throw new Error(options.openError); } },
    tools: { invoke: async (name, args) => {
      const payload = JSON.parse(args.json);
      assert.equal(name, 'dpia_workbench_action'); assert.equal(args.action, payload.action);
      calls.push(payload);
      const customized = await options.handle?.(payload);
      if (customized !== undefined) return JSON.stringify(customized);
      let value;
      switch (payload.action) {
        case 'environmentCheck': value = { platform: 'Windows 11', ready: false, requirementsPath: 'C:/Plugin/runtime/requirements.txt', checks: [{ id: 'node', label: 'Node.js', status: 'needs_attention', message: '未安装 Node.js；请设置路径' }] }; break;
        case 'list': value = { cases: [{ ...current, resultStatus: 'synced', openGaps: 1, riskCount: 0 }], testFixtures: [], errors: [] }; break;
        case 'get': value = current; break;
        case 'execution': value = execution; break;
        case 'create': current = { ...current, title: payload.title, result: null, version: 1, evidence: [] }; value = current; break;
        case 'start': execution = { ...execution, phase: 'accepted', requestId: 'request-a', revision: 2, running: true }; value = execution; break;
        case 'sessionInfo': value = { conversationId: 'conv-case' }; break;
        case 'reportList': value = [report]; break;
        case 'report': value = { revisionId: 'rev-a', inputVersion: 3, content: '# 合成内部报告', blocks: [{ type: 'heading', level: 1, text: '合成内部报告' }] }; break;
        case 'downloadInternalWord': case 'downloadReport': case 'exportInternalMarkdown': value = { fileId: 12, path: 'DPIA/合成报告.' + (payload.action === 'exportInternalMarkdown' ? 'md' : payload.format || 'docx'), filename: '合成报告' }; break;
        case 'evidence': current = { ...current, version: current.version + 1, evidence: [...current.evidence, { id: 'SRC2', title: payload.title, locator: payload.locator }] }; value = current; break;
        case 'importAsset': current = { ...current, version: current.version + 1, assets: [{ id: 'FILE1', filename: payload.filename, status: 'ready', warnings: [] }] }; value = current; break;
        case 'source': value = { title: '合成材料', text: '<img src=x onerror=alert(1)>原始文本' }; break;
        default: throw new Error('Unexpected action: ' + payload.action);
      }
      return JSON.stringify({ ok: true, value });
    } },
  };
  dom.window.eval(bundle);
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const document = dom.window.document;
  const text = () => document.body.textContent;
  await until(() => text().includes(options.initialError || (options.context?.projectId === null ? '请先打开项目' : '合成评估项目')));
  async function click(label) {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent === label);
    assert.ok(button, 'button: ' + label); assert.equal(button.disabled, false);
    button.click(); await tick(); await tick();
  }
  async function open() { document.querySelector('button.case').click(); await until(() => !!document.querySelector('button') && text().includes('打开执行会话')); }
  async function submit(form, values) {
    for (const [name, value] of Object.entries(values)) form.elements.namedItem(name).value = value;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(); await tick();
  }
  return { dom, document, calls, events, text, click, open, submit };
}

test('built React UI preserves all sections, escaped evidence and explicit analysis dispatch', async (t) => {
  const p = await panel(t); await p.open();
  for (const name of ['总览', '材料与事实', '问题与补答', '评估与风险', '整改与复评', '报告与版本']) assert.ok([...p.document.querySelectorAll('button')].some((b) => b.textContent === name), name);
  await p.click('材料与事实');
  assert.ok(p.text().includes('<script>原始材料</script>'));
  assert.equal(p.document.querySelector('main script'), null);
  await p.click('查看原文'); await until(() => p.text().includes('<img src=x onerror=alert(1)>原始文本'));
  assert.equal(p.document.querySelector('[role=dialog] img'), null);
  p.document.querySelector('[aria-label="关闭窗口"]').click(); await tick();
  await p.click('基于当前材料继续分析');
  assert.equal(p.calls.filter((c) => c.action === 'start').length, 0);
  assert.ok(p.text().includes('本轮分析范围'));
  await p.click('确认输入并开始运行');
  await until(() => p.calls.some((c) => c.action === 'start'));
  const start = p.calls.find((c) => c.action === 'start');
  assert.equal(start.version, 3); assert.equal(start.executionRevision, 1); assert.deepEqual(start.answerIds, []);
});

test('create and save evidence use real forms and retain current version', async (t) => {
  const p = await panel(t);
  await p.submit(p.document.querySelector('input[name=title]').form, { title: '新合成项目' });
  await until(() => p.text().includes('材料修订 1'));
  const form = p.document.querySelector('textarea[name=text]').form;
  await p.submit(form, { title: '产品说明', locator: '第 1 页', text: '只上传这份合成材料' });
  await until(() => p.text().includes('材料修订 2'));
  assert.deepEqual(p.calls.find((c) => c.action === 'evidence'), { action: 'evidence', id: 'case-a', version: 1, title: '产品说明', locator: '第 1 页', text: '只上传这份合成材料' });
  assert.equal(p.calls.some((c) => c.action === 'start'), false);
});

test('session, source links and exports go through host bridges without browser downloads', async (t) => {
  const p = await panel(t); await p.open();
  await p.click('打开执行会话');
  await until(() => p.calls.some((c) => c.method === 'chat.open'));
  assert.ok(p.calls.some((c) => c.method === 'chat.open' && c.conversationId === 'conv-case'));
  await p.click('评估与风险'); p.document.querySelector('a[href]').click();
  await until(() => p.calls.some((c) => c.method === 'ui.openUrl'));
  await p.click('报告与版本'); await p.click('预览 / 保存内部报告');
  await until(() => p.text().includes('合成内部报告'));
  await p.click('保存 Word 到项目'); await until(() => p.calls.some((c) => c.method === 'ui.openFile' && c.path.endsWith('.docx')));
  await p.click('保存 Markdown 到项目'); await until(() => p.calls.some((c) => c.method === 'ui.openFile' && c.path.endsWith('.md')));
  assert.deepEqual(p.calls.find((c) => c.action === 'exportInternalMarkdown'), { action: 'exportInternalMarkdown', id: 'case-a', version: 3, revisionId: 'rev-a' });
  p.document.querySelector('[aria-label="关闭窗口"]').click(); await tick();
  await p.click('保存这一版 PDF 到项目'); await until(() => p.calls.some((c) => c.method === 'ui.openFile' && c.path.endsWith('.pdf')));
  assert.equal(p.document.querySelector('a[download]'), null);
});

test('export opening failure is visible and never reports success', async (t) => {
  const p = await panel(t, { openError: 'HOST_OPEN_FAILED' }); await p.open();
  await p.click('查看本轮报告'); await until(() => p.text().includes('合成内部报告'));
  await p.click('保存 Word 到项目'); await until(() => p.text().includes('HOST_OPEN_FAILED'));
  assert.equal(p.text().includes('已保存到项目并打开'), false);
});

test('late data cannot reappear after account changes', async (t) => {
  let release;
  const p = await panel(t, { handle: (payload) => payload.action === 'source' ? new Promise((resolve) => { release = resolve; }) : undefined });
  await p.open(); await p.click('材料与事实'); await p.click('查看原文');
  assert.ok(release); p.events['account.changed'](); await tick();
  release({ ok: true, value: { title: '旧账号', text: 'STALE_PRIVATE_CONTENT' } }); await tick(); await tick();
  assert.ok(p.text().includes('项目或账号已切换')); assert.equal(p.text().includes('STALE_PRIVATE_CONTENT'), false);
  assert.equal(p.document.querySelector('.dpia'), null);
});


test('environment preparation preserves unfinished form and project context, rechecks on return', async (t) => {
  const p = await panel(t);
  const title = p.document.querySelector('input[name=title]');
  title.value = '尚未提交的评估标题';
  await p.click('运行环境与准备指引');
  await until(() => p.text().includes('未安装 Node.js'));
  assert.equal(p.document.querySelector('input[name=title]'), title);
  assert.equal(title.value, '尚未提交的评估标题');
  assert.ok(p.text().includes('PowerShell'));
  assert.ok(p.text().includes('C:/Plugin/runtime/requirements.txt'));
  assert.equal(p.calls.some(c => c.action === 'create' || c.action === 'start'), false);
  const before = p.calls.filter(c => c.action === 'environmentCheck').length;
  p.dom.window.dispatchEvent(new p.dom.window.Event('focus'));
  await until(() => p.calls.filter(c => c.action === 'environmentCheck').length > before);
  p.document.querySelector('.dpia-environment a').click();
  await until(() => p.calls.some(c => c.method === 'ui.openUrl' && c.url === 'https://nodejs.org/en/download'));
  const afterFocus = p.calls.filter(c => c.action === 'environmentCheck').length;
  p.events['settings.changed']();
  await until(() => p.calls.filter(c => c.action === 'environmentCheck').length > afterFocus);
  await p.click('收起运行环境');
  assert.equal(title.value, '尚未提交的评估标题');
  await p.click('运行环境与准备指引');
  await until(() => p.calls.filter(c => c.action === 'environmentCheck').length > before + 1);
});

test('task failure still allows opening preparation without retrying or discarding task', async (t) => {
  const p = await panel(t, { handle: payload => payload.action === 'downloadInternalWord' ? { ok: false, error: { message: 'Python 缺少文档库' } } : undefined });
  await p.open(); await p.click('查看本轮报告');
  await until(() => p.text().includes('合成内部报告'));
  await p.click('保存 Word 到项目'); await until(() => p.text().includes('Python 缺少文档库'));
  await p.click('运行环境'); await until(() => p.text().includes('未安装 Node.js'));
  assert.equal(p.document.querySelector('.dpia-environment').style.zIndex, '10000');
  assert.ok(p.text().includes('合成内部报告'));
  await p.click('收起运行环境');
  assert.ok(p.document.querySelector('[role=dialog]'));
  assert.ok(p.text().includes('合成内部报告'));
  assert.equal(p.calls.filter(c => c.action === 'downloadInternalWord').length, 1);
});


test('missing Node on initial list leaves environment entry reachable', async (t) => {
  const p = await panel(t, { initialError: '无法启动 DPIA 运行环境', handle: payload => payload.action === 'list' ? { ok: false, error: { message: '无法启动 DPIA 运行环境' } } : undefined });
  await p.click('运行环境与准备指引');
  await until(() => p.text().includes('未安装 Node.js'));
  assert.equal(p.calls.filter(c => c.action === 'list').length, 1);
  assert.equal(p.calls.filter(c => c.action === 'environmentCheck').length, 1);
});
