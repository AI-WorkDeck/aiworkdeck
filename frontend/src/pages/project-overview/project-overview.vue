<template>
  <view class="page-project-overview">
    <!-- 顶部固定项目信息 -->
    <view class="project-header">
      <view class="header-left">
        <view class="back-btn" @tap="goBack">
          <text class="back-icon">←</text>
        </view>
        <view class="project-info">
          <view class="project-title-row">
            <text class="project-name">{{ project.name || '未命名项目' }}</text>
            <view class="project-status-badge">
              <text class="status-text">进行中</text>
            </view>
          </view>
          <view class="project-meta">
            <text class="meta-item">负责人：{{ project.manager || userDisplayName || '我' }}</text>
            <text class="meta-divider">|</text>
            <text class="meta-item">上市公司：{{ project.listedCompanyName || '-' }}</text>
            <text class="meta-divider">|</text>
            <text class="meta-item">创建时间：{{ formatTime(project.createdAt) }}</text>
          </view>
        </view>
      </view>
      <view class="header-right">
        <!-- 用户头像 -->
        <view class="user-avatar" @tap="goToUserProfile">
           <text class="avatar-text">{{ userDisplayName?.charAt(0) || 'U' }}</text>
        </view>
      </view>
    </view>

    <!-- 主体布局 -->
    <view class="main-layout">
      <!-- 左侧文件树（可收起） -->
      <view class="sidebar-left" :class="{ collapsed: sidebarCollapsed }" :style="{ width: sidebarCollapsed ? '48px' : sidebarWidth + 'px' }">
        <view class="sidebar-header">
          <text class="sidebar-title" v-if="!sidebarCollapsed">文件资源</text>
          <view class="sidebar-toggle" @tap="toggleSidebar">
            <text class="toggle-icon">{{ sidebarCollapsed ? '»' : '«' }}</text>
          </view>
        </view>
        <view class="sidebar-content" v-show="!sidebarCollapsed">
          <FileTree
            ref="fileTree"
            :project-id="projectId"
            @file-select="handleFileTreeSelect"
          />
        </view>
        <!-- 拖拽手柄 -->
        <view class="resize-handle" @touchstart="startResize" @mousedown="startResize"></view>
      </view>

      <!-- 中间内容区 -->
      <view class="content-area">
        <!-- 顶部 Tab 栏 -->
        <view class="tabs-bar">
          <!-- 左侧窗格的 Tabs -->
          <view class="tabs-pane tabs-pane-left" :class="{ 'half-width': splitMode }">
            <scroll-view class="tabs-scroll" scroll-x show-scrollbar="false">
              <view class="tabs-list">
                <view
                  v-for="file in leftFiles"
                  :key="file.id"
                  class="tab-item"
                  :class="{ active: activeFileIdLeft === file.id }"
                  @tap="activateTab(file, 'left')"
                >
                  <text class="tab-icon">{{ getFileIcon(file.fileType) }}</text>
                  <text class="tab-name">{{ file.name }}</text>
                  <text class="tab-close" @tap.stop="closeFile(file.id, 'left')">×</text>
                </view>
              </view>
            </scroll-view>
          </view>

          <!-- 右侧窗格的 Tabs (仅在分屏时显示) -->
          <view v-if="splitMode" class="tabs-pane tabs-pane-right">
            <scroll-view class="tabs-scroll" scroll-x show-scrollbar="false">
              <view class="tabs-list">
                <view
                  v-for="file in rightFiles"
                  :key="file.id"
                  class="tab-item"
                  :class="{ active: activeFileIdRight === file.id }"
                  @tap="activateTab(file, 'right')"
                >
                  <text class="tab-icon">{{ getFileIcon(file.fileType) }}</text>
                  <text class="tab-name">{{ file.name }}</text>
                  <text class="tab-close" @tap.stop="closeFile(file.id, 'right')">×</text>
                </view>
              </view>
            </scroll-view>
          </view>

          <!-- 分屏按钮放在标签栏最右侧 -->
          <view class="tabs-tools">
            <view 
              class="icon-btn split-btn" 
              :class="{ active: splitMode }" 
              @tap="toggleSplitMode" 
              :title="splitMode ? '关闭分屏' : '开启分屏'"
            >
              <text class="tool-icon">◫</text>
            </view>
          </view>
        </view>

        <!-- 编辑器区域 -->
        <view class="editors-container">
          <!-- 初始空状态 (仅当左侧也没有文件时) -->
          <view v-if="leftFiles.length === 0 && !splitMode" class="empty-workspace">
            <view class="empty-content">
              <text class="empty-icon">📂</text>
              <text class="empty-text">在左侧选择文件开始工作</text>
            </view>
          </view>

          <!-- 编辑器视图 -->
          <view v-else class="editors-grid">
            
            <!-- 左/主 窗格 -->
            <view 
              class="editor-pane pane-left" 
              :class="{ 
                'pane-full': !splitMode, 
                'pane-half': splitMode, 
                focused: focusedPane === 'left' 
              }"
              @tap="focusPane('left')"
            >
              <view v-if="activeFileLeft" class="pane-content">
                <WpsEditor
                  v-if="isWpsFile(activeFileLeft)"
                  ref="wpsLeft"
                  :file-id="activeFileLeft.wpsFileId"
                  :file-name="activeFileLeft.name"
                  :app-id="wpsAppId"
                  mode="edit"
                  container-id="wps-container-left"
                  :auto-load="true"
                  @ready="onWpsReady($event, 'left')"
                />
                <FilePreview 
                  v-else 
                  :file="activeFileLeft" 
                  :show-edit-btn="false" 
                />
              </view>
              <view v-else class="pane-empty">
                <text>左侧空闲</text>
              </view>
            </view>

            <!-- 右/副 窗格 (分屏时显示) -->
            <view 
              v-if="splitMode" 
              class="editor-pane pane-right pane-half"
              :class="{ focused: focusedPane === 'right' }"
              @tap="focusPane('right')"
            >
              <view v-if="activeFileRight" class="pane-content">
                <WpsEditor
                  v-if="isWpsFile(activeFileRight)"
                  ref="wpsRight"
                  :file-id="activeFileRight.wpsFileId"
                  :file-name="activeFileRight.name"
                  :app-id="wpsAppId"
                  mode="edit"
                  container-id="wps-container-right"
                  :auto-load="true"
                  @ready="onWpsReady($event, 'right')"
                />
                <FilePreview 
                  v-else 
                  :file="activeFileRight" 
                  :show-edit-btn="false" 
                />
              </view>
              <view v-else class="pane-empty">
                <text>点击此处后选择文件以对比</text>
              </view>
            </view>

          </view>
        </view>
      </view>

      <!-- 右侧吸附抽屉（AI 对话 + 常用工具） -->
      <view class="drawer-container" :class="{ expanded: showRightDrawer }">
        <!-- 抽屉把手 -->
        <view class="drawer-handle" @tap="toggleDrawer">
          <text class="handle-icon">{{ showRightDrawer ? '›' : '‹' }}</text>
          <!-- 收起时显示的小标签 -->
          <view class="handle-label-container" v-if="!showRightDrawer">
             <text class="handle-vertical-text">工具箱</text>
          </view>
        </view>
        
        <!-- 抽屉内容 -->
        <view class="drawer-content">
          <!-- 顶部 Tab 区：AI 助手 / 常用工具 -->
          <view class="drawer-tabs-bar">
            <view
              v-for="tab in drawerTabs"
              :key="tab.key"
              class="drawer-tab-item"
              :class="{ active: drawerActiveTab === tab.key }"
              @tap="switchDrawerTab(tab.key)"
            >
              <text class="drawer-tab-text">{{ tab.label }}</text>
            </view>
          </view>

          <!-- Tab：AI 助手，仅显示对话与输入框 -->
          <view v-if="drawerActiveTab === 'ai'" class="drawer-ai-layout">
            <view class="ai-chat-pane">
              <view class="ai-chat-header">
                <text class="ai-chat-title">项目 AI 助手</text>
                <text class="ai-chat-subtitle">结合项目文档进行问答与起草</text>
              </view>
              <scroll-view class="ai-chat-body" scroll-y :scroll-with-animation="true">
                <view
                  v-for="msg in aiMessages"
                  :key="msg.id"
                  class="ai-message"
                  :class="msg.role === 'user' ? 'ai-message-user' : 'ai-message-assistant'"
                >
                  <view class="ai-message-bubble">
                    <text class="ai-message-role">
                      {{ msg.role === 'user' ? '我' : '助手' }}
                    </text>
                    <text class="ai-message-content">
                      {{ msg.content }}
                    </text>
                    <view
                      v-if="msg.role === 'assistant' && msg.content"
                      class="ai-message-actions"
                    >
                      <text class="ai-export-btn" @tap="openExportDialog(msg)">
                        导出为Word
                      </text>
                    </view>
                  </view>
                </view>
                <view v-if="aiLoading" class="ai-message ai-message-assistant">
                  <view class="ai-message-bubble">
                    <text class="ai-message-role">助手</text>
                    <text class="ai-message-content">正在思考...</text>
                  </view>
                </view>
                <view v-if="!aiMessages.length && !aiLoading" class="ai-empty-tip">
                  <text>可以直接提问“帮我起草公告草案”等问题</text>
                </view>
              </scroll-view>
              <view class="ai-input-area">
                <textarea
                  class="ai-input"
                  v-model="aiInput"
                  placeholder="请输入要咨询的问题..."
                  :disabled="aiLoading"
                  confirm-type="send"
                  @confirm="handleAiSend"
                />
                <button
                  class="ai-send-btn"
                  type="primary"
                  size="mini"
                  :disabled="aiLoading || !aiInput.trim()"
                  @tap="handleAiSend"
                >
                  发送
                </button>
              </view>
            </view>
          </view>

          <!-- Tab：常用工具，展示变量库等工具 -->
          <view v-else-if="drawerActiveTab === 'tools'" class="tool-detail-view">
            <view class="drawer-header">
              <text class="drawer-title">常用工具</text>
            </view>
            <view class="drawer-body">
              <VariablePanel
                ref="variablePanel"
                :project-id="projectId"
                @insert="handleInsertVariable"
                @update-from-selection="handleUpdateVariable"
                @sync-document="handleSyncDocument"
              />
            </view>
          </view>

          <!-- 其他 Tab 占位 -->
          <view v-else class="tool-detail-view">
            <view class="drawer-header">
              <text class="drawer-title">功能开发中</text>
            </view>
            <view class="drawer-body empty-body">
              <text>此功能即将上线</text>
            </view>
          </view>
        </view>
      </view>

      <!-- AI 导出为 Word 对话框 -->
      <view v-if="showExportDialog" class="upload-mask" @tap="closeExportDialog">
        <view class="folder-modal" @tap.stop>
          <view class="upload-header">
            <text class="upload-title">导出为 Word</text>
            <text class="upload-subtitle">选择存放位置并输入文件名</text>
          </view>
          <view class="folder-body">
            <view class="upload-row">
              <text class="upload-label">文件名</text>
              <input
                v-model="exportFileName"
                class="dialog-input"
                placeholder="例如：AI回复.docx"
              />
            </view>
            <view class="upload-row export-folder-label-row">
              <text class="upload-label">存放位置</text>
            </view>
            <scroll-view class="export-folder-list" scroll-y>
              <view
                class="folder-item root-folder"
                :class="{ active: exportTargetParentId === null }"
                @tap="selectExportFolder(null)"
              >
                <text class="folder-icon">📁</text>
                <text class="folder-name">根目录</text>
              </view>
              <view
                v-for="folder in exportFolderTree"
                :key="folder.id"
                class="folder-item"
                :class="{ active: exportTargetParentId === folder.id }"
                @tap="selectExportFolder(folder.id)"
              >
                <view
                  class="folder-indent"
                  :style="{ width: (folder.level * 24) + 'rpx' }"
                ></view>
                <text class="folder-icon">📂</text>
                <text class="folder-name">{{ folder.name }}</text>
              </view>
              <view v-if="!exportFolderTree.length" class="empty-tip">
                <text>暂无其他文件夹，将保存到根目录</text>
              </view>
            </scroll-view>
          </view>
          <view class="upload-footer">
            <view class="upload-btn upload-btn-secondary" @tap="closeExportDialog">
              取消
            </view>
            <view
              class="upload-btn upload-btn-primary"
              :class="{ 'upload-btn-disabled': exportLoading || !exportFileName.trim() }"
              @tap="!exportLoading && exportFileName.trim() && confirmExportWord()"
            >
              {{ exportLoading ? '导出中...' : '确定导出' }}
            </view>
          </view>
        </view>
      </view>

    </view>
  </view>
</template>

<script>
import WpsEditor from '@/components/WpsEditor.vue'
import FileTree from '@/components/FileTree.vue'
import FilePreview from '@/components/FilePreview.vue'
import VariablePanel from '@/components/VariablePanel.vue'
import {
  getProject,
  getFileDetail,
  saveProjectVariable,
  getProjectVariables,
  getProjectFiles,
  aiChat,
  exportAiDocx
} from '@/services/api.js'
import { getCurrentUser } from '@/utils/auth.js'

export default {
  name: 'ProjectOverview',
  components: {
    WpsEditor,
    FileTree,
    FilePreview,
    VariablePanel
  },
  data() {
    return {
      projectId: null,
      project: {},
      userDisplayName: '用户',
      
      // 布局状态
      sidebarWidth: 260, // 侧边栏宽度
      isResizing: false,
      startX: 0,
      startWidth: 0,
      
      sidebarCollapsed: false,
      showRightDrawer: false, // 抽屉默认收起
      drawerMode: 'menu', // menu | variable | compare | template
      // 右侧抽屉 Tab 与 AI 状态
      drawerTabs: [
        { key: 'ai', label: 'AI 助手' },
        { key: 'tools', label: '常用工具' }
      ],
      drawerActiveTab: 'ai',
      aiCurrentTool: 'variable', // 右侧默认工具
      aiMessages: [], // { id, role: 'user'|'assistant', content }
      aiInput: '',
      aiLoading: false,
      // AI 导出 Word 相关（后端生成 docx）
      showExportDialog: false,
      exportTargetParentId: null,
      exportFolderTree: [], // [{id, name, level, parentId}]
      exportFileName: '',
      exportSourceMessage: null,
      exportLoading: false,
      splitMode: false,
      focusedPane: 'left', // 'left' | 'right'

      // 文件状态 - 分两组管理
      leftFiles: [], // 左侧文件列表
      rightFiles: [], // 右侧文件列表
      activeFileIdLeft: null, // 左侧当前激活ID
      activeFileIdRight: null, // 右侧当前激活ID
      
      // WPS Config
      wpsAppId: 'SX20251208BJWRFK',
      wpsInstances: {
        left: null,
        right: null
      },
      // 文件信息轮询定时器
      fileInfoPollingIntervals: {}
    }
  },
  beforeUnmount() {
    // 清理轮询定时器
    if (this.fileInfoPollingIntervals) {
      Object.values(this.fileInfoPollingIntervals).forEach(intervalId => {
        if (intervalId) clearInterval(intervalId)
      })
    }
  },
  computed: {
    activeFileLeft() {
      return this.leftFiles.find(f => f.id === this.activeFileIdLeft)
    },
    activeFileRight() {
      return this.rightFiles.find(f => f.id === this.activeFileIdRight)
    }
  },
  onLoad(query) {
    if (query && query.id) {
      this.projectId = Number(query.id)
      this.loadProjectInfo()
    }
    
    const user = getCurrentUser()
    if (user) {
      this.userDisplayName = user.displayName || user.username
    }
  },
  methods: {
    // --- 导航与初始化 ---
    async loadProjectInfo() {
      try {
        const data = await getProject(this.projectId)
        if (data) {
          this.project = data
        }
      } catch (e) {
        console.error('加载项目详情失败', e)
      }
    },
    goBack() {
      uni.navigateBack()
    },
    goToUserProfile() {
      uni.navigateTo({ url: '/pages/userprofile/userprofile' })
    },
    formatTime(timeStr) {
      if (!timeStr) return '-'
      return new Date(timeStr).toLocaleDateString()
    },

    // --- 布局控制 ---
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed
    },
    
    // 右侧抽屉控制
    toggleDrawer() {
      this.showRightDrawer = !this.showRightDrawer
      // 每次打开都重置为菜单，或者保持状态？用户可能希望保持。
      // 这里暂不重置。
    },
    switchDrawerTab(key) {
      this.drawerActiveTab = key
      // 在 AI Tab 打开时自动展开抽屉
      if (!this.showRightDrawer) {
        this.showRightDrawer = true
      }
    },
    switchDrawerMode(mode) {
      this.drawerMode = mode
    },
    
    toggleSplitMode() {
      this.splitMode = !this.splitMode

      // 关键修复：触发 resize 事件通知 WPS SDK 调整布局
      // WPS SDK 监听 window resize 来调整内部 iframe 大小
      this.$nextTick(() => {
        // 立即触发一次
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('resize'))
        }
        
        // 配合 transition 动画（0.2s），在动画结束时再次触发，确保最终尺寸正确
        setTimeout(() => {
           if (typeof window !== 'undefined') {
             window.dispatchEvent(new Event('resize'))
           }
        }, 250)
      })

      if (!this.splitMode) {
        // 关闭分屏时，重置 focus 到左侧
        this.focusedPane = 'left'
      } else {
        // 开启分屏时，默认聚焦右侧，方便用户立即选择文件
        this.focusedPane = 'right'
      }
    },
    focusPane(pane) {
      // 只有在分屏模式下才允许聚焦右侧
      if (!this.splitMode && pane === 'right') return
      this.focusedPane = pane
    },

    // --- 文件管理逻辑 ---
    handleFileTreeSelect(file) {
      if (!file || file.isFolder) return
      this.openFile(file)
    },
    
    openFile(file) {
      // 1. 检查文件是否已经在某个窗口打开
      const isInLeft = this.leftFiles.some(f => f.id === file.id)
      const isInRight = this.rightFiles.some(f => f.id === file.id)

      if (isInLeft) {
        // 如果在左侧，激活左侧并聚焦
        this.focusedPane = 'left'
        // 关键修复：确保文件对象是最新的（从文件树获取的最新数据）
        const existingFile = this.leftFiles.find(f => f.id === file.id)
        if (existingFile) {
          // 更新文件对象，确保WPS组件能正确响应变化
          Object.assign(existingFile, file)
        }
        this.activeFileIdLeft = file.id
        // 强制触发WPS组件重新加载（如果fileId或fileName变化）
        this.$nextTick(() => {
          const wpsComp = this.$refs.wpsLeft
          if (wpsComp && wpsComp.fileId === file.wpsFileId) {
            // 如果fileId相同但可能是其他属性变化，强制重新加载
            wpsComp.reload()
          }
        })
        return
      }

      if (isInRight) {
        // 如果在右侧，激活右侧并聚焦 (前提是分屏模式)
        if (this.splitMode) {
          this.focusedPane = 'right'
          // 关键修复：确保文件对象是最新的
          const existingFile = this.rightFiles.find(f => f.id === file.id)
          if (existingFile) {
            Object.assign(existingFile, file)
          }
          this.activeFileIdRight = file.id
          // 强制触发WPS组件重新加载
          this.$nextTick(() => {
            const wpsComp = this.$refs.wpsRight
            if (wpsComp && wpsComp.fileId === file.wpsFileId) {
              wpsComp.reload()
            }
          })
        } else {
          // 如果不在分屏模式但在右侧列表（可能被隐藏了），这时候应该怎么办？
          // 用户期望"聚焦到已经打开的标签"。如果是隐藏的右侧，可能需要自动开启分屏？
          // 或者把文件移动到左侧？
          // 这里简单处理：如果未分屏，就在左侧打开（因为右侧不可见）
          // 但为了防止重复，先把右侧的删掉？
          // 根据用户描述 "点击文件树里的已打开文件，聚焦到已经打开的标签"，隐喻是可见的。
          // 如果不可见，就在当前窗口打开。
          
          // 修正逻辑：如果未分屏，所有操作都在左侧。
          // 检查左侧是否有，没有就加。
          this.focusedPane = 'left'
          this.leftFiles.push(file)
          this.activeFileIdLeft = file.id
        }
        return
      }

      // 2. 如果都没打开，加入当前聚焦的窗格
      // 如果未分屏，强制左侧
      const targetPane = this.splitMode ? this.focusedPane : 'left'
      const targetList = targetPane === 'left' ? this.leftFiles : this.rightFiles
      const targetIdProp = targetPane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'
      
      targetList.push(file)
      this[targetIdProp] = file.id
    },

    activateTab(file, pane) {
      // 点击 Tab 时，切换对应窗格的激活文件，并聚焦该窗格
      this.focusPane(pane)
      if (pane === 'left') {
        this.activeFileIdLeft = file.id
      } else {
        this.activeFileIdRight = file.id
      }
    },

    closeFile(fileId, pane) {
      const list = pane === 'left' ? this.leftFiles : this.rightFiles
      const idProp = pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'
      const activeId = this[idProp]
      
      const idx = list.findIndex(f => f.id === fileId)
      if (idx === -1) return
      
      list.splice(idx, 1)
      
      // 如果关闭的是当前激活的文件，尝试切换到临近的文件
      if (activeId === fileId) {
        this[idProp] = list.length > 0 
          ? list[Math.min(idx, list.length - 1)].id 
          : null
      }
    },

    getFileIcon(type) {
      if (!type) return '📄'
      const t = type.toLowerCase()
      if (['doc','docx'].includes(t)) return '📝'
      if (['pdf'].includes(t)) return '📕'
      return '📄'
    },
    isWpsFile(file) {
      // 根据是否有 wpsFileId 判断是否用 WPS 打开
      return file && (file.wpsFileId || ['doc','docx','xls','xlsx','ppt','pptx'].includes(file.fileType))
    },

    // --- WPS 交互逻辑 ---
    onWpsReady(instance, pane) {
      console.log(`WPS Ready [${pane}]`, instance)
      this.wpsInstances[pane] = instance
      
      // 监听WPS重命名事件，同步更新文件树和标签
      // 注意：WPS的重命名是通过后端回调处理的，前端需要通过轮询或监听文件信息变化来同步
      if (instance && instance.ApiEvent) {
        try {
          // 监听文件保存事件，保存后可能触发重命名同步
          instance.ApiEvent.AddApiEventListener('fileSave', async (data) => {
            console.log('WPS 文件保存事件:', data)
            // 保存后刷新文件信息，获取最新文件名
            await this.syncFileInfo(pane)
          })
          
          // 尝试监听重命名事件（如果SDK支持）
          try {
            instance.ApiEvent.AddApiEventListener('fileRename', async (data) => {
              console.log('WPS 文件重命名事件:', data)
              await this.handleFileRename(pane, data)
            })
          } catch (e) {
            console.warn('WPS SDK 不支持 fileRename 事件监听，将使用轮询方式', e)
            // 如果不支持事件监听，使用轮询方式检查文件信息变化
            this.startFileInfoPolling(pane)
          }
        } catch (e) {
          console.warn('WPS 事件监听设置失败:', e)
        }
      }

      // 如果有待写入的 AI 导出内容，尝试在文档就绪后写入
      this.$nextTick(async () => {
        try {
          const activeFile = pane === 'left' ? this.activeFileLeft : this.activeFileRight
          if (!activeFile || !activeFile.wpsFileId) return

          const key = activeFile.wpsFileId
          const payload = this.pendingAiExports && this.pendingAiExports[key]
          if (!payload || !payload.text) return

          const wpsComp = this.$refs[pane === 'left' ? 'wpsLeft' : 'wpsRight']
          if (wpsComp && wpsComp.insertTextWithBookmark) {
            await wpsComp.insertTextWithBookmark(
              payload.text,
              `AI_EXPORT_${Date.now()}`
            )
            uni.showToast({ title: 'AI 内容已写入文档', icon: 'none' })
          }

          // 写入成功后，从待写入队列中删除（保持状态干净）
          if (this.pendingAiExports && this.pendingAiExports[key]) {
            const nextMap = { ...this.pendingAiExports }
            delete nextMap[key]
            this.pendingAiExports = nextMap
          }
        } catch (e) {
          console.error('写入 AI 导出内容失败', e)
        }
      })
    },
    
    // 处理文件重命名
    async handleFileRename(pane, data) {
      const activeFile = pane === 'left' ? this.activeFileLeft : this.activeFileRight
      if (!activeFile) return
      
      const newName = data.name || data.fileName
      if (!newName) return
      
      console.log(`文件重命名: ${activeFile.name} -> ${newName}`)
      
      // 更新文件对象
      activeFile.name = newName
      
      // 刷新文件树
      if (this.$refs.fileTree) {
        await this.$refs.fileTree.loadFiles()
      }
      
      // 触发响应式更新
      this.$forceUpdate()
    },
    
    // 同步文件信息（从后端获取最新信息）
    async syncFileInfo(pane) {
      const activeFile = pane === 'left' ? this.activeFileLeft : this.activeFileRight
      if (!activeFile || !activeFile.id) return
      
      try {
        const fileDetail = await getFileDetail(this.projectId, activeFile.id)
        if (fileDetail && fileDetail.name) {
          const oldName = activeFile.name
          activeFile.name = fileDetail.name
          
          // 如果文件名变化了，刷新文件树
          if (oldName !== fileDetail.name) {
            console.log(`检测到文件名变化: ${oldName} -> ${fileDetail.name}`)
            if (this.$refs.fileTree) {
              await this.$refs.fileTree.loadFiles()
            }
            this.$forceUpdate()
          }
        }
      } catch (e) {
        console.error('同步文件信息失败:', e)
      }
    },
    
    // 启动文件信息轮询（用于检测重命名）
    startFileInfoPolling(pane) {
      // 每5秒轮询一次文件信息
      const intervalId = setInterval(() => {
        const activeFile = pane === 'left' ? this.activeFileLeft : this.activeFileRight
        if (!activeFile) {
          clearInterval(intervalId)
          return
        }
        this.syncFileInfo(pane)
      }, 5000)
      
      // 存储intervalId以便清理
      if (!this.fileInfoPollingIntervals) {
        this.fileInfoPollingIntervals = {}
      }
      this.fileInfoPollingIntervals[pane] = intervalId
    },
    
    // 获取当前聚焦的 WPS 实例
    getCurrentWpsInstance() {
      // 优先获取聚焦窗格的实例
      const instance = this.wpsInstances[this.focusedPane]
      // 如果聚焦窗格没有实例（比如是预览或者空的），尝试获取另一个
      if (instance) return this.$refs[this.focusedPane === 'left' ? 'wpsLeft' : 'wpsRight']
      
      // Fallback
      if (this.wpsInstances.left) return this.$refs.wpsLeft
      return null
    },

    // --- 变量库交互 (复用原有逻辑) ---
    async handleInsertVariable(variable) {
      const wpsComp = this.getCurrentWpsInstance()
      if (!wpsComp) {
        uni.showToast({ title: '请先点击激活一个编辑窗口', icon: 'none' })
        return
      }
      
      try {
        await wpsComp.insertTextWithBookmark(variable.value, variable.name)
        uni.showToast({ title: '插入成功', icon: 'success' })
      } catch (e) {
        console.error(e)
        uni.showToast({ title: '插入失败', icon: 'none' })
      }
    },
    
    async handleUpdateVariable(variable) {
      const wpsComp = this.getCurrentWpsInstance()
      if (!wpsComp) return

      try {
        const text = await wpsComp.getSelectionText()
        if (!text) {
          uni.showToast({ title: '请先选择内容', icon: 'none' })
          return
        }
        
        uni.showModal({
          title: '确认更新',
          content: `确认将变量 "${variable.name}" 更新为选中文本？`,
          success: async (res) => {
            if (res.confirm) {
               const updatedVar = { ...variable, value: text }
               await saveProjectVariable(updatedVar)
               await wpsComp.updateBookmark(variable.name, text)
               this.$refs.variablePanel.refresh()
               uni.showToast({ title: '更新成功', icon: 'success' })
            }
          }
        })
      } catch (e) {
        uni.showToast({ title: '更新失败', icon: 'none' })
      }
    },
    
    async handleSyncDocument() {
      const wpsComp = this.getCurrentWpsInstance()
      if (!wpsComp) {
        uni.showToast({ title: '请先点击激活一个编辑窗口', icon: 'none' })
        return
      }
      
      uni.showLoading({ title: '同步中...' })
      try {
        const vars = await getProjectVariables(this.projectId)
        const list = Array.isArray(vars) ? vars : (vars?.data || [])
        const res = await wpsComp.syncAllBookmarks(list)
        uni.hideLoading()
        uni.showToast({ title: `同步完成 (${res.updated})`, icon: 'none' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: '同步失败', icon: 'none' })
      }
    },

    // --- AI 对话 ---
    async handleAiSend() {
      const text = (this.aiInput || '').trim()
      if (!text || !this.projectId) {
        return
      }
      const projectId = this.projectId
      // 先清空输入框，提升响应感
      this.aiInput = ''

      const userMsgId = `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const assistantMsgId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      this.aiMessages.push({
        id: userMsgId,
        role: 'user',
        content: text
      })
      this.aiMessages.push({
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        loading: true
      })

      this.aiLoading = true
      try {
        const res = await aiChat({
          projectId,
          message: text
        })
        const reply =
          (res && res.response) ||
          (res && res.data && res.data.response) ||
          ''
        const target = this.aiMessages.find(m => m.id === assistantMsgId)
        if (target) {
          target.content = reply || '（AI 未返回内容）'
          target.loading = false
        }
      } catch (e) {
        console.error('AI 对话失败', e)
        const target = this.aiMessages.find(m => m.id === assistantMsgId)
        if (target) {
          target.content = e.message || 'AI 调用失败'
          target.loading = false
        }
        uni.showToast({ title: 'AI 调用失败', icon: 'none' })
      } finally {
        this.aiLoading = false
      }
    },

    // --- AI 导出为 Word ---
    async openExportDialog(message) {
      if (!this.projectId) {
        uni.showToast({ title: '项目未就绪', icon: 'none' })
        return
      }
      if (!message || !message.content) {
        uni.showToast({ title: '暂无可导出内容', icon: 'none' })
        return
      }
      this.exportSourceMessage = message
      // 默认文件名：项目名 + 时间
      const baseName = this.project.name || 'AI回复'
      const ts = new Date()
      const pad = n => (n < 10 ? `0${n}` : `${n}`)
      const defaultName = `${baseName}-${ts.getFullYear()}${pad(
        ts.getMonth() + 1
      )}${pad(ts.getDate())}`
      this.exportFileName = `${defaultName}.docx`
      this.exportTargetParentId = null
      this.exportFolderTree = []
      this.showExportDialog = true

      try {
        const allFiles = await getProjectFiles(this.projectId, null, true)
        this.exportFolderTree = this.buildExportFolderTree(allFiles || [])
      } catch (e) {
        console.error('加载文件夹列表失败', e)
        uni.showToast({ title: '加载文件夹失败', icon: 'none' })
      }
    },

    buildExportFolderTree(allFiles) {
      if (!Array.isArray(allFiles) || !allFiles.length) return []
      const folders = allFiles.filter(f => f && f.isFolder)
      if (!folders.length) return []

      const map = new Map()
      folders.forEach(f => {
        map.set(f.id, {
          ...f,
          children: [],
          level: 0
        })
      })

      const roots = []
      folders.forEach(f => {
        const node = map.get(f.id)
        if (node.parentId != null && map.has(node.parentId)) {
          map.get(node.parentId).children.push(node)
        } else {
          roots.push(node)
        }
      })

      const result = []
      const traverse = (nodes, level) => {
        if (!Array.isArray(nodes)) return
        nodes
          .slice()
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
          .forEach(node => {
            node.level = level
            result.push(node)
            if (node.children && node.children.length) {
              traverse(node.children, level + 1)
            }
          })
      }

      traverse(roots, 0)
      return result
    },

    selectExportFolder(folderId) {
      this.exportTargetParentId = folderId
    },

    closeExportDialog() {
      if (this.exportLoading) return
      this.showExportDialog = false
      this.exportSourceMessage = null
    },

    async confirmExportWord() {
      if (!this.projectId || !this.exportSourceMessage) {
        uni.showToast({ title: '项目未就绪', icon: 'none' })
        return
      }
      let name = (this.exportFileName || '').trim()
      if (!name) {
        uni.showToast({ title: '请输入文件名', icon: 'none' })
        return
      }
      if (!/\.docx$/i.test(name)) {
        name = `${name}.docx`
      }
      const projectId = this.projectId
      const parentId = this.exportTargetParentId

      this.exportLoading = true
      try {
        const createdFile = await exportAiDocx({
          projectId,
          parentId,
          fileName: name,
          markdown: this.exportSourceMessage.content
        })

        this.showExportDialog = false
        this.exportSourceMessage = null

        // 刷新文件树
        if (this.$refs.fileTree && this.$refs.fileTree.loadFiles) {
          this.$refs.fileTree.loadFiles()
        }

        // 打开到当前聚焦窗格
        if (createdFile) {
          this.openFile(createdFile)
        }
        uni.showToast({ title: '文档已生成', icon: 'none' })
      } catch (e) {
        console.error('导出 Word 失败', e)
        uni.showToast({ title: e.message || '导出失败', icon: 'none' })
      } finally {
        this.exportLoading = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
/* 颜色变量 */
$brand-gold: #C8A45D;
$brand-dark: #12344D;
$brand-bg: #F7F5F0;
$brand-white: #FFFFFF;
$text-main: #1A1A1A;
$text-secondary: #666666;
$border-color: #E0E0E0;

.page-project-overview {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: $brand-bg;
  overflow: hidden;
}

/* 顶部 Header */
.project-header {
  height: 64px;
  background: $brand-white;
  border-bottom: 1px solid $border-color;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.03);
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: $text-secondary;
  font-size: 18px;
  
  &:hover {
    background-color: #f5f5f5;
  }
}

.project-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.project-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-name {
  font-size: 18px;
  font-weight: 600;
  color: $text-main;
}

.project-status-badge {
  background: rgba(200, 164, 93, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  
  .status-text {
    font-size: 12px;
    color: $brand-gold;
  }
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  
  .meta-item {
    font-size: 12px;
    color: $text-secondary;
  }
  
  .meta-divider {
    color: #ddd;
    font-size: 10px;
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 24px;
}

.user-avatar {
  width: 32px;
  height: 32px;
  background: $brand-dark;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  cursor: pointer;
}

/* 主布局 */
.main-layout {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  position: relative;
}

/* 左侧 Sidebar */
.sidebar-left {
  width: 260px;
  background: #FAFAFA;
  border-right: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  flex-shrink: 0;
  
  &.collapsed {
    width: 40px;
    
    .sidebar-header {
      padding: 0;
      justify-content: center;
    }
  }
}

.sidebar-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 14px;
  font-weight: 600;
  color: $text-secondary;
}

.sidebar-toggle {
  cursor: pointer;
  color: #999;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover {
    color: $text-main;
  }
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 中间内容区 */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: $brand-white;
}

/* 标签栏 Tabs */
.tabs-bar {
  height: 40px;
  background: #f0f0f0;
  border-bottom: 1px solid $border-color;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px; /* 给右侧工具留位置 */
}

.tabs-pane {
  flex: 1;
  height: 100%;
  min-width: 0;
  display: flex;
  border-right: 1px solid transparent;
  
  &.half-width {
    flex: 0 0 50%; /* 强制占50% */
    max-width: 50%;
    border-right-color: $border-color;
  }
}

.tabs-scroll {
  width: 100%;
  height: 100%;
}

.tabs-list {
  display: flex;
  flex-direction: row;
  height: 100%;
  padding-top: 4px;
  padding-left: 4px;
}

.tab-item {
  height: 36px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #e0e0e0;
  border-radius: 8px 8px 0 0;
  margin-right: 2px;
  cursor: pointer;
  min-width: 100px;
  max-width: 180px;
  user-select: none;
  
  .tab-name {
    flex: 1;
    font-size: 13px;
    color: $text-secondary;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .tab-close {
    font-size: 16px;
    color: #999;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    
    &:hover {
      background: rgba(0,0,0,0.1);
      color: #333;
    }
  }
  
  &.active {
    background: $brand-white;
    .tab-name { color: $brand-dark; font-weight: 500; }
  }
}

.tabs-tools {
  display: flex;
  align-items: center;
  padding-left: 8px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  color: $text-secondary;
  
  &:hover {
    background-color: rgba(0,0,0,0.05);
  }
  
  &.active {
    background-color: rgba(18, 52, 77, 0.1);
    color: $brand-dark;
  }
  
  .tool-icon {
    font-size: 16px;
  }
}

/* 编辑器区域 */
.editors-container {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.editors-grid {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
}

.editor-pane {
  flex: 1; /* 默认占满 */
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  min-width: 0; /* 防止内容撑大 */
  transition: all 0.2s ease-in-out; /* 更好的过渡 */
  overflow: hidden;
  
  &.focused {
    /* 聚焦时的高亮提示 */
    box-shadow: inset 0 0 0 2px rgba(18, 52, 77, 0.1);
    z-index: 1;
  }
  
  /* 显式控制宽度 */
  &.pane-full {
    width: 100%;
    flex: 0 0 100%;
    max-width: 100%;
  }
  
  &.pane-half {
    width: 50%;
    flex: 0 0 50%;
    max-width: 50%;
    border-right: 1px solid $border-color;
    
    &:last-child {
      border-right: none;
    }
  }
}

.pane-content {
  width: 100%;
  height: 100%;
  overflow: hidden; /* 确保内部组件不溢出 */
}

.pane-empty, .empty-workspace {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fcfcfc;
  color: #ccc;
  font-size: 14px;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.empty-icon {
  font-size: 48px;
  color: #eee;
}

/* 右侧吸附抽屉 */
.drawer-container {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: row;
  z-index: 50;
  transform: translateX(300px); /* 默认收起内容，只留把手 */
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none; /* 收起时不遮挡底层点击，把手单独开启 pointer-events */
  
  &.expanded {
    transform: translateX(0);
    pointer-events: auto;
    box-shadow: -4px 0 16px rgba(0,0,0,0.08);
  }
}

.drawer-handle {
  width: 24px;
  height: 64px; /* 加高一点 */
  background: $brand-dark; /* 使用主色调 */
  border-radius: 8px 0 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  
  /* 垂直居中定位 */
  position: absolute;
  left: -24px; /* 把它移到 content 左边 */
  top: 50%;
  transform: translateY(-50%);
  
  box-shadow: -2px 2px 4px rgba(0,0,0,0.1);
  pointer-events: auto; /* 始终允许点击 */
  z-index: 51;
  
  .handle-icon {
    font-size: 18px;
    color: #fff; /* 白色箭头 */
    line-height: 1;
  }
  
  &:hover {
    background-color: #1a4a6b; /* hover 变亮一点 */
    width: 28px; /* hover 变宽一点点作为反馈 */
    left: -28px;
  }
}

/* 收起时的标签容器（气泡） */
.handle-label-container {
  position: absolute;
  right: 36px; /* 距离把手左侧一点 */
  background: #333;
  color: #fff;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
  
  /* 小三角 */
  &::after {
    content: '';
    position: absolute;
    right: -4px;
    top: 50%;
    transform: translateY(-50%);
    border-left: 4px solid #333;
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
  }
}

.drawer-handle:hover .handle-label-container {
  opacity: 1;
}

.drawer-content {
  width: 300px;
  background: $brand-white; /* 确保不透明 */
  border-left: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  height: 100%;
  pointer-events: auto;
  position: relative;
  z-index: 50;
  box-shadow: -2px 0 10px rgba(0,0,0,0.05); /* 内部阴影增强层次 */
}

/* 抽屉顶部 Tabs */
.drawer-tabs-bar {
  height: 44px;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  padding: 0 12px;
  border-bottom: 1px solid #eee;
  background: #fff;
  flex-shrink: 0;
}

.drawer-tab-item {
  margin-right: 16px;
  padding: 8px 4px;
  font-size: 13px;
  color: $text-secondary;
  position: relative;
  cursor: pointer;

  &.active {
    color: $brand-dark;
    font-weight: 600;
  }

  &.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: linear-gradient(90deg, $brand-gold, $brand-dark);
    border-radius: 999px;
  }
}

.drawer-tab-text {
  white-space: nowrap;
}

/* AI 对话 + 工具布局 */
.drawer-ai-layout {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
}

.ai-chat-pane {
  flex: 3;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #f0f0f0;
  min-width: 0;
}

.ai-tool-pane {
  flex: 2;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ai-chat-header {
  padding: 12px 14px 8px;
  border-bottom: 1px solid #f3f3f3;
}

.ai-chat-title {
  font-size: 14px;
  font-weight: 600;
  color: $text-main;
}

.ai-chat-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: $text-secondary;
}

.ai-chat-body {
  flex: 1;
  padding: 10px 12px;
  background: #fafafa;
}

.ai-message {
  margin-bottom: 8px;
  display: flex;
}

.ai-message-user {
  justify-content: flex-end;
}

.ai-message-assistant {
  justify-content: flex-start;
}

.ai-message-bubble {
  max-width: 90%;
  padding: 8px 10px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.ai-message-user .ai-message-bubble {
  background: #12344D;
  color: #ffffff;
}

.ai-message-role {
  font-size: 11px;
  color: #999;
}

.ai-message-user .ai-message-role {
  color: #e5e7eb;
}

.ai-message-content {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.ai-message-actions {
  margin-top: 6px;
  display: flex;
  justify-content: flex-end;
}

.ai-export-btn {
  font-size: 12px;
  color: $brand-gold;
}

.ai-empty-tip {
  margin-top: 16px;
  font-size: 12px;
  color: #999;
  text-align: center;
}

.ai-input-area {
  padding: 8px 10px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 8px;
}

.ai-input {
  flex: 1;
  min-height: 64rpx;
  max-height: 140rpx;
  padding: 8rpx 10rpx;
  border-radius: 8rpx;
  border: 1rpx solid #e5e7eb;
  font-size: 26rpx;
  background-color: #fafafa;
}

.ai-send-btn {
  flex-shrink: 0;
}

.drawer-header {
  height: 48px;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: #fff;
  flex-shrink: 0;
  
  &.with-back {
    justify-content: space-between;
  }
}

.back-link {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: $brand-gold;
  font-size: 13px;
  
  &:hover {
    opacity: 0.8;
  }
}

.back-arrow {
  font-size: 16px;
}

.drawer-title {
  font-weight: 600;
  color: $text-main;
  font-size: 14px;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  background: #fff;
  
  &.empty-body {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #999;
    font-size: 12px;
  }
}

/* 工具菜单样式 */
.tool-menu-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tool-list {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-item {
  display: flex;
  flex-direction: column;
  background: #fcfcfc;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  
  &:hover {
    border-color: $brand-gold;
    box-shadow: 0 2px 8px rgba(200, 164, 93, 0.1);
    background: #fff;
  }
}

.tool-icon-box {
  font-size: 24px;
  margin-bottom: 8px;
}

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: $text-main;
  margin-bottom: 4px;
}

.tool-desc {
  font-size: 12px;
  color: $text-secondary;
}

/* 详情视图容器 */
.tool-detail-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 导出 Word 对话框复用上传/文件夹样式 */
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

.folder-body {
  padding: 24rpx 40rpx 8rpx;
  max-height: 520rpx;
  overflow-y: auto;
  background-color: #ffffff;
}

.export-folder-label-row {
  margin-top: 16rpx;
}

.export-folder-list {
  max-height: 360rpx;
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

.folder-name {
  flex: 1;
  font-size: 28rpx;
  color: #1f2430;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-tip {
  text-align: center;
  color: #adb5bd;
  padding: 20px;
  font-size: 14px;
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

.dialog-input {
  width: 100%;
  height: 80rpx;
  padding: 0 16rpx;
  border: 1rpx solid #e5e7eb;
  border-radius: 8rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}
</style>
