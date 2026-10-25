// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// One bounded batch per native task. Callers release that task before asking
// for another batch, so document input can run between complete detail reads.
const REVIEW_BATCH_SIZE = 25;
const identityFields = ['revisionId', 'author', 'type', 'dateTime', 'description'];
const signature = items => JSON.stringify(items.map(item => identityFields.map(key => item[key])));
const stale = () => Error('STALE_REVIEW_BATCH: 审阅内容已变化，请刷新');

function requireReviewDetails(identity, revisionId) {
  const card = identity?.items.find(item => item.revisionId === revisionId);
  if (!card || card.textAvailable !== true || typeof card.text !== 'string'
      || typeof card.identifier !== 'string' || !card.identifier)
    throw Error('完整修订内容仍在读取，请稍候');
  return card;
}

async function hydrateReviewBatch(params, { getIdentity, getDocument, snapshot, details }) {
  const identity = getIdentity(), document = getDocument();
  const start = params.start, limit = params.limit;
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1 || limit > REVIEW_BATCH_SIZE)
    throw Error('Invalid review batch range');
  const current = () => {
    const active = getDocument();
    if (!identity || getIdentity() !== identity || !active || !document
        || active.documentEpoch !== document.documentEpoch || active.documentUrl !== document.documentUrl
        || params.refreshEpoch !== identity.refreshEpoch || params.documentEpoch !== document.documentEpoch)
      throw stale();
  };
  current();
  if (start !== identity.hydratedCount || start >= identity.items.length) throw stale();
  const expected = signature(identity.items), first = await snapshot(document.documentEpoch);
  current();
  if (first.documentEpoch !== document.documentEpoch || signature(first.items) !== expected) throw stale();
  const batch = await details({ documentUrl: document.documentUrl, start, limit, expectedCount: identity.items.length });
  current();
  const last = await snapshot(document.documentEpoch);
  current();
  const end = Math.min(start + limit, identity.items.length);
  if (last.documentEpoch !== document.documentEpoch || signature(last.items) !== expected
      || batch.start !== start || batch.total !== identity.items.length
      || batch.entries?.length !== end - start) throw stale();
  const identifiers = new Set(identity.items.filter(item => item.textAvailable).map(item => item.identifier));
  const items = batch.entries.map((full, offset) => {
    const item = identity.items[start + offset];
    if (full.index !== start + offset || !['author', 'type', 'dateTime'].every(key => full[key] === item[key])
        || typeof full.text !== 'string' || typeof full.identifier !== 'string' || !full.identifier
        || identifiers.has(full.identifier)) throw stale();
    identifiers.add(full.identifier);
    return { ...item, ...full, textAvailable: true };
  });
  // Publish only after every item and both native snapshots agree. No partial
  // merge can survive a failed batch or a replacement document/list.
  for (let i = 0; i < items.length; i++) identity.items[start + i] = items[i];
  identity.hydratedCount = end;
  identity.controllerCapabilities = batch.controllerCapabilities;
  return { documentEpoch: document.documentEpoch, refreshEpoch: identity.refreshEpoch,
    start, nextOffset: end, total: identity.items.length, items,
    controllerCapabilities: batch.controllerCapabilities };
}
module.exports = { REVIEW_BATCH_SIZE, hydrateReviewBatch, requireReviewDetails };
