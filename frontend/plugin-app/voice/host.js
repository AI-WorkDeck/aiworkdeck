// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { voice } from './api.js'
export const host = { model: null, services: { ensure: () => voice('ensure') } }
export async function initializeHost() {
  if ((await voice('capabilities')).desktop) host.model = {
    status: () => voice('modelStatus'), cancel: id => voice('modelCancel', { id }),
    download: () => voice('componentInstall', { packId: 'asr-runtime' }),
    onProgress: callback => window.awd.events.on('speech.progress', callback),
  }
}
