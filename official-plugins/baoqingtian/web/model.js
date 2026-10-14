// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  function decode(raw) {
    if (raw && typeof raw === 'object' && 'output' in raw) raw = raw.output;
    let result;
    try { result = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new Error('服务返回的数据无法读取，请重试。'); }
    if (result?.ok !== true) throw Object.assign(new Error(typeof result?.error === 'string' ? result.error : '操作未完成，请检查连接后重试。'), { code: result?.errorCode });
    if (!result.data || typeof result.data !== 'object') throw new Error('服务未返回完整数据，请重试。');
    return result.data;
  }
  function list(data) {
    if (!Array.isArray(data.items)) throw new Error('列表数据不完整，请重试。');
    return { items: data.items.filter(item => item && text(item.id)), total: Number.isFinite(data.total) ? data.total : null, hasMore: data.hasMore === true };
  }
  window.bqtModel = { text, decode, list };
}());
