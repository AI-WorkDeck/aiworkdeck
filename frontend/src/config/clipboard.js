// 剪贴板面板：类型展示配置（集中维护，避免组件内硬编码）

export const CLIPBOARD_TYPE_META = {
  TEXT: { label: '文本', tone: 'neutral' },
  IMAGE: { label: '图片', tone: 'info' },
  FILE: { label: '文件', tone: 'info' },
}

export function getClipboardTypeMeta(type) {
  if (!type) return { label: '未知', tone: 'neutral' }
  return CLIPBOARD_TYPE_META[type] || { label: String(type), tone: 'neutral' }
}
