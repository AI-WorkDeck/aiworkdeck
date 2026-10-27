// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { reactive } from 'vue'
import { voice } from './api.js'
const state = reactive({ items: [] })
async function load() {
  const rows = await voice('components')
  for (const row of rows) {
    const old = state.items.find(item => item.packId === row.packId)
    if (old) Object.assign(old, row)
    else state.items.push(row)
  }
  return state.items
}
export const componentDownloads = {
  state, load, fillSizes: async item => item, claim: () => () => {},
  isInstalling: id => !!state.items.find(item => item.packId === id)?.installing,
  async installOne(item) {
    await voice('componentInstall', { packId: item.packId })
    do { await new Promise(resolve => setTimeout(resolve, 1000)); await load() } while (item.installing)
    if (item.installResult === false) item.error = item.installError
    return item.installResult === true
  },
}
