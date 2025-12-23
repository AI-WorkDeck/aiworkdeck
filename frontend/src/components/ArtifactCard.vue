<template>
  <div class="artifact-card" :class="[type, status]">
    <!-- Row 1: Title & Actions -->
    <div class="card-row-top">
      <div class="card-title-group">
        <span class="card-icon-box"></span>
        <span class="card-title">{{ typeLabel }}</span>
        <span v-if="status === 'resolved'" class="status-badge resolved">已批准</span>
      </div>
      
      <div class="card-actions">
        <!-- Approve Button -->
        <template v-if="status === 'draft' && type === 'implementation_plan'">
          <div class="btn-approve" @click.stop="handleApprove">
            <span>批准执行</span>
          </div>
        </template>
        <!-- View Button -->
        <template v-else>
          <div class="btn-view" @click.stop="handleOpenTab">
            <span>查看内容</span>
          </div>
        </template>
      </div>
    </div>

    <!-- Row 2: File Name (Clickable) -->
    <div class="card-row-bottom" @click="handleOpenTab">
      <div class="file-info-block">
        <span class="file-label">FILE</span>
        <span class="file-name-text">{{ fileName }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ArtifactCard',
  props: {
    id: {
      type: String,
      required: true
    },
    type: {
      type: String, // 'task_list' | 'plan' | 'implementation_plan'
      default: 'task_list'
    },
    status: {
      type: String, // 'draft' | 'resolved'
      default: 'draft'
    },
    data: {
      type: Object,
      default: () => ({})
    },
    meta: {
      type: Object,
      default: () => ({})
    },
    fileName: {
      type: String,
      default: ''
    },
    filePath: {
      type: String,
      default: ''
    }
  },
  emits: ['open-tab', 'approve'],
  computed: {
    typeLabel() {
      const labels = {
        'task_list': '任务清单', // Removed 📋
        'plan': '执行方案',     // Removed 📝
        'implementation_plan': '实施计划', // Removed 📝
        'walkthrough': '详细说明' // Removed 📘
      }
      return labels[this.type] || this.type
    },
    statusMessage() {
      if (this.status === 'resolved') {
        return '已批准执行'
      }
      const typeNames = {
        'task_list': '任务清单',
        'plan': '工作计划',
        'implementation_plan': '实施计划',
        'walkthrough': '详细内容'
      }
      const typeName = typeNames[this.type] || '工作计划'
      return `已生成${typeName}，点击查看详情`
    }
  },
  methods: {
    handleOpenTab() {
      console.log('[ArtifactCard] 📄 Opening artifact in tab:', this.id)
      this.$emit('open-tab', {
        id: this.id,
        type: this.type,
        fileName: this.fileName,
        filePath: this.filePath,
        content: this.data?.content || ''
      })
    },
    handleApprove() {
      console.log('[ArtifactCard] ✓ Approving artifact:', this.id)
      this.$emit('approve', {
        id: this.id,
        type: this.type,
        fileName: this.fileName,
        filePath: this.filePath
      })
    }
  }
}
</script>

<style scoped>
.artifact-card {
  background: #fafbfc;
  padding: 10px 14px;
  transition: background 0.15s;
}

.artifact-card:hover {
  background: #f3f4f6;
}

/* Row 1 */
.card-row-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.card-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Styled box icon */
.card-icon-box {
  width: 6px;
  height: 6px;
  background: #d97706;
  border-radius: 1px;
  flex-shrink: 0;
}
.implementation_plan .card-icon-box { background: #ea580c; }
.task_list .card-icon-box { background: #3b82f6; }
.walkthrough .card-icon-box { background: #6b7280; }

.card-title {
  font-size: 12px;
  font-weight: 600;
  color: #1f2937;
}

.status-badge.resolved {
  font-size: 9px;
  background: #dcfce7;
  color: #16a34a;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
}

.card-actions {
  display: flex;
  gap: 6px;
}

.btn-approve {
  background: #1f2937;
  color: #fff;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.15s;
}
.btn-approve:hover { background: #111827; }

.btn-view {
  background: transparent;
  color: #6b7280;
  font-size: 11px;
  padding: 3px 6px;
  cursor: pointer;
  text-decoration: underline;
}
.btn-view:hover { color: #1f2937; }

/* Row 2 */
.card-row-bottom {
  cursor: pointer;
}

.file-info-block {
  background: #f3f4f6;
  border-radius: 3px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-label {
  font-size: 9px;
  font-weight: 600;
  color: #9ca3af;
  letter-spacing: 0.5px;
}

.file-name-text {
  font-size: 12px;
  color: #374151;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
