// 左侧侧边栏（IDE 左栏）插件位配置：集中维护，避免页面内硬编码

export const LEFT_SIDEBAR_PLUGINS = [
  {
    key: 'files',
    label: '资源管理器',
    icon: '/static/documents_unselected.png',
    activeIcon: '/static/documents_selected.png'
  },
  {
    key: 'dd-files',
    label: '尽调文件',
    icon: '/static/checklist_unselected.png',
    activeIcon: '/static/checklist_selected.png'
  },
  {
    key: 'shareholder-meeting',
    label: '股东大会',
    icon: '/static/meeting_unselected.png',
    activeIcon: '/static/meeting_selected.png'
  },
]

export function getLeftSidebarPlugin(key) {
  return LEFT_SIDEBAR_PLUGINS.find(p => p.key === key) || LEFT_SIDEBAR_PLUGINS[0]
}

export function getPluginsForUser(role) {
  if (role === 'CLIENT') {
    return [
      { key: 'dd-files', label: '尽调文件', icon: '📋' }
    ]
  }
  return LEFT_SIDEBAR_PLUGINS
}

