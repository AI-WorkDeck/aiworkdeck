<template>
  <view class="favorites-panel">
    <scroll-view class="favorites-body" scroll-x :scroll-y="false" :show-scrollbar="false" :scroll-into-view="scrollIntoView" scroll-with-animation>
      <view v-if="loading" class="loading">
        <text class="loading-text">加载中...</text>
      </view>
      <view v-else-if="items.length === 0" class="empty">
        <text class="empty-text">暂无收藏</text>
      </view>
      <view v-else class="list">
        <view v-for="fav in items" :key="fav.id" class="card" :id="getCardDomId(fav.id)" :class="{ 'card--highlight': highlightId === fav.id }">
          <view class="card-head">
            <text class="card-title">{{ fav.title || fav.sourceUrl || '未命名摘录' }}</text>
            <view class="card-btns">
              <view v-if="fav.sourceUrl" class="mini-btn" @tap.stop="$emit('open-url', fav.sourceUrl)">打开</view>
              <view class="mini-btn ghost" @tap.stop="$emit('insert', fav.content)">插入</view>
              <view class="mini-btn danger" @tap.stop="remove(fav.id)">删除</view>
            </view>
          </view>
          <view class="card-meta">
            <text class="meta-text">{{ formatMetaLine(fav) }}</text>
          </view>
          <view v-if="fav.imagePath" class="card-image">
            <image class="image-thumb" :src="getFavoriteImageUrl(fav.id)" mode="aspectFill" :lazy-load="true" />
          </view>
          <view class="card-content">
            <text class="content-text">{{ fav.content }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { getProjectFavorites, deleteFavorite, getFavoriteImageUrl } from '@/services/api.js'

export default {
  name: 'ProjectFavoritesPanel',
  props: {
    projectId: {
      type: [Number, String],
      required: true
    },
    query: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      loading: false,
      items: [],
      scrollIntoView: '',
      highlightId: null,
      _lastRefreshAt: 0
    }
  },
  watch: {
    projectId: {
      immediate: true,
      handler() {
        this.refresh()
      }
    },
    query() {
      this.refresh()
    }
  },
  methods: {
    getCardDomId(id) {
      return `fav-${id}`
    },
    focusFavorite(id) {
      if (!id) return
      this.scrollIntoView = this.getCardDomId(id)
      this.highlightId = id
      setTimeout(() => {
        if (this.highlightId === id) this.highlightId = null
      }, 1800)
    },
    getFavoriteImageUrl(id) {
      return getFavoriteImageUrl(id)
    },
    formatTime(v) {
      if (!v) return ''
      try {
        const d = new Date(v)
        if (Number.isNaN(d.getTime())) return String(v)
        return d.toLocaleString()
      } catch (e) {
        return String(v)
      }
    },
    formatMetaLine(fav) {
      const pieces = []
      const t = this.formatTime(fav && fav.createdAt)
      if (t) pieces.push(t)
      // 优先使用后端轻量字段（更快），否则回退解析 meta
      const host2 = fav && fav.sourceHost ? String(fav.sourceHost) : ''
      const doc2 = fav && fav.docFileName ? String(fav.docFileName) : ''
      if (host2) pieces.unshift(host2)
      if (doc2) pieces.push(doc2)
      if (!host2 && !doc2) {
      try {
        const meta = fav && fav.meta ? JSON.parse(String(fav.meta)) : null
        const doc = meta && meta.docFileName ? String(meta.docFileName) : ''
        const host = meta && meta.sourceHost ? String(meta.sourceHost) : ''
        if (host) pieces.unshift(host)
        if (doc) pieces.push(doc)
      } catch (e) {
        // ignore
        }
      }
      if (pieces.length) return pieces.join(' · ')
      return ''
    },
    async refresh() {
      const now = Date.now()
      // 打开收藏夹/插入新收藏时会触发多次 refresh；这里做轻量节流，保证“感觉更快”
      if (this._lastRefreshAt && now - this._lastRefreshAt < 1200) return
      this._lastRefreshAt = now
      this.loading = true
      try {
        const pid = typeof this.projectId === 'string' ? Number(this.projectId) : this.projectId
        const list = await getProjectFavorites(pid, this.query, 80)
        this.items = Array.isArray(list) ? list : (list?.data || [])
      } catch (e) {
        console.error('加载项目收藏失败:', e)
        uni.showToast({ title: '加载收藏失败', icon: 'none' })
      } finally {
        this.loading = false
      }
    },
    async remove(id) {
      try {
        const isDesktop = typeof window !== 'undefined' && window.checkbaDesktop && window.checkbaDesktop.app && window.checkbaDesktop.app.confirm
        if (isDesktop) {
          const resp = await window.checkbaDesktop.app.confirm({
            title: '确认删除',
            content: '确定要删除该收藏吗？',
            okText: '删除',
            cancelText: '取消'
          })
          if (!resp || resp.confirmed !== true) return
        } else {
          const ok = await new Promise((resolve) => {
            uni.showModal({
              title: '确认删除',
              content: '确定要删除该收藏吗？',
              success: (res) => resolve(!!res.confirm),
              fail: () => resolve(false)
            })
          })
          if (!ok) return
        }
      } catch (e) {
        return
      }
      try {
        await deleteFavorite(id)
        await this.refresh()
        uni.showToast({ title: '删除成功', icon: 'success' })
      } catch (e) {
        console.error('删除收藏失败:', e)
        uni.showToast({ title: '删除失败', icon: 'none' })
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.favorites-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.favorites-body {
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

.card {
  background: $uni-bg-color;
  border: 1px solid rgba($brand-border-light, 0.9);
  border-radius: $brand-card-radius-md;
  padding: 10px 10px 12px;
  box-shadow: none;
  flex: 0 0 auto;
  width: 220px;
  height: 220px;
  max-width: 220px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.card--highlight {
  border-color: rgba(37, 99, 235, 0.45);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card-title {
  font-size: 13px;
  font-weight: 700;
  color: #1a1a1a;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mini-btn {
  height: 26px;
  line-height: 26px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: #fff;
  font-size: 12px;
  color: #12344D;
}

.mini-btn.ghost {
  border-color: rgba(148, 163, 184, 0.35);
  color: #12344D;
}

.mini-btn.danger {
  border-color: rgba(220, 38, 38, 0.25);
  color: #dc2626;
}

.card-meta {
  margin-top: 6px;
}

.meta-text {
  font-size: 12px;
  color: #64748b;
}

.card-image {
  margin-top: 8px;
}

.image-thumb {
  width: 100%;
  height: 92px;
  border-radius: 10px;
  background: #f1f5f9;
}

.card-content {
  margin-top: 8px;
  flex: 1;
  min-height: 0;
}

.content-text {
  font-size: 12px;
  color: #374151;
  white-space: pre-wrap;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.loading, .empty {
  padding: 18px 10px;
  color: #64748b;
  font-size: 12px;
}
</style>


