<template>
  <view class="example-page">
    <view class="example-header">
      <text class="title">WPS 编辑器使用示例</text>
    </view>

    <view class="example-controls">
      <button type="primary" @tap="handleStartEdit" :disabled="editorReady">
        开始编辑
      </button>
      <button type="default" @tap="handleReload" :disabled="!editorReady" style="margin-left: 16rpx;">
        重新加载
      </button>
      <button type="warn" @tap="handleDestroy" :disabled="!editorReady" style="margin-left: 16rpx;">
        销毁编辑器
      </button>
    </view>

    <view class="example-editor">
      <WpsEditor
        v-if="showEditor"
        :file-id="fileId"
        :file-name="fileName"
        :app-id="appId"
        :mode="mode"
        :user-id="userId"
        :auto-load="false"
        @ready="onEditorReady"
        @error="onEditorError"
        @fileOpen="onFileOpen"
        @fileSave="onFileSave"
        @fileClose="onFileClose"
        ref="wpsEditor"
      />
    </view>

    <view class="example-info">
      <text class="info-title">状态信息：</text>
      <text class="info-item">文件ID: {{ fileId }}</text>
      <text class="info-item">文件名: {{ fileName }}</text>
      <text class="info-item">模式: {{ mode }}</text>
      <text class="info-item">编辑器状态: {{ editorReady ? '已就绪' : '未就绪' }}</text>
    </view>
  </view>
</template>

<script>
import WpsEditor from './WpsEditor.vue'

/**
 * WpsEditor 组件使用示例
 * 
 * 本示例展示了如何使用 WpsEditor 组件，包括：
 * 1. 基本使用
 * 2. 事件监听
 * 3. 手动控制（加载、重新加载、销毁）
 */
export default {
  name: 'WpsEditorExample',
  components: {
    WpsEditor
  },
  data() {
    return {
      showEditor: false,
      editorReady: false,
      fileId: 'example_doc_1',
      fileName: '示例文档.docx',
      appId: 'AK20251215TTJNYB', // 替换为你的 AppID
      mode: 'edit', // 'edit' 或 'view'
      userId: '1780305141' // 可选，用户 ID
    }
  },
  methods: {
    /**
     * 开始编辑
     */
    handleStartEdit() {
      this.showEditor = true
      // 等待组件挂载后手动加载
      this.$nextTick(() => {
        if (this.$refs.wpsEditor) {
          this.$refs.wpsEditor.load()
        }
      })
    },

    /**
     * 重新加载编辑器
     */
    handleReload() {
      if (this.$refs.wpsEditor) {
        this.$refs.wpsEditor.reload()
      }
    },

    /**
     * 销毁编辑器
     */
    handleDestroy() {
      if (this.$refs.wpsEditor) {
        this.$refs.wpsEditor.destroy()
        this.showEditor = false
        this.editorReady = false
      }
    },

    /**
     * 编辑器就绪事件
     */
    onEditorReady(instance) {
      console.log('编辑器就绪', instance)
      this.editorReady = true
      uni.showToast({
        title: '编辑器加载成功',
        icon: 'success'
      })
    },

    /**
     * 编辑器错误事件
     */
    onEditorError(error) {
      console.error('编辑器错误', error)
      this.editorReady = false
      uni.showToast({
        title: '编辑器加载失败',
        icon: 'none',
        duration: 3000
      })
    },

    /**
     * 文件打开事件
     */
    onFileOpen(data) {
      console.log('文件打开', data)
      if (data.success) {
        console.log('文件信息:', data.fileInfo)
      }
    },

    /**
     * 文件保存事件
     */
    onFileSave(data) {
      console.log('文件保存', data)
      uni.showToast({
        title: '文件已保存',
        icon: 'success'
      })
    },

    /**
     * 文件关闭事件
     */
    onFileClose(data) {
      console.log('文件关闭', data)
    }
  }
}
</script>

<style lang="scss" scoped>
.example-page {
  padding: 24rpx;
  min-height: 100vh;
  background-color: #f5f5f5;
}

.example-header {
  margin-bottom: 24rpx;
}

.title {
  font-size: 36rpx;
  font-weight: bold;
  color: #333;
}

.example-controls {
  margin-bottom: 24rpx;
  display: flex;
  align-items: center;
}

.example-editor {
  width: 100%;
  height: 600rpx;
  background-color: #fff;
  border-radius: 12rpx;
  overflow: hidden;
  margin-bottom: 24rpx;
}

.example-info {
  background-color: #fff;
  padding: 24rpx;
  border-radius: 12rpx;
}

.info-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
  display: block;
  margin-bottom: 16rpx;
}

.info-item {
  font-size: 28rpx;
  color: #666;
  display: block;
  margin-bottom: 8rpx;
}
</style>

