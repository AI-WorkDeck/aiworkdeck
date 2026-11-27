// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#377 组件级：审阅面板的作者筛选、类型标注、理由挂载与处置联动。
// 纯函数层已由 review-grouping.test.mjs 钉住；这里钉的是**接线**——组件真的把
// selfAuthor 传下去了、筛选真的作用在列表上、处置真的顺手把理由批注标成已解决。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeReviewVm } from '../_lib/review-panel-vm.mjs'

// 假引擎：一份文档里三方修订 + 一条挂在 AI 那处替换上的理由批注。
// index 就是清单下标，处置一条后其余前移——与真引擎一致。
function makeEngine() {
  const revisions = [
    // AI 的一次替换：删「三」+「十日」（连按 Backspace，引擎记两条，页边模式下都
    // 塌到 offset 10）+ 插「六十日」。两条删除首尾相接、同作者同分钟，先并成一组；
    // 紧接着的插入与它相接、同作者，配成一张「替换」卡（Q25：删插分开处置会弄坏句子）。
    { index: 0, type: 'Delete', author: 'AI WorkDeck', date: '2026-09-02 10:00', text: '三', paraKey: 2, start: 10, end: 10, contiguous: false },
    { index: 1, type: 'Delete', author: 'AI WorkDeck', date: '2026-09-02 10:00', text: '十日', paraKey: 2, start: 10, end: 10, contiguous: true },
    { index: 2, type: 'Insert', author: 'AI WorkDeck', date: '2026-09-02 10:00', text: '六十日', paraKey: 2, start: 10, end: 13, contiguous: true },
    // 我自己改的一处格式
    { index: 3, type: 'Format', author: '韩泽伟', date: '2026-09-02 11:00', text: '违约金', description: '属性已更改', paraKey: 4, start: 0, end: 3, contiguous: false },
    // 别人的一处插入
    { index: 4, type: 'Insert', author: '王律师', date: '2026-09-02 12:00', text: '并加收滞纳金', paraKey: 6, start: 5, end: 11, contiguous: false },
  ]
  const comments = [
    { index: 0, id: 'cmt1', author: 'AI WorkDeck', content: '【修訂理由】账期与主协议第 3 条不一致', resolved: false, paraKey: 2, start: 8, end: 14 },
    { index: 1, id: 'cmt2', author: '王律师', content: '这条待客户确认', resolved: false, paraKey: 9, start: 0, end: 4 },
  ]
  const calls = []
  return {
    revisions, comments, calls,
    async executeCommand(action, params) {
      calls.push({ action, params })
      await Promise.resolve()
      if (action === 'list_revisions') return { success: true, revisions: revisions.slice() }
      if (action === 'list_comments') return { success: true, comments: comments.slice() }
      if (action === 'resolve_revisions') {
        const idxs = (params.indices || []).slice().sort((a, b) => b - a)
        const results = idxs.map((i) => {
          const at = revisions.findIndex((r) => r.index === i)
          if (at < 0) return { index: i, success: false }
          revisions.splice(at, 1)
          return { index: i, success: true }
        })
        revisions.forEach((r, i) => { r.index = i })
        return { success: true, results, resolved: results.filter((r) => r.success).length }
      }
      if (action === 'set_comment_resolved') {
        const c = comments.find((x) => x.id === params.id) || comments[params.index]
        if (c) c.resolved = !!params.resolved
        return { success: true, id: c && c.id, resolved: c && c.resolved }
      }
      return { success: true }
    },
  }
}

test('作者维度：每张卡带 authorKind，四个桶的计数按未筛选全量算', async () => {
  const engine = makeEngine()
  const vm = makeReviewVm(engine, { selfAuthor: '韩泽伟' })
  await vm.reload()
  const groups = vm.allGroups
  assert.equal(groups.length, 3, '两条连续删除并成一组，再与相接的插入配成一张替换卡')
  assert.deepEqual(groups.map((g) => g.authorKind), ['ai', 'me', 'other'])
  assert.deepEqual(groups.map((g) => g.items.length), [3, 1, 1])
  assert.deepEqual(vm.authorCounts, { all: 3, ai: 1, me: 1, other: 1 })

  vm.authorFilter = 'ai'
  assert.equal(vm.revisionGroups.length, 1)
  assert.ok(vm.revisionGroups.every((g) => g.author === 'AI WorkDeck'))
  assert.deepEqual(vm.authorCounts, { all: 3, ai: 1, me: 1, other: 1 }, '筛选后计数不许跟着变')
  vm.authorFilter = 'other'
  assert.equal(vm.revisionGroups[0].author, '王律师')
})

test('类型标注：格式类修订不再显示成「插入」，并带上引擎给的说明', async () => {
  const engine = makeEngine()
  const vm = makeReviewVm(engine, { selfAuthor: '韩泽伟' })
  await vm.reload()
  const fmt = vm.allGroups.find((g) => g.author === '韩泽伟')
  assert.equal(fmt.typeKey, 'format')
  assert.equal(vm.typeLabel(fmt), 'editor.review.typeFormat')
  assert.equal(fmt.description, '属性已更改')
  const rep = vm.allGroups.find((g) => g.typeKey === 'replace')
  assert.equal(vm.typeLabel(rep), 'editor.review.replacement')
  assert.equal(rep.text, '三十日')
  assert.equal(rep.insText, '六十日')
})

test('理由：位置重叠的批注挂进修订卡，批注列表里也标出已挂载', async () => {
  const engine = makeEngine()
  const vm = makeReviewVm(engine, { selfAuthor: '韩泽伟' })
  await vm.reload()
  const aiCards = vm.allGroups.filter((g) => g.authorKind === 'ai')
  assert.equal(aiCards.length, 1)
  for (const card of aiCards) {
    assert.equal(card.reasons.length, 1, '同一条批注同时是删与插的理由，组内去重只留一份')
    assert.equal(card.reasons[0].content, '【修訂理由】账期与主协议第 3 条不一致')
  }
  // 挂不上的批注照旧单独列，且不带「已挂载」标记
  assert.equal(vm.commentRows[0].linkedCount, 3, '删两条 + 插一条，全都挂在这条理由上')
  assert.equal(vm.commentRows[1].linkedCount, 0)
})

test('处置联动：接受一张卡之后，它的理由批注被标记为已解决（不删除）', async () => {
  const engine = makeEngine()
  const vm = makeReviewVm(engine, { selfAuthor: '韩泽伟' })
  await vm.reload()
  const ai = vm.allGroups.find((g) => g.typeKey === 'replace')
  engine.calls.length = 0
  await vm.resolveGroup(ai, 'accept')

  const resolveCalls = engine.calls.filter((c) => c.action === 'resolve_revisions')
  assert.equal(resolveCalls.length, 1, '批量处置仍只发一次 resolve_revisions')
  assert.deepEqual(resolveCalls[0].params.indices, [2, 1, 0], '删与插一起处置，仍按降序传索引')
  const cmtCalls = engine.calls.filter((c) => c.action === 'set_comment_resolved')
  assert.equal(cmtCalls.length, 1, '只处理关联到的那一条批注')
  assert.equal(cmtCalls[0].params.id, 'cmt1', '按 id 定位——index 在修订处置后会前移')
  assert.equal(cmtCalls[0].params.resolved, true)
  assert.equal(engine.comments[0].resolved, true)
  assert.equal(engine.comments[1].resolved, false, '没挂上的批注不许被顺手标掉')
  // 批注仍在清单里（标记已解决，不是删除）
  assert.equal(engine.comments.length, 2)
})

test('处置联动：引擎一条都没命中时不去动批注', async () => {
  const engine = makeEngine()
  const vm = makeReviewVm(engine, { selfAuthor: '韩泽伟' })
  await vm.reload()
  const ai = vm.allGroups.find((g) => g.typeKey === 'replace')
  const orig = engine.executeCommand.bind(engine)
  engine.executeCommand = async (action, params) => {
    if (action === 'resolve_revisions') {
      engine.calls.push({ action, params })
      return { success: true, results: (params.indices || []).map((i) => ({ index: i, success: false })), resolved: 0 }
    }
    return orig(action, params)
  }
  engine.calls.length = 0
  await vm.resolveGroup(ai, 'reject')
  assert.equal(engine.calls.filter((c) => c.action === 'set_comment_resolved').length, 0)
  assert.equal(engine.comments[0].resolved, false)
})
