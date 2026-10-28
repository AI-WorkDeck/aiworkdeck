// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Clause recognition follows the desktop get_clauses contract, including automatic labels.
export function wordClauses(paragraphs) {
    const RE_TIAO   = /^\s*第[一二三四五六七八九十百千零〇0-9１-９]+\s*条/;       // 第X条 — the clause proper
    const RE_ZHANG  = /^\s*第[一二三四五六七八九十百千零〇0-9１-９]+\s*[章节编]/;  // 第X章/节/编 — section above clauses
    const RE_ENUM   = /^\s*[一二三四五六七八九十]{1,3}\s*、/;                      // 一、 二、 — top-level enum many contracts use
    const RE_PAREN  = /^\s*[（(][一二三四五六七八九十]{1,3}[）)]/;                  // （一）（二） — fallback enum
    const RE_ARABIC = /^\s*\d{1,2}\s*[.．、]\s*(?!\d)\S/;                          // 1. / 1、 — top-level numeric clause
    const marks = []; let total = 0;
    paragraphs.forEach((paragraph, i) => {
      total = i + 1;
      const raw = paragraph.text || '';
      const label = paragraph.numbering?.label?.trim() || '';
      const trimmedRaw = raw.trim();
      const t = (label && trimmedRaw.indexOf(label) !== 0)
        ? (label + (!/[、.．:：）)\s]$/.test(label) && trimmedRaw ? ' ' : '') + raw)
        : raw;
      let type = null;
      if (RE_TIAO.test(t)) type = 'tiao';
      else if (RE_ZHANG.test(t)) type = 'zhang';
      else if (RE_ENUM.test(t)) type = 'enum';
      else if (RE_PAREN.test(t) && t.trim().length <= 60 && !/[。；;]$/.test(t.trim())) type = 'paren';
      else if (RE_ARABIC.test(t) && t.trim().length <= 45 && !/[。；;]$/.test(t.trim())) type = 'arabic';
      if (type) marks.push({ index: i, type: type, text: t, autoNumbered: !!label, listLabel: label || null });
      return false;
    });
    // Granularity: 第X条 wins when present (一、 then is usually a sub-item);
    // otherwise fall back to 一、, then （一）, then 1. as the clause level. 章/节 always kept.
    const hasTiao = marks.some(function (m) { return m.type === 'tiao'; });
    const hasEnum = marks.some(function (m) { return m.type === 'enum'; });
    const hasParen = marks.some(function (m) { return m.type === 'paren'; });
    const primaryType = hasTiao ? 'tiao' : (hasEnum ? 'enum' : (hasParen ? 'paren' : 'arabic'));
    const boundaries = marks.filter(function (m) {
      return m.type === 'zhang' || m.type === primaryType;
    });
    const clauses = [];
    for (let k = 0; k < boundaries.length && clauses.length < 300; k++) {
      const b = boundaries[k];
      const end = (k + 1 < boundaries.length) ? boundaries[k + 1].index - 1 : total - 1;
      const line = b.text.trim();
      const re = b.type === 'tiao' ? RE_TIAO : (b.type === 'zhang' ? RE_ZHANG : (b.type === 'enum' ? RE_ENUM : (b.type === 'paren' ? RE_PAREN : /^\s*\d{1,2}\s*[.．、]/)));
      const m = line.match(re);
      const item = {
        no: (m ? m[0] : line.slice(0, 8)).trim(),
        type: b.type,
        title: line.slice(0, 60),
        startParagraph: b.index,
        endParagraph: end,
        paragraphCount: end - b.index + 1,
      };
      if (b.autoNumbered) {
        item.autoNumbered = true;
        item.listLabel = b.listLabel;
      }
      clauses.push(item);
    }
    const firstBoundary = boundaries.length ? boundaries[0].index : total;
    const granLabel = hasTiao ? '第X条' : (hasEnum ? '一、二、…' : (hasParen ? '（一）（二）…' : (boundaries.length ? '1. 2. …' : 'none')));
    return {
      success: true, totalParagraphs: total, clauseCount: clauses.length,
      totalClauseCount: boundaries.length, truncated: boundaries.length > clauses.length,
      ...(boundaries.length > clauses.length ? {
        nextStartParagraph: boundaries[clauses.length].index,
      } : {}),
      granularity: granLabel,
      // 0..preambleParagraphs-1 = 首部（合同名称/当事人信息），不属于任何条款
      preambleParagraphs: firstBoundary,
      clauses: clauses,
    };
}
export function wordOutline(paragraphs) {
  const headings = paragraphs.filter(p => p.headingLevel > 0)
  const outline = []
  let chars = 0
  for (const p of headings) {
    if (outline.length >= 300 || (chars + p.text.length > 80000 && outline.length)) break
    outline.push({
    paragraphIndex: p.index, level: p.headingLevel, style: p.style, text: p.text
    })
    chars += p.text.length
  }
  return { success: true, count: outline.length, totalCount: headings.length, outline,
    truncated: headings.length > outline.length,
    ...(headings.length > outline.length ? { nextStartParagraph: headings[outline.length].index } : {}) }
}

export function wordParagraphPage(paragraphs, args = {}, totalParagraphs = paragraphs.length) {
  const start = Math.max(0, Math.floor(Number(args.startParagraph) || 0))
  const limit = Math.min(500, Math.max(1, Math.floor(Number(args.maxParagraphs) || 200)))
  const page = []
  let chars = 0
  for (const paragraph of paragraphs.filter(p => p.index >= start).slice(0, limit)) {
    if (chars + paragraph.text.length > 80000 && page.length) break
    page.push(paragraph)
    chars += paragraph.text.length
  }
  const next = start + page.length
  return { paragraphs: page, totalParagraphs, truncated: next < totalParagraphs,
    ...(next < totalParagraphs ? { nextStartParagraph: next } : {}) }
}
