// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchesCapiRevision, matchesUnoRevision, verifyReviewTarget } = require('../review-match.cjs');

const baseCard = { revisionId: '2', author: '甲', type: 'Insert', dateTime: '2026-10-25T09:00:00',
  description: '插入 3 个字符', identifier: 'rev-b', text: '新增文字', textAvailable: true, rects: [] };

function harness({ identityItems = [baseCard], refreshEpoch = 7, freshItems, unoEntry, unoClient = {} } = {}) {
  const calls = [];
  const identity = { refreshEpoch, items: identityItems };
  const deps = {
    reviewIdentity: identity, documentEpoch: 3, documentUrl: 'file:///run/opened-document.docx',
    startUno: async () => { calls.push('startUno'); return unoClient; },
    engineCall: async (method, params) => { calls.push(['engine', method, params]);
      return { refreshEpoch: 11, items: freshItems ?? identityItems }; },
    unoCall: async (method, params) => { calls.push(['uno', method, params]);
      if (unoEntry === null) throw Error('Revision identity is no longer unique');
      return unoEntry ?? { identifier: baseCard.identifier, author: baseCard.author, type: baseCard.type,
        dateTime: baseCard.dateTime, text: baseCard.text }; },
  };
  return { calls, deps };
}

test('ordinary input elsewhere still verifies and returns the fresh epoch', async () => {
  const h = harness();
  const result = await verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps);
  assert.deepEqual(result, { refreshEpoch: 11, identifier: 'rev-b', rects: [] });
  assert.deepEqual(h.calls, ['startUno', ['engine', 'review_snapshot', { documentEpoch: 3 }],
    ['uno', 'check_revision', { documentUrl: 'file:///run/opened-document.docx', identifier: 'rev-b' }]]);
});

test('verification reads one revision via check_revision, never the full uno snapshot', async () => {
  const h = harness();
  await verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps);
  assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'uno' && call[1] === 'snapshot'), false);
});

test('scroll target comes from the current layout after preceding paragraphs change', async () => {
  const rects = [[150, 24000, 300, 200]];
  const h = harness({ freshItems: [{ ...baseCard, rects }] });
  const result = await verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps);
  assert.deepEqual(result.rects, rects);
});

test('card from an older list is rejected before any engine or uno call', async () => {
  const h = harness();
  await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 6 }, h.deps), /刷新/);
  assert.deepEqual(h.calls, []);
});

test('unknown revisionId on the current list is rejected', async () => {
  const h = harness();
  await assert.rejects(verifyReviewTarget({ revisionId: '9', refreshEpoch: 7 }, h.deps), /刷新/);
  assert.deepEqual(h.calls, []);
});

test('target missing from the fresh CAPI snapshot is rejected before the uno read', async () => {
  const h = harness({ freshItems: [] });
  await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps), /已变化/);
  assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'uno'), false);
});

test('a CAPI field change (deleted and replaced at the same index) is rejected', async () => {
  for (const key of ['author', 'type', 'dateTime', 'description']) {
    const h = harness({ freshItems: [{ ...baseCard, [key]: '不同' }] });
    await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps), /已变化/);
    assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'uno'), false, key);
  }
});

test('identifier no longer present in the document is rejected', async () => {
  const h = harness({ unoEntry: null });
  await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps), /no longer unique/);
});

test('semantic change of the target revision text is rejected', async () => {
  const h = harness({ unoEntry: { identifier: 'rev-b', author: '甲', type: 'Insert', dateTime: '2026-10-25T09:00:00', text: '被改写的文字' } });
  await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps), /已变化/);
});

test('detail change without cached text is still rejected', async () => {
  const card = { ...baseCard, textAvailable: false, text: null };
  const h = harness({ identityItems: [card], unoEntry: { identifier: 'rev-b', author: '甲', type: 'Delete', dateTime: '2026-10-25T09:00:00', text: 'x' } });
  await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps), /已变化/);
});

test('missing uno connection demands a full refresh', async () => {
  const h = harness({ unoClient: null });
  await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps), /刷新完整审阅内容/);
  assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'uno'), false);
});

test('same-author same-time adjacent revisions are separated by identifier and text', async () => {
  const twin = { ...baseCard, revisionId: '1', description: '插入 3 个字符', identifier: 'rev-a', text: '同样时间' };
  const identityItems = [twin, baseCard];
  const ok = harness({ identityItems });
  const result = await verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, ok.deps);
  assert.equal(result.identifier, 'rev-b');
  assert.deepEqual(ok.calls.at(-1), ['uno', 'check_revision', { documentUrl: 'file:///run/opened-document.docx', identifier: 'rev-b' }]);
  const swapped = harness({ identityItems, unoEntry: { identifier: 'rev-b', author: '甲', type: 'Insert', dateTime: '2026-10-25T09:00:00', text: '同样时间' } });
  await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, swapped.deps), /已变化/);
});

test('card without a cached identifier (no uno at snapshot time) demands refresh', async () => {
  const card = { ...baseCard, identifier: undefined };
  const h = harness({ identityItems: [card] });
  await assert.rejects(verifyReviewTarget({ revisionId: '2', refreshEpoch: 7 }, h.deps), /刷新完整审阅内容/);
});

test('matchesCapiRevision and matchesUnoRevision pure branches', () => {
  assert.equal(matchesCapiRevision(baseCard, { ...baseCard, rects: [{ x: 1 }] }), true);
  assert.equal(matchesCapiRevision(baseCard, { ...baseCard, revisionId: '3' }), false);
  assert.equal(matchesCapiRevision(null, baseCard), false);
  assert.equal(matchesUnoRevision(baseCard, { ...baseCard, successor: 'x' }), true);
  const withoutText = { ...baseCard, textAvailable: false, text: null };
  assert.equal(matchesUnoRevision(withoutText, { ...baseCard, text: '任意' }), true);
  assert.equal(matchesUnoRevision(baseCard, { ...baseCard, identifier: 'rev-a' }), false);
  assert.equal(matchesUnoRevision(baseCard, { ...baseCard, author: '乙' }), false);
  assert.equal(matchesUnoRevision(baseCard, { ...baseCard, type: 'Delete' }), false);
  assert.equal(matchesUnoRevision(baseCard, { ...baseCard, dateTime: '2026-10-25T09:00:01' }), false);
  assert.equal(matchesUnoRevision(undefined, baseCard), false);
});
