#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X39 model-side eval: does the "continue exactly from where it stopped" instruction make the model
// pick up a cut-off draft without repeating or restarting? 10 drafts, cut at ~60 % mid-sentence.
// Usage: DASHSCOPE_API_KEY + BAILIAN_BASE_URL in env (never printed) ->
//   node scripts/eval/continue-eval.mjs [--model deepseek-v4.1-flash-1017] [--n 10]
// Pass: duplicate rate (continuations that repeat a sentence of the draft or restart) < 10 %.
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const MODEL = arg('--model', 'deepseek-v4.1-flash-1017')
const N = Number(arg('--n', 10))
const BASE = (process.env.BAILIAN_BASE_URL || '').replace(/\/+$/, '')
if (!BASE || !process.env.DASHSCOPE_API_KEY) { console.error('need DASHSCOPE_API_KEY and BAILIAN_BASE_URL'); process.exit(2) }

const INSTRUCTION = '你上一条回答在上文末尾被截断。请从断开处直接接着写，不要重复、不要总结已写内容，也不要从头开始。'
const PROMPTS = [
  '写一份约 600 字的律师函，催告乙方在 10 日内支付拖欠的货款 32 万元，列明事实、法律依据与后果。',
  '为一份设备买卖合同起草「违约责任」条款，分迟延交货、质量不符、迟延付款三种情形，约 500 字。',
  '用约 600 字向客户解释劳动争议仲裁的流程、时效和需要准备的证据。',
  '写一份约 500 字的尽职调查备忘录摘要，目标公司存在两起未决诉讼和一项商标权属争议。',
  '起草一份约 500 字的保密协议核心条款：保密信息定义、保密义务、例外情形、期限。',
  '用约 600 字分析租赁合同中「出租人单方解除权」条款对承租人的风险，并给出修改建议。',
  '写一份约 500 字的法律意见书「结论」部分，关于一项股权转让是否需要取得其他股东同意。',
  '用约 600 字说明知识产权侵权诉讼中如何计算损害赔偿，列出四种方法及适用顺序。',
  '为一家初创公司写约 500 字的股东协议「优先购买权与随售权」条款说明。',
  '起草约 600 字的答辩状「事实与理由」部分：原告主张逾期交货违约金过高。',
]

async function chat(messages, maxTokens = 1400) {
  const r = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.DASHSCOPE_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.3, enable_thinking: false }),
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const j = await r.json()
  return String(j.choices?.[0]?.message?.content || '')
}

const sentences = (t) => t.split(/(?<=[。！？；\n.!?;])/).map((s) => s.replace(/\s+/g, '')).filter((s) => s.length >= 8)
const norm = (s) => s.replace(/[\s，。、；：！？,.;:!?「」“”"'《》（）()\-—*#]/g, '')

const rows = []
for (let i = 0; i < Math.min(N, PROMPTS.length); i++) {
  const full = await chat([{ role: 'user', content: PROMPTS[i] }])
  // cut at ~60 %, inside a sentence (not on a boundary), like a dropped stream
  let cut = Math.floor(full.length * 0.6)
  while (cut < full.length - 1 && /[。！？\n]/.test(full[cut])) cut++
  const partial = full.slice(0, cut)
  const cont = await chat([
    { role: 'user', content: PROMPTS[i] },
    { role: 'assistant', content: partial },
    { role: 'user', content: INSTRUCTION },
  ])
  const draftSet = new Set(sentences(partial).map(norm))
  const repeated = sentences(cont).map(norm).filter((s) => s.length >= 8 && draftSet.has(s))
  const restarted = norm(cont).startsWith(norm(full).slice(0, 20))
  const dup = repeated.length > 0 || restarted
  rows.push({ i, partialChars: partial.length, contChars: cont.length, repeated: repeated.length, restarted, dup,
    seam: JSON.stringify(partial.slice(-24)) + ' | ' + JSON.stringify(cont.slice(0, 40)) })
  console.log(`#${i + 1} dup=${dup} repeated=${repeated.length} restarted=${restarted} seam=${rows.at(-1).seam}`)
}
const rate = rows.filter((r) => r.dup).length / rows.length
console.log(`\nmodel=${MODEL} drafts=${rows.length} duplicate rate=${(rate * 100).toFixed(0)}% (target < 10%) -> ${rate < 0.1 ? 'PASS' : 'FAIL'}`)
process.exit(rate < 0.1 ? 0 : 1)
