<template>
  <view class="page-login">
    <!-- 顶部导航条 -->
    <view class="top-navbar">
      <view class="nav-left">
        <image class="nav-logo" src="/static/logo.png" mode="heightFix" />
        <text class="nav-brand">资易</text>
      </view>
      <view class="nav-right">
        <text class="nav-link">使用指引</text>
        <text class="nav-link">帮助中心</text>
        <text class="nav-link">官网</text>
      </view>
    </view>

    <view class="login-layout">
      <!-- 品牌展示区 -->
      <view class="brand-panel">
        <view class="brand-content">
          <image
            class="brand-logo-left"
            src="/static/logo.png"
            mode="heightFix"
          />
          <view class="brand-text-block">
            <view class="brand-title-row">
              <text class="brand-title">资易</text>
              <text class="brand-separator">·</text>
              <text class="brand-subtitle">让资本市场更加容易</text>
            </view>
            <view class="brand-description">
              <text class="desc-line">帮法律人聚焦专业判断</text>
            </view>
          </view>
        </view>
        <view class="brand-decoration">
          <view class="decoration-layer decoration-large" />
          <view class="decoration-layer decoration-small" />
        </view>
      </view>

      <!-- 登录卡片区 -->
      <view class="auth-panel">
        <view class="login-card">
          <view class="login-card-header">
            <view class="card-logo-row">
              <image class="card-logo" src="/static/logo.png" mode="heightFix" />
              <text class="card-title">资易</text>
            </view>

            <!-- Tab 切换：登录/注册 -->
            <view class="tab-bar">
              <view
                class="tab-item"
                :class="{ 'tab-item-active': activeTab === 'login' }"
                @tap="switchTab('login')"
              >
                <text class="tab-text">登录</text>
              </view>
              <view
                class="tab-item"
                :class="{ 'tab-item-active': activeTab === 'register' }"
                @tap="switchTab('register')"
              >
                <text class="tab-text">注册</text>
              </view>
            </view>
          </view>

          <!-- 登录表单 -->
          <view v-if="activeTab === 'login'" class="form-container">
            <view class="form-item">
              <text class="form-label">用户名</text>
              <input
                class="form-input"
                type="text"
                placeholder="请输入用户名"
                v-model="loginForm.username"
              />
            </view>
            <view class="form-item">
              <text class="form-label">密码</text>
              <input
                class="form-input"
                type="password"
                placeholder="请输入密码"
                v-model="loginForm.password"
                @confirm="handleLogin"
              />
            </view>
            <view class="form-extra-row">
              <view class="extra-left">
                <view class="checkbox-visual" />
                <text class="extra-text">记住我</text>
              </view>
              <text class="extra-link">忘记密码</text>
            </view>
            <button
              class="btn btn-primary"
              type="primary"
              :loading="loginLoading"
              @tap="handleLogin"
            >
              登录
            </button>
          </view>

          <!-- 注册表单 -->
          <view v-else class="form-container">
            <view class="form-item">
              <text class="form-label">用户名</text>
              <input
                class="form-input"
                type="text"
                placeholder="请输入用户名（6-20个字符）"
                v-model="registerForm.username"
              />
            </view>
            <view class="form-item">
              <text class="form-label">显示名称</text>
              <input
                class="form-input"
                type="text"
                placeholder="请输入显示名称（可选）"
                v-model="registerForm.displayName"
              />
            </view>
            <view class="form-item">
              <text class="form-label">密码</text>
              <input
                class="form-input"
                type="password"
                placeholder="请输入密码（至少6位）"
                v-model="registerForm.password"
              />
            </view>
            <view class="form-item">
              <text class="form-label">确认密码</text>
              <input
                class="form-input"
                type="password"
                placeholder="请再次输入密码"
                v-model="registerForm.passwordConfirm"
                @confirm="handleRegister"
              />
            </view>
            <button
              class="btn btn-primary"
              type="primary"
              :loading="registerLoading"
              @tap="handleRegister"
            >
              注册
            </button>
          </view>

          <view class="login-footer">
            <text class="footer-text">
              © 2025 资易 让资本市场更加容易
            </text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { login, register } from '@/services/api.js'
import { saveSession, getSessionId } from '@/utils/auth.js'

export default {
  name: 'Login',
  data() {
    return {
      activeTab: 'login',
      loginForm: {
        username: '',
        password: '',
      },
      registerForm: {
        username: '',
        displayName: '',
        password: '',
        passwordConfirm: '',
      },
      loginLoading: false,
      registerLoading: false,
    }
  },
  methods: {
    switchTab(tab) {
      this.activeTab = tab
      // 清空表单
      this.loginForm = { username: '', password: '' }
      this.registerForm = {
        username: '',
        displayName: '',
        password: '',
        passwordConfirm: '',
      }
    },
    async handleLogin() {
      if (!this.loginForm.username || !this.loginForm.password) {
        uni.showToast({
          title: '请输入用户名和密码',
          icon: 'none',
          duration: 2000,
        })
        return
      }

      this.loginLoading = true
      try {
        const res = await login(this.loginForm.username, this.loginForm.password)
        if (res.code === 0 && res.data) {
          // 保存 session
          saveSession(res.data.sessionId, res.data.user)
          
          // 验证 session 是否保存成功
          const savedSessionId = getSessionId()
          if (!savedSessionId) {
            throw new Error('Session 保存失败')
          }

          uni.showToast({
            title: '登录成功',
            icon: 'success',
            duration: 1500,
          })

          // 跳转到项目列表页面（延迟确保 session 已保存）
          setTimeout(() => {
            uni.reLaunch({
              url: '/pages/userprofile/userprofile',
            })
          }, 300)
        } else {
          uni.showToast({
            title: res.message || '登录失败',
            icon: 'none',
            duration: 2000,
          })
        }
      } catch (error) {
        console.error('登录失败:', error)
        uni.showToast({
          title: error.message || '登录失败，请稍后重试',
          icon: 'none',
          duration: 2000,
        })
      } finally {
        this.loginLoading = false
      }
    },
    async handleRegister() {
      if (!this.registerForm.username || !this.registerForm.password) {
        uni.showToast({
          title: '请输入用户名和密码',
          icon: 'none',
          duration: 2000,
        })
        return
      }

      if (this.registerForm.password.length < 6) {
        uni.showToast({
          title: '密码长度不能少于6位',
          icon: 'none',
          duration: 2000,
        })
        return
      }

      if (this.registerForm.password !== this.registerForm.passwordConfirm) {
        uni.showToast({
          title: '两次输入的密码不一致',
          icon: 'none',
          duration: 2000,
        })
        return
      }

      this.registerLoading = true
      try {
        const res = await register(
          this.registerForm.username,
          this.registerForm.password,
          this.registerForm.displayName || this.registerForm.username
        )
        if (res.code === 0 && res.data) {
          // 保存 session
          saveSession(res.data.sessionId, res.data.user)

          uni.showToast({
            title: '注册成功',
            icon: 'success',
            duration: 2000,
          })

          // 跳转到项目列表页面
          setTimeout(() => {
            uni.reLaunch({
              url: '/pages/userprofile/userprofile',
            })
          }, 500)
        } else {
          uni.showToast({
            title: res.message || '注册失败',
            icon: 'none',
            duration: 2000,
          })
        }
      } catch (error) {
        console.error('注册失败:', error)
        uni.showToast({
          title: error.message || '注册失败，请稍后重试',
          icon: 'none',
          duration: 2000,
        })
      } finally {
        this.registerLoading = false
      }
    },
  },
}
</script>

<style lang="scss" scoped>
/* 品牌配色变量（本地定义，确保可访问） */
$brand-color-gold: #C8A45D;
$brand-color-primary: #12344D;
$brand-bg-warm: #F7F5F0;
$brand-border-light: #E0E0E0;
$uni-text-color-secondary: #666666;
$uni-text-color-muted: #888888;

.page-login {
  width: 100%;
  min-height: 100vh;
  background: $brand-bg-warm;
  display: flex;
  flex-direction: column;
  padding: 0;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
}

/* 页面背景斜线与层次感 */
.page-login::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  /* 大面积暖色斜向切面，保持非常轻的对比度 */
  background:
    linear-gradient(
      135deg,
      rgba(252, 249, 243, 0.95) 0%,
      rgba(247, 245, 240, 0.9) 32%,
      transparent 70%
    );
}

.page-login::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  /* 细线性斜纹，模拟参考页面的“斜线感”，不喧宾夺主 */
  background-image:
    repeating-linear-gradient(
      135deg,
      rgba(200, 164, 93, 0.06) 0,
      rgba(200, 164, 93, 0.06) 1px,
      transparent 1px,
      transparent 26px
    );
  opacity: 0.55;
}

/* 顶部导航条 */
.top-navbar {
  width: 100%;
  padding: 16px 40px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  box-sizing: border-box;
  z-index: 10;
}

.nav-left {
  display: flex;
  flex-direction: row;
  align-items: center;
  column-gap: 8px;
}

.nav-logo {
  height: 40px;
  width: auto;
}

.nav-brand {
  font-size: 16px;
  font-weight: 500;
  color: $uni-text-color;
}

.nav-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  column-gap: 24px;
}

.nav-link {
  font-size: 14px;
  color: #333333;
  cursor: pointer;
  transition: all 0.2s ease-out;
  position: relative;
  font-weight: 400;
  letter-spacing: 0.1px;
}

.nav-link:hover {
  color: $brand-color-gold;
}

.nav-link:hover::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -3px;
  width: 100%;
  height: 1.5px;
  background-color: $brand-color-gold;
  border-radius: 1px;
}

.login-layout {
  flex: 1;
  width: 100%;
  max-width: 1520px;
  margin: 0 auto;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  column-gap: 100px;
  padding: 72px 80px 48px;
  box-sizing: border-box;
}

.brand-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  padding-top: 32px;
  box-sizing: border-box;
  position: relative;
}

.brand-content {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  column-gap: 10px;
  flex-shrink: 0;
  z-index: 2;
  width: 100%;
  margin-left: -120px;
}

/* Logo 高度设置：与文本块高度一致
 * 当前计算值：标题行(56px * 1.2) + 间距(20px) + 描述文字(18px * 1.6) ≈ 120px
 * 用户已手动调整为 160px
 * 如需调整，请修改下方 height 值
 */
.brand-logo-left {
  height: 160px;
  width: auto;
  flex-shrink: 0;
  margin-top: -20px;
  align-self: flex-start;
}

.brand-text-block {
  display: flex;
  flex-direction: column;
  row-gap: 20px;
  position: relative;
  flex: 1;
}

.brand-title-row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  column-gap: 12px;
  flex-wrap: wrap;
}

.brand-title {
  font-size: 60px;
  font-weight: 700;
  color: #1A1A1A;
  line-height: 1.15;
  letter-spacing: -0.8px;
}

.brand-separator {
  font-size: 28px;
  color: $uni-text-color-secondary;
  font-weight: 300;
  line-height: 1.2;
  opacity: 0.5;
  margin: 0 4px;
}

.brand-subtitle {
  font-size: 22px;
  color: $uni-text-color-secondary;
  font-weight: 400;
  line-height: 1.3;
  letter-spacing: 0.2px;
}

.brand-description {
  display: flex;
  flex-direction: column;
  row-gap: 0;
  margin-top: 0;
}

.desc-line {
  font-size: 17px;
  color: $uni-text-color-secondary;
  line-height: 1.65;
  font-weight: 400;
  letter-spacing: 0.1px;
}

.brand-decoration {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1;
}

.decoration-layer {
  position: absolute;
  border-radius: 32px;
  opacity: 0.3;
}

.decoration-large {
  width: 500px;
  height: 500px;
  top: -100px;
  left: 200px;
  background: radial-gradient(
    circle at 30% 30%,
    rgba(200, 164, 93, 0.08),
    transparent 60%
  );
  transform: rotate(-8deg);
}

.decoration-small {
  width: 300px;
  height: 300px;
  top: 150px;
  left: 400px;
  background: radial-gradient(
    circle at 50% 50%,
    rgba(200, 164, 93, 0.05),
    transparent 70%
  );
  transform: rotate(12deg);
}

.auth-panel {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  width: auto;
  min-width: 420px;
  max-width: 520px;
  box-sizing: border-box;
  padding-top: 32px;
}

.login-card {
  width: 100%;
  background-color: #ffffff;
  border-radius: 14px;
  padding: 0;
  border-top: 2px solid $brand-color-gold;
  box-shadow: 0 8px 32px rgba(18, 52, 77, 0.08), 0 2px 8px rgba(200, 164, 93, 0.12);
  box-sizing: border-box;
  transition: box-shadow 0.3s ease-out;
}

.login-card:hover {
  box-shadow: 0 12px 40px rgba(18, 52, 77, 0.12), 0 4px 12px rgba(200, 164, 93, 0.15);
}

.login-card-header {
  padding: 36px 36px 28px;
  border-bottom: 1px solid #f3f4f6;
}

.card-logo-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  column-gap: 10px;
  margin-bottom: 24px;
}

.card-logo {
  height: 28px;
  width: auto;
  flex-shrink: 0;
}

.card-title {
  font-size: 21px;
  font-weight: 600;
  color: #1A1A1A;
  line-height: 1.4;
  letter-spacing: -0.2px;
}

.tab-bar {
  display: flex;
  flex-direction: row;
  border-bottom: none;
}

.tab-item {
  flex: 1;
  padding: 14px 0;
  text-align: center;
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease-out;
}

.tab-item-active {
  color: $brand-color-primary;
}

.tab-text {
  font-size: 16px;
  color: $uni-text-color-muted;
  line-height: 1.5;
  transition: color 0.2s ease-out;
}

.tab-item:hover:not(.tab-item-active) .tab-text {
  color: #666666;
  font-weight: 400;
}

.tab-item-active .tab-text {
  color: $brand-color-primary;
  font-weight: 500;
}

.tab-item-active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -1px;
  transform: translateX(-50%);
  width: 44px;
  height: 2.5px;
  border-radius: 999px;
  background-color: $brand-color-gold;
  transition: width 0.2s ease-out;
}

.form-container {
  display: flex;
  flex-direction: column;
  padding: 28px 36px 36px;
  row-gap: 22px;
}

.form-item {
  display: flex;
  flex-direction: column;
  row-gap: 8px;
  position: relative;
}

.form-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 29px;
  width: 0;
  height: 46px;
  background-color: $brand-color-gold;
  border-radius: 8px 0 0 8px;
  transition: width 0.25s ease-out;
  z-index: 1;
  pointer-events: none;
}

.form-item:focus-within::before {
  width: 3px;
}

.form-label {
  font-size: 14px;
  color: #1f2430;
  font-weight: 500;
  line-height: 1.5;
  letter-spacing: 0.1px;
}

.form-input {
  height: 46px;
  padding: 0 18px;
  background-color: #ffffff !important;
  background: #ffffff !important;
  border: 1.5px solid $brand-border-light;
  border-radius: 8px;
  font-size: 15px;
  color: #1f2430;
  box-sizing: border-box;
  width: 100%;
  position: relative;
  z-index: 2;
  transition: all 0.2s ease-out;
}

/* 确保输入框 focus 时左侧金色标记可见 */
.form-item:focus-within .form-input {
  padding-left: 21px;
}

.form-input:hover {
  border-color: #d0d0d0;
}

.form-input:focus {
  border-color: $brand-color-primary;
  border-width: 1.5px;
  box-shadow: 0 0 0 3px rgba(18, 52, 77, 0.08);
  outline: none;
}

/* 深度覆盖可能来自 uni-app 默认样式的淡色背景 */
::v-deep .form-input {
  background-color: #ffffff !important;
  background: #ffffff !important;
}

::v-deep .form-input input {
  background-color: #ffffff !important;
  background: #ffffff !important;
}

/* 直接命中 uni-app H5 下内部 input 元素的类，彻底去掉淡蓝色背景 */
::v-deep .uni-input-input {
  background-color: #ffffff !important;
  background: #ffffff !important;
}

.form-item-error .form-input {
  border-color: $uni-color-error;
}

.form-error-text {
  margin-top: 4px;
  font-size: 12px;
  color: $uni-color-error;
  line-height: 1.5;
}

.form-extra-row {
  margin-top: 8px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.extra-left {
  display: flex;
  flex-direction: row;
  align-items: center;
  column-gap: 8px;
}

.checkbox-visual {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid $brand-border-light;
  background-color: #ffffff;
  flex-shrink: 0;
  position: relative;
  transition: border-color 0.2s ease-out, background-color 0.2s ease-out;
}

.checkbox-visual::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) scale(0);
  width: 10px;
  height: 10px;
  background-color: $brand-color-gold;
  border-radius: 2px;
  transition: transform 0.2s ease-out;
}

/* 选中态（需要通过 JS 控制，这里先预留样式） */
.checkbox-visual.checked {
  border-color: $brand-color-gold;
  background-color: $brand-color-gold;
}

.checkbox-visual.checked::after {
  transform: translate(-50%, -50%) scale(1);
  background-color: #ffffff;
  width: 6px;
  height: 6px;
  clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
}

.extra-text {
  font-size: 14px;
  color: #6b7280;
  line-height: 1.5;
}

.extra-link {
  font-size: 14px;
  color: $brand-color-primary;
  cursor: pointer;
  line-height: 1.5;
  transition: color 0.2s ease-out;
}

.extra-link:hover {
  color: $brand-color-gold;
}

.login-footer {
  padding: 24px 32px 32px;
  border-top: 1px solid #f3f4f6;
}

.footer-text {
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.6;
  text-align: center;
}

.btn {
  height: 44px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 500;
  margin-top: 4px;
  width: 100%;
  border: none;
  cursor: pointer;
  box-sizing: border-box;
}

.btn-primary {
  background-color: $brand-color-primary;
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(18, 52, 77, 0.2), 0 2px 6px rgba(18, 52, 77, 0.1);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 500;
  letter-spacing: 0.3px;
}

.btn-primary:hover:not([disabled]) {
  background: linear-gradient(135deg, #1a4a6b 0%, $brand-color-primary 100%);
  box-shadow: 0 8px 20px rgba(18, 52, 77, 0.25), 0 4px 10px rgba(18, 52, 77, 0.15);
  transform: translateY(-2px);
}

.btn-primary[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary:not([disabled]):active {
  box-shadow: 0 3px 10px rgba(18, 52, 77, 0.2);
  transform: translateY(0);
}

@media screen and (max-width: 1024px) {
  .top-navbar {
    padding: 12px 24px;
  }

  .nav-right {
    column-gap: 16px;
  }

  .nav-link {
    font-size: 13px;
  }

  .login-layout {
    flex-direction: column;
    align-items: center;
    column-gap: 0;
    padding: 40px 24px 24px;
  }

  .brand-panel {
    display: none;
  }

  .auth-panel {
    width: 100%;
    max-width: 500px;
    min-width: 0;
    justify-content: center;
    padding-top: 0;
  }

  .login-card {
    max-width: 100%;
  }
}

@media screen and (min-width: 1920px) {
  .login-layout {
    max-width: 1600px;
    column-gap: 120px;
    padding: 80px 60px 60px;
  }

  .brand-panel {
    padding-top: 60px;
  }

  .brand-title {
    font-size: 64px;
  }

  .brand-subtitle {
    font-size: 28px;
  }
}
</style>

