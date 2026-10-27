<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="msb">
    <!-- 搜索：过滤全部分组（VS Code 扩展栏语义） -->
    <view class="msb-search">
      <svg class="msb-search-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path v-for="(d, gi) in ICONS.search" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <input class="msb-search-input" v-model="searchText" :placeholder="$t('market.searchPlaceholder')" />
      <view v-if="searchText" class="msb-search-clear" @tap="searchText = ''">×</view>
    </view>

    <view class="msb-body">
      <view class="msb-section" :class="{ expanded: sections.installed }">
      <!-- ===== 已安装 ===== -->
      <view class="msb-sec-head" @tap="toggleSection('installed')">
        <text class="msb-sec-chevron" :class="{ open: sections.installed }">›</text>
        <text class="msb-sec-title">{{ $t('market.tabInstalled') }}</text>
        <text class="msb-sec-count">{{ installedRows.length }}</text>
        <view class="msb-sec-spacer"></view>
        <view class="msb-sec-action" :title="$t('market.rescanTooltip')" @tap.stop="rescan">
          <svg class="msb-sec-action-icon" :class="{ spinning: rescanning }" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path v-for="(d, gi) in ICONS.refresh" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </view>
      </view>
      <view v-if="sections.installed" class="msb-section-content">
        <!-- 「已安装」的插件/Skill 两类改为**横向标签并排**（dev-board#67）：
             竖着叠两个子分组时后一组常被推出视口，"看不全"。标签标题即类型，
             行内不再重复"面板插件/Skill"小字标签。顺序插件在前，与整页版一致。 -->
        <view class="msb-tabs">
          <view
            v-for="group in installedGroups"
            :key="group.key"
            class="msb-tab"
            :class="{ active: installedTab === group.key }"
            @tap="installedTab = group.key"
          >
            <text>{{ group.title }}</text>
            <text class="msb-tab-count">{{ group.rows.length }}</text>
          </view>
        </view>
        <scroll-view scroll-y class="msb-list">
        <view v-if="installedTab === 'skill'" class="msb-builtin-note">
          <text>{{ $t('market.builtinWorkflowsMarketNotice') }}</text>
        </view>
        <view v-if="!activeInstalledRows.length" class="msb-empty">
          <text>{{ searchText ? activeInstalledEmptyText : $t('market.noInstalledYet') }}</text>
        </view>
        <view
          v-for="row in activeInstalledRows"
          :key="'ins-' + row.kind + '-' + row.id"
          class="msb-row"
          @tap="openDetail(row)"
        >
          <view class="msb-row-glyph" :class="{ 'is-plugin': row.kind === 'plugin' || row.panel, 'has-avatar': !!row.avatarUrl }">
            <image v-if="row.avatarUrl" :src="row.avatarUrl" class="msb-row-avatar" mode="aspectFill" />
            <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path v-for="(d, gi) in row.glyph" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </view>
          <view class="msb-row-main">
            <text class="msb-row-name">{{ row.name }}</text>
            <text v-if="row.desc" class="msb-row-desc">{{ row.desc }}</text>
            <text class="msb-row-meta">{{ row.meta }}</text>
          </view>
          <view class="msb-row-state" :class="row.stateClass">
            <text>{{ row.stateLabel }}</text>
          </view>
        </view>
        </scroll-view>
      </view>
      </view>

      <!-- ===== Marketplace：在线 Skill 与插件收进同一个分组，组内横向双标签
           （左 Skill 右插件，dev-board#67）===== -->
      <view class="msb-section" :class="{ expanded: sections.market }">
      <view class="msb-sec-head" @tap="toggleSection('market')">
        <text class="msb-sec-chevron" :class="{ open: sections.market }">›</text>
        <text class="msb-sec-title">{{ $t('market.tabMarketplace') }}</text>
        <text class="msb-sec-count">{{ skillRows.length + pluginRows.length }}</text>
        <text v-if="pluginUpdateState.count" class="msb-update-count" :title="$t('market.updateAvailableCount', { count: pluginUpdateState.count })">{{ pluginUpdateState.count }}</text>
        <view class="msb-sec-spacer"></view>
        <component :is="'button'" type="button" class="msb-sec-action msb-check-updates" :title="$t('market.checkForUpdates')" :aria-label="$t('market.checkForUpdates')" :disabled="marketPluginLoading" @click.stop="checkForUpdates">
          <svg class="msb-sec-action-icon" :class="{ spinning: marketPluginLoading }" viewBox="0 0 24 24" fill="none">
            <path v-for="(d, gi) in ICONS.refresh" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </component>
      </view>
      <view v-if="sections.market" class="msb-section-content">
        <view v-if="marketPluginLoading || marketPluginError" class="msb-update-status" :class="{ 'msb-error': marketPluginError }" role="status">
          <text>{{ marketPluginLoading ? $t('market.checkingUpdates') : $t('market.checkingUpdatesFailed') + ' ' + marketPluginError }}</text>
        </view>
        <view class="msb-tabs">
          <view class="msb-tab" :class="{ active: marketTab === 'skill' }" @tap="marketTab = 'skill'">
            <text>{{ $t('market.sectionSkillTitle') }}</text>
            <text class="msb-tab-count">{{ skillRows.length }}</text>
          </view>
          <view class="msb-tab" :class="{ active: marketTab === 'plugin' }" @tap="marketTab = 'plugin'">
            <text>{{ $t('market.sectionPluginTitle') }}</text>
            <text class="msb-tab-count">{{ pluginRows.length }}</text>
          </view>
        </view>

        <scroll-view scroll-y class="msb-list">
        <template v-if="marketTab === 'skill'">
          <view class="msb-builtin-note">
            <text>{{ $t('market.builtinWorkflowsMarketNotice') }}</text>
          </view>
          <view v-if="marketLoading" class="msb-empty"><text>{{ $t('market.loadingEllipsis') }}</text></view>
          <view v-else-if="marketError" class="msb-empty msb-error">
            <text>{{ $t('market.marketUnavailablePrefixed', { error: marketError }) }}</text>
          </view>
          <view v-else-if="!skillRows.length" class="msb-empty">
            <text>{{ searchText ? $t('market.noMatchingSkill') : $t('market.marketEmptySkillShort') }}</text>
          </view>
          <view
            v-for="row in skillRows"
            :key="'mkt-s-' + row.id"
            class="msb-row"
            @tap="openDetail(row)"
          >
            <view class="msb-row-glyph">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path v-for="(d, gi) in row.glyph" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </view>
            <view class="msb-row-main">
              <text class="msb-row-name">{{ row.name }}</text>
              <text v-if="row.desc" class="msb-row-desc">{{ row.desc }}</text>
              <text class="msb-row-meta">{{ row.meta }}</text>
            </view>
            <view v-if="row.installed" class="msb-row-state ok"><text>{{ $t('market.installedShort') }}</text></view>
            <view
              v-else-if="row.canInstall"
              class="msb-row-install"
              :class="{ busy: marketBusyId === row.id }"
              @tap.stop="installSkillRow(row)"
            >
              <text>{{ marketBusyId === row.id ? '…' : $t('market.install') }}</text>
            </view>
            <view v-else-if="row.paidState === 'buy'" class="msb-row-install buy" @tap.stop="openPurchase(row)">
              <text>{{ $t('market.buy') }}</text>
            </view>
            <view v-else class="msb-row-state need" @tap.stop="loginThenInstall(row)">
              <text>{{ $t('market.needAccount') }}</text>
            </view>
          </view>
        </template>

        <template v-else>
          <view v-if="marketPluginLoading" class="msb-empty"><text>{{ $t('market.loadingEllipsis') }}</text></view>
          <view v-else-if="marketPluginError" class="msb-empty msb-error">
            <text>{{ $t('market.marketUnavailablePrefixed', { error: marketPluginError }) }}</text>
          </view>
          <view v-else-if="!pluginRows.length" class="msb-empty">
            <text>{{ searchText ? $t('market.noMatchingPlugin') : $t('market.marketEmptyPlugin') }}</text>
          </view>
          <view
            v-for="row in pluginRows"
            :key="'mkt-p-' + row.id"
            class="msb-row"
            @tap="openDetail(row)"
          >
            <view class="msb-row-glyph is-plugin" :class="{ 'has-avatar': !!row.avatarUrl }">
              <image v-if="row.avatarUrl" :src="row.avatarUrl" class="msb-row-avatar" mode="aspectFill" />
              <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path v-for="(d, gi) in row.glyph" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </view>
            <view class="msb-row-main">
              <text class="msb-row-name">{{ row.name }}</text>
              <text v-if="row.desc" class="msb-row-desc">{{ row.desc }}</text>
              <text class="msb-row-meta">{{ row.meta }}</text>
            </view>
            <component :is="'button'" type="button" v-if="row.updatable" class="msb-row-install msb-row-update" :title="$t('market.updateToVersion', { version: row.raw.version })" @click.stop="openDetail(row)"><text>{{ $t('market.update') }}</text></component>
            <view v-else-if="row.installed" class="msb-row-state ok"><text>{{ $t('market.installedShort') }}</text></view>
            <view
              v-else-if="row.canInstall"
              class="msb-row-install"
              :class="{ busy: pluginBusyId === row.id }"
              @tap.stop="installPluginRow(row)"
            >
              <text>{{ pluginBusyId === row.id ? '…' : $t('market.install') }}</text>
            </view>
            <view v-else-if="row.paidState === 'buy'" class="msb-row-install buy" @tap.stop="openPurchase(row)">
              <text>{{ $t('market.buy') }}</text>
            </view>
            <view v-else class="msb-row-state need" @tap.stop="loginThenInstall(row)">
              <text>{{ $t('market.needAccount') }}</text>
            </view>
          </view>
        </template>
        </scroll-view>
      </view>
      </view>
    </view>
  </view>
</template>

<script>
// 插件广场左栏面板（VS Code 扩展栏形态）：搜索 + 已安装/Skill 广场/插件广场
// 两个独立滚动分组的紧凑列表；点行在中栏开详情 tab（emit open-detail），行内快捷安装。
// 数据与安装链路复用 MarketPane 同一组 services/api.js 封装。
import { installBundledPlugin, getPlugins, getSkills, getSkillMarket, installMarketSkill, installMarketPlugin, rescanPlugins, rescanSkills } from '@/services/api.js'
import { pluginUpdates, refreshPluginUpdates } from '@/composables/usePluginUpdates.js'
import { isPluginUpdateAvailable } from '@/utils/marketUpdates.js'
import { ICONS } from '@/config/icons.js'
import { getPluginAvatarUrl, getPluginGlyphPaths } from '@/config/pluginIcons.js'
import { isPanelSkill, isVoiceGroupMember } from '@/config/leftSidebarPlugins.js'
import { canInstall, paidState, priceLabel, purchaseUrl } from '@/utils/marketPricing.js'
import { openExternalUrl } from '@/utils/externalLink.js'
import { requireAccount, isAccountLoginRetry } from '@/utils/requireAccount.js'
import { refreshEntitlements } from '@/composables/useEntitlement.js'
import { t } from '@/i18n'

const CATEGORY_GLYPHS = {
  contract: ICONS.catContract,
  litigation: ICONS.catLitigation,
  compliance: ICONS.catCompliance,
  research: ICONS.catResearch,
  corporate: ICONS.catCorporate,
  office: ICONS.catOffice,
  other: ICONS.catOther,
}

const CATEGORY_KEYS = {
  contract: 'market.catContract',
  litigation: 'market.catLitigation',
  compliance: 'market.catCompliance',
  research: 'market.catResearch',
  corporate: 'market.catCorporate',
  office: 'market.catOffice',
  other: 'market.catOther',
}

const ACTIVATION_STATE = {
  auto: 'market.activationStateAuto',
  manual: 'market.activationStateManual',
  disabled: 'market.activationDisabled',
}

function fmtDownloads(n) {
  if (!n) return ''
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export default {
  name: 'MarketSidebarPanel',
  emits: ['open-detail'],
  data() {
    return {
      searchText: '',
      sections: { installed: true, market: true },
      // 「已安装」与 Marketplace 组内的横向标签（dev-board#67）
      installedTab: 'plugin',
      marketTab: 'skill',
      plugins: [],
      skills: [],
      marketSkills: [],
      pluginUpdateState: pluginUpdates,
      marketLoading: false,
      marketError: '',
      marketBusyId: '',
      pluginBusyId: '',
      rescanning: false,
      // 是否已连接官网账户；随广场列表响应一起下发（付费未购项据此显示「购买」还是「需连接账户」）
      accountConnected: false,
    }
  },
  computed: {
    marketPlugins() { return this.pluginUpdateState.catalog },
    marketPluginLoading() { return this.pluginUpdateState.checking },
    marketPluginError() { return this.pluginUpdateState.error },
    ICONS() {
      return ICONS
    },
    installedRows() {
      const kw = this.searchText.trim().toLowerCase()
      const rows = []
      // Voice UI is an installed plugin. Its legacy AI skills stay in the Skill tab.
      for (const s of this.skills) {
        if (s.builtinWorkflow) continue
        const mode = s.activationMode || (s.enabled ? 'auto' : 'disabled')
        // 面板型（背后挂着左栏面板）在列表里也按插件标注：用户看到的是一个面板，
        // 说它是「Skill · 自动触发」只会让人对不上号。判据见 leftSidebarPlugins.js。
        const panel = isPanelSkill(s.id) && !isVoiceGroupMember(s.id) && !s.sourcePluginId
        // 「面板插件/Skill」标签不再在行内重复——子分组标题（installedGroups）已经
        // 表明了这一行属于哪一类，见下方 installedSkillRows/installedPluginRows。
        const metaParts = []
        if (s.version) metaParts.push('v' + s.version)
        if (s.author) metaParts.push(s.author)
        if (s.sourcePluginId) metaParts.push(this.$t('market.fromPluginTag'))
        // 挂着原生资源包的面板型 skill：已启用但包还没就绪（老版本升级后端自动
        // 补下载的过渡态，见 docs/NATIVE_PACK_DISTRIBUTION.md §5）——如实标「下载中」，
        // 不能显示「已启用」误导用户以为功能已经能用。装未装的初始态不受影响，
        // 那条走 MarketDetailPane 的安装按钮，本行列表不加轮询。
        const packPending = panel && s.packId && s.enabled && s.packReady === false
        rows.push({
          kind: 'skill',
          id: s.id,
          name: s.name || s.id,
          desc: s.description || '',
          glyph: panel ? ICONS.panelLeft : (CATEGORY_GLYPHS[s.category] || ICONS.skill),
          meta: metaParts.join(' · '),
          // 子分组归属：面板型进「插件」组，其余进「Skill」组。见 installedGroups。
          panel,
          stateLabel: packPending
            ? this.$t('market.packDownloadingShort')
            : panel
              ? (s.enabled ? this.$t('market.enabledTag') : this.$t('market.disabledTag'))
              : this.$t(ACTIVATION_STATE[mode] || 'market.activationStateAuto'),
          stateClass: packPending ? 'downloading' : (mode === 'disabled' ? 'off' : 'ok'),
          raw: s,
        })
      }
      for (const p of this.plugins) {
        const latest = (this.marketPlugins || []).find(item => item.id === p.id)
        const updatable = isPluginUpdateAvailable(latest, p)
        rows.push({
          kind: 'plugin',
          id: p.id,
          name: p.name || p.id,
          desc: p.description || '',
          avatarUrl: typeof getPluginAvatarUrl === 'function' ? getPluginAvatarUrl(p.id) : null,
          glyph: typeof getPluginGlyphPaths === 'function' ? getPluginGlyphPaths(p.id) : ICONS.blocks,
          meta: p.version ? ('v' + p.version) : '',
          stateLabel: updatable ? this.$t('market.updateAvailable') : (p.enabled ? this.$t('market.enabledTag') : this.$t('market.disabledTag')),
          stateClass: updatable ? 'update' : (p.enabled ? 'ok' : 'off'),
          raw: p,
        })
      }
      return kw ? rows.filter(r => (r.name + ' ' + r.id + ' ' + r.desc).toLowerCase().includes(kw)) : rows
    },
    /** 「已安装」子分组：插件 = 面板型 skill + JAR/Web 插件；Skill = 纯对话型。 */
    installedPluginRows() {
      return this.installedRows.filter(r => r.kind === 'plugin' || r.panel)
    },
    installedSkillRows() {
      return this.installedRows.filter(r => r.kind === 'skill' && !r.panel)
    },
    /** 标签顺序：插件在前、Skill 在后，与 MarketPane.vue 已安装 tab 一致。 */
    installedGroups() {
      return [
        { key: 'plugin', title: this.$t('market.sectionPluginTitle'), rows: this.installedPluginRows },
        { key: 'skill', title: this.$t('market.sectionSkillTitle'), rows: this.installedSkillRows },
      ]
    },
    activeInstalledRows() {
      return this.installedTab === 'skill' ? this.installedSkillRows : this.installedPluginRows
    },
    /** dev-board BUG-51：已安装分组的空搜索文案原来永远是笼统的「没有匹配的
     * 已安装项」，跟在线广场里「没有匹配的 Skill」/「没有匹配的插件」这种
     * 按当前子分组具体命名的措辞不一致。改成跟随 installedTab 复用同一套
     * noMatchingSkill/noMatchingPlugin 文案，两边说法统一。 */
    activeInstalledEmptyText() {
      return this.installedTab === 'skill' ? this.$t('market.noMatchingSkill') : this.$t('market.noMatchingPlugin')
    },
    skillRows() {
      const kw = this.searchText.trim().toLowerCase()
      const rows = this.marketSkills.map(m => {
        const cat = m.category || 'other'
        const metaParts = []
        if (m.version) metaParts.push('v' + m.version)
        if (m.bundled) metaParts.push(this.$t('pluginPlatform.bundled'))
        const dl = fmtDownloads(m.downloads)
        if (dl) metaParts.push(dl + this.$t('market.downloadsSuffix'))
        metaParts.push(this.$t(CATEGORY_KEYS[cat] || 'market.catOther'))
        metaParts.push(priceLabel(m))
        const state = paidState(m, this.accountConnected)
        return {
          kind: 'skill',
          id: m.id,
          name: m.name || m.id,
          desc: m.description || '',
          glyph: CATEGORY_GLYPHS[cat] || CATEGORY_GLYPHS.other,
          meta: metaParts.join(' · '),
          installed: !!m.installed,
          paidState: state,
          canInstall: canInstall(state),
          raw: m,
        }
      })
      return kw
        ? rows.filter(r => {
            const hay = [r.name, r.id, r.desc, ...((r.raw.triggers) || [])].filter(Boolean).join(' ').toLowerCase()
            return hay.includes(kw)
          })
        : rows
    },
    pluginRows() {
      const kw = this.searchText.trim().toLowerCase()
      const installedIds = new Set(this.plugins.map(p => p.id))
      const rows = this.marketPlugins.map(m => {
        const metaParts = []
        if (m.version) metaParts.push('v' + m.version)
        if (m.bundled) metaParts.push(this.$t('pluginPlatform.bundled'))
        const author = m.authorDisplayName || m.author
        if (author) metaParts.push(author)
        metaParts.push(priceLabel(m))
        const state = paidState(m, this.accountConnected)
        return {
          kind: 'plugin',
          id: m.id,
          name: m.name || m.id,
          desc: m.description || '',
          avatarUrl: typeof getPluginAvatarUrl === 'function' ? getPluginAvatarUrl(m.id) : null,
          glyph: typeof getPluginGlyphPaths === 'function' ? getPluginGlyphPaths(m.id) : ICONS.blocks,
          meta: metaParts.join(' · ') || this.$t('market.pluginLabel'),
          installed: installedIds.has(m.id) || !!m.installed,
          updatable: isPluginUpdateAvailable(m, this.plugins.find(p => p.id === m.id)),
          paidState: state,
          canInstall: canInstall(state),
          raw: m,
        }
      })
      return kw ? rows.filter(r => (r.name + ' ' + r.id + ' ' + r.desc).toLowerCase().includes(kw)) : rows
    },
  },
  mounted() {
    this.reloadAll()
    // 详情 tab 里装/卸/启停后广播回来刷新列表（组件级订阅，卸载即清理）
    uni.$on('awd:market-changed', this.reloadAll)
  },
  beforeUnmount() {
    uni.$off('awd:market-changed', this.reloadAll)
  },
  methods: {
    toggleSection(key) {
      this.sections[key] = !this.sections[key]
    },
    openDetail(row) {
      // group: 「语音」合并插件条目——详情页据此按本机成员 skill 合成视图，
      // 不去在线广场按这个 id 查（'voice' 不是 registry 里的条目）
      this.$emit('open-detail', { kind: row.kind, id: row.id, name: row.name, group: !!row.group })
    },
    // 购买走系统浏览器：支付要用用户已登录的浏览器会话，内嵌 tab 里付不了
    openPurchase(row) {
      openExternalUrl(purchaseUrl(row.kind, row.id))
      uni.showToast({ title: this.$t('market.openedPurchasePage'), icon: 'none' })
    },
    /**
     * 「需连接账户」→ 就地登录后继续安装（登录后置，dev-board#1046）：
     * 登录成功先按新账户同步一次权益、重拉列表，已购/免费就直接装；没买过按钮自然变「购买」。
     */
    async loginThenInstall(row) {
      const ok = await requireAccount({ reason: 'market' })
      if (!ok) return
      await refreshEntitlements(true).catch(() => {})
      if (row.kind === 'skill') await this.loadMarketSkills()
      else await this.loadMarketPlugins()
      const rows = row.kind === 'skill' ? this.skillRows : this.pluginRows
      const fresh = rows.find((r) => r.id === row.id)
      if (!fresh || fresh.installed || !fresh.canInstall) return
      if (fresh.kind === 'skill') await this.installSkillRow(fresh)
      else await this.installPluginRow(fresh)
    },
    async reloadAll() {
      await Promise.all([this.loadInstalled(), this.loadMarketSkills(), this.loadMarketPlugins()])
    },
    async loadInstalled() {
      try {
        const [pRes, sRes] = await Promise.all([getPlugins(), getSkills()])
        this.plugins = Array.isArray(pRes) ? pRes : (pRes?.data || [])
        this.skills = Array.isArray(sRes) ? sRes : (sRes?.data || [])
      } catch (e) {
        console.error('加载已安装列表失败:', e)
      }
    },
    async loadMarketSkills() {
      this.marketLoading = true
      this.marketError = ''
      try {
        const res = await getSkillMarket()
        this.marketSkills = res?.skills || []
        if (typeof res?.accountConnected === 'boolean') this.accountConnected = res.accountConnected
      } catch (e) {
        console.warn('在线 Skill 广场不可用:', e)
        this.marketError = e?.message || this.$t('market.networkUnavailable')
        this.marketSkills = []
      } finally {
        this.marketLoading = false
      }
    },
    async loadMarketPlugins() {
      const state = await refreshPluginUpdates(true)
      this.accountConnected = state.accountConnected
    },
    async checkForUpdates() {
      if (this.marketPluginLoading) return
      this.marketTab = 'plugin'
      this.sections.market = true
      await Promise.all([this.loadInstalled(), this.loadMarketPlugins()])
      if (!this.marketPluginError) uni.showToast({ title: this.$t('market.updatesChecked'), icon: 'none' })
    },
    async installSkillRow(row) {
      if (this.marketBusyId) return
      this.marketBusyId = row.id
      try {
        await installMarketSkill(row.id)
        uni.showToast({ title: this.$t('market.genericInstalledToast'), icon: 'none' })
        await this.reloadAll()
        uni.$emit('awd:market-changed-from-sidebar')
      } catch (e) {
        console.error('安装 Skill 失败:', e)
        // 后端 4011 已由 api.js 就地弹过登录层：登录成功就刷新列表，按钮按新账户的状态显示
        if (isAccountLoginRetry(e)) await this.reloadAll()
        uni.showToast({ title: e?.message || this.$t('market.installFailedNeedAdmin'), icon: 'none' })
      } finally {
        this.marketBusyId = ''
      }
    },
    async installPluginRow(row) {
      if (this.pluginBusyId) return
      const m = row.raw
      const labels = { file_read: 'permFileRead', file_write: 'permFileWrite', network: 'permNetwork', im: 'permIm', notifications: 'permNotifications', editor: 'permEditor', ai: 'permAi', speech: 'permSpeech', tasks: 'permTasks', clipboard: 'permClipboard', lawfirm: 'permLawfirm' }
      const perms = (m.permissions || []).map(p => labels[p] ? this.$t(`market.${labels[p]}`) : p).join(this.$t('market.listSeparator')) || this.$t('market.noSensitiveCapability')
      const ok = await new Promise(resolve => {
        uni.showModal({
          title: this.$t('market.confirmInstallPluginTitle'),
          content: this.$t('market.confirmInstallPluginContent', {
            name: m.name || m.id,
            version: m.version,
            author: m.authorDisplayName || m.author || this.$t('market.unknownAuthor'),
            perms,
          }),
          confirmText: this.$t('market.install'),
          cancelText: this.$t('market.cancelBtn'),
          success: r => resolve(r.confirm),
          fail: () => resolve(false),
        })
      })
      if (!ok) return
      this.pluginBusyId = row.id
      try {
        await (m.bundled ? installBundledPlugin(row.id) : installMarketPlugin(row.id))
        uni.showToast({ title: this.$t('market.installedNoExecuteHint'), icon: 'none' })
        await this.reloadAll()
        uni.$emit('awd:market-changed-from-sidebar')
      } catch (e) {
        console.error('安装插件失败:', e)
        if (isAccountLoginRetry(e)) await this.reloadAll()
        uni.showToast({ title: e?.message || this.$t('market.installFailedNeedAdmin'), icon: 'none' })
      } finally {
        this.pluginBusyId = ''
      }
    },
    async rescan() {
      if (this.rescanning) return
      this.rescanning = true
      try {
        const res = await rescanPlugins()
        const skillRes = await rescanSkills().catch(() => null)
        uni.showToast({
          title: this.$t('market.scanComplete', { pluginCount: res?.pluginCount ?? 0, skillCount: skillRes?.skillCount ?? 0 }),
          icon: 'none',
        })
        await this.reloadAll()
        uni.$emit('awd:market-changed-from-sidebar')
      } catch (e) {
        console.error('重新扫描失败:', e)
        uni.showToast({ title: e?.message || this.$t('market.scanFailedNeedAdmin'), icon: 'none' })
      } finally {
        this.rescanning = false
      }
    },
  },
}
</script>

<style lang="scss" scoped>
/* VS Code 扩展栏密度 + 产品浅色体系（墨竹青 #2E5A50 主色 / mint var(--awd-mint)（竹月青氛围色）点缀） */
.msb {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}

.msb-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px var(--awd-panel-pad-x) 6px;
  flex-shrink: 0;
  height: 28px;
  padding: 0 8px;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-sm);

  &:focus-within {
    border-color: var(--awd-accent-text);
    box-shadow: 0 0 0 var(--awd-focus-width) var(--awd-accent-text);
  }
}

.msb-search-icon {
  width: 13px;
  height: 13px;
  color: var(--awd-text-2);
  flex-shrink: 0;
}

.msb-search-input {
  flex: 1;
  min-width: 0;
  font-size: var(--awd-panel-fs);
  color: var(--awd-text);
  background: transparent;
  border: none;
  outline: none;
  height: 26px;
  line-height: 26px;
}

.msb-search-clear {
  width: 16px;
  height: 16px;
  line-height: 15px;
  text-align: center;
  border-radius: var(--awd-radius-sm);
  color: var(--awd-text-2);
  font-size: var(--awd-font-size-body);
  cursor: pointer;

  &:hover {
    background: var(--awd-surface-2);
    color: var(--awd-text);
  }
}

.msb-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.msb-section {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;

  &.expanded { flex: 1 1 0; }
  & + & { border-top: 1px solid var(--awd-border); }
}

.msb-section-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.msb-list {
  flex: 1;
  height: 0;
  min-height: 0;
}

/* 分组头：VS Code 式全大写小字 + 计数 */
.msb-sec-head {
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--awd-panel-sec-h);
  flex-shrink: 0;
  padding: 0 var(--awd-panel-pad-x) 0 6px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--awd-accent-wash);
  }
}

.msb-sec-chevron {
  width: 12px;
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
  transition: transform 0.12s ease;
  transform-origin: center;

  &.open {
    transform: rotate(90deg);
  }
}

.msb-sec-title {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 700;
  color: var(--awd-text-2);
}

.msb-sec-count {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
  background: var(--awd-surface-2);
  border-radius: 999px;
  padding: 0 6px;
  line-height: 14px;
  margin-left: 2px;
}

.msb-sec-spacer {
  flex: 1;
}

.msb-update-count {
  min-width: 14px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--awd-accent);
  color: var(--awd-text-on-accent);
  font-size: var(--awd-panel-fs-meta);
  text-align: center;
}

.msb-update-status {
  padding: 4px var(--awd-panel-pad-x);
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
  overflow-wrap: anywhere;
}

.msb-check-updates {
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  &::after { border: 0; }
  &:focus-visible { outline: 2px solid var(--awd-accent); }
}

.msb-row-update {
  margin: 0;
  line-height: 18px;
  &::after { border: 0; }
  &:focus-visible { outline: 2px solid var(--awd-accent-text); outline-offset: 2px; }
}

.msb-row-state.update {
  color: var(--awd-accent-text);
  background: var(--awd-accent-soft);
  font-weight: 600;
}

.msb-sec-action {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--awd-radius-sm);
  color: var(--awd-text-2);
  cursor: pointer;

  &:hover {
    background: var(--awd-accent-soft);
    color: var(--awd-accent-text);
  }
}

.msb-sec-action-icon {
  width: 12px;
  height: 12px;

  &.spinning {
    animation: msb-spin 0.9s linear infinite;
  }
}

@keyframes msb-spin {
  to { transform: rotate(360deg); }
}

/* 组内横向标签（已安装的插件/Skill、Marketplace 的 Skill/插件）：紧凑下划线，
   竖着叠分组会把后一组推出视口（dev-board#67）。 */
.msb-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--awd-panel-pad-x) 4px 22px;
  flex-shrink: 0;
}

.msb-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 0;
  border-bottom: 1px solid transparent;
  cursor: pointer;
  background: transparent;

  text {
    font-size: var(--awd-panel-fs-meta);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--awd-text-2);
  }

  &:hover {
    background: var(--awd-accent-wash);
  }

  &.active {
    border-bottom-color: var(--awd-accent-text);

    text {
      color: var(--awd-accent-text);
    }
  }
}

.msb-tab-count {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
}

.msb-tab.active .msb-tab-count {
  color: var(--awd-accent-text);
  opacity: 0.7;
}

.msb-empty {
  padding: 8px 12px 10px 22px;
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);

  &.msb-error {
    color: var(--awd-danger-text);
  }
}

/* 三行扩展列表：名称和描述使用全宽，操作与版本信息同排。 */
.msb-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  column-gap: 10px;
  row-gap: 1px;
  padding: 8px var(--awd-panel-pad-x);
  cursor: pointer;

  &:hover {
    background: var(--awd-accent-wash);
  }
}

.msb-row-glyph {
  width: 36px;
  height: 36px;
  grid-column: 1;
  grid-row: 1 / 4;
  align-self: center;
  border-radius: var(--awd-radius-md);
  background: var(--awd-accent-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--awd-accent-text);
  overflow: hidden;

  svg {
    width: 22px;
    height: 22px;
  }

  /* 插件 = 可执行扩展：深底图标与 Skill（浅底）一眼区分 */
  &.is-plugin {
    background: var(--awd-accent-hover);
    color: var(--awd-text-on-accent);
  }

  &.has-avatar {
    background: var(--awd-surface);
    border: 1px solid var(--awd-border);
    border-radius: 50%;
    padding: 0;
  }
}

.msb-row-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: block;
}

.msb-row-main {
  display: contents;
}

.msb-row-name {
  min-width: 0;
  grid-column: 2 / 4;
  grid-row: 1;
  line-height: 18px;
  font-size: var(--awd-font-size-body);
  font-weight: 600;
  color: var(--awd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msb-row-desc {
  min-width: 0;
  grid-column: 2 / 4;
  grid-row: 2;
  line-height: 18px;
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msb-row-meta {
  min-width: 0;
  grid-column: 2;
  grid-row: 3;
  line-height: 18px;
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msb-row-install {
  grid-column: 3;
  grid-row: 3;
  max-width: 100%;
  flex-shrink: 0;
  align-self: center;
  height: 20px;
  line-height: 18px;
  padding: 0 8px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-accent);
  border: 1px solid var(--awd-accent);
  cursor: pointer;

  text {
    font-size: var(--awd-panel-fs-meta);
    font-weight: 600;
    color: var(--awd-text-on-accent);
  }

  &:hover {
    background: var(--awd-accent-hover);
  }

  &.busy {
    opacity: 0.6;
    pointer-events: none;
  }

  /* 付费未购：描边而非实心，与「安装」区分开——点它去的是官网，不是本机动作 */
  &.buy {
    background: var(--awd-surface);
    border-color: var(--awd-accent-text);

    text {
      color: var(--awd-accent-text);
    }

    &:hover {
      background: var(--awd-accent-soft);
    }
  }
}

.msb-row-state {
  grid-column: 3;
  grid-row: 3;
  max-width: 100%;
  flex-shrink: 0;
  align-self: center;
  font-size: var(--awd-panel-fs-meta);
  padding: 1px 6px;
  border-radius: 999px;

  &.ok {
    background: var(--awd-accent-soft);

    text {
      color: var(--awd-accent-text);
      font-size: var(--awd-panel-fs-meta);
    }
  }

  &.off {
    background: var(--awd-surface-2);

    text {
      color: var(--awd-text-2);
      font-size: var(--awd-panel-fs-meta);
    }
  }

  /* 未连接账户：与顶栏「试用版」chip 同一族暖色，是引导不是报错 */
  &.need {
    background: var(--awd-bg);
    cursor: pointer;

    text {
      color: var(--awd-warning-text);
      font-size: var(--awd-panel-fs-meta);
    }

    &:hover {
      background: var(--awd-bg);
    }
  }

  /* 资源包下载中：与 .need 同一族暖色（都是「还没就绪」），不可点 */
  &.downloading {
    background: var(--awd-warning-soft);

    text {
      color: var(--awd-warning-text);
      font-size: var(--awd-panel-fs-meta);
    }
  }
}

.msb-builtin-note {
  margin: 6px var(--awd-panel-pad-x) 4px;
  padding: 7px 9px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-accent-wash);
  border: 1px solid var(--awd-accent-soft);

  text {
    font-size: var(--awd-panel-fs-meta);
    color: var(--awd-text-2);
    line-height: 1.45;
  }
}
</style>
