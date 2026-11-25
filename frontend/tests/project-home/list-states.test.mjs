// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X-S1 part 3: the file tree and the project list use the shared loading / error / empty states,
// and a failed load is never shown as "no files" / "no projects".
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const tree = fs.readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
const list = fs.readFileSync(new URL('../../src/components/project-list/ProjectListPane.vue', import.meta.url), 'utf8')

test('file tree: skeleton while loading, inline error with Retry on failure, designed empty state', () => {
  const block = tree.slice(tree.indexOf('<AwdLoadingBlock v-if="loading && displayFiles.length === 0"'), tree.indexOf('<view v-else class="tree-list">'))
  assert.match(block, /<AwdInlineError v-else-if="loadError && displayFiles\.length === 0"[^>]*@retry="loadFiles"/)
  assert.match(block, /<view v-else-if="displayFiles\.length === 0" class="tree-empty">\s*<AwdEmptyState/)
  assert.match(tree, /if \(shown === 0\) \{\s*this\.loadError = error/, 'a failed first load becomes the error state')
  assert.match(tree, /uni\.\$emit\('awd:files-changed', \{ projectId \}\)\s*this\.loadError = null/, 'success clears it')
})

test('project list: skeleton while loading, inline error with Retry when nothing could be loaded', () => {
  assert.match(list, /<AwdLoadingBlock v-if="projectsLoading"/)
  assert.match(list, /<AwdInlineError v-else-if="projectsLoadError && projects\.length === 0"[^>]*@retry="loadProjects"/)
  assert.match(list, /if \(this\.projects\.length === 0\) this\.projectsLoadError = error/)
  assert.match(list, /this\.projects = projectsWithMembers\s*this\.projectsLoadError = null/)
})
