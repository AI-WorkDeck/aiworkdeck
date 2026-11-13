// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 「律所云端」：律所各项云端功能（客户与主体、计时工时、投标材料……）的统一开关。
// 开关存在官方协作服务上、按律所一份；只有律所管理员能改，改时带上所见版本，别人刚改过就提示刷新。
// 各功能页只显示状态并链接到这里，不各自放开关。
(function () {
  'use strict';

  const TABLE = window.AWD_LAWFIRM_EXPENSE_L10N || {};
  const $ = (id) => document.getElementById(id);
  const call = (action, params = {}) => awd.call('lawfirm.request', { action, params });

  let locale = 'zh-CN';
  let view = null;
  let loadError = '';

  function t(key, vars) {
    const raw = TABLE[locale]?.[key] ?? TABLE['en-US']?.[key] ?? TABLE['zh-CN']?.[key] ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : raw;
  }

  function pickLocale(lang) {
    if (!lang) return 'zh-CN';
    if (TABLE[lang]) return lang;
    return String(lang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  }

  function el(tag, text, className) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    if (className) n.className = className;
    return n;
  }

  // 功能键对应的名称与说明：优先用功能自己登记的文案（如投标材料插件），其次本插件词条，最后通用说明
  function featureText(key, part) {
    const own = view?.labels?.[key]?.[part === 'name' ? 'names' : 'descriptions'] || {};
    const ownText = own[locale] || own['en-US'] || own['zh-CN'];
    if (ownText) return ownText;
    const k = `cloud.feature.${key}.${part}`;
    const v = t(k);
    return v === k ? t(`cloud.feature.other.${part}`, { key }) : v;
  }

  function status(text, isError) {
    const n = $('cl-status');
    n.textContent = text || '';
    n.dataset.error = String(Boolean(isError));
  }

  async function load() {
    try {
      view = await call('cloud.settings.get', {});
      loadError = '';
    } catch (err) {
      view = null;
      loadError = err?.message || t('cloud.loadFailed');
    }
    render();
  }

  async function toggle(key, enabled, purge, btn) {
    btn.disabled = true;
    try {
      view = await call('cloud.settings.set', { feature: key, enabled, purge, expectedVersion: view.version });
      status(enabled ? t('cloud.turnedOn', { name: featureText(key, 'name') }) : purge
        ? t('cloud.turnedOffPurged', { name: featureText(key, 'name') }) : t('cloud.turnedOff', { name: featureText(key, 'name') }));
      render();
    } catch (err) {
      status(err?.message || t('cloud.failed'), true);
      await load();
    } finally {
      btn.disabled = false;
    }
  }

  function featureCard(key, on) {
    const card = el('div', null, 'item-card');
    card.dataset.feature = key;
    const head = el('div', null, 'item-head');
    head.append(el('strong', featureText(key, 'name')));
    head.append(el('span', t(on ? 'cloud.on' : 'cloud.off'), on ? 'badge badge-green' : 'badge badge-neutral'));
    card.append(head);
    card.append(el('p', featureText(key, 'desc'), 'item-meta cell-text'));
    if (!view.firmAdmin) return card;
    const row = el('div', null, 'action-row');
    if (on) {
      const purgeLabel = el('label', null, 'cl-purge');
      const purge = document.createElement('input');
      purge.type = 'checkbox';
      purge.dataset.field = 'purge';
      purgeLabel.append(purge, el('span', t('cloud.purge')));
      const off = el('button', t('cloud.turnOff'));
      off.type = 'button';
      off.dataset.action = 'turn-off';
      off.addEventListener('click', () => toggle(key, false, purge.checked, off));
      row.append(off, purgeLabel);
    } else {
      const onBtn = el('button', t('cloud.turnOn'), 'primary');
      onBtn.type = 'button';
      onBtn.dataset.action = 'turn-on';
      onBtn.addEventListener('click', () => toggle(key, true, false, onBtn));
      row.append(onBtn);
    }
    card.append(row);
    return card;
  }

  function render() {
    const box = $('cl-features');
    box.replaceChildren();
    const who = $('cl-who');
    if (!view) {
      who.textContent = '';
      box.append(el('p', loadError, 'hint'));
      return;
    }
    who.textContent = view.firmAdmin ? t('cloud.youAreAdmin', { name: view.name || '' }) : t('cloud.adminOnly');
    const switches = view.switches || {};
    const keys = Object.keys(switches);
    if (!keys.length) box.append(el('p', t('cloud.noFeatures'), 'hint'));
    for (const key of keys) box.append(featureCard(key, Boolean(switches[key])));
  }

  function applyStaticText() {
    for (const n of document.querySelectorAll('[data-cl]')) n.textContent = t(n.dataset.cl);
  }

  $('cl-refresh').addEventListener('click', () => { status(''); load(); });
  $('tab-cloud')?.addEventListener('click', () => load());
  applyStaticText();
  awd.ready().then((ctx) => {
    locale = pickLocale(ctx?.language);
    applyStaticText();
    render();
  }).catch(() => {});
}());
