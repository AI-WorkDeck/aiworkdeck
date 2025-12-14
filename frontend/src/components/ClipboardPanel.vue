<template>
  <view class="clip-panel">
    <scroll-view class="clip-body" scroll-x :scroll-y="false" show-scrollbar="false">
      <view v-if="loading" class="loading">加载中...</view>
      <view v-else-if="items.length === 0" class="empty">暂无记录</view>
      <view v-else class="list">
        <view v-for="it in items" :key="it.id" class="item">
          <view class="item-head">
            <view class="head-left">
              <view class="type-badge" :class="'tone-' + getTypeMeta(it.type).tone">
                <text class="type-badge-text">{{ formatTypeLabel(it.type) }}</text>
              </view>
            </view>
            <view class="head-right">
              <text class="time">{{ formatTime(it.createdAt) }}</text>
              <view class="item-actions">
                <view v-if="it.type === 'TEXT'" class="mini-btn" @tap.stop="copy(it.text)">复制</view>
                <view v-if="it.type === 'TEXT'" class="mini-btn ghost" @tap.stop="$emit('insert', it.text)">插入</view>
                <view class="mini-btn danger" @tap.stop="remove(it.id)">删除</view>
              </view>
            </view>
          </view>
          <view class="item-content">
            <text class="content-text">{{ preview(it) }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { listClipboard, deleteClipboardItem } from '@/services/api.js'
import { getClipboardTypeMeta } from '@/config/clipboard.js'

export default {
  name: 'ClipboardPanel',
  props: {
    query: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      loading: false,
      items: [],
    }
  },
  mounted() {
    this.refresh()
  },
  watch: {
    query() {
      this.refresh()
    }
  },
  methods: {
    prependItem(item, limit = 80) {
      if (!item) return
      const next = Array.isArray(this.items) ? [...this.items] : []
      next.unshift(item)
      // 简单兜底：避免列表无限增长（不是业务去重）
      this.items = next.slice(0, Math.max(1, Math.min(200, limit)))
    },
    getTypeMeta(type) {
      return getClipboardTypeMeta(type)
    },
    formatTypeLabel(type) {
      const label = (getClipboardTypeMeta(type)?.label || String(type || ''))
      // 贴近 Paste：两字中文竖排/两行展示（如“文本”“图片”）
      if (label.length === 2) return `${label[0]}\n${label[1]}`
      return label
    },
    async refresh() {
      this.loading = true
      try {
        const list = await listClipboard(this.query, 80)
        this.items = Array.isArray(list) ? list : (list?.data || [])
      } catch (e) {
        console.error('加载剪贴板失败:', e)
        uni.showToast({ title: '加载剪贴板失败', icon: 'none' })
      } finally {
        this.loading = false
      }
    },
    preview(it) {
      if (it.type === 'TEXT') {
        const t = (it.text || '').trim()
        return t.length > 400 ? (t.slice(0, 400) + '...') : t
      }
      return it.meta || ''
    },
    formatTime(v) {
      if (!v) return ''
      try {
        return new Date(v).toLocaleString()
      } catch (e) {
        return String(v)
      }
    },
    async copy(text) {
      const t = (text || '').trim()
      if (!t) return
      // #ifdef H5
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(t)
        } else {
          uni.setClipboardData({ data: t })
        }
        uni.showToast({ title: '已复制', icon: 'success' })
      } catch (e) {
        uni.setClipboardData({ data: t })
      }
      // #endif
      // #ifndef H5
      uni.setClipboardData({ data: t })
      // #endif
    },
    async remove(id) {
      // Desktop：用应用内确认弹窗（不遮挡、不丑、也不需要隐藏网页）
      try {
        const isDesktop = typeof window !== 'undefined' && window.checkbaDesktop && window.checkbaDesktop.app && window.checkbaDesktop.app.confirm
        if (isDesktop) {
          const resp = await window.checkbaDesktop.app.confirm({
            title: '确认删除',
            content: '确定删除该记录？',
            okText: '删除',
            cancelText: '取消'
          })
          if (!resp || resp.confirmed !== true) return
        } else {
          const ok = await new Promise((resolve) => {
            uni.showModal({
              title: '确认删除',
              content: '确定删除该记录？',
              success: (res) => resolve(!!res.confirm),
              fail: () => resolve(false)
            })
          })
          if (!ok) return
        }
      } catch (e) {
        // ignore confirm errors
        return
      }
      try {
        await deleteClipboardItem(id)
        await this.refresh()
      } catch (e) {
        uni.showToast({ title: '删除失败', icon: 'none' })
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.clip-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.clip-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: $uni-bg-color-grey;
}

.list {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 12px;
  padding-bottom: 2px;
}

.item {
  background: $uni-bg-color;
  border: 1px solid rgba($brand-border-light, 0.9);
  border-radius: $brand-card-radius-md;
  padding: 10px 10px 12px;
  box-shadow: 0 1px 0 rgba(18, 52, 77, 0.03);
  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
  flex: 0 0 auto;
  width: 220px;
  height: 220px; /* 正方形卡片 */
  max-width: 220px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 窄屏：缩小卡片，避免“满屏大方块” */
@media (max-width: 900px) {
  .item {
    width: 180px;
    height: 180px;
    max-width: 180px;
  }
  .content-text {
    max-height: 110px;
  }
}

@media (max-width: 768px) {
  .item {
    width: 160px;
    height: 160px;
    max-width: 160px;
  }
  .content-text {
    max-height: 90px;
  }
}

.item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.head-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  min-width: 0;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 100%;
  opacity: 0.92;
  pointer-events: auto;
}

.mini-btn {
  height: 22px;
  line-height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba($uni-border-color, 0.55);
  background: $uni-bg-color;
  font-size: 11px;
  color: $brand-color-primary;
}

.mini-btn.ghost {
  color: $brand-color-primary;
  background: rgba($brand-color-primary, 0.04);
  border-color: rgba($brand-color-primary, 0.14);
}

.mini-btn.danger {
  border-color: rgba($uni-color-error, 0.35);
  color: $uni-color-error;
  background: rgba($uni-color-error, 0.05);
}

.item-content {
  margin-top: 10px;
  flex: 1;
  min-height: 0;
}

.content-text {
  font-size: 12px;
  color: $uni-text-color;
  white-space: pre-wrap;
  line-height: 1.55;
  display: block;
  overflow: hidden;
  max-height: 140px; /* 正方形卡片下更充足 */
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

.time {
  font-size: 11px;
  color: $uni-text-color-muted;
  white-space: nowrap;
}

.loading, .empty {
  padding: 16px 8px;
  color: $uni-text-color-muted;
  font-size: 12px;
}

/* Hover：更接近 Paste 的“卡片浮起感”（仅桌面端 hover 生效） */
@media (hover: hover) and (pointer: fine) {
  .item:hover {
    border-color: rgba($brand-color-gold, 0.5);
    box-shadow: $brand-card-shadow-soft;
    transform: translateY(-1px);
  }
}
</style>


