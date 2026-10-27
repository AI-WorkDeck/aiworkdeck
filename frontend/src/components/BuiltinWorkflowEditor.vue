<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
      <view v-if="activeModalWorkflow" class="bw-editor-dialog">
        <view class="awd-dialog-header bw-editor-header">
          <view class="bw-editor-header-text">
            <text class="awd-dialog-title">{{ $t('chat.builtinWorkflowModalTitle', { name: activeModalWorkflow.title }) }}</text>
          </view>
          <text class="awd-dialog-close" @tap="closeBuiltinWorkflowModal">×</text>
        </view>

        <!-- 顶部四大工作流切换栏：从「高级设置」进入后可一站式配置任意内置工作流 -->
        <view class="bw-workflow-tabs">
          <view v-for="wf in builtinQuickWorkflows" :key="wf.id"
                class="bw-workflow-tab"
                :class="{ active: bwModalWorkflowId === wf.id }"
                @tap="switchModalWorkflowTab(wf)">
            <text class="bw-workflow-tab-title">{{ wf.title }}</text>
            <text class="bw-workflow-tab-ver" :class="{ custom: !wf.activeIsSystemDefault }">{{ wf.activeVersionName }}</text>
          </view>
        </view>

        <view class="bw-editor-body">
          <!-- 左侧版本列表 -->
          <view class="bw-editor-sidebar">
            <view class="bw-sidebar-head">
              <text class="bw-sidebar-title">{{ $t('chat.builtinWorkflowVersionListTitle') }}</text>
            </view>
            <view class="bw-sidebar-list">
              <view v-for="ver in activeModalWorkflow.versions" :key="ver.id"
                    class="bw-sidebar-item"
                    :class="{
                      selected: bwModalSelectedVersionId === ver.id,
                      active: activeModalWorkflow.activeVersionId === ver.id
                    }"
                    @tap="selectVersionInModal(ver.id)">
                <view class="bw-sidebar-item-top">
                  <text class="bw-sidebar-item-name">{{ ver.name }}</text>
                  <text v-if="activeModalWorkflow.activeVersionId === ver.id" class="bw-sidebar-active-dot">●</text>
                </view>
                <view class="bw-sidebar-item-meta">
                  <text v-if="ver.systemDefault" class="bw-meta-pill">{{ $t('chat.builtinWorkflowReadOnlyTag') }}</text>
                  <text v-if="activeModalWorkflow.activeVersionId === ver.id" class="bw-meta-pill active">{{ projectId ? $t('chat.builtinWorkflowProjectTag') : $t('chat.builtinWorkflowGlobalTag') }}</text>
                </view>
              </view>
            </view>
            <view class="bw-sidebar-new-btn"
                  :class="{ selected: bwModalSelectedVersionId === '__new__' }"
                  @tap="startNewVersionFromDefault">
              <text>{{ $t('chat.builtinWorkflowNewVersionBtn') }}</text>
            </view>
          </view>

          <!-- 右侧规则编辑面板 -->
          <view class="bw-editor-main">
            <view v-if="isModalViewingSystemDefault" class="bw-readonly-banner">
              <text class="bw-readonly-banner-text">{{ $t('chat.builtinWorkflowReadOnlyTag') }}</text>
              <view class="awd-btn awd-btn-primary bw-fork-btn" @tap="startNewVersionFromDefault">
                {{ $t('chat.builtinWorkflowForkFromDefaultBtn') }}
              </view>
            </view>

            <view class="bw-field-group">
              <text class="bw-field-label">{{ $t('chat.builtinWorkflowFieldVersionName') }}</text>
              <input v-model="bwEditorForm.name"
                     class="bw-input"
                     :disabled="isModalViewingSystemDefault"
                     :placeholder="$t('chat.builtinWorkflowVersionNamePlaceholder')" />
            </view>

            <view class="bw-field-group">
              <text class="bw-field-label">{{ $t('chat.builtinWorkflowFieldQuickPrompt') }}</text>
              <textarea v-model="bwEditorForm.quickPrompt"
                        class="bw-textarea bw-textarea-short"
                        :disabled="isModalViewingSystemDefault"
                        :maxlength="-1"
                        :placeholder="$t('chat.builtinWorkflowQuickPromptPlaceholder')" />
            </view>

            <view class="bw-field-group bw-field-group-grow">
              <view class="bw-field-label-row">
                <text class="bw-field-label">{{ $t('chat.builtinWorkflowFieldPromptTemplate') }}</text>
                <text v-if="!isModalViewingSystemDefault"
                      class="bw-reset-link"
                      @tap="resetEditorToSystemDefault">{{ $t('chat.builtinWorkflowResetToDefault') }}</text>
              </view>
              <textarea v-model="bwEditorForm.promptTemplate"
                        class="bw-textarea bw-textarea-code"
                        :disabled="isModalViewingSystemDefault"
                        :maxlength="-1"
                        :placeholder="$t('chat.builtinWorkflowPromptTemplatePlaceholder')" />
            </view>

            <view class="bw-field-group">
              <text class="bw-field-label">{{ $t('chat.builtinWorkflowFieldOutput') }}</text>
              <textarea v-model="bwEditorForm.output"
                        class="bw-textarea bw-textarea-short"
                        :disabled="isModalViewingSystemDefault"
                        :maxlength="-1"
                        :placeholder="$t('chat.builtinWorkflowOutputPlaceholder')" />
            </view>

            <view v-if="!isModalViewingSystemDefault" class="bw-scope-options">
              <view v-if="projectId" class="bw-checkbox-row" @tap="bwEditorForm.applyToProject = !bwEditorForm.applyToProject">
                <text class="bw-checkbox" :class="{ checked: bwEditorForm.applyToProject }">{{ bwEditorForm.applyToProject ? '✓' : '' }}</text>
                <text class="bw-checkbox-label">{{ $t('chat.builtinWorkflowApplyToProject') }}</text>
              </view>
              <view class="bw-checkbox-row" @tap="bwEditorForm.setAsGlobalDefault = !bwEditorForm.setAsGlobalDefault">
                <text class="bw-checkbox" :class="{ checked: bwEditorForm.setAsGlobalDefault }">{{ bwEditorForm.setAsGlobalDefault ? '✓' : '' }}</text>
                <text class="bw-checkbox-label">{{ $t('chat.builtinWorkflowSetAsGlobal') }}</text>
              </view>
            </view>
          </view>
        </view>

        <view class="awd-dialog-footer bw-editor-footer">
          <view class="bw-footer-left">
            <view v-if="!isModalViewingSystemDefault && bwEditorForm.id && bwEditorForm.id !== 'default'"
                  class="awd-btn bw-btn-danger"
                  @tap="handleDeleteBuiltinWorkflowVersion">
              {{ $t('chat.builtinWorkflowDeleteVersion') }}
            </view>
          </view>
          <view class="bw-footer-right">
            <view class="awd-btn awd-btn-secondary" @tap="closeBuiltinWorkflowModal">{{ $t('chat.cancel') }}</view>
            <view v-if="isModalViewingSystemDefault && activeModalWorkflow.activeVersionId !== 'default'"
                  class="awd-btn awd-btn-primary"
                  @tap="switchBuiltinWorkflowVersion(activeModalWorkflow, 'default'); closeBuiltinWorkflowModal()">
              {{ projectId ? $t('chat.builtinWorkflowApplyToProject') : $t('chat.builtinWorkflowSetAsGlobal') }}
            </view>
            <view v-if="!isModalViewingSystemDefault"
                  class="awd-btn awd-btn-primary"
                  :class="{ disabled: bwEditorSaving }"
                  @tap="submitBuiltinWorkflowVersion">
              {{ $t('chat.builtinWorkflowSaveVersion') }}
            </view>
          </view>
        </view>
      </view>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
import { saveBuiltinWorkflowVersion, selectBuiltinWorkflowVersion, deleteBuiltinWorkflowVersion } from '@/services/api.js'
import { useBuiltinWorkflows, notifyBuiltinWorkflowsChanged } from '@/composables/useBuiltinWorkflows.js'
import { t } from '@/i18n'
const props = defineProps({ projectId: { type: [String, Number], default: '' }, request: { type: Object, required: true } })
const emit = defineEmits(['close'])
const { builtinWorkflowStates, builtinQuickWorkflows, loadBuiltinWorkflowStates } = useBuiltinWorkflows(props)
    const bwModalWorkflowId = ref('')
    const bwModalSelectedVersionId = ref('default')
    const bwEditorSaving = ref(false)
    const bwEditorForm = ref({
      id: '',
      name: '',
      quickPrompt: '',
      promptTemplate: '',
      output: '',
      applyToProject: true,
      setAsGlobalDefault: false
    })

    const activeModalWorkflow = computed(() =>
      builtinQuickWorkflows.value.find(w => w.id === bwModalWorkflowId.value) || null
    )
    const isModalViewingSystemDefault = computed(() => bwModalSelectedVersionId.value === 'default')

    const selectVersionInModal = (versionId) => {
      const wf = activeModalWorkflow.value
      if (!wf) return
      const sysDef = (wf.versions || []).find(v => v.systemDefault || v.id === 'default') || {
        id: 'default',
        name: t('chat.builtinWorkflowSystemDefault'),
        systemDefault: true,
        quickPrompt: wf.prompt || '',
        promptTemplate: '',
        output: ''
      }
      if (versionId === '__new__') {
        bwModalSelectedVersionId.value = '__new__'
        const customCount = (wf.versions || []).filter(v => !v.systemDefault && v.id !== 'default').length
        const baseName = t('chat.builtinWorkflowNewVersionDefaultName')
        bwEditorForm.value = {
          id: '',
          name: customCount > 0 ? `${baseName} ${customCount + 1}` : baseName,
          quickPrompt: sysDef.quickPrompt || wf.prompt || '',
          promptTemplate: sysDef.promptTemplate || '',
          output: sysDef.output || '',
          applyToProject: true,
          setAsGlobalDefault: !props.projectId
        }
        return
      }
      const target = (wf.versions || []).find(v => v.id === versionId) || sysDef
      bwModalSelectedVersionId.value = target.id
      bwEditorForm.value = {
        id: target.id,
        name: target.name || '',
        quickPrompt: target.quickPrompt || wf.prompt || '',
        promptTemplate: target.promptTemplate || '',
        output: target.output || '',
        applyToProject: true,
        setAsGlobalDefault: wf.activeScope === 'global' && wf.activeVersionId === target.id
      }
    }

    const switchBuiltinWorkflowVersion = async (bw, versionId, scopeOverride) => {
      if (!bw || !versionId) return
      try {
        const scope = scopeOverride || (props.projectId ? 'project' : 'global')
        const res = await selectBuiltinWorkflowVersion(bw.id, {
          versionId,
          scope,
          projectId: props.projectId || ''
        })
        const workflows = res?.workflows || res?.data?.workflows
        if (Array.isArray(workflows) && workflows.length) {
          builtinWorkflowStates.value = workflows
        } else {
          await loadBuiltinWorkflowStates()
        }
        notifyBuiltinWorkflowsChanged()
        const updatedWf = builtinQuickWorkflows.value.find(w => w.id === bw.id)
        const verName = updatedWf?.activeVersionName || versionId
        if (typeof uni !== 'undefined' && uni.showToast) {
          uni.showToast({
            title: t('chat.builtinWorkflowSwitchedToast', { workflow: bw.title, version: verName }),
            icon: 'none',
            duration: 2200
          })
        }
      } catch (e) {
        console.error('[ChatInterface] 切换内置工作流版本失败:', e)
      }
    }

    const switchModalWorkflowTab = (wf) => {
      if (!wf) return
      bwModalWorkflowId.value = wf.id
      selectVersionInModal(wf.activeVersionId || 'default')
    }

    const closeBuiltinWorkflowModal = () => {
      emit('close')
    }

    const startNewVersionFromDefault = () => {
      selectVersionInModal('__new__')
    }

    const resetEditorToSystemDefault = () => {
      const wf = activeModalWorkflow.value
      if (!wf) return
      const sysDef = (wf.versions || []).find(v => v.systemDefault || v.id === 'default')
      if (!sysDef) return
      bwEditorForm.value.quickPrompt = sysDef.quickPrompt || wf.prompt || ''
      bwEditorForm.value.promptTemplate = sysDef.promptTemplate || ''
      bwEditorForm.value.output = sysDef.output || ''
    }

    const submitBuiltinWorkflowVersion = async () => {
      const wf = activeModalWorkflow.value
      if (!wf || bwEditorSaving.value) return
      bwEditorSaving.value = true
      try {
        const payload = {
          id: bwModalSelectedVersionId.value === '__new__' ? '' : bwEditorForm.value.id,
          name: (bwEditorForm.value.name || '').trim() || t('chat.builtinWorkflowNewVersionDefaultName'),
          quickPrompt: bwEditorForm.value.quickPrompt || '',
          promptTemplate: bwEditorForm.value.promptTemplate || '',
          output: bwEditorForm.value.output || '',
          applyToProject: !!bwEditorForm.value.applyToProject,
          setAsGlobalDefault: !!bwEditorForm.value.setAsGlobalDefault,
          projectId: props.projectId || ''
        }
        const res = await saveBuiltinWorkflowVersion(wf.id, payload)
        const workflows = res?.workflows || res?.data?.workflows
        if (Array.isArray(workflows) && workflows.length) {
          builtinWorkflowStates.value = workflows
        } else {
          await loadBuiltinWorkflowStates()
        }
        notifyBuiltinWorkflowsChanged()
        if (typeof uni !== 'undefined' && uni.showToast) {
          uni.showToast({
            title: t('chat.builtinWorkflowSavedToast', { workflow: wf.title, version: payload.name }),
            icon: 'none',
            duration: 2200
          })
        }
        emit('close')
      } catch (e) {
        console.error('[ChatInterface] 保存内置工作流版本失败:', e)
        notifyBuiltinWorkflowsChanged()
        if (typeof uni !== 'undefined' && uni.showToast) {
          uni.showToast({ title: t('chat.builtinWorkflowSaveFailed'), icon: 'none' })
        }
      } finally {
        bwEditorSaving.value = false
      }
    }

    const handleDeleteBuiltinWorkflowVersion = async () => {
      const wf = activeModalWorkflow.value
      const verId = bwEditorForm.value.id
      if (!wf || !verId || verId === 'default' || bwEditorSaving.value) return
      const verName = bwEditorForm.value.name || verId
      bwEditorSaving.value = true
      try {
        const res = await deleteBuiltinWorkflowVersion(wf.id, verId, props.projectId || '')
        const workflows = res?.workflows || res?.data?.workflows
        if (Array.isArray(workflows) && workflows.length) {
          builtinWorkflowStates.value = workflows
        } else {
          await loadBuiltinWorkflowStates()
        }
        selectVersionInModal('default')
        notifyBuiltinWorkflowsChanged()
        if (typeof uni !== 'undefined' && uni.showToast) {
          uni.showToast({
            title: t('chat.builtinWorkflowDeletedToast', { version: verName }),
            icon: 'none',
            duration: 2000
          })
        }
      } catch (e) {
        console.error('[ChatInterface] 删除内置工作流版本失败:', e)
      } finally {
        bwEditorSaving.value = false
      }
    }


watch([() => props.request, () => props.projectId], async ([request, projectId]) => {
  await loadBuiltinWorkflowStates()
  if (request !== props.request || projectId !== props.projectId) return
  bwModalWorkflowId.value = request.workflowId
  selectVersionInModal(request.versionId || 'default')
}, { immediate: true })
</script>
<style scoped>
.bw-editor-dialog {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
  background: var(--awd-surface);
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.bw-editor-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--awd-border-subtle);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.bw-editor-header-text {
  display: flex;
  flex-direction: column;
  row-gap: 3px;
}
.bw-editor-subtitle {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-3);
}
.bw-workflow-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 8px 16px;
  background: var(--awd-bg);
  border-bottom: 1px solid var(--awd-border-subtle);
}
.bw-workflow-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  column-gap: 6px;
  padding: 6px 10px;
  border-radius: var(--awd-radius-md);
  border: 1px solid var(--awd-border-subtle);
  background: var(--awd-surface);
  cursor: pointer;
  transition: all 0.15s ease;
}
.bw-workflow-tab:hover {
  border-color: var(--awd-accent);
}
.bw-workflow-tab.active {
  border-color: var(--awd-accent);
  background: var(--awd-accent-soft);
}
.bw-workflow-tab-title {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  color: var(--awd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bw-workflow-tab-ver {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-3);
  background: var(--awd-bg);
  padding: 1px 5px;
  border-radius: var(--awd-radius-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 72px;
}
.bw-workflow-tab-ver.custom {
  color: var(--awd-accent-text);
  font-weight: 600;
}
.bw-editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.bw-editor-sidebar {
  width: 210px;
  flex-shrink: 0;
  border-right: 1px solid var(--awd-border-subtle);
  background: var(--awd-bg);
  display: flex;
  flex-direction: column;
  padding: 10px;
  row-gap: 8px;
}
.bw-sidebar-head {
  padding: 2px 4px;
}
.bw-sidebar-title {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  color: var(--awd-text-3);
  text-transform: uppercase;
}
.bw-sidebar-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  row-gap: 4px;
}
.bw-sidebar-item {
  padding: 8px 10px;
  border-radius: var(--awd-radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  row-gap: 4px;
}
.bw-sidebar-item:hover {
  background: var(--awd-surface);
}
.bw-sidebar-item.selected {
  background: var(--awd-surface);
  border-color: var(--awd-accent);
}
.bw-sidebar-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  column-gap: 4px;
}
.bw-sidebar-item-name {
  font-size: var(--awd-panel-fs);
  font-weight: 600;
  color: var(--awd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bw-sidebar-active-dot {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-accent-text);
}
.bw-sidebar-item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.bw-meta-pill {
  font-size: var(--awd-panel-fs-meta);
  padding: 1px 5px;
  border-radius: var(--awd-radius-sm);
  color: var(--awd-text-3);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border-subtle);
}
.bw-meta-pill.active {
  color: var(--awd-accent-text);
  background: var(--awd-accent-soft);
  border-color: transparent;
}
.bw-sidebar-new-btn {
  padding: 7px 10px;
  border-radius: var(--awd-radius-md);
  border: 1px dashed var(--awd-border);
  text-align: center;
  font-size: var(--awd-panel-fs-meta);
  font-weight: 500;
  color: var(--awd-accent-text);
  cursor: pointer;
}
.bw-sidebar-new-btn:hover,
.bw-sidebar-new-btn.selected {
  border-color: var(--awd-accent);
  background: var(--awd-accent-soft);
}
.bw-editor-main {
  flex: 1;
  min-width: 0;
  padding: 14px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  row-gap: 12px;
}
.bw-readonly-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  column-gap: 12px;
  padding: 10px 12px;
  border-radius: var(--awd-radius-md);
  background: var(--awd-accent-wash);
  border: 1px solid var(--awd-border-subtle);
}
.bw-readonly-banner-text {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
  line-height: 1.45;
  flex: 1;
}
.bw-fork-btn {
  flex-shrink: 0;
  font-size: var(--awd-panel-fs-meta);
  padding: 5px 10px;
}
.bw-field-group {
  display: flex;
  flex-direction: column;
  row-gap: 5px;
}
.bw-field-group-grow {
  flex: 1 0 auto;
  min-height: 170px;
}
.bw-field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bw-field-label {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  color: var(--awd-text-2);
}
.bw-reset-link {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-accent-text);
  cursor: pointer;
}
.bw-reset-link:hover {
  text-decoration: underline;
}
.bw-input {
  height: 32px;
  padding: 0 10px;
  font-size: var(--awd-panel-fs);
  color: var(--awd-text);
  background: var(--awd-bg);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
}
.bw-textarea {
  width: 100%;
  padding: 8px 10px;
  font-size: var(--awd-panel-fs-meta);
  line-height: 1.5;
  color: var(--awd-text);
  background: var(--awd-bg);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  box-sizing: border-box;
}
.bw-textarea-short {
  height: 54px;
}
.bw-textarea-code {
  flex: 1;
  min-height: 150px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.bw-scope-options {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 2px;
}
.bw-checkbox-row {
  display: flex;
  align-items: center;
  column-gap: 6px;
  cursor: pointer;
}
.bw-checkbox {
  width: 15px;
  height: 15px;
  border-radius: var(--awd-radius-sm);
  border: 1px solid var(--awd-border);
  background: var(--awd-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-on-accent);
}
.bw-checkbox.checked {
  background: var(--awd-accent);
  border-color: var(--awd-accent);
}
.bw-checkbox-label {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
}
.bw-editor-footer {
  padding: 12px 18px;
  border-top: 1px solid var(--awd-border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bw-footer-left,
.bw-footer-right {
  display: flex;
  align-items: center;
  column-gap: 8px;
}
.bw-btn-danger {
  color: var(--awd-danger);
  background: transparent;
  border: 1px solid var(--awd-danger);
}


.bw-editor-header, .bw-workflow-tabs, .bw-editor-footer { flex-shrink: 0; }
.bw-workflow-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bw-editor-header-text { min-width: 0; }
.bw-field-group { flex-shrink: 0; }
.bw-readonly-banner { flex-wrap: wrap; gap: 8px; }
.bw-editor-footer, .bw-footer-right { flex-wrap: wrap; gap: 8px; }
@container (max-width: 600px) {
  .bw-editor-body { flex-direction: column; }
  .bw-editor-sidebar { width: auto; max-height: 150px; border-right: 0; border-bottom: 1px solid var(--awd-border-subtle); }
  .bw-sidebar-list { flex-direction: row; flex: auto; overflow: auto; }
  .bw-sidebar-item { flex: 0 0 170px; }
  .bw-editor-main { padding: 12px; }
  .bw-workflow-tabs { padding: 8px 12px; }
}
</style>
