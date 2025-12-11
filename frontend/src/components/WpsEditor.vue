<template>
  <view class="wps-editor-wrapper">
    <!-- 编辑器容器：始终渲染，确保 DOM 元素存在 -->
    <view class="wps-container">
      <!-- 使用 ref 和 id 双重绑定，确保 uni-app 能正确识别 -->
      <view :id="finalContainerId" :ref="'wpsContainer'" class="wps-editor-container" :style="containerStyle"></view>
      
      <!-- 加载状态覆盖层 -->
      <view v-if="loading" class="wps-status-overlay wps-loading">
        <text class="loading-text">正在加载编辑器...</text>
      </view>

      <!-- 错误状态覆盖层 -->
      <view v-else-if="error" class="wps-status-overlay wps-error">
        <text class="error-text">{{ error }}</text>
        <button v-if="showRetry" type="primary" size="mini" @tap="handleRetry" style="margin-top: 16rpx;">
          重试
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import { initWpsEditor } from '@/utils/wps-sdk.js'
import { createWpsSession } from '@/services/api.js'

/**
 * WPS 在线编辑器组件
 * 
 * 使用示例：
 * <WpsEditor
 *   :file-id="'project_123_doc_1'"
 *   :file-name="'项目文档.docx'"
 *   :app-id="'SX20251208BJWRFK'"
 *   :mode="'edit'"
 *   :user-id="'user_123'"
 *   @ready="onEditorReady"
 *   @error="onEditorError"
 * />
 */
export default {
  name: 'WpsEditor',
  props: {
    // 文件唯一标识（必填）
    fileId: {
      type: String,
      required: true
    },
    // 文件名（必填，用于判断文件类型）
    fileName: {
      type: String,
      required: true
    },
    // WPS AppID（必填）
    appId: {
      type: String,
      required: true
    },
    // 编辑模式：'edit' 或 'view'（默认：'edit'）
    mode: {
      type: String,
      default: 'edit',
      validator: (value) => ['edit', 'view'].includes(value)
    },
    // 用户 ID（可选，用于生成 token）
    userId: {
      type: String,
      default: null
    },
    // 容器元素 ID（可选，默认自动生成）
    containerId: {
      type: String,
      default: null
    },
    // 容器样式（可选）
    containerStyle: {
      type: Object,
      default: () => ({
        width: '100%',
        height: '100%'
      })
    },
    // 是否自动加载（默认：true）
    autoLoad: {
      type: Boolean,
      default: true
    },
    // 是否显示重试按钮（默认：true）
    showRetry: {
      type: Boolean,
      default: true
    }
  },
  data() {
    return {
      loading: false,
      error: null,
      instance: null,
      // 自动生成容器 ID，避免多个组件实例冲突
      generatedContainerId: null
    }
  },
  computed: {
    // 最终使用的容器 ID
    finalContainerId() {
      return this.containerId || this.generatedContainerId
    }
  },
  watch: {
    // 监听 fileId 变化，重新加载编辑器
    fileId(newVal, oldVal) {
      if (newVal && newVal !== oldVal) {
        console.log('WpsEditor: fileId 变化，重新加载', { newVal, oldVal })
        this.reload()
      }
    },
    // 监听 mode 变化
    mode(newVal, oldVal) {
      if (newVal && newVal !== oldVal) {
        console.log('WpsEditor: mode 变化，重新加载', { newVal, oldVal })
        this.reload()
      }
    }
  },
  created() {
    // 在 created 阶段生成容器 ID，确保在模板渲染前就有值
    if (!this.containerId) {
      this.generatedContainerId = `wps-editor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }
  },
  mounted() {
    // 自动加载
    if (this.autoLoad) {
      // 延迟加载，确保 DOM 完全渲染
      this.$nextTick(() => {
        setTimeout(() => {
          this.load()
        }, 200)
      })
    }
  },
  beforeUnmount() {
    // 组件销毁时，销毁 WPS 实例
    this.destroy()
  },
  methods: {
    /**
     * 加载编辑器
     */
    async load() {
      if (this.loading || this.instance) {
        return
      }

      const startTime = Date.now()
      console.log(`WpsEditor [${this.fileName}]: 开始加载...`, startTime)

      this.loading = true
      this.error = null

      try {
        // 1. 创建会话获取 token
        let token = ''
        try {
          const session = await createWpsSession({
            fileId: this.fileId,
            userId: this.userId
          })
          if (session && session.token) {
            token = session.token
          }
        } catch (e) {
          console.warn('创建 WPS 会话失败，将使用空 token:', e)
          // 不阻断流程，允许在无 token 情况下继续
        }

        // 2. 等待 DOM 渲染完成
        // 在 uni-app 中，需要多次 nextTick 确保 DOM 完全渲染
        // 注意：容器元素现在始终渲染，所以不需要等待条件判断
        await this.$nextTick()
        await this.$nextTick() // 双重 nextTick，确保 DOM 完全渲染
        
        // 3. 确认容器元素存在
        // 在 uni-app 中，优先使用 ref 获取元素，如果不行再用 getElementById
        let containerElement = null
        
        // 方法1：尝试通过 ref 获取（uni-app 推荐方式）
        const refContainer = this.$refs.wpsContainer
        if (refContainer) {
          // 在 H5 环境下，ref 返回的是 DOM 元素
          containerElement = refContainer
          // 如果是数组（某些情况下），取第一个
          if (Array.isArray(containerElement) && containerElement.length > 0) {
            containerElement = containerElement[0]
          }
          // 如果是 Vue 组件实例，获取其 $el
          if (containerElement && containerElement.$el) {
            containerElement = containerElement.$el
          }
        }
        
        // 方法2：如果 ref 获取失败，使用 getElementById（轮询方式，最多等待 1 秒）
        if (!containerElement && typeof document !== 'undefined') {
          const maxAttempts = 10
          const delayMs = 100
          
          for (let i = 0; i < maxAttempts; i++) {
            containerElement = document.getElementById(this.finalContainerId)
            if (containerElement) {
              break
            }
            // 如果找不到，等待一段时间后重试
            if (i < maxAttempts - 1) {
              await new Promise(resolve => setTimeout(resolve, delayMs))
            }
          }
        }
        
        // 方法3：如果还是找不到，尝试使用 uni-app 的 createSelectorQuery
        if (!containerElement && typeof uni !== 'undefined' && uni.createSelectorQuery) {
          try {
            await new Promise((resolve) => {
              const query = uni.createSelectorQuery().in(this)
              query.select(`#${this.finalContainerId}`).boundingClientRect((data) => {
                if (data && typeof document !== 'undefined') {
                  // 如果通过 uni 选择器找到了，再尝试用 getElementById
                  containerElement = document.getElementById(this.finalContainerId)
                }
                resolve()
              }).exec()
            })
          } catch (e) {
            console.warn('使用 uni.createSelectorQuery 查找元素失败:', e)
          }
        }
        
        if (!containerElement) {
          // 输出调试信息
          console.error('容器元素查找失败')
          console.error('尝试查找的元素ID:', this.finalContainerId)
          console.error('组件状态:', {
            containerId: this.containerId,
            generatedContainerId: this.generatedContainerId,
            finalContainerId: this.finalContainerId,
            hasRef: !!this.$refs.wpsContainer,
            refValue: this.$refs.wpsContainer
          })
          
          // 尝试查找所有可能的容器元素（用于调试）
          if (typeof document !== 'undefined') {
            const allElements = document.querySelectorAll('[id*="wps-editor"]')
            console.error('找到的所有 wps-editor 相关元素:', Array.from(allElements).map(el => el.id))
          }
          
          throw new Error(`容器元素 ${this.finalContainerId} 未找到，请确保组件已正确挂载`)
        }

        // 4. 初始化编辑器
        this.instance = await initWpsEditor({
          containerId: this.finalContainerId,
          appId: this.appId,
          fileId: this.fileId,
          fileName: this.fileName,
          mode: this.mode,
          token: token
        })

        // 5. 监听编辑器事件
        this.setupEventListeners()

        // 6. 触发 ready 事件
        this.$emit('ready', this.instance)

        const duration = Date.now() - startTime
        console.log(`WpsEditor [${this.fileName}]: 初始化完成，耗时 ${duration}ms`, {
          fileId: this.fileId,
          fileName: this.fileName,
          mode: this.mode
        })
      } catch (error) {
        console.error('WPS 编辑器加载失败:', error)
        console.error('错误详情:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          toString: error.toString()
        })
        // 显示详细错误信息
        let errorMessage = '加载编辑器失败，请稍后重试'
        if (error.message) {
          if (error.message.includes('容器元素')) {
            errorMessage = '编辑器容器未找到，请刷新页面重试'
          } else if (error.message.includes('SDK')) {
            errorMessage = 'WPS SDK 加载失败，请检查网络连接'
          } else {
            errorMessage = `加载编辑器失败: ${error.message}`
          }
        }
        this.error = errorMessage
        this.$emit('error', error)
      } finally {
        this.loading = false
      }
    },

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
      if (!this.instance || !this.instance.ApiEvent) {
        return
      }

      // 文件打开事件
      this.instance.ApiEvent.AddApiEventListener('fileOpen', (data) => {
        console.log('WPS 文件打开:', data)
        this.$emit('fileOpen', data)
        if (data.success) {
          console.log('文件打开成功:', data.fileInfo)
        } else {
          console.error('文件打开失败:', data.msg)
          this.$emit('error', new Error(data.msg || '文件打开失败'))
        }
      })

      try {
        this.instance.ApiEvent.AddApiEventListener('fileSave', (data) => {
          this.$emit('fileSave', data)
        })
      } catch (e) {
        console.warn('WPS SDK 不支持 fileSave 事件监听', e)
      }

      // 错误事件
      this.instance.ApiEvent.AddApiEventListener('error', (data) => {
        const errorMsg = data.msg || data.message || '编辑器发生错误'
        const errorCode = data.code || data.type
        
        // 过滤掉一些已知的、不影响功能的 WPS SDK 内部错误
        const ignoredCodes = ['NETWORK_ERROR', 'TIMEOUT'] // 可以根据实际情况添加
        const shouldIgnore = ignoredCodes.includes(errorCode) || 
                            errorMsg.includes('网络') && errorMsg.includes('超时')
        
        if (!shouldIgnore) {
          // 只记录真正需要关注的错误
          console.warn('WPS 错误:', {
            msg: errorMsg,
            code: errorCode,
            type: data.type
          })
        }
        
        // 所有错误都触发 error 事件，让调用方决定如何处理
        // 但使用 warn 而不是 error，避免控制台被刷屏
        this.$emit('error', new Error(errorMsg))
      })

      // 监听重命名事件（尝试捕获 WPS 内部重命名操作）
      try {
        this.instance.ApiEvent.AddApiEventListener('fileRename', (data) => {
          console.log('WPS 文件重命名:', data)
          this.$emit('fileRename', data)
        })
      } catch (e) {
        console.warn('WPS SDK 不支持 fileRename 事件监听', e)
      }

      // 注意：WPS 的保存和关闭事件是通过后端回调接口 /v3/3rd/notify 接收的
      // 而不是通过前端事件监听器。这些事件会在后端 WpsController.notify() 方法中处理
      // 如果需要在前端感知保存/关闭，可以通过轮询后端状态或使用其他机制
    },

    /**
     * 销毁编辑器实例
     */
    destroy() {
      if (this.instance) {
        try {
          if (typeof this.instance.destroy === 'function') {
            this.instance.destroy()
          } else if (typeof this.instance.Free === 'function') {
            this.instance.Free()
          }
        } catch (e) {
          console.warn('销毁 WPS 实例时出错:', e)
        }
        this.instance = null
      }
    },

    /**
     * 重试加载
     */
    handleRetry() {
      this.destroy()
      this.load()
    },

    /**
     * 获取编辑器实例（供外部调用）
     */
    getInstance() {
      return this.instance
    },

    /**
     * 重新加载编辑器
     */
    reload() {
      this.destroy()
      this.load()
    },

    /**
     * [API] 获取当前选区文本
     */
    async getSelectionText() {
      if (!this.instance) return ''
      try {
        const app = this.instance.Application
        // 尝试方法 1: 直接获取 Selection.Text
        const selection = await app.ActiveDocument.Selection
        let text = await selection.Text
        
        // 调试日志
        console.log('尝试获取选区文本 (Selection.Text):', text)

        // 如果为空，尝试方法 2: 通过 Range 获取
        if (!text) {
             const range = await selection.Range
             text = await range.Text
             console.log('尝试获取选区文本 (Selection.Range.Text):', text)
        }
        
        // 如果 text 可能是 undefined，转为空字符串
        return text || ''
      } catch (e) {
        console.error('获取选区文本失败', e)
        // 不抛出错误，而是返回空字符串，由上层处理提示
        return ''
      }
    },

    /**
     * [API] 获取当前选区的 Range 起止位置（用于官方文档中的 Range: {Start, End}）
     * 注意：WebOffice JSAPI 的属性访问也是异步的，需要 await range.Start / await range.End
     * 返回 { start, end }，失败时返回 null
     */
    async getSelectionRange() {
      if (!this.instance) return null
      try {
        const app = this.instance.Application
        const selection = await app.ActiveDocument.Selection
        const range = await selection.Range
        const start = await range.Start
        const end = await range.End
        if (typeof start !== 'number' || typeof end !== 'number') {
          console.error('Range Start/End 非数字:', { start, end })
          return null
        }
        return { start, end }
      } catch (e) {
        console.error('获取选区 Range 失败', e)
        return null
      }
    },

    /**
     * [API] 在当前选区创建书签
     * @param {string} name 书签名称
     */
    async addBookmark(name) {
       if (!this.instance) return false
       try {
         const app = this.instance.Application
         const bookmarks = await app.ActiveDocument.Bookmarks
         
         // 调试：打印即将创建的书签
         console.log('准备创建书签:', name)
         
         if (!name) throw new Error('书签名称不能为空')

         // 1. 检查是否已存在
         const exists = await bookmarks.Exists(name)
         if (exists) {
           console.log(`变量 "${name}" 已存在，视为创建成功`)
           return true
         }
         
         // 2. 关键修复：临时创建书签
         // 直接在当前光标位置创建，不显式传 Range，让 WPS 自己决定
         // 这样可以规避 Range 失效问题
         await bookmarks.Add({
           Name: name
         })
         
         console.log('书签创建成功:', name)
         return true
       } catch (e) {
         console.error('创建书签失败详情:', e)
         if (typeof e === 'object' && (e.msg || e.message)) {
            console.error('SDK Error Msg:', e.msg || e.message)
         }
         throw e
       }
    },
    
    /**
     * [API] 在指定 Range 位置创建书签（严格按照官方文档 Range: {Start, End}）
     * @param {string} name 书签名称
     * @param {number} start 起始位置
     * @param {number} end 结束位置
     */
    async addBookmarkAtRange(name, start, end) {
      if (!this.instance) return false
      try {
        const app = this.instance.Application
        const bookmarks = await app.ActiveDocument.Bookmarks

        if (!name) throw new Error('书签名称不能为空')
        if (typeof start !== 'number' || typeof end !== 'number') {
          throw new Error('无效的 Range 位置')
        }

        const exists = await bookmarks.Exists(name)
        if (exists) {
          console.log(`变量 "${name}" 已存在，视为创建成功`)
          return true
        }

        // 按照官方文档示例传入 Range: { Start, End }
        await bookmarks.Add({
          Name: name,
          Range: {
            Start: start,
            End: end
          }
        })

        console.log('书签创建成功:', name, 'Range:', start, end)
        return true
      } catch (e) {
        console.error('addBookmarkAtRange 失败:', e)
        if (typeof e === 'object' && (e.msg || e.message)) {
          console.error('SDK Error Msg:', e.msg || e.message)
        }
        throw e
      }
    },
    
    /**
     * [API] 在光标处插入文本并创建书签
     * @param {string} text 文本内容
     * @param {string} bookmarkName 书签名称
     */
    async insertTextWithBookmark(text, bookmarkName) {
       if (!this.instance) return false
       try {
         const app = this.instance.Application
         const selection = await app.ActiveDocument.Selection
         const range = await selection.Range

         // 先在当前选区位置插入文本
         range.Text = text

         // 再获取插入后该 Range 的 Start / End，用于按官方文档指定 Range 创建书签
         const start = await range.Start
         const end = await range.End

         const bookmarks = await app.ActiveDocument.Bookmarks
         const exists = await bookmarks.Exists(bookmarkName)
         if (!exists) {
           await bookmarks.Add({
             Name: bookmarkName,
             Range: {
               Start: start,
               End: end
             }
           })
         }
         return true
       } catch (e) {
         console.error('插入变量失败', e)
         throw e
       }
    },

    /**
     * [API] 更新书签内容
     * @param {string} name 书签名称
     * @param {string} text 新文本
     */
    async updateBookmark(name, text) {
        if (!this.instance) return false
        try {
            const app = this.instance.Application
            const bookmarks = await app.ActiveDocument.Bookmarks
            const exists = await bookmarks.Exists(name)
            if (exists) {
                // 使用官方推荐的 ReplaceBookmark 接口
                await bookmarks.ReplaceBookmark([
                    {
                        name: name,
                        type: 'text',
                        value: text
                    }
                ])
                return true
            } else {
                console.warn(`更新书签失败：书签 "${name}" 不存在`)
                return false
            }
        } catch (e) {
             console.error('更新书签失败', e)
             throw e
        }
    },
    
    /**
     * [API] 同步所有书签内容
     * @param {Array} variables 变量列表 [{name, value}]
     * @returns {Object} 结果统计 { updated: 0, total: 0 }
     */
    async syncAllBookmarks(variables) {
      if (!this.instance || !variables || variables.length === 0) return { updated: 0, total: 0 }
      
      console.log('开始同步书签, 变量总数:', variables.length)
      
      try {
        const app = this.instance.Application
        const bookmarks = await app.ActiveDocument.Bookmarks
        
        let updatedCount = 0
        
        for (const v of variables) {
           const exists = await bookmarks.Exists(v.name)
           if (exists) {
             await bookmarks.ReplaceBookmark([
                {
                  name: v.name,
                  type: 'text',
                  value: v.value
                }
             ])
             updatedCount++
           }
        }
        
        console.log(`同步完成: 更新了 ${updatedCount} 个变量`)
        return { updated: updatedCount, total: variables.length }
        
      } catch (e) {
        console.error('同步书签失败', e)
        throw e
      }
    },
  }
}
</script>

<style lang="scss" scoped>
.wps-editor-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
}

.wps-container {
  width: 100%;
  height: 100%;
  position: relative;
  flex: 1;
}

.wps-editor-container {
  width: 100%;
  height: 100%;
  
  /* 强制 iframe 响应容器大小 */
  :deep(iframe) {
    width: 100% !important;
    height: 100% !important;
    border: none;
    display: block;
  }
}

/* 状态覆盖层：显示在容器上方 */
.wps-status-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200rpx;
  padding: 32rpx;
  box-sizing: border-box;
  z-index: 10;
}

.wps-loading {
  background-color: rgba(255, 255, 255, 0.9);
}

.wps-error {
  background-color: rgba(255, 255, 255, 0.95);
}

.loading-text,
.error-text {
  font-size: 28rpx;
  color: #666;
  text-align: center;
}

.error-text {
  color: #f56c6c;
}
</style>
