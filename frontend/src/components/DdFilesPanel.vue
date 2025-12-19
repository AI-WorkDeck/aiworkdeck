<template>
  <view class="dd-files-panel">
    <view class="panel-header">
      <text class="title">尽调清单</text>
      <view class="add-btn" v-if="canCreateRequest" @tap="createRequest" title="新建清单">
        <text class="add-icon">＋</text>
      </view>
    </view>

    <scroll-view scroll-y class="request-list">
      <view
        v-for="req in requests"
        :key="req.id"
        class="request-item"
        @tap="openRequest(req)"
        @mouseenter="hoveredId = req.id"
        @mouseleave="hoveredId = null"
      >
        <view class="req-icon">📋</view>
        <view class="req-info">
          <!-- Edit Mode -->
          <input 
            v-if="editingId === req.id"
            class="rename-input"
            v-model="editName"
            @blur="saveRename(req)"
            @confirm="saveRename(req)"
            @tap.stop
            :focus="true"
          />
          <!-- View Mode -->
          <template v-else>
             <text class="req-name">{{ req.name }}</text>
             <text class="req-status" :class="req.status.toLowerCase()">{{ getStatusText(req.status) }}</text>
          </template>
        </view>
        
        <!-- Rename Icon (Hover) -->
        <view 
            class="edit-icon" 
            v-if="hoveredId === req.id && !editingId" 
            @tap.stop="startRename(req)"
            title="重命名"
        >
            ✎
        </view>
      </view>
      
      <view v-if="requests.length === 0" class="empty-state">
        <text>暂无尽调清单</text>
      </view>
    </scroll-view>

  </view>
</template>

<script>
import api from '@/services/api'

export default {
  name: 'DdFilesPanel',
  props: {
    projectId: {
      type: Number,
      required: true
    },
    currentUser: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      requests: [],
      hoveredId: null,
      editingId: null,
      editName: ''
    }
  },
  computed: {
    canCreateRequest() {
      if (!this.currentUser) return false
      return this.currentUser.role !== 'CLIENT'
    }
  },
  mounted() {
    this.fetchRequests()
  },
  methods: {
    async fetchRequests() {
      try {
        const res = await api.getDdRequests(this.projectId)
        this.requests = res
      } catch (e) {
        console.error('Failed to fetch DD requests', e)
      }
    },
    async createRequest() {
      try {
        await api.createDdRequest(this.projectId, {
          name: 'newddlist',
          content: ''
        })
        await this.fetchRequests()
      } catch (e) {
        console.error('Failed to create DD request', e)
        uni.showToast({ title: '创建失败', icon: 'none' })
      }
    },
    openRequest(req) {
      if (this.editingId) return // Don't open if editing
      this.$emit('open-request', req)
    },
    startRename(req) {
        this.editingId = req.id
        this.editName = req.name
    },
    async saveRename(req) {
        if (!this.editingId) return
        if (this.editName && this.editName !== req.name) {
            try {
                await api.updateDdRequest(req.id, this.editName)
                req.name = this.editName
                uni.showToast({ title: '已更名', icon: 'none' })
            } catch (e) {
                console.error(e)
                uni.showToast({ title: '更名失败', icon: 'none' })
            }
        }
        this.editingId = null
    },
    getStatusText(status) {
      const map = {
        'DRAFT': '草稿',
        'PUBLISHED': '进行中',
        'COMPLETED': '已完成'
      }
      return map[status] || status
    }
  }
}
</script>

<style lang="scss" scoped>
.dd-files-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #f8f9fa;

  .panel-header {
    height: 36px;
    padding: 0 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #e0e0e0;
    background-color: #fff;
    box-sizing: border-box;

    .title {
      font-size: 11px;
      font-weight: 600;
      color: #999;
      transform: scale(0.95);
      transform-origin: left center;
    }

    .add-btn {
      width: 22px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #666;
      border-radius: 4px;
      border: 1px solid transparent;
      transition: all 0.2s;
      
      &:hover {
        background-color: rgba(0,0,0,0.05);
        border-color: transparent;
        color: #333;
      }
      
      .add-icon {
          font-size: 14px;
          line-height: 1;
      }
    }
  }

  .request-list {
    flex: 1;
    padding: 8px;
  }

  .request-item {
    display: flex;
    align-items: center;
    padding: 10px;
    background-color: #fff;
    border-radius: 6px;
    margin-bottom: 8px;
    cursor: pointer;
    border: 1px solid transparent;
    position: relative;

    &:hover {
      border-color: #4a90e2;
      background-color: #f0f7ff;
    }

    .req-icon {
      font-size: 18px;
      margin-right: 10px;
    }

    .req-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;

      .req-name {
        font-size: 13px;
        color: #333;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .req-status {
        font-size: 11px;
        color: #999;
        
        &.published { color: #28a745; }
        &.completed { color: #666; }
      }
      
      .rename-input {
          font-size: 13px;
          border: 1px solid #4a90e2;
          background: #fff;
          border-radius: 4px;
          padding: 2px 4px;
          width: 100%;
      }
    }
    
    .edit-icon {
        padding: 4px;
        color: #999;
        font-size: 12px;
        &:hover { color: #4a90e2; }
    }
  }

  .empty-state {
    padding: 20px;
    text-align: center;
    color: #999;
    font-size: 12px;
  }
}
</style>
