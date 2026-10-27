// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 插件工作区是项目级单例标签；标签只持有身份，运行配置始终取当前插件清单。
import { canOpenPluginWorkspace } from '../../utils/pluginViews.js'

export const pluginWorkspaceTabMethods = {
  workspaceTabState(tabType, pluginId) {
    let opened = false
    for (const pane of ['left', 'right']) {
      const tab = this[pane === 'left' ? 'leftFiles' : 'rightFiles'].find(item => item.tabType === tabType && (!pluginId || item.pluginId === pluginId))
      if (!tab) continue
      opened = true
      const activeId = this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight']
      if ((pane === 'left' || this.splitMode) && activeId === tab.id) return 'active'
    }
    return opened ? 'open' : 'closed'
  },

  openPluginTab(pluginId) {
    const plugin = this.dynamicPlugins.find(p => p.pluginId === pluginId)
    if (!canOpenPluginWorkspace(plugin, this.hasProject && !this.isLooseWorkspace)) return false
    for (const pane of ['left', 'right']) {
      const existing = this[pane === 'left' ? 'leftFiles' : 'rightFiles'].find(t => t.tabType === 'plugin' && t.pluginId === pluginId)
      if (!existing) continue
      this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = existing.id
      this.focusedPane = pane
      if (pane === 'right' && !this.splitMode) this.splitMode = true
      this.$nextTick(() => this.triggerWorkbenchResize())
      return true
    }
    const pane = this.splitMode && this.focusedPane === 'right' ? 'right' : 'left'
    const tab = { id: `plugin-${pluginId}`, tabType: 'plugin', pluginId, name: plugin.label }
    this[pane === 'left' ? 'leftFiles' : 'rightFiles'].push(tab)
    this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = tab.id
    this.focusedPane = pane
    this.$nextTick(() => this.triggerWorkbenchResize())
    return true
  },

  // 没有通过服务端清单核验的快照只能留标签占位，不能启动 iframe。
  pluginWorkspaceTabs(files) {
    return files.filter(t => t.tabType === 'plugin').flatMap(tab => {
      const plugin = this.dynamicPlugins.find(p => p.pluginId === tab.pluginId)
      return plugin && canOpenPluginWorkspace(plugin, this.hasProject && !this.isLooseWorkspace) ? [{ tab, plugin }] : []
    })
  },

  reconcilePluginTabs() {
    if (!this.dynamicPluginsLoaded) return
    const valid = new Map(this.dynamicPlugins.filter(plugin => canOpenPluginWorkspace(plugin, this.hasProject && !this.isLooseWorkspace)).map(p => [p.pluginId, p]))
    const removed = new Set()
    for (const pane of ['left', 'right']) {
      const list = this[pane === 'left' ? 'leftFiles' : 'rightFiles']
      const activeKey = pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'
      for (let i = list.length - 1; i >= 0; i--) {
        const tab = list[i]
        if (tab.tabType !== 'plugin') continue
        const plugin = valid.get(tab.pluginId)
        if (plugin) {
          tab.name = plugin.label
          continue
        }
        list.splice(i, 1)
        removed.add(tab.id)
        if (this[activeKey] === tab.id) this[activeKey] = list[Math.min(i, list.length - 1)]?.id ?? null
      }
    }
    for (const pane of ['left', 'right']) {
      const memory = this.lastActiveIdsByMode[pane]
      for (const key of Object.keys(memory)) if (removed.has(memory[key])) memory[key] = null
    }
    if (removed.size) this.saveActiveIdsByMode()
  },
}
