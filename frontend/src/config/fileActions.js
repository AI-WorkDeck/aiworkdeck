// 文件相关前端展示配置（集中维护，避免组件内硬编码文案/选项）

export const FILE_BATCH_ACTIONS = [
  { key: 'move', label: '移动', className: '' },
  { key: 'cut', label: '剪切', className: '' },
  { key: 'copy', label: '复制', className: '' },
  { key: 'delete', label: '删除', className: 'batch-btn-danger' },
]

export const FILE_BATCH_CANCEL_LABEL = '取消'

// 左侧文件树：快捷操作（集中维护，避免组件内硬编码）
// 说明：icon 采用简洁符号，尽量避免 emoji
export const FILE_TREE_QUICK_ACTIONS = [
  { key: 'newFile', label: '新建文件', title: '新建文件', iconPath: '/static/new-document_unselected.png', activeIconPath: '/static/new-document.png' },
  { key: 'newFolder', label: '新建文件夹', title: '新建文件夹', iconPath: '/static/icon_new_folder_unselected.png', activeIconPath: '/static/icon_new_folder.png' },
  { key: 'upload', label: '上传文件', title: '上传文件', iconPath: '/static/upload_unselected.png', activeIconPath: '/static/upload.png' },
  { key: 'sort', label: '排序', title: '排序', iconPath: '/static/sort_unselected.png', activeIconPath: '/static/sort.png' },
]


