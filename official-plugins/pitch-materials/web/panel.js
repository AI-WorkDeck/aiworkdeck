// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 投标与提案面板：业绩与团队库 → 招标对照 → 生成 Word 投标书 / PPT 提案。
// 库、对照表、报价计算、模板填充都在插件 JAR（pitch_materials_action）；AI 抽取与对照走 ai.request。
(function () {
  'use strict';

  const rc = window.AWD_TR_CORE;
  const core = window.AWD_PITCH_CORE;
  const xlsx = window.AWD_TR_XLSX;
  const L10N = window.AWD_PITCH_L10N || {};
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TOOL = 'pitch_materials_action';

  let locale = 'zh-CN';
  function t(key, params) {
    const hit = (L10N[locale] || {})[key] ?? (L10N['en-US'] || {})[key] ?? (L10N['zh-CN'] || {})[key] ?? key;
    return String(hit).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
  }

  const FIELDS = {
    credentials: [['title'], ['client'], ['clientAlias'], ['area'], ['year'], ['amount'], ['role'], ['lawyers', 'list'], ['tags', 'list'], ['summary', 'textarea']],
    lawyers: [['name'], ['title'], ['areas', 'list'], ['since'], ['education'], ['bio', 'textarea']],
    qualifications: [['name'], ['kind'], ['issuer'], ['year'], ['expires']],
    services: [['title'], ['area'], ['content', 'textarea-lg']],
    quotes: [['name'], ['note', 'textarea']]
  };
  const COLUMNS = {
    credentials: ['title', 'clientAlias', 'area', 'year', 'role'],
    lawyers: ['name', 'title', 'areas', 'since'],
    qualifications: ['name', 'kind', 'issuer', 'year'],
    services: ['title', 'area'],
    quotes: ['name']
  };

  const sep = () => (/^(zh|ja)/.test(locale) ? '、' : ', ');
  const sep2 = () => (/^(zh|ja)/.test(locale) ? '；' : '; ');
  const mask = (text) => core.maskClients(state.library, text, t('panel.lib.someClient'));

  const state = {
    projectId: '', tab: 'library', section: 'credentials', filter: '',
    library: core.emptyLibrary(), editing: null, draft: null,
    files: [], matrix: emptyMatrix(), tenderPath: '', busy: false, progress: '', cancelled: false,
    selection: null, quoteId: '', quotePreview: null,
    gen: { client: '', project: '', word: 'sample', ppt: 'sample', outward: true, hideAmounts: false, includeMatrix: true },
    results: [], sensitive: {}
  };

  function emptyMatrix() { return { version: 1, tenderPath: '', tenderer: '', project: '', items: [], updatedAt: '' }; }

  // ---------- 小工具 ----------

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'className') node.className = v;
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = !!v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach((c) => c && node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  const btn = (label, onclick, cls, extra) => el('button', Object.assign({ type: 'button', className: 'awd-btn awd-btn-sm ' + (cls || ''), text: label, onclick, disabled: state.busy }, extra || {}));

  function notice(message, kind) {
    const box = $('notice');
    box.textContent = message || '';
    box.dataset.kind = kind || '';
    box.hidden = !message;
  }

  function confirmBar(message, actions) {
    const box = $('confirm');
    box.textContent = '';
    if (!message) { box.hidden = true; return; }
    box.appendChild(el('span', { text: message }));
    actions.forEach(([label, fn, cls]) => box.appendChild(btn(label, () => { confirmBar(''); fn(); }, cls)));
    box.hidden = false;
  }

  function errText(e) {
    if (e && e.code === 'unknown_method') return t('panel.err.upgrade');
    if (e && e.code === 'permission_denied') return t('panel.err.permission');
    if (e && e.code === 'cancelled') return t('panel.err.cancelled');
    if (e && e.pitchCode) {
      const key = 'panel.err.' + e.pitchCode;
      const msg = t(key, { detail: e.detail || '' });
      return msg === key ? t('panel.err.generic') : msg;
    }
    return (e && e.message) || t('panel.err.generic');
  }

  async function tool(action, params) {
    const output = await awd.tools.invoke(TOOL, { action, json: JSON.stringify(Object.assign({ lang: locale }, params || {})) });
    let res;
    try { res = JSON.parse(output); } catch (e) { throw Object.assign(new Error('bad'), { pitchCode: 'failed' }); }
    if (!res || res.success !== true) throw Object.assign(new Error(res && res.code), { pitchCode: (res && res.code) || 'failed', detail: res && res.detail });
    return res.data;
  }

  async function run(work) {
    if (state.busy) return;
    state.busy = true;
    state.cancelled = false;
    render();
    try { await work(); } catch (e) { notice(errText(e), 'error'); } finally {
      state.busy = false;
      state.progress = '';
      render();
    }
  }

  // ---------- 加载与保存 ----------

  async function loadAll() {
    try {
      const data = await tool('library.get');
      state.library = core.normalizeLibrary(data.library);
    } catch (e) { notice(errText(e), 'error'); }
    if (state.projectId) {
      try {
        const data = await tool('matrix.get');
        state.matrix = data.matrix && Array.isArray(data.matrix.items) ? Object.assign(emptyMatrix(), data.matrix) : emptyMatrix();
      } catch (e) { state.matrix = emptyMatrix(); }
      state.tenderPath = state.matrix.tenderPath || '';
      if (state.matrix.tenderer) state.gen.client = state.matrix.tenderer;
      if (state.matrix.project) state.gen.project = state.matrix.project;
      await loadFiles();
    }
    state.selection = null;
  }

  async function loadFiles() {
    try {
      const list = await awd.files.list();
      state.files = list.slice().sort((a, b) => a.path.localeCompare(b.path));
    } catch (e) { state.files = []; }
  }

  // 报价按模板 id 缓存，避免每次重绘都调一次插件工具（占每分钟配额）；库一改就清空
  const quoteCache = new Map();
  function computeQuote(quoteId) {
    if (!quoteCache.has(quoteId)) quoteCache.set(quoteId, tool('quote.compute', { quoteId }).catch((e) => { quoteCache.delete(quoteId); throw e; }));
    return quoteCache.get(quoteId);
  }

  async function saveLibrary(lib) {
    quoteCache.clear();
    await tool('library.save', { library: lib });
    state.library = core.normalizeLibrary(lib);
  }

  let matrixTimer = null;
  function saveMatrixSoon() {
    clearTimeout(matrixTimer);
    matrixTimer = setTimeout(() => {
      state.matrix.updatedAt = new Date().toISOString();
      tool('matrix.save', { matrix: state.matrix }).catch((e) => notice(errText(e), 'error'));
    }, 600);
  }

  // ---------- 渲染 ----------

  function render() {
    document.querySelectorAll('.pm-tabs [role=tab]').forEach((b) => {
      const on = b.dataset.tab === state.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('is-active', on);
    });
    const view = $('view');
    const scroll = view.scrollTop;
    view.textContent = '';
    if (!state.projectId && state.tab !== 'library') {
      view.appendChild(el('p', { className: 'hint', text: t('panel.err.no_project') }));
      return;
    }
    if (state.busy && state.progress) view.appendChild(el('div', { className: 'pm-progress', role: 'status' }, [
      el('span', { text: state.progress }), state.cancellable ? btn(t('panel.action.stop'), () => { state.cancelled = true; }, '', { disabled: false }) : null]));
    if (state.tab === 'library') renderLibrary(view);
    else if (state.tab === 'tender') renderTender(view);
    else renderGenerate(view);
    view.scrollTop = scroll;
  }

  // ---------- 1. 业绩与团队库 ----------

  function renderLibrary(view) {
    const lib = state.library;
    const firm = el('div', { className: 'awd-card' }, [
      el('div', { className: 'awd-card-header' }, [
        el('h2', { className: 'awd-card-title', text: t('panel.lib.firm') }),
        el('div', { className: 'pm-actions' }, [
          btn(t('panel.lib.importLawfirm'), importLawfirm),
          btn(t('panel.lib.importFile'), importFilePicker),
          btn(t('panel.lib.export'), exportLibrary, '', { disabled: state.busy || !state.projectId })
        ])
      ]),
      el('label', { className: 'pm-field' }, [el('span', { text: t('panel.field.firmName') }),
        el('input', { className: 'awd-input', id: 'firm-name', value: lib.firm.name })]),
      el('label', { className: 'pm-field' }, [el('span', { text: t('panel.field.firmIntro') }),
        el('textarea', { className: 'awd-textarea', id: 'firm-intro', rows: '3', value: lib.firm.intro })]),
      el('div', { className: 'pm-actions' }, [btn(t('panel.action.save'), () => run(async () => {
        const next = Object.assign({}, state.library, { firm: { name: $('firm-name').value.trim(), intro: $('firm-intro').value.trim() } });
        await saveLibrary(next);
        notice(t('panel.lib.saved'), 'info');
      }), 'awd-btn-primary')]),
      el('p', { className: 'hint', text: t('panel.lib.privacy') })
    ]);
    view.appendChild(firm);
    if (state.importChoices) view.appendChild(renderImportChoices());

    const tabs = el('div', { className: 'pm-sections', role: 'tablist' }, core.SECTIONS.map((s) => el('button', {
      type: 'button', role: 'tab', className: 'pm-section' + (s === state.section ? ' is-active' : ''), 'aria-selected': s === state.section ? 'true' : 'false',
      onclick: () => { state.section = s; state.editing = null; render(); }
    }, [t('panel.section.' + s) + ' ', el('span', { className: 'awd-badge', text: String(lib[s].length) })])));
    const card = el('div', { className: 'awd-card' }, [tabs]);
    if (state.editing) card.appendChild(renderEditor());
    else {
      card.appendChild(el('div', { className: 'pm-toolbar' }, [
        el('input', { className: 'awd-input', type: 'search', placeholder: t('panel.lib.search'), value: state.filter,
          oninput: (e) => { state.filter = e.target.value; renderList(); } }),
        btn(t('panel.lib.add'), () => startEdit(null), 'awd-btn-primary')
      ]));
      card.appendChild(el('div', { id: 'lib-list' }));
    }
    view.appendChild(card);
    if (!state.editing) renderList();
  }

  function cellValue(item, key) {
    const v = item[key];
    return Array.isArray(v) ? v.join(sep()) : String(v == null ? '' : v);
  }

  function renderList() {
    const host = $('lib-list');
    if (!host) return;
    host.textContent = '';
    const s = state.section;
    const q = state.filter.trim().toLowerCase();
    const rows = state.library[s].filter((it) => !q || JSON.stringify(it).toLowerCase().includes(q));
    if (!rows.length) { host.appendChild(el('p', { className: 'hint', text: state.library[s].length ? t('panel.lib.noMatch') : t('panel.lib.empty.' + s) })); return; }
    const table = el('table', { className: 'pm-table' }, [el('thead', {}, [el('tr', {}, COLUMNS[s].map((c) => el('th', { text: t('panel.field.' + s + '.' + c) })).concat([el('th', { text: '' })]))])]);
    const body = el('tbody');
    rows.forEach((it) => {
      const tr = el('tr', {}, COLUMNS[s].map((c, i) => {
        const td = el('td', { text: s === 'credentials' && c === 'clientAlias' && !it.clientAlias && it.client ? '' : cellValue(it, c) });
        if (s === 'credentials' && c === 'clientAlias' && !it.clientAlias && it.client) td.appendChild(el('span', { className: 'awd-badge awd-badge-warning', text: t('panel.lib.noAlias') }));
        if (i === 0 && it.source && it.source.startsWith('lawfirm')) td.appendChild(el('span', { className: 'awd-badge awd-badge-info', text: t('panel.lib.fromLawfirm') }));
        return td;
      }));
      tr.appendChild(el('td', { className: 'pm-row-actions' }, [
        btn(t('panel.action.edit'), () => startEdit(it.id), 'awd-btn-xs'),
        btn(t('panel.action.delete'), () => confirmBar(t('panel.lib.confirmDelete', { name: cellValue(it, COLUMNS[s][0]) }), [
          [t('panel.action.delete'), () => run(async () => {
            const next = Object.assign({}, state.library, { [s]: state.library[s].filter((x) => x.id !== it.id) });
            await saveLibrary(next);
          }), 'awd-btn-danger'], [t('panel.action.cancel'), () => {}]]), 'awd-btn-xs')
      ]));
      body.appendChild(tr);
    });
    table.appendChild(body);
    host.appendChild(el('div', { className: 'pm-table-wrap' }, [table]));
  }

  function startEdit(id) {
    const s = state.section;
    const found = id ? state.library[s].find((x) => x.id === id) : null;
    state.editing = { section: s, id };
    state.draft = found ? JSON.parse(JSON.stringify(found)) : blank(s);
    render();
  }

  function blank(s) {
    if (s === 'quotes') return { name: '', note: '', rates: {}, items: [{ label: '', kind: 'fixed', amount: '' }], discountPct: '', capAmount: '', taxRatePct: '6', taxIncluded: true };
    return { source: 'manual' };
  }

  function renderEditor() {
    const { section } = state.editing;
    const d = state.draft;
    const box = el('form', { className: 'pm-editor', onsubmit: (e) => { e.preventDefault(); commitEdit(); } });
    box.appendChild(el('h2', { text: state.editing.id ? t('panel.lib.editTitle') : t('panel.lib.addTitle') }));
    FIELDS[section].forEach(([key, type]) => {
      const label = t('panel.field.' + section + '.' + key);
      const value = Array.isArray(d[key]) ? d[key].join(sep()) : (d[key] == null ? '' : String(d[key]));
      const input = type && type.startsWith('textarea')
        ? el('textarea', { className: 'awd-textarea', rows: type === 'textarea-lg' ? '10' : '3', value })
        : el('input', { className: 'awd-input', value });
      input.addEventListener('input', () => { d[key] = type === 'list' ? core.list(input.value) : input.value; });
      const hint = t('panel.hint.' + section + '.' + key);
      box.appendChild(el('label', { className: 'pm-field' }, [el('span', { text: label }), input,
        hint === 'panel.hint.' + section + '.' + key ? null : el('small', { className: 'hint', text: hint })]));
    });
    if (section === 'quotes') box.appendChild(renderQuoteEditor(d));
    box.appendChild(el('div', { className: 'pm-actions' }, [
      el('button', { type: 'submit', className: 'awd-btn awd-btn-sm awd-btn-primary', text: t('panel.action.save'), disabled: state.busy }),
      btn(t('panel.action.cancel'), () => { state.editing = null; render(); })
    ]));
    return box;
  }

  function renderQuoteEditor(d) {
    const wrap = el('div', { className: 'pm-quote-editor' });
    const rates = el('textarea', { className: 'awd-textarea', rows: '4', value: Object.entries(d.rates || {}).map(([k, v]) => k + '=' + v).join('\n') });
    rates.addEventListener('input', () => {
      const out = {};
      rates.value.split('\n').forEach((line) => { const m = line.split(/[=＝:：]/); if (m.length >= 2 && m[0].trim()) out[m[0].trim()] = m.slice(1).join('').trim(); });
      d.rates = out;
    });
    wrap.appendChild(el('label', { className: 'pm-field' }, [el('span', { text: t('panel.quote.rates') }), rates, el('small', { className: 'hint', text: t('panel.quote.ratesHint') })]));
    const items = el('div', { className: 'pm-quote-items' });
    const drawItems = () => {
      items.textContent = '';
      items.appendChild(el('span', { className: 'pm-label', text: t('panel.quote.items') }));
      d.items.forEach((it, i) => {
        const kind = el('select', { className: 'awd-select' }, ['fixed', 'hourly'].map((k) => el('option', { value: k, text: t('panel.quote.kind.' + k), selected: it.kind === k })));
        kind.addEventListener('change', () => { it.kind = kind.value; drawItems(); });
        const input = (key, ph) => {
          const n = el('input', { className: 'awd-input', placeholder: ph, value: it[key] || '' });
          n.addEventListener('input', () => { it[key] = n.value; });
          return n;
        };
        items.appendChild(el('div', { className: 'pm-quote-row' }, [kind, input('label', t('panel.quote.label')),
          it.kind === 'hourly' ? input('title', t('panel.quote.title')) : input('amount', t('panel.quote.amount')),
          it.kind === 'hourly' ? input('hours', t('panel.quote.hours')) : el('span'),
          btn(t('panel.action.delete'), () => { d.items.splice(i, 1); drawItems(); }, 'awd-btn-xs')]));
      });
      items.appendChild(btn(t('panel.quote.addItem'), () => { d.items.push({ label: '', kind: 'fixed', amount: '' }); drawItems(); }, 'awd-btn-xs'));
    };
    drawItems();
    wrap.appendChild(items);
    const num = (key, label) => {
      const n = el('input', { className: 'awd-input', value: d[key] || '', inputmode: 'decimal' });
      n.addEventListener('input', () => { d[key] = n.value; });
      return el('label', { className: 'pm-field pm-field-sm' }, [el('span', { text: label }), n]);
    };
    const taxIncl = el('input', { type: 'checkbox', checked: d.taxIncluded !== false });
    taxIncl.addEventListener('change', () => { d.taxIncluded = taxIncl.checked; });
    wrap.appendChild(el('div', { className: 'pm-inline' }, [num('discountPct', t('panel.quote.discount')), num('capAmount', t('panel.quote.cap')),
      num('taxRatePct', t('panel.quote.tax')), el('label', { className: 'pm-check' }, [taxIncl, el('span', { text: t('panel.quote.taxIncluded') })])]));
    const preview = el('div', { className: 'pm-quote-preview' });
    wrap.appendChild(el('div', { className: 'pm-actions' }, [btn(t('panel.quote.preview'), async () => {
      preview.textContent = '';
      try { preview.appendChild(quoteTable(await tool('quote.compute', { quote: d }))); } catch (e) { preview.appendChild(el('p', { className: 'pm-error', text: errText(e) })); }
    })]));
    wrap.appendChild(preview);
    return wrap;
  }

  function quoteTable(q) {
    const table = el('table', { className: 'pm-table pm-quote-table' }, [el('thead', {}, [el('tr', {}, ['item', 'basis', 'amount'].map((c) => el('th', { text: t('panel.quote.col.' + c) })))])]);
    const body = el('tbody');
    q.rows.forEach((r) => body.appendChild(el('tr', {}, [el('td', { text: r['项目'] }), el('td', { text: r['计算'] }), el('td', { className: 'pm-num', text: r['金额'] })])));
    table.appendChild(body);
    return el('div', {}, [table, el('p', { className: 'pm-total', text: t('panel.quote.total', { total: q.total, upper: q.upper }) }), q.note ? el('p', { className: 'hint', text: q.note }) : null]);
  }

  function commitEdit() {
    const { section, id } = state.editing;
    const d = Object.assign({}, state.draft);
    const first = FIELDS[section][0][0];
    if (!String(d[first] || '').trim()) { notice(t('panel.err.required', { field: t('panel.field.' + section + '.' + first) }), 'warn'); return; }
    Object.keys(d).forEach((k) => { if (typeof d[k] === 'string') d[k] = d[k].trim(); });
    run(async () => {
      if (section === 'quotes') await tool('quote.compute', { quote: d }); // 存之前先算一遍，金额写错当场提示
      const list = state.library[section].slice();
      if (id) list[list.findIndex((x) => x.id === id)] = Object.assign(d, { id });
      else list.push(Object.assign(d, { id: core.newId(section, list) }));
      await saveLibrary(Object.assign({}, state.library, { [section]: list }));
      state.editing = null;
      notice(t('panel.lib.saved'), 'info');
    });
  }

  function importLawfirm() {
    run(async () => {
      let overview;
      try { overview = await awd.lawfirm.request('overview', {}); } catch (e) {
        throw new Error(t('panel.err.lawfirm'));
      }
      const res = core.fromLawfirm(overview, state.library);
      await saveLibrary(res.library);
      state.section = 'credentials';
      notice(t('panel.lib.importedLawfirm', { credentials: res.credentials, lawyers: res.lawyers }), res.credentials ? 'info' : 'warn');
    });
  }

  function importFilePicker() {
    run(async () => {
      await loadFiles();
      state.importChoices = state.files.filter((f) => /\.json$/i.test(f.path));
      if (!state.importChoices.length) { state.importChoices = null; notice(t('panel.lib.noJson'), 'warn'); }
    });
  }

  function renderImportChoices() {
    return el('div', { className: 'awd-card' }, [el('h2', { text: t('panel.lib.pickJson') }),
      el('div', { className: 'pm-file-list' }, state.importChoices.map((f) => btn(f.path, () => run(async () => {
        state.importChoices = null;
        const res = await awd.files.read(f.path);
        let data;
        try { data = JSON.parse(res.content); } catch (e) { throw new Error(t('panel.err.bad_library')); }
        const merged = core.mergeLibrary(state.library, data);
        await saveLibrary(merged.library);
        notice(t('panel.lib.imported', { n: merged.added }), 'info');
      }), 'pm-file'))), btn(t('panel.action.cancel'), () => { state.importChoices = null; render(); })]);
  }

  // 导出的是整库（含真实客户名），写进当前项目后项目成员都能看到：先确认
  function exportLibrary() {
    confirmBar(t('panel.lib.confirmExport'), [[t('panel.lib.export'), () => run(async () => {
      const res = await tool('library.export');
      notice(t('panel.lib.exported', { path: res.path }), 'info');
    }), 'awd-btn-primary'], [t('panel.action.cancel'), () => {}]]);
  }

  // ---------- 2. 招标对照 ----------

  const readable = () => state.files.filter((f) => rc.isReadable(f.path) && !/\.(xlsx?|csv|pptx?)$/i.test(f.path));

  function renderTender(view) {
    const m = state.matrix;
    const files = readable();
    const select = el('select', { className: 'awd-select', id: 'tender-file' }, [el('option', { value: '', text: t('panel.tender.pick') })]
      .concat(files.map((f) => el('option', { value: f.path, text: f.path, selected: f.path === state.tenderPath }))));
    select.addEventListener('change', () => { state.tenderPath = select.value; render(); });
    const sum = core.summary(m.items);
    view.appendChild(el('div', { className: 'awd-card' }, [
      el('div', { className: 'awd-card-header' }, [el('h2', { className: 'awd-card-title', text: t('panel.tender.heading') })]),
      el('div', { className: 'pm-toolbar' }, [select,
        btn(t('panel.tender.extract'), extractRequirements, 'awd-btn-primary', { disabled: state.busy || !state.tenderPath }),
        btn(t('panel.tender.match'), matchAll, '', { disabled: state.busy || !m.items.length }),
        btn(t('panel.tender.export'), exportMatrix, '', { disabled: state.busy || !m.items.length })]),
      el('p', { className: 'hint', text: t('panel.tender.hint') }),
      m.items.length ? el('div', { className: 'pm-summary', id: 'matrix-summary' }, [
        el('span', { className: 'awd-badge awd-badge-accent', text: t('panel.sum.met', { n: sum.met }) }),
        el('span', { className: 'awd-badge awd-badge-gold', text: t('panel.sum.partial', { n: sum.partial }) }),
        el('span', { className: 'awd-badge awd-badge-warning', text: t('panel.sum.missing', { n: sum.missing }) }),
        sum.pending ? el('span', { className: 'awd-badge', text: t('panel.sum.pending', { n: sum.pending }) }) : null,
        sum.points ? el('span', { className: 'awd-badge awd-badge-info', text: t('panel.sum.points', { risk: sum.pointsAtRisk, total: sum.points }) }) : null
      ]) : null
    ]));
    if (!m.items.length) return;
    const names = evidenceNames();
    const table = el('table', { className: 'pm-table pm-matrix' }, [el('thead', {}, [el('tr', {}, ['no', 'kind', 'requirement', 'score', 'status', 'evidence', 'gap', ''].map((c) => el('th', { text: c ? t('panel.col.' + c) : '' })))])]);
    const body = el('tbody');
    m.items.forEach((it, i) => {
      const status = el('select', { className: 'awd-select pm-status status-' + it.status, 'aria-label': t('panel.col.status') },
        ['pending'].concat(core.STATUSES).map((s) => el('option', { value: s, text: t('panel.status.' + s), selected: it.status === s })));
      status.addEventListener('change', () => { it.status = status.value; it.edited = true; status.className = 'awd-select pm-status status-' + it.status; saveMatrixSoon(); refreshSummary(); });
      const gap = el('textarea', { className: 'awd-textarea pm-gap', rows: '2', value: it.gap || '', placeholder: t('panel.matrix.gapPh') });
      gap.addEventListener('input', () => { it.gap = gap.value; it.edited = true; saveMatrixSoon(); });
      const req = el('td', {}, [el('div', { text: it.text }),
        it.source ? el('button', { type: 'button', className: 'pm-link', text: t('panel.matrix.jump'), onclick: () => jump(it) })
          : el('span', { className: 'awd-badge awd-badge-warning', text: t('panel.matrix.unverified') })]);
      body.appendChild(el('tr', { className: 'row-' + it.status }, [
        el('td', { className: 'pm-num', text: String(i + 1) }), el('td', { text: t('panel.kind.' + it.kind) }), req,
        el('td', { className: 'pm-num', text: it.score || '' }), el('td', {}, [status]),
        el('td', {}, (it.evidence || []).map((id) => el('span', { className: 'pm-chip', text: names.get(id) || id })).concat(it.note ? [el('div', { className: 'hint', text: it.note })] : [])),
        el('td', {}, [gap]),
        el('td', {}, [btn(t('panel.action.delete'), () => { m.items.splice(i, 1); saveMatrixSoon(); render(); }, 'awd-btn-xs')])
      ]));
    });
    table.appendChild(body);
    view.appendChild(el('div', { className: 'awd-card' }, [el('div', { className: 'pm-table-wrap pm-matrix-wrap' }, [table]),
      el('div', { className: 'pm-actions' }, [btn(t('panel.matrix.add'), () => {
        m.items.push({ id: 'm' + Date.now(), kind: 'qualification', text: t('panel.matrix.newItem'), score: '', status: 'pending', evidence: [], note: '', gap: '', edited: true, source: null });
        saveMatrixSoon(); render();
      }, 'awd-btn-xs')])]));
  }

  // 改结论后只重画统计徽章，不打断表格的滚动位置
  function refreshSummary() {
    const box = $('matrix-summary');
    if (!box) return;
    const sum = core.summary(state.matrix.items);
    const badges = box.querySelectorAll('.awd-badge');
    badges[0].textContent = t('panel.sum.met', { n: sum.met });
    badges[1].textContent = t('panel.sum.partial', { n: sum.partial });
    badges[2].textContent = t('panel.sum.missing', { n: sum.missing });
    const points = box.querySelector('.awd-badge-info');
    if (points) points.textContent = t('panel.sum.points', { risk: sum.pointsAtRisk, total: sum.points });
  }

  function evidenceNames() {
    const lib = state.library;
    const map = new Map([['firm', lib.firm.name]]);
    lib.credentials.forEach((c) => map.set(c.id, mask(c.title)));
    lib.lawyers.forEach((l) => map.set(l.id, l.name + (l.title ? ' · ' + l.title : '')));
    lib.qualifications.forEach((q) => map.set(q.id, q.name));
    lib.services.forEach((s) => map.set(s.id, s.title));
    return map;
  }

  async function jump(it) {
    try { await awd.call('ui.openFile', { path: it.source.source_uri, locator: it.source.locator }); } catch (e) { notice(errText(e), 'error'); }
  }

  function makeAsk() {
    const limiter = rc.createLimiter({ sleep });
    return async (req) => {
      await limiter();
      return rc.withRetry(() => awd.ai.request(req.prompt, { system: req.system, purpose: 'pitch-materials', timeoutMs: 180000 }),
        { sleep, isCancelled: () => state.cancelled });
    };
  }

  function extractRequirements() {
    const path = state.tenderPath;
    const go = () => run(async () => {
      state.cancellable = true;
      state.progress = t('panel.progress.reading');
      render();
      const res = await awd.files.read(path);
      const text = String(res.content || '');
      if (text.replace(/\s/g, '').length < 50) throw new Error(t('panel.err.emptyTender'));
      const { chunks, truncated } = rc.chunkText(text, core.extractBudget(locale), 300, rc.LIMITS.maxChunks);
      const ask = makeAsk();
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        if (state.cancelled) break;
        state.progress = t('panel.progress.extract', { i: i + 1, n: chunks.length });
        render();
        const req = core.extractRequest(path.split('/').pop(), chunks[i], i, chunks.length, locale);
        parts.push({ chunk: chunks[i], data: core.parseJson(await ask(req)) });
      }
      const got = core.collectItems(path, parts);
      if (!got.items.length) throw new Error(t('panel.err.noRequirements'));
      state.matrix = Object.assign(emptyMatrix(), { tenderPath: path, tenderer: got.tenderer, project: got.project, items: got.items });
      if (got.tenderer) state.gen.client = got.tenderer;
      if (got.project) state.gen.project = got.project;
      state.selection = null;
      saveMatrixSoon();
      notice(t('panel.tender.extracted', { n: got.items.length }) + (truncated ? ' ' + t('panel.tender.truncated') : ''), 'info');
      state.cancellable = false;
    });
    if (state.matrix.items.some((it) => it.edited)) {
      confirmBar(t('panel.tender.confirmReplace'), [[t('panel.tender.extract'), go, 'awd-btn-primary'], [t('panel.action.cancel'), () => {}]]);
    } else go();
  }

  function matchAll() {
    run(async () => {
      state.cancellable = true;
      const items = state.matrix.items;
      const today = new Date().toISOString().slice(0, 10);
      const reqs = core.matchRequests(state.library, items.filter((it) => !it.edited), locale, today);
      const ask = makeAsk();
      let failed = 0;
      let omitted = 0;
      try {
        for (let i = 0; i < reqs.length; i++) {
          if (state.cancelled) break;
          state.progress = t('panel.progress.match', { i: i + 1, n: reqs.length });
          render();
          omitted = Math.max(omitted, reqs[i].omitted);
          if (!core.applyMatch(items, await ask(reqs[i]), state.library, reqs[i].ids)) failed++;
        }
      } finally {
        // 中途停止或出错时，已对照完的批次也要保存
        state.selection = null;
        saveMatrixSoon();
      }
      const sum = core.summary(items);
      notice(t('panel.tender.matched', { met: sum.met, partial: sum.partial, missing: sum.missing })
        + (failed ? ' ' + t('panel.tender.matchFailed', { n: failed }) : '') + (omitted ? ' ' + t('panel.tender.digestTrimmed', { n: omitted }) : ''), failed ? 'warn' : 'info');
      state.cancellable = false;
    });
  }

  function exportMatrix() {
    run(async () => {
      const bytes = xlsx.buildXlsx(core.exportSheets(state.matrix, state.library, t, locale));
      const base = (state.matrix.tenderPath.split('/').pop() || 'tender').replace(/\.[^.]+$/, '');
      await awd.call('files.download', { name: t('panel.export.fileName', { name: base }) + '.xlsx', data: bytes });
    });
  }

  // ---------- 3. 生成材料 ----------

  function ensureSelection() {
    if (state.selection) return;
    const rec = core.recommend(state.library, state.matrix, state.gen.project);
    state.recommended = rec;
    state.selection = {
      credentials: new Set(rec.credentials), lawyers: new Set(rec.lawyers),
      qualifications: new Set(rec.qualifications), services: new Set(rec.services)
    };
    if (!state.quoteId && state.library.quotes.length) state.quoteId = state.library.quotes[0].id;
  }

  function renderGenerate(view) {
    ensureSelection();
    const g = state.gen;
    const input = (key, label) => {
      const n = el('input', { className: 'awd-input', value: g[key] });
      n.addEventListener('input', () => { g[key] = n.value; });
      return el('label', { className: 'pm-field' }, [el('span', { text: label }), n]);
    };
    const tplSelect = (key, ext) => {
      const s = el('select', { className: 'awd-select' }, [el('option', { value: 'sample', text: t('panel.gen.sample'), selected: g[key] === 'sample' })]
        .concat(state.files.filter((f) => f.path.toLowerCase().endsWith('.' + ext)).map((f) => el('option', { value: f.path, text: f.path, selected: g[key] === f.path }))));
      s.addEventListener('change', () => { g[key] = s.value; });
      return s;
    };
    const toggle = (key, label) => {
      const n = el('input', { type: 'checkbox', checked: g[key] });
      n.addEventListener('change', () => { g[key] = n.checked; });
      return el('label', { className: 'pm-check' }, [n, el('span', { text: label })]);
    };
    view.appendChild(el('div', { className: 'awd-card' }, [
      el('div', { className: 'awd-card-header' }, [el('h2', { className: 'awd-card-title', text: t('panel.gen.heading') }),
        el('div', { className: 'pm-actions' }, [btn(t('panel.gen.recommend'), () => { state.selection = null; render(); }),
          btn(t('panel.gen.samples'), writeSamples)])]),
      el('div', { className: 'pm-grid2' }, [input('client', t('panel.gen.client')), input('project', t('panel.gen.project'))]),
      el('div', { className: 'pm-grid2' }, [
        el('label', { className: 'pm-field' }, [el('span', { text: t('panel.gen.wordTemplate') }), tplSelect('word', 'docx')]),
        el('label', { className: 'pm-field' }, [el('span', { text: t('panel.gen.pptTemplate') }), tplSelect('ppt', 'pptx')])]),
      el('p', { className: 'hint', text: t('panel.gen.templateHint') }),
      el('div', { className: 'pm-inline' }, [toggle('outward', t('panel.gen.outward')), toggle('hideAmounts', t('panel.gen.hideAmounts')),
        toggle('includeMatrix', t('panel.gen.includeMatrix'))]),
      el('p', { className: 'hint', text: t('panel.gen.outwardHint') })
    ]));
    const picks = el('div', { className: 'pm-picks' });
    ['credentials', 'lawyers', 'qualifications', 'services'].forEach((s) => picks.appendChild(renderPick(s)));
    picks.appendChild(renderQuotePick());
    view.appendChild(picks);
    view.appendChild(el('div', { className: 'awd-card pm-generate-bar' }, [
      btn(t('panel.gen.word'), () => generate('docx'), 'awd-btn-primary'),
      btn(t('panel.gen.ppt'), () => generate('pptx'), 'awd-btn-primary')
    ]));
    state.results.forEach((r) => view.appendChild(renderResult(r)));
  }

  function renderPick(section) {
    const sel = state.selection[section];
    const rec = new Set((state.recommended && state.recommended[section]) || []);
    const lib = state.library;
    const label = (it) => section === 'credentials' ? [mask(it.title), it.year].filter(Boolean).join(' · ')
      : section === 'lawyers' ? [it.name, it.title].filter(Boolean).join(' · ') : (it.name || it.title || it.id);
    const items = lib[section].map((it) => {
      const box = el('input', { type: 'checkbox', checked: sel.has(it.id) });
      box.addEventListener('change', () => { if (box.checked) sel.add(it.id); else sel.delete(it.id); count.textContent = String(sel.size); });
      return el('label', { className: 'pm-check pm-pick-item' }, [box, el('span', { text: label(it) }),
        rec.has(it.id) ? el('span', { className: 'awd-badge awd-badge-accent', text: t('panel.gen.recommended') }) : null]);
    });
    const count = el('span', { className: 'awd-badge', text: String(sel.size) });
    return el('details', { className: 'awd-card pm-pick', open: true }, [
      el('summary', {}, [t('panel.section.' + section) + ' ', count]),
      items.length ? el('div', { className: 'pm-pick-list' }, items) : el('p', { className: 'hint', text: t('panel.lib.empty.' + section) })]);
  }

  function renderQuotePick() {
    const s = el('select', { className: 'awd-select' }, [el('option', { value: '', text: t('panel.gen.noQuote') })]
      .concat(state.library.quotes.map((q) => el('option', { value: q.id, text: q.name, selected: q.id === state.quoteId }))));
    const preview = el('div', { className: 'pm-quote-preview' });
    const draw = async () => {
      preview.textContent = '';
      if (!state.quoteId) return;
      try { preview.appendChild(quoteTable(await computeQuote(state.quoteId))); } catch (e) { preview.appendChild(el('p', { className: 'pm-error', text: errText(e) })); }
    };
    s.addEventListener('change', () => { state.quoteId = s.value; draw(); });
    draw();
    return el('div', { className: 'awd-card pm-pick' }, [el('h2', { text: t('panel.section.quotes') }), s, preview]);
  }

  function writeSamples() {
    run(async () => {
      const res = await tool('templates.sample');
      await loadFiles();
      state.gen.word = res.paths[0];
      state.gen.ppt = res.paths[1];
      notice(t('panel.gen.samplesWritten', { paths: res.paths.join(sep()) }), 'info');
    });
  }

  function generate(kind) {
    const g = state.gen;
    const sel = state.selection;
    if (!g.client.trim()) { notice(t('panel.err.required', { field: t('panel.gen.client') }), 'warn'); return; }
    const params = {
      kind, template: kind === 'docx' ? g.word : g.ppt, client: g.client.trim(), project: g.project.trim(),
      credentialIds: Array.from(sel.credentials), lawyerIds: orderLawyers(Array.from(sel.lawyers)),
      qualificationIds: Array.from(sel.qualifications), serviceIds: Array.from(sel.services),
      quoteId: state.quoteId, outward: g.outward, hideAmounts: g.hideAmounts, includeMatrix: g.includeMatrix
    };
    const go = () => run(async () => {
      state.progress = t('panel.progress.generate');
      render();
      const res = await tool('generate', params);
      state.results.unshift(Object.assign({ kind, outward: g.outward }, res));
      state.results = state.results.slice(0, 4);
      await loadFiles();
      try { await awd.ui.openFile(res.path); } catch (e) { /* 打开失败不影响生成结果，卡片上可再点打开 */ }
      notice(t('panel.gen.done', { path: res.path }), res.leaks.length || res.unknownPlaceholders.length ? 'warn' : 'info');
    });
    const missing = g.outward ? core.missingAliases(state.library, params.credentialIds) : [];
    if (missing.length) {
      confirmBar(t('panel.gen.missingAlias', { list: missing.map((c) => c.title).join(sep2()) }), [
        [t('panel.gen.continue'), go, 'awd-btn-primary'], [t('panel.gen.fixAlias'), () => { state.tab = 'library'; state.section = 'credentials'; render(); }]]);
    } else go();
  }

  // 律师按库里的顺序（推荐时已按职级排过），负责人在前
  function orderLawyers(ids) {
    const rec = (state.recommended && state.recommended.lawyers) || [];
    return ids.slice().sort((a, b) => (rec.indexOf(a) < 0 ? 99 : rec.indexOf(a)) - (rec.indexOf(b) < 0 ? 99 : rec.indexOf(b)));
  }

  function renderResult(r) {
    const card = el('div', { className: 'awd-card pm-result' }, [
      el('div', { className: 'awd-card-header' }, [el('h2', { className: 'awd-card-title', text: t(r.kind === 'docx' ? 'panel.gen.resultWord' : 'panel.gen.resultPpt') }),
        el('div', { className: 'pm-actions' }, [btn(t('panel.gen.open'), () => awd.ui.openFile(r.path).catch((e) => notice(errText(e), 'error'))),
          r.kind === 'pptx' ? btn(t('panel.gen.polish'), () => awd.chat.send(t('panel.gen.polishPrompt', { path: r.path })).catch((e) => notice(errText(e), 'error'))) : null])]),
      el('p', { className: 'pm-path', text: r.path }),
      r.quote && r.quote.total ? el('p', { text: t('panel.quote.total', { total: r.quote.total, upper: r.quote.upper }) }) : null
    ]);
    if (r.outward) card.appendChild(el('p', { className: r.leaks.length ? 'pm-error' : 'pm-ok', text: r.leaks.length ? t('panel.gen.leaks', { list: r.leaks.join(sep2()) }) : t('panel.gen.noLeaks') }));
    else card.appendChild(el('p', { className: 'pm-warn', text: t('panel.gen.internal') }));
    if (r.overflowSlides && r.overflowSlides.length) card.appendChild(el('p', { className: 'pm-warn', text: t('panel.gen.overflow', { list: r.overflowSlides.join(sep()) }) }));
    if (r.unknownPlaceholders.length) card.appendChild(el('p', { className: 'pm-warn', text: t('panel.gen.unknown', { list: r.unknownPlaceholders.join(' ') }) }));
    if (r.kind === 'docx') card.appendChild(renderSensitive(r));
    return card;
  }

  // 复用「文件脱敏」引擎：预览统计 → 输入恢复密码后生成脱敏副本（真实客户名作为自定义敏感词）
  function renderSensitive(r) {
    const st = state.sensitive[r.path] || (state.sensitive[r.path] = {});
    const box = el('div', { className: 'pm-sensitive' }, [el('h3', { text: t('panel.sens.heading') }), el('p', { className: 'hint', text: t('panel.sens.hint') })]);
    const labels = {};
    const strategies = async () => (await awd.services.request('sensitive', 'options', {}) || [])
      .map((o) => { labels[o.value] = o.label || o.value; return o.value; }).filter((v) => !['CHINESE_NAME', 'COMPANY'].includes(v));
    box.appendChild(el('div', { className: 'pm-actions' }, [btn(t('panel.sens.preview'), () => run(async () => {
      const result = await awd.services.request('sensitive', 'preview', { fileId: r.fileId, strategies: await strategies(), mode: 'TOKEN',
        customTerms: core.secretNames(state.library), excludedTerms: [] }, { timeoutMs: 300000 });
      st.counts = Object.fromEntries(Object.entries((result && result.counts) || {}).map(([k, v]) => [labels[k] || k, v]));
    }))]));
    if (st.counts) {
      const entries = Object.entries(st.counts);
      box.appendChild(el('p', { text: entries.length ? t('panel.sens.counts', { list: entries.map(([k, v]) => k + ' ' + v).join(sep()) }) : t('panel.sens.none') }));
      const pwd = el('input', { className: 'awd-input', type: 'password', autocomplete: 'new-password', placeholder: t('panel.sens.password') });
      box.appendChild(el('div', { className: 'pm-toolbar' }, [pwd, btn(t('panel.sens.redact'), () => {
        if (!pwd.value) { notice(t('panel.sens.passwordRequired'), 'warn'); return; }
        const password = pwd.value;
        run(async () => {
          const out = await awd.services.request('sensitive', 'redact', { fileId: r.fileId, strategies: await strategies(), mode: 'TOKEN',
            customTerms: core.secretNames(state.library), excludedTerms: [], password }, { timeoutMs: 300000 });
          const file = out && out.file;
          st.copy = file ? (file.name || '') : '';
          await loadFiles();
          const hit = state.files.find((f) => file && f.name === file.name);
          if (hit) awd.ui.openFile(hit.path).catch(() => {});
          notice(t('panel.sens.done', { name: st.copy }), 'info');
        });
      })]));
    }
    return box;
  }

  // ---------- 启动 ----------

  function applyStatic() {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar-SA' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.title = t('panel.title');
  }

  async function boot() {
    const ctx = await awd.ready();
    locale = (ctx && ctx.language) || 'zh-CN';
    state.projectId = (ctx && ctx.projectId) || '';
    applyStatic();
    let userPickedTab = false;
    document.querySelectorAll('.pm-tabs [role=tab]').forEach((b) => b.addEventListener('click', () => {
      userPickedTab = true;
      state.tab = b.dataset.tab;
      state.editing = null;
      confirmBar('');
      if (state.tab !== 'library') loadFiles().then(render);
      render();
    }));
    await loadAll();
    // 已有对照表时默认打开招标对照；加载期间律师已经点了别的标签就不改
    if (state.matrix.items.length && !userPickedTab) state.tab = 'tender';
    render();
    try { awd.events.on('files.changed', () => { if (!state.busy) loadFiles().then(render); }); } catch (e) { /* 旧宿主无事件通道 */ }
    try {
      awd.events.on('project.switched', async (data) => {
        // 待保存的对照表属于上一个项目：宿主此时已切到新项目，不能再存，直接丢弃；生成表单也清空
        clearTimeout(matrixTimer);
        state.projectId = (data && data.projectId) || '';
        state.results = [];
        state.sensitive = {};
        state.gen = { client: '', project: '', word: 'sample', ppt: 'sample', outward: true, hideAmounts: false, includeMatrix: true };
        await loadAll();
        render();
      });
    } catch (e) { /* 同上 */ }
  }

  boot().catch((e) => notice(errText(e), 'error'));
})();
