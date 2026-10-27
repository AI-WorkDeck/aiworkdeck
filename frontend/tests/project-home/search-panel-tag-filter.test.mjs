// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Tag browsing must remain usable after zero results, project switches and file/tag changes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse } from 'vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { renderToString } from 'vue/server-renderer'
import { createI18n } from 'vue-i18n'
import * as tagTypes from '../../src/utils/tagTypes.js'
import zh from '../../src/locales/zh-CN/files.js'
import en from '../../src/locales/en-US/files.js'

const sources = Object.fromEntries(['SearchPanel', 'TagFilter'].map(name => [name,
  readFileSync(new URL(`../../src/components/${name}.vue`, import.meta.url), 'utf8')]))
const emptyResult = { totalMatches: 0, totalFiles: 0, results: [] }
const tags = [{ id: 1, name: '甲方', type: 'PARTY' }, { id: 2, name: '付款', type: 'ISSUE' }, { id: 3, name: '待核查' }]

function component(name, deps = {}) {
  const { descriptor } = parse(sources[name])
  const script = descriptor.script.content.replace(/^import .*$/gm, '').replace('export default', 'return')
  const dependencies = { ...tagTypes, searchProjectContent: async () => emptyResult, getProjectTags: async () => tags,
    FileTypeIcon: { render: () => null }, TagFilter: {}, uni: {}, ...deps }
  const options = new Function(...Object.keys(dependencies), script)(...Object.values(dependencies))
  const code = compile(descriptor.template.content, { mode: 'function', prefixIdentifiers: true, isCustomElement: tag => ['view', 'text', 'scroll-view'].includes(tag) }).code
  options.render = new Function('Vue', code)(Vue)
  return options
}
function vmFor(options, state = {}) {
  const vm = { ...options.data(), projectId: 1, $t: key => key, ...state }
  for (const [name, method] of Object.entries(options.methods)) vm[name] = method.bind(vm)
  for (const [name, getter] of Object.entries(options.computed || {})) Object.defineProperty(vm, name, { get: getter.bind(vm) })
  return vm
}
function deferred() {
  let resolve, reject
  const promise = new Promise((r, j) => { resolve = r; reject = j })
  return { promise, resolve, reject }
}
async function render(name, props, state = {}, locale = 'zh-CN') {
  const options = component(name, { TagFilter: component('TagFilter') })
  const initial = options.data()
  options.data = () => ({ ...initial, ...state })
  const app = Vue.createSSRApp(options, props)
  app.use(createI18n({ legacy: true, locale, messages: { 'zh-CN': { files: zh }, 'en-US': { files: en } } }))
  return renderToString(app)
}

test('empty projects still show the tag entry and the right-click setup hint', async () => {
  const html = await render('TagFilter', { tags: [] })
  assert.match(html, /<button[^>]+aria-expanded="true"/)
  assert.match(html, /按标签筛选/)
  assert.match(html, /右键文件/)
  assert.doesNotMatch(html, /uni-button/)
})

test('selected filters remain removable while collapsed, with an explicit AND rule', async () => {
  const html = await render('TagFilter', { tags, modelValue: [1, 2] }, { open: false })
  assert.match(html, /aria-label="移除标签筛选：甲方"/)
  assert.match(html, /aria-label="移除标签筛选：付款"/)
  assert.match(html, /同时包含所选标签/)
  assert.ok(html.includes(zh.tagClear))
  assert.doesNotMatch(html, /tag-filter-options/)
})

test('the native tag buttons expose pressed state, all types and name filtering', async () => {
  const html = await render('TagFilter', { tags, modelValue: [1], counts: { 1: 1 } })
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /aria-pressed="false"/)
  for (const label of ['当事人', '争议焦点', '其他标签']) assert.ok(html.includes(label))
  const filtered = await render('TagFilter', { tags }, { query: '付款' })
  assert.match(filtered, /付款/)
  assert.doesNotMatch(filtered, /tag-name[^>]*>甲方/)
  const empty = await render('TagFilter', { tags }, { query: '不存在' }, 'en-US')
  assert.match(empty, /No matching tags/)
})

test('tag-only result stats omit zero text matches and each result shows its tags', async () => {
  const html = await render('SearchPanel', { projectId: 1 }, {
    allProjectTags: tags, selectedTagIds: [1], hasSearched: true,
    results: { totalMatches: 0, totalFiles: 1, results: [{ fileId: 4, fileName: 'photo.png', fileType: 'png', matchCount: 0, tags: [tags[0]] }] }
  })
  assert.match(html, /photo.png/)
  assert.match(html, /result-tag[^>]*[\s\S]*甲方/)
  assert.ok(!html.includes(zh.matchesSuffix))
  assert.match(html, /1<\/text>[^<]*个文件/)
})

test('filename results stay visible during slow and failed full-text searches', async () => {
  for (const loading of [true, false]) {
    const html = await render('SearchPanel', { projectId: 1 }, {
      hasSearched: true, searchedQuery: '锦江', loading, searchPhase: 'content',
      searchError: loading ? '' : zh.searchContentFailed,
      results: { totalMatches: 0, totalFiles: 1, results: [{ fileId: 4, fileName: '锦江.txt', fileType: 'txt', matchCount: 0, tags: [] }] }
    })
    assert.match(html, /锦江.txt/)
    assert.ok(html.includes(loading ? zh.searchingContent : zh.searchContentFailed))
    assert.ok(!html.includes(zh.noResults))
  }
})

test('filtering never excludes other project tags, even after zero results', async () => {
  const calls = []
  const vm = vmFor(component('SearchPanel', { searchProjectContent: async (_id, payload) => { calls.push(payload); return emptyResult } }), {
    allProjectTags: tags, selectedTagIds: [1], searchQuery: 'photo'
  })
  await vm.performSearch()
  assert.deepEqual(vm.allProjectTags, tags)
  assert.deepEqual(vm.tagCounts, {})
  assert.deepEqual(calls[0].tagIds, [1])
  assert.equal('fileTypes' in calls[0], false, 'file name searches must include images, audio and archives')
  const filter = vmFor(component('TagFilter'), { tags: vm.allProjectTags, modelValue: [1], counts: {}, query: '' })
  assert.equal(filter.filteredTags.length, 3)
})

test('project changes abort old searches, clear filters and reject stale tag responses', async () => {
  const firstTags = deferred(), nextTags = deferred(), search = deferred()
  let signal
  const options = component('SearchPanel', {
    getProjectTags: id => id === 1 ? firstTags.promise : nextTags.promise,
    searchProjectContent: (_id, _payload, opts) => { signal = opts.signal; return search.promise }
  })
  const vm = vmFor(options, { searchQuery: '旧项目', selectedTagIds: [1], allProjectTags: tags })
  const oldTags = vm.fetchTags(), oldSearch = vm.performSearch()
  vm.projectId = 2
  options.watch.projectId.call(vm)
  assert.equal(signal.aborted, true)
  assert.equal(vm.searchQuery, '')
  assert.deepEqual(vm.selectedTagIds, [])
  nextTags.resolve([{ id: 20, name: '新项目标签' }])
  await Promise.resolve()
  firstTags.resolve(tags)
  search.resolve({ totalMatches: 9, totalFiles: 9, results: [] })
  await Promise.all([oldTags, oldSearch])
  assert.deepEqual(vm.allProjectTags, [{ id: 20, name: '新项目标签' }])
  assert.deepEqual(vm.results, emptyResult)
  assert.equal(vm.hasSearched, false)
})

test('file changes refresh only the current project and remove deleted tag filters before querying', async () => {
  const queries = [], tagCalls = []
  const vm = vmFor(component('SearchPanel', {
    getProjectTags: async id => { tagCalls.push(id); return [tags[1]] },
    searchProjectContent: async (_id, payload) => { queries.push(payload); return emptyResult }
  }), { allProjectTags: tags, selectedTagIds: [1, 2], hasSearched: true })
  await vm.onFilesChanged({ projectId: 8 })
  assert.equal(tagCalls.length, 0)
  await vm.onFilesChanged({ projectId: '1' })
  assert.deepEqual(vm.selectedTagIds, [2])
  assert.equal(queries.length, 1)
  assert.deepEqual(queries[0].tagIds, [2])
})

test('tag fetch failures are retryable and preserve the current selection', async () => {
  let failed = true
  const vm = vmFor(component('SearchPanel', { getProjectTags: async () => {
    if (failed) throw new Error('offline')
    return [tags[1]]
  } }), { allProjectTags: tags, selectedTagIds: [1, 2] })
  await vm.fetchTags()
  assert.equal(vm.tagsError, 'files.tagLoadFailed')
  assert.deepEqual(vm.selectedTagIds, [1, 2])
  assert.equal(vm.tagsLoading, false)
  failed = false
  await vm.refreshTagsAndSearch()
  assert.equal(vm.tagsError, '')
  assert.deepEqual(vm.selectedTagIds, [2])
})

test('mount and unmount register and remove the exact files-changed listener', async () => {
  const calls = [], gate = deferred()
  const options = component('SearchPanel', { getProjectTags: () => gate.promise, uni: {
    $on: (...args) => calls.push(['on', ...args]), $off: (...args) => calls.push(['off', ...args])
  } })
  const vm = vmFor(options)
  options.mounted.call(vm)
  options.beforeUnmount.call(vm)
  assert.deepEqual(calls, [['on', 'awd:files-changed', vm.onFilesChanged], ['off', 'awd:files-changed', vm.onFilesChanged]])
  gate.resolve(tags)
  await Promise.resolve()
  assert.deepEqual(vm.allProjectTags, [])
})

test('tag-only and filename-only result rows open files; content result rows toggle matches', () => {
  const events = []
  const vm = vmFor(component('SearchPanel'), { $emit: (...args) => events.push(args) })
  const file = { fileId: 7, fileName: 'photo.png', fileType: 'png', matchCount: 0 }
  vm.onFileHeader(file)
  assert.equal(events[0][0], 'open-file')
  assert.equal(events[0][1].id, 7)
  vm.searchedQuery = 'photo'
  vm.onFileHeader(file)
  assert.equal(events.length, 2)
  vm.onFileHeader({ ...file, matchCount: 2 })
  assert.equal(events.length, 2)
  assert.equal(vm.collapsedFiles[7], true)
})

test('string and number tag IDs share selection, ordering and removal semantics', async () => {
  const events = []
  const vm = vmFor(component('TagFilter'), { tags, modelValue: ['1'], counts: {}, $emit: (...args) => events.push(args) })
  assert.deepEqual(vm.selectedTags, [tags[0]])
  assert.equal(vm.isSelected(1), true)
  vm.toggleTag(1)
  assert.deepEqual(events[0], ['update:modelValue', []])
  vm.toggleTag(2)
  assert.deepEqual(events[1], ['update:modelValue', ['1', 2]])
  const html = await render('TagFilter', { tags, modelValue: ['1'] })
  assert.match(html, /aria-label="移除标签筛选：甲方"/)
  assert.match(html, /aria-pressed="true"[^>]*title="甲方"/)
  const searchVm = vmFor(component('SearchPanel'), { selectedTagIds: ['1'] })
  await searchVm.fetchTags()
  assert.deepEqual(searchVm.selectedTagIds, ['1'])
})

test('failed new queries hide stale files, expose a durable retry, then recover', async () => {
  let failed = true
  const vm = vmFor(component('SearchPanel', { searchProjectContent: async () => {
    if (failed) throw new Error('offline')
    return emptyResult
  }, uni: { showToast() {} }, console: { error() {} } }), {
    selectedTagIds: [2], allProjectTags: tags,
    results: { totalMatches: 0, totalFiles: 1, results: [{ fileId: 4, fileName: 'stale-photo.png', fileType: 'png', matchCount: 0 }] }
  })
  await vm.performSearch()
  assert.equal(vm.searchError, 'files.searchFailed')
  assert.equal(vm.loading, false)
  const html = await render('SearchPanel', { projectId: 1 }, { hasSearched: vm.hasSearched, results: vm.results, selectedTagIds: vm.selectedTagIds, allProjectTags: vm.allProjectTags, searchError: zh.searchFailed })
  assert.match(html, /搜索失败，请重试/)
  assert.match(html, /<button[^>]+class="search-retry"/)
  assert.doesNotMatch(html, /stale-photo.png/)
  assert.doesNotMatch(html, /未找到结果/)
  failed = false
  await vm.performSearch()
  assert.equal(vm.searchError, '')
  assert.deepEqual(vm.results, emptyResult)
})

test('every native tag button stops bubbling before changing or removing its DOM node', async () => {
  const options = component('TagFilter')
  let tree
  const app = Vue.createSSRApp({ ...options, render() {
    tree = options.render(this, [])
    return tree
  } }, { tags, modelValue: [1], counts: {}, loading: false, error: 'Failed' })
  app.config.globalProperties.$t = key => key
  await renderToString(app)
  const buttons = []
  function collect(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'button') buttons.push(node)
    if (Array.isArray(node.children)) node.children.forEach(collect)
  }
  collect(tree)
  assert.equal(buttons.length, 7, 'toggle, clear, selected remove, retry and three tag choices')
  for (const button of buttons) {
    let stopped = false
    button.props.onClick({ stopPropagation() { stopped = true } })
    assert.equal(stopped, true, button.props.class)
  }
})
