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
  const entry = plugin?.sidebarView || plugin?.workspaceView
    || plugin?.views?.find(view => view.placement === 'sidebar')
    || plugin?.views?.find(view => view.placement === 'workspace')
  return entry?.scope === 'global'
}

// UI declarations are independent of data permissions. null/omitted preserves
// legacy navigation; an explicit empty array opts out of all standalone UI.
export function hasPluginNavigation(plugin) {
  return !!plugin && !plugin.legacyThemeGallery && (plugin.hasDeclaredViews !== true || plugin.views.length > 0)
}

export function hasPluginPanel(plugin) {
  return hasPluginNavigation(plugin) && (plugin.hasDeclaredViews !== true || !!plugin.sidebarView)
}

export function canOpenPluginWorkspace(plugin, hasProject) {
  if (!plugin || plugin.legacyThemeGallery || (plugin.hasDeclaredViews === true && !plugin.workspaceView)) return false
  return !!hasProject || plugin.workspaceView?.scope === 'global'
}

// Older theme packs used a global gallery as their preview entry. Preserve their
// lightweight behavior until those installed packs receive the explicit views: [].
export function isLegacyThemeGallery(plugin) {
  const c = plugin?.contributes
  if (!c?.themes?.length || plugin.tools?.length || plugin.permissions?.length || plugin.guide?.quickActions?.length) return false
  if (Object.entries(c).some(([key, value]) => !['themes', 'views'].includes(key) && Array.isArray(value) && value.length)) return false
  return c.views?.length === 1 && c.views[0].id === 'gallery'
    && c.views[0].placement === 'workspace' && c.views[0].scope === 'global'
    && c.views[0].entry === plugin.frontendEntry
}
