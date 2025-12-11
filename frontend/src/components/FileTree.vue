<template>
  <view class="file-tree">
    <view class="tree-content">
      <view v-if="loading" class="tree-loading">
        <text>加载中...</text>
      </view>
      <view v-else-if="files.length === 0" class="tree-empty">
        <text>暂无文件</text>
      </view>
      <view v-else class="tree-list">
        <!-- H5端使用HTML5拖拽API -->
        <!-- #ifdef H5 -->
        <view
          v-for="(item, index) in files"
          :key="item.id"
          class="tree-item"
          :class="{
            'tree-item-selected': selectedFileId === item.id,
            'tree-item-drop-target': dragOverIndex === index
          }"
          :draggable="true"
          @tap="handleItemClick(item)"
          @dragstart="handleDragStart($event, index)"
          @dragover.prevent="handleDragOver($event, index)"
          @drop="handleDrop($event, index)"
          @dragend="handleDragEnd"
        >
          <view class="tree-item-content" :style="{ paddingLeft: getItemPadding(item) }">
            <text v-if="item.isFolder && showTree" class="tree-expand-icon" @tap.stop="toggleFolder(item.id)">
              {{ expandedFolders.has(item.id) ? '▼' : '▶' }}
            </text>
            <text v-else class="tree-expand-placeholder"></text>
            <text 
              class="tree-item-icon" 
              :class="getFileIconClass(item)"
            >
              {{ getFileIconLabel(item) }}
            </text>
            <text class="tree-item-name">{{ item.name }}</text>
            <view class="tree-item-actions" @tap.stop>
              <text class="action-btn icon-btn" @tap="handleRename(item)">✏️</text>
              <text class="action-btn icon-btn" @tap="handleDelete(item)">🗑️</text>
            </view>
          </view>
          <!-- 行内上传进度条 -->
          <view v-if="uploadStatusMap[item.id]" class="upload-progress-inline">
            <view
              class="upload-progress-inline-bar"
              :style="{ width: (uploadStatusMap[item.id].progress || 0) + '%' }"
            ></view>
          </view>
          <view v-if="uploadStatusMap[item.id]" class="upload-progress-inline-text">
            {{ (uploadStatusMap[item.id].progress || 0) }}%
            <text v-if="uploadStatusMap[item.id].speed"> · {{ formatSpeed(uploadStatusMap[item.id].speed) }}</text>
            <text v-if="uploadStatusMap[item.id].eta !== null"> · 约 {{ formatEta(uploadStatusMap[item.id].eta) }}</text>
          </view>
        </view>
        <!-- #endif -->
        <!-- 非H5端使用触摸事件 -->
        <!-- #ifndef H5 -->
        <view
          v-for="(item, index) in files"
          :key="item.id"
          class="tree-item"
          :class="{ 
            'tree-item-selected': selectedFileId === item.id, 
            'tree-item-dragging': draggingIndex === index 
          }"
          @tap="handleItemClick(item)"
          @touchstart="handleTouchStart($event, index)"
          @touchmove="handleTouchMove($event, index)"
          @touchend="handleTouchEnd($event, index)"
        >
          <view class="tree-item-content" :style="{ paddingLeft: getItemPadding(item) }">
            <text v-if="item.isFolder && showTree" class="tree-expand-icon" @tap.stop="toggleFolder(item.id)">
              {{ expandedFolders.has(item.id) ? '▼' : '▶' }}
            </text>
            <text v-else class="tree-expand-placeholder"></text>
            <text 
              class="tree-item-icon" 
              :class="getFileIconClass(item)"
            >
              {{ getFileIconLabel(item) }}
            </text>
            <text class="tree-item-name">{{ item.name }}</text>
            <view class="tree-item-actions" @tap.stop>
              <text class="action-btn icon-btn" title="重命名" @tap="handleRename(item)">✏️</text>
              <text class="action-btn icon-btn" title="删除" @tap="handleDelete(item)">🗑️</text>
            </view>
          </view>
        </view>
        <!-- #endif -->
      </view>
    </view>

    <!-- 全局上传进度 -->
    <view v-if="globalUploadProgress !== null" class="global-upload">
      <view class="global-upload-bar-wrapper">
        <view class="global-upload-bar" :style="{ width: globalUploadProgress + '%' }"></view>
      </view>
      <text class="global-upload-text">
        正在上传 {{ Object.keys(uploadStatusMap).length }} 个文件 · {{ globalUploadProgress }}%
      </text>
    </view>

    <!-- 底部工具栏 -->
    <view class="tree-footer">
      <!-- 第一行：新建文件夹和新建Word -->
      <view class="footer-row">
        <button class="btn-new-folder" @tap="showCreateFolderDialog">
          新建文件夹
        </button>
        <button class="btn-new-word" @tap="handleCreateWord">
          新建Word
        </button>
      </view>
      <!-- 第二行：上传文件 -->
      <view class="footer-row">
        <button class="btn-upload" @tap="handleUploadFile">
          上传文件
        </button>
      </view>
    </view>

    <!-- 上传文件对话框（重构样式） -->
    <view v-if="showUploadDialog" class="upload-mask" @tap="showUploadDialog = false">
      <view class="upload-modal" @tap.stop>
        <view class="upload-header">
          <text class="upload-title">上传文件</text>
          <text class="upload-subtitle">选择目标位置并选择要上传的文档</text>
        </view>
        <view class="upload-body">
          <view class="upload-row">
            <text class="upload-label">上传位置</text>
            <view class="upload-field upload-field-clickable" @tap="showFolderSelector = true">
              <text class="upload-folder-icon">📁</text>
              <text class="upload-field-text">
                {{ selectedUploadParent ? getFolderPath(selectedUploadParent) : '根目录' }}
              </text>
            </view>
          </view>
          <view class="upload-row">
            <text class="upload-label">上传文件</text>
            <view class="upload-field upload-field-clickable" @tap="selectFiles">
              <view v-if="selectedFiles.length === 0">
                <text class="upload-field-text upload-placeholder">选择文件（支持多选）</text>
              </view>
              <view v-else class="upload-selected-list">
                <text
                  v-for="(file, index) in selectedFiles"
                  :key="index"
                  class="upload-selected-item"
                >
                  {{ file.name }}
                </text>
              </view>
            </view>
          </view>
        </view>
        <view class="upload-footer">
          <view class="upload-btn upload-btn-secondary" @tap="cancelUpload">取消</view>
          <view
            class="upload-btn upload-btn-primary"
            :class="{ 'upload-btn-disabled': !selectedFiles.length }"
            @tap="selectedFiles.length ? confirmUpload() : null"
          >
            确定上传
          </view>
        </view>
      </view>
    </view>

    <!-- 文件夹选择器（二级弹窗，视觉与上传弹窗统一） -->
    <view v-if="showFolderSelector" class="upload-mask" @tap="showFolderSelector = false">
      <view class="folder-modal" @tap.stop>
        <view class="upload-header">
          <text class="upload-title">选择文件夹</text>
        </view>
        <view class="folder-body">
          <view
            class="folder-item root-folder"
            :class="{ active: tempSelectedParent === null }"
            @tap="selectUploadParent(null)"
          >
            <text class="folder-icon">📁</text>
            <text class="folder-name">根目录</text>
          </view>

          <view
            v-for="folder in folderTree"
            :key="folder.id"
            class="folder-item"
            :class="{ active: tempSelectedParent === folder.id }"
            @tap="selectUploadParent(folder.id)"
          >
            <!-- 层级缩进 -->
            <view class="folder-indent" :style="{ width: (folder.level * 24) + 'rpx' }"></view>
            <!-- 展开/收起箭头 -->
            <text
              v-if="folder.children && folder.children.length"
              class="folder-arrow"
              @tap.stop="toggleFolderSelectorExpand(folder.id)"
            >
              {{ folderSelectorExpanded[folder.id] === false ? '▶' : '▼' }}
            </text>
            <text v-else class="folder-arrow-placeholder"></text>
            <!-- 图标与名称 -->
            <text class="folder-icon">📂</text>
            <text class="folder-name">{{ folder.name }}</text>
          </view>

          <view v-if="folderTree.length === 0" class="empty-tip">
            <text>暂无其他文件夹</text>
          </view>
        </view>
        <view class="upload-footer">
          <view class="upload-btn upload-btn-secondary" @tap="showFolderSelector = false">取消</view>
          <view class="upload-btn upload-btn-primary" @tap="confirmFolderSelection">确定</view>
        </view>
      </view>
    </view>

    <!-- 新建文件夹对话框 -->
    <view v-if="showCreateDialog" class="dialog-overlay" @tap="showCreateDialog = false">
      <view class="dialog-content" @tap.stop>
        <view class="dialog-header">
          <text class="dialog-title">新建文件夹</text>
        </view>
        <view class="dialog-body">
          <input
            v-model="newFolderName"
            class="dialog-input"
            placeholder="请输入文件夹名称"
            @confirm="handleCreateFolder"
          />
        </view>
        <view class="dialog-footer">
          <button class="dialog-btn dialog-btn-default" @tap="showCreateDialog = false">取消</button>
          <button class="dialog-btn dialog-btn-primary" @tap="handleCreateFolder">确定</button>
        </view>
      </view>
    </view>

    <!-- 重命名对话框 -->
    <view v-if="showRenameDialog" class="dialog-overlay" @tap="showRenameDialog = false">
      <view class="dialog-content" @tap.stop>
        <view class="dialog-header">
          <text class="dialog-title">重命名</text>
        </view>
        <view class="dialog-body">
          <input
            v-model="renameValue"
            class="dialog-input"
            placeholder="请输入新名称"
            @confirm="handleConfirmRename"
          />
        </view>
        <view class="dialog-footer">
          <button class="dialog-btn dialog-btn-default" @tap="showRenameDialog = false">取消</button>
          <button class="dialog-btn dialog-btn-primary" @tap="handleConfirmRename">确定</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getProjectFiles, createFolder, createFile, renameFile, deleteFile, moveFile, getApiBaseUrl } from '@/services/api.js'
import { getAuthHeaders } from '@/utils/auth.js'

export default {
  name: 'FileTree',
  props: {
    projectId: {
      type: [Number, String],
      required: true
    },
    parentId: {
      type: Number,
      default: null
    }
  },
  data() {
    return {
      files: [],
      loading: false,
      selectedFileId: null,
      showCreateDialog: false,
      showRenameDialog: false,
      newFolderName: '',
      renameValue: '',
      renamingFile: null,
      // 拖拽相关
      draggingIndex: -1,
      dragStartY: 0,
      dragCurrentY: 0,
      isDragging: false,
      dragOverIndex: -1, // H5拖拽悬停索引
      draggedIndex: -1, // H5拖拽源索引
      // 树形结构相关
      allFiles: [], // 完整文件树
      expandedFolders: new Set(), // 展开的文件夹ID集合
      showTree: true, // 是否显示完整树形结构（默认false，只显示当前文件夹）
      // 上传文件相关
      showUploadDialog: false,
      showFolderSelector: false,
      selectedUploadParent: null,
      selectedFiles: [], // 选中的文件列表
      tempSelectedParent: null, // 临时选中的父文件夹（用于文件夹选择器）
      // 上传状态：fileId -> { name, size, uploaded, progress, speed, eta, startTime }
      uploadStatusMap: {},
      // 文件夹选择器展开状态（id -> bool），默认 true
      folderSelectorExpanded: {}
    }
  },
  computed: {
    folders() {
      return this.allFiles.filter(f => f.isFolder)
    },
    // 用于“选择上传位置”弹窗的文件夹树（扁平化列表）
    // 始终返回数组，避免 undefined.length 报错
    folderTree() {
      if (!Array.isArray(this.allFiles) || this.allFiles.length === 0) {
        return []
      }

      // 只取文件夹
      const folders = this.allFiles.filter(f => f && f.isFolder)
      if (folders.length === 0) return []

      // 构建 id -> 节点 映射
      const nodeMap = new Map()
      folders.forEach(f => {
        // 避免引用同一个对象，复制一份
        nodeMap.set(f.id, {
          ...f,
          children: [],
          level: 0
        })
      })

      // 构建树结构
      const roots = []
      folders.forEach(f => {
        const node = nodeMap.get(f.id)
        if (node.parentId != null && nodeMap.has(node.parentId)) {
          const parent = nodeMap.get(node.parentId)
          parent.children.push(node)
        } else {
          // parentId 为 null 或找不到父节点，都视为根
          roots.push(node)
        }
      })

      // 递归扁平化，并计算 level（根据 folderSelectorExpanded 控制展开/收起）
      const result = []
      const traverse = (nodes, level) => {
        if (!Array.isArray(nodes)) return
        // 按 sortOrder 排序，确保顺序与左侧树一致
        nodes
          .slice()
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
          .forEach(node => {
            node.level = level
            result.push(node)
            const hasChildren = node.children && node.children.length > 0
            const expanded = this.folderSelectorExpanded[node.id] !== false // 默认展开
            if (hasChildren && expanded) {
              traverse(node.children, level + 1)
            }
          })
      }

      traverse(roots, 0)
      return result
    },
    // 全局上传进度（0-100），如果没有上传任务则返回 null
    globalUploadProgress() {
      const entries = Object.values(this.uploadStatusMap)
      if (!entries.length) return null
      // 按总字节数加权平均
      let totalSize = 0
      let totalUploaded = 0
      entries.forEach(info => {
        const size = info.size || 0
        totalSize += size || 1
        totalUploaded += (info.uploaded || 0)
      })
      if (!totalSize) return null
      return Math.min(100, Math.round((totalUploaded / totalSize) * 100))
    }
  },
  watch: {
    projectId: {
      immediate: true,
      handler() {
        this.loadFiles()
      }
    },
    parentId: {
      immediate: true,
      handler() {
        this.loadFiles()
      }
    },
    // 打开文件夹选择器时，初始化展开状态并同步当前选择
    showFolderSelector(val) {
      if (val) {
        const expanded = {}
        this.folders.forEach(f => {
          expanded[f.id] = true
        })
        this.folderSelectorExpanded = expanded
        this.tempSelectedParent = this.selectedUploadParent
      }
    }
  },
  methods: {
    async loadFiles() {
      if (!this.projectId) {
        console.warn('FileTree: projectId 未设置，无法加载文件列表')
        return
      }
      
      this.loading = true
      try {
        // 确保 projectId 是数字类型
        const projectId = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
        if (isNaN(projectId)) {
          throw new Error('项目ID格式错误')
        }
        if (this.showTree) {
          // 加载完整文件树
          this.allFiles = await getProjectFiles(projectId, null, true)
          this.files = this.buildTreeView(this.allFiles, this.parentId)
        } else {
          // 只加载当前文件夹下的文件
          this.files = await getProjectFiles(projectId, this.parentId)
        }
        console.log('加载文件列表成功:', this.files)
      } catch (error) {
        // 完整打印错误信息，包括堆栈、响应数据等
        console.error('加载文件列表失败:', error)
        console.error('错误详情:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          response: error.response,
          data: error.data,
          statusCode: error.statusCode,
          errMsg: error.errMsg,
          toString: error.toString()
        })
        uni.showToast({
          title: error.message || '加载失败',
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.loading = false
      }
    },
    handleItemClick(item) {
      if (item.isFolder) {
        // 如果是文件夹，切换展开/收起
        if (this.showTree) {
          this.toggleFolder(item.id)
        } else {
          // 如果不显示树形结构，点击文件夹时触发选择事件（由父组件处理导航）
          this.selectedFileId = item.id
          this.$emit('file-select', item)
        }
      } else {
        // 如果是文件，选中并触发选择事件
        this.selectedFileId = item.id
        this.$emit('file-select', item)
      }
    },
    showCreateFolderDialog() {
      this.newFolderName = ''
      this.showCreateDialog = true
    },
    async handleCreateFolder() {
      if (!this.newFolderName.trim()) {
        uni.showToast({
          title: '请输入文件夹名称',
          icon: 'none'
        })
        return
      }

      if (!this.projectId) {
        uni.showToast({
          title: '项目ID未设置，无法创建文件夹',
          icon: 'none'
        })
        return
      }

      try {
        // 确保 projectId 是数字类型
        const projectId = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
        if (isNaN(projectId)) {
          throw new Error('项目ID格式错误')
        }
        await createFolder(projectId, this.parentId, this.newFolderName.trim())
        this.showCreateDialog = false
        this.newFolderName = ''
        await this.loadFiles()
        uni.showToast({
          title: '创建成功',
          icon: 'success'
        })
      } catch (error) {
        console.error('创建文件夹失败:', error)
        uni.showToast({
          title: error.message || '创建失败',
          icon: 'none'
        })
      }
    },
    async handleCreateWord() {
      if (!this.projectId) {
        uni.showToast({
          title: '项目ID未设置，无法创建文件',
          icon: 'none'
        })
        return
      }

      try {
        // 确保 projectId 是数字类型
        const projectId = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
        if (isNaN(projectId)) {
          throw new Error('项目ID格式错误')
        }

        // 生成唯一的 wpsFileId
        const wpsFileId = `project_${projectId}_doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        
        // 创建Word文件
        await createFile(
          projectId,
          this.parentId,
          'newdocument.docx',
          'docx',
          null, // fileSize
          null, // filePath
          wpsFileId
        )
        
        await this.loadFiles()
        uni.showToast({
          title: '创建成功',
          icon: 'success'
        })
      } catch (error) {
        console.error('创建Word文件失败:', error)
        uni.showToast({
          title: error.message || '创建失败',
          icon: 'none'
        })
      }
    },
    handleRename(item) {
      this.renamingFile = item
      this.renameValue = item.name
      this.showRenameDialog = true
    },
    async handleConfirmRename() {
      if (!this.renameValue.trim()) {
        uni.showToast({
          title: '请输入新名称',
          icon: 'none'
        })
        return
      }

      if (!this.projectId) {
        uni.showToast({
          title: '项目ID未设置',
          icon: 'none'
        })
        return
      }

      try {
        const projectId = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
        if (isNaN(projectId)) {
          throw new Error('项目ID格式错误')
        }
        await renameFile(projectId, this.renamingFile.id, this.renameValue.trim())
        this.showRenameDialog = false
        this.renamingFile = null
        this.renameValue = ''
        await this.loadFiles()
        uni.showToast({
          title: '重命名成功',
          icon: 'success'
        })
      } catch (error) {
        console.error('重命名失败:', error)
        uni.showToast({
          title: error.message || '重命名失败',
          icon: 'none'
        })
      }
    },
    async handleDelete(item) {
      if (!this.projectId) {
        uni.showToast({
          title: '项目ID未设置',
          icon: 'none'
        })
        return
      }

      uni.showModal({
        title: '确认删除',
        content: `确定要删除${item.isFolder ? '文件夹' : '文件'} "${item.name}" 吗？${item.isFolder ? '文件夹内的所有文件也会被删除。' : ''}`,
        success: async (res) => {
          if (res.confirm) {
            try {
              const projectId = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
              if (isNaN(projectId)) {
                throw new Error('项目ID格式错误')
              }
              await deleteFile(projectId, item.id)
              await this.loadFiles()
              uni.showToast({
                title: '删除成功',
                icon: 'success'
              })
              // 如果删除的是当前选中的文件，清除选中状态
              if (this.selectedFileId === item.id) {
                this.selectedFileId = null
                this.$emit('file-select', null)
              }
            } catch (error) {
              console.error('删除失败:', error)
              uni.showToast({
                title: error.message || '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },
    getFileIcon(fileType) {
      if (!fileType) return '📄'
      const type = fileType.toLowerCase()
      if (type === 'doc' || type === 'docx') return '📝'
      if (type === 'pdf') return '📕'
      if (type === 'xls' || type === 'xlsx') return '📊'
      if (type === 'ppt' || type === 'pptx') return '📽️'
      return '📄'
    },
    // 构建树形视图
    buildTreeView(allFiles, parentId) {
      const result = []
      const children = allFiles.filter(f => {
        if (parentId === null) {
          return f.parentId === null
        }
        return f.parentId === parentId
      })
      
      for (const item of children) {
        result.push(item)
        // 如果是文件夹且已展开，递归添加子项
        if (item.isFolder && this.expandedFolders.has(item.id)) {
          const subItems = this.buildTreeView(allFiles, item.id)
          result.push(...subItems)
        }
      }
      
      return result
    },
    // 切换文件夹展开/收起
    toggleFolder(folderId) {
      if (this.expandedFolders.has(folderId)) {
        this.expandedFolders.delete(folderId)
      } else {
        this.expandedFolders.add(folderId)
      }
      // 重新构建树形视图
      if (this.showTree && this.allFiles.length > 0) {
        this.files = this.buildTreeView(this.allFiles, this.parentId)
      }
    },
    // 计算项目的缩进（用于树形结构）
    getItemPadding(item) {
      if (!this.showTree) return '0'
      // 计算层级深度
      let depth = 0
      let current = item
      while (current && current.parentId !== null) {
        depth++
        current = this.allFiles.find(f => f.id === current.parentId)
        if (!current) break
      }
      return `${depth * 24}rpx`
    },
    // 切换选择器中某个文件夹的展开/收起
    toggleFolderSelectorExpand(folderId) {
      const current = this.folderSelectorExpanded[folderId]
      this.$set(this.folderSelectorExpanded, folderId, current === false ? true : false)
    },
    // 根据文件类型返回图标样式类
    getFileIconClass(item) {
      if (item.isFolder) return 'icon-folder'
      const t = (item.fileType || '').toLowerCase()
      if (t === 'doc' || t === 'docx') return 'icon-word'
      if (t === 'xls' || t === 'xlsx') return 'icon-excel'
      if (t === 'ppt' || t === 'pptx') return 'icon-ppt'
      if (t === 'pdf') return 'icon-pdf'
      return 'icon-file'
    },
    // 根据文件类型返回图标文字（经典 Office 首字母）
    getFileIconLabel(item) {
      if (item.isFolder) return ''
      const t = (item.fileType || '').toLowerCase()
      if (t === 'doc' || t === 'docx') return 'W'
      if (t === 'xls' || t === 'xlsx') return 'X'
      if (t === 'ppt' || t === 'pptx') return 'P'
      if (t === 'pdf') return 'PDF'
      return 'F'
    },
    // 进度条显示速度（格式化为 KB/s 或 MB/s）
    formatSpeed(speedBytesPerSec) {
      if (!speedBytesPerSec || speedBytesPerSec <= 0) return ''
      const kb = speedBytesPerSec / 1024
      if (kb < 1024) {
        return kb.toFixed(1) + ' KB/s'
      }
      const mb = kb / 1024
      return mb.toFixed(1) + ' MB/s'
    },
    // 格式化剩余时间（秒 => Xm Ys）
    formatEta(etaSeconds) {
      if (etaSeconds == null || etaSeconds <= 0) return '完成'
      const s = Math.round(etaSeconds)
      const m = Math.floor(s / 60)
      const rest = s % 60
      if (m === 0) return `${rest}s`
      if (rest === 0) return `${m}min`
      return `${m}min ${rest}s`
    },
    // H5端拖拽方法（HTML5 Drag and Drop API）
    handleDragStart(e, index) {
      console.log('拖拽开始:', index)
      this.draggedIndex = index
      // 检查 dataTransfer 是否存在（在某些环境中可能不存在）
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        // 设置拖拽数据
        try {
          e.dataTransfer.setData('text/plain', index.toString())
        } catch (err) {
          // 某些环境可能不支持 setData，静默失败
          console.warn('设置拖拽数据失败:', err)
        }
      }
    },
    handleDragOver(e, index) {
      e.preventDefault()
      // 检查 dataTransfer 是否存在（在某些环境中可能不存在）
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move'
      }
      if (this.dragOverIndex !== index) {
        this.dragOverIndex = index
      }
    },
    async handleDrop(e, index) {
      e.preventDefault()
      console.log('拖拽放下:', { draggedIndex: this.draggedIndex, targetIndex: index })
      
      if (this.draggedIndex === -1 || this.draggedIndex === index) {
        this.dragOverIndex = -1
        this.draggedIndex = -1
        return
      }

      try {
        const projectId = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
        const draggedItem = this.files[this.draggedIndex]
        const targetItem = this.files[index]
        
        let targetParentId
        let newSortOrder = targetItem.sortOrder

        // 如果目标是文件夹，且不是拖拽同级排序（即不是仅仅改变顺序），则移动到文件夹内
        // 注意：这里简单判定，如果拖拽到文件夹上，就是移动到文件夹内
        // 用户反馈：希望能跨层级移动到文件夹里
        if (targetItem.isFolder && draggedItem.parentId !== targetItem.id) {
           targetParentId = targetItem.id
           // 移动到文件夹内时，暂定置顶或由后端处理排序
           newSortOrder = 0 
        } else {
           // 否则认为是同级排序或移动到同一目录下
           targetParentId = this.showTree ? targetItem.parentId : this.parentId
        }
        
        await moveFile(projectId, draggedItem.id, targetParentId, newSortOrder)
        await this.loadFiles()
        uni.showToast({
          title: '移动成功',
          icon: 'success'
        })
      } catch (error) {
        console.error('移动文件失败:', error)
        uni.showToast({
          title: error.message || '移动失败',
          icon: 'none'
        })
      }

      this.dragOverIndex = -1
      this.draggedIndex = -1
    },
    handleDragEnd() {
      this.dragOverIndex = -1
      this.draggedIndex = -1
    },
    // 非H5端触摸拖拽方法
    handleTouchStart(e, index) {
      this.draggingIndex = index
      this.dragStartY = e.touches[0].clientY
      this.isDragging = false
    },
    handleTouchMove(e, index) {
      if (this.draggingIndex === -1) return
      this.dragCurrentY = e.touches[0].clientY
      const deltaY = this.dragCurrentY - this.dragStartY
      if (Math.abs(deltaY) > 10) {
        this.isDragging = true
      }
    },
    async handleTouchEnd(e, index) {
      if (!this.isDragging || this.draggingIndex === -1) {
        this.draggingIndex = -1
        return
      }

      const endY = e.changedTouches[0].clientY
      const deltaY = endY - this.dragStartY
      const itemHeight = 60 // 估算每个项目高度（rpx转px约30px）
      const targetIndex = Math.round(deltaY / itemHeight) + index

      if (targetIndex !== index && targetIndex >= 0 && targetIndex < this.files.length) {
        try {
          const projectId = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
          const draggedItem = this.files[index]
          const targetItem = this.files[targetIndex]
          
          let targetParentId
          let newSortOrder = targetItem.sortOrder

          if (targetItem.isFolder && draggedItem.parentId !== targetItem.id) {
             targetParentId = targetItem.id
             newSortOrder = 0
          } else {
             targetParentId = this.showTree ? targetItem.parentId : this.parentId
          }
          
          await moveFile(projectId, draggedItem.id, targetParentId, newSortOrder)
          await this.loadFiles()
          uni.showToast({
            title: '移动成功',
            icon: 'success'
          })
        } catch (error) {
          console.error('移动文件失败:', error)
          uni.showToast({
            title: error.message || '移动失败',
            icon: 'none'
          })
        }
      }

      this.draggingIndex = -1
      this.isDragging = false
    },
    // 上传文件相关方法
    handleUploadFile() {
      this.selectedUploadParent = this.parentId
      this.selectedFiles = []
      this.showUploadDialog = true
    },
    selectFiles() {
      // uni-app 文件选择
      uni.chooseFile({
        count: 9, // 最多选择9个文件
        extension: ['.doc', '.docx', '.pdf', '.xls', '.xlsx', '.ppt', '.pptx'],
        success: (res) => {
          this.selectedFiles = res.tempFiles.map(file => ({
            name: file.name,
            path: file.path,
            size: file.size
          }))
        },
        fail: (err) => {
          console.error('选择文件失败:', err)
          uni.showToast({
            title: '选择文件失败',
            icon: 'none'
          })
        }
      })
    },
    removeFile(index) {
      this.selectedFiles.splice(index, 1)
    },
    selectUploadParent(parentId) {
      this.tempSelectedParent = parentId
    },
    confirmFolderSelection() {
      this.selectedUploadParent = this.tempSelectedParent
      this.showFolderSelector = false
    },
    toggleFolderExpand(folderId) {
      if (this.expandedFolderIds.has(folderId)) {
        this.expandedFolderIds.delete(folderId)
      } else {
        this.expandedFolderIds.add(folderId)
      }
      // 触发响应式更新
      this.$forceUpdate()
    },
    getFolderPath(folderId) {
      // 如果传入的是ID，查找对应的文件夹
      if (typeof folderId === 'number' || typeof folderId === 'string') {
        const folder = this.allFiles.find(f => f.id === folderId)
        if (folder) {
          return this.buildFolderPath(folder)
        }
        return '未知文件夹'
      }
      // 如果传入的是文件夹对象
      if (folderId && folderId.name) {
        return this.buildFolderPath(folderId)
      }
      return '根目录'
    },
    // 构建文件夹完整路径
    buildFolderPath(folder) {
      if (!folder) return ''
      const path = [folder.name]
      let current = folder
      // 向上查找父文件夹，构建完整路径
      while (current && current.parentId !== null) {
        const parent = this.allFiles.find(f => f.id === current.parentId)
        if (parent) {
          path.unshift(parent.name)
          current = parent
        } else {
          break
        }
      }
      return path.join(' / ')
    },
    cancelUpload() {
      this.showUploadDialog = false
      this.selectedFiles = []
      this.selectedUploadParent = null
    },
    async confirmUpload() {
      if (this.selectedFiles.length === 0) {
        uni.showToast({
          title: '请选择要上传的文件',
          icon: 'none'
        })
        return
      }

      if (!this.projectId) {
        uni.showToast({
          title: '项目ID未设置',
          icon: 'none'
        })
        return
      }

      try {
        const projectId = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
        if (isNaN(projectId)) {
          throw new Error('项目ID格式错误')
        }
        const files = [...this.selectedFiles]
        const parentId = this.selectedUploadParent

        // 关闭弹窗，清空选择
        this.showUploadDialog = false
        this.selectedFiles = []
        this.selectedUploadParent = null

        // 逐个上传文件，并展示进度
        for (const file of files) {
          try {
            await this.uploadSingleFile(projectId, file, parentId)
          } catch (error) {
            console.error('上传文件失败:', error)
            uni.showToast({
              title: error.message || `上传 ${file.name} 失败`,
              icon: 'none'
            })
          }
        }

      } catch (error) {
        console.error('上传文件失败:', error)
        uni.showToast({
          title: error.message || '上传失败',
          icon: 'none'
        })
      }
    },
    async uploadSingleFile(projectId, file, parentId) {
      // 1. 先创建文件记录
      const fileType = this.getFileTypeFromName(file.name)
      const wpsFileId = `project_${projectId}_doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      // 创建文件记录
      const createdFile = await createFile(
        projectId,
        parentId,
        file.name,
        fileType,
        file.size,
        null, // filePath 将在上传后设置
        wpsFileId
      )

      // 将该文件加入上传状态映射
      this.$set(this.uploadStatusMap, createdFile.id, {
        fileId: createdFile.id,
        name: createdFile.name,
        size: file.size || 0,
        uploaded: 0,
        progress: 0,
        speed: 0,
        eta: null,
        startTime: Date.now()
      })

      // 刷新一次文件列表，让新文件出现在树中
      await this.loadFiles()

      // 2. 上传文件内容（带进度）
      return new Promise((resolve, reject) => {
        const status = this.uploadStatusMap[createdFile.id]
        const baseUrl = this.getApiBaseUrl()
        const url = baseUrl.endsWith('/') 
          ? `${baseUrl}api/files/${wpsFileId}/upload`
          : `${baseUrl}/api/files/${wpsFileId}/upload`

        const uploadTask = uni.uploadFile({
          url: url,
          filePath: file.path,
          name: 'file',
          header: this.getAuthHeaders(),
          success: (res) => {
            try {
              const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
              if (data.code === 0) {
                // 上传完成
                if (status) {
                  status.uploaded = status.size
                  status.progress = 100
                  status.speed = 0
                  status.eta = null
                }
                // 短暂展示100%后移除
                setTimeout(async () => {
                  this.$delete(this.uploadStatusMap, createdFile.id)
                  await this.loadFiles()
                }, 800)
                resolve(createdFile)
              } else {
                reject(new Error(data.message || '上传失败'))
              }
            } catch (e) {
              console.error('解析响应失败:', e, res.data)
              reject(new Error('解析响应失败'))
            }
          },
          fail: (err) => {
            console.error('上传失败:', err)
            reject(new Error(err.errMsg || '上传失败'))
          }
        })

        // 进度回调：更新上传状态（进度、速度、预估剩余时间）
        if (uploadTask && uploadTask.onProgressUpdate && status) {
          uploadTask.onProgressUpdate((res) => {
            const now = Date.now()
            const elapsed = (now - status.startTime) / 1000 // s
            const totalBytes = res.totalBytesExpectedToSend || status.size || 0
            const sentBytes = res.totalBytesSent || (totalBytes * (res.progress / 100))

            status.uploaded = sentBytes
            status.progress = res.progress

            if (elapsed > 0 && sentBytes > 0) {
              const speed = sentBytes / elapsed // bytes/s
              status.speed = speed
              const remaining = Math.max(totalBytes - sentBytes, 0)
              status.eta = speed > 0 ? remaining / speed : null
            }

            this.$forceUpdate()
          })
        }
      })
    },
    getFileTypeFromName(fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase()
      const typeMap = {
        'doc': 'doc',
        'docx': 'docx',
        'pdf': 'pdf',
        'xls': 'xls',
        'xlsx': 'xlsx',
        'ppt': 'ppt',
        'pptx': 'pptx'
      }
      return typeMap[ext] || 'docx'
    },
    getApiBaseUrl() {
      return getApiBaseUrl()
    },
    getAuthHeaders() {
      return getAuthHeaders()
    }
  }
}
</script>

<style lang="scss" scoped>
.file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.tree-toolbar {
  padding: 12rpx 16rpx;
  border-bottom: 1rpx solid #e5e7eb;
  display: flex;
  gap: 8rpx;
  background-color: #ffffff;
}

.btn-new-folder,
.btn-new-word {
  flex: 1;
  height: 64rpx;
  font-size: 26rpx;
  padding: 0;
  line-height: 64rpx;
  border-radius: 8rpx;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.btn-new-folder {
  background-color: #ffffff;
  border-color: #12344D;
  color: #12344D;
}

.btn-new-folder:active {
  background-color: #f0f4f8;
}

.btn-new-word {
  background-color: #12344D;
  color: #ffffff;
}

.btn-new-word:active {
  background-color: #0e2a3f;
}

.tree-content {
  flex: 1;
  overflow-y: auto;
}

.tree-footer {
  padding: 12rpx 16rpx;
  border-top: 1rpx solid #e5e7eb;
  background-color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.footer-row {
  display: flex;
  gap: 8rpx;
}

.btn-upload {
  flex: 1;
  height: 64rpx;
  font-size: 26rpx;
  padding: 0;
  line-height: 64rpx;
  border-radius: 8rpx;
  border: 1px solid transparent;
  transition: all 0.2s;
  background-color: #12344D;
  color: #ffffff;
}

.btn-upload:active {
  background-color: #0e2a3f;
}

.upload-dialog {
  width: 600px; /* 桌面端固定宽度 */
  max-width: 90vw; /* 移动端响应式 */
  height: 70vh;
  max-height: 800px;
  background-color: #fff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  /* 确保不被压缩 */
  flex-shrink: 0; 
}

.folder-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background-color: #f8f9fa;
}

.folder-body {
  padding: 24rpx 40rpx;
  max-height: 520rpx;
  overflow-y: auto;
  background-color: #ffffff;
}

.folder-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  background-color: transparent;
}

.folder-item:hover {
  background-color: #e9ecef;
}

.folder-item.active {
  background-color: #e3f2fd;
  color: #0d6efd;
  font-weight: 500;
}

.folder-item.root-folder {
  border-bottom: 1px solid #dee2e6;
  margin-bottom: 8px;
  font-weight: bold;
}

.folder-icon {
  margin-right: 8px;
  font-size: 18px;
}

.folder-indent {
  flex-shrink: 0;
}

.folder-arrow {
  width: 32rpx;
  text-align: center;
  margin-right: 8rpx;
  color: #6b7280;
}

.folder-arrow-placeholder {
  width: 32rpx;
  margin-right: 8rpx;
}

.tree-line {
  color: #adb5bd;
  margin-right: 6px;
  font-family: monospace;
}

.empty-tip {
  text-align: center;
  color: #adb5bd;
  padding: 20px;
  font-size: 14px;
}

.folder-item:active {
  background-color: #e5e7eb;
}

.folder-item.active {
  background-color: #e0f2fe;
  border: 1px solid #12344D;
}

.folder-item.root-folder {
  font-weight: 600;
  background-color: #ffffff;
  border: 1px solid #12344D;
}

.folder-icon {
  font-size: 32rpx;
  margin-right: 12rpx;
  flex-shrink: 0;
}

.folder-name {
  flex: 1;
  font-size: 28rpx;
  color: #1f2430;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-expand {
  font-size: 24rpx;
  color: #666;
  margin-left: 8rpx;
  width: 32rpx;
  text-align: center;
  flex-shrink: 0;
}

.folder-level-1 {
  background-color: #fafafa;
}

.folder-level-2 {
  background-color: #f5f5f5;
}

.folder-level-3 {
  background-color: #f0f0f0;
}

.tree-loading,
.tree-empty {
  padding: 40rpx;
  text-align: center;
  color: #9ca3af;
}

.tree-list {
  padding: 8rpx;
}

.tree-item {
  padding: 12rpx 8rpx;
  border-radius: 8rpx;
  margin-bottom: 4rpx;
  transition: background-color 0.2s;
}

.tree-item:hover {
  background-color: #f3f4f6;
}

.tree-item:active {
  background-color: #f3f4f6;
}

.tree-item-selected {
  background-color: #e0f2fe;
}

.tree-item-dragging {
  opacity: 0.5;
  transform: scale(0.95);
}

/* H5拖拽样式 */
.tree-item[draggable="true"] {
  cursor: move;
}

/* 拖拽目标高亮 */
.tree-item-drop-target {
  outline: 2rpx dashed #2563eb;
  background-color: #eff6ff;
}

.tree-item[draggable="true"]:hover {
  background-color: #f0f0f0;
}

.tree-item-content {
  position: relative; /* 确保内容在进度条之上 */
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 64rpx; /* 增加点击区域 */
}

/* 树引导线 - 竖线 */
.tree-guide-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: transparent;
  border-left: 1px dashed #e5e7eb;
  pointer-events: none;
}

/* 上传进度条样式 */
.upload-progress-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background-color: rgba(64, 158, 255, 0.2);
  transition: width 0.3s ease;
  z-index: 0;
}

.tree-expand-icon {
  font-size: 24rpx;
  color: #6b7280;
  width: 32rpx;
  display: inline-block;
  text-align: center;
  cursor: pointer;
}

.tree-expand-placeholder {
  width: 32rpx;
  display: inline-block;
}

.tree-item-icon {
  margin-right: 8rpx;
  font-size: 24rpx;
  color: #6b7280;
}

/* 经典 Office 风格图标 */
.tree-item-icon.icon-folder {
  width: 32rpx;
  height: 24rpx;
  border-radius: 4rpx;
  border: 2rpx solid #6b7280;
  position: relative;
}

.tree-item-icon.icon-folder::before {
  content: '';
  position: absolute;
  top: -6rpx;
  left: 2rpx;
  width: 14rpx;
  height: 6rpx;
  border-radius: 3rpx 3rpx 0 0;
  background-color: #e5e7eb;
}

.tree-item-icon.icon-word,
.tree-item-icon.icon-excel,
.tree-item-icon.icon-ppt,
.tree-item-icon.icon-pdf,
.tree-item-icon.icon-file {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  border-radius: 6rpx;
  font-size: 18rpx;
  font-weight: 600;
  color: #ffffff;
}

.tree-item-icon.icon-word {
  background: linear-gradient(135deg, #185abd, #2b579a);
}

.tree-item-icon.icon-excel {
  background: linear-gradient(135deg, #107c41, #185c37);
}

.tree-item-icon.icon-ppt {
  background: linear-gradient(135deg, #c43e1c, #b7472a);
}

.tree-item-icon.icon-pdf {
  background: linear-gradient(135deg, #d32f2f, #b71c1c);
  font-size: 14rpx;
}

.tree-item-icon.icon-file {
  background: linear-gradient(135deg, #4b5563, #374151);
}

.tree-item-name {
  flex: 1;
  font-size: 28rpx;
  color: #1f2430;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-item-actions {
  display: flex;
  gap: 16rpx;
  opacity: 0;
  transition: opacity 0.2s;
}

.tree-item:hover .tree-item-actions,
.tree-item-selected .tree-item-actions {
  opacity: 1;
}

.action-btn {
  font-size: 24rpx;
  color: #2e7c9f;
  padding: 4rpx 8rpx;
}

.action-btn:active {
  opacity: 0.7;
}

.action-btn.icon-btn {
  width: 32rpx;
  height: 32rpx;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  transition: background-color 0.2s, color 0.2s;
}

.action-btn.icon-btn:hover {
  background-color: #e5e7eb;
  color: #111827;
}

/* 行内上传进度条 */
.upload-progress-inline {
  position: relative;
  margin-top: 4rpx;
  height: 8rpx;
  border-radius: 999px;
  background-color: #e5e7eb;
  overflow: hidden;
}

.upload-progress-inline-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, #3b82f6, #2563eb);
  transition: width 0.2s ease-out;
}

.upload-progress-inline-text {
  margin-left: 8rpx;
  font-size: 20rpx;
  color: #6b7280;
}

/* 全局上传进度条 */
.global-upload {
  padding: 8rpx 16rpx;
  border-top: 1rpx solid #e5e7eb;
  background-color: #f9fafb;
}

.global-upload-bar-wrapper {
  position: relative;
  height: 8rpx;
  border-radius: 999px;
  background-color: #e5e7eb;
  overflow: hidden;
}

.global-upload-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, #3b82f6, #2563eb);
  transition: width 0.2s ease-out;
}

.global-upload-text {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: #6b7280;
}

/* 上传对话框重构样式 */
.upload-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.upload-modal {
  width: 640rpx;
  max-width: 92vw;
  background-color: #ffffff;
  border-radius: 16rpx;
  box-shadow: 0 16rpx 40rpx rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
}

.folder-modal {
  width: 580rpx;
  max-width: 88vw;
  background-color: #ffffff;
  border-radius: 16rpx;
  box-shadow: 0 12rpx 32rpx rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
}

.upload-header {
  padding: 32rpx 40rpx 16rpx;
  border-bottom: 1rpx solid #E0E0E0;
}

.upload-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #12344D;
}

.upload-subtitle {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #666666;
}

.upload-body {
  padding: 24rpx 40rpx 8rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.upload-row {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.upload-label {
  font-size: 26rpx;
  color: #1A1A1A;
}

.upload-field {
  background-color: #F7F5F0;
  border-radius: 12rpx;
  border: 1rpx solid #E0E0E0;
  padding: 20rpx 24rpx;
  display: flex;
  align-items: center;
}

.upload-field-clickable:hover {
  background-color: #EFE9DD;
  border-color: #C8A45D;
}

.upload-folder-icon {
  margin-right: 12rpx;
  font-size: 28rpx;
}

.upload-field-text {
  font-size: 26rpx;
  color: #1A1A1A;
}

.upload-placeholder {
  color: #999999;
}

.upload-selected-list {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.upload-selected-item {
  font-size: 24rpx;
  color: #333333;
}

.upload-footer {
  padding: 16rpx 40rpx 24rpx;
  border-top: 1rpx solid #E0E0E0;
  background-color: #FAFAFA;
  display: flex;
  justify-content: flex-end;
  gap: 16rpx;
}

.upload-btn {
  min-width: 160rpx;
  padding: 16rpx 32rpx;
  text-align: center;
  border-radius: 999rpx;
  font-size: 26rpx;
}

.upload-btn-secondary {
  background-color: #ffffff;
  color: #12344D;
  border: 1rpx solid #12344D;
}

.upload-btn-primary {
  background-color: #12344D;
  color: #ffffff;
}

.upload-btn-primary.upload-btn-disabled {
  background-color: #CBD5E1;
  color: #ffffff;
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-content {
  background-color: #ffffff;
  border-radius: 16rpx;
  overflow: hidden;
}

.dialog-header {
  padding: 32rpx;
  border-bottom: 1rpx solid #e5e7eb;
}

.dialog-title {
  font-size: 32rpx;
  font-weight: 500;
  color: #1f2430;
}

.dialog-body {
  padding: 32rpx;
}

.dialog-input {
  width: 100%;
  height: 80rpx;
  padding: 0 16rpx;
  border: 1rpx solid #e5e7eb;
  border-radius: 8rpx;
  font-size: 28rpx;
}

.dialog-footer {
  display: flex;
  border-top: 1rpx solid #e5e7eb;
}

.dialog-btn {
  flex: 1;
  height: 88rpx;
  border-radius: 0;
  font-size: 28rpx;
}

.dialog-btn-default {
  background-color: #ffffff;
  color: #1a1a1a;
}

.dialog-btn-primary {
  background-color: #12344D; /* 品牌深墨蓝 */
  color: #ffffff;
}

.dialog-btn-primary[disabled] {
  opacity: 0.5;
}

.dialog-btn:first-child {
  border-right: 1rpx solid #e5e7eb;
}
</style>

