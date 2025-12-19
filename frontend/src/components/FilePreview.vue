<template>
  <view class="file-preview">
    <view v-if="!file" class="preview-placeholder">
      <text>请从左侧选择文件进行预览</text>
    </view>
    <view v-else class="preview-content">
      <!-- 文件信息头部 -->
      <view class="preview-header">
        <view class="preview-title-row">
          <text class="preview-title">{{ file.name }}</text>
          <button
            v-if="canEdit"
            class="btn-edit"
            type="primary"
            size="mini"
            @tap="handleEdit"
          >
            编辑
          </button>
        </view>
        <view class="preview-meta">
          <text class="meta-item" v-if="file.fileType">类型：{{ file.fileType }}</text>
          <text class="meta-item" v-if="file.fileSize">大小：{{ formatFileSize(file.fileSize) }}</text>
        </view>
      </view>

      <!-- 预览内容区域 -->
      <view class="preview-body">
        <!-- Office 文件预览（使用 WPS 预览模式） -->
        <view v-if="isOffice && file.wpsFileId" class="preview-wps">
          <WpsEditor
            :file-id="file.wpsFileId"
            :file-name="file.name"
            :app-id="wpsAppId"
            :mode="'view'"
            :auto-load="true"
            :container-style="wpsContainerStyle"
            @ready="onWpsPreviewReady"
            @error="onWpsPreviewError"
          />
        </view>

        <!-- PDF 预览 -->
        <view v-else-if="isPdf" class="preview-pdf">
          <!-- #ifdef H5 -->
          <iframe :src="pdfViewerUrl" class="preview-iframe" frameborder="0"></iframe>
          <!-- #endif -->
          <!-- #ifndef H5 -->
          <web-view :src="pdfViewerUrl" />
          <!-- #endif -->
        </view>

        <!-- 图片/SVG 预览 -->
        <view v-else-if="isImage" class="preview-image">
          <image :src="blobUrl" mode="aspectFit" class="preview-img" @error="handleImageError" />
        </view>

        <!-- 视频预览 -->
        <view v-else-if="isVideo" class="preview-video">
          <!-- #ifdef H5 -->
          <video 
            :src="fileUrl" 
            controls 
            autoplay 
            class="preview-video-player"
            @error="handleVideoError"
          ></video>
          <!-- #endif -->
          <!-- #ifndef H5 -->
          <video 
            :src="fileUrl" 
            controls 
            autoplay 
            class="preview-video-player"
            @error="handleVideoError"
          ></video>
          <!-- #endif -->
        </view>

        <!-- 音频预览 -->
        <view v-else-if="isAudio" class="preview-audio">
           <view class="audio-wrapper">
            <view class="audio-icon">🎵</view>
            <text class="audio-name">{{ file.name }}</text>
            <view class="preview-audio-player" v-html="audioPlayerHtml"></view>
           </view>
        </view>

        <!-- 文本预览 -->
        <view v-else-if="isText" class="preview-text">
          <text class="text-content">{{ textContent }}</text>
        </view>

        <!-- 不支持预览的文件类型 -->
        <view v-else class="preview-unsupported">
          <text>该文件类型暂不支持预览</text>
          <text class="preview-hint">文件类型: {{ file.fileType || '未知' }}</text>
          <text class="preview-hint">文件ID: {{ file.wpsFileId || file.id }}</text>
          <button class="btn-download" type="default" size="mini" @tap="handleDownload">
            下载文件
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getFileDownloadUrl } from '@/services/api.js'
import { getAuthHeaders } from '@/utils/auth.js'
import WpsEditor from '@/components/WpsEditor.vue'

export default {
  name: 'FilePreview',
  components: {
    WpsEditor
  },
  props: {
    file: {
      type: Object,
      default: null
    },
    baseUrl: {
      type: String,
      default: ''
    },
    wpsAppId: {
      type: String,
      default: 'AK20251215TTJNYB'
    }
  },
  data() {
    return {
      textContent: '',
      loading: false,
      blobUrl: '',
      wpsContainerStyle: {
        width: '100%',
        height: '100%'
      }
    }
  },
  computed: {
    fileUrl() {
      if (!this.file) {
        console.log('FilePreview: file 为空')
        return ''
      }
      const fileId = this.file.wpsFileId || this.file.id
      const url = getFileDownloadUrl(fileId)
      console.log('FilePreview fileUrl:', { file: this.file, fileId, url })
      return url
    },
    isPdf() {
      // PDF is now handled by isOffice (WpsEditor)
      return false
    },
    isOffice() {
      if (!this.file || !this.file.fileType) return false
      const type = this.file.fileType.toLowerCase()
      // Create 'pdf' as an office type to be handled by WpsEditor
      return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'].includes(type)
    },
    isImage() {
      if (!this.file || !this.file.fileType) return false
      const type = this.file.fileType.toLowerCase()
      return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(type)
    },
    isVideo() {
      if (!this.file || !this.file.fileType) return false
      const type = this.file.fileType.toLowerCase()
      return ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'].includes(type)
    },
    isAudio() {
       if (!this.file || !this.file.fileType) return false
       const type = this.file.fileType.toLowerCase()
       return ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(type)
    },
    audioPlayerHtml() {
      if (!this.isAudio || !this.fileUrl) return ''
      // Use standard HTML audio tag, bypassing UniApp component resolution
      return `<audio src="${this.blobUrl}" controls style="width: 100%; height: 50px; outline: none;"></audio>`
    },
    isText() {
      if (!this.file || !this.file.fileType) return false
      const type = this.file.fileType.toLowerCase()
      return ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'java', 'py', 'sh', 'sql', 'log'].includes(type)
    },
    canEdit() {
      // Office 文件且有 wpsFileId 可以编辑
      if (!this.file || !this.file.fileType) return false
      const type = this.file.fileType.toLowerCase()
      return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(type) && !!this.file.wpsFileId
    },
    pdfViewerUrl() {
      // 使用 PDF.js 预览
      const pdfUrl = encodeURIComponent(this.fileUrl)
      return `https://mozilla.github.io/pdf.js/web/viewer.html?file=${pdfUrl}`
    },
    officeViewerUrl() {
      // 使用 Office Online 预览
      const fileUrl = encodeURIComponent(this.fileUrl)
      return `https://view.officeapps.live.com/op/view.aspx?src=${fileUrl}`
    }
  },
  watch: {
    file: {
      immediate: true,
      handler(newFile) {
        console.log('FilePreview file 变化:', newFile)
        // 清理旧的 blobUrl
        if (this.blobUrl) {
          URL.revokeObjectURL(this.blobUrl)
          this.blobUrl = ''
        }
        
        if (!newFile) return

        if (this.isText) {
          this.loadTextContent()
        } else if (this.isImage || this.isVideo || this.isAudio) {
           this.loadMediaResource()
        }
      }
    }
  },
  beforeUnmount() {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl)
    }
  },
  mounted() {
    console.log('FilePreview mounted, file:', this.file, 'fileUrl:', this.fileUrl)
  },
  methods: {
    async loadTextContent() {
      if (!this.file || !this.fileUrl) return
      
      this.loading = true
      try {
        const response = await uni.request({
          url: this.fileUrl,
          method: 'GET'
        })
        this.textContent = response.data || ''
      } catch (error) {
        console.error('加载文本内容失败:', error)
        this.textContent = '加载失败'
      } finally {
        this.loading = false
      }
    },
    async loadMediaResource() {
        if (!this.file || !this.fileUrl) return
        
        this.loading = true
        try {
           const header = getAuthHeaders() || {}
           const response = await uni.request({
             url: this.fileUrl,
             method: 'GET',
             responseType: 'arraybuffer',
             header: header
           })
           
           if (response.statusCode === 200 && response.data) {
               const blob = new Blob([response.data], { type: this.getMimeType(this.file.fileType) })
               this.blobUrl = URL.createObjectURL(blob)
           } else {
               throw new Error('Load failed with status: ' + response.statusCode)
           }
        } catch (e) {
            console.error('加载媒体资源失败:', e)
            uni.showToast({
                title: '资源加载失败',
                icon: 'none'
            })
        } finally {
            this.loading = false
        }
    },
    getMimeType(fileType) {
        if (!fileType) return ''
        const type = fileType.toLowerCase()
        const map = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'bmp': 'image/bmp',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'ogg': 'video/ogg',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav'
        }
        return map[type] || ''
    },
    handleEdit() {
      if (this.canEdit) {
        this.$emit('edit', this.file)
      }
    },
    handleImageError(e) {
      console.error('图片加载失败:', e)
      uni.showToast({
        title: '图片加载失败',
        icon: 'none'
      })
    },
    handleVideoError(e) {
      console.error('视频加载失败:', e)
      uni.showToast({
        title: '视频播放失败',
        icon: 'none'
      })
    },
    handleAudioError(e) {
      console.error('音频加载失败:', e)
      uni.showToast({
        title: '音频播放失败',
        icon: 'none'
      })
    },
    // WPS 预览相关方法
    onWpsPreviewReady(instance) {
      console.log('WPS 预览加载成功', instance)
    },
    onWpsPreviewError(error) {
      console.error('WPS 预览加载失败:', error)
      uni.showToast({
        title: '预览加载失败，请稍后重试',
        icon: 'none'
      })
    },
    handleDownload() {
      if (this.fileUrl) {
        console.log('下载文件:', this.fileUrl)
        // #ifdef H5
        // H5端直接打开下载链接
        window.open(this.fileUrl, '_blank')
        // #endif
        // #ifndef H5
        uni.downloadFile({
          url: this.fileUrl,
          success: (res) => {
            if (res.statusCode === 200) {
              uni.openDocument({
                filePath: res.tempFilePath,
                success: () => {
                  console.log('打开文档成功')
                },
                fail: (err) => {
                  console.error('打开文档失败:', err)
                  uni.showToast({
                    title: '打开文档失败',
                    icon: 'none'
                  })
                }
              })
            }
          },
          fail: (err) => {
            console.error('下载文件失败:', err)
            uni.showToast({
              title: '下载失败',
              icon: 'none'
            })
          }
        })
        // #endif
      }
    },
    formatFileSize(bytes) {
      if (!bytes) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
    }
  }
}
</script>

<style lang="scss" scoped>
.file-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
}

.preview-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  font-size: 28rpx;
}

.preview-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-header {
  padding: 24rpx;
  border-bottom: 1rpx solid #e5e7eb;
  background-color: #ffffff;
}

.preview-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.preview-title {
  font-size: 32rpx;
  font-weight: 500;
  color: #1f2430;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-edit {
  margin-left: 16rpx;
}

.preview-meta {
  display: flex;
  gap: 24rpx;
}

.meta-item {
  font-size: 24rpx;
  color: #6b7280;
}

.preview-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.preview-pdf,
.preview-office,
.preview-wps {
  width: 100%;
  height: 100%;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.preview-hint {
  display: block;
  font-size: 24rpx;
  color: #9ca3af;
  margin-top: 8rpx;
}

.preview-image {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24rpx;
}

.preview-img {
  max-width: 100%;
  max-height: 100%;
}

.preview-text {
  padding: 24rpx;
  overflow-y: auto;
  height: 100%;
}

.text-content {
  font-size: 28rpx;
  color: #1f2430;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.preview-unsupported {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  color: #9ca3af;
  font-size: 28rpx;
}

.preview-video {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #000;
}

.preview-video-player {
  width: 100%;
  height: 100%;
}

.preview-audio {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f8fafc;
}

.audio-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
  width: 80%;
}

.audio-icon {
  font-size: 80rpx;
}

.audio-name {
  font-size: 32rpx;
  color: #334155;
  font-weight: 500;
  text-align: center;
}

.preview-audio-player {
  width: 100%;
}

.btn-download {
  margin-top: 16rpx;
}
</style>

