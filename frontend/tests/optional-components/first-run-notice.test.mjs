// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D6: on a fresh install the "Optional components" dialog no longer pops over the Welcome page;
// a dismissible Welcome notice opens it. Offline, the size line stops saying "Checking size…".
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createOptionalComponentsController } from '../../src/composables/useOptionalComponents.js'

test('an unreachable size source is reported as unavailable, not as still checking', async () => {
  const c = createOptionalComponentsController({ packInfo: async () => { throw new Error('Unable to tunnel through proxy') } })
  const item = { packId: 'pptx', downloadBytes: 0 }
  await c.fillSizes(item)
  assert.equal(item.sizeUnavailable, true)
  const ok = createOptionalComponentsController({ packInfo: async () => ({ totalSize: 5 * 1024 * 1024 }) })
  const sized = { packId: 'pptx', downloadBytes: 0 }
  await ok.fillSizes(sized)
  assert.equal(sized.downloadBytes, 5 * 1024 * 1024)
  assert.equal(sized.sizeUnavailable, undefined)
})

test('the card shows the unavailable copy when the size could not be fetched', () => {
  const card = fs.readFileSync(new URL('../../src/components/OptionalComponentCard.vue', import.meta.url), 'utf8')
  assert.match(card, /this\.item\.sizeUnavailable \? 'components\.sizeUnavailable' : 'components\.sizeUnknown'/)
})

test('startup suggests instead of opening the dialog; the Welcome notice opens or dismisses it', () => {
  const page = fs.readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const fn = page.slice(page.indexOf('async maybePromptOptionalComponents()'))
  const body = fn.slice(0, fn.indexOf('\n    },\n'))
  assert.doesNotMatch(body, /showOptionalComponents = /, 'no modal at startup')
  assert.match(body, /this\.optionalComponentsSuggested = shouldShow/)
  assert.equal((page.match(/:components-suggested="optionalComponentsSuggested"/g) || []).length, 2, 'both Welcome panes')
  assert.match(page, /openSuggestedComponents\(\) \{\s*this\.optionalComponentsSuggested = false\s*this\.showOptionalComponents = true/)
  assert.match(page, /async dismissSuggestedComponents\(\) \{[\s\S]{0,400}PROMPTED_PACKS_PREF_KEY[\s\S]{0,200}PROMPTED_PREF_KEY/, 'dismissing counts as prompted')
  const welcome = fs.readFileSync(new URL('../../src/components/welcome/WelcomePane.vue', import.meta.url), 'utf8')
  assert.match(welcome, /v-if="componentsSuggested"/)
  assert.match(welcome, /\$emit\('open-components'\)/)
  assert.match(welcome, /\$emit\('dismiss-components'\)/)
})
