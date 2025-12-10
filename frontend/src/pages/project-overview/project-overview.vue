<template>
  <view class="page-project-overview">
    <view class="layout">
      <!-- 左侧：项目进度（可收起） -->
      <view class="side-progress" v-if="!sideCollapsed">
        <view class="side-header">
          <text class="side-title">项目进度</text>
          <button class="side-toggle-btn" type="default" size="mini" @tap="toggleSide">
            收起
          </button>
        </view>
        <view class="side-body">
          <view class="step-item" v-for="step in steps" :key="step.key">
            <view class="step-dot" :class="[`step-status-${step.status}`]" />
            <view class="step-content">
              <text class="step-title">{{ step.title }}</text>
              <text class="step-subtitle">{{ step.subtitle }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="side-collapsed" v-else>
        <button class="side-toggle-btn" type="default" size="mini" @tap="toggleSide">
          展开进度
        </button>
      </view>

      <!-- 右侧：主工作区 -->
      <view class="main-area">
        <!-- 项目头部信息 -->
        <view class="project-header">
          <view class="project-title-row">
            <text class="project-name">{{ project.name || '未命名项目' }}</text>
            <text class="project-type-tag">{{ project.projectTypeLabel || '项目类型待定' }}</text>
          </view>
          <view class="project-meta-row">
            <text class="meta-item">
              上市公司：{{ project.listedCompanyName || '-' }}
            </text>
            <text class="meta-item">
              标的公司：{{ project.targetCompanyName || '-' }}
            </text>
          </view>
        </view>

        <!-- 顶部 Tab -->
        <view class="tab-bar">
          <view
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-item"
            :class="{ 'tab-item-active': activeTab === tab.key }"
            @tap="switchTab(tab.key)"
          >
            <text class="tab-text">{{ tab.label }}</text>
          </view>
        </view>

        <!-- 工作区 -->
        <view class="workspace">
          <!-- 文件 Tab -->
          <view v-if="activeTab === 'files'" class="workspace-files">
            <view class="workspace-left">
              <view class="section-header">
                <text class="section-title">文件目录</text>
              </view>
              <view class="file-tree-placeholder">
                <text class="placeholder-text">文件目录树功能待后续接入后端文书模块。</text>
              </view>
            </view>
            <view class="workspace-right">
              <view class="section-header">
                <text class="section-title">在线编辑</text>
              </view>

              <!-- 初始状态：提示用户点击按钮再加载编辑器，避免一进入页面就全屏加载 -->
              <view v-if="!wpsEverTried" class="editor-placeholder">
                <view>
                  <text class="placeholder-text">
                    尚未加载在线编辑器，请点击下方“开始编辑”按钮。
                  </text>
                </view>
                <view style="margin-top: 16rpx;">
                  <button type="primary" size="mini" @tap="startWpsEdit">
                    开始编辑
                  </button>
                </view>
              </view>

              <!-- 编辑器容器：只有在 wpsEverTried 后才渲染，避免首屏被 WPS 占满 -->
              <view v-else class="wps-container">
                <!--
                  WPS JS SDK 容器：
                  - 使用 JS SDK 初始化编辑器，而不是 iframe
                  - SDK 会自动创建 iframe 并注入到这个容器中
                  - 注意：uni-app 中使用 view 标签，但 SDK 需要真实的 DOM 元素
                -->
                <view :id="wpsContainerId" class="wps-editor-container" style="width: 100%; height: 100%;"></view>

                <!-- 状态提示覆盖层 -->
                <view v-if="wpsLoading" class="editor-placeholder wps-status-layer">
                  <text class="placeholder-text">正在加载编辑器...</text>
                </view>
                <view v-else-if="wpsEverTried && !wpsInstanceReady" class="editor-placeholder wps-status-layer">
                  <text class="placeholder-text">
                    编辑器加载失败，请检查后端配置或刷新页面重试。
                  </text>
                </view>
              </view>
            </view>
          </view>

          <!-- 尽调 Tab -->
          <view v-else-if="activeTab === 'due_diligence'" class="workspace-due">
            <view class="workspace-left">
              <view class="section-header">
                <text class="section-title">尽调模块</text>
              </view>
              <view class="module-list">
                <view class="module-item" v-for="m in dueModules" :key="m.key">
                  <text class="module-title">{{ m.label }}</text>
                  <text class="module-subtitle">{{ m.subtitle }}</text>
                </view>
              </view>
            </view>
            <view class="workspace-right">
              <view class="section-header">
                <text class="section-title">工作区</text>
              </view>
              <view class="workspace-placeholder">
                <text class="placeholder-text">
                  尽调工作区具体布局（任务视图 / 底稿勾稽等）按后续 PRD 细化，这里先留出干净容器。
                </text>
              </view>
            </view>
          </view>

          <!-- 案例 Tab -->
          <view v-else class="workspace-cases">
            <view class="section-header">
              <text class="section-title">案例对标</text>
            </view>
            <view class="workspace-placeholder">
              <text class="placeholder-text">
                案例对标区后续将接入案例服务与项目案例引用，这里先作为占位视图，确保整体布局稳定。
              </text>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { createWpsSession } from '@/services/api.js'
import { initWpsEditor } from '@/utils/wps-sdk.js'

export default {
  data() {
    return {
      projectId: null,
      project: {},
      sideCollapsed: false,
      activeTab: 'files',
      tabs: [
        { key: 'files', label: '文件' },
        { key: 'due_diligence', label: '尽调' },
        { key: 'cases', label: '案例' },
      ],
      steps: [
        { key: 'init', title: '项目启动', subtitle: '基础信息与外部数据', status: 'done' },
        { key: 'dd', title: '尽调与核查', subtitle: '清单与底稿收集', status: 'processing' },
        { key: 'docs', title: '文件起草', subtitle: '会议文件与公告', status: 'pending' },
        { key: 'reg', title: '申报与问询', subtitle: '报送与反馈应对', status: 'pending' },
      ],
      dueModules: [
        { key: 'history', label: '历史沿革', subtitle: '公司设立与重大变更' },
        { key: 'assets', label: '主要资产', subtitle: '核心资产与权属情况' },
        { key: 'related', label: '关联方与同业竞争', subtitle: '关联交易与竞业' },
      ],
      wpsUrl: '',
      wpsLoading: false,
      wpsEverTried: false,
      wpsInstanceReady: false,
      wpsInstance: null,
      wpsContainerId: 'wps-editor-container-' + Date.now(),
      wpsAppId: 'SX20251208BJWRFK', // WPS AppID
    }
  },
  onLoad(query) {
    if (query && query.id) {
      this.projectId = query.id
    }
    if (query && query.name) {
      this.project.name = query.name
    }
    if (query && query.projectTypeLabel) {
      this.project.projectTypeLabel = query.projectTypeLabel
    }
    if (query && query.listedCompanyName) {
      this.project.listedCompanyName = query.listedCompanyName
    }
    if (query && query.targetCompanyName) {
      this.project.targetCompanyName = query.targetCompanyName
    }
  },
  methods: {
    toggleSide() {
      this.sideCollapsed = !this.sideCollapsed
    },
    switchTab(key) {
      this.activeTab = key
      // 用户主动点击“开始编辑”后再加载 WPS，不在切换 Tab 时自动加载
    },
    // 用户点击“开始编辑”按钮时调用
    startWpsEdit() {
      if (!this.wpsInstanceReady && !this.wpsLoading) {
        this.loadWpsEditUrl()
      }
    },
    async loadWpsEditUrl() {
      if (!this.projectId) {
        // 如果没有项目ID，使用默认文件ID
        this.projectId = 'default'
      }
      // 标记已尝试加载，用于控制错误提示展示时机
      this.wpsEverTried = true
      
      this.wpsLoading = true
      try {
        // 生成文件ID：project_{projectId}_doc_1，附带时间戳避免历史状态干扰
        const fileId = `project_${this.projectId}_doc_1_v${Date.now()}`
        const fileName = this.project.name ? `${this.project.name}.docx` : '项目文档.docx'
        let token = ''

        // 先向后端申请一个业务 token，用于 SDK 初始化和回调鉴权
        try {
          const session = await createWpsSession({
            fileId,
            // 预留：后续接入登录体系后，可以传当前登录用户 ID
            // userId: this.currentUserId,
          })
          if (session && session.token) {
            token = session.token
          }
        } catch (e) {
          console.error('创建 WPS 会话失败:', e)
          // 不阻断后续流程，允许在无 token 情况下继续尝试加载编辑器
        }

        // 等待容器元素渲染完成
        await this.$nextTick()
        
        // 再次确认容器元素存在
        const containerElement = document.getElementById(this.wpsContainerId)
        if (!containerElement) {
          throw new Error(`容器元素 ${this.wpsContainerId} 未找到，请检查页面渲染`)
        }
        
        // 使用 JS SDK 初始化编辑器
        // 注意：JS SDK 需要直接使用 fileId 和 appId，不需要生成 URL
        this.wpsInstance = await initWpsEditor({
          containerId: this.wpsContainerId,
          appId: this.wpsAppId,
          fileId: fileId,
          fileName: fileName,
          mode: 'edit',
          token,
        })
        
        this.wpsInstanceReady = true
        console.log('WPS 编辑器初始化成功')
      } catch (error) {
        console.error('Error loading WPS editor:', error)
        uni.showToast({
          title: '加载编辑器失败: ' + (error.message || '未知错误'),
          icon: 'none',
          duration: 3000,
        })
        this.wpsInstanceReady = false
      } finally {
        this.wpsLoading = false
      }
    },
  },
  beforeUnmount() {
    // 组件销毁时，销毁 WPS 实例
    if (this.wpsInstance && this.wpsInstance.destroy) {
      this.wpsInstance.destroy()
    }
  },
}
</script>

<style lang="scss">
.page-project-overview {
  min-height: 100vh;
  padding: 24rpx;
  background-color: $uni-bg-color-grey;
  box-sizing: border-box;
}

.layout {
  display: flex;
  flex-direction: row;
  column-gap: 16rpx;
}

.side-progress {
  width: 260rpx;
  background-color: $uni-bg-color;
  border-radius: 16rpx;
  padding: 16rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.04);
  box-sizing: border-box;
}

.side-collapsed {
  width: 120rpx;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.side-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.side-title {
  font-size: 28rpx;
  font-weight: 500;
  color: $uni-color-title;
}

.side-toggle-btn {
  font-size: 22rpx;
}

.side-body {
  margin-top: 8rpx;
}

.step-item {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  margin-bottom: 16rpx;
}

.step-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  margin-top: 6rpx;
  margin-right: 12rpx;
  background-color: $uni-border-color;
}

.step-status-done {
  background-color: $uni-color-primary;
}

.step-status-processing {
  background-color: $uni-color-warning;
}

.step-status-pending {
  background-color: $uni-border-color;
}

.step-content {
  flex: 1;
}

.step-title {
  display: block;
  font-size: 26rpx;
  color: $uni-text-color;
}

.step-subtitle {
  display: block;
  font-size: 22rpx;
  color: $uni-text-color-grey;
}

.main-area {
  flex: 1;
  min-width: 0;
  background-color: $uni-bg-color;
  border-radius: 16rpx;
  padding: 16rpx 16rpx 24rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.04);
  box-sizing: border-box;
}

.project-header {
  margin-bottom: 16rpx;
}

.project-title-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  column-gap: 12rpx;
  margin-bottom: 8rpx;
}

.project-name {
  font-size: 34rpx;
  font-weight: 500;
  color: $uni-color-title;
}

.project-type-tag {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  // 使用主色的浅色透明背景，避免新增硬编码颜色变量
  background-color: rgba($uni-color-primary, 0.08);
  color: $uni-color-primary;
}

.project-meta-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  column-gap: 24rpx;
  row-gap: 4rpx;
}

.meta-item {
  font-size: 24rpx;
  color: $uni-text-color-grey;
}

.tab-bar {
  display: flex;
  flex-direction: row;
  border-bottom-width: 1rpx;
  border-bottom-style: solid;
  border-bottom-color: $uni-border-color;
  margin-top: 8rpx;
}

.tab-item {
  padding: 16rpx 24rpx;
}

.tab-item-active {
  border-bottom-width: 4rpx;
  border-bottom-style: solid;
  border-bottom-color: $uni-color-primary;
}

.tab-text {
  font-size: 26rpx;
  color: $uni-text-color-grey;
}

.tab-item-active .tab-text {
  color: $uni-color-primary;
  font-weight: 500;
}

.workspace {
  margin-top: 16rpx;
}

.workspace-files,
.workspace-due {
  display: flex;
  flex-direction: row;
  column-gap: 16rpx;
}

.workspace-left {
  width: 260rpx;
}

.workspace-right {
  flex: 1;
  min-width: 0;
  /* 让右侧工作区内部可以滚动，避免 WPS 编辑器撑满整屏 */
  max-height: calc(100vh - 260rpx);
  overflow: hidden;
}

.section-header {
  margin-bottom: 8rpx;
}

.section-title {
  font-size: 26rpx;
  font-weight: 500;
  color: $uni-color-title;
}

.file-tree-placeholder,
.editor-placeholder,
.wps-container,
.workspace-placeholder {
  min-height: 260rpx;
  border-radius: 12rpx;
  border-width: 1rpx;
  border-style: dashed;
  border-color: $uni-border-color;
  padding: 16rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.wps-container {
  position: relative;
  padding: 0;
  border-style: solid;
  /* 限制编辑区域高度，防止占满整屏；保留上方项目信息和 Tab */
  height: calc(100vh - 360rpx);
  max-height: 800px;
  overflow: hidden;
}

/* WPS 编辑器状态覆盖层：保持容器节点存在，仅用半透明层做状态提示 */
.wps-status-layer {
  position: absolute;
  inset: 0;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.8);
}

.wps-frame {
  width: 100%;
  height: 520rpx;
  border: none;
}

.placeholder-text {
  font-size: 24rpx;
  color: $uni-text-color-grey;
}

.module-list {
  border-radius: 12rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: $uni-border-color;
  overflow: hidden;
}

.module-item {
  padding: 16rpx;
  border-bottom-width: 1rpx;
  border-bottom-style: solid;
  border-bottom-color: $uni-border-color;
}

.module-item:last-child {
  border-bottom-width: 0;
}

.module-title {
  display: block;
  font-size: 26rpx;
  color: $uni-text-color;
  margin-bottom: 4rpx;
}

.module-subtitle {
  display: block;
  font-size: 22rpx;
  color: $uni-text-color-grey;
}
</style>


