<template>
  <view class="page-admin">
    <view class="admin-layout">
      <!-- 左侧导航 -->
      <view class="admin-sider">
        <view class="admin-title">系统管理</view>
        <view
          v-for="nav in navItems"
          :key="nav.key"
          class="nav-item"
          :class="{ active: activeNav === nav.key }"
          @tap="activeNav = nav.key"
        >
          <text class="nav-text">{{ nav.label }}</text>
        </view>
      </view>

      <!-- 右侧内容 -->
      <view class="admin-main">
        <!-- 配置管理 -->
        <scroll-view
          v-if="activeNav === 'config'"
          scroll-y
          class="config-scroll"
        >
          <!-- 外部服务 -->
          <view class="section-card">
            <view class="section-header">
              <text class="section-title">外部服务供应商</text>
              <text class="section-subtitle">
                配置 Google（Gemini）、企查查、Tushare、WPS 的接入参数
              </text>
            </view>
            <view class="section-body">
              <!-- Google / Gemini -->
              <view class="provider-card">
                <view class="provider-header">
                  <text class="provider-name">Google（Gemini）</text>
                </view>
                <view class="form-row">
                  <text class="form-label">API Key</text>
                  <input
                    v-model="form.external.google.apiKey"
                    class="form-input"
                    placeholder="请输入 Google Gemini API Key"
                  />
                </view>
                <view class="form-row">
                  <text class="form-label">模型名称</text>
                  <input
                    v-model="form.external.google.modelName"
                    class="form-input"
                    placeholder="例如：gemini-2.5-pro"
                  />
                </view>
                <view class="form-row">
                  <text class="form-label">API 地址</text>
                  <input
                    v-model="form.external.google.apiBaseUrl"
                    class="form-input"
                    placeholder="https://generativelanguage.googleapis.com/v1beta"
                  />
                </view>
              </view>

              <!-- 企查查 -->
              <view class="provider-card">
                <view class="provider-header">
                  <text class="provider-name">企查查</text>
                </view>
                <view class="form-row">
                  <text class="form-label">Base URL</text>
                  <input
                    v-model="form.external.qichacha.baseUrl"
                    class="form-input"
                    placeholder="https://api.qichacha.com"
                  />
                </view>
                <view class="form-row">
                  <text class="form-label">Key</text>
                  <input
                    v-model="form.external.qichacha.key"
                    class="form-input"
                    placeholder="请输入 key"
                  />
                </view>
                <view class="form-row">
                  <text class="form-label">Secret</text>
                  <input
                    v-model="form.external.qichacha.secret"
                    class="form-input"
                    placeholder="请输入 secret"
                  />
                </view>
              </view>

              <!-- Tushare -->
              <view class="provider-card">
                <view class="provider-header">
                  <text class="provider-name">Tushare</text>
                </view>
                <view class="form-row">
                  <text class="form-label">Base URL</text>
                  <input
                    v-model="form.external.tushare.baseUrl"
                    class="form-input"
                    placeholder="http://api.tushare.pro"
                  />
                </view>
                <view class="form-row">
                  <text class="form-label">Token</text>
                  <input
                    v-model="form.external.tushare.token"
                    class="form-input"
                    placeholder="请输入 Token"
                  />
                </view>
              </view>

              <!-- WPS -->
              <view class="provider-card">
                <view class="provider-header">
                  <text class="provider-name">WPS WebOffice</text>
                </view>
                <view class="form-row">
                  <text class="form-label">App ID</text>
                  <input
                    v-model="form.external.wps.appId"
                    class="form-input"
                    placeholder="请输入 App ID"
                  />
                </view>
                <view class="form-row">
                  <text class="form-label">App Secret</text>
                  <input
                    v-model="form.external.wps.appSecret"
                    class="form-input"
                    placeholder="请输入 App Secret"
                  />
                </view>
                <view class="form-row">
                  <text class="form-label">回调网关</text>
                  <input
                    v-model="form.external.wps.callbackBaseUrl"
                    class="form-input"
                    placeholder="https://..."
                  />
                </view>
              </view>
            </view>
          </view>

          <!-- AI 配置 -->
          <view class="section-card">
            <view class="section-header">
              <text class="section-title">AI 服务配置</text>
              <text class="section-subtitle">
                配置系统提示词与当前使用的大模型供应商
              </text>
            </view>
            <view class="section-body">
              <view class="form-row">
                <text class="form-label">激活供应商</text>
                <view class="provider-radio-group">
                  <view
                    v-for="opt in aiProviderOptions"
                    :key="opt.value"
                    class="radio-item"
                    :class="{ checked: form.ai.activeProvider === opt.value }"
                    @tap="form.ai.activeProvider = opt.value"
                  >
                    <view class="radio-dot"></view>
                    <text class="radio-label">{{ opt.label }}</text>
                  </view>
                </view>
              </view>
              <view class="form-row vertical">
                <text class="form-label">系统提示词</text>
                <textarea
                  class="prompt-textarea"
                  v-model="form.ai.systemPrompt"
                  placeholder="用于约束 AI 行为的系统提示词，例如：只有在用户明确要求时才创建或保存文件..."
                  :maxlength="-1"
                  auto-height
                />
              </view>
            </view>
          </view>

          <!-- 保存按钮 -->
          <view class="fixed-footer">
            <button
              class="btn-save"
              type="primary"
              :loading="saving"
              @tap="handleSave"
            >
              保存配置
            </button>
          </view>
        </scroll-view>

        <!-- 用户管理 -->
        <scroll-view
          v-else
          scroll-y
          class="config-scroll"
        >
          <view class="section-card">
            <view class="section-header">
              <text class="section-title">用户管理</text>
              <text class="section-subtitle">
                当前系统中的注册用户（暂为只读列表）
              </text>
            </view>
            <view class="section-body">
              <view v-if="usersLoading" class="loading">
                <text class="loading-text">加载中...</text>
              </view>
              <view v-else-if="users.length === 0" class="empty">
                <text class="empty-text">暂无用户</text>
              </view>
              <view v-else class="user-list">
                <view
                  v-for="u in users"
                  :key="u.id"
                  class="user-row"
                >
                  <view class="user-main">
                    <view class="avatar-mini">
                      <text class="avatar-char">
                        {{ (u.displayName || u.username || 'U').charAt(0) }}
                      </text>
                    </view>
                    <view class="user-meta">
                      <text class="user-name">
                        {{ u.displayName || u.username }}
                        <text
                          v-if="u.username === 'admin'"
                          class="admin-tag"
                        >
                          管理员
                        </text>
                      </text>
                      <text class="user-sub">
                        @{{ u.username }} · ID: {{ u.id }}
                      </text>
                    </view>
                  </view>
                  <view class="user-extra">
                    <text class="user-email">{{ u.email || '—' }}</text>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script>
import { getAdminConfig, saveAdminConfig, getAdminUsers } from '@/services/api.js'

export default {
  name: 'AdminPage',
  data() {
    return {
      activeNav: 'config',
      navItems: [
        { key: 'config', label: '系统配置' },
        { key: 'users', label: '用户管理' },
      ],
      form: {
        external: {
          google: { apiKey: '', modelName: '', apiBaseUrl: '' },
          qichacha: { baseUrl: '', key: '', secret: '' },
          tushare: { baseUrl: '', token: '' },
          wps: { appId: '', appSecret: '', callbackBaseUrl: '' },
        },
        ai: {
          systemPrompt: '',
          activeProvider: 'OLLAMA',
        },
      },
      aiProviderOptions: [
        { value: 'OLLAMA', label: '本地 Ollama' },
        { value: 'GEMINI', label: 'Google Gemini' },
      ],
      saving: false,
      usersLoading: false,
      users: [],
    }
  },
  onLoad() {
    this.loadConfig()
    this.loadUsers()
  },
  methods: {
    async loadConfig() {
      try {
        const data = await getAdminConfig()
        if (data && data.external) {
          this.form.external = {
            google: {
              apiKey: data.external.google?.apiKey || '',
              modelName: data.external.google?.modelName || '',
              apiBaseUrl: data.external.google?.apiBaseUrl || '',
            },
            qichacha: {
              baseUrl: data.external.qichacha?.baseUrl || '',
              key: data.external.qichacha?.key || '',
              secret: data.external.qichacha?.secret || '',
            },
            tushare: {
              baseUrl: data.external.tushare?.baseUrl || '',
              token: data.external.tushare?.token || '',
            },
            wps: {
              appId: data.external.wps?.appId || '',
              appSecret: data.external.wps?.appSecret || '',
              callbackBaseUrl: data.external.wps?.callbackBaseUrl || '',
            },
          }
        }
        if (data && data.ai) {
          this.form.ai.systemPrompt = data.ai.systemPrompt || ''
          this.form.ai.activeProvider = data.ai.activeProvider || 'OLLAMA'
        }
      } catch (e) {
        console.error('加载后台配置失败', e)
        uni.showToast({ title: '加载配置失败', icon: 'none' })
      }
    },
    async loadUsers() {
      this.usersLoading = true
      try {
        const list = await getAdminUsers()
        this.users = Array.isArray(list) ? list : []
      } catch (e) {
        console.error('加载用户列表失败', e)
      } finally {
        this.usersLoading = false
      }
    },
    async handleSave() {
      this.saving = true
      try {
        await saveAdminConfig(this.form)
        uni.showToast({ title: '保存成功', icon: 'success' })
      } catch (e) {
        console.error('保存后台配置失败', e)
        uni.showToast({
          title: e.message || '保存失败',
          icon: 'none',
        })
      } finally {
        this.saving = false
      }
    },
  },
}
</script>

<style lang="scss" scoped>
$brand-gold: #C8A45D;
$brand-dark: #12344D;
$brand-bg: #F7F5F0;
$brand-white: #FFFFFF;
$text-main: #1A1A1A;
$text-secondary: #666666;
$border-color: #E0E0E0;

.page-admin {
  min-height: 100vh;
  background-color: $brand-bg;
  padding: 32px 24px;
  box-sizing: border-box;
}

.admin-layout {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: row;
  gap: 24px;
}

.admin-sider {
  width: 220px;
  flex-shrink: 0;
  background: $brand-white;
  border-radius: 16px;
  box-shadow: 0 4px 16px rgba(18, 52, 77, 0.05);
  padding: 20px 16px;
}

.admin-title {
  font-size: 18px;
  font-weight: 600;
  color: $text-main;
  margin-bottom: 16px;
}

.nav-item {
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 4px;
}

.nav-item.active {
  background: rgba(18, 52, 77, 0.06);
}

.nav-text {
  font-size: 14px;
  color: $text-secondary;
}

.nav-item.active .nav-text {
  color: $brand-dark;
  font-weight: 600;
}

.admin-main {
  flex: 1;
  min-width: 0;
  background: transparent;
}

.config-scroll {
  height: calc(100vh - 80px);
}

.section-card {
  background: $brand-white;
  border-radius: 16px;
  box-shadow: 0 4px 16px rgba(18, 52, 77, 0.04);
  margin-bottom: 20px;
  overflow: hidden;
}

.section-header {
  padding: 20px 24px 12px;
  border-bottom: 1px solid #f1f1f1;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: $text-main;
}

.section-subtitle {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: $text-secondary;
}

.section-body {
  padding: 16px 24px 24px;
}

.provider-card {
  border: 1px solid #f1f1f1;
  border-radius: 12px;
  padding: 12px 16px 8px;
  margin-bottom: 12px;
}

.provider-header {
  margin-bottom: 8px;
}

.provider-name {
  font-size: 14px;
  font-weight: 600;
  color: $text-main;
}

.form-row {
  display: flex;
  align-items: center;
  margin: 8px 0;
}

.form-row.vertical {
  flex-direction: column;
  align-items: flex-start;
}

.form-label {
  width: 90px;
  font-size: 13px;
  color: $text-secondary;
}

.form-input {
  flex: 1;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  font-size: 13px;
  background-color: #fafafa;
}

.prompt-textarea {
  width: 100%;
  min-height: 80px;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  font-size: 13px;
  background-color: #fafafa;
  box-sizing: border-box;
}

.provider-radio-group {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.radio-item {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
}

.radio-item.checked {
  border-color: $brand-dark;
  background: rgba(18, 52, 77, 0.06);
}

.radio-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid #9ca3af;
  margin-right: 6px;
}

.radio-item.checked .radio-dot {
  border-color: $brand-dark;
  background: $brand-dark;
}

.radio-label {
  font-size: 12px;
  color: $text-secondary;
}

.fixed-footer {
  padding: 12px 24px 24px;
  display: flex;
  justify-content: flex-end;
}

.btn-save {
  min-width: 120px;
  height: 36px;
  line-height: 36px;
  background: $brand-dark;
  color: #fff;
  border-radius: 999px;
  font-size: 14px;
  border: none;
}

.user-list {
  display: flex;
  flex-direction: column;
}

.user-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #f1f1f1;
}

.user-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-mini {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: $brand-dark;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-char {
  font-size: 16px;
  color: #fff;
}

.user-meta {
  display: flex;
  flex-direction: column;
}

.user-name {
  font-size: 14px;
  color: $text-main;
}

.user-sub {
  font-size: 12px;
  color: $text-secondary;
}

.admin-tag {
  margin-left: 6px;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(200, 164, 93, 0.12);
  color: $brand-gold;
}

.user-extra {
  font-size: 12px;
  color: $text-secondary;
}

.loading,
.empty {
  padding: 20px 0;
  text-align: center;
}

.loading-text,
.empty-text {
  font-size: 13px;
  color: $text-secondary;
}
</style>


