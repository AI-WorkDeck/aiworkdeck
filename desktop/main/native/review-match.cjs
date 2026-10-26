// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure review-card identity matching and click-time verification orchestration.
// Extracted from main.cjs so the real branches are testable without Electron.
const capiFields = ['revisionId', 'author', 'type', 'dateTime', 'description'];
const unoFields = ['identifier', 'author', 'capiAuthor', 'type', 'dateTime'];

function matchesCapiRevision(cached, fresh) {
  if (!cached || !fresh) return false;
  const value = (item, key) => key === 'author' ? (item.capiAuthor ?? item.author) : item[key];
  return capiFields.every(key => String(value(cached, key) ?? '') === String(value(fresh, key) ?? ''));
}

function matchesUnoRevision(cached, checked) {
  if (!cached || !checked) return false;
  if (!unoFields.every(key => String(cached[key] ?? '') === String(checked[key] ?? ''))) return false;
  // Cached full-text (when the UNO helper produced it) must still match; adjacent
  // same-author/same-time revisions are separated by identifier plus text.
  if (cached.textAvailable === true && cached.text !== checked.text) return false;
  return true;
}

// The card carries (revisionId, refreshEpoch) from the snapshot it was rendered
// from. Before dispatching goto/resolve we re-check that identity against a
// fresh CAPI snapshot and a single-revision UNO detail read, never a full
// redline-text scan. Any semantic or target change demands a refresh.
async function verifyReviewTarget(params, deps) {
  if (!deps.reviewIdentity || deps.reviewIdentity.refreshEpoch !== params.refreshEpoch)
    throw Error('审阅列表已过期，请刷新后重试');
  const card = deps.reviewIdentity.items.find(item => item.revisionId === params.revisionId);
  if (!card) throw Error('目标修订不在当前列表，请刷新后重试');
  const uno = await deps.startUno();
  const fresh = await deps.engineCall('review_snapshot', { documentEpoch: deps.documentEpoch });
  const freshItem = fresh.items.find(item => item.revisionId === params.revisionId);
  // Writer abbreviates hidden deletion descriptions differently in balloons.
  // Only our controlled display detour may replace that summary comparison;
  // the exact native ID, authors, type, timestamp and full UNO text still match.
  const displaySummary = deps.displayChanged === true && card.textAvailable === true
    && typeof card.text === 'string' && ['Insert', 'Delete'].includes(card.type);
  if (!freshItem || !matchesCapiRevision(card, displaySummary ? { ...freshItem, description: card.description } : freshItem))
    throw Error('目标修订已变化，请刷新后重试');
  if (!uno || !card.identifier) throw Error('需要刷新完整审阅内容后核验定位');
  const checked = await deps.unoCall('check_revision', { documentUrl: deps.documentUrl, identifier: card.identifier });
  if (!matchesUnoRevision(card, checked)) throw Error('目标修订已变化，请刷新后重试');
  return { refreshEpoch: fresh.refreshEpoch, identifier: card.identifier, rects: freshItem.rects || [] };
}

module.exports = { matchesCapiRevision, matchesUnoRevision, verifyReviewTarget };
