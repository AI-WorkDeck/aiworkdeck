// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import * as workflow from '../../src/utils/ddWorkflow.js'

export function createEditor({ api = {}, services = {}, props = {}, confirm = true } = {}) {
  const source = readFileSync(new URL('../../src/components/DdRequestEditor.vue', import.meta.url), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  const dependencies = { ...workflow, getDdStartAttempt: async () => ({ key: 'test-attempt' }), finishDdStartAttempt: () => {}, api: { getDdItemComments: async () => [], ...api }, DdClientChecklist: {}, uni: { showModal: options => options.success({ confirm }) }, ...services }
  const options = new Function(...Object.keys(dependencies), script)(...Object.values(dependencies))
  const vm = { ...options.data(), canWrite: true, requestId: 1, projectId: 7, clientView: false, ...props, emitted: [], $t: key => key }
  vm.$emit = (...args) => vm.emitted.push(args)
  for (const [key, method] of Object.entries(options.methods)) vm[key] = method.bind(vm)
  for (const [key, method] of Object.entries(options.computed)) Object.defineProperty(vm, key, { get: method.bind(vm) })
  return { vm, options, dispose: () => options.beforeUnmount.call(vm) }
}
export const detail = (name = '清单', id = 1, status = 'DRAFT') => ({ request: { id, name, status }, items: [{ id: 5, title: name, description: '完整扫描件', status: 'PENDING' }] })
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { resolve, reject, promise } }
