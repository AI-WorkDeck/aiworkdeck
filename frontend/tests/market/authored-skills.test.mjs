// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { isNewlyAuthored, publishState, NEW_BADGE_MS } from '../../src/utils/authoredSkills.mjs'

const NOW = Date.parse('2026-11-03T12:00:00Z')

test('isNewlyAuthored: only locally authored skills within 24h', () => {
  assert.equal(isNewlyAuthored({ authoredLocally: true, createdAt: '2026-11-03T11:00:00Z' }, NOW), true)
  assert.equal(isNewlyAuthored({ authoredLocally: true, createdAt: new Date(NOW - NEW_BADGE_MS).toISOString() }, NOW), false)
  assert.equal(isNewlyAuthored({ authoredLocally: true, createdAt: new Date(NOW - NEW_BADGE_MS + 1).toISOString() }, NOW), true)
  assert.equal(isNewlyAuthored({ authoredLocally: false, createdAt: '2026-11-03T11:00:00Z' }, NOW), false, 'installed skills never show the badge')
  assert.equal(isNewlyAuthored({ authoredLocally: true, createdAt: 'not a date' }, NOW), false)
  assert.equal(isNewlyAuthored({ authoredLocally: true }, NOW), false)
  assert.equal(isNewlyAuthored(null, NOW), false)
  assert.equal(isNewlyAuthored({ authoredLocally: true, createdAt: '2026-11-04T00:00:00Z' }, NOW), true, 'clock skew into the future still counts as new')
})

test('publishState', () => {
  assert.equal(publishState({ id: 'x' }), 'none')
  assert.equal(publishState({ authoredLocally: true, publishedVersion: null }), 'unpublished')
  assert.equal(publishState({ authoredLocally: true }), 'unpublished')
  assert.equal(publishState({ authoredLocally: true, publishedVersion: '1.0.0' }), 'published')
  assert.equal(publishState({ authoredLocally: true, publishedVersion: '' }), 'published', 'published but website returned no version')
})
