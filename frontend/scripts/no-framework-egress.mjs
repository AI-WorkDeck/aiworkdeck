// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D7: uni-h5 injects a "shadow-preload" animation into its framework CSS that fetches
// https://cdn.dcloud.net.cn/img/shadow-*.png 3 s after every launch (and page-head
// shadow images from the same CDN). That is an undeclared third-party request
// (legal/PRIVACY.md); we never use those shadows, so the URLs become `none`.
const DCLOUD_URL = /url\(\s*["']?https?:\/\/[a-z0-9.-]*dcloud\.net\.cn\/[^)"']*["']?\s*\)/gi

export function stripFrameworkEgress(code) {
  return code.replace(DCLOUD_URL, 'none')
}

// Rewrites the emitted CSS assets: Vite's own CSS plugin has already collected the
// stylesheet before any `transform` hook of a user plugin could see it.
export function noFrameworkEgress() {
  return {
    name: 'no-framework-egress',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue
        const css = typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source).toString('utf8')
        const out = stripFrameworkEgress(css)
        if (out !== css) asset.source = out
      }
    },
  }
}
