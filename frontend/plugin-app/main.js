// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSSRApp } from 'vue'
import '@plugin-sdk'
import App from './App.vue'
import { i18n } from '@/i18n'
export function createApp() {
  const app = createSSRApp(App)
  app.use(i18n)
  return { app }
}
