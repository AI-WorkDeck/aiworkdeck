// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  var output = document.getElementById('result');
  var buttons = Array.from(document.querySelectorAll('[data-action]'));
  var cancel = document.getElementById('cancel');
  var active;
  function show(value) { output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
  var actions = {
    settingsOpen: function (options) { return awd.settings.open(options); },
    settingsSave: function (options) { return awd.settings.update({ greeting: document.getElementById('greeting').value }, options); },
    ai: function (options) { return awd.ai.request(document.getElementById('prompt').value, options); },
    search: function (options) { return awd.services.request('search', 'query', { query: document.getElementById('prompt').value }, options); },
    connect: function (options) { return awd.connections.connect('example-provider', options); },
    disconnect: function (options) { return awd.connections.disconnect('example-provider', options); },
    provider: function (options) { return awd.connections.request('example-provider', 'query', { input: document.getElementById('prompt').value }, options); },
    servers: function (options) { return awd.mcp.servers(options); },
    mcp: function (options) { return awd.mcp.call(document.getElementById('server').value, document.getElementById('tool').value, {}, options); },
    hostBilling: function (options) { return awd.billing.status(undefined, options); },
    providerBilling: function (options) { return awd.billing.status('example-provider', options); },
    checkout: function (options) { return awd.billing.checkout('example-provider', options); }
  };
  buttons.forEach(function (button) {
    button.disabled = true;
    button.addEventListener('click', async function () {
      active = new AbortController();
      buttons.forEach(function (b) { b.disabled = true; });
      cancel.disabled = false;
      try { show(await actions[button.dataset.action]({ signal: active.signal, timeoutMs: 120000 })); }
      catch (error) { show(error.code === 'unknown_method' ? '当前宿主尚不支持此功能，请升级后重试。' : (error.code || 'error') + ': ' + error.message); }
      finally { active = null; cancel.disabled = true; buttons.forEach(function (b) { b.disabled = false; }); }
    });
  });
  cancel.addEventListener('click', function () { if (active) active.abort(); });
  awd.ready().then(function () { show('宿主已连接，选择一个操作开始。'); buttons.forEach(function (b) { b.disabled = false; }); });
})();
