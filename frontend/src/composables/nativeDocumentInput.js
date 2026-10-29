// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AWDDocumentInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEYS = { ArrowDown: 1024, ArrowUp: 1025, ArrowLeft: 1026, ArrowRight: 1027,
    Home: 1028, End: 1029, PageUp: 1030, PageDown: 1031, Enter: 1280, Escape: 1281,
    Tab: 1282, Backspace: 1283, Insert: 1285, Delete: 1286 };
  const modifiers = e => (e.shiftKey ? 0x1000 : 0) | (e.metaKey ? 0x2000 : 0)
    | (e.altKey ? 0x4000 : 0) | (e.ctrlKey ? 0x8000 : 0);
  const problem = (code, message) => Object.assign(new Error(message), { code });
  function rectangles(payload) {
    if (payload && typeof payload === 'object') payload = payload.rectangle ?? payload.rectangles;
    if (typeof payload !== 'string') return [];
    if (payload.trim().startsWith('{')) {
      try { return rectangles(JSON.parse(payload)); } catch { return []; }
    }
    if (!payload.trim() || payload === 'EMPTY') return [];
    return payload.split(';').map(item => item.split(',').map(Number))
      .filter(v => v.length === 4 && v.every(Number.isFinite) && v[2] >= 0 && v[3] > 0)
      .map(([x, y, width, height]) => ({ x, y, width, height }));
  }

  /** Chromium owns marked text; only final confirmed text enters the native model.
   * request resolves after native consumption, not merely after IPC delivery.
   * This component's synthetic tests do not verify a system IME candidate window.
   */
  function createDocumentInput({ canvas, request, viewport, onError = () => {},
    onState = () => {}, onChanged = () => {}, onEnsureVisible = () => {}, onSave = () => {},
    onCommitted = () => {}, onAssistanceKey = () => false, writeClipboard }) {
    if (!canvas?.parentElement || typeof request !== 'function' || typeof viewport !== 'function') {
      throw new TypeError('canvas, request and viewport are required');
    }
    const document = canvas.ownerDocument, window = document.defaultView, listeners = [];
    const make = (tag, styles, parent) => {
      const element = document.createElement(tag); Object.assign(element.style, styles);
      if (parent) parent.append(element); return element;
    };
    const layer = make('div', { position: 'absolute', pointerEvents: 'none', overflow: 'hidden', zIndex: '2' }, canvas.parentElement);
    layer.dataset.documentInputLayer = '';
    const selection = make('div', {}, layer);
    const caret = make('div', { position: 'absolute', width: '1px', background: 'var(--awd-text, #152d40)', display: 'none' }, layer);
    caret.dataset.documentCaret = '';
    const preview = make('span', { position: 'absolute', background: 'var(--awd-surface, white)', color: 'var(--awd-text, #152d40)',
      borderBottom: '1px solid var(--awd-text, #152d40)', fontFamily: 'var(--awd-font-sans, inherit)', whiteSpace: 'pre', visibility: 'hidden', display: 'none' }, layer);
    preview.dataset.documentPreedit = '';
    const input = make('input', { position: 'absolute', width: '2px', padding: '0', margin: '0', border: '0',
      opacity: '0', pointerEvents: 'none', background: 'transparent', outline: 'none' }, layer);
    input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off'); input.setAttribute('aria-label', '文档正文输入');
    input.disabled = true;

    let model = null, disposed = false, caretRect = null, selectionRects = [], cursorVisible = true;
    let composing = false, compositionCommitted = false, compositionCancelled = false, committedText = '', trailingCommit = null, trailingTimer = null;
    let requestedFocus = false, dragging = null, lastViewport = '', pressedKeys = new Map();
    let queue = Promise.resolve(), inputSeq = 0, lastAppliedSeq = 0, pending = 0, failure = null, suspended = false;
    let permissionPending = false, permissionEpoch = 0;
    const state = () => ({ documentEpoch: model?.documentEpoch, viewId: model?.viewId, composing,
      pending, inputSeq, lastAppliedSeq, failed: !!failure, error: failure, disposed, suspended,
      readOnly: model?.readOnly, permissionPending });
    const notify = () => onState(state());
    const active = () => {
      if (disposed || !model) throw problem('DOCUMENT_CLOSED', 'Document input is closed');
      if (failure) throw failure;
    };
    function fail(error, owner) {
      if (disposed || owner !== model || failure) return;
      failure = error instanceof Error ? error : new Error(String(error)); input.disabled = true;
      input.style.opacity = '0'; input.style.pointerEvents = 'none';
      notify(); onError(failure);
    }
    function enqueue(action, params = {}, isInput = false, changed = false) {
      try { active(); } catch (error) { return Promise.reject(error); }
      const owner = model, policy = permissionEpoch;
      // Keep a monotonic submission counter for copy/flush races. The native
      // sequence is allocated only when a queued input is actually sent.
      if (isInput) inputSeq++;
      const payload = { ...params, documentEpoch: owner.documentEpoch };
      pending++; notify(); if (changed) onChanged({ ...state(), action });
      const job = queue.then(async () => {
        if (owner !== model || disposed) throw problem('STALE_DOCUMENT', 'Input belongs to an old document');
        if (failure) throw failure;
        if (policy !== permissionEpoch && (isInput || action === 'command')) {
          return { applied: false, inputNotConsumed: true };
        }
        const seq = lastAppliedSeq + (isInput ? 1 : 0);
        if (isInput || action === 'input_barrier') payload.inputSeq = seq;
        let result;
        try { result = await request(action, payload); }
        catch (error) {
          // Only the host's explicit pre-dispatch refusal proves the native
          // sequence was not consumed. Unknown/network failures still latch.
          if (owner === model && error.inputNotConsumed === true
              && ['READ_ONLY', 'READ_ONLY_PENDING'].includes(error.code)) {
            if (policy === permissionEpoch) setReadOnly(true, { pending: error.code === 'READ_ONLY_PENDING' });
            return { applied: false, inputNotConsumed: true };
          }
          throw error;
        }
        if (owner !== model || disposed) throw problem('STALE_DOCUMENT', 'Input result belongs to an old document');
        if (isInput || action === 'input_barrier') {
          if (result?.applied !== true || result.documentEpoch !== owner.documentEpoch
            || result.viewId !== owner.viewId || result.lastInputSeq !== seq) {
            throw problem('INPUT_UNCONFIRMED', 'Native input acknowledgement is missing or belongs to another input');
          }
          lastAppliedSeq = seq;
        }
        return result;
      });
      queue = job.catch(error => { fail(error, owner); }).finally(() => {
        if (owner === model) { pending--; notify(); }
      });
      return job;
    }
    // Event handlers cannot await IPC, but the queue records the failure for flush().
    const send = promise => { promise.catch(() => {}); };
    function metrics() {
      const value = viewport();
      if (!value || !['xTwips', 'yTwips', 'widthTwips', 'heightTwips', 'cssWidth', 'cssHeight'].every(key => Number.isFinite(value[key]))
        || value.widthTwips <= 0 || value.heightTwips <= 0 || value.cssWidth <= 0 || value.cssHeight <= 0) {
        throw problem('INVALID_VIEWPORT', 'Document viewport dimensions are invalid');
      }
      return value;
    }
    function layout() {
      if (!model || disposed) return;
      const v = metrics(), canvasBox = canvas.getBoundingClientRect(), parentBox = canvas.parentElement.getBoundingClientRect();
      Object.assign(layer.style, { left: (canvasBox.left - parentBox.left) + 'px', top: (canvasBox.top - parentBox.top) + 'px',
        width: v.cssWidth + 'px', height: v.cssHeight + 'px' });
      const css = rect => ({ left: (rect.x - v.xTwips) * v.cssWidth / v.widthTwips,
        top: (rect.y - v.yTwips) * v.cssHeight / v.heightTwips,
        width: rect.width * v.cssWidth / v.widthTwips, height: rect.height * v.cssHeight / v.heightTwips });
      selection.replaceChildren();
      for (const rect of selectionRects) {
        const box = css(rect), node = make('div', { position: 'absolute', background: 'var(--awd-accent-soft, rgba(49,122,210,.25))', opacity: '.65',
          left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' }, selection);
        node.dataset.selectionRect = '';
      }
      if (!caretRect) { input.disabled = true; input.style.opacity = '0'; input.style.pointerEvents = 'none'; caret.style.display = 'none'; return; }
      const box = css(caretRect), visible = box.left >= 0 && box.left <= v.cssWidth && box.top >= 0 && box.top + box.height <= v.cssHeight;
      for (const node of [input, caret, preview]) Object.assign(node.style, { left: box.left + 'px', top: box.top + 'px', height: box.height + 'px' });
      input.style.fontSize = preview.style.fontSize = Math.max(10, box.height * 0.8) + 'px';
      preview.style.lineHeight = box.height + 'px';
      // Keep the browser's own marked-text selection and horizontal scrolling.
      // The hidden span measures only; a copied string cannot render an IME caret.
      const preedit = visible && !suspended && preview.style.display !== 'none' && composing && !compositionCancelled && !model.readOnly && !permissionPending && !failure;
      const preeditLeft = Math.max(0, Math.min(box.left, v.cssWidth - 40));
      Object.assign(input.style, {
        left: (preedit ? preeditLeft : box.left) + 'px',
        opacity: preedit ? '1' : '0', pointerEvents: preedit ? 'auto' : 'none',
        color: 'var(--awd-text, #152d40)', caretColor: 'var(--awd-text, #152d40)',
        background: preedit ? 'var(--awd-surface, white)' : 'transparent',
        width: preedit ? Math.max(2, Math.min(Math.max(40, preview.offsetWidth + 8), v.cssWidth - preeditLeft)) + 'px' : '2px',
        fontFamily: 'var(--awd-font-sans, inherit)',
      });
      input.disabled = suspended || permissionPending || !!failure;
      caret.style.display = cursorVisible && visible && !composing ? 'block' : 'none';
      if (requestedFocus && visible && !input.disabled && document.activeElement !== input) input.focus({ preventScroll: true });
    }
    function viewportChanged() {
      try {
        active(); layout();
        const v = metrics(), params = { xTwips: v.xTwips, yTwips: v.yTwips, widthTwips: v.widthTwips,
          heightTwips: v.heightTwips, cssWidth: v.cssWidth, cssHeight: v.cssHeight };
        const serialized = JSON.stringify(params);
        if (serialized === lastViewport) return queue.then(() => { active(); });
        lastViewport = serialized;
        return enqueue('set_viewport', params);
      } catch (error) { return Promise.reject(error); }
    }
    function echo(text) {
      window.clearTimeout(trailingTimer); trailingCommit = text || null;
      trailingTimer = trailingCommit ? window.setTimeout(() => { trailingCommit = null; }, 0) : null;
    }
    function showPreview(text) {
      preview.textContent = text; preview.style.display = text ? 'block' : 'none';
      layout();
    }
    function commit(text) {
      if (!composing) input.value = '';
      if (!text || !model || model.readOnly || !caretRect || disposed || failure || suspended || permissionPending) return;
      const owner = model, policy = permissionEpoch;
      send(enqueue('input_text', { text }, true, true).then(result => {
        if (result.applied && owner === model && policy === permissionEpoch) onCommitted(text);
        return result;
      }));
    }
    function listen(target, type, callback, options) {
      target.addEventListener(type, callback, options); listeners.push(() => target.removeEventListener(type, callback, options));
    }
    listen(input, 'compositionstart', () => {
      if (failure || disposed || !caretRect || suspended || permissionPending || model?.readOnly) return;
      composing = true; compositionCommitted = false; compositionCancelled = false; committedText = ''; echo(null); notify();
    });
    listen(input, 'compositionupdate', event => { if (composing && !compositionCommitted) showPreview(event.data || ''); });
    listen(input, 'compositionend', event => {
      if (!composing) return; // A late end from a destroyed document cannot type into its replacement.
      composing = false; showPreview('');
      const text = event.data || '', suffix = compositionCommitted && text.startsWith(committedText) ? text.slice(committedText.length) : text;
      if (!compositionCancelled && (!compositionCommitted || suffix)) commit(suffix);
      compositionCommitted = false; compositionCancelled = false; committedText = ''; input.value = ''; echo(text); layout(); notify();
    });
    listen(input, 'input', event => {
      if (!caretRect || failure || disposed || suspended || permissionPending || model?.readOnly) { input.value = ''; return; }
      const text = event.data != null ? event.data : input.value, inserts = !event.inputType || /^insert/.test(event.inputType);
      if (composing) {
        if (compositionCancelled) { input.value = ''; return; }
        if (compositionCommitted || !inserts || !text || (event.isComposing !== false && event.inputType !== 'insertFromComposition')) {
          showPreview(compositionCommitted ? '' : input.value); return;
        }
        compositionCommitted = true; committedText = text; showPreview(''); commit(text); return;
      }
      if (!inserts) { input.value = ''; return; }
      if (trailingCommit !== null) {
        const duplicate = text === trailingCommit; echo(null);
        if (duplicate) { input.value = ''; return; }
      }
      commit(text);
    });
    listen(input, 'paste', event => {
      event.preventDefault();
      if (composing) return;
      const text = event.clipboardData?.getData('text/plain'); if (text) { echo(null); commit(text); }
    });
    listen(input, 'keydown', event => {
      if(suspended||permissionPending){event.preventDefault();return;}
      if(model?.readOnly){
        const mods=modifiers(event),code=KEYS[event.key];
        const navigation=code>=1024&&code<=1031&&(mods&~0x1000)===0;
        const selectOrCopy=/^[ac]$/i.test(event.key)&&(mods===0x2000||mods===0x8000);
        if(!navigation&&!selectOrCopy){event.preventDefault();return;}
      }
      if (composing || event.isComposing || event.keyCode === 229) return;
      if (onAssistanceKey(event)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      echo(null);
      if ((event.metaKey || event.ctrlKey) && !event.altKey && /^[zy]$/i.test(event.key)) {
        event.preventDefault();
        const kind = event.key.toLowerCase() === 'y' || event.shiftKey ? 'Redo' : 'Undo';
        // Keep this in the same queue as native input. Commands do not consume
        // an input sequence number; the next input/barrier continues that stream.
        // Never send the raw native shortcut, which bypasses the margin guard.
        send(enqueue('command', { command: '.uno:' + kind, arguments: '{}' }).then(result => {
          if (result.applied) onChanged({ ...state(), action: 'command' });
        }));
        return;
      }
      // Browser paste owns the text. Copy/cut need the native selected text and
      // are handled by the host clipboard adapter, never this empty input buffer.
      if ((event.metaKey || event.ctrlKey) && /^[v]$/i.test(event.key)) return;
      if ((event.metaKey || event.ctrlKey) && /^[cxsopqw]$/i.test(event.key)) {
        event.preventDefault();
        const key=event.key.toLowerCase();
        if(key==='s') { Promise.resolve(onSave()).catch(onError); return; }
        if((key==='c'||key==='x')&&typeof writeClipboard==='function') {
          const owner=model;
          send((async()=>{
            await flush();const seq=inputSeq;
            const result=await enqueue('selection_text');
            if(owner!==model||seq!==inputSeq||composing)throw problem('SELECTION_CHANGED','Selection changed while copying');
            if(!result.text)return; // An empty native selection must not turn Cut into forward Delete.
            await writeClipboard(result.text);
            if(key==='x') {
              if(owner!==model||seq!==inputSeq||composing)throw problem('SELECTION_CHANGED','Selection changed while cutting');
              await enqueue('input_key',{eventType:0,charCode:0,keyCode:KEYS.Delete},true,true);
              await enqueue('input_key',{eventType:1,charCode:0,keyCode:KEYS.Delete},true);
            }
          })().catch(onError));
        }
        return;
      }
      let code = KEYS[event.key];
      if (code === undefined && (event.metaKey || event.ctrlKey) && /^[a-z]$/i.test(event.key)) code = 512 + event.key.toUpperCase().charCodeAt(0) - 65;
      if (code === undefined) return; // Printable text arrives once through input.
      event.preventDefault();
      const keyCode = code | modifiers(event), id = event.code || event.key;
      pressedKeys.set(id, keyCode);
      send(enqueue('input_key', { eventType: 0, charCode: 0, keyCode }, true, !model?.readOnly && !/^Arrow|^(Home|End|PageUp|PageDown|Escape)$/.test(event.key)));
    });
    listen(input, 'keyup', event => {
      const id = event.code || event.key, keyCode = pressedKeys.get(id);
      if (keyCode === undefined) return;
      pressedKeys.delete(id); event.preventDefault(); send(enqueue('input_key', { eventType: 1, charCode: 0, keyCode }, true));
    });
    function mouseParams(event, eventType, buttons) {
      const v = metrics(), box = canvas.getBoundingClientRect();
      return { eventType, xTwips: Math.max(0, Math.round(v.xTwips + (event.clientX - box.left) * v.widthTwips / v.cssWidth)),
        yTwips: Math.max(0, Math.round(v.yTwips + (event.clientY - box.top) * v.heightTwips / v.cssHeight)),
        clickCount: Math.max(1, event.detail || dragging?.clickCount || 1), buttons, modifier: modifiers(event) };
    }
    listen(canvas, 'mousedown', event => {
      event.preventDefault();
      if (composing || failure || disposed || !model || suspended || permissionPending) return;
      if(model.readOnly&&event.button!==0)return;
      const buttons = event.button === 0 ? 1 : event.button === 2 ? 2 : 4;
      requestedFocus = true; dragging = { ...mouseParams(event, 0, buttons), buttons };
      send(viewportChanged()); send(enqueue('input_mouse', dragging, true)); layout();
    });
    listen(window, 'mousemove', event => {
      if (!dragging || disposed || failure || permissionPending) return;
      event.preventDefault(); const params = mouseParams(event, 2, dragging.buttons); dragging = { ...params };
      send(enqueue('input_mouse', params, true));
    });
    function releaseMouse(event) {
      if (!dragging) return;
      const params = event ? mouseParams(event, 1, dragging.buttons) : { ...dragging, eventType: 1 };
      dragging = null; send(enqueue('input_mouse', params, true));
    }
    listen(window, 'mouseup', releaseMouse);
    const releaseKeys = () => {
      for (const keyCode of pressedKeys.values()) send(enqueue('input_key', { eventType: 1, charCode: 0, keyCode }, true));
      pressedKeys.clear();
    };
    listen(input, 'blur', () => {
      // Disabling an active input for a command blurs it in Chromium. Keep the
      // user's focus request until resume, unless another control takes focus.
      if (!suspended) requestedFocus = false;
      releaseKeys();
    });
    listen(document, 'focusin', event => {
      if (event.target !== input && event.target !== document.body && event.target !== document.documentElement) requestedFocus = false;
    });
    listen(window, 'blur', () => { releaseMouse(); releaseKeys(); });

    function handleCallback(event) {
      if (disposed || !model || event.documentEpoch !== model.documentEpoch || event.viewId !== model.viewId) return false;
      if (event.callbackType === 1) {
        // New LOK callbacks can embed viewId as well as the outer envelope.
        let payload = event.payload;
        if (typeof payload === 'string' && payload.trim().startsWith('{')) {
          try { payload = JSON.parse(payload); } catch { return false; }
        }
        if (payload && typeof payload === 'object' && payload.viewId !== undefined && Number(payload.viewId) !== model.viewId) return false;
        const rect = rectangles(payload)[0]; if (!rect) return false;
        caretRect = rect; layout();
        if (requestedFocus && !dragging) onEnsureVisible({ ...rect });
      } else if (event.callbackType === 2) { selectionRects = rectangles(event.payload); layout(); }
      else if (event.callbackType === 5) { cursorVisible = event.payload === true || event.payload === 'true'; layout(); }
      else return false;
      return true;
    }
    function setDocument(next) {
      if (disposed) throw problem('DOCUMENT_CLOSED', 'Document input is closed');
      if (composing) throw problem('COMPOSITION_ACTIVE', 'Finish or cancel composition before changing document');
      if (!Number.isInteger(next?.documentEpoch) || !Number.isInteger(next?.viewId)) throw new TypeError('Document epoch and viewId are required');
      model = { documentEpoch: next.documentEpoch, viewId: next.viewId, readOnly: next.readOnly===true };
      permissionPending = false; permissionEpoch++;
      input.readOnly=model.readOnly;
      caretRect = null; selectionRects = []; cursorVisible = true; requestedFocus = false; dragging = null; pressedKeys.clear();
      queue = Promise.resolve(); inputSeq = lastAppliedSeq = pending = 0; failure = null; suspended = false; lastViewport = '';
      compositionCommitted = false; compositionCancelled = false; committedText = ''; echo(null); input.value = ''; showPreview(''); layout(); notify();
    }
    function setReadOnly(readOnly, { pending: waiting = false } = {}) {
      active();
      if (typeof readOnly !== 'boolean' || typeof waiting !== 'boolean') throw new TypeError('Read-only state must be boolean');
      if (waiting || model.readOnly !== readOnly) permissionEpoch++;
      if ((readOnly || waiting) && composing) compositionCancelled = true;
      model.readOnly = readOnly; permissionPending = waiting; input.readOnly = readOnly;
      if (readOnly || waiting) { releaseMouse(); releaseKeys(); }
      layout(); notify();
    }
    async function flush() {
      active();
      do {
        if (composing) throw problem('COMPOSITION_ACTIVE', 'Finish or cancel composition before saving');
        await queue; active();
        if (composing) throw problem('COMPOSITION_ACTIVE', 'Finish or cancel composition before saving');
        const cutoff = inputSeq;
        await enqueue('input_barrier'); active();
        if (composing) throw problem('COMPOSITION_ACTIVE', 'Finish or cancel composition before saving');
        if (inputSeq === cutoff) return { documentEpoch: model.documentEpoch, viewId: model.viewId, lastInputSeq: lastAppliedSeq };
      } while (true);
    }
    function dispose() {
      if (disposed) return;
      disposed = true; model = null; window.clearTimeout(trailingTimer);
      for (const remove of listeners) remove(); layer.remove(); notify();
    }
    return { get element() { return input; }, setDocument, setReadOnly, handleCallback, viewportChanged, flush,
      async suspend(){active();if(composing)throw problem('COMPOSITION_ACTIVE','Finish or cancel composition before leaving');releaseMouse();releaseKeys();suspended=true;input.disabled=true;notify();await flush();},
      resume(){active();suspended=false;input.disabled=!caretRect;layout();notify();}, getState: state, dispose,
      focus() { active(); requestedFocus = true; layout(); } };
  }
  return { createDocumentInput };
});
