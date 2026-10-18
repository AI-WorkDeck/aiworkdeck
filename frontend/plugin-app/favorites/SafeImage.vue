<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template><image v-if="url" :src="url" mode="aspectFill" :lazy-load="true" /></template>
<script>
import { perform } from './api.js'
export default {
  props: { itemId: { type: [Number, String], required: true } },
  data: () => ({ url: '' }),
  watch: { itemId: { immediate: true, async handler(id) {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.url = ''
    try {
      const result = await perform('image', { id }, { signal: controller.signal })
      if (!controller.signal.aborted) this.url = result.dataUrl
    } catch (error) { if (!controller.signal.aborted) console.warn('Collection image unavailable', error.code) }
  } } },
  beforeUnmount() { this.controller?.abort() },
}
</script>
