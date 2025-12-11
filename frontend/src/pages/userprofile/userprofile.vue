<template>
  <view class="page-userprofile">
    <view class="workbench-container">
      <!-- 左侧个人信息卡片 -->
      <view class="user-sidebar">
        <view class="user-card">
          <view class="card-gold-accent"></view>
          <view class="user-profile-main">
            <view class="user-avatar-wrapper">
              <image
                v-if="userInfo.avatarUrl"
                class="user-avatar"
                :src="userInfo.avatarUrl"
                mode="aspectFill"
              />
              <view v-else class="user-avatar-placeholder">
                <text class="avatar-text">{{ userInfo.displayName?.charAt(0) || 'U' }}</text>
              </view>
            </view>
            <text class="user-name">{{ userInfo.displayName || '用户' }}</text>
            <text class="user-handle">@{{ userInfo.username || userInfo.id || 'unknown' }}</text>
            <view class="user-role-tag">
              <text class="role-text">标准用户</text>
            </view>
          </view>
          
          <view class="user-actions">
          <view class="action-item">
            <text class="action-text">编辑资料</text>
            <text class="action-arrow">›</text>
          </view>
          <view class="action-item">
            <text class="action-text">我的组织</text>
            <text class="action-arrow">›</text>
          </view>
          <view
            v-if="userInfo.username === 'admin'"
            class="action-item"
            @tap="goToAdmin"
          >
            <text class="action-text">后台管理</text>
            <text class="action-arrow">›</text>
          </view>
          </view>
        </view>
      </view>

      <!-- 右侧主内容区 -->
      <view class="main-content">
        <!-- 顶部 Tab 栏 -->
        <view class="content-tabs">
          <view
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-item"
            :class="{ 'tab-item-active': activeTab === tab.key }"
            @tap="switchTab(tab.key)"
          >
            <text class="tab-label">{{ tab.label }}</text>
            <view class="tab-indicator" v-if="activeTab === tab.key"></view>
          </view>
        </view>

        <!-- Tab 内容区 -->
        <view class="tab-panel-container">
          
          <!-- 我的项目 Tab -->
          <view v-if="activeTab === 'projects'" class="panel-projects">
            <!-- 概览统计行 (UI容器) -->
            <view class="projects-stats-row">
              <view class="stat-card">
                <text class="stat-value">{{ projects.length }}</text>
                <text class="stat-label">全部项目</text>
              </view>
              <view class="stat-card">
                <text class="stat-value">0</text>
                <text class="stat-label">进行中</text>
              </view>
              <view class="stat-card">
                <text class="stat-value">0</text>
                <text class="stat-label">已完成</text>
              </view>
              <view class="stat-card action-card" @tap="goToNewProject">
                <view class="add-icon">+</view>
                <text class="stat-label">新建项目</text>
              </view>
            </view>

            <!-- 项目列表 -->
            <view v-if="projectsLoading" class="loading-state">
              <text class="loading-text">加载中...</text>
            </view>

            <view v-else-if="projects.length === 0" class="empty-state">
              <view class="empty-icon-circle">
                <text class="empty-icon">📂</text>
              </view>
              <text class="empty-title">暂无项目</text>
              <text class="empty-desc">您还没有创建任何项目，开始您的第一个项目吧</text>
              <button class="btn-create-first" @tap="goToNewProject">新建项目</button>
            </view>

            <view v-else class="project-grid">
              <view
                v-for="project in projects"
                :key="project.id"
                class="project-item-card"
                @tap="goToProject(project.id)"
              >
                <view class="project-card-top">
                  <view class="project-title-row">
                    <text class="project-title">{{ project.name }}</text>
                    <view class="project-type-badge">
                      <text class="badge-text">{{ getProjectTypeLabel(project.projectType) }}</text>
                    </view>
                  </view>
                  <view class="project-info-grid">
                    <view class="info-row">
                      <text class="info-label">上市公司：</text>
                      <text class="info-val">{{ project.listedCompanyName || '-' }}</text>
                    </view>
                    <view class="info-row">
                      <text class="info-label">标的公司：</text>
                      <text class="info-val">{{ project.targetCompanyName || '-' }}</text>
                    </view>
                    <view class="info-row">
                      <text class="info-label">创建时间：</text>
                      <text class="info-val">{{ formatTime(project.createdAt) }}</text>
                    </view>
                  </view>
                </view>
                
                <view class="project-card-bottom">
                  <button
                    class="btn-danger-outline"
                    @tap.stop="handleDeleteProject(project.id)"
                    :loading="deletingProjectId === project.id"
                  >
                    删除
                  </button>
                  <button class="btn-enter" @tap.stop="goToProject(project.id)">
                    进入项目
                  </button>
                </view>
              </view>
            </view>
          </view>

          <!-- 我的收藏 (UI 占位) -->
          <view v-else-if="activeTab === 'favorites'" class="panel-placeholder">
            <view class="empty-state">
              <view class="empty-icon-circle">
                <text class="empty-icon">⭐</text>
              </view>
              <text class="empty-title">我的收藏</text>
              <text class="empty-desc">暂无收藏内容</text>
            </view>
          </view>

          <!-- 我的代办 (UI 占位) -->
          <view v-else-if="activeTab === 'todos'" class="panel-placeholder">
            <view class="empty-state">
              <view class="empty-icon-circle">
                <text class="empty-icon">📝</text>
              </view>
              <text class="empty-title">我的代办</text>
              <text class="empty-desc">暂无待办事项</text>
            </view>
          </view>

          <!-- 设置 (UI 占位) -->
          <view v-else-if="activeTab === 'settings'" class="panel-settings">
            <view class="settings-form">
              <view class="form-group">
                <text class="group-title">基本信息</text>
                <view class="form-row">
                  <text class="form-label">头像</text>
                  <view class="avatar-preview">
                    <text class="avatar-char">{{ userInfo.displayName?.charAt(0) || 'U' }}</text>
                  </view>
                </view>
                <view class="form-row">
                  <text class="form-label">昵称</text>
                  <text class="form-value">{{ userInfo.displayName }}</text>
                </view>
              </view>
              
              <view class="form-group">
                <text class="group-title">账号安全</text>
                <view class="form-row">
                  <text class="form-label">修改密码</text>
                  <text class="link-text">点击修改</text>
                </view>
              </view>
            </view>
          </view>

        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getMyProjects, deleteProject, getCurrentUser as getCurrentUserApi } from '@/services/api.js'
import { getProjectTypeLabel } from '@/config/projectTypes.js'
import { getCurrentUser, isLoggedIn, getSessionId } from '@/utils/auth.js'

export default {
  name: 'UserProfile',
  data() {
    return {
      activeTab: 'projects',
      tabs: [
        { key: 'projects', label: '我的项目' },
        { key: 'favorites', label: '我的收藏' },
        { key: 'todos', label: '我的代办' },
        { key: 'settings', label: '设置' },
      ],
      userInfo: {
        id: null,
        username: '',
        displayName: '用户',
        avatarUrl: null,
      },
      projects: [],
      projectsLoading: false,
      deletingProjectId: null,
    }
  },
  onLoad() {
    // 检查登录状态
    const sessionId = getSessionId()
    const user = getCurrentUser()
    
    if (!sessionId || !user) {
      console.warn('未登录，跳转到登录页', { sessionId, user })
      uni.reLaunch({
        url: '/pages/login/login',
      })
      return
    }

    // 延迟加载，确保页面完全加载后再请求数据
    this.$nextTick(() => {
      // 加载用户信息
      this.loadUserInfo()
      // 加载项目列表
      this.loadProjects()
    })
  },
  methods: {
    switchTab(key) {
      this.activeTab = key
    },
    async loadUserInfo() {
      const user = getCurrentUser()
      if (user) {
        this.userInfo = user
      } else {
        // 如果本地没有，尝试从服务器获取
        try {
          const res = await getCurrentUserApi()
          if (res.code === 0 && res.data) {
            this.userInfo = res.data
          }
        } catch (error) {
          console.error('获取用户信息失败:', error)
        }
      }
    },
    async loadProjects() {
      this.projectsLoading = true
      try {
        this.projects = await getMyProjects()
      } catch (error) {
        console.error('加载项目列表失败:', error)
        // 错误处理逻辑保持不变
        if (error.message && error.message.includes('登录')) {
          uni.reLaunch({
            url: '/pages/login/login',
          })
        } else {
          uni.showToast({
            title: error.message || '加载失败，请稍后重试',
            icon: 'none',
            duration: 2000,
          })
        }
      } finally {
        this.projectsLoading = false
      }
    },
    getProjectTypeLabel(projectType) {
      return getProjectTypeLabel(projectType) || projectType
    },
    formatTime(timeStr) {
      if (!timeStr) return ''
      try {
        const date = new Date(timeStr)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      } catch (e) {
        return timeStr
      }
    },
    goToProject(projectId) {
      uni.navigateTo({
        url: `/pages/project-overview/project-overview?id=${projectId}`,
      })
    },
    async handleDeleteProject(projectId) {
      uni.showModal({
        title: '确认删除',
        content: '确定要删除这个项目吗？删除后无法恢复。',
        success: async (res) => {
          if (res.confirm) {
            this.deletingProjectId = projectId
            try {
              await deleteProject(projectId)
              uni.showToast({
                title: '删除成功',
                icon: 'success',
                duration: 2000,
              })
              // 重新加载项目列表
              await this.loadProjects()
            } catch (error) {
              console.error('删除项目失败:', error)
              uni.showToast({
                title: error.message || '删除失败，请稍后重试',
                icon: 'none',
                duration: 2000,
              })
            } finally {
              this.deletingProjectId = null
            }
          }
        },
      })
    },
    goToNewProject() {
      uni.navigateTo({
        url: '/pages/newproject/index',
      })
    },
    goToAdmin() {
      uni.navigateTo({
        url: '/pages/admin/admin',
      })
    },
  },
}
</script>

<style lang="scss" scoped>
/* 品牌配色变量 */
$brand-gold: #C8A45D;
$brand-dark: #12344D;
$brand-bg: #F7F5F0;
$brand-white: #FFFFFF;
$text-main: #1A1A1A;
$text-secondary: #666666;
$text-light: #999999;
$border-color: #E0E0E0;
$danger-color: #E02020;

.page-userprofile {
  min-height: 100vh;
  background-color: $brand-bg;
  padding: 40px 24px;
  box-sizing: border-box;
}

.workbench-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 24px;
}

/* 左侧边栏 */
.user-sidebar {
  width: 280px;
  flex-shrink: 0;
}

.user-card {
  background: $brand-white;
  border-radius: 16px;
  box-shadow: 0 4px 16px rgba(18, 52, 77, 0.05);
  overflow: hidden;
  position: relative;
  padding-bottom: 24px;
}

.card-gold-accent {
  height: 6px;
  width: 100%;
  background: $brand-gold;
}

.user-profile-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px;
  border-bottom: 1px solid $border-color;
}

.user-avatar-wrapper {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  margin-bottom: 16px;
  background-color: #eef2f5;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}

.user-avatar {
  width: 100%;
  height: 100%;
}

.user-avatar-placeholder {
  width: 100%;
  height: 100%;
  background: $brand-dark;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-text {
  font-size: 32px;
  color: #fff;
  font-weight: 500;
}

.user-name {
  font-size: 20px;
  font-weight: 600;
  color: $text-main;
  margin-bottom: 4px;
}

.user-handle {
  font-size: 14px;
  color: $text-secondary;
  margin-bottom: 12px;
}

.user-role-tag {
  background: rgba(200, 164, 93, 0.1);
  padding: 4px 12px;
  border-radius: 99px;
  border: 1px solid rgba(200, 164, 93, 0.2);
}

.role-text {
  font-size: 12px;
  color: $brand-gold;
  font-weight: 500;
}

.user-actions {
  padding: 16px 0 0;
}

.action-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  cursor: pointer;
  transition: background 0.2s;
  
  &:hover {
    background-color: #F8F9FA;
  }
}

.action-text {
  font-size: 14px;
  color: $text-main;
}

.action-arrow {
  font-size: 18px;
  color: $text-light;
  font-family: monospace;
}

/* 右侧主内容区 */
.main-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.content-tabs {
  display: flex;
  flex-direction: row;
  border-bottom: 1px solid $border-color;
  margin-bottom: 24px;
  padding-left: 8px;
}

.tab-item {
  padding: 16px 24px;
  cursor: pointer;
  position: relative;
  
  &:hover .tab-label {
    color: $brand-dark;
  }
}

.tab-label {
  font-size: 16px;
  color: $text-secondary;
  font-weight: 400;
  transition: color 0.2s;
}

.tab-item-active .tab-label {
  color: $brand-dark;
  font-weight: 600;
}

.tab-indicator {
  position: absolute;
  bottom: 0;
  left: 24px;
  right: 24px;
  height: 3px;
  background: $brand-gold;
  border-radius: 3px 3px 0 0;
}

/* 概览统计 */
.projects-stats-row {
  display: flex;
  flex-direction: row;
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  flex: 1;
  background: $brand-white;
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 8px rgba(18, 52, 77, 0.03);
  display: flex;
  flex-direction: column;
  justify-content: center;
  
  &.action-card {
    align-items: center;
    cursor: pointer;
    border: 1px dashed $brand-gold;
    background: rgba(200, 164, 93, 0.02);
    transition: all 0.2s;
    
    &:hover {
      background: rgba(200, 164, 93, 0.08);
    }
  }
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: $brand-dark;
  margin-bottom: 4px;
  font-family: 'Helvetica Neue', Helvetica, sans-serif;
}

.stat-label {
  font-size: 13px;
  color: $text-secondary;
}

.add-icon {
  font-size: 24px;
  color: $brand-gold;
  margin-bottom: 2px;
  line-height: 1;
}

/* 项目列表 */
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.project-item-card {
  background: $brand-white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(18, 52, 77, 0.04);
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: all 0.2s;
  border: 1px solid transparent;
  min-height: 180px;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(18, 52, 77, 0.08);
    border-color: rgba(200, 164, 93, 0.3);
  }
}

.project-card-top {
  display: flex;
  flex-direction: column;
}

.project-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 12px;
}

.project-title {
  font-size: 18px;
  font-weight: 600;
  color: $text-main;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.project-type-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  background: #f0f2f5;
  border-radius: 4px;
  border: 1px solid #e1e4e8;
}

.badge-text {
  font-size: 12px;
  color: $text-secondary;
}

.project-info-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  font-size: 13px;
  line-height: 1.5;
}

.info-label {
  color: $text-light;
  width: 70px;
  flex-shrink: 0;
}

.info-val {
  color: $text-secondary;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-card-bottom {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #f5f5f5;
}

.btn-danger-outline {
  margin: 0;
  padding: 0 16px;
  height: 32px;
  line-height: 30px;
  background: transparent;
  border: 1px solid #ffcccc;
  color: #d32f2f;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  box-sizing: border-box;
  
  &::after { border: none; }
  
  &:hover {
    background: #fff5f5;
  }
}

.btn-enter {
  margin: 0;
  padding: 0 20px;
  height: 32px;
  line-height: 32px;
  background: $brand-dark;
  color: #fff;
  font-size: 13px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  
  &::after { border: none; }
  
  &:hover {
    background: lighten($brand-dark, 5%);
    box-shadow: 0 2px 8px rgba(18, 52, 77, 0.2);
  }
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 0;
  text-align: center;
}

.empty-icon-circle {
  width: 80px;
  height: 80px;
  background: rgba(200, 164, 93, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
}

.empty-icon {
  font-size: 32px;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: $text-main;
  margin-bottom: 8px;
}

.empty-desc {
  font-size: 14px;
  color: $text-light;
  margin-bottom: 32px;
}

.btn-create-first {
  background: $brand-gold;
  color: white;
  padding: 0 32px;
  height: 44px;
  line-height: 44px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 500;
  border: none;
  box-shadow: 0 4px 12px rgba(200, 164, 93, 0.3);
  
  &:hover {
    background: darken($brand-gold, 5%);
  }
}

/* 占位 Tab */
.panel-placeholder {
  background: $brand-white;
  border-radius: 12px;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 12px rgba(18, 52, 77, 0.04);
}

/* 设置 Tab */
.panel-settings {
  background: $brand-white;
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 2px 12px rgba(18, 52, 77, 0.04);
}

.group-title {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: $text-main;
  margin-bottom: 24px;
  padding-left: 12px;
  border-left: 4px solid $brand-gold;
}

.form-group {
  margin-bottom: 40px;
}

.form-row {
  display: flex;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid #f0f0f0;
  
  &:last-child {
    border-bottom: none;
  }
}

.form-label {
  width: 100px;
  font-size: 14px;
  color: $text-secondary;
}

.form-value {
  font-size: 14px;
  color: $text-main;
  font-weight: 500;
}

.link-text {
  font-size: 14px;
  color: $brand-dark;
  cursor: pointer;
  text-decoration: underline;
}

.avatar-preview {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: $brand-dark;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 20px;
}

/* 响应式适配 */
@media screen and (max-width: 768px) {
  .workbench-container {
    flex-direction: column;
  }
  
  .user-sidebar {
    width: 100%;
  }
  
  .projects-stats-row {
    flex-wrap: wrap;
  }
  
  .stat-card {
    min-width: 45%;
  }
}
</style>
