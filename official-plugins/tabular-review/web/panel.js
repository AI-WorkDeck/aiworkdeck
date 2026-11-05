// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 表格化审阅面板：选文件 → 定义问题列 → 批量抽取 → 表格 → 点格子看出处/跳原文 → 确认/修改 → 导出 xlsx。
(function () {
  'use strict';

  const core = window.AWD_TR_CORE;
  const xlsx = window.AWD_TR_XLSX;
  const L10N = window.AWD_TR_L10N || {};
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let locale = 'zh-CN';
  function t(key, params) {
    const hit = (L10N[locale] || {})[key] ?? (L10N['en-US'] || {})[key] ?? (L10N['zh-CN'] || {})[key] ?? key;
    return String(hit).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
  }

  const state = {
    projectId: '',
    files: [],
    filter: '',
    review: emptyReview(),
    running: false,
    cancelled: false,
    active: null,
    editing: false,
    storageWarned: false
  };

  function emptyReview() {
    return { version: 1, columns: [], rows: [], cells: {} };
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'className') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function notice(message, kind) {
    const box = $('notice');
    box.textContent = message || '';
    box.dataset.kind = kind || '';
    box.hidden = !message;
  }

  function errText(e) {
    if (e && e.code === 'unknown_method') return t('panel.err.upgrade');
    if (e && e.code === 'permission_denied') return t('panel.err.permission');
    return (e && e.message) || t('panel.err.generic');
  }

  // ---------- 存储（插件 KV 上限 64 KB；超限时提示导出，不阻断使用）----------

  const reviewKey = () => 'review:' + state.projectId;

  async function save() {
    try {
      await awd.storage.set(reviewKey(), state.review);
    } catch (e) {
      if (!state.storageWarned) {
        state.storageWarned = true;
        notice(e && e.code === 'quota_exceeded' ? t('panel.err.storageFull') : errText(e), 'warn');
      }
    }
  }

  async function load() {
    try {
      const saved = await awd.storage.get(reviewKey());
      if (saved && saved.version === 1 && Array.isArray(saved.columns) && Array.isArray(saved.rows)) {
        state.review = Object.assign(emptyReview(), saved);
        state.review.rows.forEach((r) => { if (r.status === 'running' || r.status === 'reading') r.status = 'idle'; });
      }
    } catch (e) { /* 读不到就从空表开始 */ }
    if (!state.review.columns.length) state.review.columns = core.templateColumns('contract', t);
  }

  // ---------- 文件 ----------

  async function loadFiles() {
    try {
      const list = await awd.files.list();
      state.files = list.filter((f) => core.isReadable(f.path)).sort((a, b) => a.path.localeCompare(b.path));
    } catch (e) {
      state.files = [];
      notice(errText(e), 'error');
    }
    // 已被删掉的文件不再出现在审阅表里
    const alive = new Set(state.files.map((f) => f.path));
    state.review.rows = state.review.rows.filter((r) => alive.has(r.path));
    renderFiles();
  }

  function selectedPaths() {
    return new Set(state.review.rows.map((r) => r.path));
  }

  function toggleFile(path, on) {
    const rows = state.review.rows;
    if (on && !rows.some((r) => r.path === path)) {
      if (rows.length >= core.LIMITS.files) { notice(t('panel.err.tooManyFiles', { n: core.LIMITS.files }), 'warn'); return; }
      rows.push({ path, status: 'idle', note: '' });
    } else if (!on) {
      state.review.rows = rows.filter((r) => r.path !== path);
      delete state.review.cells[path];
    }
  }

  function renderFiles() {
    const list = $('file-list');
    list.textContent = '';
    const chosen = selectedPaths();
    const q = state.filter.trim().toLowerCase();
    const shown = state.files.filter((f) => !q || f.path.toLowerCase().includes(q));
    if (!shown.length) list.appendChild(el('p', { className: 'hint', text: state.files.length ? t('panel.files.noMatch') : t('panel.files.empty') }));
    shown.forEach((f) => {
      list.appendChild(el('label', { className: 'file-item' }, [
        el('input', { type: 'checkbox', checked: chosen.has(f.path), disabled: state.running,
          onchange: (e) => { toggleFile(f.path, e.target.checked); renderAll(); save(); } }),
        el('span', { className: 'file-path', text: f.path, title: f.path })
      ]));
    });
    $('file-count').textContent = t('panel.files.count', { n: chosen.size });
  }

  // ---------- 问题列 ----------

  function clearColumnCells(colId) {
    Object.values(state.review.cells).forEach((row) => {
      if (row[colId] && core.LOCKED.indexOf(row[colId].status) < 0) delete row[colId];
    });
  }

  function renderColumns() {
    const box = $('column-list');
    box.textContent = '';
    state.review.columns.forEach((col, i) => {
      const typeSelect = el('select', { className: 'awd-select', 'aria-label': t('panel.columns.type'), disabled: state.running,
        onchange: (e) => { col.type = e.target.value; clearColumnCells(col.id); renderTable(); save(); } },
      core.COLUMN_TYPES.map((type) => el('option', { value: type, selected: col.type === type, text: t('panel.type.' + type) })));
      box.appendChild(el('div', { className: 'column-item' }, [
        el('span', { className: 'column-index', text: String(i + 1) }),
        el('input', { className: 'awd-input column-title', value: col.title, maxlength: '60', placeholder: t('panel.columns.titlePlaceholder'),
          'aria-label': t('panel.columns.title'), disabled: state.running,
          onchange: (e) => { col.title = e.target.value.trim() || col.title; renderTable(); save(); } }),
        typeSelect,
        el('textarea', { className: 'awd-input column-prompt', rows: '2', maxlength: String(core.LIMITS.prompt), placeholder: t('panel.columns.promptPlaceholder'),
          'aria-label': t('panel.columns.prompt'), disabled: state.running,
          onchange: (e) => { col.prompt = e.target.value.trim(); clearColumnCells(col.id); renderTable(); save(); } }, []),
        el('button', { type: 'button', className: 'awd-btn awd-btn-xs', text: t('panel.columns.remove'), disabled: state.running,
          onclick: () => { state.review.columns.splice(i, 1); Object.values(state.review.cells).forEach((r) => delete r[col.id]); renderAll(); save(); } })
      ]));
      box.lastChild.querySelector('textarea').value = col.prompt || '';
    });
    $('column-count').textContent = t('panel.columns.count', { n: state.review.columns.length });
  }

  function addColumn() {
    const cols = state.review.columns;
    if (cols.length >= core.LIMITS.columns) { notice(t('panel.err.tooManyColumns', { n: core.LIMITS.columns }), 'warn'); return; }
    cols.push({ id: core.newColumnId(cols), title: t('panel.columns.newTitle', { n: cols.length + 1 }), prompt: '', type: 'text' });
    renderAll();
    save();
  }

  function applyTemplate(id) {
    if (state.running) return;
    state.review.columns = id === 'blank' ? [] : core.templateColumns(id, t);
    state.review.cells = {};
    state.active = null;
    renderAll();
    save();
  }

  // ---------- 表格 ----------

  function rowCells(path) {
    return state.review.cells[path] || (state.review.cells[path] = {});
  }

  function renderTable() {
    const { columns, rows } = state.review;
    const head = $('table-head');
    const body = $('table-body');
    head.textContent = '';
    body.textContent = '';
    head.appendChild(el('tr', {}, [el('th', { scope: 'col', text: t('panel.table.file') })]
      .concat(columns.map((c) => el('th', { scope: 'col', title: c.prompt, text: c.title })))));
    if (!rows.length || !columns.length) {
      body.appendChild(el('tr', {}, [el('td', { colspan: String(columns.length + 1), className: 'hint', text: t('panel.table.empty') })]));
      return;
    }
    rows.forEach((row) => {
      const cells = state.review.cells[row.path] || {};
      const name = row.path.split('/').pop();
      const fileCell = el('th', { scope: 'row', className: 'row-file', title: row.path }, [
        el('span', { text: name }),
        row.status === 'running' || row.status === 'reading' ? el('span', { className: 'awd-badge awd-badge-info', text: t('panel.row.' + row.status) }) : null,
        row.note ? el('span', { className: 'row-note', text: row.note }) : null
      ]);
      body.appendChild(el('tr', {}, [fileCell].concat(columns.map((c) => {
        const cell = cells[c.id];
        const status = cell ? cell.status : 'empty';
        const isActive = state.active && state.active.path === row.path && state.active.col === c.id;
        return el('td', { className: 'cell' }, [
          el('button', { type: 'button', className: 'cell-btn status-' + status + (isActive ? ' is-active' : ''),
            'aria-label': c.title + ' · ' + name, onclick: () => { state.active = { path: row.path, col: c.id }; state.editing = false; renderTable(); renderDetail(); } }, [
            el('span', { className: 'cell-dot', 'aria-hidden': 'true' }),
            el('span', { className: 'cell-text', text: cell ? core.cellText(cell, t) : '—' })
          ])
        ]);
      }))));
    });
  }

  // ---------- 格子详情：出处、跳原文、确认、修改 ----------

  function renderDetail() {
    const box = $('detail');
    box.textContent = '';
    const a = state.active;
    const col = a && state.review.columns.find((c) => c.id === a.col);
    if (!a || !col) { box.hidden = true; return; }
    box.hidden = false;
    const cell = (state.review.cells[a.path] || {})[a.col];
    const status = cell ? cell.status : 'empty';
    const ev = cell && cell.evidence;
    box.appendChild(el('div', { className: 'detail-head' }, [
      el('strong', { text: col.title }),
      el('span', { className: 'awd-badge status-badge status-' + status, text: t('panel.status.' + status) }),
      el('button', { type: 'button', className: 'awd-btn awd-btn-xs', text: t('panel.detail.close'), onclick: () => { state.active = null; renderTable(); renderDetail(); } })
    ]));
    box.appendChild(el('p', { className: 'hint', text: a.path }));
    box.appendChild(el('p', { className: 'detail-question', text: col.prompt || col.title }));
    if (state.editing) {
      const input = el('textarea', { className: 'awd-input', rows: '4', maxlength: '2000', 'aria-label': t('panel.detail.answer') });
      input.value = cell && cell.answer ? cell.answer : '';
      box.appendChild(input);
      box.appendChild(el('div', { className: 'detail-actions' }, [
        el('button', { type: 'button', className: 'awd-btn awd-btn-primary awd-btn-sm', text: t('panel.detail.save'), onclick: () => {
          rowCells(a.path)[a.col] = core.editCell(cell, input.value);
          state.editing = false; renderTable(); renderDetail(); save();
        } }),
        el('button', { type: 'button', className: 'awd-btn awd-btn-sm', text: t('panel.detail.cancel'), onclick: () => { state.editing = false; renderDetail(); } })
      ]));
    } else {
      box.appendChild(el('p', { className: 'detail-answer', text: cell ? core.cellText(cell, t) : t('panel.status.empty') }));
      if (cell && cell.status === 'edited' && cell.aiAnswer) box.appendChild(el('p', { className: 'hint', text: t('panel.detail.aiAnswer', { answer: cell.aiAnswer }) }));
      if (cell && cell.status === 'unverified') box.appendChild(el('p', { className: 'hint', text: t('panel.detail.unverifiedHint') }));
      if (cell && cell.status === 'error') box.appendChild(el('p', { className: 'hint', text: cell.error || t('panel.err.generic') }));
      if (ev) {
        box.appendChild(el('blockquote', { className: 'detail-quote', text: ev.excerpt }));
      } else if (cell && cell.status !== 'not_found') {
        box.appendChild(el('p', { className: 'hint', text: t('panel.detail.noAnchor') }));
      }
      box.appendChild(el('div', { className: 'detail-actions' }, [
        ev ? el('button', { type: 'button', className: 'awd-btn awd-btn-sm', text: t('panel.detail.jump'), onclick: () => jump(a.path, ev) }) : null,
        cell && (cell.status === 'ai_draft' || cell.status === 'edited') ? el('button', { type: 'button', className: 'awd-btn awd-btn-primary awd-btn-sm', text: t('panel.detail.confirm'), disabled: state.running,
          onclick: () => { rowCells(a.path)[a.col] = core.confirmCell(cell); renderTable(); renderDetail(); save(); } }) : null,
        el('button', { type: 'button', className: 'awd-btn awd-btn-sm', text: t('panel.detail.edit'), disabled: state.running, onclick: () => { state.editing = true; renderDetail(); } })
      ]));
    }
  }

  async function jump(path, ev) {
    try {
      await awd.call('ui.openFile', { path, locator: ev.locator });
    } catch (e) {
      notice(errText(e), 'error');
    }
  }

  // ---------- 批量抽取 ----------

  function setRunning(on) {
    state.running = on;
    $('run').disabled = on;
    $('export').disabled = on;
    $('template-apply').disabled = on;
    $('add-column').disabled = on;
    renderFiles();
    renderColumns();
  }

  function progress(title, done, total, detail) {
    awd.ui.progress('#progress', title == null ? null : {
      title,
      detail,
      percent: total ? (done / total) * 100 : undefined,
      safetyNote: t('panel.run.safety'),
      cancelText: state.running ? t('panel.run.stop') : undefined,
      onCancel: state.running ? () => { state.cancelled = true; } : undefined
    });
  }

  function askConfirm(calls) {
    return new Promise((resolve) => {
      const bar = $('confirm');
      bar.textContent = '';
      bar.hidden = false;
      const done = (ok) => { bar.hidden = true; bar.textContent = ''; resolve(ok); };
      bar.appendChild(el('span', { text: t('panel.run.estimate', { calls, minutes: Math.max(1, Math.ceil(calls / core.LIMITS.perMinute)) }) }));
      bar.appendChild(el('button', { type: 'button', className: 'awd-btn awd-btn-primary awd-btn-sm', text: t('panel.run.confirm'), onclick: () => done(true) }));
      bar.appendChild(el('button', { type: 'button', className: 'awd-btn awd-btn-sm', text: t('panel.run.cancel'), onclick: () => done(false) }));
    });
  }

  async function run() {
    const { columns, rows } = state.review;
    if (!rows.length) { notice(t('panel.err.noFiles'), 'warn'); return; }
    if (!columns.length || columns.some((c) => !(c.prompt || '').trim())) { notice(t('panel.err.noColumns'), 'warn'); return; }
    const work = rows.filter((r) => core.pendingColumns(columns, state.review.cells[r.path]).length);
    if (!work.length) { notice(t('panel.run.nothing'), 'info'); return; }
    notice('');
    state.cancelled = false;
    setRunning(true);
    const texts = new Map();
    let calls = 0;
    try {
      for (let i = 0; i < work.length && !state.cancelled; i++) {
        const row = work[i];
        progress(t('panel.run.reading'), i, work.length, row.path);
        try {
          const res = await awd.files.read(row.path);
          const text = String((res && res.content) || '');
          if (!text.trim()) throw new Error(t('panel.err.emptyText'));
          texts.set(row.path, text);
          calls += core.estimateCalls(text.length, core.pendingColumns(columns, state.review.cells[row.path]), locale);
        } catch (e) {
          markRowError(row, errText(e));
        }
      }
      progress(null);
      renderTable();
      if (state.cancelled || !texts.size || !(await askConfirm(calls))) return;

      const limiter = core.createLimiter({ sleep });
      const queue = work.filter((r) => texts.has(r.path));
      let done = 0;
      const ask = (req) => core.withRetry(async () => {
        await limiter();
        return awd.ai.request(req.prompt, { system: req.system, purpose: 'tabular-review', timeoutMs: 180000 });
      }, { sleep, isCancelled: () => state.cancelled });
      const worker = async () => {
        while (queue.length && !state.cancelled) {
          const row = queue.shift();
          const pending = core.pendingColumns(columns, state.review.cells[row.path]);
          row.status = 'running';
          renderTable();
          try {
            const result = await core.reviewFile({ path: row.path, text: texts.get(row.path), columns: pending, language: locale, ask, isCancelled: () => state.cancelled });
            Object.assign(rowCells(row.path), result.cells);
            row.status = 'done';
            row.note = result.truncated ? t('panel.row.truncated', { n: result.chunks }) : '';
          } catch (e) {
            if (e && e.code === 'cancelled') row.status = 'idle';
            else markRowError(row, errText(e));
          }
          done++;
          progress(t('panel.run.extracting'), done, texts.size, t('panel.run.progress', { done, total: texts.size }));
          renderTable();
          if (state.active && state.active.path === row.path) renderDetail();
          await save();
        }
      };
      progress(t('panel.run.extracting'), 0, texts.size, t('panel.run.progress', { done: 0, total: texts.size }));
      await Promise.all([worker(), worker()]);
      notice(state.cancelled ? t('panel.run.stopped') : t('panel.run.finished'), 'info');
    } finally {
      state.review.rows.forEach((r) => { if (r.status === 'running' || r.status === 'reading') r.status = 'idle'; });
      setRunning(false);
      progress(null);
      renderTable();
      await save();
    }
  }

  function markRowError(row, message) {
    row.status = 'error';
    row.note = message;
    const cells = rowCells(row.path);
    core.pendingColumns(state.review.columns, cells).forEach((c) => { cells[c.id] = { status: 'error', error: message }; });
  }

  // ---------- 导出 ----------

  async function exportXlsx() {
    if (!state.review.rows.length || !state.review.columns.length) { notice(t('panel.err.nothingToExport'), 'warn'); return; }
    const bytes = xlsx.buildXlsx(core.exportSheets(state.review, t));
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = t('panel.export.fileName') + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.xlsx';
    try {
      await awd.call('files.download', { name, data: bytes });
      notice(t('panel.export.started'), 'info');
    } catch (e) {
      notice(errText(e), 'error');
    }
  }

  // ---------- 静态文案与启动 ----------

  function renderStatic() {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar-SA' ? 'rtl' : 'ltr';
    document.title = t('panel.title');
    document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    const select = $('template-select');
    select.textContent = '';
    ['contract', 'lease', 'blank'].forEach((id) => select.appendChild(el('option', { value: id, text: t('panel.tpl.' + id + '.name') })));
  }

  function renderAll() {
    renderFiles();
    renderColumns();
    renderTable();
    renderDetail();
  }

  async function start() {
    const ctx = await awd.ready();
    locale = (ctx && ctx.language) || 'zh-CN';
    state.projectId = (ctx && ctx.projectId) || '';
    renderStatic();
    if (!state.projectId) { notice(t('panel.err.noProject'), 'warn'); return; }
    $('file-filter').addEventListener('input', (e) => { state.filter = e.target.value; renderFiles(); });
    $('select-all').addEventListener('click', () => {
      const q = state.filter.trim().toLowerCase();
      state.files.filter((f) => !q || f.path.toLowerCase().includes(q)).forEach((f) => toggleFile(f.path, true));
      renderAll(); save();
    });
    $('clear-files').addEventListener('click', () => { state.review.rows = []; state.review.cells = {}; state.active = null; renderAll(); save(); });
    $('template-apply').addEventListener('click', () => applyTemplate($('template-select').value));
    $('add-column').addEventListener('click', addColumn);
    $('run').addEventListener('click', () => { run().catch((e) => notice(errText(e), 'error')); });
    $('export').addEventListener('click', exportXlsx);
    await load();
    await loadFiles();
    renderAll();
    try { awd.events.on('files.changed', () => { if (!state.running) loadFiles().then(renderAll); }); } catch (e) { /* 旧宿主无事件通道 */ }
  }

  start().catch((e) => notice(errText(e), 'error'));
})();
