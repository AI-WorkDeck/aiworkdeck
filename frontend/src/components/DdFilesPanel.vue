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
        :class="{ active: activeRequestId === req.id }"
        @tap="openRequest(req)"
        @mouseenter="hoveredId = req.id"
        @mouseleave="hoveredId = null"
      >
        <view class="req-icon">
          <image
            v-if="hoveredId === req.id || req.id === activeRequestId"
            src="/static/checklist_selected.png"
            class="icon-img"
          />
          <image
            v-else
            src="/static/checklist_unselected.png"
            class="icon-img"
          />
        </view>
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

        <!-- Action Icons (Hover) -->
        <view class="item-actions" v-if="hoveredId === req.id && !editingId">
          <view
              class="action-btn"
              @tap.stop="copyRequest(req)"
              title="复制"
          >
              <image src="/static/copy.png" class="action-img default" />
              <image src="/static/copy_selected.png" class="action-img hover" />
          </view>
          <view
              class="action-btn"
              @tap.stop="startRename(req)"
              title="重命名"
          >
              <image src="/static/rename.png" class="action-img default" />
              <image src="/static/rename_selected.png" class="action-img hover" />
          </view>
          <view
              class="action-btn"
              @tap.stop="confirmDelete(req)"
              title="删除"
          >
              <image src="/static/delete.png" class="action-img default" />
              <image src="/static/delete_selected.png" class="action-img hover" />
          </view>
        </view>
      </view>

      <view v-if="requests.length === 0" class="empty-state">
        <text>暂无尽调清单</text>
      </view>
    </scroll-view>

    <!-- Custom King IDE Delete Confirm Dialog -->
    <view class="custom-dialog-mask" v-if="showDeleteDialog" @tap="showDeleteDialog = false">
      <view class="custom-dialog-content" @tap.stop>
        <view class="dialog-header">
          <text class="dialog-title">提示</text>
        </view>
        <view class="dialog-body">
          <text class="dialog-msg">删除将可能删除清单下所有文件，请再次确认，点击确认后才删除。</text>
        </view>
        <view class="dialog-footer">
          <view class="dialog-btn cancel" @tap="showDeleteDialog = false">取消</view>
          <view class="dialog-btn confirm" @tap="handleDelete">确认</view>
        </view>
      </view>
    </view>

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
      editName: '',
      activeRequestId: null,
      showDeleteDialog: false,
      deletingRequest: null
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
    async openRequest(req) {
      if (this.editingId) return // Don't open if editing
      this.activeRequestId = req.id
      this.$emit('open-request', req)
    },
    async copyRequest(req) {
      try {
        await api.copyDdRequest(req.id)
        uni.showToast({ title: '已复制', icon: 'none' })
        await this.fetchRequests()
      } catch (e) {
        console.error('Failed to copy request', e)
        uni.showToast({ title: '复制失败', icon: 'none' })
      }
    },
    confirmDelete(req) {
      this.deletingRequest = req
      this.showDeleteDialog = true
    },
    async handleDelete() {
      if (!this.deletingRequest) return
      try {
        await api.deleteDdRequest(this.deletingRequest.id)
        uni.showToast({ title: '已删除', icon: 'none' })
        this.showDeleteDialog = false
        this.deletingRequest = null
        await this.fetchRequests()
      } catch (e) {
        console.error('Failed to delete request', e)
        uni.showToast({ title: '删除失败', icon: 'none' })
      }
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
    display: flex;
    flex-direction: column;
    align-items: stretch;
    box-sizing: border-box;
  }

  .request-item {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    background-color: #fff;
    border-radius: 6px;
    margin: 0 4px 8px 4px;
    cursor: pointer;
    border: 1px solid transparent;
    box-sizing: border-box;
    position: relative;
    display: flex; 
    align-items: center;
    width: auto; // Let it stretch naturally
    flex-shrink: 0;

    &:hover {
      background-color: #f5f7f6; 
    }

    &.active {
      border-color: #1A5336;
      background-color: #E6F9F0;
      box-shadow: 0 2px 8px rgba(26, 83, 54, 0.1);
    }

    &.active:hover {
      background-color: #E6F9F0; // Keep active bg even on hover
    }

    .req-icon {
      width: 18px;
      height: 18px;
      margin-right: 10px;
      display: flex;
      align-items: center;
      justify-content: center;

      .icon-img {
        width: 100%;
        height: 100%;
      }
    }

    .req-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      min-width: 0; // Crucial for flex shrinking

      .req-name {
        font-size: 13px;
        color: #333;
        margin-bottom: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
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
    
    .item-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      padding-left: 8px;
      flex-shrink: 0;
      z-index: 2;

      .action-btn {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        position: relative;

        .action-img {
          width: 14px;
          height: 14px;
          position: absolute;
          transition: opacity 0.2s;

          &.hover {
            opacity: 0;
          }
        }

        &:hover {
          .action-img.default {
            opacity: 0;
          }
          .action-img.hover {
            opacity: 1;
          }
        }
      }
    }
  }

  .custom-dialog-mask {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(2px);
  }

  .custom-dialog-content {
    width: 320px; /* Base width */
    height: 198px; /* 320 / 1.618 approx */
    background-color: #ffffff;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    overflow: hidden;
    border: 1px solid #e0e0e0;
  }

  .dialog-header {
    padding: 16px 20px;
    border-bottom: 1px solid #f0f0f0;
    
    .dialog-title {
      font-size: 15px;
      font-weight: 600;
      color: #333;
    }
  }

  .dialog-body {
    flex: 1;
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    
    .dialog-msg {
      font-size: 13px;
      color: #666;
      line-height: 1.6;
      text-align: center;
    }
  }

  .dialog-footer {
    display: flex;
    padding: 12px 20px 20px;
    gap: 12px;
    justify-content: flex-end;

    .dialog-btn {
      padding: 6px 20px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      
      &.cancel {
        background-color: #f5f5f5;
        color: #666;
        &:hover {
          background-color: #eeeeee;
        }
      }
      
      &.confirm {
        background-color: #4a90e2;
        color: #ffffff;
        &:hover {
          background-color: #357abd;
        }
      }
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
