<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div
    ref="rootEl"
    class="awd-lang-picker"
    :class="{
      'is-compact': compact,
      'is-open': open,
      'align-end': align === 'end',
      'placement-top': placement === 'top',
    }"
  >
    <component
      :is="'button'"
      ref="triggerEl"
      type="button"
      class="awd-lang-trigger"
      :aria-label="$t('common.languagePickerLabel')"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="listbox"
      @click.stop="toggleOpen"
      @keydown="onTriggerKeydown"
    >
      <svg class="awd-lang-globe" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span class="awd-lang-current">{{ triggerLabel }}</span>
      <svg class="awd-lang-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </component>

    <div
      v-if="open"
      class="awd-lang-dropdown"
      role="listbox"
      :aria-label="$t('common.languagePickerLabel')"
      @keydown="onDropdownKeydown"
    >
      <div class="awd-lang-search-wrap">
        <component
          :is="'input'"
          ref="searchInputEl"
          type="text"
          class="awd-lang-search-input"
          :value="searchQuery"
          :placeholder="$t('common.languageSearchPlaceholder')"
          @input="searchQuery = $event.target.value"
          @keydown.stop="onSearchKeydown"
        />
      </div>

      <div ref="listEl" class="awd-lang-list">
        <component
          :is="'button'"
          v-for="(opt, idx) in filteredOptions"
          :key="opt.value"
          type="button"
          role="option"
          class="awd-lang-option"
          :class="{
            'is-selected': isOptionSelected(opt),
            'is-active': idx === activeIndex,
            'is-system': opt.isSystem,
          }"
          :aria-selected="isOptionSelected(opt) ? 'true' : 'false'"
          :dir="opt.dir || 'ltr'"
          @mouseenter="activeIndex = idx"
          @click.stop="selectOption(opt.value)"
        >
          <span class="awd-lang-opt-main">
            <span class="awd-lang-opt-native">{{ opt.label }}</span>
            <span v-if="opt.sublabel" class="awd-lang-opt-sub">{{ opt.sublabel }}</span>
          </span>
          <span class="awd-lang-opt-right">
            <span v-if="opt.badge" class="awd-lang-opt-badge">{{ opt.badge }}</span>
            <span class="awd-lang-opt-check" aria-hidden="true">{{ isOptionSelected(opt) ? '✓' : '' }}</span>
          </span>
        </component>

        <div v-if="!filteredOptions.length" class="awd-lang-empty">
          {{ $t('common.languageNoMatch') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {
  LOCALE_REGISTRY,
  SYSTEM_LANGUAGE_MODE,
  APP_LANGUAGE_EVENT,
  getAppLanguage,
  getAppLanguagePreference,
  getLocaleEntry,
  setAppLanguage,
} from '@/utils/appLanguage.js'
import { applyI18nLocale } from '@/i18n/index.js'

export default {
  name: 'LanguagePicker',
  props: {
    modelValue: { type: String, default: '' },
    compact: { type: Boolean, default: false },
    align: { type: String, default: 'start' },
    placement: { type: String, default: 'bottom' },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return {
      open: false,
      searchQuery: '',
      activeIndex: 0,
      preference: getAppLanguagePreference(),
      resolvedLang: getAppLanguage(),
      onDocMouseDown: null,
      onLangEvent: null,
    }
  },
  computed: {
    currentEntry() {
      const code = this.modelValue
        ? (this.modelValue === SYSTEM_LANGUAGE_MODE ? this.resolvedLang : this.modelValue)
        : this.resolvedLang
      return getLocaleEntry(code)
    },
    effectivePreference() {
      return this.modelValue || this.preference
    },
    triggerLabel() {
      const entry = this.currentEntry
      if (!this.compact && this.effectivePreference === SYSTEM_LANGUAGE_MODE) {
        return `${this.$t('common.languageFollowSystem')} · ${entry.nativeName}`
      }
      return entry.nativeName
    },
    allOptions() {
      const sysEntry = getLocaleEntry(this.resolvedLang)
      const systemOption = {
        value: SYSTEM_LANGUAGE_MODE,
        label: this.$t('common.languageFollowSystem'),
        sublabel: sysEntry.nativeName,
        badge: sysEntry.shortBadge,
        dir: 'ltr',
        isSystem: true,
        searchTerms: `${this.$t('common.languageFollowSystem')} system auto ${sysEntry.nativeName} ${sysEntry.englishName}`.toLowerCase(),
      }
      const localeOptions = LOCALE_REGISTRY.map((entry) => ({
        value: entry.code,
        label: entry.nativeName,
        sublabel: entry.englishName !== entry.nativeName ? entry.englishName : '',
        badge: entry.shortBadge,
        dir: entry.dir,
        isSystem: false,
        searchTerms: `${entry.nativeName} ${entry.englishName} ${entry.code} ${entry.slug} ${entry.shortBadge}`.toLowerCase(),
      }))
      return [systemOption, ...localeOptions]
    },
    filteredOptions() {
      const q = String(this.searchQuery || '').trim().toLowerCase()
      if (!q) return this.allOptions
      return this.allOptions.filter((opt) => opt.searchTerms.includes(q))
    },
  },
  watch: {
    searchQuery() {
      this.activeIndex = 0
    },
  },
  mounted() {
    this.onDocMouseDown = (e) => {
      if (!this.open) return
      const root = this.$refs.rootEl
      if (root && !root.contains(e.target)) {
        this.closeDropdown()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', this.onDocMouseDown)
    }
    this.onLangEvent = (resolved) => {
      this.resolvedLang = resolved || getAppLanguage()
      this.preference = getAppLanguagePreference()
    }
    try {
      if (typeof uni !== 'undefined' && typeof uni.$on === 'function') {
        uni.$on(APP_LANGUAGE_EVENT, this.onLangEvent)
      }
    } catch (e) { /* ignore */ }
  },
  beforeUnmount() {
    if (typeof document !== 'undefined' && this.onDocMouseDown) {
      document.removeEventListener('mousedown', this.onDocMouseDown)
    }
    try {
      if (typeof uni !== 'undefined' && typeof uni.$off === 'function' && this.onLangEvent) {
        uni.$off(APP_LANGUAGE_EVENT, this.onLangEvent)
      }
    } catch (e) { /* ignore */ }
  },
  methods: {
    isOptionSelected(opt) {
      if (this.effectivePreference === SYSTEM_LANGUAGE_MODE) {
        return opt.value === SYSTEM_LANGUAGE_MODE
      }
      return opt.value === this.currentEntry.code
    },
    toggleOpen() {
      if (this.open) {
        this.closeDropdown()
      } else {
        this.openDropdown()
      }
    },
    openDropdown() {
      this.preference = getAppLanguagePreference()
      this.resolvedLang = getAppLanguage()
      this.searchQuery = ''
      this.open = true
      const idx = this.filteredOptions.findIndex((o) => this.isOptionSelected(o))
      this.activeIndex = idx >= 0 ? idx : 0
      this.$nextTick(() => {
        const input = this.$refs.searchInputEl
        if (input && typeof input.focus === 'function') {
          input.focus()
        }
      })
    },
    closeDropdown() {
      this.open = false
      this.searchQuery = ''
    },
    selectOption(value) {
      const resolved = setAppLanguage(value)
      applyI18nLocale(resolved)
      this.preference = getAppLanguagePreference()
      this.resolvedLang = resolved
      this.$emit('update:modelValue', value)
      this.$emit('change', { preference: this.preference, resolved })
      this.closeDropdown()
    },
    onTriggerKeydown(e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (!this.open) this.openDropdown()
      } else if (e.key === 'Escape' && this.open) {
        e.preventDefault()
        this.closeDropdown()
      }
    },
    onSearchKeydown(e) {
      this.onDropdownKeydown(e)
    },
    onDropdownKeydown(e) {
      const len = this.filteredOptions.length
      if (e.key === 'Escape') {
        e.preventDefault()
        this.closeDropdown()
        const trigger = this.$refs.triggerEl
        if (trigger && typeof trigger.focus === 'function') trigger.focus()
        return
      }
      if (!len) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.activeIndex = (this.activeIndex + 1) % len
        this.scrollActiveIntoView()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        this.activeIndex = (this.activeIndex - 1 + len) % len
        this.scrollActiveIntoView()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const opt = this.filteredOptions[this.activeIndex]
        if (opt) this.selectOption(opt.value)
      }
    },
    scrollActiveIntoView() {
      this.$nextTick(() => {
        const list = this.$refs.listEl
        if (!list) return
        const items = list.querySelectorAll('.awd-lang-option')
        const el = items[this.activeIndex]
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest' })
        }
      })
    },
  },
}
</script>

<style scoped>
.awd-lang-picker {
  position: relative;
  display: inline-block;
  font-size: 13px;
  -webkit-app-region: no-drag;
}

.awd-lang-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--awd-border, rgba(15, 23, 42, 0.14));
  background: var(--awd-surface-1, var(--awd-bg-elevated, #ffffff));
  color: var(--awd-text-primary, #1f2329);
  font-size: 13px;
  line-height: 1.3;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.awd-lang-picker.is-compact .awd-lang-trigger {
  min-height: 28px;
  padding: 3px 8px;
  font-size: 12px;
  background: transparent;
  border-color: var(--awd-border-subtle, rgba(15, 23, 42, 0.12));
  color: var(--awd-text-secondary, #4e5969);
}

.awd-lang-trigger:hover,
.awd-lang-picker.is-open .awd-lang-trigger {
  border-color: var(--awd-accent, #2563eb);
  color: var(--awd-text-primary, #1f2329);
}

.awd-lang-globe {
  flex-shrink: 0;
  opacity: 0.78;
}

.awd-lang-current {
  white-space: nowrap;
}

.awd-lang-caret {
  flex-shrink: 0;
  opacity: 0.6;
  transition: transform 0.15s ease;
}

.awd-lang-picker.is-open .awd-lang-caret {
  transform: rotate(180deg);
}

.awd-lang-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  inset-inline-start: 0;
  z-index: 2200;
  width: 260px;
  max-width: calc(100vw - 24px);
  border-radius: 8px;
  border: 1px solid var(--awd-border, rgba(15, 23, 42, 0.14));
  background: var(--awd-surface-1, var(--awd-bg-elevated, #ffffff));
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
  overflow: hidden;
}

.awd-lang-picker.placement-top .awd-lang-dropdown {
  top: auto;
  bottom: calc(100% + 6px);
}

.awd-lang-picker.align-end .awd-lang-dropdown {
  inset-inline-start: auto;
  inset-inline-end: 0;
}

.awd-lang-search-wrap {
  padding: 8px;
  border-bottom: 1px solid var(--awd-border-subtle, rgba(15, 23, 42, 0.08));
}

.awd-lang-search-input {
  width: 100%;
  box-sizing: border-box;
  height: 30px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--awd-border, rgba(15, 23, 42, 0.14));
  background: var(--awd-surface-2, rgba(15, 23, 42, 0.03));
  color: var(--awd-text-primary, #1f2329);
  font-size: 12px;
  outline: none;
}

.awd-lang-search-input:focus {
  border-color: var(--awd-accent, #2563eb);
}

.awd-lang-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
}

.awd-lang-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--awd-text-primary, #1f2329);
  font-size: 13px;
  text-align: start;
  cursor: pointer;
}

.awd-lang-option.is-system {
  border-bottom: 1px solid var(--awd-border-subtle, rgba(15, 23, 42, 0.06));
  margin-bottom: 2px;
  border-radius: 6px 6px 0 0;
}

.awd-lang-option:hover,
.awd-lang-option.is-active {
  background: var(--awd-surface-hover, rgba(37, 99, 235, 0.08));
}

.awd-lang-option.is-selected {
  font-weight: 600;
  color: var(--awd-accent, #2563eb);
}

.awd-lang-opt-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.awd-lang-opt-native {
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awd-lang-opt-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--awd-text-tertiary, #86909c);
  line-height: 1.2;
}

.awd-lang-opt-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.awd-lang-opt-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--awd-surface-2, rgba(15, 23, 42, 0.06));
  color: var(--awd-text-secondary, #4e5969);
}

.awd-lang-opt-check {
  width: 14px;
  text-align: center;
  font-weight: 700;
  color: var(--awd-accent, #2563eb);
}

.awd-lang-empty {
  padding: 14px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--awd-text-tertiary, #86909c);
}
</style>
