// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Track the lineage of verified inline resolutions through both native stacks.
// Titles alone are not identities: ordinary edits explicitly reconcile the
// retained prefix and discard the actual redo branch. Unknown changes stop undo.
function createReviewUndo({ view, undoState, undoStep }) {
  let stacks = null, unsafe = null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const titles = entries => entries.map(entry => entry.title);
  const unknown = list => list.map(title => ({ title, inline: false }));
  const hasInline = () => stacks && [...stacks.undo, ...stacks.redo].some(entry => entry.inline);
  const assertSafe = () => { if (unsafe) throw unsafe; };
  const failUnsafe = error => {
    unsafe = Error('原生审阅操作未能核验，保留当前文档并停止写入：' + error.message);
    return unsafe;
  };
  async function state() {
    const current = await view();
    if (!['all', 'final', 'balloons', 'margin'].includes(current.mode)) throw Error('审阅显示状态不可读');
    return current;
  }
  function observe(native) {
    for (const kind of ['undo', 'redo']) {
      const item = native[kind];
      if (!Array.isArray(item?.titles) || item.depth !== item.titles.length
          || item.title !== (item.titles[0] || '') || !item.titles.every(title => typeof title === 'string'))
        throw failUnsafe(Error('撤销栈不可读'));
    }
    if (!hasInline()) stacks = { undo: unknown(native.undo.titles), redo: unknown(native.redo.titles) };
    else if (!same(titles(stacks.undo), native.undo.titles) || !same(titles(stacks.redo), native.redo.titles))
      throw failUnsafe(Error('撤销栈发生未跟踪的变化'));
    return native;
  }
  async function inline(before, run) {
    try {
      await view({ mode: 'all', internal: true, refresh: true });
      return await run();
    } finally {
      try { await view({ mode: before.mode, internal: true, refresh: true }); }
      catch (error) { throw failUnsafe(error); }
    }
  }
  // A controlled mutation can append actions, or coalesce the previous ordinary
  // top action. Never infer that a same-title replacement is an old resolution.
  function edited(after, resolution) {
    const next = after.undo.titles, old = titles(stacks.undo);
    const added = next.length - old.length;
    if (after.redo.depth !== 0) {
      if (!resolution && same(next, old) && same(after.redo.titles, titles(stacks.redo))) {
        if (stacks.undo[0]?.inline) throw failUnsafe(Error('无法区分未生效输入与已替换的修订撤销项'));
        return;
      }
      throw failUnsafe(Error('编辑后的重做分支未能核验'));
    }
    if (added > 0 && same(next.slice(added), old)) {
      stacks.undo = next.slice(0, added).map(title => ({ title, inline: resolution })).concat(stacks.undo);
    } else if (!resolution && old.length && next.length >= old.length
               && same(next.slice(added + 1), old.slice(1))) {
      if (stacks.undo[0].inline) throw failUnsafe(Error('编辑替换了已有修订撤销项，无法安全确定其显示态'));
      stacks.undo = unknown(next.slice(0, added + 1)).concat(stacks.undo.slice(1));
    } else if (!resolution && next.length === 0) {
      stacks.undo = [];
    } else {
      throw failUnsafe(Error('编辑后的撤销栈前缀未能核验'));
    }
    stacks.redo = [];
  }
  return {
    assertSafe,
    reset() { stacks = null; unsafe = null; },
    async edit(run) {
      assertSafe();
      // No extra UNO round trips on ordinary typing before any tracked resolution.
      if (!hasInline()) { stacks = null; return run(); }
      observe(await undoState());
      const result = await run();
      try { edited(await undoState(), false); }
      catch (error) { throw unsafe || failUnsafe(error); }
      return result;
    },
    async resolve(run) {
      assertSafe();
      const before = await state();
      observe(await undoState());
      const apply = async () => {
        const result = await run();
        try {
          if (result.applied !== true) throw Error('修订结果未能核验');
          edited(await undoState(), true);
        } catch (error) { throw unsafe || failUnsafe(error); }
        return result;
      };
      return before.mode === 'all' ? apply() : inline(before, apply);
    },
    async step(kind) {
      assertSafe();
      if (!['undo', 'redo'].includes(kind)) throw Error('Unsupported undo operation');
      const before = await state(), native = observe(await undoState());
      if (!native[kind].depth) return { applied: false, state: native };
      const entry = stacks[kind][0], other = kind === 'undo' ? 'redo' : 'undo';
      const run = async () => {
        try {
          const result = await undoStep(kind, native);
          if (result.applied !== true) throw Error('Undo outcome was not verified');
          const next = { ...stacks, [kind]: stacks[kind].slice(1), [other]: [entry, ...stacks[other]] };
          if (!same(titles(next.undo), result.state.undo.titles) || !same(titles(next.redo), result.state.redo.titles))
            throw Error('撤销后的两侧栈未能核验');
          stacks = next;
          return result;
        } catch (error) { throw failUnsafe(error); }
      };
      return before.showChangesInMargin === true && entry.inline ? inline(before, run) : run();
    }
  };
}
module.exports = { createReviewUndo };
