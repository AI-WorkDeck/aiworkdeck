<template>
  <view class="chat-interface" :class="{ 'is-empty': bubbles.length === 0 && !isStreaming }">
    
    <!-- Upload File Modal (reused from FileTree pattern) -->
    <view v-if="showUploadDialog" class="king-dialog-mask" @tap="cancelUpload">
      <view class="king-dialog king-dialog-large" @tap.stop>
        <view class="king-dialog-header">
          <view class="header-row">
            <text class="king-dialog-title">上传文件</text>
            <text class="king-dialog-subtitle">选择目标位置并选择要上传的文档</text>
          </view>
        </view>
        <view class="king-dialog-body">
          <view class="form-group">
            <text class="form-label">上传位置</text>
            <view class="king-field clickable" @tap="openFolderSelector">
              <image src="/static/folder-closed.png" class="field-icon-img" mode="aspectFit" />
              <text class="field-value">
                {{ selectedUploadParent ? getFolderPath(selectedUploadParent) : '根目录' }}
              </text>
            </view>
          </view>
          
          <!-- H5 Folder Upload -->
          <!-- #ifdef H5 -->
          <view class="form-group">
            <text class="form-label">上传文件夹</text>
            <view class="king-field clickable" @tap="triggerFolderUploadInput">
               <view v-if="isFolderUpload && uploadSelectedFiles.length > 0" class="field-content-row">
                  <text class="field-value">已选择 {{ uploadSelectedFiles.length }} 个文件</text>
               </view>
               <view v-else>
                  <text class="field-placeholder">点击选择文件夹...</text>
               </view>
            </view>
          </view>
          <!-- #endif -->

          <view class="form-group">
            <text class="form-label">上传文件</text>
            <view class="king-field clickable" @tap="selectFilesForUpload">
              <view v-if="uploadSelectedFiles.length === 0 || isFolderUpload">
                <text class="field-placeholder">选择文件（支持多选）</text>
              </view>
              <view v-else class="selected-files-list">
                <text v-for="(file, index) in uploadSelectedFiles" :key="index" class="selected-file-tag">
                  {{ file.name }}
                </text>
              </view>
            </view>
          </view>
        </view>
        <view class="king-dialog-footer">
          <view class="king-btn king-btn-secondary" @tap="cancelUpload">取消</view>
          <view 
            class="king-btn king-btn-primary" 
            :class="{ disabled: !uploadSelectedFiles.length }"
            @tap="uploadSelectedFiles.length ? confirmUploadAndAddContext() : null"
          >
            确定上传
          </view>
        </view>
      </view>
    </view>

    <!-- Folder Selector Popup (Nested) - Matching FileTree design -->
    <view v-if="showFolderSelector" class="king-dialog-mask" style="z-index: 3000;" @tap="showFolderSelector = false">
      <view class="king-dialog" @tap.stop>
        <view class="king-dialog-header">
          <view class="header-row folder-selector-header">
            <text class="king-dialog-title">选择文件夹</text>
            <view class="new-folder-btn" @tap="handleSelectorCreateFolder">
              <text class="btn-plus">+</text>
              <text>新建文件夹</text>
            </view>
          </view>
        </view>
        <view class="king-dialog-body scrollable-body">
          <view
            class="folder-tree-item root"
            :class="{ active: tempSelectedParent === null }"
            @tap="selectUploadParent(null)"
          >
            <view class="tree-expand-icon-wrapper" @tap.stop="toggleFolderSelectorExpand('root')">
              <image
                class="tree-expand-icon-img"
                :src="folderSelectorExpanded['root'] !== false ? '/static/down.png' : '/static/right.png'"
                mode="aspectFit"
              />
            </view>
            <image 
              :src="folderSelectorExpanded['root'] !== false ? '/static/folder-opened.png' : '/static/folder-closed.png'" 
              class="folder-icon-img" 
              :class="{ 'is-opened': folderSelectorExpanded['root'] !== false }"
              style="margin-right: 8px;" 
              mode="aspectFit" 
            />
            <text class="folder-name">根目录</text>
          </view>

          <view
            v-for="folder in folderTree"
            :key="folder.id"
            class="folder-tree-item"
            :class="{ active: tempSelectedParent === folder.id }"
            @tap="selectUploadParent(folder.id)"
          >
            <view class="indent" :style="{ width: (folder.level * 20) + 'px' }"></view>
            <view class="tree-expand-icon-wrapper" @tap.stop="toggleFolderSelectorExpand(folder.id)">
              <image
                class="tree-expand-icon-img"
                :src="folderSelectorExpanded[String(folder.id)] === true ? '/static/down.png' : '/static/right.png'"
                mode="aspectFit"
              />
            </view>
            <image 
              :src="folderSelectorExpanded[String(folder.id)] === true ? '/static/folder-opened.png' : '/static/folder-closed.png'" 
              class="folder-icon-img" 
              :class="{ 'is-opened': folderSelectorExpanded[String(folder.id)] === true }"
              mode="aspectFit" 
            />
            <text class="folder-name">{{ folder.name }}</text>
          </view>
          <view v-if="folderTree.length === 0" class="empty-tip">暂无其他文件夹</view>
        </view>
        <view class="king-dialog-footer">
          <view class="king-btn king-btn-secondary" @tap="showFolderSelector = false">取消</view>
          <view class="king-btn king-btn-primary" @tap="confirmFolderSelection">确定</view>
        </view>
      </view>
    </view>

    <!-- 1. Header Actions -->
    <view class="chat-header">
       <view class="header-left">
          <text class="project-name-display">{{ projectName }}</text>
       </view>
       <view class="header-actions">
          <view class="icon-btn" @tap="toggleAssistantMenu" :class="{ active: showAssistantMenu }" title="Assistants">
             <image class="btn-icon default" src="/static/assistant.png" />
             <image class="btn-icon hover" src="/static/assistant_hover.png" />
          </view>
          <view class="icon-btn" @tap="$emit('toggle-history')" title="History">
             <image class="btn-icon default" src="/static/history.png" />
             <image class="btn-icon hover" src="/static/history_hover.png" />
          </view>
          <view class="icon-btn" @tap="startNewChat" title="New Chat">
             <image class="btn-icon default" src="/static/plus.png" />
             <image class="btn-icon hover" src="/static/plus_hover.png" />
          </view>
          <view class="icon-btn" @tap="$emit('close')" title="Close">
             <image class="btn-icon default" src="/static/close.png" />
             <image class="btn-icon hover" src="/static/close_hover.png" />
          </view>
       </view>
    </view>

    <!-- Assistant Dropdown Panel - positioned relative to chat-interface like history drawer -->
    <view v-if="showAssistantMenu" class="assistant-dropdown-panel" @tap.stop>
       <view class="assistant-menu-header">智慧助手</view>
       <view 
         v-for="ast in assistants" 
         :key="ast.id" 
         class="assistant-menu-item"
         :class="{ active: currentAssistantId === ast.id }"
         @tap="selectAssistant(ast)"
       >
          <text class="assistant-item-name">{{ ast.name }}</text>
          <view class="setting-icon-wrapper" @tap.stop="$emit('config-assistant', ast)">
             <image class="setting-icon default" src="/static/setting.png" mode="aspectFit" />
             <image class="setting-icon hover" src="/static/setting_hoving.png" mode="aspectFit" />
          </view>
       </view>
    </view>
    <view v-if="showAssistantMenu" class="dropdown-mask" @tap="showAssistantMenu = false"></view>

    <!-- 2. Message List (Single Source of Truth: bubbles) -->
    <scroll-view 
      v-if="bubbles.length > 0 || isStreaming"
      class="message-list" 
      scroll-y 
      :scroll-top="scrollTop"
      :scroll-with-animation="true"
    >
      <view class="message-list-content">
        <view 
          v-for="(msg, index) in bubbles" 
          :key="msg.id || index" 
          class="message-row"
          :class="msg.role.toLowerCase()"
        >
          <!-- User Message -->
          <div v-if="msg.role === 'USER'" class="user-bubble">
            <!-- Image Thumbnails (above message) -->
            <view v-if="msg.images && msg.images.length > 0" class="user-bubble-images">
               <image v-for="(img, idx) in msg.images" :key="idx" :src="img.path" mode="aspectFill" class="bubble-image-thumb" />
            </view>
            <!-- Context File Tags (inline before content) -->
            <div class="user-bubble-content">
              <span v-for="f in (msg.contextFiles || [])" :key="f.id" class="context-tag-inline">
                <image :src="f.isDir ? '/static/folder-closed.png' : '/static/document.png'" class="tag-icon" />
                <span class="tag-at">@</span>
                <span class="tag-name" :title="f.name">{{ truncateName(f.name) }}</span>
              </span>
              <span v-if="msg.contextFiles && msg.contextFiles.length > 0">&nbsp;</span>
              {{ msg.content }}
            </div>
            <span v-if="msg.timestamp" class="bubble-timestamp user">{{ msg.timestamp }}</span>
          </div>

          <!-- Assistant Message (Root Bubble) -->
          <div v-else-if="msg.role === 'ASSISTANT'" class="assistant-root-wrapper">
             <RootBubble 
               :bubble="msg"
               @open-artifact-tab="handleArtifactOpenTab" 
               @approve="handleArtifactApprove"
             />
             <span v-if="msg.timestamp" class="bubble-timestamp assistant">{{ msg.timestamp }}</span>
          </div>
        </view>
      </view>
    </scroll-view>

    <!-- 3. Integrated Empty & Input Layout -->
    <view v-if="bubbles.length === 0 && !isStreaming" class="empty-flow-container">
       <!-- Top: Welcome Text (between header and input) -->
       <view class="empty-top-section">
          <text class="welcome-text">今天需要处理什么法律事务？</text>
          <text class="welcome-subtitle">随时为您解答法律疑问、起草文档或分析案情。</text>
       </view>

       <!-- Center: Input -->
       <view class="empty-middle-section">
          <view class="input-card centered-style">
              <view v-if="isDragging" class="drop-overlay">
                 <text>Drop files here</text>
              </view>
               <!-- Image Thumbnails Preview (top-left) -->
               <view v-if="pastedImages.length > 0" class="input-images-preview">
                  <view v-for="(img, index) in pastedImages" :key="index" class="preview-image-item">
                     <image :src="img.path" mode="aspectFill" class="preview-thumb" />
                     <text class="preview-remove" @tap="removePastedImage(index)">×</text>
                  </view>
               </view>
              <div 
                ref="richInput"
                class="chat-input-rich"
                contenteditable="true"
                @input="handleRichInput"
                @paste="handlePaste"
                @keydown.enter="handleEnterKey"
                data-placeholder="请输入法律问题、拖拽文件/文件夹至此、粘贴合同文本或描述案情..."
              ></div>
              <!-- Note: Context files are now shown as inline tags inside the rich input -->
              <view class="input-footer">
                 <view class="action-bar-left">
                    <view class="icon-btn mini file-add-btn" @tap="triggerFileSelect" title="Add File">
                   <image class="btn-icon default" src="/static/plus.png" />
                   <image class="btn-icon hover" src="/static/plus_hover.png" />
                 </view>
                    <view class="model-selector" @tap="toggleModelDropdown">
                       <text class="model-name">{{ currentModelName }}</text>
                       <text class="dropdown-arrow">▼</text>
                       <view v-if="showModelDropdown" class="model-dropdown down">
                          <view v-for="m in availableModels" :key="m.id" 
                                class="model-option" 
                                :class="{ active: currentModelId === m.id }"
                                @tap.stop="selectModel(m)">
                             {{ m.name }}
                          </view>
                       </view>
                    </view>
                 </view>
                 <view class="send-btn" :class="{ disabled: !inputPrompt.trim() && !isStreaming }" @tap="handleSubmit">
                    <text>→</text>
                 </view>
              </view>
          </view>
          <view v-if="showModelDropdown" class="dropdown-mask model-mask" @tap="showModelDropdown = false"></view>
       </view>

       <!-- Bottom: History (pushed to bottom with flexbox) -->
       <view class="empty-bottom-section">
          <view class="recent-history-header">近期对话</view>
          <view class="recent-history" v-if="recentHistory.length > 0">
             <view v-for="h in recentHistory" :key="h.id" class="history-item" @tap="$emit('load-history', h)">
                <text class="history-title">{{ cleanTitle(h.title) }}</text>
                <text class="history-time">{{ formatRelativeTime(h.updatedAt) }}</text>
             </view>
          </view>
          <view v-else class="history-empty-placeholder">
             <text>Your recent chats will appear here</text>
          </view>
          <view class="history-disclaimer">AI生成内容仅供参考，不构成正式法律意见。</view>
       </view>
    </view>

    <!-- 4. Regular Bottom Input -->
    <view v-else class="input-area-wrapper">
       <view class="input-card">
          <view v-if="isDragging" class="drop-overlay">
             <text>Drop files here</text>
          </view>
           <!-- Image Thumbnails Preview (top-left) -->
           <view v-if="pastedImages.length > 0" class="input-images-preview">
              <view v-for="(img, index) in pastedImages" :key="index" class="preview-image-item">
                 <image :src="img.path" mode="aspectFill" class="preview-thumb" />
                 <text class="preview-remove" @tap="removePastedImage(index)">×</text>
              </view>
           </view>
          <div 
            ref="richInput"
            class="chat-input-rich"
            contenteditable="true"
            @input="handleRichInput"
            @paste="handlePaste"
            @keydown.enter="handleEnterKey"
            data-placeholder="Ask anything..."
          ></div>
          <!-- Note: Context files are now shown as inline tags inside the rich input -->
          <view class="input-footer">
             <view class="action-bar-left">
                <view class="icon-btn mini" @tap="triggerFileSelect" title="Add File">
                   <image class="btn-icon default" src="/static/plus.png" />
                   <image class="btn-icon hover" src="/static/plus_hover.png" />
                </view>
                <view class="model-selector" @tap="toggleModelDropdown">
                   <text class="model-name">{{ currentModelName }}</text>
                   <text class="dropdown-arrow">▲</text>
                   <view v-if="showModelDropdown" class="model-dropdown up">
                      <view v-for="m in availableModels" :key="m.id" 
                            class="model-option" 
                            :class="{ active: currentModelId === m.id }"
                            @tap.stop="selectModel(m)">
                         {{ m.name }}
                      </view>
                   </view>
                </view>
             </view>
             <view class="send-btn" :class="{ disabled: !inputPrompt.trim() && !isStreaming }" @tap="handleSubmit">
                <text>→</text>
             </view>
          </view>
          <view v-if="showModelDropdown" class="dropdown-mask" @tap="showModelDropdown = false"></view>
       </view>
    </view>

  </view>
</template>

<script>
import RootBubble from './AgentMessage/RootBubble.vue'
import { useAgentStream } from '@/composables/useAgentStream.js'
import { ref, watch, onMounted, nextTick, getCurrentInstance, computed } from 'vue'
import { createFile, getProjectFiles, getApiBaseUrl } from '@/services/api.js'
import { getAuthHeaders } from '@/utils/auth.js'

export default {
  name: 'ChatInterface',
  components: { RootBubble },
  props: {
    projectId: String,
    projectName: String,
    recentHistory: Array,
    assistants: Array,
    currentAssistantId: String
  },
  setup(props, { emit, expose }) {
    const { 
      bubbles, 
      isStreaming, 
      sendMessage, 
      abort, 
      setConversationId,
      clearBubbles,
      onClientAction,
      onTitleUpdate
    } = useAgentStream()

    // Bridge Stream Events to Component Events
    onClientAction((action) => {
        emit('client-action', action)
    })
    
    // Bridge Title Update Event to Parent
    onTitleUpdate((title) => {
        emit('title-update', title)
        emit('refresh-history') // Trigger history refresh to show new title
    })

    const inputPrompt = ref('')
    const richInput = ref(null)
    const scrollTop = ref(0)
    const isDragging = ref(false)
    
    // Context Files (for drag-drop file context)
    const contextFiles = ref([])
    
    // Pasted Images (for paste/drop images)
    const pastedImages = ref([])
    
    // Model Selection
    const showModelDropdown = ref(false)
    const availableModels = [
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
      { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
      { id: 'openai/gpt-5.2', name: 'GPT-5.2' }
    ]
    const currentModelId = ref(availableModels[0].id)
    const currentModelName = ref(availableModels[0].name)
    
    
    // Fix: Define selectModel explicitly
    const selectModel = (m) => {
      console.log('Switching model to:', m.name)
      currentModelId.value = m.id
      currentModelName.value = m.name
      showModelDropdown.value = false
    }
    
    const showAssistantMenu = ref(false)
    
    // Upload Dialog State
    const showUploadDialog = ref(false)
    const uploadSelectedFiles = ref([])
    const selectedUploadParent = ref(null)
    const isFolderUpload = ref(false)
    const showFolderSelector = ref(false)
    const tempSelectedParent = ref(null)
    const allProjectFiles = ref([])
    const isUploading = ref(false)
    const folderSelectorExpanded = ref({}) // Folder expand state for selector
    
    // Computed: Folder tree for selector (matching FileTree logic with expand/collapse)
    const folderTree = computed(() => {
      if (!Array.isArray(allProjectFiles.value) || allProjectFiles.value.length === 0) {
        return []
      }

      // 只取文件夹
      const folders = allProjectFiles.value.filter(f => f && f.isFolder)
      if (folders.length === 0) return []

      // 构建 id -> 节点 映射
      const nodeMap = new Map()
      folders.forEach(f => {
        nodeMap.set(String(f.id), {
          ...f,
          children: [],
          level: 0
        })
      })
 
      // 构建树结构
      const roots = []
      folders.forEach(f => {
        const node = nodeMap.get(String(f.id))
        const pId = node.parentId ? String(node.parentId) : null
        if (pId && nodeMap.has(pId)) {
          const parent = nodeMap.get(pId)
          parent.children.push(node)
        } else {
          roots.push(node)
        }
      })
 
      const result = []
      // 默认只展开根目录（即显示第一层级）
      const isRootExpanded = folderSelectorExpanded.value['root'] !== false

      if (isRootExpanded) {
        const traverse = (nodes, level) => {
          if (!Array.isArray(nodes)) return
          nodes
            .slice()
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN', { numeric: true }))
            .forEach(node => {
              node.level = level
              result.push(node)
              const hasChildren = node.children && node.children.length > 0
              // 一级及以下文件夹默认收起，必须显式标记为 true 才展示下级
              const expanded = folderSelectorExpanded.value[String(node.id)] === true
              if (hasChildren && expanded) {
                traverse(node.children, level + 1)
              }
            })
        }
        traverse(roots, 1)
      }
      return result
    })
    
    // Computed: Selected folder name (for backward compatibility)
    const selectedUploadParentName = computed(() => {
      if (selectedUploadParent.value === null) return '根目录'
      const folder = allProjectFiles.value.find(f => f.id === selectedUploadParent.value)
      return folder ? folder.name : '根目录'
    })

    // Scroll to bottom when bubbles change
    watch(() => bubbles.value.length, () => {
       scrollToBottom()
    })
    // Deep watch active bubble changes (e.g. streaming content)
    watch(bubbles, () => {
       // Optional: throttle scroll?
       // For now simple trigger
    }, { deep: true })

    const scrollToBottom = () => {
       nextTick(() => {
         scrollTop.value += 10000
       })
    }

    const startNewChat = () => {
      setConversationId(null)  // This now triggers resetSSE internally
      clearBubbles()           // Use composable method
      emit('new-chat')
    }

    const handleSubmit = async () => {
      // Create a clone to safely manipulate and extract text without tags
      let text = ''
      if (richInput.value) {
        const clone = richInput.value.cloneNode(true)
        // Remove file tags to avoid duplicating their name in the text
        const tags = clone.querySelectorAll('[data-file-id]')
        tags.forEach(t => t.remove())
        
        // Manual Text Extraction to preserve newlines
        // 1. Replace block elements/breaks with newlines
        let html = clone.innerHTML
        // Replace <br> with newline
        html = html.replace(/<br\s*\/?>/gi, '\n')
        // Replace <div> and <p> with newline (start of block)
        html = html.replace(/<(?:div|p)[^>]*>/gi, '\n')
        // Remove closing tags (implicit newline separation handled by start tags)
        html = html.replace(/<\/(?:div|p)>/gi, '')
        
        // 2. Decode entities and strip remaining tags
        const temp = document.createElement('div')
        temp.innerHTML = html
        text = temp.textContent.trim()
      }

      const hasImages = pastedImages.value.length > 0
      const hasFiles = contextFiles.value.length > 0
      
      // 禁止发送纯空消息：必须有文本、图片或文件上下文至少其一
      if (!text && !hasImages && !hasFiles) {
        if (isStreaming.value) {
          // 如果正在流式传输，允许中断操作
          return
        }
        // 显示提示
        if (typeof uni !== 'undefined') {
          uni.showToast({ title: '请输入消息内容', icon: 'none' })
        }
        return
      }
      
      const prompt = text
      
      if (richInput.value) richInput.value.innerHTML = ''
      inputPrompt.value = ''
      
      // Use context files as fileList
      const fileListToSend = contextFiles.value.map(f => ({
        id: f.id,  // useAgentStream.js uses f.id to extract fileIds
        fileName: f.name,
        fileType: f.fileType,
        wpsFileId: f.wpsFileId,
        isDir: f.isDir
      }))
      
      // Save images and context files for user bubble display
      const imagesToShow = pastedImages.value.map(img => ({ path: img.path }))
      const contextFilesToShow = contextFiles.value.map(f => ({
        id: f.id,
        name: f.name,
        isDir: f.isDir
      }))
      
      // Clear context files and images after sending
      contextFiles.value = []
      pastedImages.value = []
      
      await sendMessage({
        prompt,
        fileList: fileListToSend,
        projectId: props.projectId,
        modelId: currentModelId.value,
        assistantId: props.currentAssistantId,
        // Pass for user bubble display
        _userImages: imagesToShow,
        _userContextFiles: contextFilesToShow
      })
      
      scrollToBottom()
    }

    // --- History Loading Logic ---
    const loadMessages = (conversationId, loadedMsgs) => {
       console.log('[ChatInterface] Loading history...', loadedMsgs.length)
       setConversationId(conversationId)  // This triggers resetSSE internally
       clearBubbles()  // Clear existing using composable method

       loadedMsgs.forEach(msg => {
          const role = msg.role?.toUpperCase() || 'USER'
          
          if (role === 'USER') {
              bubbles.value.push({
                  id: msg.id,
                  role: 'USER',
                  content: msg.content,
                  timestamp: formatTime(msg.createdAt)
              })
          } else {
              // Convert Assistant Message to Root Bubble Structure
              // 1. Check for XML tags
              const content = msg.content || ''
              
              // Simple Heuristic: If content has <thinking> or <title>, try to parse?
              // Or just dump content into Walkthrough for legacy safety.
              // IF we want to support old artifacts in history, we parse them.
              
              // Create default bubble
              const bubble = {
                  id: msg.id,
                  role: 'ASSISTANT',
                  thinking: { status: 'done', content: '', duration: 0 },
                  title: '',
                  processes: [],
                  artifacts: [],
                  walkthrough: '',
                  content: '', // Main Answer (from <final> tag)
                  timestamp: formatTime(msg.createdAt)
              }
              
              // Extract Artifacts
              const artifactRegex = /<artifact\s+type="([^"]+)"(?:[^>]*)>([\s\S]*?)<\/artifact>/g
              let remaining = content
              let match
              while ((match = artifactRegex.exec(content)) !== null) {
                 const type = match[1]
                 const artContent = match[2]
                 bubble.artifacts.push({
                     id: `hist-art-${Math.random()}`,
                     type,
                     status: 'draft',
                     data: { content: artContent },
                     fileName: type === 'task_list' ? 'Task List' : 'Plan'
                 })
                 remaining = remaining.replace(match[0], '')
              }
              
              // Extract thinking
              const thinkingMatch = remaining.match(/<thinking>([\s\S]*?)<\/thinking>/)
              if (thinkingMatch) {
                  bubble.thinking.content = thinkingMatch[1]
                  remaining = remaining.replace(thinkingMatch[0], '')
              }
              
              // Extract title
              const titleMatch = remaining.match(/<title>([\s\S]*?)<\/title>/)
              if (titleMatch) {
                  bubble.title = titleMatch[1]
                  remaining = remaining.replace(titleMatch[0], '')
              }

              // Extract <final> tag content -> bubble.content
              const finalMatch = remaining.match(/<final>([\s\S]*?)<\/final>/)
              if (finalMatch) {
                  bubble.content = finalMatch[1].trim()
                  remaining = remaining.replace(finalMatch[0], '')
              }
              
              // Extract <walkthrough> tag content
              const walkthroughMatch = remaining.match(/<walkthrough>([\s\S]*?)<\/walkthrough>/)
              if (walkthroughMatch) {
                  bubble.walkthrough = walkthroughMatch[1].trim()
                  remaining = remaining.replace(walkthroughMatch[0], '')
              }

              // Extract <process> tags and their content (steps, tool_code, tool_output)
              const processRegex = /<process(?:\s+name="([^"]*)")?[^>]*>([\s\S]*?)<\/process>/g
              let processMatch
              while ((processMatch = processRegex.exec(remaining)) !== null) {
                  const processName = processMatch[1] || 'Processing'
                  const processContent = processMatch[2]
                  
                  const proc = {
                      id: `hist-proc-${Date.now()}-${Math.random()}`,
                      title: processName,
                      isExpanded: false, // Collapse by default in history
                      items: [],  // CHANGED: Use items array instead of steps for consistency
                      steps: [],  // Keep for backward compatibility
                      content: ''
                  }
                  
                  // Extract <step> tags
                  const stepRegex = /<step>([\s\S]*?)<\/step>/g
                  let stepMatch
                  while ((stepMatch = stepRegex.exec(processContent)) !== null) {
                      proc.items.push({
                          type: 'step',
                          status: 'done',
                          text: stepMatch[1].trim()
                      })
                  }
                  
                  // Extract <tool_code> and <tool_output> - create tool items
                  const toolCodeMatch = processContent.match(/<tool_code>([\s\S]*?)<\/tool_code>/)
                  const toolOutputMatch = processContent.match(/<tool_output([^>]*)>([\s\S]*?)<\/tool_output>/)
                  
                  if (toolCodeMatch) {
                      const code = toolCodeMatch[1].trim()
                      // toolOutputMatch[1] = attributes string, toolOutputMatch[2] = content
                      const outputAttrs = toolOutputMatch ? toolOutputMatch[1] : ''
                      const output = toolOutputMatch ? toolOutputMatch[2].trim() : ''
                      
                      // First: Try to parse status from attribute (new format)
                      let status = 'success'
                      const statusAttrMatch = outputAttrs.match(/status="([^"]*)"/)
                      if (statusAttrMatch) {
                          const statusAttr = statusAttrMatch[1]
                          if (statusAttr === 'SUCCESS') {
                              status = 'success'
                          } else if (statusAttr === 'FAILURE') {
                              status = 'error'
                          }
                      } else {
                          // Fallback: Determine status from output content (legacy format)
                          if (output.includes('Error') || output.includes('Exception') || output.includes('FAILURE')) {
                              status = 'error'
                          }
                      }
                      
                      proc.items.push({
                          type: 'tool',
                          code: code,
                          output: output,
                          status: status
                      })
                  }
                  
                  bubble.processes.push(proc)
              }
              
              // Clean up process tags from remaining
              remaining = remaining.replace(/<process[^>]*>[\s\S]*?<\/process>/g, '')

              // Any remaining untagged text goes to content (fallback for legacy)
              remaining = remaining.trim()
              if (remaining && !bubble.content) {
                  bubble.content = remaining
              }
              
              bubbles.value.push(bubble)
          }
       })
       
       scrollToBottom()
    }

    const formatTime = (ts) => {
       if (!ts) return ''
       const d = new Date(ts)
       return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`
    }

    // Relative time format for recent history display
    const formatRelativeTime = (ts) => {
       if (!ts) return ''
       const now = new Date()
       const d = new Date(ts)
       const diffMs = now - d
       const diffMins = Math.floor(diffMs / (1000 * 60))
       const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
       const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
       
       if (diffMins < 1) return '刚刚'
       if (diffMins < 60) return `${diffMins}分钟前`
       if (diffHours < 24) return `${diffHours}小时前`
       if (diffDays < 7) return `${diffDays}天前`
       return `${d.getMonth()+1}/${d.getDate()}`
    }

    // Clean title - strip XML tags like <thinking>, <process>, etc.
    const cleanTitle = (title) => {
       if (!title) return '新对话'
       // Remove common XML tags
       let cleaned = title
         .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
         .replace(/<process[^>]*>[\s\S]*?<\/process>/gi, '')
         .replace(/<step>[\s\S]*?<\/step>/gi, '')
         .replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
         .replace(/<tool_output>[\s\S]*?<\/tool_output>/gi, '')
         .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/gi, '')
         .replace(/<final>[\s\S]*?<\/final>/gi, '')
         .replace(/<[^>]+>/g, '') // Remove any remaining tags
         .trim()
       return cleaned || '新对话'
    }

    const handleRichInput = (e) => {
        inputPrompt.value = e.target.innerText
        
        // Sync inline tags with contextFiles ref
        // When user deletes a tag from the input, also remove it from contextFiles
        syncContextFilesWithInlineTags()
    }
    
    // --- Sync contextFiles with actual inline tags in the input ---
    const syncContextFilesWithInlineTags = () => {
      if (!richInput.value) return
      
      // Get all file IDs from inline tags currently in the input
      const inlineTagElements = richInput.value.querySelectorAll('[data-file-id]')
      const inlineTagIds = new Set()
      inlineTagElements.forEach(el => {
        const fileId = el.getAttribute('data-file-id')
        if (fileId) {
          inlineTagIds.add(fileId)
        }
      })
      
      // Remove any contextFiles that no longer have a corresponding inline tag
      contextFiles.value = contextFiles.value.filter(f => inlineTagIds.has(String(f.id)))
    }
    
    // --- Handle Paste (Images & Plain Text) ---
    const handlePaste = (e) => {
      // Always prevent default to stop rich text/HTML paste
      e.preventDefault()
      
      const clipboardData = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData)
      if (!clipboardData) return
      
      const items = clipboardData.items
      let hasProcessedImage = false
      
      // 1. Try to handle images from clipboard
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile()
            if (file) {
              hasProcessedImage = true
              const reader = new FileReader()
              reader.onload = (evt) => {
                pastedImages.value.push({
                  file: file,
                  path: evt.target.result
                })
              }
              reader.readAsDataURL(file)
            }
          }
        }
      }
      
      // 2. Handle Text (Insert as Plain Text)
      // Only insert text if we didn't just process an image, OR if there is text content
      // (sometimes image paste has no meaning text).
      // But usually we want to allow pasting text AND images if mixed? 
      // Safe bet: if there is text data, insert it.
      const text = clipboardData.getData('text/plain')
      if (text) {
        document.execCommand('insertText', false, text)
      }
    }

    // --- Handle Enter Key (Enter=NewLine, Cmd/Ctrl+Enter=Send) ---
    const handleEnterKey = (e) => {
      if (e.metaKey || e.ctrlKey) {
        // Cmd+Enter or Ctrl+Enter -> Send
        e.preventDefault()
        handleSubmit()
      } else {
        // Plain Enter -> New Line (Default behavior, do not prevent)
      }
    }
    
    // --- Truncate filename for display ---
    const truncateName = (name, maxLen = 15) => {
      if (!name) return ''
      return name.length > maxLen ? name.slice(0, maxLen) + '...' : name
    }
    
    // --- File Context Methods ---
    const addFile = (file) => {
      // Check if file already exists by ID
      if (!contextFiles.value.find(f => f.id === file.id)) {
        const fileData = {
          id: file.id,
          name: file.name,
          fileType: file.fileType,
          wpsFileId: file.wpsFileId,
          isDir: file.isDir || file.fileType === 'folder'
        }
        contextFiles.value.push(fileData)
        
        // Insert inline tag into rich input
        insertContextTagToInput(fileData)
        
        console.log('[ChatInterface] File added as context:', file.name)
      }
    }
    
    // --- Insert inline tag into contenteditable ---
    const insertContextTagToInput = (file) => {
      if (!richInput.value) return
      
      const icon = file.isDir ? '/static/folder-closed.png' : '/static/document.png'
      const displayName = truncateName(file.name)
      // Use inline styles since scoped CSS doesn't apply to dynamically created DOM elements
      // Transparent background + border style
      const tagStyles = `
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: transparent;
        color: #1A5336;
        padding: 3px 8px;
        border-radius: 4px;
        margin: 0 4px 2px 0;
        font-size: 12px;
        font-weight: 500;
        vertical-align: middle;
        user-select: none;
        max-width: 160px;
        border: 1px solid rgba(26, 83, 54, 0.4);
      `.replace(/\s+/g, ' ').trim()
      const iconStyles = `width: 14px; height: 14px; flex-shrink: 0; border-radius: 2px; filter: brightness(0.3);`
      const atStyles = `color: #1A5336; font-weight: 600;`
      const nameStyles = `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px; color: #1A5336;`
      
      const tagHtml = `<span style="${tagStyles}" contenteditable="false" data-file-id="${file.id}" data-is-dir="${file.isDir ? 'true' : 'false'}" title="${file.name}"><img src="${icon}" style="${iconStyles}"/><span style="${atStyles}">@</span><span style="${nameStyles}">${displayName}</span></span>&nbsp;`
      
      // Insert at cursor or append to end
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        if (richInput.value.contains(range.commonAncestorContainer)) {
          range.deleteContents()
          const fragment = range.createContextualFragment(tagHtml)
          range.insertNode(fragment)
          range.collapse(false)
        } else {
          richInput.value.innerHTML += tagHtml
        }
      } else {
        richInput.value.innerHTML += tagHtml
      }
      
      // Update text model
      inputPrompt.value = richInput.value.innerText
    }
    
    const removeContextFile = (index) => {
      contextFiles.value.splice(index, 1)
    }
    
    const removePastedImage = (index) => {
      pastedImages.value.splice(index, 1)
    }
    
    // --- Upload Dialog Methods ---
    const triggerFileSelect = async () => {
      // Load project folders for folder selector
      await loadProjectFolders()
      
      // Reset state
      uploadSelectedFiles.value = []
      selectedUploadParent.value = null
      isFolderUpload.value = false
      showFolderSelector.value = false
      tempSelectedParent.value = null
      
      // Show upload dialog
      showUploadDialog.value = true
    }
    
    const loadProjectFolders = async () => {
      if (!props.projectId) return
      try {
        const files = await getProjectFiles(props.projectId, null, true) // tree=true
        allProjectFiles.value = files || []
        console.log('[ChatInterface] Loaded project files for folder selector:', files?.length)
      } catch (e) {
        console.error('[ChatInterface] Failed to load project folders:', e)
        allProjectFiles.value = []
      }
    }
    
    const selectFilesForUpload = () => {
      // H5/uni-app file selection
      uni.chooseFile({
        count: 9,
        success: (res) => {
          isFolderUpload.value = false
          uploadSelectedFiles.value = res.tempFiles.map(file => ({
            name: file.name,
            path: file.path,
            size: file.size,
            relativePath: file.name,
            fileObject: file
          }))
        },
        fail: (err) => {
          console.error('选择文件失败:', err)
          uni.showToast({ title: '选择文件失败', icon: 'none' })
        }
      })
    }
    
    // #ifdef H5
    const triggerFolderUploadInput = () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.webkitdirectory = true
      input.directory = true
      input.multiple = true
      
      input.onchange = (e) => {
        const files = Array.from(e.target.files || [])
        if (files.length === 0) return
        
        isFolderUpload.value = true
        uploadSelectedFiles.value = files.map(f => ({
          name: f.name,
          size: f.size,
          path: URL.createObjectURL(f),
          fileObject: f,
          relativePath: f.webkitRelativePath || f.name
        }))
      }
      
      input.click()
    }
    // #endif
    
    const selectUploadParent = (parentId) => {
      tempSelectedParent.value = parentId
    }
    
    const confirmFolderSelection = () => {
      selectedUploadParent.value = tempSelectedParent.value
      showFolderSelector.value = false
    }
    
    // Open folder selector and reset expand state
    const openFolderSelector = () => {
      folderSelectorExpanded.value = {} // Reset expand state
      tempSelectedParent.value = selectedUploadParent.value
      showFolderSelector.value = true
    }
    
    // Toggle folder expand/collapse in selector
    const toggleFolderSelectorExpand = (folderId) => {
      const key = String(folderId)
      if (key === 'root') {
        // Root uses reverse logic: undefined/missing means expanded
        if (folderSelectorExpanded.value['root'] === false) {
          folderSelectorExpanded.value = { ...folderSelectorExpanded.value, root: undefined }
        } else {
          folderSelectorExpanded.value = { ...folderSelectorExpanded.value, root: false }
        }
      } else {
        // Non-root: undefined means collapsed, true means expanded
        const current = folderSelectorExpanded.value[key] === true
        folderSelectorExpanded.value = { ...folderSelectorExpanded.value, [key]: !current }
      }
    }
    
    // Get folder path for display
    const getFolderPath = (folderId) => {
      if (typeof folderId === 'number' || typeof folderId === 'string') {
        const folder = allProjectFiles.value.find(f => f.id === folderId)
        if (folder) {
          return buildFolderPath(folder)
        }
        return '未知文件夹'
      }
      if (folderId && folderId.name) {
        return buildFolderPath(folderId)
      }
      return '根目录'
    }
    
    // Build full folder path string
    const buildFolderPath = (folder) => {
      if (!folder) return ''
      const path = [folder.name]
      let current = folder
      while (current && current.parentId !== null) {
        const parent = allProjectFiles.value.find(f => f.id === current.parentId)
        if (parent) {
          path.unshift(parent.name)
          current = parent
        } else {
          break
        }
      }
      return path.join(' / ')
    }
    
    // Handle create folder in selector
    const handleSelectorCreateFolder = async () => {
      const folderName = await new Promise((resolve) => {
        uni.showModal({
          title: '新建文件夹',
          editable: true,
          placeholderText: '请输入文件夹名称',
          success: (res) => {
            if (res.confirm && res.content) {
              resolve(res.content.trim())
            } else {
              resolve(null)
            }
          },
          fail: () => resolve(null)
        })
      })
      
      if (!folderName) return
      
      try {
        const projectId = typeof props.projectId === 'string' ? Number(props.projectId) : props.projectId
        const parentId = tempSelectedParent.value
        
        const { createFolder } = await import('@/services/api.js')
        const newFolder = await createFolder(projectId, parentId, folderName)
        
        if (newFolder && newFolder.id) {
          // Add to local list
          allProjectFiles.value = [...allProjectFiles.value, { ...newFolder, isFolder: true }]
          // Select the new folder
          tempSelectedParent.value = newFolder.id
          // Expand parent if collapsed
          if (parentId) {
            folderSelectorExpanded.value = { ...folderSelectorExpanded.value, [String(parentId)]: true }
          }
          uni.showToast({ title: '文件夹创建成功', icon: 'success' })
        }
      } catch (error) {
        console.error('[ChatInterface] Create folder failed:', error)
        uni.showToast({ title: error.message || '创建文件夹失败', icon: 'none' })
      }
    }
    
    const cancelUpload = () => {
      showUploadDialog.value = false
      uploadSelectedFiles.value = []
      selectedUploadParent.value = null
      isFolderUpload.value = false
    }
    
    const getFileTypeFromName = (fileName) => {
      if (!fileName) return 'other'
      const ext = fileName.split('.').pop()?.toLowerCase()
      const typeMap = {
        doc: 'word', docx: 'word', 
        xls: 'excel', xlsx: 'excel',
        pdf: 'pdf',
        txt: 'txt',
        ppt: 'ppt', pptx: 'ppt',
        jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
        md: 'markdown'
      }
      return typeMap[ext] || 'other'
    }
    
    // Confirm upload and add to context (like drag-drop)
    const confirmUploadAndAddContext = async () => {
      if (uploadSelectedFiles.value.length === 0) {
        uni.showToast({ title: '请选择要上传的文件', icon: 'none' })
        return
      }
      
      if (!props.projectId) {
        uni.showToast({ title: '项目ID未设置', icon: 'none' })
        return
      }
      
      isUploading.value = true
      const projectId = typeof props.projectId === 'string' ? Number(props.projectId) : props.projectId
      const parentId = selectedUploadParent.value
      const filesToUpload = [...uploadSelectedFiles.value]
      
      // Close dialog
      showUploadDialog.value = false
      uploadSelectedFiles.value = []
      
      try {
        for (const file of filesToUpload) {
          const fileType = getFileTypeFromName(file.name)
          const wpsFileId = `project_${projectId}_doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
          
          // Create file record in backend
          const createdFile = await createFile(
            projectId,
            parentId,
            file.name,
            fileType,
            file.size,
            null,
            wpsFileId
          )
          
          if (createdFile && createdFile.id) {
            console.log('[ChatInterface] File created:', createdFile.name, createdFile.id)
            
            // Upload file content if available (H5)
            if (file.fileObject) {
              try {
                await uploadFileContent(createdFile.id, wpsFileId, file.fileObject, file.size)
              } catch (uploadErr) {
                console.warn('[ChatInterface] File content upload failed, file record created:', uploadErr)
              }
            }
            
            // Add to context (same as drag-drop)
            addFile({
              id: createdFile.id,
              name: createdFile.name,
              fileType: createdFile.fileType,
              wpsFileId: createdFile.wpsFileId,
              isDir: false
            })
          }
        }
        
        uni.showToast({ title: `已添加 ${filesToUpload.length} 个文件`, icon: 'success' })
      } catch (error) {
        console.error('[ChatInterface] Upload failed:', error)
        uni.showToast({ title: error.message || '上传失败', icon: 'none' })
      } finally {
        isUploading.value = false
      }
    }
    
    // Upload file content to storage
    const uploadFileContent = async (fileId, wpsFileId, fileObject, totalSize) => {
      return new Promise((resolve, reject) => {
        // #ifdef H5
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${getApiBaseUrl()}/api/files/${wpsFileId}/upload`)
        
        const headers = getAuthHeaders()
        for (const key in headers) {
          xhr.setRequestHeader(key, headers[key])
        }
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.setRequestHeader('X-File-Offset', '0')
        xhr.setRequestHeader('X-File-Total-Size', String(totalSize))
        
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error(`HTTP ${xhr.status}`))
          }
        }
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.send(fileObject)
        // #endif
        
        // #ifndef H5
        resolve() // Non-H5 platforms skip direct upload
        // #endif
      })
    }
    
    // Expose methods for parent ref access
    expose({ addFile, loadMessages })

    return {
       bubbles,
       isStreaming,
       inputPrompt,
       richInput,
       scrollTop,
       isDragging,
       contextFiles,
       pastedImages,
       handleSubmit,
       handleRichInput,
       handlePaste,
       handleEnterKey,
       startNewChat,
       loadMessages,
       formatTime,
       formatRelativeTime,
       cleanTitle,
       addFile,
       removeContextFile,
       removePastedImage,
       truncateName,
       // Menu
       showAssistantMenu,
       toggleAssistantMenu: () => showAssistantMenu.value = !showAssistantMenu.value,
       selectAssistant: (a) => emit('update:currentAssistantId', a.id),
       // Model
       currentModelId,
       currentModelName,
       toggleModelDropdown: () => showModelDropdown.value = !showModelDropdown.value,
       selectModel,
       showModelDropdown,
       availableModels,
       // Artifact
       handleArtifactOpenTab: (art) => emit('artifact-open-tab', art),
       handleArtifactApprove: async (art) => {
          console.log('[ChatInterface] Artifact Approved:', art.id)
          await sendMessage({
             prompt: `已批准实施计划: ${art.fileName}`,
             fileList: [],
             projectId: props.projectId,
             modelId: currentModelId.value,
             assistantId: props.currentAssistantId
          })
          scrollToBottom()
       },
       // Upload Dialog
       showUploadDialog,
       uploadSelectedFiles,
       selectedUploadParent,
       selectedUploadParentName,
       isFolderUpload,
       showFolderSelector,
       tempSelectedParent,
       folderTree,
       isUploading,
       triggerFileSelect,
       selectFilesForUpload,
       triggerFolderUploadInput,
       selectUploadParent,
       confirmFolderSelection,
       cancelUpload,
       confirmUploadAndAddContext,
       // New Methods exposed to template
       folderSelectorExpanded,
       openFolderSelector,
       toggleFolderSelectorExpand,
       getFolderPath,
       handleSelectorCreateFolder
    }
  }
}
</script>

<style scoped>
.chat-interface {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  max-width: 100%;
  background: #f8f9fa;
  position: relative;
  overflow: hidden; /* Prevent children from overflowing */
  box-sizing: border-box;
}

.chat-header {
  height: 36px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  background: #f8f9fa;
  flex-shrink: 0;
}

.header-left .project-name-display {
  font-weight: 600;
  color: #333;
}

.header-actions {
  display: flex;
  gap: 12px;
  position: relative;
}

/* Wrapper for icon buttons that have dropdowns - prevents layout shift */
.icon-btn-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.icon-btn {
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background 0.15s ease;
}
.icon-btn .btn-icon {
  width: 15px;
  height: 15px;
  display: block;
  object-fit: contain;
}
.icon-btn .btn-icon.hover {
  display: none;
}
.icon-btn:hover {
  background: rgba(26, 83, 54, 0.08);
}
.icon-btn:hover .btn-icon.default {
  display: none;
}
.icon-btn:hover .btn-icon.hover {
  display: block;
}
/* Prevent layout shift when active */
.icon-btn.active {
  background: rgba(26, 83, 54, 0.12);
  border-radius: 6px;
}
.icon-btn.active .btn-icon.default {
  display: none;
}
.icon-btn.active .btn-icon.hover {
  display: block;
}
.icon-btn.mini {
  padding: 4px;
}
.icon-btn.mini .btn-icon {
  width: 14px;
  height: 14px;
}
/* File add button with border */
.icon-btn.file-add-btn {
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 3px;
}
.icon-btn.file-add-btn:hover {
  border-color: rgba(26, 83, 54, 0.4);
}

.message-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden; /* Prevent horizontal overflow */
  padding: 16px;
  min-width: 0; /* Allow flex shrinking */
  width: 100%;
  box-sizing: border-box;
}

.message-list-content {
  padding-bottom: 20px;
  max-width: 100%; /* Use full available width */
  width: 100%;
  box-sizing: border-box;
  min-width: 0; /* Allow flex shrinking */
  overflow: hidden; /* Prevent children from overflowing */
}

.message-row {
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden; /* Prevent children from overflowing */
}

.message-row.user {
  align-items: flex-end;
}

.user-bubble {
  background: #E8F3ED; /* KingIDE品牌色 Lightest */
  padding: 8px 12px;
  border-radius: 6px 6px 0 6px;
  max-width: 80%;
  color: #2C3338; /* Gray-Dark for text */
  font-size: 13px;
  line-height: 1.5;
  box-shadow: none;
  border: 1px solid #d4e5dc;
  word-wrap: break-word;
  overflow-wrap: break-word;
  box-sizing: border-box;
  user-select: text;
  -webkit-user-select: text;
}

.assistant-root-wrapper {
  width: 100%;
  max-width: 100%; /* Use full available width */
  min-width: 0; /* Critical: Allow flex shrinking */
  box-sizing: border-box;
  overflow: hidden; /* Prevent children from overflowing */
  user-select: text; /* Allow text selection for copying */
  -webkit-user-select: text;
}

.bubble-timestamp {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
}
.user-bubble .bubble-timestamp { text-align: right; }

/* Empty State & Input Styles */
.empty-flow-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 24px 24px;
  overflow-y: auto;
  min-width: 0;
  box-sizing: border-box;
}

.empty-top-section {
  /* 黄金分割位：38.2% from top，进一步上移 */
  margin-top: calc(30vh - 80px);
  flex-shrink: 0;
  margin-bottom: 28px;
  text-align: center;
}

.empty-middle-section {
  width: 100%;
  max-width: 600px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.empty-bottom-section {
  width: 100%;
  max-width: 600px;
  flex-shrink: 0;
  margin-top: auto; /* Push to bottom */
  padding-top: 24px;
  box-sizing: border-box;
}

.welcome-text {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
  display: block;
}

.welcome-subtitle {
  font-size: 15px;
  font-weight: 400;
  color: #666;
  display: block;
}

.input-card {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  padding: 16px;
  width: 100%;
  box-sizing: border-box;
  box-shadow: 0 4px 20px rgba(0,0,0,0.05);
  position: relative;
}

/* Recent History Section - 紧凑专业样式 */
.recent-history-header {
  font-size: 12px;
  font-weight: 500;
  color: #888;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.recent-history {
  display: flex;
  flex-direction: column;
  gap: 0; /* 无间距 */
  border: 1px solid #e5e7eb;
  border-radius: 4px; /* 减小圆角 */
  overflow: hidden;
  background: #fff;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #ffffff;
  border-bottom: 1px solid #f0f0f0;
  border-radius: 0; /* 无圆角 */
  cursor: pointer;
  transition: background 0.15s ease;
  box-shadow: none;
}

.history-item:last-child {
  border-bottom: none;
}

.history-item:hover {
  background: #f8faf9;
}

.history-title {
  font-size: 13px;
  color: #2c3e50;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  text-align: left;
}

.history-time {
  font-size: 11px;
  color: #999;
  margin-left: 12px;
  flex-shrink: 0;
  text-align: right;
  min-width: 60px;
}

.history-empty-placeholder {
  font-size: 13px;
  color: #999;
  text-align: center;
  padding: 24px 0;
}

.history-disclaimer {
  font-size: 12px;
  color: #aaa;
  text-align: center;
  padding: 16px 0 0;
  margin-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.chat-input-rich {
  min-height: 60px;
  max-height: 200px;
  overflow-y: auto;
  outline: none;
  font-size: 15px;
  line-height: 1.5;
  color: #333;
}

.chat-input-rich:empty:before {
  content: attr(data-placeholder);
  color: #aaa;
}

.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.action-bar-left {
  display: flex;
  gap: 12px;
  align-items: center;
}

.model-selector {
  font-size: 13px;
  color: #666;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.15s ease;
}
.model-selector:hover {
  background: rgba(0, 0, 0, 0.05);
}

.dropdown-arrow {
  font-size: 8px;
  color: #999;
  transition: color 0.15s ease;
}
.model-selector:hover .dropdown-arrow {
  color: #666;
}

.model-dropdown {
  position: absolute;
  left: 0;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 200;
  min-width: 180px;
  max-height: 200px;
  overflow-y: auto;
  padding: 4px 0;
}

/* 向下展开 (新对话页面) */
.model-dropdown.down {
  top: calc(100% + 4px);
}

/* 向上展开 (对话中) */
.model-dropdown.up {
  bottom: calc(100% + 4px);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
  z-index: 1000;
  min-width: 240px;
  padding: 8px 0;
  margin-top: 4px;
}

/* Assistant Dropdown Panel - matches history drawer positioning */
.assistant-dropdown-panel {
  position: absolute;
  top: 36px; /* Exactly below header */
  left: 0;
  right: 0;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  max-height: 400px;
  overflow-y: auto;
  animation: slideDown 0.15s ease-out;
  border-radius: 0 0 8px 8px;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

.assistant-menu-header {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  background: #f8f9fa;
  border-bottom: 1px solid #f1f5f9;
}

.assistant-menu-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  border-bottom: 1px solid #f8f9fa;
  transition: all 0.15s ease;
}

.assistant-menu-item:hover {
  background: #f1f5f9;
}

.assistant-menu-item.active {
  background: rgba(26, 83, 54, 0.08);
  color: #1A5336;
  font-weight: 500;
}

.assistant-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes dropdownFadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.menu-label {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  background: #f8f9fa;
  border-bottom: 1px solid #f1f5f9;
}

.menu-item {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #334155;
  transition: all 0.15s ease;
  border-bottom: 1px solid #f8f9fa;
}
.menu-item:hover {
  background: #f1f5f9;
  color: #1A5336;
}
.menu-item.active {
  background: rgba(26, 83, 54, 0.08);
  color: #1A5336;
  font-weight: 500;
}

/* Menu item name (takes up flex space) */
.menu-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Setting icon wrapper with hover effect */
.setting-icon-wrapper {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s ease;
  flex-shrink: 0;
  margin-left: 8px;
}

.setting-icon-wrapper:hover {
  background: rgba(26, 83, 54, 0.08);
}

.setting-icon {
  width: 16px;
  height: 16px;
}

.setting-icon.hover {
  display: none;
}

.setting-icon-wrapper:hover .setting-icon.default {
  display: none;
}

.setting-icon-wrapper:hover .setting-icon.hover {
  display: block;
}

.dropdown-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  background: transparent;
}

.model-option {
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  transition: background 0.15s ease;
}
.model-option:hover {
  background: rgba(26, 83, 54, 0.08);
}
.model-option.active {
  color: #1A5336;
  font-weight: 500;
  background: rgba(26, 83, 54, 0.04);
}

.send-btn {
  background: #1A5336;
  color: #fff;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;
}
.send-btn:hover {
  background: #2D7A52;
}
.send-btn.disabled {
  background: #eee;
  color: #aaa;
  cursor: not-allowed;
}
.send-btn.disabled:hover {
  background: #eee;
}

.input-area-wrapper {
  padding: 16px 24px;
  background: #fff;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
  min-width: 0;
  box-sizing: border-box;
}

/* Context Files Styles */
.context-files-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.context-file-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #e8f4fd;
  border: 1px solid #bce0fd;
  border-radius: 14px;
  padding: 4px 8px 4px 6px;
  font-size: 12px;
  color: #1a73e8;
}

.context-file-icon {
  font-size: 12px;
}

.context-file-name {
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.context-file-remove {
  margin-left: 4px;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.context-file-remove:hover {
  color: #e53935;
}

/* =============================================
   King IDE Style - Input Image Preview 
   ============================================= */
.input-images-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
}

.preview-image-item {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(26, 83, 54, 0.15);
}

.preview-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 18px;
  height: 18px;
  background: linear-gradient(135deg, #1A5336 0%, #2D7A52 100%);
  color: #fff;
  border-radius: 50%;
  font-size: 12px;
  text-align: center;
  line-height: 18px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(26, 83, 54, 0.3);
  transition: all 0.15s ease;
}

.preview-remove:hover {
  background: linear-gradient(135deg, #2D7A52 0%, #1A5336 100%);
  transform: scale(1.1);
}

/* =============================================
   King IDE Style - Inline Context Tags (Input Box)
   Transparent background + border style
   ============================================= */
.chat-input-rich .context-tag-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  color: #1A5336;
  padding: 3px 8px;
  border-radius: 4px;
  margin: 0 4px 2px 0;
  font-size: 12px;
  font-weight: 500;
  vertical-align: middle;
  user-select: none;
  max-width: 160px;
  border: 1px solid rgba(26, 83, 54, 0.4);
  transition: all 0.15s ease;
}

.chat-input-rich .context-tag-inline:hover {
  background: rgba(26, 83, 54, 0.08);
  border-color: rgba(26, 83, 54, 0.6);
}

.chat-input-rich .tag-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 2px;
  filter: brightness(0.3);
}

.chat-input-rich .tag-at {
  color: #1A5336;
  font-weight: 600;
}

.chat-input-rich .tag-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100px;
  color: #1A5336;
}

/* =============================================
   King IDE Style - Inline Context Tags (User Bubble)
   Lighter/transparent background for visibility
   ============================================= */
.user-bubble .context-tag-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  color: #1A5336;
  padding: 3px 8px;
  border-radius: 4px;
  margin: 0 4px 2px 0;
  font-size: 12px;
  font-weight: 500;
  vertical-align: middle;
  user-select: none;
  max-width: 160px;
  border: 1px solid rgba(26, 83, 54, 0.4);
  transition: all 0.15s ease;
}

.user-bubble .tag-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 2px;
  /* Ensure icon is visible on light background */
  filter: brightness(0.2);
}

.user-bubble .tag-at {
  color: #1A5336;
  font-weight: 600;
}

.user-bubble .tag-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100px;
  color: #1A5336;
}

/* =============================================
   User Bubble - Image Thumbnails 
   ============================================= */
.user-bubble-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.bubble-image-thumb {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* Improve user bubble content display for inline tags */
.user-bubble-content {
  line-height: 1.5;
  word-wrap: break-word;
  overflow-wrap: break-word;
  font-size: 13px;
  white-space: pre-wrap; /* Preserve newlines and spaces */
}

/* Model dropdown mask overlay */
.dropdown-mask.model-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 199;
  background: transparent;
}

/* =============================================
   King IDE Style - Upload Dialog Styles
   ============================================= */
.king-dialog-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.king-dialog {
  width: 618px; /* Golden Ratio-ish Width */
  max-width: 90vw;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  animation: king-dialog-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.king-dialog * {
  box-sizing: border-box;
}

.king-dialog-large {
  width: 750px; /* Wider for Upload */
}

@keyframes king-dialog-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.king-dialog-header {
  padding: 24px 24px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid #f0f0f0;
}

.king-dialog-header .header-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Header with New Folder Button */
.folder-selector-header {
  flex-direction: row !important;
  justify-content: space-between;
  align-items: center;
}

.new-folder-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #1A5336;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.15s ease;
}

.new-folder-btn:hover {
  background: rgba(26, 83, 54, 0.08);
}

.new-folder-btn .btn-plus {
  font-size: 16px;
  font-weight: bold;
  line-height: 1;
}

.king-dialog-title {
  font-size: 20px;
  font-weight: 600;
  color: #1A5336; /* King Forest */
  line-height: 1.4;
  display: block;
}

.king-dialog-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: #6C757D;
  line-height: 1.5;
  display: block;
}

.king-dialog-body {
  padding: 0 24px 24px;
  flex: 1;
  min-height: 0;
  /* Add top padding for content separation */
  padding-top: 20px;
}

.king-dialog-body.scrollable-body {
  max-height: 400px;
  overflow-y: auto;
  padding-top: 0; /* Remove top padding for list */
}

.king-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: center; /* Centered as requested */
  gap: 16px;
  padding: 24px;
  background-color: transparent;
  flex-shrink: 0;
  border-top: 1px solid #f0f0f0;
}

.king-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  padding: 0 32px;
  font-size: 15px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 100px;
  border: none;
}

.king-btn:active {
  transform: translateY(1px);
}

.king-btn-primary {
  background-color: #1A5336; /* King Forest */
  color: #ffffff;
}
.king-btn-primary:hover {
  background-color: #16452d;
}

.king-btn-primary.disabled {
  opacity: 0.5;
  pointer-events: none;
  background-color: #1A5336; /* Maintain color but transparent */
}

.king-btn-secondary {
  background-color: #ffffff;
  color: #2C3338;
  border: 1px solid #E9ECEF;
}
.king-btn-secondary:hover {
  background-color: #F8F9FA;
  border-color: #DDE2E5;
}

.form-group {
  margin-bottom: 20px;
}
.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #2C3338;
  margin-bottom: 8px;
}

.king-field {
  background-color: #F8F9FA;
  border: 1px solid #E9ECEF;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  min-height: 48px;
  transition: all 0.15s ease;
  gap: 12px;
}

.king-field.clickable {
  cursor: pointer;
}

.king-field.clickable:hover {
  background-color: #E6F9F0;
  border-color: #5BD197;
}

.king-field .field-icon-img {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.king-field .field-value {
  font-size: 14px;
  color: #111827;
}

.king-field .field-placeholder {
  font-size: 14px;
  color: #9CA3AF;
}

.selected-files-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.selected-file-tag {
  font-size: 12px;
  background: white;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #E5E7EB;
  color: #374151;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Folder Tree in Dialog */
.folder-tree-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 2px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.folder-tree-item:hover {
  background-color: #F3F4F6;
}

.folder-tree-item.active {
  background-color: #E6F9F0;
  color: #1A5336;
}

.folder-tree-item .indent {
  flex-shrink: 0;
}

.tree-expand-icon-wrapper {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.tree-expand-icon-img {
  width: 10px;
  height: 10px;
}

.folder-icon-img {
  width: 18px;
  height: 18px;
  transition: transform 0.2s;
  flex-shrink: 0;
}
.folder-icon-img.is-opened {
  transform: scale(1.2);
}

.folder-name {
  margin-left: 8px;
  font-size: 14px;
  color: #333;
}

.empty-tip {
  text-align: center;
  color: #999;
  font-size: 13px;
  padding: 20px 0;
}
</style>
