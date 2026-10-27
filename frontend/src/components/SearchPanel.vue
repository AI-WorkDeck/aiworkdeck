<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="search-panel">
    <!-- Header Area -->
    <view class="search-header">
      <!-- 面板标题由外壳的 sidebar-header 出（此前这里是一行注释掉的 panel-title，
           属于「靠注释躲开重复标题」那一档写法，已按统一口径清掉） -->

      <!-- Search Input -->
      <view class="input-wrapper">
        <view class="input-box" :class="{ focused: isSearchFocused }">
          <view class="search-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--awd-text-2)" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </view>
          <input
            ref="searchInput"
            class="search-input"
            v-model="searchQuery"
            :placeholder="$t('files.searchPlaceholder')"
            @focus="isSearchFocused = true"
            @blur="isSearchFocused = false"
            @confirm="performSearch"
            @input="onSearchInput"
          />
          <view v-if="searchQuery" class="clear-icon" @tap="searchQuery = ''; performSearch()">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
             </svg>
          </view>
        </view>
      </view>

      <TagFilter
        :key="projectId"
        :tags="allProjectTags"
        :model-value="selectedTagIds"
        :counts="tagCounts"
        :loading="tagsLoading"
        :error="tagsError"
        @update:model-value="setTags"
        @retry="refreshTagsAndSearch"
      />

      <!-- Search Stats -->
      <view class="search-stats" v-if="hasSearched" role="status" aria-live="polite">
         <view v-if="loading" class="search-progress">
           <text>{{ $t(searchPhase === 'content' ? 'files.searchingContent' : 'files.searching') }}</text>
           <component :is="'button'" type="button" class="search-retry" @click.stop="stopWaiting()">{{ $t('files.searchStopWaiting') }}</component>
         </view>
         <view v-else-if="searchError" class="search-error" role="alert">
           <text>{{ searchError }}</text>
           <component :is="'button'" type="button" class="search-retry" @click.stop="performSearch()">{{ $t('files.archiveRetry') }}</component>
         </view>
         <text v-else-if="results.totalMatches === 0 && (!results.results || results.results.length === 0)">{{ $t('files.noResults') }}</text>
         <template v-else>
            <template v-if="searchedQuery.trim()">
              <text class="highlight">{{ results.totalMatches }}</text> {{ $t('files.matchesSuffix') }} ·
            </template>
            <text class="highlight">{{ results.totalFiles }}</text> {{ $t('files.filesSuffix') }}
         </template>
      </view>
    </view>

    <!-- Results List -->
    <scroll-view scroll-y class="results-list" v-if="results.results && results.results.length > 0">
      <view class="file-group" v-for="file in results.results" :key="file.fileId">
        <!-- File Header -->
        <view class="file-header" @tap.stop="onFileHeader(file)">
          <view class="arrow-icon" :class="{ expanded: !collapsedFiles[file.fileId], hidden: file.matchCount === 0 }">
             <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <polyline points="9 18 15 12 9 6"></polyline>
             </svg>
          </view>
          <view class="file-icon-wrapper">
             <FileTypeIcon :type="file.fileType" />
          </view>
          <view class="file-info">
             <text class="file-name" @tap.stop="openFile(file)">{{ file.fileName }}</text>
             <text class="file-path">{{ getRelativePath(file.filePath) }}</text>
             <view v-if="file.tags && file.tags.length" class="result-tags">
               <text v-for="tag in file.tags" :key="tag.id" class="result-tag" :title="tag.name">
                 <text class="result-tag-dot" :style="{ backgroundColor: tag.color || 'var(--awd-panel-text-2)' }"></text>
                 {{ tag.name }}
               </text>
             </view>
          </view>
          <view class="badge" v-if="file.matchCount > 0">{{ file.matchCount }}</view>
        </view>

        <!-- Matches -->
        <view class="matches-container" v-if="!collapsedFiles[file.fileId] && file.matchCount > 0">
          <view
            class="match-item"
            v-for="(match, idx) in file.matches"
            :key="idx"
            @tap="openMatch(file, match)"
          >
             <view class="indent-line"></view>
             <text class="line-number" v-if="match.lineNumber">{{ match.lineNumber }}</text>
             <text class="match-content">
                <text class="pre-match">{{ getPreMatch(match) }}</text>
                <text class="match-highlight">{{ getMatchText(match) }}</text>
                <text class="post-match">{{ getPostMatch(match) }}</text>
             </text>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- Empty State -->
    <view class="empty-state" v-if="!hasSearched && !loading">
       <view class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--awd-surface-3)" stroke-width="1.5">
             <circle cx="11" cy="11" r="8"></circle>
             <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
       </view>
       <text class="empty-text">{{ $t('files.searchAllFiles') }}</text>
    </view>
  </view>
</template>

<script>
import { searchProjectContent, getProjectTags } from '@/services/api'
import FileTypeIcon from '@/components/FileTypeIcon.vue'
import TagFilter from '@/components/TagFilter.vue'

// 输入停顿多久才发搜索（v0.49.0 BUG-12）
const SEARCH_DEBOUNCE_MS = 300

export default {
  name: 'SearchPanel',
  components: {
    FileTypeIcon,
    TagFilter
  },
  props: {
    projectId: {
      type: Number,
      required: true
    }
  },
  emits: ['open-file'],
  data() {
    return {
      searchQuery: '',
      searchedQuery: '',
      searchError: '',
      searchPhase: '',
      isComposing: false,
      isSearchFocused: false,
      loading: false,
      hasSearched: false,
      searchOptions: {
        caseSensitive: false,
        wholeWord: false,
        useRegex: false
      },
      results: {
        totalMatches: 0,
        totalFiles: 0,
        results: []
      },
      collapsedFiles: {},
      debounceTimer: null,
      allProjectTags: [],
      selectedTagIds: [],
      tagsLoading: false,
      tagsError: '',
      tagCounts: {}
    }
  },
  watch: {
    projectId() {
      this.resetProject()
      this.fetchTags()
    }
  },
  mounted() {
    this.fetchTags()
    uni.$on?.('awd:files-changed', this.onFilesChanged)
    // Uni's input event does not preserve native isComposing in every build.
    // Listen on its DOM root so intermediate pinyin never starts a full scan.
    const input = this.$refs?.searchInput
    this._compositionRoot = input?.$el || input
    const nativeInput = this._compositionRoot?.matches?.('input') ? this._compositionRoot : this._compositionRoot?.querySelector?.('input')
    nativeInput?.focus?.()
    this._compositionRoot?.addEventListener?.('compositionstart', this.onCompositionStart, true)
    this._compositionRoot?.addEventListener?.('compositionend', this.onCompositionEnd, true)
  },
  beforeUnmount() {
    this._unmounted = true
    this._searchSeq = (this._searchSeq || 0) + 1
    this._tagsSeq = (this._tagsSeq || 0) + 1
    uni.$off?.('awd:files-changed', this.onFilesChanged)
    this._compositionRoot?.removeEventListener?.('compositionstart', this.onCompositionStart, true)
    this._compositionRoot?.removeEventListener?.('compositionend', this.onCompositionEnd, true)
    // 面板关掉后不许再有待发的防抖或在途请求（后端还在为它逐个抽文件）
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    if (this._searchAbort) this._searchAbort.abort()
    this._searchAbort = null
  },
  methods: {
    resetProject() {
      this._searchSeq = (this._searchSeq || 0) + 1
      this._tagsSeq = (this._tagsSeq || 0) + 1
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = null
      if (this._searchAbort) this._searchAbort.abort()
      this._searchAbort = null
      this.searchQuery = ''
      this.searchedQuery = ''
      this.searchError = ''
      this.searchPhase = ''
      this.isComposing = false
      this.selectedTagIds = []
      this.allProjectTags = []
      this.tagCounts = {}
      this.tagsError = ''
      this.tagsLoading = false
      this.loading = false
      this.hasSearched = false
      this.results = { totalMatches: 0, totalFiles: 0, results: [] }
      this.collapsedFiles = {}
    },
    async fetchTags() {
      const seq = (this._tagsSeq = (this._tagsSeq || 0) + 1)
      const projectId = this.projectId
      this.tagsLoading = true
      this.tagsError = ''
      try {
        const tags = await getProjectTags(projectId)
        if (seq !== this._tagsSeq || this._unmounted || projectId !== this.projectId) return false
        this.allProjectTags = tags || []
        const existingIds = new Set(this.allProjectTags.map(tag => String(tag.id)))
        this.selectedTagIds = this.selectedTagIds.filter(id => existingIds.has(String(id)))
      } catch (e) {
        if (seq !== this._tagsSeq || this._unmounted || projectId !== this.projectId) return false
        this.tagsError = this.$t('files.tagLoadFailed')
      } finally {
        if (seq === this._tagsSeq && !this._unmounted) this.tagsLoading = false
      }
      return true
    },
    async onFilesChanged(event) {
      if (String(event?.projectId) !== String(this.projectId)) return
      await this.refreshTagsAndSearch()
    },
    async refreshTagsAndSearch() {
      const fresh = await this.fetchTags()
      if (fresh && (this.hasSearched || this.searchQuery.trim() || this.selectedTagIds.length)) {
        this.performSearch()
      }
    },
    setTags(ids) {
      this.selectedTagIds = ids
      this.performSearch()
    },
    updateTagCounts(fileResults) {
      const counts = {}
      for (const file of fileResults || []) {
        for (const tag of file.tags || []) counts[tag.id] = (counts[tag.id] || 0) + 1
      }
      this.tagCounts = counts
    },
    onCompositionStart() {
      this.isComposing = true
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    },
    onCompositionEnd(event) {
      this.isComposing = false
      if (typeof event?.target?.value === 'string') this.searchQuery = event.target.value
      this.onSearchInput()
    },
    onSearchInput(event) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = null
      if (this.isComposing || event?.isComposing) return
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        this.performSearch(true)
      }, SEARCH_DEBOUNCE_MS)
    },
    toggleOption(option) {
      this.searchOptions[option] = !this.searchOptions[option]
      if (this.searchQuery) {
        this.performSearch()
      }
    },
    async performSearch(syncInput = false) {
      if (this.isComposing) return
      // Uni batches v-model updates. Read the native value when the debounced
      // query actually runs, so a fast paste/type is searched in full.
      const root = this.$refs?.searchInput?.$el || this.$refs?.searchInput
      const native = root?.matches?.('input') ? root : root?.querySelector?.('input')
      if (syncInput && native && typeof native.value === 'string') this.searchQuery = native.value
      // 回车/点标签/清空都会直接调到这里：撤掉还没到点的防抖，免得同一次输入再发一遍
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = null
      // 竞态防护：快速连点标签/选项会并发多次搜索，只让最新一次的结果落地
      const seq = (this._searchSeq = (this._searchSeq || 0) + 1)
      // 旧请求不只是丢结果，还要真的断开（v0.49.0 BUG-12：否则连续输入在后端叠成长队）
      if (this._searchAbort) this._searchAbort.abort()
      this._searchAbort = null
      this.results = { totalMatches: 0, totalFiles: 0, results: [] }
      this.tagCounts = {}
      this.searchError = ''
      this.searchPhase = ''
      this.loading = false
      if (!this.searchQuery.trim() && !this.selectedTagIds.length) {
        this.hasSearched = false
        this.searchedQuery = ''
        return
      }
      this.loading = true
      this.hasSearched = true
      const controller = (this._searchAbort = new AbortController())
      const query = this.searchQuery
      this.searchedQuery = query
      const payload = { query, ...this.searchOptions, tagIds: [...this.selectedTagIds] }

      try {
        if (query.trim()) {
          this.searchPhase = 'names'
          const names = await searchProjectContent(this.projectId, { ...payload, filenameOnly: true }, { signal: controller.signal })
          if (seq !== this._searchSeq || controller.signal.aborted) return
          this.results = names
          this.updateTagCounts(names.results)
          this.collapsedFiles = {}
          this.searchPhase = 'content'
        }
        const response = await searchProjectContent(this.projectId, payload, { signal: controller.signal })

        if (seq !== this._searchSeq) return // 已有更新的搜索发起，丢弃本次陈旧结果

        this.results = response
        this.searchedQuery = query
        // Counts only affect ordering; every project tag remains available for changing filters.
        this.updateTagCounts(response.results)

        // Expand all by default
        this.collapsedFiles = {}
      } catch (e) {
        // 被新查询/清空/卸载主动取消的请求不是失败：不打日志、不弹提示
        if (controller.signal.aborted) return
        console.error('Search failed:', e)
        // 失败提示同样按 seq 收口：陈旧请求的迟到失败不该盖在新结果上弹「搜索失败」
        if (seq === this._searchSeq) {
          this.searchError = this.$t(this.searchPhase === 'content' ? 'files.searchContentFailed' : 'files.searchFailed')
          uni.showToast({ title: this.searchError, icon: 'none' })
        }
      } finally {
        if (seq === this._searchSeq) {
          this.loading = false
          this._searchAbort = null
        }
      }
    },
    stopWaiting() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = null
      this._searchSeq = (this._searchSeq || 0) + 1
      this._searchAbort?.abort()
      this._searchAbort = null
      this.loading = false
      this.searchError = this.$t(this.searchPhase === 'content' ? 'files.searchContentStopped' : 'files.searchStopped')
    },
    refreshSearch() {
      this.performSearch()
    },
    collapseAll() {
       const newCollapsed = {}
       if (this.results.results) {
         this.results.results.forEach(f => {
           newCollapsed[f.fileId] = true
         })
       }
       this.collapsedFiles = newCollapsed
    },
    onFileHeader(file) {
      if (!this.searchedQuery.trim() || !file.matchCount) this.openFile(file)
      else this.toggleFile(file.fileId)
    },
    toggleFile(fileId) {
      this.collapsedFiles[fileId] = !this.collapsedFiles[fileId]
    },
    openFile(file) {
      this.$emit('open-file', {
        id: file.fileId,
        wpsFileId: file.wpsFileId,
        name: file.fileName,
        fileType: file.fileType,
        filePath: file.filePath
      })
    },
    openMatch(file, match) {
      this.$emit('open-file', {
        id: file.fileId,
        wpsFileId: file.wpsFileId,
        name: file.fileName,
        fileType: file.fileType,
        filePath: file.filePath,
        position: {
           lineNumber: match.lineNumber,
           startIndex: match.startIndex,
           endIndex: match.endIndex
        }
      })
    },
    getRelativePath(path) {
        if (!path) return ''
        const parts = path.split('/')
        if (parts.length > 2) {
            return '.../' + parts[parts.length - 2]
        }
        return ''
    },
    getPreMatch(match) {
        if (!match.content) return ''
        return match.content.substring(0, match.startIndex)
    },
    getMatchText(match) {
        if (!match.content) return ''
        return match.content.substring(match.startIndex, match.endIndex)
    },
    getPostMatch(match) {
        if (!match.content) return ''
        return match.content.substring(match.endIndex)
    }
  }
}
</script>

<style lang="scss" scoped>
/* Brands Colors from color.md */
$brand-mint: var(--awd-mint);

.search-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background-color: var(--awd-surface);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

/* 密度令牌见 App.vue 的 --awd-panel-*（基准 = 插件广场） */
.search-header {
    flex-shrink: 0;
    padding: var(--awd-panel-gap) 0 var(--awd-panel-gap);
    background-color: var(--awd-bg);
    border-bottom: 1px solid transparent; /* Prepare for sticky behavior if needed */
}

.input-wrapper {
  position: relative;
  margin: 0 var(--awd-panel-pad-x) var(--awd-panel-gap);

  .input-box {
    display: flex;
    align-items: center;
    min-height: var(--awd-control-height);
    background: var(--awd-surface);
    border: 1px solid var(--awd-panel-border);
    border-radius: var(--awd-panel-radius);
    padding: 0 8px;
    transition: all 0.2s ease;
    box-shadow: var(--awd-shadow-sm);

    &.focused {
      border-color: var(--awd-accent-text);
      box-shadow: var(--awd-shadow-sm);
    }

    .search-icon {
        margin-right: 8px;
        display: flex;
        align-items: center;
    }

    .search-input {
      flex: 1;
      font-size: var(--awd-panel-fs);
      color: var(--awd-text);
      border: none;
      outline: none;
      background: transparent;
      height: 20px;
      min-width: 0;

      &::placeholder {
          color: var(--awd-text-2);
      }
    }

    .clear-icon {
        padding: var(--awd-space-1);
        cursor: pointer;
        display: flex;
        align-items: center;
        opacity: 0.6;
        &:hover { opacity: 1; }
    }
  }
}

.search-stats {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
  padding: 0 var(--awd-panel-pad-x);
  display: flex;
  align-items: center;
  gap: var(--awd-space-1);

  .highlight {
      color: var(--awd-accent-text);
      font-weight: 600;
  }
}

.search-progress,
.search-error {
  display: flex;
  align-items: center;
  gap: var(--awd-panel-gap);
  min-width: 0;
  width: 100%;
}

.search-error { color: var(--awd-danger-text); }
.search-progress > text,
.search-error > text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.search-retry {
  flex-shrink: 0;
  margin: 0;
  padding: 0 var(--awd-space-1);
  min-height: var(--awd-control-height);
  border: 0;
  border-radius: var(--awd-panel-radius);
  background: transparent;
  color: var(--awd-accent-text);
  font-size: var(--awd-panel-fs);
  cursor: pointer;
}
.search-retry:focus-visible {
  outline: var(--awd-focus-width) solid var(--awd-accent-text);
  outline-offset: var(--awd-focus-offset);
}

.results-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 20px;
}

.file-group {
    background: var(--awd-surface);
    margin-bottom: 8px;
    border-top: 1px solid transparent;
    border-bottom: 1px solid transparent;

    &:first-child {
        border-top: 1px solid var(--awd-border);
    }
    &:last-child {
        border-bottom: 1px solid var(--awd-border);
    }
}

.file-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background-color 0.1s;

  &:hover {
    background-color: var(--awd-bg);
  }

  .arrow-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--awd-text-2);
    margin-right: 8px;
    width: 16px;
    height: 16px;
    transition: transform 0.2s;

    &.expanded {
      transform: rotate(-90deg);
    }

    &.hidden {
        display: none;
    }
  }

  .file-icon-wrapper {
      margin-right: 10px;
      display: flex;
      align-items: center;
  }

  .file-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;

      .file-name {
          font-size: var(--awd-font-size-body);
          font-weight: 500;
          color: var(--awd-text);
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;

          &:hover {
              color: var(--awd-accent-text);
              text-decoration: underline;
          }
      }

      .file-path {
          font-size: var(--awd-panel-fs-meta);
          color: var(--awd-text-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
      }
  }

  .badge {
    background-color: var(--awd-surface-3);
    color: var(--awd-text-2);
    font-size: var(--awd-panel-fs-meta);
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 99px;
    min-width: 16px;
    text-align: center;
    margin-left: 8px;
  }
}

.result-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--awd-space-1);
  margin-top: var(--awd-space-1);
  max-height: 44px;
  overflow: hidden;
}

.result-tag {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border: 1px solid var(--awd-panel-border);
  border-radius: var(--awd-radius-sm);
  padding: 0 var(--awd-space-1);
  font-size: var(--awd-panel-fs-meta);
  line-height: 18px;
  color: var(--awd-panel-text-2);
}

.result-tag-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 2px;
}

.matches-container {
    padding-bottom: 8px;
}

.match-item {
  display: flex;
  padding: 4px 12px 4px 30px; /* Indented alignment */
  cursor: pointer;
  position: relative;
  font-family: "JetBrains Mono", Menlo, Monaco, Consolas, monospace;

  &:hover {
    background-color: var(--awd-accent-wash);
    .match-highlight {
        background-color: var(--awd-accent-soft);
    }
  }

  .indent-line {
      position: absolute;
      left: 18px; /* Align with file icon center roughly */
      top: 0;
      bottom: 0;
      width: 1px;
      background-color: var(--awd-surface-3);
  }

  .line-number {
      font-size: var(--awd-panel-fs-meta);
      color: var(--awd-text-2);
      width: 10px;
      text-align: right;
      margin-right: 12px;
      flex-shrink: 0;
  }

  .match-content {
     font-size: var(--awd-panel-fs-meta);
     line-height: 1.5;
     color: var(--awd-text-2);
     white-space: pre;
     overflow: hidden;
     text-overflow: ellipsis;

     .match-highlight {
         background-color: var(--awd-accent-soft);
         color: var(--awd-accent-text);
         border-radius: calc(var(--awd-space-1) / 2);
         padding: 0 1px;
         font-weight: 500;
     }
  }
}

.empty-state {
   display: flex;
   flex-direction: column;
   align-items: center;
   justify-content: center;
   padding: 60px 20px;

   .empty-icon {
       margin-bottom: 16px;
       color: var(--awd-info-text);
   }

   .empty-text {
      color: var(--awd-text-2);
      font-size: var(--awd-font-size-body);
   }
}
</style>
