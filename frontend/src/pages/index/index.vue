<template>
  <view class="page-new-project">
    <view class="page-header">
      <text class="page-title">新建项目</text>
      <text class="page-subtitle">请选择项目类型并录入上市公司 / 标的公司信息，系统将通过企查查等外部服务补全基础信息。</text>
    </view>

    <view class="page-content">
      <!-- 基础信息卡片：项目类型与公司名称输入 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">项目基础信息</text>
        </view>
        <view class="card-body">
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
                  <text>{{ currentProjectType.label }}</text>
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
            <view class="form-field form-field-inline">
              <input
                class="input"
                type="text"
                :placeholder="field.placeholder"
                :value="formModel[field.field]"
                @input="onInput(field.field, $event)"
              />
              <button
                class="btn btn-primary"
                type="default"
                :loading="getRoleLoading(field.field)"
                @tap="onSearchCompany(field.field)"
              >
                查询并补全信息
              </button>
            </view>
          </view>
        </view>
      </view>

      <!-- 上市公司信息展示 -->
      <view class="card" v-if="listedDisplayConfig">
        <view class="card-header">
          <text class="card-title">{{ listedDisplayConfig.label }}</text>
        </view>
        <view class="card-body">
          <view v-if="companyInfo.listed">
            <view class="info-grid">
              <view
                v-for="field in listedDisplayConfig.fields"
                :key="field.key"
                class="info-item"
              >
                <text class="info-label">{{ field.label }}</text>
                <text class="info-value">{{ companyInfo.listed[field.key] || '-' }}</text>
              </view>
            </view>

            <view
              v-for="list in listedDisplayConfig.lists"
              :key="list.key"
              class="info-list-block"
            >
              <view class="info-list-header">
                <text class="info-list-title">{{ list.label }}</text>
              </view>
              <scroll-view scroll-x class="info-list-table">
                <view class="table-row table-row-header">
                  <view
                    v-for="col in list.columns"
                    :key="col.key"
                    class="table-cell"
                  >
                    <text class="table-header-text">{{ col.label }}</text>
                  </view>
                </view>
                <view
                  v-for="(item, index) in companyInfo.listed[list.key] || []"
                  :key="index"
                  class="table-row"
                >
                  <view
                    v-for="col in list.columns"
                    :key="col.key"
                    class="table-cell"
                  >
                    <text class="table-cell-text">{{ item[col.key] || '-' }}</text>
                  </view>
                </view>
              </scroll-view>
            </view>
          </view>
          <view v-else class="placeholder-text">
            <text>尚未查询上市公司信息，请先在上方输入公司名称并点击“查询并补全信息”。</text>
          </view>
          <view v-if="errorMessage.listed" class="error-text">
            <text>{{ errorMessage.listed }}</text>
          </view>
        </view>
      </view>

      <!-- 标的公司信息展示 -->
      <view class="card" v-if="targetDisplayConfig">
        <view class="card-header">
          <text class="card-title">{{ targetDisplayConfig.label }}</text>
        </view>
        <view class="card-body">
          <view v-if="companyInfo.target">
            <view class="info-grid">
              <view
                v-for="field in targetDisplayConfig.fields"
                :key="field.key"
                class="info-item"
              >
                <text class="info-label">{{ field.label }}</text>
                <text class="info-value">{{ companyInfo.target[field.key] || '-' }}</text>
              </view>
            </view>

            <view
              v-for="list in targetDisplayConfig.lists"
              :key="list.key"
              class="info-list-block"
            >
              <view class="info-list-header">
                <text class="info-list-title">{{ list.label }}</text>
              </view>
              <scroll-view scroll-x class="info-list-table">
                <view class="table-row table-row-header">
                  <view
                    v-for="col in list.columns"
                    :key="col.key"
                    class="table-cell"
                  >
                    <text class="table-header-text">{{ col.label }}</text>
                  </view>
                </view>
                <view
                  v-for="(item, index) in companyInfo.target[list.key] || []"
                  :key="index"
                  class="table-row"
                >
                  <view
                    v-for="col in list.columns"
                    :key="col.key"
                    class="table-cell"
                  >
                    <text class="table-cell-text">{{ item[col.key] || '-' }}</text>
                  </view>
                </view>
              </scroll-view>
            </view>
          </view>
          <view v-else class="placeholder-text">
            <text>尚未查询标的公司信息，请先在上方输入公司名称并点击“查询并补全信息”。</text>
          </view>
          <view v-if="errorMessage.target" class="error-text">
            <text>{{ errorMessage.target }}</text>
          </view>
        </view>
      </view>

      <!-- 底部操作区：后续可扩展为下一步向导 -->
      <view class="page-footer">
        <button class="btn btn-secondary" type="default" @tap="onReset">
          重置
        </button>
        <button class="btn btn-primary" type="default" :disabled="!canCreate" @tap="onCreateProject">
          创建项目（占位，待接后端）
        </button>
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
      companyInfo: {
        listed: null,
        target: null,
      },
      loading: {
        listed: false,
        target: false,
      },
      errorMessage: {
        listed: '',
        target: '',
      },
    }
  },
  computed: {
    currentProjectType() {
      return this.projectTypes[this.projectTypeIndex] || this.projectTypes[0]
    },
    listedDisplayConfig() {
      return this.currentProjectType.companyDisplay[COMPANY_ROLES.LISTED]
    },
    targetDisplayConfig() {
      return this.currentProjectType.companyDisplay[COMPANY_ROLES.TARGET]
    },
    canCreate() {
      return (
        !!this.formModel.projectType &&
        !!this.formModel.listedCompanyName &&
        !!this.formModel.targetCompanyName
      )
    },
  },
  methods: {
    onProjectTypeChange(e) {
      const index = Number(e.detail.value || 0)
      this.projectTypeIndex = index
      const type = this.projectTypes[index]
      this.formModel.projectType = type ? type.value : ''
      // 切换项目类型后，可以根据需要重置公司信息
      this.companyInfo.listed = null
      this.companyInfo.target = null
      this.errorMessage.listed = ''
      this.errorMessage.target = ''
    },
    onInput(field, event) {
      const value = event.detail && event.detail.value
      this.formModel[field] = value
    },
    getRoleKeyByField(field) {
      if (field === 'listedCompanyName') return 'listed'
      if (field === 'targetCompanyName') return 'target'
      return ''
    },
    getRoleLoading(field) {
      const key = this.getRoleKeyByField(field)
      return key ? this.loading[key] : false
    },
    async onSearchCompany(field) {
      const roleKey = this.getRoleKeyByField(field)
      const role =
        roleKey === 'listed' ? COMPANY_ROLES.LISTED : COMPANY_ROLES.TARGET
      if (!roleKey) return

      const name = (this.formModel[field] || '').trim()
      if (!name) {
        uni.showToast({
          title: '请输入公司名称',
          icon: 'none',
        })
        return
      }

      this.loading[roleKey] = true
      this.errorMessage[roleKey] = ''
      try {
        const payload = {
          projectType: this.formModel.projectType,
          role,
          name,
        }
        const data = await fetchCompanyBasicInfo(payload)
        this.companyInfo[roleKey] = data || {}
      } catch (err) {
        this.errorMessage[roleKey] =
          (err && err.message) || '查询失败，请稍后重试'
        this.companyInfo[roleKey] = null
      } finally {
        this.loading[roleKey] = false
      }
    },
    onReset() {
      this.formModel.listedCompanyName = ''
      this.formModel.targetCompanyName = ''
      this.companyInfo.listed = null
      this.companyInfo.target = null
      this.errorMessage.listed = ''
      this.errorMessage.target = ''
    },
    async onCreateProject() {
      if (!this.canCreate) {
        uni.showToast({
          title: '请先补全必填信息',
          icon: 'none',
        })
        return
      }

      try {
        const payload = {
          projectType: this.formModel.projectType,
          listedCompanyName: this.formModel.listedCompanyName,
          targetCompanyName: this.formModel.targetCompanyName,
          listedCompanyInfo: this.companyInfo.listed,
          targetCompanyInfo: this.companyInfo.target,
        }
        const res = await createProject(payload)
        uni.showToast({
          title: '项目创建成功',
          icon: 'success',
        })
        // 成功后跳转到项目概览页，带上基础信息，后续可根据 id 再拉取详情
        const projectId = res && res.id
        const query = {
          id: projectId,
          name: res && res.name ? res.name : `${this.formModel.listedCompanyName} 项目`,
          projectTypeLabel: this.currentProjectType.label,
          listedCompanyName: this.formModel.listedCompanyName,
          targetCompanyName: this.formModel.targetCompanyName,
        }
        const queryStr = Object.keys(query)
          .filter((k) => query[k])
          .map((k) => `${k}=${encodeURIComponent(query[k])}`)
          .join('&')
        uni.navigateTo({
          url: `/pages/project-overview/project-overview?${queryStr}`,
        })
      } catch (err) {
        uni.showToast({
          title: (err && err.message) || '创建项目失败，请稍后重试',
          icon: 'none',
        })
      }
    },
  },
}
</script>

<style lang="scss">
.page-new-project {
  min-height: 100vh;
  padding: 24rpx;
  background-color: $uni-bg-color-grey;
  box-sizing: border-box;
}

.page-header {
  margin-bottom: 24rpx;
}

.page-title {
  display: block;
  font-size: 40rpx;
  font-weight: 500;
  color: $uni-color-title;
  margin-bottom: 8rpx;
}

.page-subtitle {
  font-size: 26rpx;
  color: $uni-color-paragraph;
}

.page-content {
  max-width: 1200rpx;
  margin: 0 auto;
}

.card {
  background-color: $uni-bg-color;
  border-radius: 16rpx;
  padding: 24rpx 24rpx 28rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.04);
}

.card-header {
  margin-bottom: 16rpx;
}

.card-title {
  font-size: 30rpx;
  font-weight: 500;
  color: $uni-color-title;
}

.card-body {
  font-size: 26rpx;
  color: $uni-color-paragraph;
}

.form-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 16rpx;
}

.form-label {
  width: 200rpx;
  font-size: 26rpx;
  color: $uni-text-color;
  display: flex;
  align-items: center;
}

.required-mark {
  color: $uni-color-error;
  margin-left: 4rpx;
}

.form-field {
  flex: 1;
}

.form-field-inline {
  display: flex;
  flex-direction: row;
  align-items: center;
  column-gap: 16rpx;
}

.selector-display {
  height: 72rpx;
  padding: 0 20rpx;
  border-radius: 12rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: $uni-border-color;
  display: flex;
  align-items: center;
  background-color: $uni-bg-color;
}

.input {
  flex: 1;
  height: 72rpx;
  padding: 0 20rpx;
  border-radius: 12rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: $uni-border-color;
  background-color: $uni-bg-color;
  font-size: 26rpx;
}

.info-grid {
  display: flex;
  flex-wrap: wrap;
  margin: -8rpx;
}

.info-item {
  width: 50%;
  padding: 8rpx;
  box-sizing: border-box;
}

.info-label {
  display: block;
  font-size: 24rpx;
  color: $uni-text-color-grey;
  margin-bottom: 4rpx;
}

.info-value {
  font-size: 26rpx;
  color: $uni-text-color;
}

.info-list-block {
  margin-top: 24rpx;
}

.info-list-header {
  margin-bottom: 8rpx;
}

.info-list-title {
  font-size: 26rpx;
  font-weight: 500;
  color: $uni-color-title;
}

.info-list-table {
  border-radius: 12rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: $uni-border-color;
  overflow: hidden;
}

.table-row {
  display: flex;
  flex-direction: row;
  min-width: 100%;
}

.table-row-header {
  background-color: $uni-bg-color-grey;
}

.table-cell {
  flex: 1;
  padding: 12rpx 16rpx;
  border-right-width: 1rpx;
  border-right-style: solid;
  border-right-color: $uni-border-color;
}

.table-cell:last-child {
  border-right-width: 0;
}

.table-header-text {
  font-size: 24rpx;
  font-weight: 500;
  color: $uni-text-color;
}

.table-cell-text {
  font-size: 24rpx;
  color: $uni-text-color;
}

.placeholder-text {
  font-size: 24rpx;
  color: $uni-text-color-grey;
}

.error-text {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: $uni-color-error;
}

.page-footer {
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  column-gap: 16rpx;
  margin-top: 8rpx;
}

.btn {
  min-width: 200rpx;
  height: 72rpx;
  padding: 0 24rpx;
  border-radius: 36rpx;
  font-size: 26rpx;
  line-height: 72rpx;
}

.btn-primary {
  background-color: $uni-color-primary;
  color: $uni-text-color-inverse;
}

.btn-primary[disabled] {
  opacity: $uni-opacity-disabled;
}

.btn-secondary {
  background-color: $uni-bg-color;
  color: $uni-text-color;
  border-width: 1rpx;
  border-style: solid;
  border-color: $uni-border-color;
}
</style>
