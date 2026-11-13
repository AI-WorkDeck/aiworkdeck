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
    credentials: [['title'], ['client'], ['clientAlias'], ['area'], ['year'], ['period'], ['amount'], ['role'], ['lawyers', 'list'], ['tags', 'list'], ['summary', 'textarea'],
      ['scopeOfWork', 'textarea'], ['highlights', 'textarea'], ['outcome', 'textarea']],
    lawyers: [['name'], ['title'], ['areas', 'list'], ['since'], ['education'], ['bio', 'textarea']],
    qualifications: [['name'], ['kind'], ['issuer'], ['year'], ['expires']],
    services: [['title'], ['area'], ['content', 'textarea-lg']],
    quotes: [['name'], ['note', 'textarea']]
  };
  const COLUMNS = {
    credentials: ['title', 'clientAlias', 'area', 'year', 'role', 'share'],
    lawyers: ['name', 'title', 'areas', 'since', 'share'],
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
    results: [], sensitive: {},
    // 律所云端共享：available=null 未探测，false 不可用（未开启/未连接/宿主太旧）
    cloud: { available: null, teams: [], me: '', error: '', mine: {} },
    shared: { loaded: false, entries: [], query: '' },
    draftSource: null
  };

  // 本人库 + 同事共享来的条目（匹配、推荐、选材都用它；保存只存本人库）
  const combined = () => core.withShared(state.library, state.shared.entries);

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

  async function cloud(action, params) {
    return awd.lawfirm.request(action, params || {});
  }

  async function probeCloud() {
    try {
      const ctx = await cloud('pitch.context');
      // 团队可能是 id 字符串，也可能是 {id, name}（名录给出显示名时）；统一成 {id, name}，没有名称就显示 id
      const teams = ((ctx && ctx.teams) || []).map((tm) => (tm && typeof tm === 'object') ? { id: String(tm.id), name: String(tm.name || tm.id) } : { id: String(tm), name: String(tm) });
      state.cloud = Object.assign(state.cloud, { available: true, teams, me: (ctx && ctx.name) || '', error: '' });
      const mine = await cloud('pitch.mine');
      state.cloud.mine = Object.fromEntries(((mine && mine.entries) || []).map((e) => [e.id, e]));
    } catch (e) {
      state.cloud = Object.assign(state.cloud, { available: false, error: errText(e) });
    }
  }

  // 本地保存之后同步分享状态：选了团队/全所就上传（更新），改回仅自己就撤回。失败时把分享设置还原。
  async function syncShare(section, item, before) {
    const now = core.shareOf(item);
    const prev = core.shareOf(before);
    if (now.scope === 'private') {
      if (!prev.cloudId) return item;
      await cloud('pitch.withdraw', { id: prev.cloudId });
      return Object.assign({}, item, { share: { scope: 'private' } });
    }
    if (state.cloud.available !== true) throw new Error(t('panel.share.unavailable'));
    const params = { localId: item.id, kind: section === 'credentials' ? 'credential' : 'lawyer', scope: now.scope,
      teams: now.scope === 'team' ? now.teams : [], includeClient: section === 'credentials' && now.includeClient,
      payload: core.sharePayload(section, item, now.includeClient) };
    if (prev.cloudId && prev.version != null) params.expectedVersion = prev.version;
    const res = await cloud('pitch.share', params);
    return Object.assign({}, item, { share: Object.assign({}, now, { cloudId: res.id, version: res.version }) });
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

  async function loadLibrary() {
    try {
      const data = await tool('library.get');
      state.library = core.normalizeLibrary(data.library);
      state.libraryLoaded = true;
    } catch (e) {
      // 读库失败时界面上是空库：此时任何保存都会覆盖已有的库，所以在读成功之前一律不许保存
      state.libraryLoaded = false;
      notice(errText(e), 'error');
    }
  }

  async function loadAll() {
    await loadLibrary();
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
    if (!state.libraryLoaded) {
      await loadLibrary(); // 只重读库，不动对照表和生成表单
      if (!state.libraryLoaded) throw new Error(t('panel.err.libraryNotLoaded'));
      throw new Error(t('panel.err.libraryReloaded'));
    }
    await tool('library.save', { library: lib });
    quoteCache.clear();
    state.library = core.normalizeLibrary(lib);
  }

  // 项目切换代次：长任务（抽取/对照）和延迟保存只在启动时的那个项目里写对照表
  let projectGen = 0;
  let matrixTimer = null;
  function saveMatrixSoon(gen = projectGen) {
    if (gen !== projectGen) return;
    clearTimeout(matrixTimer);
    matrixTimer = setTimeout(() => {
      if (gen !== projectGen) return;
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
    if (state.projectId) view.appendChild(renderExperienceCard());
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

  // ---------- 从当前项目整理业绩（个人经验积累）----------

  // 律所管理里本项目的收案（桌面端才有）；读不到就当没有
  async function projectIntake() {
    try {
      const ov = await awd.lawfirm.request('overview', {});
      const rows = (ov && (ov.allIntakes || ov.intakes)) || [];
      return rows.find((m) => String(m.projectId) === String(state.projectId)) || null;
    } catch (e) { return null; }
  }

  async function projectWorklog() {
    try { return await awd.services.request('worklog', 'summary', {}); } catch (e) { return null; }
  }

  function checkNudge() {
    if (!state.projectId || state.nudgeFor === state.projectId) return;
    state.nudgeFor = state.projectId;
    projectIntake().then((m) => {
      const done = state.library.credentials.some((c) => c.source === 'project:' + state.projectId);
      state.nudge = m && m.status === 'CLOSED' && !done ? m.title : '';
      if (state.nudge && state.tab === 'library') render();
    });
  }

  function renderExperienceCard() {
    checkNudge();
    const ds = state.draftSource;
    const card = el('div', { className: 'awd-card' }, [el('div', { className: 'awd-card-header' }, [
      el('h2', { className: 'awd-card-title', text: t('panel.exp.heading') }),
      el('div', { className: 'pm-actions' }, [btn(t('panel.exp.start'), startExperience, ds ? '' : 'awd-btn-primary')])])]);
    if (state.nudge) card.appendChild(el('p', { className: 'pm-warn', text: t('panel.exp.closedNudge', { title: state.nudge }) }));
    card.appendChild(el('p', { className: 'hint', text: t('panel.exp.hint') }));
    if (!ds) return card;
    const facts = ds.facts;
    const lines = [];
    if (facts.intake) lines.push(t('panel.exp.factIntake', { title: facts.intake.title || '', area: facts.intake.practiceAreaLabel || '' }));
    else lines.push(t('panel.exp.noIntake'));
    if (facts.worklog && facts.worklog.totalHours) lines.push(t('panel.exp.factWorklog', { hours: facts.worklog.totalHours, from: facts.worklog.from || '', to: facts.worklog.to || '' }));
    else lines.push(t('panel.exp.noWorklog'));
    lines.forEach((l) => card.appendChild(el('p', { text: l })));
    card.appendChild(el('span', { className: 'pm-label', text: t('panel.exp.pickDocs') }));
    const list = el('div', { className: 'pm-pick-list' });
    ds.files.forEach((f) => {
      const c = el('input', { type: 'checkbox', checked: ds.picked.has(f.path) });
      c.addEventListener('change', () => {
        if (c.checked && ds.picked.size >= 3) { c.checked = false; notice(t('panel.exp.maxDocs'), 'warn'); return; }
        if (c.checked) ds.picked.add(f.path); else ds.picked.delete(f.path);
      });
      list.appendChild(el('label', { className: 'pm-check pm-pick-item' }, [c, el('span', { className: 'pm-path', text: f.path })]));
    });
    card.appendChild(list);
    card.appendChild(el('p', { className: 'hint', text: t('panel.exp.aiNotice') }));
    card.appendChild(el('div', { className: 'pm-actions' }, [btn(t('panel.exp.draft'), draftExperience, 'awd-btn-primary'),
      btn(t('panel.action.cancel'), () => { state.draftSource = null; render(); })]));
    return card;
  }

  function startExperience() {
    run(async () => {
      state.progress = t('panel.exp.collecting');
      render();
      const [intake, worklog] = await Promise.all([projectIntake(), projectWorklog()]);
      await loadFiles();
      const docs = state.files.filter((f) => /\.(docx?|pdf|md|txt)$/i.test(f.path) && !/^(投标材料|投标模板|Pitch )/.test(f.path));
      // 用时最多的文件排在前面并预先勾上（最多 3 份）
      const top = ((worklog && worklog.topFiles) || []).map((x) => x.name);
      docs.sort((a, b) => (top.indexOf(a.name) < 0 ? 99 : top.indexOf(a.name)) - (top.indexOf(b.name) < 0 ? 99 : top.indexOf(b.name)));
      const picked = new Set(docs.filter((d) => top.includes(d.name)).slice(0, 3).map((d) => d.path));
      state.draftSource = { facts: { projectId: state.projectId, intake, worklog, lawyer: state.cloud.me || '' }, files: docs.slice(0, 40), picked };
    });
  }

  function draftExperience() {
    const ds = state.draftSource;
    run(async () => {
      state.progress = t('panel.exp.drafting');
      render();
      const docs = [];
      for (const path of ds.picked) {
        try { const r = await awd.files.read(path); docs.push({ name: path.split('/').pop(), text: r.content || '' }); } catch (e) { /* 读不到的跳过 */ }
      }
      const facts = Object.assign({}, ds.facts, { docs, project: (ds.facts.intake && ds.facts.intake.title) || '' });
      const req = core.draftRequest(facts, locale);
      const text = await makeAsk()(req);
      const draft = core.parseDraft(text, facts);
      if (!draft) throw new Error(t('panel.exp.draftFailed'));
      // 起草结果只进编辑框：律师核对、修改并保存后才进库；默认仅自己可见
      state.draftSource = null;
      state.section = 'credentials';
      state.editing = { section: 'credentials', id: null };
      state.draft = draft;
      notice(t('panel.exp.drafted'), 'info');
    });
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
        if (c === 'share') return el('td', {}, [shareBadge(it)]);
        const td = el('td', { text: s === 'credentials' && c === 'clientAlias' && !it.clientAlias && it.client ? '' : cellValue(it, c) });
        if (s === 'credentials' && c === 'clientAlias' && !it.clientAlias && it.client) td.appendChild(el('span', { className: 'awd-badge awd-badge-warning', text: t('panel.lib.noAlias') }));
        if (i === 0 && it.source && it.source.startsWith('lawfirm')) td.appendChild(el('span', { className: 'awd-badge awd-badge-info', text: t('panel.lib.fromLawfirm') }));
        if (i === 0 && it.source && it.source.startsWith('project:')) td.appendChild(el('span', { className: 'awd-badge awd-badge-info', text: t('panel.exp.fromProject') }));
        return td;
      }));
      const cloudId = core.shareOf(it).cloudId;
      tr.appendChild(el('td', { className: 'pm-row-actions' }, [
        cloudId ? btn(t('panel.share.usage'), () => showUsage(it), 'awd-btn-xs') : null,
        btn(t('panel.action.edit'), () => startEdit(it.id), 'awd-btn-xs'),
        btn(t('panel.action.delete'), () => confirmBar(t('panel.lib.confirmDelete', { name: cellValue(it, COLUMNS[s][0]) }), [
          [t('panel.action.delete'), () => run(async () => {
            // 已分享的先撤回，再从本人库删除
            if (cloudId) await cloud('pitch.withdraw', { id: cloudId });
            const next = Object.assign({}, state.library, { [s]: state.library[s].filter((x) => x.id !== it.id) });
            await saveLibrary(next);
          }), 'awd-btn-danger'], [t('panel.action.cancel'), () => {}]]), 'awd-btn-xs')
      ]));
      body.appendChild(tr);
    });
    table.appendChild(body);
    host.appendChild(el('div', { className: 'pm-table-wrap' }, [table]));
  }

  function shareBadge(it) {
    const sh = core.shareOf(it);
    if (sh.scope === 'private') return el('span', { className: 'awd-badge', text: t('panel.share.scope.private') });
    const mine = state.cloud.mine[sh.cloudId];
    const uses = mine && mine.uses ? ' · ' + t('panel.share.uses', { n: mine.uses }) : '';
    return el('span', { className: 'awd-badge awd-badge-accent', text: t('panel.share.scope.' + sh.scope) + uses });
  }

  function showUsage(it) {
    run(async () => {
      const res = await cloud('pitch.usage', { id: core.shareOf(it).cloudId });
      const uses = (res && res.uses) || [];
      notice(uses.length ? t('panel.share.usedBy', { list: uses.slice(0, 10).map((u) => u.by + '（' + u.label + '，' + String(u.at).slice(0, 10) + '）').join(sep2()) })
        : t('panel.share.notUsed'), 'info');
    });
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
    if (section === 'credentials' || section === 'lawyers') box.appendChild(renderShareControls(section, d));
    box.appendChild(el('div', { className: 'pm-actions' }, [
      el('button', { type: 'submit', className: 'awd-btn awd-btn-sm awd-btn-primary', text: t('panel.action.save'), disabled: state.busy }),
      btn(t('panel.action.cancel'), () => { state.editing = null; render(); })
    ]));
    return box;
  }

  function renderShareControls(section, d) {
    const sh = core.shareOf(d);
    d.share = Object.assign({}, d.share || {}, { scope: sh.scope, teams: sh.teams, includeClient: sh.includeClient });
    const wrap = el('fieldset', { className: 'pm-share' }, [el('legend', { text: t('panel.share.heading') })]);
    const off = state.cloud.available === false;
    const scope = el('select', { className: 'awd-select', disabled: off }, core.SHARE_SCOPES.map((v) =>
      el('option', { value: v, text: t('panel.share.scope.' + v), selected: sh.scope === v })));
    const teamsBox = el('div', { className: 'pm-inline' });
    const drawTeams = () => {
      teamsBox.textContent = '';
      if (d.share.scope !== 'team') return;
      const teams = state.cloud.teams || [];
      if (!teams.length) { teamsBox.appendChild(el('span', { className: 'pm-warn', text: t('panel.share.noTeam') })); return; }
      if (teams.length === 1) { d.share.teams = [teams[0].id]; teamsBox.appendChild(el('span', { className: 'hint', text: t('panel.share.oneTeam', { team: teams[0].name }) })); return; }
      teams.forEach((tm) => {
        const c = el('input', { type: 'checkbox', checked: d.share.teams.includes(tm.id) });
        c.addEventListener('change', () => { d.share.teams = c.checked ? d.share.teams.concat([tm.id]) : d.share.teams.filter((x) => x !== tm.id); });
        teamsBox.appendChild(el('label', { className: 'pm-check' }, [c, el('span', { text: tm.name })]));
      });
    };
    scope.addEventListener('change', () => { d.share.scope = scope.value; drawTeams(); client.disabled = off || scope.value === 'private'; });
    const client = el('input', { type: 'checkbox', checked: sh.includeClient, disabled: off || sh.scope === 'private' });
    client.addEventListener('change', () => { d.share.includeClient = client.checked; });
    wrap.appendChild(el('label', { className: 'pm-field pm-field-sm' }, [el('span', { text: t('panel.share.scope') }), scope]));
    wrap.appendChild(teamsBox);
    if (section === 'credentials') wrap.appendChild(el('label', { className: 'pm-check' }, [client, el('span', { text: t('panel.share.includeClient') })]));
    wrap.appendChild(el('p', { className: 'hint', text: off ? t('panel.share.unavailable') + (state.cloud.error ? ' ' + state.cloud.error : '') : t('panel.share.hint') }));
    drawTeams();
    return wrap;
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
      const before = id ? list.find((x) => x.id === id) : null;
      if (!before) d.share = Object.assign({}, d.share || {}, { cloudId: '', version: null });
      else d.share = Object.assign({}, d.share || {}, { cloudId: core.shareOf(before).cloudId, version: core.shareOf(before).version });
      const item = Object.assign(d, { id: id || core.newId(section, list) });
      const at = id ? list.findIndex((x) => x.id === id) : list.length;
      list[at] = item;
      await saveLibrary(Object.assign({}, state.library, { [section]: list }));
      state.editing = null;
      if (section === 'credentials' || section === 'lawyers') {
        try {
          const synced = await syncShare(section, item, before);
          const again = state.library[section].slice();
          again[again.findIndex((x) => x.id === item.id)] = synced;
          await saveLibrary(Object.assign({}, state.library, { [section]: again }));
          await probeCloud();
        } catch (e) {
          // 云端没成功：本地内容已存，分享设置还原成原来的
          const again = state.library[section].slice();
          again[again.findIndex((x) => x.id === item.id)] = Object.assign({}, item, { share: before ? before.share : { scope: 'private' } });
          await saveLibrary(Object.assign({}, state.library, { [section]: again }));
          notice(t('panel.share.failed', { reason: errText(e) }), 'warn');
          return;
        }
      }
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
    const lib = combined();
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
      const gen = projectGen;
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
      if (gen !== projectGen) return;
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
      const gen = projectGen;
      state.cancellable = true;
      const items = state.matrix.items;
      const today = new Date().toISOString().slice(0, 10);
      const reqs = core.matchRequests(combined(), items.filter((it) => !it.edited), locale, today);
      const ask = makeAsk();
      let failed = 0;
      let omitted = 0;
      try {
        for (let i = 0; i < reqs.length; i++) {
          if (state.cancelled) break;
          state.progress = t('panel.progress.match', { i: i + 1, n: reqs.length });
          render();
          omitted = Math.max(omitted, reqs[i].omitted);
          if (!core.applyMatch(items, await ask(reqs[i]), combined(), reqs[i].ids)) failed++;
        }
      } finally {
        // 中途停止或出错时，已对照完的批次也要保存
        if (gen === projectGen) {
          state.selection = null;
          saveMatrixSoon(gen);
        }
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
    const rec = core.recommend(combined(), state.matrix, state.gen.project);
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
    view.appendChild(renderSharedSearch());
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

  // 同事分享给我（团队或全所）的业绩和简历：检索后并入可选材料，标明是谁的
  function renderSharedSearch() {
    const card = el('div', { className: 'awd-card' }, [el('div', { className: 'awd-card-header' }, [
      el('h2', { className: 'awd-card-title', text: t('panel.shared.heading') })])]);
    if (state.cloud.available !== true) {
      card.appendChild(el('p', { className: 'hint', text: t('panel.share.unavailable') + (state.cloud.error ? ' ' + state.cloud.error : '') }));
      return card;
    }
    const q = el('input', { className: 'awd-input', type: 'search', placeholder: t('panel.shared.query'), value: state.shared.query });
    q.addEventListener('input', () => { state.shared.query = q.value; });
    card.appendChild(el('div', { className: 'pm-toolbar' }, [q, btn(t('panel.shared.search'), () => run(async () => {
      const res = await cloud('pitch.search', { query: state.shared.query.trim() });
      state.shared.entries = (res && res.entries) || [];
      state.shared.loaded = true;
      state.selection = null;
      notice(t('panel.shared.found', { n: state.shared.entries.length }), 'info');
    }), 'awd-btn-primary')]));
    card.appendChild(el('p', { className: 'hint', text: state.shared.loaded ? t('panel.shared.loadedHint', { n: state.shared.entries.length }) : t('panel.shared.hint') }));
    return card;
  }

  function renderPick(section) {
    const sel = state.selection[section];
    const rec = new Set((state.recommended && state.recommended[section]) || []);
    const lib = combined();
    const owner = (it) => it.shared ? t('panel.shared.from', { owner: it.owner }) : '';
    const label = (it) => section === 'credentials' ? [core.maskClients(lib, it.title, t('panel.lib.someClient')), it.year, owner(it)].filter(Boolean).join(' · ')
      : section === 'lawyers' ? [it.name, it.title, owner(it)].filter(Boolean).join(' · ') : (it.name || it.title || it.id);
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
    // 选中的同事共享条目随请求带上（JAR 只收 x: 开头的），生成成功后在云端记一笔使用
    const lib = combined();
    params.externalCredentials = lib.credentials.filter((c) => c.shared && sel.credentials.has(c.id));
    params.externalLawyers = lib.lawyers.filter((l) => l.shared && sel.lawyers.has(l.id));
    const usedCloudIds = params.externalCredentials.concat(params.externalLawyers).map((x) => x.cloudId);
    const go = () => run(async () => {
      state.progress = t('panel.progress.generate');
      render();
      const res = await tool('generate', params);
      if (usedCloudIds.length) {
        try { await cloud('pitch.recordUse', { ids: usedCloudIds, label: (g.project || g.client).slice(0, 200) }); } catch (e) { /* 记录失败不影响已生成的文件 */ }
      }
      state.results.unshift(Object.assign({ kind, outward: g.outward }, res));
      state.results = state.results.slice(0, 4);
      await loadFiles();
      try { await awd.ui.openFile(res.path); } catch (e) { /* 打开失败不影响生成结果，卡片上可再点打开 */ }
      notice(t('panel.gen.done', { path: res.path }), res.leaks.length || res.unknownPlaceholders.length ? 'warn' : 'info');
    });
    const missing = g.outward ? core.missingAliases(lib, params.credentialIds) : [];
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
    await probeCloud();
    // 已有对照表时默认打开招标对照；加载期间律师已经点了别的标签就不改
    if (state.matrix.items.length && !userPickedTab) state.tab = 'tender';
    render();
    try { awd.events.on('files.changed', () => { if (!state.busy) loadFiles().then(render); }); } catch (e) { /* 旧宿主无事件通道 */ }
    try {
      awd.events.on('project.switched', async (data) => {
        // 待保存的对照表属于上一个项目：宿主此时已切到新项目，不能再存，直接丢弃；生成表单也清空
        clearTimeout(matrixTimer);
        projectGen++;
        state.cancelled = true;
        state.projectId = (data && data.projectId) || '';
        state.results = [];
        state.sensitive = {};
        state.draftSource = null;
        state.nudge = '';
        state.nudgeFor = '';
        state.gen = { client: '', project: '', word: 'sample', ppt: 'sample', outward: true, hideAmounts: false, includeMatrix: true };
        await loadAll();
        render();
      });
    } catch (e) { /* 同上 */ }
  }

  boot().catch((e) => notice(errText(e), 'error'));
})();
