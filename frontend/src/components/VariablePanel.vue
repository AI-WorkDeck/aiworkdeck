<template>
  <div class="variable-panel">
    <div class="variable-layout">
      <div class="variable-main">
        <div class="panel-topbar">
          <div class="top-actions">
            <button class="top-btn" @click="openCreateModal" title="将选中文字设为变量">＋ 设为变量</button>
            <button class="top-btn ghost" @click="syncDocument" title="同步当前文档">↻ 同步</button>
          </div>
        </div>

        <div class="variable-list">
          <div v-if="loading" class="loading">加载中...</div>
          <div v-else-if="displayItems.length === 0" class="empty">暂无变量</div>
          <div v-else-if="!filteredItems.length" class="empty">未找到匹配的变量</div>

          <div v-else class="list-scroll">
            <div class="list">
              <div v-for="it in filteredItems" :key="it.key" class="card">
                <div class="card-head">
                  <div class="head-left">
                    <div class="type-badge" :class="'tone-' + it.tone" :title="it.meta">
                      <span class="type-badge-text">{{ it.badgeText }}</span>
                    </div>
                    <div class="title-wrap">
                      <div class="card-title" :title="it.name">{{ it.name }}</div>
                      <div class="card-sub">{{ formatUpdateTime(it.updatedAt) }}</div>
                    </div>
                  </div>
                  <div class="card-actions">
                    <button class="mini-btn" @click="insertVariable(it)">插入</button>
                    <button class="mini-btn ghost" @click="updateValueFromSelection(it)">更新</button>
                    <button v-if="it.canDelete" class="mini-btn danger" @click="removeVariable(it)">删</button>
                  </div>
                </div>
                <div class="card-body">
                  <div class="card-value" :title="it.value">{{ it.value || '（空）' }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 变量类型：右侧纵向排列（IDE 终端风格） -->
      <div class="scope-rail">
        <div class="scope-item" :class="{ active: activeScope === 'doc' }" @click="switchScope('doc')">文本变量</div>
        <div class="scope-item" :class="{ active: activeScope === 'project' }" @click="switchScope('project')">项目变量</div>
        <div class="scope-item" :class="{ active: activeScope === 'user' }" @click="switchScope('user')">用户变量</div>
      </div>
    </div>

    <div v-if="showCreateModal" class="modal-mask" @click="closeCreateModal">
      <div class="modal" @click.stop>
        <div class="modal-title">将选中文字设为变量</div>
        <div class="modal-subtitle">变量名建议简短且可复用（同名会覆盖）</div>
        <input class="modal-input" v-model="createForm.name" placeholder="请输入变量名，例如：主营业务" />
        <div class="modal-actions">
          <button class="modal-btn" @click="closeCreateModal">取消</button>
          <button class="modal-btn primary" :disabled="!createForm.name.trim()" @click="confirmCreate">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {
  getProjectVariables,
  saveProjectVariable,
  deleteProjectVariable,
  getUserVariables,
  saveUserVariable,
  deleteUserVariable
} from '@/services/api.js'

export default {
  props: {
    projectId: {
      type: [String, Number],
      required: true
    },
    getWps: {
      type: Function,
      default: null
    },
    // 由父面板统一提供搜索关键字
    searchKeyword: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      activeScope: 'doc',
      loading: false,
      projectVars: [],
      userVars: [],
      docFields: [],
      showCreateModal: false,
      createForm: { name: '' }
    }
  },
  computed: {
    displayItems() {
      if (this.activeScope === 'doc') {
        const groups = new Map()
        for (const f of (this.docFields || [])) {
          const key = `${f.scope}:${f.varName}`
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(f)
        }
        const items = []
        groups.forEach((list, key) => {
          const first = list[0] || {}
          const scope = first.scope || 'D'
          const varName = first.varName || key
          const count = list.length
          const value = this._resolveValue(scope, varName, first.text || '')
          items.push(this._toCardItem({
            key,
            scope,
            name: varName,
            value,
            occurrences: count,
            fieldIds: list.map(x => x.id).filter(Boolean)
          }))
        })
        return items.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
      }

      if (this.activeScope === 'project') {
        return (this.projectVars || []).map(v => this._toCardItem({
          key: `P:${v.id || v.name}`,
          scope: 'P',
          name: v.name,
          value: v.resolvedValue || v.value || '',
          updatedAt: v.updatedAt || v.createdAt,
          backendId: v.id,
          canDelete: true
        }))
      }

      return (this.userVars || []).map(v => this._toCardItem({
        key: `U:${v.id || v.name}`,
        scope: 'U',
        name: v.name,
        value: v.resolvedValue || v.value || '',
        updatedAt: v.updatedAt || v.createdAt,
        backendId: v.id,
        canDelete: true
      }))
    },
    filteredItems() {
      const keyword = (this.searchKeyword || '').trim().toLowerCase()
      if (!keyword) return this.displayItems
      return this.displayItems.filter(item => {
        const textTargets = [
          item.name,
          item.value,
          item.meta
        ]
        return textTargets.some(val => typeof val === 'string' && val.toLowerCase().includes(keyword))
      })
    }
  },
  mounted() {
    this.refresh()
  },
  methods: {
    switchScope(scope) {
      this.activeScope = scope
      this.refresh()
    },

    async refresh() {
      this.loading = true
      try {
        await Promise.all([this.fetchDocFields(), this.fetchProjectVars(), this.fetchUserVars()])
      } catch (e) {
        console.error('刷新变量失败', e)
      } finally {
        this.loading = false
      }
    },

    async fetchProjectVars() {
      if (!this.projectId) {
        this.projectVars = []
        return
      }
      try {
        const res = await getProjectVariables(this.projectId)
        this.projectVars = Array.isArray(res) ? res : (res.data || [])
      } catch (e) {
        this.projectVars = []
      }
    },

    async fetchUserVars() {
      try {
        const res = await getUserVariables()
        this.userVars = Array.isArray(res) ? res : (res.data || [])
      } catch (e) {
        this.userVars = []
      }
    },

    async fetchDocFields() {
      const wps = this.getWps ? this.getWps() : null
      if (!wps || typeof wps.listVariableFields !== 'function') {
        this.docFields = []
        return
      }
      try {
        this.docFields = await wps.listVariableFields()
      } catch (e) {
        this.docFields = []
      }
    },

    _resolveValue(scope, varName, currentText) {
      if (scope === 'P') {
        const v = (this.projectVars || []).find(x => x.name === varName)
        return (v && (v.resolvedValue || v.value)) || ''
      }
      if (scope === 'U') {
        const v = (this.userVars || []).find(x => x.name === varName)
        return (v && (v.resolvedValue || v.value)) || ''
      }
      return currentText || ''
    },

    _toCardItem(raw) {
      const scope = raw.scope || 'D'
      const badgeMap = {
        D: { text: '文\n本', tone: 'neutral', label: '文本' },
        P: { text: '项\n目', tone: 'info', label: '项目' },
        U: { text: '用\n户', tone: 'info', label: '用户' }
      }
      const badge = badgeMap[scope] || badgeMap.D
      const occurrences = raw.occurrences || 0
      const meta = occurrences ? `${badge.label} · ${occurrences}处` : badge.label
      return {
        key: raw.key,
        scope,
        tone: badge.tone,
        badgeText: badge.text,
        name: raw.name || '',
        value: raw.value || '',
        meta,
        updatedAt: raw.updatedAt || null,
        occurrences,
        fieldIds: raw.fieldIds || [],
        backendId: raw.backendId,
        canDelete: !!raw.canDelete
      }
    },

    formatUpdateTime(v) {
      if (!v) return '—'
      try {
        const d = new Date(v)
        if (Number.isNaN(d.getTime())) return '—'
        return d.toLocaleString()
      } catch (e) {
        return '—'
      }
    },

    openCreateModal() {
      this.createForm.name = ''
      this.showCreateModal = true
    },

    closeCreateModal() {
      this.showCreateModal = false
    },

    async confirmCreate() {
      const wps = this.getWps ? this.getWps() : null
      if (!wps || typeof wps.getSelectionText !== 'function') {
        uni.showToast({ title: '请先点击激活一个编辑窗口', icon: 'none' })
        return
      }
      const selected = await wps.getSelectionText()
      const text = (selected || '').trim()
      if (!text) {
        uni.showToast({ title: '请先在文档中选择内容', icon: 'none' })
        return
      }
      const name = (this.createForm.name || '').trim()
      if (!name) return

      const scope = this.activeScope === 'project' ? 'P' : (this.activeScope === 'user' ? 'U' : 'D')
      try {
        if (scope === 'P') {
          await saveProjectVariable({ projectId: Number(this.projectId), name, value: text, type: 'TEXT' })
        } else if (scope === 'U') {
          await saveUserVariable({ name, value: text, type: 'TEXT' })
        }

        if (typeof wps.insertTextWithDocumentField !== 'function') {
          throw new Error('当前 WPS 组件未提供“域插入”能力')
        }
        await wps.insertTextWithDocumentField(text, scope, name)

        this.closeCreateModal()
        await this.refresh()
        uni.showToast({ title: '已创建', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: e.message || '创建失败', icon: 'none' })
      }
    },

    async insertVariable(it) {
      const wps = this.getWps ? this.getWps() : null
      if (!wps || typeof wps.insertTextWithDocumentField !== 'function') {
        uni.showToast({ title: '请先点击激活一个编辑窗口', icon: 'none' })
        return
      }
      try {
        const value = this._resolveValue(it.scope, it.name, it.value)
        await wps.insertTextWithDocumentField(value, it.scope, it.name)
        uni.showToast({ title: '插入成功', icon: 'success' })
        await this.fetchDocFields()
      } catch (e) {
        uni.showToast({ title: e.message || '插入失败', icon: 'none' })
      }
    },

    async updateValueFromSelection(it) {
      const wps = this.getWps ? this.getWps() : null
      if (!wps || typeof wps.getSelectionText !== 'function') {
        uni.showToast({ title: '请先点击激活一个编辑窗口', icon: 'none' })
        return
      }
      const selected = await wps.getSelectionText()
      const text = (selected || '').trim()
      if (!text) {
        uni.showToast({ title: '请先选择内容', icon: 'none' })
        return
      }

      uni.showModal({
        title: '确认更新',
        content: `确认将变量 \"${it.name}\" 更新为选中文本？`,
        success: async (res) => {
          if (!res.confirm) return
          try {
            if (it.scope === 'P') {
              await saveProjectVariable({ projectId: Number(this.projectId), name: it.name, value: text, type: 'TEXT' })
              await this._updateAllFieldInstances('P', it.name, text)
              await this.fetchProjectVars()
            } else if (it.scope === 'U') {
              await saveUserVariable({ name: it.name, value: text, type: 'TEXT' })
              await this._updateAllFieldInstances('U', it.name, text)
              await this.fetchUserVars()
            } else {
              await this._updateAllFieldInstances('D', it.name, text)
            }
            await this.fetchDocFields()
            uni.showToast({ title: '更新成功', icon: 'success' })
          } catch (e) {
            uni.showToast({ title: e.message || '更新失败', icon: 'none' })
          }
        }
      })
    },

    async _updateAllFieldInstances(scope, varName, nextText) {
      const wps = this.getWps ? this.getWps() : null
      if (!wps || typeof wps.updateDocumentField !== 'function') return
      const fields = (this.docFields || []).filter(f => f.scope === scope && f.varName === varName)
      for (const f of fields) {
        try {
          await wps.updateDocumentField(f.id, nextText)
        } catch (e) {
          // ignore
        }
      }
    },

    async syncDocument() {
      const wps = this.getWps ? this.getWps() : null
      if (!wps || typeof wps.syncAllDocumentFields !== 'function') {
        uni.showToast({ title: '请先点击激活一个编辑窗口', icon: 'none' })
        return
      }
      uni.showLoading({ title: '同步中...' })
      try {
        await this.fetchProjectVars()
        await this.fetchUserVars()
        const res = await wps.syncAllDocumentFields((scope, varName, currentText) => {
          if (scope === 'P' || scope === 'U') return this._resolveValue(scope, varName, currentText) || ''
          return currentText
        })
        uni.hideLoading()
        await this.fetchDocFields()
        uni.showToast({ title: `同步完成 (${res.updated || 0})`, icon: 'none' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: e.message || '同步失败', icon: 'none' })
      }
    },

    async removeVariable(it) {
      if (!it.canDelete) return
      uni.showModal({
        title: '确认删除',
        content: `确定删除变量 \"${it.name}\"？`,
        success: async (res) => {
          if (!res.confirm) return
          try {
            if (it.scope === 'P') {
              if (it.backendId) await deleteProjectVariable(it.backendId)
              await this.fetchProjectVars()
            } else if (it.scope === 'U') {
              if (it.backendId) await deleteUserVariable(it.backendId)
              await this.fetchUserVars()
            }
            uni.showToast({ title: '已删除', icon: 'success' })
          } catch (e) {
            uni.showToast({ title: e.message || '删除失败', icon: 'none' })
          }
        }
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.variable-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: $uni-bg-color;
}

.variable-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.variable-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.scope-rail {
  width: 96px;
  flex-shrink: 0;
  border-left: 1px solid rgba($brand-border-light, 0.9);
  background: $uni-bg-color;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 8px 6px;
  gap: 6px;
}

.scope-item {
  height: 26px;
  line-height: 26px;
  padding: 0 6px;
  font-size: 12px;
  color: $uni-text-color-secondary;
  cursor: pointer;
  user-select: none;
  border-radius: 0;
  background: transparent;
  border-left: 2px solid transparent;
}

.scope-item:hover {
  color: $uni-text-color;
}

.scope-item.active {
  color: $brand-color-primary;
  font-weight: 700;
  border-left-color: $brand-color-primary;
}

.panel-topbar {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid rgba($brand-border-light, 0.9);
  background: $uni-bg-color;
  flex-shrink: 0;
  gap: 8px;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.top-btn {
  height: 26px;
  line-height: 26px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid rgba($uni-border-color, 0.6);
  background: $uni-bg-color;
  font-size: 12px;
  color: $brand-color-primary;
  cursor: pointer;
}

.top-btn:hover {
  border-color: rgba($brand-color-gold, 0.75);
}

.top-btn.ghost {
  background: rgba($brand-color-primary, 0.04);
  border-color: rgba($brand-color-primary, 0.14);
}

.variable-list {
  flex: 1;
  overflow: hidden;
  padding: 0;
  background: $uni-bg-color-grey;
}

.loading, .empty {
  text-align: center;
  color: $uni-text-color-muted;
  padding: 20px;
  font-size: 13px;
}

.list-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}

.list {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 12px;
  min-height: 0;
}

.card {
  width: 220px;
  height: 220px;
  box-sizing: border-box;
  background: $uni-bg-color;
  border: 1px solid rgba($brand-border-light, 0.9);
  border-radius: $brand-card-radius-md;
  padding: 10px 10px 12px;
  box-shadow: 0 1px 0 rgba(18, 52, 77, 0.03);
  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
  flex: 0 0 auto; /* 关键：横向滚动时不允许被压缩成“竖条” */
  min-width: 220px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden; /* 强兜底：任何内容不允许溢出遮挡其他卡片 */
}

@media (max-width: 900px) {
  .panel-search {
    max-width: 260px;
  }
  .card {
    width: 180px;
    height: 180px;
    min-width: 180px;
  }
  .list {
    gap: 10px;
  }
  .card-value {
    max-height: 110px;
  }
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.head-left {
  display: flex;
  gap: 10px;
  min-width: 0;
  align-items: flex-start;
}

.title-wrap {
  min-width: 0;
  flex: 1;
}

.card-title {
  font-weight: 600;
  font-size: 13px;
  color: $uni-text-color;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-sub {
  margin-top: 4px;
  font-size: 11px;
  color: $uni-text-color-muted;
  white-space: nowrap;
}

.card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.mini-btn {
  height: 20px;
  line-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba($uni-border-color, 0.55);
  background: $uni-bg-color;
  font-size: 11px;
  color: $brand-color-primary;
  cursor: pointer;
}

.mini-btn.ghost {
  background: rgba($brand-color-primary, 0.04);
  border-color: rgba($brand-color-primary, 0.14);
}

.mini-btn.danger {
  border-color: rgba($uni-color-error, 0.35);
  color: $uni-color-error;
  background: rgba($uni-color-error, 0.05);
}

.card-body {
  margin-top: 10px;
  flex: 1;
  min-height: 0;
}

.card-value {
  font-size: 12px;
  color: $uni-text-color;
  white-space: pre-wrap;
  line-height: 1.55;
  overflow: hidden;
  max-height: 148px;
  background: rgba($brand-color-primary, 0.03);
  border: 1px solid rgba($brand-border-light, 0.7);
  padding: 8px 8px;
  border-radius: 10px;
}

.type-badge {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba($brand-border-light, 0.9);
  background: rgba($brand-color-primary, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
}

.type-badge-text {
  font-size: 11px;
  color: $brand-color-primary;
  font-weight: 600;
  white-space: pre-line;
  line-height: 1.05;
  text-align: center;
}

.type-badge.tone-info {
  background: rgba($uni-color-primary, 0.06);
  border-color: rgba($uni-color-primary, 0.16);
}

.type-badge.tone-info .type-badge-text {
  color: $uni-color-primary;
}

@media (hover: hover) and (pointer: fine) {
  .card:hover {
    border-color: rgba($brand-color-gold, 0.5);
    box-shadow: $brand-card-shadow-soft;
    transform: translateY(-1px);
  }
}

.modal-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal {
  width: 320px;
  background: $uni-bg-color;
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.18);
  border: 1px solid rgba($brand-border-light, 0.9);
}

.modal-title {
  font-size: 14px;
  font-weight: 600;
  color: $uni-text-color;
}

.modal-subtitle {
  margin-top: 6px;
  font-size: 12px;
  color: $uni-text-color-muted;
  line-height: 1.5;
}

.modal-input {
  margin-top: 10px;
  width: 100%;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba($uni-border-color, 0.7);
  padding: 0 10px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.modal-actions {
  margin-top: 12px;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.modal-btn {
  height: 30px;
  line-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba($uni-border-color, 0.7);
  background: $uni-bg-color;
  font-size: 12px;
  color: $uni-text-color;
  cursor: pointer;
}

.modal-btn.primary {
  border-color: transparent;
  background: $brand-color-primary;
  color: #fff;
}

.modal-btn:disabled {
  opacity: $uni-opacity-disabled;
  cursor: not-allowed;
}
</style>
