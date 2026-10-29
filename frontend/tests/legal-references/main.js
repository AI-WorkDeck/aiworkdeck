// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import '../chat-presentation-ui/main.js'
import { createApp, h, reactive } from 'vue'
import { i18n } from '../../src/i18n/index.js'
import LegalReferencePane from '../../src/components/legal/LegalReferencePane.vue'
import { legalReferenceTabMethods } from '../../src/pages/project-overview/legalReferenceTab.js'
window.legalHost = reactive({ leftFiles: [{ id: 1, fileType: 'docx' }], rightFiles: [], activeFileIdLeft: 1, activeFileIdRight: null, splitMode: false, $nextTick: fn => fn(), triggerWorkbenchResize() {} })
window.chat.$.appContext.provides.openLegalReferenceTab = reference => legalReferenceTabMethods.openLegalReferenceTab.call(window.legalHost, reference)
const reader = createApp({ render() {
  const tab = window.legalHost.rightFiles.find(tab => tab.id === window.legalHost.activeFileIdRight)
  return tab ? h(LegalReferencePane, { reference: tab.legalReference, onOpenUrl: url => { window.openedLegalUrl = url } }) : null
} })
reader.use(i18n).mount('#reader')
window.legalReady = true
