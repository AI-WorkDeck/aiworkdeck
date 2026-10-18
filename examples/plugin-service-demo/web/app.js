// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  var output = document.getElementById('result');
  var buttons = Array.from(document.querySelectorAll('[data-action]'));
  var cancel = document.getElementById('cancel');
  var active, generation = 0, connected = false;
  function show(value, error) {
    output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    output.dataset.error = String(!!error);
  }
  function controls(busy) {
    buttons.forEach(function (button) { button.disabled = busy || !connected; });
    cancel.disabled = !busy;
  }
  function provider() { return document.getElementById('provider').value; }
  function toolArgs() {
    var args = JSON.parse(document.getElementById('arguments').value);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是 JSON 对象');
    return args;
  }
  var actions = {
    settingsOpen: function (options) { return awd.settings.open(options); },
    settingsSave: function (options) { return awd.settings.update({ greeting: document.getElementById('greeting').value }, options); },
    ai: function (options) { return awd.ai.request(document.getElementById('prompt').value, options); },
    search: function (options) { return awd.services.request('search', 'query', { query: document.getElementById('prompt').value }, options); },
    connections: async function (options) {
      var result = await awd.connections.list(options);
      if (!options.signal.aborted) {
        ['example-provider', 'oauth-provider'].forEach(function (id) {
          var row = result.connections.find(function (item) { return item.id === id; });
          document.getElementById(id + '-status').textContent = row ? (row.connected ? '已连接' : '未连接') : '宿主未声明此连接';
        });
      }
      return result;
    },
    connect: function (options) { return awd.connections.connect(provider(), options); },
    disconnect: function (options) { return awd.connections.disconnect(provider(), options); },
    provider: function (options) { return awd.connections.request(provider(), 'query', { input: document.getElementById('prompt').value }, options); },
    servers: function (options) { return awd.mcp.servers(options); },
    mcp: function (options) { return awd.mcp.call(document.getElementById('server').value, document.getElementById('tool').value, toolArgs(), options); },
    hostBilling: function (options) { return awd.billing.status(undefined, options); },
    hostCheckout: function (options) { return awd.billing.checkout(undefined, options); },
    providerBilling: function (options) { return awd.billing.status(provider(), options); },
    checkout: function (options) { return awd.billing.checkout(provider(), options); }
  };
  buttons.forEach(function (button) {
    button.disabled = true;
    button.addEventListener('click', async function () {
      if (!connected || active) return;
      var controller = new AbortController(), current = ++generation;
      active = controller;
      controls(true);
      show('正在处理…');
      try {
        var value = await actions[button.dataset.action]({ signal: controller.signal, timeoutMs: 120000 });
        if (current !== generation || controller.signal.aborted) return;
        if (value && value.isError === true) show({ error: 'MCP 工具执行失败', result: value }, true);
        else if (button.dataset.action === 'connect') show('已打开宿主连接设置。请在宿主完成授权，再点击“刷新连接状态”；此操作尚不代表已登录。');
        else if (button.dataset.action === 'checkout' || button.dataset.action === 'hostCheckout') show('已打开订阅页面，尚不代表已付款。完成后重新查询权益。');
        else show(value);
      } catch (error) {
        if (current !== generation) return;
        show(error.name === 'AbortError' ? '已取消等待；已经开始的远端操作可能仍在执行，请先查询状态。'
          : error.code === 'unknown_method' ? '当前宿主尚不支持此功能，请升级后重试。' : (error.code || 'error') + ': ' + error.message, true);
      } finally {
        if (current === generation) { active = null; controls(false); }
      }
    });
  });
  cancel.addEventListener('click', function () { if (active) active.abort(); });
  function clearContext() {
    generation++;
    connected = false;
    if (active) active.abort();
    active = null;
    ['prompt', 'greeting', 'arguments'].forEach(function (id) { document.getElementById(id).value = ''; });
    ['example-provider', 'oauth-provider'].forEach(function (id) { document.getElementById(id + '-status').textContent = '未查询'; });
    controls(false);
    show('上下文已改变，旧结果已清除。请重新打开示例。');
  }
  var off = [awd.events.on('account.changed', clearContext), awd.events.on('project.switched', clearContext)];
  var initial = generation;
  awd.ready().then(function () {
    if (initial !== generation) return;
    connected = true;
    show('宿主已连接，选择一个操作开始。');
    controls(false);
  }).catch(function (error) { if (initial === generation) show(error.message, true); });
  window.addEventListener('pagehide', function () { clearContext(); off.forEach(function (stop) { stop(); }); });
})();
