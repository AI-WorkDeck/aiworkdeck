// 左侧侧边栏（IDE 左栏）插件位配置：集中维护，避免页面内硬编码

export const LEFT_SIDEBAR_PLUGINS = [
  { key: 'files', label: '文件树', icon: '📁' },
  { key: 'shareholder-meeting', label: '股东大会', icon: '🏛' }, // 占位：后续做插件功能
]

export function getLeftSidebarPlugin(key) {
  return LEFT_SIDEBAR_PLUGINS.find(p => p.key === key) || LEFT_SIDEBAR_PLUGINS[0]
}

