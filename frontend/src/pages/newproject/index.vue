<template>
  <view class="page-new-project new-project-page">
    <view class="page-header">
      <text class="page-title">新建项目</text>
      <text class="page-subtitle">请选择项目类型并录入上市公司 / 标的公司信息，系统将自动补全基础信息。</text>
    </view>

    <view class="page-content new-project-container">
      <!-- 基础信息卡片 -->
      <view class="card project-form-card new-project-card">
        <view class="card-header">
          <text class="card-title">项目基础信息</text>
          <text class="card-subtitle">请选择项目类型并录入相关公司信息。</text>
        </view>
        <view class="card-body">
          <view class="form-grid">
            <view class="form-row">
              <view class="form-label">
                <text>项目类型</text>
                <text class="required-mark">*</text>
              </view>
              <view class="form-field">
                <picker
                  mode="selector"
                  :range="projectTypes"
                  range-key="label"
                  :value="projectTypeIndex"
                  @change="onProjectTypeChange"
                >
                  <view class="selector-display">
                    <text class="selector-text">{{ currentProjectType.label }}</text>
                    <text class="selector-arrow">▼</text>
                  </view>
                </picker>
              </view>
            </view>

            <view
              v-for="field in currentProjectType.formFields"
              :key="field.field"
              class="form-row"
            >
              <view class="form-label">
                <text>{{ field.label }}</text>
                <text v-if="field.required" class="required-mark">*</text>
              </view>
              <view class="form-field">
                <input
                  class="input"
                  type="text"
                  :placeholder="field.placeholder"
                  :value="formModel[field.field]"
                  @input="onInput(field.field, $event)"
                />
              </view>
            </view>
          </view>
        </view>
        
        <view class="card-footer form-actions">
          <button class="btn btn-create" :loading="creating" :disabled="!canCreate" @tap="onCreateProject">
            {{ creating ? '创建中...' : '创建项目' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { PROJECT_TYPES } from '@/config/projectTypes.js'
import { COMPANY_ROLES } from '@/config/projectTypes.js'
import { fetchCompanyBasicInfo, createProject } from '@/services/api.js'

export default {
  data() {
    return {
      projectTypes: PROJECT_TYPES,
      projectTypeIndex: 0,
      formModel: {
        projectType: PROJECT_TYPES[0]?.value || '',
        listedCompanyName: '',
        targetCompanyName: '',
      },
      creating: false
    }
  },
  computed: {
    currentProjectType() {
      return this.projectTypes[this.projectTypeIndex] || this.projectTypes[0]
    },
    canCreate() {
      // 动态检查必填字段
      const requiredFields = this.currentProjectType.formFields.filter(f => f.required)
      return requiredFields.every(f => !!this.formModel[f.field])
    },
  },
  methods: {
    onProjectTypeChange(e) {
      const index = Number(e.detail.value || 0)
      this.projectTypeIndex = index
      const type = this.projectTypes[index]
      this.formModel.projectType = type ? type.value : ''
      // 清空字段值
      this.formModel.listedCompanyName = ''
      this.formModel.targetCompanyName = ''
    },
    onInput(field, event) {
      const value = event.detail && event.detail.value
      this.formModel[field] = value
    },
    async onCreateProject() {
      if (!this.canCreate) {
        uni.showToast({
          title: '请先补全必填信息',
          icon: 'none',
        })
        return
      }

      this.creating = true
      let listedInfo = null
      let targetInfo = null

      try {
        // 1. 尝试拉取上市公司信息（如果有）
        if (this.formModel.listedCompanyName) {
          try {
            listedInfo = await fetchCompanyBasicInfo({
              projectType: this.formModel.projectType,
              role: COMPANY_ROLES.LISTED,
              name: this.formModel.listedCompanyName
            })
          } catch (e) {
            console.warn('拉取上市公司信息失败，将使用空信息创建', e)
          }
        }

        // 2. 尝试拉取标的公司信息（如果有）
        if (this.formModel.targetCompanyName) {
          try {
            targetInfo = await fetchCompanyBasicInfo({
              projectType: this.formModel.projectType,
              role: COMPANY_ROLES.TARGET,
              name: this.formModel.targetCompanyName
            })
          } catch (e) {
            console.warn('拉取标的公司信息失败，将使用空信息创建', e)
          }
        }

        // 3. 创建项目
        const payload = {
          projectType: this.formModel.projectType,
          listedCompanyName: this.formModel.listedCompanyName,
          targetCompanyName: this.formModel.targetCompanyName,
          listedCompanyInfo: listedInfo,
          targetCompanyInfo: targetInfo,
        }
        const res = await createProject(payload)
        
        uni.showToast({
          title: '项目创建成功',
          icon: 'success',
        })

        // 4. 跳转到项目概览页
        const projectId = res && res.id
        const query = {
          id: projectId,
          name: res && res.name ? res.name : `${this.formModel.listedCompanyName} 项目`,
        }
        const queryStr = Object.keys(query)
          .filter((k) => query[k])
          .map((k) => `${k}=${encodeURIComponent(query[k])}`)
          .join('&')
        
        setTimeout(() => {
           uni.navigateTo({
             url: `/pages/project-overview/project-overview?${queryStr}`,
           })
        }, 500)

      } catch (err) {
        uni.showToast({
          title: (err && err.message) || '创建项目失败，请稍后重试',
          icon: 'none',
        })
      } finally {
        this.creating = false
      }
    },
  },
}
</script>

<style lang="scss">
/* 全局变量映射 */
$bg-page: #F7F5F0;
$bg-card: #FFFFFF;
$bg-input: #FFFFFF; /* 调整为白色背景，与输入框一致 */
$brand-gold: #C8A45D;
$brand-dark: #12344D;
$text-main: #1A1A1A;
$text-sub: #666666;
$text-placeholder: #999999;
$border-light: #E0E0E0;
$success: #059669;
$danger: #DC2626;

.page-new-project {
  min-height: 100vh;
  background-color: $bg-page;
  padding: 40px 24px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.page-header {
  text-align: center;
  margin-bottom: 40px;
  max-width: 800px;
}

.page-title {
  display: block;
  font-size: 28px;
  font-weight: 700;
  color: $text-main;
  margin-bottom: 12px;
  letter-spacing: -0.5px;
}

.page-subtitle {
  font-size: 15px;
  color: $text-sub;
  line-height: 1.6;
}

.page-content {
  width: 100%;
  max-width: 840px;
}

.card {
  background-color: $bg-card;
  border-radius: 16px;
  padding: 32px 40px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
  margin-bottom: 24px;
  border: 1px solid rgba(0,0,0,0.02);
}

.card-header {
  margin-bottom: 32px;
  border-bottom: 1px solid $bg-page;
  padding-bottom: 20px;
}

.card-title {
  display: block;
  font-size: 18px;
  font-weight: 600;
  color: $brand-dark;
  margin-bottom: 8px;
}

.card-subtitle {
  font-size: 13px;
  color: $text-sub;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.form-row {
  display: flex;
  flex-direction: column;
}

.form-label {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 500;
  color: $text-main;
}

.required-mark {
  color: $danger;
  margin-left: 4px;
  font-size: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
}

/* 统一输入框与下拉框样式 */
.selector-display, .input {
  height: 48px; /* 增加高度 */
  background-color: $bg-input !important; 
  border: 1px solid $border-light;
  border-radius: 8px;
  padding: 0 16px;
  font-size: 15px; /* 字体稍大 */
  color: $text-main;
  transition: all 0.2s;
  box-sizing: border-box;
}

.selector-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.input {
  width: 100%;
}

.selector-display:hover, .input:hover {
  border-color: #bbb;
}

.selector-display:active, .input:focus {
  background-color: #fff !important;
  border-color: $brand-gold;
  box-shadow: 0 0 0 3px rgba(200, 164, 93, 0.1);
  outline: none;
}

.selector-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selector-arrow {
  font-size: 10px;
  color: $text-sub;
  margin-left: 8px;
}

/* 按钮样式 */
.btn-create {
  width: 100%;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: $brand-gold; /* 金色主操作按钮 */
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  border-radius: 8px;
  border: none;
  box-shadow: 0 4px 16px rgba(200, 164, 93, 0.25);
  transition: all 0.2s;
  cursor: pointer;
}

.btn-create:hover {
  background-color: #d4ae66;
  box-shadow: 0 6px 20px rgba(200, 164, 93, 0.35);
  transform: translateY(-1px);
}

.btn-create:active {
  transform: translateY(1px);
  box-shadow: 0 2px 8px rgba(200, 164, 93, 0.2);
}

.btn-create[disabled] {
  background-color: #E0E0E0;
  color: #999;
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}

.form-actions {
  display: flex;
  justify-content: center; /* 按钮居中 */
  margin-top: 32px;
  padding-top: 0;
  border-top: none;
}

/* 响应式调整 */
@media screen and (max-width: 600px) {
  .page-new-project {
    padding: 24px 16px;
  }
  
  .card {
    padding: 24px 16px;
  }
}
</style>
