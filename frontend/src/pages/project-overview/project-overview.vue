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
              <view v-if="wpsUrl" class="wps-container">
                <!--
                  这里通过 iframe 承载 WPS WebOffice 在线编辑页面：
                  - wpsUrl 由后端生成并通过环境变量注入（或后续按项目与文档 ID 拼接）；
                  - 后续接入 JS SDK 后，可以改为在容器 div 上初始化 WPS 对象并绑定 JSAPI。
                -->
                <iframe class="wps-frame" :src="wpsUrl" frameborder="0"></iframe>
              </view>
              <view v-else class="editor-placeholder">
                <text class="placeholder-text">
                  未配置 WPS 在线编辑地址，请在环境变量 VITE_WPS_WEB_OFFICE_DEMO_URL 中填入后端生成的编辑链接。
                </text>
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
import { WPS_WEB_OFFICE_DEMO_URL } from '@/config/wps.js'

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
      wpsUrl: WPS_WEB_OFFICE_DEMO_URL,
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
    },
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
}

.wps-container {
  padding: 0;
  border-style: solid;
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


