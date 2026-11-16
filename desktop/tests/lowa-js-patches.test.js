// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { stripEmbindLeakWarning } = require('../scripts/lowa-js-patches');

// The exact shape emitted by Embind with ASSERTIONS (copied from the shipped soffice.js).
const SAMPLE = 'attachFinalizer=handle=>{var $$=handle.$$;var hasSmartPtr=!!$$.smartPtr;if(hasSmartPtr){var info={$$:$$};var cls=$$.ptrType.registeredClass;var err=new Error(`Embind found a leaked C++ instance ${cls.name} <${ptrToString($$.ptr)}>.\\n`+"We\'ll free it automatically in this case, but this functionality is not reliable across various environments.\\n"+"Make sure to invoke .delete() manually once you\'re done with the instance instead.\\n"+"Originally allocated");if("captureStackTrace"in Error){Error.captureStackTrace(err,RegisteredPointer_fromWireType)}info.leakWarning=err.stack.replace(/^Error: /,"");finalizationRegistry.register(handle,info,handle)}return handle};';

test('strips the per-handle Error/stack capture and keeps the finalizer registration', () => {
  const { text, changed } = stripEmbindLeakWarning(SAMPLE);
  assert.equal(changed, true);
  assert.ok(!text.includes('new Error'));
  assert.ok(!text.includes('captureStackTrace'));
  assert.ok(text.includes('finalizationRegistry.register(handle,info,handle)'));
  assert.ok(text.includes('var info={$$:$$};'));
  assert.doesNotThrow(() => new vm.Script(text));
});

test('is idempotent and leaves non-ASSERTIONS builds untouched', () => {
  const once = stripEmbindLeakWarning(SAMPLE).text;
  assert.deepEqual(stripEmbindLeakWarning(once), { text: once, changed: false });
  const plain = 'attachFinalizer=handle=>{finalizationRegistry.register(handle,{$$:handle.$$},handle);return handle};';
  assert.deepEqual(stripEmbindLeakWarning(plain), { text: plain, changed: false });
});

test('the real cached LOWA soffice.js (when present) is patched and still parses', { skip: !fs.existsSync(path.join(os.homedir(), '.cache/awd-matrix/lowa/lowa/soffice.js')) }, () => {
  const src = fs.readFileSync(path.join(os.homedir(), '.cache/awd-matrix/lowa/lowa/soffice.js'), 'utf8');
  const { text, changed } = stripEmbindLeakWarning(src);
  assert.equal(changed, true);
  assert.equal((src.match(/Embind found a leaked C\+\+ instance/g) || []).length, 1, 'one occurrence expected');
  assert.ok(!text.includes('Embind found a leaked C++ instance'));
  assert.doesNotThrow(() => new vm.Script(text));
});
