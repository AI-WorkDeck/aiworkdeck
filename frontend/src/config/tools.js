// 底部常用工具配置（集中维护，避免页面/组件内硬编码）

export const WORKBENCH_TOOLS = [
  { key: 'variables', label: '变量库', icon: '⌘' },
  { key: 'favorites', label: '收藏夹', icon: '★' },
  { key: 'clipboard', label: '剪贴板', icon: '⎘' },
]

export function getToolByKey(key) {
  return WORKBENCH_TOOLS.find(t => t.key === key) || WORKBENCH_TOOLS[0]
}


