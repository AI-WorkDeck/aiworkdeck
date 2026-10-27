// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { WorkDeckAdapter } from '../runtime/adapter.mjs';

const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
const python = process.env.AWD_DPIA_TEST_PYTHON || process.env.DSH_DPIA_PYTHON || 'python3';
const parse = value => JSON.parse(value);
const clone = value => structuredClone(value);

function checked(result, label) {
  assert.equal(result.exitCode, 0, `${label}: ${result.output}\n${result.error}`);
  return parse(result.output);
}

// The production Skill computes these exact digests. This fixture helper only
// binds synthetic source-review records; it never authors approvals or changes product state.
function traceDigests(assessment, index) {
  const result = spawnSync(python, ['-B', '-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);import source_trace;a,i=json.load(sys.stdin);print(json.dumps([source_trace.snapshot(a),source_trace.digest(i)]))',
    join(runtime, 'upstream/skill/scripts')], { input: JSON.stringify([assessment, index]), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return parse(result.stdout);
}

function source(evidence) {
  return { id: evidence.id, title: evidence.title, uri: evidence.path, version: 'synthetic-v1', kind: 'prd',
    locator: evidence.locator, sha256: evidence.sha256, observed_at: '2026-10-18' };
}

function traceFor(assessment, index) {
  const [assessment_digest, index_digest] = traceDigests(assessment, index);
  return { assessment_digest, index_digest, phase: 'screening', semantic_review: '合成材料仅用于验收；保存期限尚未明确，不能推断为已批准。',
    fact_links: [], checks: [{ id: 'CHECK-retention', activity_ids: ['A1'], predicate: 'retention-period', status: 'missing',
      phase: 'screening', finding: '已读取全部合成来源，但没有最终保存期限。', decision_impact: '保留期限判断待补充。',
      recommendation: '确定保存期限后复评。', searched_source_ids: index.sources.map(s => s.id), passage_ids: index.passages.map(p => p.id),
      known_fact_ids: [], question_id: 'Q1', gap: '最终保存期限', pause: { kind: 'substantive', scope: 'judgment',
        reason: '仅保存期限判断缺少材料。', conditional_analysis: '其余可独立判断的部分继续处理。', resume_when: '有确定期限及其依据。',
        affected_judgments: ['存储限制'], continue_with: ['材料来源与范围整理'] } }] };
}

test('real Python lifecycle: frozen input, validated adoption, partial answer reassessment and draft report page gate', { timeout: 120000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'awd-dpia-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const variables = { DSH_DPIA_PYTHON: python, DSH_DPIA_DOCUMENT_PYTHON: python,
    DSH_DPIA_RENDERER: join(runtime, 'render.py'), DSH_DPIA_PDFTOPPM: join(runtime, 'pdf-pages.py'), AWD_DPIA_PYTHON_RENDERER: '1' };
  const previous = Object.fromEntries(Object.keys(variables).map(k => [k, process.env[k]]));
  Object.assign(process.env, variables);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const sessions = new Map(), submissions = [];
  const host = async (method, args) => {
    if (method === 'ensure') {
      if (!sessions.has(args.key)) sessions.set(args.key, { key: args.key, conversationId: 'synthetic-lifecycle', running: false });
      return sessions.get(args.key);
    }
    if (method === 'status') return sessions.get(args.key) || null;
    if (method === 'authorizeTask') { assert.ok(sessions.has(args.key)); return true; }
    if (method === 'submit') { submissions.push(args); return true; }
    if (method === 'cancel') { sessions.get(args.key).running = false; return true; }
    throw Error('Unexpected host method: ' + method);
  };
  let adapter = new WorkDeckAdapter(root, host, { python });
  let c = await adapter.run({ action: 'create', title: 'SYNTHETIC：生命周期验收' });
  c = await adapter.run({ action: 'evidence', id: c.id, version: c.version, title: '合成业务材料', text: 'SYNTHETIC：测试邮件服务，保存期限尚未明确。' });
  let execution = await adapter.run({ action: 'start', id: c.id, version: c.version, executionRevision: 0 });
  assert.equal(execution.phase, 'accepted'); assert.equal(submissions.length, 1);
  const task = async (operation, rest = {}) => adapter.run({ action: 'task', id: c.id, requestId: execution.requestId, operation, ...rest });
  const write = async (path, value) => task('write', { path, content: typeof value === 'string' ? value : JSON.stringify(value) });
  const read = async path => parse((await task('read', { path, limit: 100000 })).text);
  let context = await task('context');
  const originalJob = readFileSync(join(context.directory, 'job.json'), 'utf8');
  const edited = clone(c.assessment);
  edited.sources = c.evidence.map(source);
  edited.activities = [{ id: 'A1', name: '合成邮件服务', purpose: '验收', data_subjects: ['合成用户'], data_fields: ['合成邮件地址'],
    systems: ['合成系统'], regions: ['未核验'], scale: '合成样例', lifecycle: '期限尚未确定', fact_ids: [] }];
  edited.questions = [{ id: 'Q1', question: '最终保存期限是多少？', impact: 'material', compliance_impact: '影响存储限制判断',
    recommendation: '明确期限及依据', owner: '合成业务方', affected_ids: ['A1'], status: 'open', answer_source_ids: [] }];

  async function publishAssessment(input, answerReviews) {
    context = await task('context');
    await write('edited.json', input);
    checked(await task('script', { args: ['revise', context.job.parentAssessmentPath, join(context.directory, 'edited.json'), '--out', 'assessment-next.json'] }), 'revise');
    const assessmentPath = join(context.directory, 'assessment-next.json');
    const assessment = await read(assessmentPath);
    checked(await task('script', { args: ['validate', assessmentPath] }), 'validate');
    checked(await task('script', { args: ['source-index', assessmentPath,
      ...assessment.sources.flatMap(s => ['--source-id', s.id]), '--out', 'source-index.json'] }), 'source-index');
    const index = await read(join(context.directory, 'source-index.json'));
    await write('intake-review.json', traceFor(assessment, index));
    const files = { assessment: 'assessment-next.json', sourceIndex: 'source-index.json', intake: 'intake-review.json' };
    if (answerReviews) { await write('answer-reviews.json', answerReviews); files.answerReviews = 'answer-reviews.json'; }
    checked(await task('commit', { files }), 'commit');
    const status = await adapter.run({ action: 'execution', id: c.id });
    assert.equal(status.sync.state, 'synced', JSON.stringify(status.sync));
    c = await adapter.run({ action: 'get', id: c.id });
    assert.equal(c.result.record.revisionId, assessment.meta.revision_id);
    return { assessment, status };
  }
  const first = await publishAssessment(edited);
  assert.equal(readFileSync(join(context.directory, 'job.json'), 'utf8'), originalJob);
  await assert.rejects(() => write('edited.json', {}), /RESULT_ALREADY_ADOPTED/);
  assert.equal(c.result.assessment.questions[0].status, 'open');
  const firstRevision = c.result.record.revisionId;
  c = await adapter.run({ action: 'answerDraft', id: c.id, version: c.version, questionId: 'Q1', text: 'SYNTHETIC：拟议30天，但尚未确定。',
    answerer: '合成验收输入', date: '2026-10-18', mode: 'partial' });
  assert.equal(c.answerStates[0].status, 'draft'); assert.equal(c.result.record.revisionId, firstRevision);
  await setTimeout(3100); // The upstream admission race guard is 3 seconds.
  adapter = new WorkDeckAdapter(root, host, { python });
  execution = await adapter.run({ action: 'start', id: c.id, version: c.version, executionRevision: first.status.revision, answerIds: [c.answerDrafts[0].id] });
  assert.equal(execution.phase, 'accepted'); assert.equal(submissions.length, 2);
  context = await task('context');
  const frozen = await read(context.job.contextPath), answer = context.job.answers[0];
  const reassessed = clone(c.result.assessment);
  reassessed.sources = frozen.evidence.map(source);
  await publishAssessment(reassessed, [{ answerId: answer.id, questionId: 'Q1', sourceId: answer.sourceId, status: 'partial',
    reason: '合成答复仅提出拟议期限，未解决最终期限缺口。', remaining: '最终保存期限及依据仍待确定。', checkIds: ['CHECK-retention'] }]);
  assert.notEqual(c.result.record.revisionId, firstRevision);
  assert.equal(c.answerStates[0].status, 'partial'); assert.equal(c.result.assessment.questions[0].status, 'open');
  assert.equal((await adapter.run({ action: 'resultHistory', id: c.id })).length, 2);

  const options = { action: 'reportPreview', id: c.id, version: c.version, templateId: 'legal-elements', reportType: 'draft', language: 'zh-CN' };
  const preview = await adapter.run(options);
  assert.equal(preview.generationReady, true, JSON.stringify(preview.generationBlockers));
  const formal = await adapter.run({ ...options, reportType: 'formal' });
  assert.equal(formal.check.eligible, false); // No human facts/approvals are invented to pass the gate.
  const current = await adapter.run({ action: 'execution', id: c.id });
  await setTimeout(3100);
  execution = await adapter.run({ ...options, action: 'startReport', executionRevision: current.revision, basisDigest: preview.basisDigest, actor: 'SYNTHETIC：自动验收生成选项' });
  assert.equal(execution.phase, 'accepted');
  context = await task('context');
  const outline = checked(await task('report', { command: 'outline' }), 'outline');
  const content = { basisDigest: outline.basisDigest,
    fields: ['scope', 'facts_sources', 'processing', 'screening', 'measures_actions', 'consultation', 'review_conditions', 'decision'].map(key => ({
      key, label: '合成待完善栏目：' + key, status: 'unknown', text: '', rationale: '验收样例信息不足，不构成结论。', factIds: [], ruleIds: [], sourceIds: [],
      question: '待补充具体信息', impact: '对应判断仍未完成', recommendation: '补充材料后复评' })),
    dimensions: outline.dimensions.map(d => ({ ...d, status: 'limited', reason: '合成样例材料不足。', text: '尚无足够材料完成本维度判断。' })),
    risks: [], actions: [], templateVerification: { publisher: '自编', url: '', checkedAt: new Date().toISOString(), status: 'self_authored',
      language: 'zh-CN', scopeReason: '仅合成验收草稿', originalSha256: null, evidence: '自编样式，无官方模板声明。' },
    contentReview: { status: 'pass', notes: '合成夹具机械核对：全部栏目明确未知，无批准或事实确认；不代表专业审查。' } };
  await write('report-content.json', content);
  checked(await task('report', { command: 'compose', content: 'report-content.json' }), 'compose');
  assert.ok(existsSync(join(context.directory, 'report.docx')));
  const rendered = checked(await task('report', { command: 'render' }), 'render');
  assert.ok(rendered.pageCount > 0); assert.ok(existsSync(join(context.directory, 'render/report.pdf')));
  const premature = await task('report', { command: 'complete' });
  assert.notEqual(premature.exitCode, 0); assert.match(premature.error, /REPORT_PAGE_REVIEW_MISSING/);
  const summary = checked(await task('report', { command: 'summary' }), 'summary');
  assert.equal(summary.phase, 'awaiting_page_review'); assert.equal(summary.downloadReady, false);
  assert.deepEqual(summary.decisions, []);
  t.diagnostic(`Two adopted revisions; partial answer remains unresolved; ${rendered.pageCount} real PDF/PNG pages; page review remains required.`);
});
