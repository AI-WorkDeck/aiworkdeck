// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// uni-app H5 compiles <form>/<button>/<input> in .vue templates to uni-form/uni-button/uni-input.
// A uni-button submits its form only with form-type="submit" (type="submit" is ignored), Enter in an
// input fires @confirm instead of submitting, and uni-form's submit event has no preventDefault.
// So a <form @submit…> whose button has no click handler looks right in jsdom/Chrome unit tests and
// does nothing in the app: QA D1 round 2 (消息中心 确认生成 / 创建), the MCP 预览/保存 buttons.
// Rule: inside a template <form>, every button must call its handler itself (@click/@tap).
// Same family: a template <textarea>/<input> becomes uni-textarea/uni-input whose input event carries
// detail.value, not target.value — reading $event.target.value there loses every keystroke (the
// 消息中心 composer never enabled 发送). Use <component :is="'textarea'"> for a native element, or v-model.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../src/', import.meta.url))
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

export function deadFormButtons(source) {
  const template = (source.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
  let clean = template, prev
  do { prev = clean; clean = clean.replace(/<!--[\s\S]*?-->/g, '') } while (clean !== prev)
  const problems = []
  for (const form of clean.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
    for (const button of form[0].matchAll(/<button\b([^>]*)>/g)) {
      const attrs = button[1]
      if (/(@click|@tap|v-on:click)\s*=/.test(attrs)) continue
      problems.push(button[0].slice(0, 120))
    }
  }
  return problems
}

export function lostInputs(source) {
  const template = (source.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
  return [...template.matchAll(/<(textarea|input)\b([^>]*)>/g)].filter(m => /\$event\.target\.value/.test(m[2])).map(m => m[0].slice(0, 120))
}

test('the guard recognises the QA D1 pattern and its fix', () => {
  assert.equal(lostInputs('<template><textarea :value="d" @input="d = $event.target.value"></textarea></template>').length, 1)
  assert.equal(lostInputs('<template><component :is="\'textarea\'" :value="d" @input="d = $event.target.value"></component></template>').length, 0)
  assert.equal(deadFormButtons('<template><form @submit.prevent="go"><input v-model="x" /><button class="primary">OK</button></form></template>').length, 1)
  assert.equal(deadFormButtons('<template><form @submit.prevent="go"><button type="submit">OK</button></form></template>').length, 1)
  assert.equal(deadFormButtons('<template><form><button type="button" @click="go">OK</button></form></template>').length, 0)
  assert.equal(deadFormButtons('<template><div><button>outside a form</button></div></template>').length, 0)
})

test('no button inside a uni-app <form> relies on native form submission', () => {
  const offenders = []
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8')
    for (const button of deadFormButtons(source)) offenders.push(`${relative(root, file)}: ${button}`)
    for (const input of lostInputs(source)) offenders.push(`${relative(root, file)}: ${input}`)
  }
  assert.deepEqual(offenders, [], 'uni-app never submits a <form> from a plain button; add @click to the button')
})
