// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
// Execution remains a Windows integration job. These guards catch privilege/publishing
// regressions in the acceptance harness itself; they do not claim OS behavior was tested.
test('isolated acceptance cannot receive release credentials or publish installers', () => {
  const workflow = read('.github/workflows/dependency-clean-windows.yml')
  assert.match(workflow, /workflow_call:/)
  assert.match(workflow, /runs-on: windows-2022/)
  assert.doesNotMatch(workflow, /secrets:|secrets\.|id-token:|contents: write|softprops|release-action/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /if: always\(\)/)
})
test('harness refuses user machines and rejects elevated acceptance identity', () => {
  const script = read('desktop/scripts/dependency-clean-windows/run.ps1')
  assert.match(script, /RUNNER_ENVIRONMENT -ne 'github-hosted'/)
  assert.match(script, /IsInRole\(\[Security.Principal.WindowsBuiltInRole\]::Administrator\)/)
  assert.match(script, /Remove-Item Env:PSModulePath/)
  assert.match(script, /Get-AuthenticodeSignature/)
  assert.match(script, /SHA256 mismatch/)
  assert.doesNotMatch(script, /Set-ExecutionPolicy|Enable-WindowsOptionalFeature|Disable-WindowsOptionalFeature/)
  assert.match(script, /\.Extension -in @\('\.json','\.log','\.txt','\.png','\.pdf','\.docx','\.dot','\.svg'\)/)
})
test('expensive acceptance is gated by changes instead of all PRs or a branch name', () => {
  const workflow = read('.github/workflows/desktop-build.yml')
  assert.match(workflow, /git diff --name-only "\$BASE_SHA" "\$HEAD_SHA"/)
  assert.match(workflow, /needs\.dependency-scope\.outputs\.required == 'true'/)
  assert.doesNotMatch(workflow, /startsWith\(github\.head_ref, 'codex\/clean-windows/)
  const yaml = require('js-yaml').load(workflow)
  const acceptance = yaml.jobs['clean-windows-dependencies']
  assert.match(acceptance.if, /always\(\)/, 'PR skip of tag-only patch gate must not propagate to acceptance')
  assert.match(acceptance.if, /needs\.build\.result == 'success'/, 'failed builds still cannot be accepted')
  assert.match(acceptance.if, /!cancelled\(\)/)
})
