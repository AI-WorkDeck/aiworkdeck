<template>
  <scroll-view scroll-y class="easy-voice-pane">
    <!-- Text Input Section -->
    <view class="section no-border">
      <view class="section-header">
        <text class="section-title">文本内容</text>
        <view class="section-actions">
           <view class="mini-btn" @tap="importFromDoc" title="从当前文档导入">
             <text>📄 导入</text>
           </view>
           <view class="mini-btn" @tap="text = ''" title="清空">
             <text>🗑️</text>
           </view>
        </view>
      </view>
      <textarea
        class="king-textarea"
        v-model="text"
        placeholder="在此输入要转换的文本..."
        maxlength="-1"
      />
    </view>

    <!-- Settings Section -->
    <view class="section no-border">
      <text class="section-title">语音设置</text>
      
      <!-- Voice Selection (Custom Dropdown) -->
      <view class="form-item relative">
        <text class="label">说话人</text>
        
        <view class="king-select-trigger" @tap="toggleVoiceDropdown">
          <view class="selected-text">
             <text v-if="selectedVoiceLabel">{{ selectedVoiceLabel }}</text>
             <text v-else class="placeholder">选择语音...</text>
          </view>
          <text class="select-arrow">▼</text>
        </view>

        <!-- Dropdown Drawer -->
        <view v-if="showVoiceDropdown" class="voice-dropdown" @tap.stop>
           <view class="voice-search-box">
              <input 
                v-model="voiceSearch" 
                class="voice-search-input" 
                placeholder="搜索语音..." 
                :focus="true"
              />
           </view>
           <scroll-view scroll-y class="voice-list-scroll">
              <view 
                 v-for="voice in filteredVoices" 
                 :key="voice.name" 
                 class="voice-option"
                 :class="{ active: selectedVoice === voice.name }"
                 @tap="selectVoice(voice)"
              >
                 <view class="voice-info-row">
                    <text class="voice-name-text">{{ voice.name }}</text>
                    <text class="voice-gender-tag">{{ voice.gender }}</text>
                 </view>
                 <text class="voice-locale-text">{{ voice.locale }}</text>
              </view>
              <view v-if="filteredVoices.length === 0" class="empty-tip">
                 无匹配语音
              </view>
           </scroll-view>
        </view>
        <view v-if="showVoiceDropdown" class="dropdown-mask" @tap="showVoiceDropdown = false"></view>
      </view>

      <!-- Rate -->
      <view class="form-item">
        <view class="slider-header">
           <text class="label">语速</text>
           <text class="value-text">{{ rate }}%</text>
        </view>
        <slider 
          :value="rate" 
          @change="onRateChange" 
          min="-50" 
          max="50" 
          show-value 
          block-size="12"
          activeColor="#1A5336"
          backgroundColor="#e5e7eb"
          block-color="#1A5336"
        />
      </view>

      <!-- Pitch -->
      <view class="form-item">
        <view class="slider-header">
           <text class="label">语调</text>
           <text class="value-text">{{ pitch }}Hz</text>
        </view>
        <slider 
          :value="pitch" 
          @change="onPitchChange" 
          min="-50" 
          max="50" 
          show-value 
          block-size="12"
          activeColor="#1A5336"
          backgroundColor="#e5e7eb"
          block-color="#1A5336"
        />
      </view>
      
      <!-- Volume -->
       <view class="form-item">
        <view class="slider-header">
           <text class="label">音量</text>
           <text class="value-text">{{ volume }}%</text>
        </view>
         <slider 
          :value="volume" 
          @change="onVolumeChange" 
          min="-50" 
          max="50" 
          show-value 
          block-size="12"
          activeColor="#1A5336"
          backgroundColor="#e5e7eb"
          block-color="#1A5336"
        />
      </view>
    </view>

    <!-- Generate Action -->
    <view class="action-area">
      <button 
        class="king-btn king-btn-primary full-width" 
        @tap="handleGenerate"
        :disabled="generating || !text"
        :loading="generating"
      >
        {{ generating ? '生成中...' : '开始生成' }}
      </button>
    </view>

    <!-- Result Area -->
    <view v-if="audioUrl" class="section no-border result-area">
      <view class="result-header">
         <text class="result-title">生成结果</text>
         <text class="download-link" @tap="downloadAudio">⬇️ 下载</text>
      </view>
      
      <!-- Custom Audio Player -->
      <view class="custom-player" :class="{ playing: isPlaying }">
          <view class="play-btn" @tap="togglePlay">
              <text class="play-icon">{{ isPlaying ? '⏸' : '▶' }}</text>
          </view>
          <view class="player-info">
              <text class="player-status">{{ isPlaying ? '正在播放...' : '点击播放试听' }}</text>
          </view>
      </view>
    </view>
    
  </scroll-view>
</template>

<script>
import { getTtsVoices, generateTtsAudio } from '@/services/api.js'

export default {
  name: 'EasyVoicePane',
  data() {
    return {
      text: '',
      voices: [],
      selectedVoice: '',
      voiceSearch: '',
      showVoiceDropdown: false,
      rate: 0,
      pitch: 0,
      volume: 0,
      generating: false,
      audioUrl: '',
      audioInstance: null,
      isPlaying: false
    }
  },
  computed: {
    selectedVoiceLabel() {
        const v = this.voices.find(v => v.name === this.selectedVoice)
        return v ? `${v.name} (${v.gender})` : ''
    },
    filteredVoices() {
       if (!this.voiceSearch) return this.voices
       const q = this.voiceSearch.toLowerCase()
       return this.voices.filter(v => 
          v.name.toLowerCase().includes(q) || 
          v.locale.toLowerCase().includes(q) ||
          v.gender.toLowerCase().includes(q)
       )
    }
  },
  mounted() {
    this.fetchVoices()
  },
  beforeUnmount() {
    this.stopAudio()
  },
  methods: {
    stopAudio() {
        if (this.audioInstance) {
            this.audioInstance.pause()
            this.audioInstance = null
            this.isPlaying = false
        }
    },
    togglePlay() {
        if (!this.audioUrl) return
        
        if (!this.audioInstance) {
            this.audioInstance = new Audio(this.audioUrl)
            this.audioInstance.onended = () => {
                this.isPlaying = false
            }
            this.audioInstance.onpause = () => {
                this.isPlaying = false
            }
            this.audioInstance.onplay = () => {
                this.isPlaying = true
            }
             this.audioInstance.onerror = (e) => {
                console.error('Audio playback error', e)
                this.isPlaying = false
                uni.showToast({ title: '播放失败', icon: 'none' })
            }
        }
        
        if (this.isPlaying) {
            this.audioInstance.pause()
        } else {
            this.audioInstance.play().catch(e => {
                console.error('Play failed', e)
                uni.showToast({ title: '无法播放', icon: 'none' })
            })
        }
    },
    toggleVoiceDropdown() {
       this.showVoiceDropdown = !this.showVoiceDropdown
       if (this.showVoiceDropdown) {
          this.voiceSearch = ''
       }
    },
    selectVoice(voice) {
       this.selectedVoice = voice.name
       this.showVoiceDropdown = false
    },
    async fetchVoices() {
      try {
        console.log('[EasyVoicePane] Fetching voices...')
        const res = await getTtsVoices()
        console.log('[EasyVoicePane] Voices response:', res)
        
        if (res && Array.isArray(res)) {
            this.voices = res
            // Default to a Chinese voice if available, else first
            const defaultVoice = this.voices.find(v => v.name.includes('Xiaoxiao') || v.locale.includes('zh')) || this.voices[0]
            if (defaultVoice) {
                this.selectedVoice = defaultVoice.name
            }
        } else {
            console.warn('[EasyVoicePane] Invalid voices response format', res)
        }
      } catch (e) {
        console.error('[EasyVoicePane] Failed to load voices', e)
        uni.showToast({ title: '加载语音列表失败', icon: 'none' })
      }
    },
    onRateChange(e) {
      this.rate = e.detail.value
    },
    onPitchChange(e) {
      this.pitch = e.detail.value
    },
    onVolumeChange(e) {
        this.volume = e.detail.value
    },
    async importFromDoc() {
        const callback = (content) => {
            if (content) {
                this.text = content;
                uni.showToast({ title: '已导入文档内容', icon: 'success' })
            } else {
                 uni.showToast({ title: '无法获取文档内容', icon: 'none' })
            }
        };
        // Keep global emit for potential other listeners
        uni.$emit('easyvoice-request-doc-text', callback);
        this.$emit('request-doc-text', callback);
    },
    async handleGenerate() {
      if (!this.text) return
      this.generating = true
      this.stopAudio() 
      
      try {
        const payload = {
            text: this.text,
            voice: this.selectedVoice,
            rate: this.rate != 0 ? (this.rate > 0 ? `+${this.rate}%` : `${this.rate}%`) : '+0%',
            pitch: this.pitch != 0 ? (this.pitch > 0 ? `+${this.pitch}Hz` : `${this.pitch}Hz`) : '+0Hz',
            volume: this.volume != 0 ? (this.volume > 0 ? `+${this.volume}%` : `${this.volume}%`) : '+0%'
        }
        
        console.log('[EasyVoicePane] Generating with payload:', payload)
        const audioBuffer = await generateTtsAudio(payload)
        console.log('[EasyVoicePane] Generated audio buffer size:', audioBuffer.byteLength)
        
        const blob = new Blob([audioBuffer], { type: 'audio/mpeg' })
        if (this.audioUrl) {
            URL.revokeObjectURL(this.audioUrl)
        }
        this.audioUrl = URL.createObjectURL(blob)
        
        this.$nextTick(() => {
             this.togglePlay()
        })

      } catch (e) {
        console.error('[EasyVoicePane] Generation failed', e)
        uni.showToast({ title: '生成失败', icon: 'none' })
      } finally {
        this.generating = false
      }
    },
    downloadAudio() {
        if (!this.audioUrl) return
        const a = document.createElement('a')
        a.href = this.audioUrl
        a.download = `voice_${Date.now()}.mp3`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }
  }
}
</script>

<style scoped>
.easy-voice-pane {
  height: 100%;
  background-color: #f9fafb;
  padding: 16px;
  box-sizing: border-box;
}

.section {
  margin-bottom: 24px;
  background: #fff; /* Keep background but remove border */
  padding: 0; /* Remove internal padding if using 'gap' approach, or keep it */
  padding: 12px;
  border-radius: 8px;
  /* border: 1px solid #e5e7eb; REMOVED border */
}

/* Optional: Add a subtle shadow instead of border, or just keep it flat as per "compact" request */
.section.no-border {
    border: none;
    box-shadow: none; /* Make it very clean */
    background: transparent; /* Or #fff if we want card style without border */
    background: #fff;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-actions {
    display: flex;
    gap: 8px;
}

.mini-btn {
    padding: 3px 8px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    color: #4b5563;
    transition: all 0.2s;
}
.mini-btn:hover {
    background: #f3f4f6;
    border-color: #d1d5db;
}

.king-textarea {
  width: 100%;
  height: 140px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  box-sizing: border-box;
  background: #ffffff;
  resize: none;
  transition: border-color 0.2s;
}
.king-textarea:focus {
    border-color: #1A5336;
    outline: none;
}

.form-item {
  margin-bottom: 20px;
}
.form-item.relative {
    position: relative;
}

.label {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
  display: block;
  font-weight: 500;
}

/* Custom Select Trigger */
.king-select-trigger {
    width: 100%;
    height: 40px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #fff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px;
    box-sizing: border-box;
    cursor: pointer;
    transition: all 0.2s;
}
.king-select-trigger:active {
    border-color: #1A5336;
}
.selected-text {
    font-size: 14px;
    color: #111827;
}
.selected-text .placeholder {
    color: #9ca3af;
}
.select-arrow {
    font-size: 10px;
    color: #6b7280;
}

/* Dropdown Drawer */
.voice-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    z-index: 100;
    margin-top: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}
.dropdown-mask {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 90;
    background: transparent;
}

.voice-search-box {
    padding: 8px;
    border-bottom: 1px solid #f3f4f6;
}
.voice-search-input {
    width: 100%;
    height: 32px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 0 8px;
    font-size: 13px;
    box-sizing: border-box;
}

.voice-list-scroll {
    max-height: 240px;
}

.voice-option {
    padding: 10px 12px;
    border-bottom: 1px solid #f9fafb;
    cursor: pointer;
    transition: background 0.15s;
}
.voice-option:last-child {
    border-bottom: none;
}
.voice-option:hover {
    background: #f3f4f6;
}
.voice-option.active {
    background: #effdf6;
}
.voice-option.active .voice-name-text {
    color: #1A5336;
    font-weight: 600;
}

.voice-info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
}
.voice-name-text {
    font-size: 14px;
    color: #1f2937;
}
.voice-gender-tag {
    font-size: 10px;
    background: #f3f4f6;
    padding: 1px 4px;
    border-radius: 4px;
    color: #6b7280;
}
.voice-locale-text {
    font-size: 11px;
    color: #9ca3af;
}
.empty-tip {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: #9ca3af;
}


/* Slider Section */
.slider-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
}
.value-text {
    font-size: 12px;
    color: #1A5336;
    font-weight: 500;
}

/* Action Area */
.action-area {
  margin-top: 8px;
  margin-bottom: 24px;
}

.king-btn {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 44px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  outline: none;
  box-shadow: 0 2px 4px rgba(26, 83, 54, 0.1);
  transition: all 0.2s;
}

.king-btn-primary {
  background-color: #1A5336;
  color: #fff;
}
.king-btn-primary:active {
  background-color: #14402a;
  transform: translateY(1px);
}
.king-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background-color: #9ca3af;
}

.full-width {
  width: 100%;
}

/* Result Area */
.result-area {
    background: #f0fdf4 !important; /* Mint background */
    border: 1px solid #bbf7d0 !important;
}

.result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.result-title {
    font-size: 13px;
    font-weight: 600;
    color: #14532d;
}

.download-link {
    font-size: 12px;
    color: #1A5336;
    cursor: pointer;
    font-weight: 500;
}

.custom-player {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #fff;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
}
.play-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #1A5336;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    cursor: pointer;
    transition: transform 0.2s;
    font-size: 14px;
}
.play-btn:active {
    transform: scale(0.95);
}
.player-info {
    flex: 1;
}
.player-status {
    font-size: 13px;
    color: #374151;
}
</style>
