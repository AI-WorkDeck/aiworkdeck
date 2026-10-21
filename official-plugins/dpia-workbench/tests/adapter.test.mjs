// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkDeckAdapter } from '../runtime/adapter.mjs';

function fixture(t) {
  const encoding = Object.fromEntries(['PYTHONUTF8', 'PYTHONIOENCODING'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(encoding)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const root = mkdtempSync(join(tmpdir(), 'awd-dpia-adapter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessions = new Map(), calls = [];
  let accept = true;
  const host = async (method, args) => {
    calls.push({ method, args });
    if (method === 'ensure') {
      if (!sessions.has(args.key)) sessions.set(args.key, { key: args.key, conversationId: 'conv-synthetic', running: false });
      return sessions.get(args.key);
    }
    if (method === 'status') return sessions.get(args.key) || null;
    if (method === 'submit') return accept;
    if (method === 'authorizeTask') return sessions.has(args.key);
    if (method === 'cancel') { sessions.get(args.key).running = false; return true; }
    throw Error('UNEXPECTED_HOST_METHOD');
  };
  const adapter = new WorkDeckAdapter(root, host);
  return { adapter, root, calls, sessions, host, setAccept: value => { accept = value; } };
}

test('adapter enforces UTF-8 files and protocol despite inherited legacy Python encoding', t => {
  const previous = Object.fromEntries(['PYTHONUTF8', 'PYTHONIOENCODING'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  process.env.PYTHONUTF8 = '0';
  process.env.PYTHONIOENCODING = 'cp1252';
  const root = mkdtempSync(join(tmpdir(), 'awd-dpia-encoding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const adapter = new WorkDeckAdapter(root, async () => { throw Error('No host operation expected'); });
  const source = join(root, 'synthetic.json'), output = join(root, 'roundtrip.json');
  writeFileSync(source, JSON.stringify({ title: '合成评估与合同材料' }), 'utf8');
  const result = spawnSync(adapter.python, ['-c',
    'import sys,json;from pathlib import Path; value=json.loads(Path(sys.argv[1]).read_text());Path(sys.argv[2]).write_text(json.dumps(value,ensure_ascii=False));print(json.dumps({"utf8Mode":sys.flags.utf8_mode,"title":value["title"]},ensure_ascii=False))',
    source, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { utf8Mode: 1, title: '合成评估与合同材料' });
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), { title: '合成评估与合同材料' });
});

async function started(f) {
  const c = await f.adapter.run({ action: 'create', title: '合成评估' });
  const execution = await f.adapter.run({ action: 'start', id: c.id, version: 1, executionRevision: 0 });
  return { c, execution, task: { action: 'task', id: c.id, requestId: execution.requestId } };
}

test('saved evidence survives restart without model submission; stale revision remains intact', async t => {
  const f = fixture(t), c = await f.adapter.run({ action: 'create', title: '合成材料' });
  await f.adapter.run({ action: 'evidence', id: c.id, version: 1, title: '设计', text: 'SYNTHETIC：保存期限未定。' });
  const recovered = new WorkDeckAdapter(f.root, f.host);
  const view = await recovered.run({ action: 'get', id: c.id });
  assert.equal(view.version, 2); assert.equal(view.evidence.length, 1); assert.equal(f.calls.length, 0);
  await assert.rejects(() => recovered.run({ action: 'gap', id: c.id, version: 1, question: '旧修改', impact: 'x' }), /STALE_VERSION/);
  assert.equal((await recovered.run({ action: 'get', id: c.id })).version, 2);
});

test('native submission receives original frozen prompt and explicit bounded task instructions', async t => {
  const f = fixture(t), { c, execution, task } = await started(f);
  assert.equal(execution.phase, 'accepted');
  const submitted = f.calls.find(x => x.method === 'submit').args;
  assert.equal(submitted.key, execution.sessionId); assert.equal(submitted.requestId, execution.requestId);
  assert.match(submitted.prompt, /dpia_workbench_task/); assert.match(submitted.prompt, /不调用 DSH/);
  const context = await f.adapter.run({ ...task, operation: 'context' });
  assert.equal(context.job.caseId, c.id); assert.equal(context.requestId, execution.requestId);
  const skill = await f.adapter.run({ ...task, operation: 'read', path: 'skill/SKILL.md', limit: 300 });
  assert.equal(skill.more, true); assert.match(skill.text, /GDPR/);
});

test('uncertain retry keeps request ID and frozen input despite later material edits', async t => {
  const f = fixture(t); f.setAccept(false);
  const { c, execution } = await started(f);
  assert.equal(execution.phase, 'uncertain');
  const updated = await f.adapter.run({ action: 'evidence', id: c.id, version: 1, title: '后来材料', text: '不属于原任务' });
  f.setAccept(true);
  const resumed = new WorkDeckAdapter(f.root, f.host);
  const retry = await resumed.run({ action: 'start', id: c.id, version: updated.version, executionRevision: execution.revision });
  const calls = f.calls.filter(x => x.method === 'submit');
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].args, calls[0].args);
  assert.equal(retry.materialVersion, 1); assert.equal(retry.requestId, execution.requestId);
});

test('task read/write refuse cross-case, symlink, immutable and stale paths', async t => {
  const f = fixture(t), { c, task } = await started(f);
  const other = await f.adapter.run({ action: 'create', title: '另一个评估' });
  await assert.rejects(() => f.adapter.run({ ...task, operation: 'read', path: join(other.directory, 'assessment.json') }), /UNSAFE/);
  symlinkSync(join(other.directory, 'assessment.json'), join(c.directory, 'leak.json'));
  await assert.rejects(() => f.adapter.run({ ...task, operation: 'read', path: 'leak.json' }), /UNSAFE/);
  for (const path of ['job.json', 'result.json', 'field-review.json', '../../assessment.json', 'script.py']) {
    await assert.rejects(() => f.adapter.run({ ...task, operation: 'write', path, content: '{}' }), /IMMUTABLE_OR_UNSAFE/);
  }
  await assert.rejects(() => f.adapter.run({ ...task, requestId: 'old', operation: 'write', path: 'edited.json', content: '{}' }), /STALE_TASK/);
  const out = await f.adapter.run({ ...task, operation: 'write', path: 'edited.json', content: '{"synthetic":true}' });
  assert.equal(readFileSync(out.path, 'utf8'), '{"synthetic":true}');
});

test('indirect Python source reads are fenced before any script runs', async t => {
  const f = fixture(t), { task } = await started(f);
  const out = await f.adapter.run({ ...task, operation: 'write', path: 'edited.json', content: JSON.stringify({ sources: [{ id: 'SRC', uri: '/etc/passwd' }] }) });
  await assert.rejects(() => f.adapter.run({ ...task, operation: 'script', args: ['source-index', out.path, '--source-id', 'SRC', '--out', 'sources.json'] }), /UNSAFE/);
});

test('cancellation blocks writes and commit while preserving previous work', async t => {
  const f = fixture(t), { c, execution, task } = await started(f);
  const out = await f.adapter.run({ ...task, operation: 'write', path: 'draft.json', content: '{}' });
  const cancelled = await f.adapter.run({ action: 'cancel', id: c.id, executionRevision: execution.revision });
  assert.equal(cancelled.phase, 'cancel_requested');
  assert.equal((await f.adapter.run({ action: 'execution', id: c.id })).phase, 'cancelled');
  await assert.rejects(() => f.adapter.run({ ...task, operation: 'write', path: 'draft.json', content: '{"late":true}' }), /NO_ACTIVE_TASK/);
  assert.equal(readFileSync(out.path, 'utf8'), '{}');
});

test('a different scoped data directory never lists another user or project cases', async t => {
  const f = fixture(t); await started(f);
  const isolated = new WorkDeckAdapter(join(f.root, 'other-scope'), f.host);
  assert.deepEqual((await isolated.run({ action: 'list' })).cases, []);
});

test('task artifacts require the bound native conversation, not merely a known case ID', async t => {
  const f = fixture(t), { task } = await started(f);
  f.adapter.host = async () => false;
  await assert.rejects(() => f.adapter.run({ ...task, operation: 'context' }), /TASK_SESSION_REQUIRED/);
  await assert.rejects(() => f.adapter.run({ ...task, operation: 'read', path: 'assessment.json' }), /TASK_SESSION_REQUIRED/);
});

test('exports return a bounded local descriptor and reject a substituted export directory', async t => {
  const f = fixture(t);
  const out = f.adapter.export({ base64: Buffer.from('合成报告').toString('base64'), filename: '报告.txt', mime: 'text/plain' });
  assert.equal(out.base64, undefined); assert.equal(readFileSync(out.exportPath, 'utf8'), '合成报告');
  rmSync(join(f.root, 'exports'), { recursive: true });
  symlinkSync(tmpdir(), join(f.root, 'exports'));
  assert.throws(() => f.adapter.export({ base64: '', filename: 'x', mime: 'text/plain' }), /UNSAFE_EXPORT/);
});


test('CLI runs through an installation directory alias', t => {
  const f = fixture(t);
  const alias = join(f.root, 'runtime-alias');
  symlinkSync(fileURLToPath(new URL('../runtime/', import.meta.url)), alias, 'dir');
  const result = spawnSync(process.execPath, [join(alias, 'adapter.mjs'), '--root', join(f.root, 'data')], {
    input: JSON.stringify({ payload: { action: 'create', title: '合成安装路径' } }) + '\n', encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.result.ok, true);
  assert.equal(response.result.value.title, '合成安装路径');
});
