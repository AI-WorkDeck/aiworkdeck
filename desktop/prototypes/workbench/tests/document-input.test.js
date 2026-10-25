// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('../../../../frontend/node_modules/jsdom');
const { createDocumentInput } = require('../document-input.js');

function harness(request, options={}) {
  const dom = new JSDOM('<div style="position:relative"><canvas></canvas></div>', { pretendToBeVisual: true });
  const { window } = dom, canvas = window.document.querySelector('canvas'), calls = [], errors = [];
  let viewport = { xTwips: 100, yTwips: 200, widthTwips: 1000, heightTwips: 800, cssWidth: 500, cssHeight: 400 };
  canvas.getBoundingClientRect = () => ({ left: 150, top: 90, width: 500, height: 400 });
  canvas.parentElement.getBoundingClientRect = () => ({ left: 140, top: 60 });
  const component = createDocumentInput({ canvas, viewport: () => viewport, onError: e => errors.push(e), ...options,
    request: async (action, params) => {
      calls.push({ action, ...params });
      if (request) return request(action, params);
      return { applied: true, lastInputSeq: params.inputSeq, documentEpoch: params.documentEpoch, viewId: 2 };
    } });
  component.setDocument({ documentEpoch: 1, viewId: 2, readOnly: options.readOnly===true });
  const callback = (callbackType, payload, extra = {}) => component.handleCallback({ type: 'callback', callbackType, payload, documentEpoch: 1, viewId: 2, ...extra });
  callback(1, '120, 240, 0, 40'); component.focus();
  const input = canvas.parentElement.querySelector('input');
  const composition = (type, data = '') => input.dispatchEvent(new window.CompositionEvent(type, { data, bubbles: true }));
  const text = (data, inputType = 'insertText', isComposing = false) => {
    input.value = data || '';
    input.dispatchEvent(new window.InputEvent('input', { data, inputType, isComposing, bubbles: true }));
  };
  const key = (key, options = {}) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }); input.dispatchEvent(event); return event;
  };
  const mouse = (target, type, options = {}) => target.dispatchEvent(new window.MouseEvent(type, { clientX: 200, clientY: 190, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: true, cancelable: true, ...options }));
  return { dom, window, canvas, input, component, calls, errors, callback, composition, text, key, mouse,
    setViewport(value) { viewport = { ...viewport, ...value }; }, close() { component.dispose(); dom.window.close(); } };
}
const texts = h => h.calls.filter(c => c.action === 'input_text').map(c => c.text);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('temporary command suspension restores a requested focus after Chromium blurs disabled input', async () => {
  const h = harness();
  try {
    assert.equal(h.window.document.activeElement, h.input);
    await h.component.suspend();
    // Chromium moves focus to body when disabling an active input. jsdom needs
    // the equivalent focus event explicitly; full-app acceptance covers Chromium.
    h.input.dispatchEvent(new h.window.FocusEvent('blur'));
    h.window.document.body.tabIndex = -1; h.window.document.body.focus();
    h.component.resume();
    assert.equal(h.window.document.activeElement, h.input);
  } finally { h.close(); }
});
test('command completion does not steal focus from another editor control', async () => {
  const h = harness();
  try {
    await h.component.suspend();
    const field = h.window.document.createElement('input'); h.window.document.body.append(field); field.focus();
    h.component.resume();
    assert.equal(h.window.document.activeElement, field);
  } finally { h.close(); }
});

test('read-only input keeps selection and copy but never submits edits, shortcuts or composition',async()=>{
 let saved=0,copied='',changed=0;
 const h=harness(async(action,p)=>action==='selection_text'?{text:'可复制选区'}:{applied:true,lastInputSeq:p.inputSeq,documentEpoch:p.documentEpoch,viewId:2},
  {readOnly:true,onSave:()=>saved++,onChanged:()=>changed++,writeClipboard:async text=>{copied=text}});
 try{
  assert.equal(h.input.readOnly,true);
  h.text('不可写');h.composition('compositionstart');h.composition('compositionend','不可写中文');
  for(const key of ['x','v','z','y','b','s'])h.key(key,{metaKey:true});
  h.key('Backspace');h.key('Delete');h.key('Enter');
  h.key('ArrowRight',{shiftKey:true});h.key('a',{metaKey:true});
  h.mouse(h.canvas,'mousedown');h.mouse(h.window,'mouseup');
  h.key('c',{metaKey:true});await tick();await tick();await h.component.flush();
  assert.equal(h.component.getState().composing,false);assert.deepEqual(texts(h),[]);
  assert.equal(saved,0);assert.equal(changed,0);assert.equal(copied,'可复制选区');
  assert.equal(h.calls.filter(c=>c.action==='command').length,0);
  assert.deepEqual(h.calls.filter(c=>c.action==='input_key').map(c=>c.keyCode),[1027|0x1000,512|0x2000]);
  assert.equal(h.errors.length,0);
 }finally{h.close()}
});

test('preedit updates do not change model; confirmation + echoed input is exactly once', async () => {
  const h = harness();
  h.composition('compositionstart'); h.composition('compositionupdate', 'zhong'); h.text('zhong', 'insertCompositionText', true);
  assert.deepEqual(texts(h), []); assert.match(h.canvas.parentElement.textContent, /zhong/);
  await assert.rejects(h.component.flush(), /composition/i);
  h.composition('compositionupdate', '中文'); h.composition('compositionend', '中文'); h.text('中文', 'insertFromComposition');
  await h.component.flush(); assert.deepEqual(texts(h), ['中文']); assert.equal(h.component.getState().lastAppliedSeq, 1); h.close();
});
for (const inputType of ['insertText', 'insertFromComposition']) test(`early ${inputType} keeps browser composition open and only adds later suffix`, async () => {
  const h = harness(); h.composition('compositionstart'); h.text('中文', inputType);
  assert.equal(h.component.getState().composing, true); assert.equal(h.input.value, '中文');
  assert.equal(h.key('Enter', { isComposing: true, keyCode: 229 }).defaultPrevented, false);
  h.composition('compositionend', '中文🙂'); h.text('中文🙂'); await h.component.flush();
  assert.deepEqual(texts(h), ['中文', '🙂']); assert.equal(h.calls.filter(c => c.action === 'input_key').length, 0); h.close();
});
test('cancel and deletion never commit raw pinyin; later punctuation and same-character typing survive', async () => {
  const h = harness(); h.composition('compositionstart'); h.text('pinyin', 'insertCompositionText', true);
  h.text('piny', 'deleteCompositionText', true); h.composition('compositionend', ''); h.text('，');
  h.composition('compositionstart'); h.composition('compositionend', '字'); h.key('字'); h.text('字');
  h.text('residue', 'deleteContentBackward'); await h.component.flush(); assert.deepEqual(texts(h), ['，', '字', '字']); h.close();
});
test('empty end followed by final input commits the final text, not preedit', async () => {
  const h = harness(); h.composition('compositionstart'); h.text('han', 'insertCompositionText', true);
  h.composition('compositionend', ''); h.text('汉', 'insertFromComposition'); await h.component.flush(); assert.deepEqual(texts(h), ['汉']); h.close();
});
test('caret and selected rectangles use real twips/CSS geometry and reject other generations/views', async () => {
  const h = harness(), layer = h.canvas.parentElement.querySelector('[data-document-input-layer]');
  assert.equal(layer.style.left, '10px'); assert.equal(layer.style.top, '30px');
  assert.equal(h.input.style.left, '10px'); assert.equal(h.input.style.top, '20px'); assert.equal(h.input.style.height, '20px');
  h.callback(2, '120, 240, 100, 40; 120, 280, 200, 40');
  assert.equal(layer.querySelectorAll('[data-selection-rect]').length, 2);
  h.callback(1, '999,999,0,40', { documentEpoch: 0 }); h.callback(1, '999,999,0,40', { viewId: 3 });
  assert.equal(h.input.style.top, '20px');
  h.setViewport({ yTwips: 220 }); await h.component.viewportChanged(); assert.equal(h.input.style.top, '10px');
  h.callback(2, ''); assert.equal(layer.querySelectorAll('[data-selection-rect]').length, 0); h.close();
});
test('JSON caret callback is parsed; no old caret or input survives a document switch', async () => {
  const h = harness(); h.callback(1, JSON.stringify({ viewId: 2, rectangle: '140, 260, 0, 20' }));
  assert.equal(h.input.style.left, '20px');
  h.component.setDocument({ documentEpoch: 2, viewId: 3 }); assert.equal(h.input.disabled, true);
  h.text('late'); await tick(); assert.deepEqual(texts(h), []); h.close();
});
test('mouse points invert canvas geometry; dragging outside canvas releases and viewport is ordered first', async () => {
  const h = harness(); h.mouse(h.canvas, 'mousedown'); h.mouse(h.window, 'mousemove', { clientX: 750, clientY: 550 }); h.mouse(h.window, 'mouseup');
  await h.component.flush(); const events = h.calls.filter(c => c.action === 'input_mouse');
  assert.deepEqual(events.map(c => c.eventType), [0, 2, 1]);
  assert.deepEqual([events[0].xTwips, events[0].yTwips, events[0].buttons], [200, 400, 1]);
  assert.equal(h.calls[0].action, 'set_viewport'); assert.equal(events[2].buttons, 1); h.close();
});
test('composition candidate mouse/key actions do not reposition native caret', async () => {
  const h = harness(); h.composition('compositionstart'); h.mouse(h.canvas, 'mousedown'); h.key('ArrowDown');
  h.composition('compositionend', ''); await h.component.flush(); assert.equal(h.calls.some(c => c.action === 'input_mouse' || c.action === 'input_key'), false); h.close();
});
test('navigation uses VCL codes; text does not also become native key input', async () => {
  const h = harness(); h.key('a'); h.text('a'); h.key('ArrowLeft', { shiftKey: true });
  h.input.dispatchEvent(new h.window.KeyboardEvent('keyup', { key: 'ArrowLeft', shiftKey: true }));
  await h.component.flush(); assert.deepEqual(texts(h), ['a']);
  const keys = h.calls.filter(c => c.action === 'input_key'); assert.deepEqual(keys.map(c => [c.eventType, c.keyCode, c.charCode]), [[0, 1026 | 0x1000, 0], [1, 1026 | 0x1000, 0]]); h.close();
});
test('paste inserts plain text once and never falls through to the transparent input buffer', async () => {
  const h = harness(), event = new h.window.Event('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: type => type === 'text/plain' ? '粘贴\n文本' : '' } });
  h.input.dispatchEvent(event); await h.component.flush(); assert.equal(event.defaultPrevented, true); assert.deepEqual(texts(h), ['粘贴\n文本']); h.close();
});
test('save waits for in-flight text and validates the native barrier', async () => {
  let release;
  const h = harness((action, params) => action === 'input_text' ? new Promise(resolve => { release = () => resolve({ applied: true, documentEpoch: 1, viewId: 2, lastInputSeq: params.inputSeq }); }) : { applied: true, documentEpoch: 1, viewId: 2, lastInputSeq: params.inputSeq });
  h.text('保存'); let done = false; const flush = h.component.flush().then(() => { done = true; });
  await tick(); assert.equal(done, false); assert.equal(h.calls.some(c => c.action === 'input_barrier'), false);
  release(); await flush; assert.equal(done, true); assert.equal(h.calls.at(-1).action, 'input_barrier'); h.close();
});
for (const failure of ['rejection', 'wrong-sequence', 'stale-epoch']) test(`uncertain ${failure} blocks save and further inputs without retry`, async () => {
  const h = harness((action, params) => {
    if (action === 'input_text' && failure === 'rejection') throw Error('transport lost');
    return { applied: true, documentEpoch: failure === 'stale-epoch' && action === 'input_text' ? 0 : 1, viewId: 2, lastInputSeq: failure === 'wrong-sequence' ? 0 : params.inputSeq };
  });
  h.text('保留'); await assert.rejects(h.component.flush()); h.text('不重发'); await tick();
  assert.equal(texts(h).length, 1); assert.equal(h.component.getState().failed, true); assert.equal(h.errors.length, 1); h.close();
});
test('disposed and replaced document ignore late results/callbacks and never send queued old inputs', async () => {
  let release;
  const h = harness((action, params) => action === 'input_text' ? new Promise(resolve => { release = () => resolve({ applied: true, documentEpoch: 1, viewId: 2, lastInputSeq: params.inputSeq }); }) : { applied: true, documentEpoch: params.documentEpoch, viewId: 2, lastInputSeq: params.inputSeq });
  h.text('一'); h.text('二'); await tick(); h.component.setDocument({ documentEpoch: 2, viewId: 3 }); release(); await tick();
  assert.deepEqual(texts(h), ['一']); assert.equal(h.component.getState().failed, false); assert.equal(h.component.getState().lastAppliedSeq, 0);
  h.callback(1, '120,240,0,40'); assert.equal(h.input.disabled, true); h.close();
});
test('same viewport is deduplicated and malformed callbacks cannot move caret', async () => {
  const h = harness(); await h.component.viewportChanged(); await h.component.viewportChanged();
  assert.equal(h.calls.filter(c => c.action === 'set_viewport').length, 1);
  h.callback(1, 'NaN,2,0,4'); h.callback(1, '{oops'); assert.equal(h.input.style.left, '10px'); h.close();
});


test('Cmd-S uses host save and native file-open/quit shortcuts never reach the document', async()=>{
 let saved=0;const h=harness(null,{onSave:()=>{saved++}});
 for(const key of ['s','o','p','q','w'])assert.equal(h.key(key,{metaKey:true}).defaultPrevented,true);
 await tick();await h.component.flush();assert.equal(saved,1);assert.equal(h.calls.filter(c=>c.action==='input_key').length,0);h.close();
});
test('cut obtains real selection and writes clipboard before deleting it', async()=>{
 const order=[];const h=harness(async(action,p)=>{
  if(action==='selection_text')return {text:'真实选区'};
  order.push(action);return {applied:true,lastInputSeq:p.inputSeq,documentEpoch:p.documentEpoch,viewId:2};
 },{writeClipboard:async text=>{assert.equal(text,'真实选区');order.push('clipboard')}});
 h.key('x',{metaKey:true});await tick();await tick();await h.component.flush();
 assert.ok(order.indexOf('clipboard')<order.indexOf('input_key'));assert.equal(h.calls.filter(c=>c.action==='input_key').length,2);h.close();
});
test('clipboard failure never cuts the document',async()=>{
 const h=harness(async(action,p)=>action==='selection_text'?{text:'保留选区'}:{applied:true,lastInputSeq:p.inputSeq,documentEpoch:p.documentEpoch,viewId:2},{writeClipboard:async()=>{throw Error('clipboard failed')}});
 h.key('x',{metaKey:true});await tick();await tick();await h.component.flush();assert.equal(h.calls.filter(c=>c.action==='input_key').length,0);h.close();
});
test('cut with no native text preserves the document and clipboard',async()=>{
 let writes=0;
 const h=harness(async(action,p)=>action==='selection_text'?{text:''}:{applied:true,lastInputSeq:p.inputSeq,documentEpoch:p.documentEpoch,viewId:2},{writeClipboard:async()=>{writes++}});
 h.key('x',{metaKey:true});await tick();await tick();await h.component.flush();
 assert.equal(writes,0);assert.equal(h.calls.filter(c=>c.action==='input_key').length,0);h.close();
});

test('leaving freezes inputs after draining pending commits and cursor callbacks cannot reenable them',async()=>{
 const h=harness();h.text('先保存');await h.component.suspend();h.callback(1,'121,240,0,40');assert.equal(h.input.disabled,true);h.text('不应提交');await h.component.flush();assert.deepEqual(texts(h),['先保存']);h.component.resume();h.text('继续');await h.component.flush();assert.deepEqual(texts(h),['先保存','继续']);h.close();
});
test('leaving during composition refuses to discard the marked text',async()=>{
 const h=harness();h.composition('compositionstart');h.text('ni', 'insertCompositionText',true);await assert.rejects(h.component.suspend(),/composition/i);assert.equal(h.component.getState().composing,true);h.composition('compositionend','你');await h.component.flush();assert.deepEqual(texts(h),['你']);h.close();
});

test('undo and redo shortcuts use the guarded host command, never raw native keys',async()=>{
 const h=harness();
 for(const [key,options] of [['z',{metaKey:true}],['z',{metaKey:true,shiftKey:true}],['z',{ctrlKey:true}],['y',{ctrlKey:true}]]){
  assert.equal(h.key(key,options).defaultPrevented,true);
  h.input.dispatchEvent(new h.window.KeyboardEvent('keyup',{key,...options}));
 }
 await h.component.flush();
 assert.deepEqual(h.calls.filter(c=>c.action==='command').map(c=>c.command),['.uno:Undo','.uno:Redo','.uno:Undo','.uno:Redo']);
 assert.equal(h.calls.filter(c=>c.action==='input_key').length,0);
 assert.equal(h.component.getState().inputSeq,0);h.close();
});

test('confirmed text, undo, later text and save barrier stay ordered without an input sequence gap',async()=>{
 let release;
 const h=harness((action,p)=>action==='input_text'&&p.text==='先输入'
  ?new Promise(resolve=>{release=()=>resolve({applied:true,lastInputSeq:p.inputSeq,documentEpoch:p.documentEpoch,viewId:2})})
  :{applied:true,lastInputSeq:p.inputSeq,documentEpoch:p.documentEpoch,viewId:2});
 h.text('先输入');h.key('z',{metaKey:true});h.text('继续');
 const flushed=h.component.flush();await tick();
 assert.equal(h.calls.some(c=>c.action==='command'),false);release();await flushed;
 assert.deepEqual(h.calls.map(c=>[c.action,c.inputSeq]),[['input_text',1],['command',undefined],['input_text',2],['input_barrier',2]]);
 assert.equal(h.component.getState().lastAppliedSeq,2);h.close();
});

test('undo during composition stays with the input method and sends no document command',async()=>{
 const h=harness();h.composition('compositionstart');
 assert.equal(h.key('z',{metaKey:true}).defaultPrevented,false);
 assert.equal(h.key('y',{ctrlKey:true,isComposing:true,keyCode:229}).defaultPrevented,false);
 h.composition('compositionend','');await h.component.flush();
 assert.equal(h.calls.some(c=>c.action==='command'||c.action==='input_key'),false);h.close();
});

test('failed guarded undo blocks later queued text and saving instead of repeating the shortcut',async()=>{
 const h=harness(async(action,p)=>{
  if(action==='command')throw Error('unsafe undo');
  return {applied:true,lastInputSeq:p.inputSeq,documentEpoch:p.documentEpoch,viewId:2};
 });
 h.key('z',{metaKey:true});h.text('不得落字');await assert.rejects(h.component.flush(),/unsafe undo/);
 assert.equal(h.calls.filter(c=>c.action==='command').length,1);assert.deepEqual(texts(h),[]);
 assert.equal(h.component.getState().failed,true);h.close();
});
