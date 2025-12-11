<template>
  <div class="variable-panel">
    <!-- 顶部 Tab 栏 -->
    <div class="panel-tabs">
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'basic' }"
        @click="activeTab = 'basic'"
      >
        基本信息
      </div>
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'scheme' }"
        @click="activeTab = 'scheme'"
      >
        交易方案
      </div>
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'all' }"
        @click="activeTab = 'all'"
      >
        全部
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="panel-actions">
      <button class="action-btn primary" @click="emitCreateFromSelection">
        + 将选中文字设为变量
      </button>
      <button class="action-btn secondary" @click="$emit('sync-document')" style="margin-top: 8px;">
        ↻ 同步当前文档
      </button>
    </div>

    <!-- 变量列表 -->
    <div class="variable-list">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="displayVariables.length === 0" class="empty">暂无变量</div>
      
      <div v-else v-for="v in displayVariables" :key="v.id" class="variable-item">
        <div class="var-header">
          <span class="var-name">{{ v.name }}</span>
          <span class="var-type">{{ v.type === 'TEMPLATE' ? '复合' : '文本' }}</span>
        </div>
        <div class="var-value" :title="v.resolvedValue">{{ v.resolvedValue }}</div>
        <div class="var-tools">
          <button @click="$emit('insert', v)" title="插入到当前光标">插入</button>
          <button @click="$emit('update-from-selection', v)" title="用当前选中内容更新此变量">更新值</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { getProjectVariables } from '@/services/api.js'

export default {
  props: {
    projectId: {
      type: [String, Number],
      required: true
    }
  },
  data() {
    return {
      variables: [],
      loading: false,
      activeTab: 'all' // basic | scheme | all
    }
  },
  computed: {
    displayVariables() {
      if (this.activeTab === 'all') {
        return this.variables
      }
      
      // 简单模拟分组逻辑：
      // 实际项目中应由后端返回 group 字段
      // 这里根据名称或随机分配演示效果
      return this.variables.filter(v => {
        if (this.activeTab === 'basic') {
          // 假设：名称较短的或包含"公司"、"人"的归为基本信息
          return v.name.length < 5 || v.name.includes('公司') || v.name.includes('人') || v.name.includes('日')
        }
        if (this.activeTab === 'scheme') {
          // 其他归为交易方案
          return !(v.name.length < 5 || v.name.includes('公司') || v.name.includes('人') || v.name.includes('日'))
        }
        return true
      })
    }
  },
  mounted() {
    this.fetchVariables()
  },
  methods: {
    async fetchVariables() {
      this.loading = true
      try {
        const res = await getProjectVariables(this.projectId)
        // 兼容处理：如果返回的是对象且有 data 字段
        this.variables = Array.isArray(res) ? res : (res.data || [])
      } catch (e) {
        console.error('获取变量失败', e)
        this.variables = []
      } finally {
        this.loading = false
      }
    },
    emitCreateFromSelection() {
      this.$emit('create-new')
    },
    async refresh() {
      await this.fetchVariables()
    }
  }
}
</script>

<style scoped>
.variable-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

/* Tabs 样式 */
.panel-tabs {
  display: flex;
  border-bottom: 1px solid #eee;
  background: #f9f9f9;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 12px 0;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-item:hover {
  color: #12344D; /* Brand Dark */
}

.tab-item.active {
  color: #12344D;
  font-weight: 600;
  border-bottom-color: #C8A45D; /* Brand Gold */
  background: #fff;
}

.panel-actions {
  padding: 12px;
  border-bottom: 1px solid #eee;
}

.action-btn {
  width: 100%;
  padding: 8px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn.primary {
  background: #12344D;
  color: white;
  border: none;
}
.action-btn.primary:hover {
  background: #1a4a6b;
}

.action-btn.secondary {
  background: #fff;
  color: #333;
  border: 1px solid #ddd;
}
.action-btn.secondary:hover {
  background: #f5f5f5;
  border-color: #C8A45D;
  color: #C8A45D;
}

.variable-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.loading, .empty {
  text-align: center;
  color: #999;
  padding: 20px;
  font-size: 13px;
}

.variable-item {
  background: #fff;
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 10px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.02);
  transition: all 0.2s;
}

.variable-item:hover {
  border-color: #C8A45D;
  box-shadow: 0 2px 6px rgba(200, 164, 93, 0.1);
}

.var-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.var-name {
  font-weight: 600;
  font-size: 14px;
  color: #333;
}

.var-type {
  font-size: 10px;
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  color: #666;
}

.var-value {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 10px;
  background: #fafafa;
  padding: 6px;
  border-radius: 4px;
}

.var-tools {
  display: flex;
  gap: 8px;
}

.var-tools button {
  flex: 1;
  font-size: 12px;
  padding: 5px 0;
  cursor: pointer;
  border: 1px solid #e0e0e0;
  background: #fff;
  border-radius: 4px;
  color: #555;
  transition: all 0.2s;
}

.var-tools button:hover {
  color: #12344D;
  border-color: #12344D;
  background: #f0f4f8;
}
</style>
