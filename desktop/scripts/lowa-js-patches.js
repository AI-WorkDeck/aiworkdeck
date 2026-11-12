// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Post-download fixes to the LOWA JS glue (soffice.js). office-tier1 O8 (2026-11-12):
// the shipped soffice.js is an Embind ASSERTIONS build. Its attachFinalizer builds
// `new Error(...)` + captureStackTrace + `.stack` for EVERY smart-pointer handle
// marshalled to JS, only to print a "leaked C++ instance" console warning if the
// handle is garbage-collected without .delete(). Traced in the desktop app this was
// ~40% of the office worker's CPU; stripping it makes UNO round-trips 4-25x faster
// (get_ui_state 114 -> 28 ms, slide read 110 -> 16 ms, cell write 127 -> 17 ms).
// The finalizer registration itself is kept, so leaked handles are still freed.
// A non-ASSERTIONS rebuild of the engine removes the code at the source.
'use strict';

const LEAK_WARNING_RE =
  /var err=new Error\(`Embind found a leaked C\+\+ instance[\s\S]*?info\.leakWarning=err\.stack\.replace\(\/\^Error: \/,""\);/;

/** Returns { text, changed }. Idempotent: an already-stripped file is returned unchanged. */
function stripEmbindLeakWarning(text) {
  if (!LEAK_WARNING_RE.test(text)) return { text, changed: false };
  return { text: text.replace(LEAK_WARNING_RE, ''), changed: true };
}

module.exports = { stripEmbindLeakWarning, LEAK_WARNING_RE };
