// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// C1: the host "Reviews / 审阅" entry. One qualifying plugin: its own rail button carries the badge and the
// welcome line opens its view. Two or more: a generic 审阅 rail item appears and opens a picker that lists each
// plugin under its own name. Qualifying = computed `reviewEntries` (see utils/hostEntries.js).

export const HOST_REVIEWS_KEY = 'host-reviews'

// Clipboard-check outline: "something to review", not a brand.
const REVIEWS_ICON = [
  'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z',
  'M8 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2',
  'm9 13 2 2 4-4',
]

export const reviewsEntryMethods = {
  hostReviewsRailItems() {
    if (this.reviewEntries.length < 2) return []
    return [{ key: HOST_REVIEWS_KEY, labelKey: 'workbench.reviewsEntry', label: '', svgPaths: REVIEWS_ICON, isHostEntry: true }]
  },

  reviewBadgeOf(pluginId) {
    const e = this.reviewEntries.find(x => x.pluginId === pluginId)
    return e ? e.badge : 0
  },

  /** Welcome line / generic rail item: open the single plugin's view, or let the lawyer pick one. */
  openReviewsEntry() {
    const entries = this.reviewEntries
    if (!entries.length) return
    if (entries.length === 1) { this.openPluginTab(entries[0].pluginId); return }
    uni.showActionSheet({
      title: this.$t('workbench.reviewsPick'),
      itemList: entries.map(e => e.badge > 0 ? this.$t('workbench.reviewsPickItem', { name: e.label, count: e.badge }) : e.label),
      success: ({ tapIndex }) => { const e = entries[tapIndex]; if (e) this.openPluginTab(e.pluginId) },
    })
  },
}
