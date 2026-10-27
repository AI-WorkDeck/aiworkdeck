// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AI WorkDeck 插件 SDK v1 —— postMessage 桥。
 *
 * 源头在桌面仓 sdk/plugin-sdk/，此为随模板分发的副本。
 * 契约（桌面端宿主按同一份实现，勿单方面改动）：
 *
 *   握手  宿主 -> 插件   { awd: 1, type: "init", context: {...} }
 *   请求  插件 -> 宿主   { awd: 1, type: "call", seq, method, params }
 *   响应  宿主 -> 插件   { awd: 1, type: "result", seq, ok, result | error: { code, message } }
 *
 * v1 方法：
 *   context.get   {}                  -> { pluginId, projectId, language, theme }
 *   files.list    {}                  -> { files: [{ path, name, size }] }   需 file_read
 *   files.read    { path }            -> { path, content, truncated }        需 file_read，文本上限 5 MB
 *   ui.toast      { message }         -> {}
 *   storage.get   { key }             -> { key, value }    插件级 KV，value 为 null 表示不存在
 *   storage.set   { key, value }      -> {}                插件级 KV，总量上限 64 KB
 *   evidence.link   { anchor: { selection: true } | { quote }, docPath?, targets: [{ path, locator?, relation?, method?, note? }] }
 *                                     -> { linkKey, targetIds }  需 editor；在当前 Word 文档的选区/引文上建底稿关联
 *   evidence.list   { docPath?, path?, sectionPath?, status? }
 *                                     -> { links: [{ linkKey, docPath, anchorText, sectionPath, status, targets: [{ targetId, path, locator, relation, method }] }] }  需 file_read
 *   evidence.locate { linkKey, targetId? }
 *                                     -> {}                需 editor；有 targetId 打开底稿定位，否则跳到文档里的锚点
 *
 * v2.6 新增（宿主 0.27.4 起）——主题通道，照 VS Code 给 webview 注入主题的机制：
 *   推送  宿主 -> 插件   { awd: 1, type: "theme", theme: "light"|"dark", tokens: { "--awd-*": "..." } }
 *   init 的 context 也带 theme 与 themeTokens 两个字段（老宿主只有 theme 字符串，
 *   没有 themeTokens——SDK 会降级为只挂 data-theme，不注入变量）。
 *   SDK 收到即自动：documentElement 挂 data-theme="light|dark"、body 挂
 *   awd-theme-light / awd-theme-dark class、把 tokens 逐个写成 CSS 自定义属性。
 *   插件 CSS 因此可以直接用 var(--awd-surface) 这类语义令牌，零 JS 跟随主题；
 *   需要脚本联动的用 awd.theme.onChange(cb)。
 *
 * v2.5 新增（宿主 0.27 起；老宿主返回 unknown_method，插件要能降级）：
 *   tools.invoke  { name, args? }     -> { output }        直调本插件 manifest 声明的 JAR 工具；
 *                                        output 是工具原始字符串输出（通常为 JSON）。权限/配额/项目归属
 *                                        由宿主端点按 AI 链路同一套规则校验，工具名不属于本插件即 invoke_failed
 *   chat.send     { prompt }          -> {}                把 prompt 作为可见的用户消息发进 AI 对话
 *                                        （与启动面板快捷按钮同一条路），上限 4000 字
 *   ui.openFile   { path }            -> {}                需 file_read；把项目文件打开到工作台中栏
 *
 * v2.7 新增（宿主 0.27.4 起；老宿主对新方法返回 unknown_method，SDK 已按下述说明降级）：
 *   doc.exec      { action, params? }  -> { result }        需 editor；对当前聚焦文档执行编辑原语，
 *                                        action/params 与 AI 工具面的下发名同一套（doc_/sheet_/slide_ 全集
 *                                        的安全子集，白名单外返回 action_not_allowed）。写入走修订（Writer），
 *                                        署名 AI WorkDeck，用户可逐条接受/拒绝
 *   doc.active    {}                   -> { fileId, kind }  需 editor；当前聚焦文档（kind: writer|calc|impress），
 *                                        没有打开的文档时 fileId 为 null
 *   events.subscribe   { events: [..] } -> { subscribed }   订阅宿主事件（见下）；权限不足的事件名被静默剔除，
 *                                        以回声的 subscribed 集合为准
 *   events.unsubscribe { events: [..] } -> { subscribed }
 *   ai.request    { prompt, system?, purpose? } -> { text, modelId }
 *                                        需 ai 权限；经平台 Credits 通道调辅助模型（插件免带 Key），
 *                                        prompt+system 合计上限 16000 字符，每插件 10 次/分钟。
 *                                        要工具、要落文档、要让用户看见过程的场景走 chat.send，不走这条
 *
 *   事件推送  宿主 -> 插件   { awd: 1, type: "event", event, data }
 *   首批事件：files.changed（需 file_read）/ selection.changed（需 editor）/ project.switched。
 *   payload 刻意为空——事件是「该重拉了」的信号，数据由插件按各自权限的方法拉取。
 *   用 awd.events.on(name, cb) 即可（自动订阅/退订；老宿主上 on 照常返回退订函数，只是永不触发）。
 *
 * v2.9 新增（宿主 0.28 起）：
 *   settings.get  { key }              -> { key, value }    读 manifest.settings 声明的配置项
 *                                        （值统一是字符串；用户在插件广场详情页填写，插件只读）。
 *                                        secret 的项不提供给插件页面（permission_denied）；
 *                                        未声明的键 not_found
 *   事件 settings.changed：宿主设置表单保存后推送（只推给设置所属的插件），收到后重新 get
 *
 * v2.11 / SDK 1.5.0 (host 0.61.0+):
 *   im.request { action, params } -> object; requires im. Fixed messaging actions only.
 *   lawfirm.request { action, params } -> object; requires lawfirm. Law firm intake, conflict check, finance and dashboard actions.
 *   im.downloadAttachment { conversationId, attachmentId } -> { started, name }; authorized download via host.
 *   chat.addFile { path } -> {}; requires file_read. Adds material without sending an AI message.
 *   files.prepareDrag { path } -> validated file descriptor plus dragToken, dragType, expiresAt.
 *   files.endDrag {} -> {}; invalidates this iframe's prepared drag. Both require file_read.
 *   Prepare before dragstart; synchronously put dragType/dragToken into dataTransfer on dragstart.
 *   Drag tickets expire, are consumed once, and are cleared on project/account change or frame removal.
 *   account.changed is a data-free event: discard cached identity, messages and pending work.
 *   Older hosts return unknown_method; do not emulate IM with localStorage.
 *
 * SDK 1.6.0: services, MCP, host-managed connections, billing and editable settings.
 * All calls accept transport options { signal, timeoutMs }; timeout defaults to 60000 ms.
 * Timeout/abort discard late responses. Service requests also send best-effort cancellation.
 * unknown_method remains a rejected promise: offer an upgrade, never pretend success.
 *
 * 错误码：permission_denied（manifest 未声明所需权限）、unknown_method（宿主不认识的方法）、
 *   anchor_ambiguous（引文 0 或多处命中 / anchor 形状不对）、no_selection（要求选区但当前没有）、
 *   not_found（链接或文件不存在）、no_active_document（当前没有打开的 Word 文档）、
 *   invalid_params（参数缺失或形状不对）、invoke_failed（工具执行被拒或出错）、
 *   action_not_allowed（doc.exec 的原语不对插件开放）、ai_failed（模型调用失败）、
 *   quota_exceeded（存储/字数/频次超限）、experimental_not_allowed（x- 实验方法仅对 dev 安装开放）。
 *
 * 重要：本文件必须用普通同步 <script> 引入，且排在业务脚本之前——
 * 宿主在 iframe load 后立刻发 init，晚注册监听会错过握手，ready() 将永远挂起。
 */
(function (global) {
  'use strict';

  var PROTOCOL = 1;
  var seq = 0;
  var pending = Object.create(null);
  var resolveReady;
  var readyPromise = new Promise(function (resolve) { resolveReady = resolve; });

  function post(msg) {
    // 插件运行在 opaque origin 的 sandbox iframe 里，拿不到宿主的真实 origin，
    // 只能用 '*'；反向的来源校验由宿主端（校验 event.source 是本 iframe）负责。
    global.parent.postMessage(msg, '*');
  }

  global.addEventListener('message', function (event) {
    if (event.source !== global.parent) return;
    var msg = event.data;
    if (!msg || msg.awd !== PROTOCOL) return;

    if (msg.type === 'init') {
      awd.context = msg.context || {};
      applyTheme(awd.context.theme, awd.context.themeTokens);
      resolveReady(awd.context);
      return;
    }

    if (msg.type === 'theme') {
      applyTheme(msg.theme, msg.tokens);
      return;
    }

    if (msg.type === 'event') {
      var handlers = eventListeners[msg.event];
      if (handlers) {
        handlers.slice().forEach(function (cb) {
          try { cb(msg.data || {}); } catch (e) { /* 插件回调抛错不打断其余 */ }
        });
      }
      return;
    }

    if (msg.type === 'result') {
      var entry = pending[msg.seq];
      if (!entry) return;
      entry.cleanup();
      if (msg.ok) {
        entry.resolve(msg.result);
      } else {
        var err = new Error((msg.error && msg.error.message) || '调用失败');
        err.code = (msg.error && msg.error.code) || 'unknown_error';
        entry.reject(err);
      }
    }
  });

  // ---- 主题与 Plugin UI v3.0 样式注入（v2.6 / v3.0）--------------------------
  // 自动应用 + 回调通知。tokens 缺席（老宿主）时只挂 data-theme/class，
  // 插件的 var(--awd-*) 走自己 CSS 里的 fallback 值。
  // 同时在具备 document.head 的真实 DOM 环境里自动注入 <style id="awd-plugin-ui-v3">，
  // 提供 .awd-plugin-stage / .awd-plugin-header / .awd-plugin-grid / .awd-card / .awd-btn / .awd-safe-progress 等标准组件类。
  var PLUGIN_UI_V3_CSS = [
    ':root{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}',
    '.awd-plugin-stage{container-type:inline-size;box-sizing:border-box;width:100%;max-width:1120px;margin:0 auto;padding:var(--awd-space-5,20px) var(--awd-space-6,24px);font-family:var(--awd-font-sans,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif);font-size:var(--awd-font-size-body,13px);line-height:var(--awd-line-height-ui,1.5);color:var(--awd-text,#2B2A26)}',
    '.awd-plugin-header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:var(--awd-space-3,12px);padding-bottom:var(--awd-space-4,16px);margin-bottom:var(--awd-space-4,16px);border-bottom:1px solid var(--awd-border-subtle,#EAE7DD)}',
    '.awd-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--awd-accent-text,#2E5A50);margin-bottom:4px}',
    '.awd-title{margin:0;font-family:var(--awd-font-serif,"Source Han Serif SC","Noto Serif CJK SC","Songti SC",serif);font-size:20px;font-weight:700;line-height:1.3;letter-spacing:-.01em;color:var(--awd-text,#2B2A26)}',
    '.awd-subtitle{margin:4px 0 0;font-size:12.5px;line-height:1.55;color:var(--awd-text-2,#6B675C)}',
    '.awd-header-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--awd-space-2,8px)}',
    '.awd-subnav{display:inline-flex;align-items:center;gap:2px;padding:3px;background:var(--awd-surface-2,#E9E6DC);border:1px solid var(--awd-border-subtle,#EAE7DD);border-radius:var(--awd-radius-md,6px);margin-bottom:var(--awd-space-4,16px)}',
    '.awd-subnav-item{appearance:none;border:1px solid transparent;background:transparent;color:var(--awd-text-2,#6B675C);font:inherit;font-size:12px;font-weight:500;height:var(--awd-control-xs,24px);padding:0 12px;border-radius:var(--awd-radius-sm,4px);cursor:pointer;transition:all var(--awd-motion-fast,140ms) ease}',
    '.awd-subnav-item.is-active,.awd-subnav-item[aria-selected="true"]{background:var(--awd-surface,#FCFBF7);color:var(--awd-accent-text,#2E5A50);font-weight:600;border-color:var(--awd-border-subtle,#EAE7DD);box-shadow:var(--awd-shadow-btn,0 1px 2px rgba(42,38,30,.06))}',
    '.awd-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--awd-space-3,12px);margin-bottom:var(--awd-space-4,16px)}',
    '.awd-kpi-card{background:var(--awd-surface,#FCFBF7);border:1px solid var(--awd-border,#DDD8CA);border-radius:var(--awd-radius-dialog,8px);padding:var(--awd-space-3,12px) var(--awd-space-4,16px);box-shadow:var(--awd-shadow-card,0 1px 3px rgba(42,38,30,.05))}',
    '.awd-kpi-label{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--awd-text-2,#6B675C);margin-bottom:4px}',
    '.awd-kpi-value{font-family:var(--awd-font-serif,"Source Han Serif SC","Noto Serif CJK SC","Songti SC",serif);font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--awd-text,#2B2A26);line-height:1.25}',
    '.awd-plugin-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--awd-space-4,16px);align-items:start}',
    '@container (min-width:640px){.awd-plugin-grid{grid-template-columns:minmax(260px,320px) minmax(0,1fr)}}',
    '.awd-card{background:var(--awd-surface,#FCFBF7);border:1px solid var(--awd-border,#DDD8CA);border-radius:var(--awd-radius-dialog,8px);padding:var(--awd-space-4,16px);box-shadow:var(--awd-shadow-card,0 1px 3px rgba(42,38,30,.05));box-sizing:border-box}',
    '.awd-card+.awd-card{margin-top:var(--awd-space-3,12px)}',
    '.awd-card-header{display:flex;align-items:center;justify-content:space-between;gap:var(--awd-space-2,8px);margin-bottom:var(--awd-space-3,12px);padding-bottom:var(--awd-space-2,8px);border-bottom:1px solid var(--awd-border-subtle,#EAE7DD)}',
    '.awd-card-title{margin:0;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--awd-text-2,#6B675C)}',
    '.awd-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--awd-control-md,32px);padding:0 12px;border-radius:var(--awd-radius-md,6px);border:1px solid var(--awd-border,#DDD8CA);background:var(--awd-surface,#FCFBF7);color:var(--awd-text,#2B2A26);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;box-shadow:var(--awd-shadow-btn,0 1px 2px rgba(42,38,30,.06));transition:all var(--awd-motion-fast,140ms) ease;box-sizing:border-box}',
    '.awd-btn:hover:not(:disabled){background:var(--awd-surface-2,#E9E6DC);border-color:var(--awd-accent,#2E5A50);color:var(--awd-accent-text,#2E5A50)}',
    '.awd-btn:disabled{opacity:.55;cursor:not-allowed}',
    '.awd-btn-sm{min-height:var(--awd-control-sm,28px);padding:0 10px;font-size:12px}',
    '.awd-btn-xs{min-height:var(--awd-control-xs,24px);padding:0 8px;font-size:11px}',
    '.awd-btn-primary{background:var(--awd-accent,#2E5A50);border-color:var(--awd-accent,#2E5A50);color:var(--awd-text-on-accent,#FFF)}',
    '.awd-btn-primary:hover:not(:disabled){background:var(--awd-accent-hover,#254B42);border-color:var(--awd-accent-hover,#254B42);color:var(--awd-text-on-accent,#FFF)}',
    '.awd-btn-danger{background:var(--awd-danger-soft,#F9EBEA);border-color:var(--awd-danger,#B5483C);color:var(--awd-danger-text,#B5483C)}',
    '.awd-input,.awd-select,.awd-textarea{box-sizing:border-box;width:100%;min-height:var(--awd-control-md,32px);padding:5px 10px;border-radius:var(--awd-radius-md,6px);border:1px solid var(--awd-border,#DDD8CA);background:var(--awd-surface,#FCFBF7);color:var(--awd-text,#2B2A26);font:inherit;font-size:13px}',
    '.awd-input:focus,.awd-select:focus,.awd-textarea:focus{outline:none;border-color:var(--awd-accent,#2E5A50);box-shadow:0 0 0 2px var(--awd-accent-soft,rgba(46,90,80,.12))}',
    '.awd-badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;background:var(--awd-surface-2,#E9E6DC);color:var(--awd-text-2,#6B675C);border:1px solid var(--awd-border-subtle,#EAE7DD)}',
    '.awd-badge-accent{background:var(--awd-accent-soft,#E6EFEA);color:var(--awd-accent-text,#2E5A50)}',
    '.awd-badge-gold{background:var(--awd-gold-soft,#F4EFE4);color:var(--awd-gold-text,#7D6438)}',
    '.awd-badge-info{background:var(--awd-info-soft,#E9EFF4);color:var(--awd-info-text,#3C5A73)}',
    '.awd-badge-warning{background:var(--awd-warning-soft,#F8F0DF);color:var(--awd-warning-text,#8A5D14)}',
    '.awd-badge-danger{background:var(--awd-danger-soft,#F9EBEA);color:var(--awd-danger-text,#B5483C)}',
    '.awd-safe-progress{background:var(--awd-surface,#FCFBF7);border:1px solid var(--awd-border,#DDD8CA);border-left:3px solid var(--awd-accent,#2E5A50);border-radius:var(--awd-radius-dialog,8px);padding:12px 14px;margin-bottom:var(--awd-space-3,12px);box-shadow:var(--awd-shadow-card,0 1px 3px rgba(42,38,30,.05))}',
    '.awd-safe-progress-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}',
    '.awd-safe-progress-title{font-size:12.5px;font-weight:600;color:var(--awd-text,#2B2A26)}',
    '.awd-safe-progress-pct{font-family:var(--awd-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--awd-accent-text,#2E5A50)}',
    '.awd-safe-progress-track{height:5px;border-radius:999px;background:var(--awd-surface-2,#E9E6DC);overflow:hidden;margin-bottom:8px}',
    '.awd-safe-progress-fill{height:100%;border-radius:999px;background:var(--awd-accent,#2E5A50);transition:width 220ms ease}',
    '.awd-safe-progress-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--awd-text-2,#6B675C)}'
  ].join('\n');

  function ensurePluginUiStyle() {
    try {
      if (typeof document === 'undefined' || !document.head || !document.createElement) return;
      if (document.getElementById && document.getElementById('awd-plugin-ui-v3')) return;
      var styleEl = document.createElement('style');
      styleEl.id = 'awd-plugin-ui-v3';
      styleEl.textContent = PLUGIN_UI_V3_CSS;
      if (document.head.firstChild && document.head.insertBefore) {
        document.head.insertBefore(styleEl, document.head.firstChild);
      } else if (document.head.appendChild) {
        document.head.appendChild(styleEl);
      }
    } catch (e) { /* 无 DOM 环境静默 */ }
  }
  ensurePluginUiStyle();

  var themeState = { mode: 'light', tokens: {} };
  var themeListeners = [];
  function applyTheme(mode, tokens) {
    ensurePluginUiStyle();
    themeState.mode = mode === 'dark' ? 'dark' : 'light';
    if (tokens && typeof tokens === 'object') themeState.tokens = tokens;
    try {
      var rootEl = document.documentElement;
      rootEl.setAttribute('data-theme', themeState.mode);
      Object.keys(themeState.tokens).forEach(function (k) {
        if (k.indexOf('--') === 0) rootEl.style.setProperty(k, String(themeState.tokens[k]));
      });
      if (document.body) {
        document.body.classList.toggle('awd-theme-dark', themeState.mode === 'dark');
        document.body.classList.toggle('awd-theme-light', themeState.mode !== 'dark');
      }
    } catch (e) { /* 无 DOM 环境静默 */ }
    themeListeners.forEach(function (cb) {
      try { cb(themeState.mode, themeState.tokens); } catch (e) { /* 插件回调抛错不打断其余 */ }
    });
  }

  function bridgeError(code, message) {
    var error = new Error(message);
    error.code = code;
    if (code === 'aborted') error.name = 'AbortError';
    return error;
  }

  function call(method, params, options) {
    var opts = options || {};
    return new Promise(function (resolve, reject) {
      var timeoutMs = opts.timeoutMs == null ? 60000 : opts.timeoutMs;
      if (typeof timeoutMs !== 'number' || !isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) {
        reject(bridgeError('invalid_params', 'timeoutMs must be between 1 and 300000 ms'));
        return;
      }
      var signal = opts.signal;
      if (signal && signal.aborted) {
        reject(bridgeError('aborted', 'Call aborted'));
        return;
      }
      var id = ++seq;
      var timer;
      function cleanup() {
        delete pending[id];
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abort);
      }
      function abort() {
        if (!pending[id]) return;
        cleanup();
        reject(bridgeError('aborted', 'Call aborted'));
      }
      pending[id] = { resolve: resolve, reject: reject, cleanup: cleanup };
      timer = setTimeout(function () {
        if (!pending[id]) return;
        cleanup();
        reject(bridgeError('timeout', 'Host call timed out: ' + method));
      }, timeoutMs);
      // Node-based developer harnesses must not be kept alive by unanswered mock messages.
      if (timer && timer.unref) timer.unref();
      try {
        if (signal) signal.addEventListener('abort', abort, { once: true });
        post({ awd: PROTOCOL, type: 'call', seq: id, method: method, params: params || {} });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  // ---- 事件通道（v2.7）------------------------------------------------------
  // on() 自动向宿主订阅（首个监听者时），退订函数在最后一个监听者移除时自动退订。
  // 老宿主对 events.subscribe 返回 unknown_method：静默吞掉——on 照常工作，只是永不触发，
  // 插件代码因此不需要为宿主版本写条件分支。
  var eventListeners = {};
  function syncSubscribe(method, name) {
    call(method, { events: [name] }).then(null, function () { /* 老宿主 unknown_method，静默 */ });
  }

  var awd = {
    /** SDK 版本，与桥协议版本无关 */
    version: '1.8.0',
    /** 握手拿到的上下文；ready() 之前为 null */
    context: null,
    /** 等待宿主握手，resolve 值即 awd.context */
    ready: function () { return readyPromise; },
    /** 原样调用任意 v1 方法，返回宿主的 result */
    call: call,
    files: {
      /** -> Array<{ path, name, size }> */
      list: function (options) {
        return call('files.list', {}, options).then(function (r) { return (r && r.files) || []; });
      },
      /** -> { path, content, truncated } */
      read: function (path, options) { return call('files.read', { path: path }, options); },
      prepareDrag: function (path, rect, options) { return call('files.prepareDrag', { path: path, rect: rect }, options); },
      endDrag: function (options) { return call('files.endDrag', {}, options); }
    },
    ui: {
      /** 打开本插件已声明的工作区；无工作区返回 unavailable，旧宿主返回 unknown_method。 */
      openWorkspace: function () { return call('ui.openWorkspace', {}); },
      toast: function (message, options) { return call('ui.toast', { message: message }, options); },
      /** 把项目文件打开到工作台中栏（需 file_read） */
      openFile: function (path, options) { return call('ui.openFile', { path: path }, options); },
      /**
       * 渲染或更新 AWD Plugin UI v3.0 长耗时任务安全进度卡片（.awd-safe-progress）。
       * target 可为选择器字符串或 DOM 元素；state 为 false/null 时清空。
       */
      progress: function (target, state) {
        var el = null;
        try {
          el = typeof target === 'string' && typeof document !== 'undefined' && document.querySelector
            ? document.querySelector(target)
            : target;
        } catch (e) { el = null; }
        function render(next) {
          if (!el || typeof document === 'undefined' || !document.createElement) return;
          while (el.firstChild) el.removeChild(el.firstChild);
          if (!next) {
            el.hidden = true;
            return;
          }
          el.hidden = false;
          var box = document.createElement('div');
          box.className = 'awd-safe-progress';
          box.setAttribute('role', 'status');
          box.setAttribute('aria-live', 'polite');

          var head = document.createElement('div');
          head.className = 'awd-safe-progress-head';
          var titleEl = document.createElement('span');
          titleEl.className = 'awd-safe-progress-title';
          titleEl.textContent = next.title || '正在处理任务…';
          head.appendChild(titleEl);

          var pctNum = typeof next.percent === 'number' && isFinite(next.percent)
            ? Math.max(0, Math.min(100, Math.round(next.percent)))
            : null;
          var pctEl = document.createElement('span');
          pctEl.className = 'awd-safe-progress-pct';
          pctEl.textContent = next.detail || (pctNum != null ? pctNum + '%' : '进行中');
          head.appendChild(pctEl);
          box.appendChild(head);

          var track = document.createElement('div');
          track.className = 'awd-safe-progress-track';
          var fill = document.createElement('div');
          fill.className = 'awd-safe-progress-fill';
          fill.style.width = (pctNum != null ? pctNum : 38) + '%';
          track.appendChild(fill);
          box.appendChild(track);

          var foot = document.createElement('div');
          foot.className = 'awd-safe-progress-foot';
          var noteEl = document.createElement('span');
          noteEl.textContent = next.safetyNote || '本地与已保存进度不受影响，可随时安全中止';
          foot.appendChild(noteEl);

          if (typeof next.onCancel === 'function') {
            var cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'awd-btn awd-btn-xs';
            cancelBtn.textContent = next.cancelText || '取消';
            cancelBtn.onclick = function () { next.onCancel(); };
            foot.appendChild(cancelBtn);
          }
          box.appendChild(foot);
          el.appendChild(box);
        }
        render(state);
        return {
          update: render,
          clear: function () { render(null); }
        };
      }
    },
    tools: {
      /** 直调本插件的 JAR 工具 -> 工具原始字符串输出（自行 JSON.parse） */
      invoke: function (name, args, options) {
        return call('tools.invoke', { name: name, args: args || {} }, options).then(function (r) {
          return r && r.output != null ? r.output : '';
        });
      }
    },
    chat: {
      /** 把 prompt 作为可见用户消息发进 AI 对话（起草类动作走这条，不直调工具） */
      send: function (prompt, options) { return call('chat.send', { prompt: prompt }, options); },
      addFile: function (path, options) { return call('chat.addFile', { path: path }, options); }
    },
    im: {
      request: function (action, params, options) { return call('im.request', { action: action, params: params || {} }, options); }
    },
    notifications: {
      publish: function (notification, options) { return call('notifications.publish', notification || {}, options); },
      resolve: function (eventKey, state, options) { return call('notifications.resolve', { eventKey: eventKey, state: state || 'done' }, options); }
    },
    lawfirm: {
      request: function (action, params, options) { return call('lawfirm.request', { action: action, params: params || {} }, options); }
    },
    storage: {
      /** -> 存过的值，没有则 null */
      get: function (key, options) {
        return call('storage.get', { key: key }, options).then(function (r) {
          return r && r.value !== undefined ? r.value : null;
        });
      },
      set: function (key, value, options) { return call('storage.set', { key: key, value: value }, options); }
    },
    services: {
      request: function (service, operation, params, options) {
        var opts = options || {};
        var alreadyAborted = opts.signal && opts.signal.aborted;
        var requestId = opts.requestId || ('awd-' + Date.now().toString(36) + '-' + (++seq) + '-' + Math.random().toString(36).slice(2));
        return call('services.request', { service: service, operation: operation, params: params || {}, requestId: requestId }, opts)
          .catch(function (error) {
            if ((error.code === 'aborted' || error.code === 'timeout') && !alreadyAborted) {
              // Cancellation is best effort; an old host may reject it. Never convert the original error to success.
              call('services.cancel', { requestId: requestId }).catch(function () {});
            }
            throw error;
          });
      },
      cancel: function (params, options) { return call('services.cancel', params || {}, options); }
    },
    mcp: {
      servers: function (options) { return call('mcp.servers', {}, options); },
      call: function (serverId, name, args, options) { return call('mcp.call', { serverId: serverId, name: name, arguments: args || {} }, options); }
    },
    connections: {
      list: function (options) { return call('connections.list', {}, options); },
      // Token entry and OAuth belong to trusted host UI. No credential argument or secret result.
      connect: function (id, options) { return call('connections.connect', { id: id }, options); },
      disconnect: function (id, options) { return call('connections.disconnect', { id: id }, options); },
      request: function (id, operation, params, options) { return call('connections.request', { id: id, operation: operation, params: params || {} }, options); }
    },
    billing: {
      status: function (connectionId, options) { return call('billing.status', { connectionId: connectionId }, options); },
      checkout: function (connectionId, options) { return call('billing.checkout', { connectionId: connectionId }, options); }
    },
    settings: {
      open: function (options) { return call('settings.open', {}, options); },
      update: function (values, options) {
        var opts = options || {};
        return call('settings.update', { values: values, scope: opts.scope, projectId: opts.projectId }, opts);
      },
      /**
       * 读 manifest.settings 声明的配置项 -> 字符串值（v2.9，宿主 0.28+）。
       * 与 storage 的区别：settings 是用户在插件广场详情页填写的配置（插件只读），
       * storage 是插件自己的 KV。secret 项拿不到；配置变更会推 settings.changed 事件。
       */
      get: function (key, options) {
        return call('settings.get', { key: key }, options).then(function (r) {
          return r && r.value != null ? r.value : '';
        });
      }
    },
    theme: {
      /** 当前主题：{ mode: 'light'|'dark', tokens: { '--awd-*': '...' } }。
       *  SDK 已自动把 data-theme/class/CSS 变量挂到本页，多数插件写 CSS 即可，
       *  不需要碰这个 API。 */
      get: function () { return { mode: themeState.mode, tokens: themeState.tokens }; },
      /** 主题切换回调 cb(mode, tokens)，返回退订函数。init 时已应用的主题不补发。 */
      onChange: function (cb) {
        if (typeof cb !== 'function') return function () {};
        themeListeners.push(cb);
        return function () {
          var i = themeListeners.indexOf(cb);
          if (i >= 0) themeListeners.splice(i, 1);
        };
      }
    },
    evidence: {
      /** -> { linkKey, targetIds } */
      link: function (params, options) { return call('evidence.link', params || {}, options); },
      /** -> { links: [...] } 原始 result，不解包 */
      list: function (params, options) { return call('evidence.list', params || {}, options); },
      /** -> {} */
      locate: function (params, options) { return call('evidence.locate', params || {}, options); }
    },
    doc: {
      /** 对当前聚焦文档执行编辑原语 -> 原语的原始返回对象（需 editor 权限） */
      exec: function (action, params, options) {
        return call('doc.exec', { action: action, params: params || {} }, options).then(function (r) {
          return r ? r.result : {};
        });
      },
      /** -> { fileId, kind }；没有打开的文档时 fileId 为 null（需 editor 权限） */
      active: function (options) { return call('doc.active', {}, options); },
      /** 糖衣：读全文 -> 原语原始返回（含段落数组，形状见宿主 get_document_text 文档） */
      getText: function (options) { return awd.doc.exec('get_document_text', {}, options); },
      /** 糖衣：读当前选区 */
      getSelection: function (options) { return awd.doc.exec('get_selection', {}, options); },
      /** 糖衣：查找文本出现位置 */
      find: function (text, options) { return awd.doc.exec('find_text_locations', { text: text }, options); },
      /** 糖衣：光标处插入文本（Writer 走修订，署名 AI WorkDeck） */
      insertText: function (text, options) { return awd.doc.exec('insert_at_cursor', { text: text }, options); },
      /** 糖衣：在恰好命中一次的锚点文字上加批注 */
      addComment: function (anchorText, text, options) {
        return awd.doc.exec('add_comment', { anchorText: anchorText, text: text }, options);
      }
    },
    events: {
      /**
       * 订阅宿主事件：files.changed / selection.changed / project.switched。
       * cb(data) 在宿主推送时触发；返回退订函数。自动向宿主 subscribe/unsubscribe，
       * 老宿主（无事件通道）上照常返回退订函数，只是永不触发。
       */
      on: function (name, cb) {
        if (typeof cb !== 'function' || !name) return function () {};
        var key = String(name);
        if (!eventListeners[key]) {
          eventListeners[key] = [];
          syncSubscribe('events.subscribe', key);
        }
        eventListeners[key].push(cb);
        return function () {
          var handlers = eventListeners[key];
          if (!handlers) return;
          var i = handlers.indexOf(cb);
          if (i >= 0) handlers.splice(i, 1);
          if (handlers.length === 0) {
            delete eventListeners[key];
            syncSubscribe('events.unsubscribe', key);
          }
        };
      }
    },
    ai: {
      /**
       * 面板内的一次性静默推理（需 ai 权限，走平台 Credits 的辅助模型）-> 输出文本。
       * opts 可带 { system, purpose }；要工具/落文档/让用户看见过程的场景用 awd.chat.send。
       */
      request: function (prompt, opts) {
        var p = opts || {};
        return call('ai.request', { prompt: prompt, system: p.system, purpose: p.purpose }, p)
          .then(function (r) { return r && r.text != null ? r.text : ''; });
      }
    }
  };

  global.awd = awd;
})(window);
