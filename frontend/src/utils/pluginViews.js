// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Mirror the server's validation at the UI boundary; never turn an unverified
// contribution into an arbitrary URL. Legacy frontendEntry is handled separately.
export function pluginViews(plugin, resolveEntry) {
  const seen = new Set()
  return (Array.isArray(plugin?.contributes?.views) ? plugin.contributes.views : []).flatMap(view => {
    if (!view || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(view.id || '') || seen.has(view.id)) return []
    if (!['sidebar', 'workspace'].includes(view.placement) || !['project', 'global'].includes(view.scope)) return []
    if (typeof view.entry !== 'string' || !/^web\/[a-zA-Z0-9_./-]+$/.test(view.entry) || view.entry.split('/').some(x => !x || x === '.' || x === '..')) return []
    seen.add(view.id)
    const docks = Array.isArray(view.allowedDocks) ? view.allowedDocks.filter(x => ['left', 'right', 'bottom'].includes(x)) : ['left']
    return [{ ...view, allowedDocks: docks, defaultDock: docks.includes(view.defaultDock) ? view.defaultDock : docks[0] || 'left', url: resolveEntry(plugin.id, view.entry) }]
  })
}

export function isGlobalPlugin(plugin) {
  return plugin?.views?.some(view => view.scope === 'global') === true
}
