<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="pws-root">
    <!-- ==================== 1. 项目沟通（飞书式：通讯录 + 对话列表） ==================== -->
    <template v-if="plugin.pluginId === 'project-im'">
      <view class="pws-im-top">
        <view class="pws-search-box">
          <svg class="pws-search-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path v-for="(d, gi) in ICONS.search" :key="gi" :d="d" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <input
            v-model="searchKeyword"
            class="pws-search-input"
            placeholder="搜索组织、律所、朋友或对话…"
          />
          <text v-if="searchKeyword" class="pws-search-clear" @tap="searchKeyword = ''">×</text>
        </view>
        <view class="pws-im-quick-row">
          <view class="pws-quick-btn primary" @tap="emitCommand('open-new-chat')">
            <text>+ 新建会话</text>
          </view>
          <view class="pws-quick-btn" @tap="emitCommand('open-join-chat')">
            <text>邀请码加入</text>
          </view>
          <view class="pws-quick-btn" @tap="toggleAddFriendForm">
            <text>{{ showAddFriend ? '收起' : '+ 加朋友' }}</text>
          </view>
        </view>

        <!-- 内联添加朋友表单 -->
        <view v-if="showAddFriend" class="pws-friend-form">
          <text class="pws-form-title">添加外部协作朋友 / 客户联系人</text>
          <input v-model="friendDraft.name" class="pws-form-input" placeholder="姓名（如：王律师 / 李法务）" maxlength="40" />
          <input v-model="friendDraft.org" class="pws-form-input" placeholder="所属律所或单位（选填）" maxlength="60" />
          <view class="pws-form-tags">
            <view
              v-for="tag in FRIEND_ROLE_TAGS"
              :key="tag"
              class="pws-form-tag"
              :class="{ active: friendDraft.roleLabel === tag }"
              @tap="friendDraft.roleLabel = tag"
            >
              <text>{{ tag }}</text>
            </view>
          </view>
          <view class="pws-form-actions">
            <view class="pws-quick-btn" @tap="showAddFriend = false"><text>取消</text></view>
            <view class="pws-quick-btn primary" @tap="submitAddFriend"><text>保存到通讯录</text></view>
          </view>
        </view>
      </view>

      <scroll-view scroll-y class="pws-scroll">
        <!-- ===== 组织身份卡（飞书式租户切换入口）=====
             官网模型：一人一队、一队一所。切换团队 / 律所在「设置 › 团队」完成（TeamPanel 负责确认与半途失败提示），
             这里只展示当前身份与能否切换的原因，并跳转过去；完成后 awd:org-changed 触发本栏重拉。 -->
        <view class="pws-org-card">
          <view class="pws-org-main" @tap="orgMenuOpen = !orgMenuOpen">
            <view class="pws-org-avatar"><text>{{ directory.organization ? avatarChar(directory.organization.name) : '无' }}</text></view>
            <view class="pws-org-text">
              <text class="pws-org-name">{{ directory.organization ? (directory.organization.name || '未命名团队') : '尚未加入团队' }}</text>
              <text class="pws-org-sub">{{ orgSubtitle }}</text>
            </view>
            <text class="pws-chevron" :class="{ open: orgMenuOpen }">›</text>
          </view>
          <view v-if="orgMenuOpen" class="pws-org-menu">
            <text class="pws-org-hint">{{ orgSwitchHint }}</text>
            <view
              v-for="t in (directory.firm ? directory.firm.teams : [])"
              :key="'orgmenu-' + t.id"
              class="pws-org-team"
              :class="{ mine: t.isMine }"
            >
              <text class="pws-org-team-name">{{ t.name }}</text>
              <text class="pws-org-team-tag">{{ t.isMine ? '本团队' : (t.isHead ? '总部团队' : '成员团队') }}</text>
            </view>
            <view class="pws-org-actions">
              <view class="pws-quick-btn primary" @tap="openOrgSettings">
                <text>{{ directory.organization ? '切换团队或律所' : '创建或加入团队' }}</text>
              </view>
            </view>
          </view>
        </view>

        <!-- ===== 第一层级：通讯录（我的组织 / 我的律所 / 我的朋友） ===== -->
        <view class="pws-section">
          <view class="pws-sec-bar" @tap="emitCommand('focus-directory')">
            <text class="pws-sec-label">通讯录</text>
            <text class="pws-sec-sub">组织 · 律所 · 朋友</text>
          </view>

          <!-- 1) 我的组织 -->
          <view class="pws-dir-group">
            <view class="pws-dir-head" @tap="toggleDirGroup('org')">
              <text class="pws-chevron" :class="{ open: dirExpanded.org }">›</text>
              <view class="pws-dir-icon org">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path v-for="(d, gi) in (ICONS.teamUsers || ICONS.projectIm)" :key="gi" :d="d" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </view>
              <view class="pws-dir-title-wrap">
                <text class="pws-dir-title">我的组织</text>
                <text class="pws-dir-subtitle">{{ directory.organization ? directory.organization.name : '尚未加入团队' }}</text>
              </view>
              <text class="pws-dir-count">{{ filteredOrgMembers.length }}</text>
            </view>
            <view v-if="dirExpanded.org" class="pws-dir-body">
              <view
                v-for="m in filteredOrgMembers"
                :key="'org-' + m.id + '-' + m.name"
                class="pws-contact-row"
                @tap="startContactChat(m, 'org')"
              >
                <view class="pws-contact-avatar org">
                  <text>{{ avatarChar(m.name) }}</text>
                </view>
                <view class="pws-contact-main">
                  <view class="pws-contact-line">
                    <text class="pws-contact-name">{{ m.name }}</text>
                    <text class="pws-contact-badge">{{ m.roleLabel || '成员' }}</text>
                  </view>
                  <text class="pws-contact-meta">{{ directory.organization ? directory.organization.name : '' }}</text>
                </view>
                <view class="pws-contact-action" @tap.stop="startContactChat(m, 'org')">
                  <text>发消息</text>
                </view>
              </view>
              <view v-if="!directory.organization" class="pws-dir-empty">
                <text class="pws-dir-empty-text">尚未加入团队，加入后可在这里看到同事。</text>
                <view class="pws-dir-foot-btn" @tap="openOrgSettings"><text>去创建或加入团队</text></view>
              </view>
              <text v-else-if="!filteredOrgMembers.length" class="pws-dir-empty-text">{{ kw ? '没有匹配的同事' : '团队里暂时只有你' }}</text>
              <view v-else class="pws-dir-foot-btn" @tap="startGroupChat(directory.organization.name + ' · 团队群')">
                <text>+ 发起团队群聊</text>
              </view>
            </view>
          </view>

          <!-- 2) 我的律所 -->
          <view class="pws-dir-group">
            <view class="pws-dir-head" @tap="toggleDirGroup('firm')">
              <text class="pws-chevron" :class="{ open: dirExpanded.firm }">›</text>
              <view class="pws-dir-icon firm">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path v-for="(d, gi) in (ICONS.building || ICONS.catCorporate)" :key="gi" :d="d" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </view>
              <view class="pws-dir-title-wrap">
                <text class="pws-dir-title">我的律所</text>
                <text class="pws-dir-subtitle">{{ directory.firm ? directory.firm.name : (directory.organization ? '本团队未并入律所' : '加入团队后可并入律所') }}</text>
              </view>
              <text class="pws-dir-count">{{ filteredFirmTeams.length }}</text>
            </view>
            <view v-if="dirExpanded.firm" class="pws-dir-body">
              <view
                v-for="t in filteredFirmTeams"
                :key="'firm-' + t.id + '-' + t.name"
                class="pws-contact-row"
                @tap="startGroupChat(t.name + ' · 律所协作群')"
              >
                <view class="pws-contact-avatar firm">
                  <text>{{ avatarChar(t.name) }}</text>
                </view>
                <view class="pws-contact-main">
                  <view class="pws-contact-line">
                    <text class="pws-contact-name">{{ t.name }}</text>
                    <text class="pws-contact-badge">{{ t.isMine ? '本团队' : (t.isHead ? '总部团队' : '成员团队') }}</text>
                  </view>
                  <text class="pws-contact-meta">{{ t.memberCount != null ? ('成员 ' + t.memberCount + ' 人') : '' }}</text>
                </view>
                <view class="pws-contact-action" @tap.stop="startGroupChat(t.name + ' · 律所协作群')">
                  <text>发起群聊</text>
                </view>
              </view>
              <view v-if="!directory.firm" class="pws-dir-empty">
                <text class="pws-dir-empty-text">{{ firmEmptyText }}</text>
                <view v-if="directory.organization" class="pws-dir-foot-btn" @tap="openOrgSettings"><text>去团队设置</text></view>
              </view>
            </view>
          </view>

          <!-- 3) 我的朋友 -->
          <view class="pws-dir-group">
            <view class="pws-dir-head" @tap="toggleDirGroup('friends')">
              <text class="pws-chevron" :class="{ open: dirExpanded.friends }">›</text>
              <view class="pws-dir-icon friends">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path v-for="(d, gi) in (ICONS.userPlus || ICONS.projectIm)" :key="gi" :d="d" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </view>
              <view class="pws-dir-title-wrap">
                <text class="pws-dir-title">我的朋友</text>
                <text class="pws-dir-subtitle">个人通讯录 · 项目客户</text>
              </view>
              <text class="pws-dir-count">{{ filteredFriends.length }}</text>
            </view>
            <view v-if="dirExpanded.friends" class="pws-dir-body">
              <view
                v-for="fr in filteredFriends"
                :key="'fr-' + fr.id + '-' + fr.name"
                class="pws-contact-row"
                @tap="startContactChat(fr, 'friend')"
              >
                <view class="pws-contact-avatar friend">
                  <text>{{ avatarChar(fr.name) }}</text>
                </view>
                <view class="pws-contact-main">
                  <view class="pws-contact-line">
                    <text class="pws-contact-name">{{ fr.name }}</text>
                    <text class="pws-contact-badge">{{ fr.roleLabel || '外部朋友' }}</text>
                  </view>
                  <text class="pws-contact-meta">{{ fr.org || fr.note || (fr.source === 'project' ? '当前项目客户' : '') }}</text>
                </view>
                <view class="pws-contact-action" @tap.stop="startContactChat(fr, 'friend')">
                  <text>发消息</text>
                </view>
              </view>
              <text v-if="!filteredFriends.length" class="pws-dir-empty-text">{{ kw ? '没有匹配的朋友' : '还没有朋友。朋友只保存在本机当前账户下，切换团队或律所不影响。' }}</text>
              <view class="pws-dir-foot-btn" @tap="toggleAddFriendForm">
                <text>+ 添加外部朋友或客户联系人</text>
              </view>
            </view>
          </view>
        </view>

        <!-- ===== 第二层级：对话列表（置于通讯录下方） ===== -->
        <view class="pws-section pws-conv-section">
          <view class="pws-sec-bar">
            <text class="pws-sec-label">对话列表</text>
            <view class="pws-sec-right">
              <text class="pws-sec-count">{{ filteredConversations.length }}</text>
              <view class="pws-icon-action" title="刷新会话" @tap="loadImData">
                <svg :class="{ spinning: loadingIm }" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path v-for="(d, gi) in ICONS.refresh" :key="gi" :d="d" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </view>
            </view>
          </view>

          <view class="pws-conv-filters">
            <view
              v-for="tab in CONV_FILTERS"
              :key="tab.key"
              class="pws-filter-pill"
              :class="{ active: convFilter === tab.key }"
              @tap="convFilter = tab.key"
            >
              <text>{{ tab.label }}</text>
            </view>
          </view>

          <view v-if="filteredConversations.length === 0" class="pws-conv-empty">
            <text class="pws-conv-empty-title">{{ searchKeyword ? '没有匹配的对话' : '暂无活跃对话' }}</text>
            <text class="pws-conv-empty-desc">点击上方通讯录中的组织成员、律所团队或朋友即可直接发起对话，也可新建群聊或凭邀请码加入。</text>
            <view class="pws-conv-empty-actions">
              <view class="pws-quick-btn primary" @tap="emitCommand('open-new-chat')">
                <text>新建会话</text>
              </view>
              <view class="pws-quick-btn" @tap="emitCommand('open-join-chat')">
                <text>邀请码加入</text>
              </view>
            </view>
          </view>

          <view v-else class="pws-conv-list">
            <view
              v-for="c in filteredConversations"
              :key="c.id"
              class="pws-conv-item"
              :class="{ active: activeConversationId === c.id }"
              @tap="selectConversation(c)"
            >
              <view class="pws-conv-avatar" :class="c.type === 'DIRECT' ? 'direct' : 'group'">
                <text>{{ c.type === 'DIRECT' ? '私' : '群' }}</text>
              </view>
              <view class="pws-conv-main">
                <view class="pws-conv-top">
                  <text class="pws-conv-title">{{ c.title }}</text>
                  <text v-if="c.unreadCount" class="pws-conv-unread">{{ c.unreadCount > 99 ? '99+' : c.unreadCount }}</text>
                </view>
                <text class="pws-conv-sub">{{ c.type === 'DIRECT' ? '私聊' : '群聊' }} · {{ roleName(c.role) }}</text>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>
    </template>

    <!-- ==================== 2. 包晴天 · 案源与笔记（品牌形象 + 案源/笔记双栏导航） ==================== -->
    <template v-else-if="plugin.pluginId === 'baoqingtian'">
      <view class="pws-brand-card">
        <image src="/static/icons/plugin-baoqingtian.png" class="pws-brand-avatar" mode="aspectFill" />
        <view class="pws-brand-info">
          <text class="pws-brand-name">{{ plugin.label }}</text>
          <text class="pws-brand-desc">浏览案源广场，管理在包晴天发布的笔记与草稿</text>
        </view>
      </view>

      <scroll-view scroll-y class="pws-scroll">
        <view class="pws-section">
          <view class="pws-sec-bar">
            <text class="pws-sec-label">工作视图</text>
          </view>
          <view class="pws-nav-list">
            <view
              class="pws-nav-item"
              :class="{ active: bqtView === 'cases' }"
              @tap="switchBqtView('cases')"
            >
              <view class="pws-nav-dot"></view>
              <view class="pws-nav-main">
                <text class="pws-nav-title">案源广场</text>
                <text class="pws-nav-sub">了解法律需求，找到合适的合作机会</text>
              </view>
            </view>
            <view
              class="pws-nav-item"
              :class="{ active: bqtView === 'notes' }"
              @tap="switchBqtView('notes')"
            >
              <view class="pws-nav-dot"></view>
              <view class="pws-nav-main">
                <text class="pws-nav-title">我的笔记</text>
                <text class="pws-nav-sub">管理已发布的图文笔记和草稿</text>
              </view>
            </view>
          </view>
        </view>

        <view class="pws-section">
          <view class="pws-sec-bar">
            <text class="pws-sec-label">笔记状态筛选</text>
          </view>
          <view class="pws-conv-filters">
            <view
              v-for="st in BQT_STATUS_FILTERS"
              :key="st.key"
              class="pws-filter-pill"
              :class="{ active: bqtStatus === st.key }"
              @tap="filterBqtStatus(st.key)"
            >
              <text>{{ st.label }}</text>
            </view>
          </view>
        </view>

        <view class="pws-section">
          <view class="pws-sec-bar">
            <text class="pws-sec-label">快捷操作</text>
          </view>
          <view class="pws-action-stack">
            <view class="pws-action-row primary" @tap="emitBqtCommand('new-note')">
              <text>+ 新建笔记</text>
            </view>
            <view class="pws-action-row" @tap="emitBqtCommand('refresh')">
              <text>刷新当前列表</text>
            </view>
            <view class="pws-action-row" @tap="$emit('open')">
              <text>在中栏打开包晴天工作区</text>
            </view>
          </view>
        </view>
      </scroll-view>
    </template>

    <!-- ==================== 3. 律所管理 / 尽调报告 / 腾讯会议 / 其余动态插件 ==================== -->
    <template v-else>
      <view class="pws-brand-card">
        <view class="pws-brand-glyph">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path v-for="(d, gi) in pluginGlyph" :key="gi" :d="d" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </view>
        <view class="pws-brand-info">
          <text class="pws-brand-name">{{ plugin.label }}</text>
          <text class="pws-brand-desc">{{ plugin.description || $t('panels.pgWorkspaceHint') }}</text>
        </view>
      </view>

      <scroll-view scroll-y class="pws-scroll">
        <view v-if="isLawFirmPlugin" class="lawfirm-summary-card">
          <view class="lawfirm-stat-grid">
            <view class="lawfirm-stat-item">
              <text class="lawfirm-stat-label">在办案件</text>
              <text class="lawfirm-stat-val">{{ lawfirmStats.activeMatters }}</text>
            </view>
            <view class="lawfirm-stat-item">
              <text class="lawfirm-stat-label">待审利冲</text>
              <text class="lawfirm-stat-val warn">{{ lawfirmStats.pendingClearances }}</text>
            </view>
            <view class="lawfirm-stat-item">
              <text class="lawfirm-stat-label">签约总额</text>
              <text class="lawfirm-stat-val">{{ lawfirmStats.contractedText }}</text>
            </view>
            <view class="lawfirm-stat-item">
              <text class="lawfirm-stat-label">实收到账</text>
              <text class="lawfirm-stat-val accent">{{ lawfirmStats.collectedText }}</text>
            </view>
          </view>
          <view class="lawfirm-quick-jumps">
            <button class="lawfirm-jump-btn" @tap="openLawFirmTab('intake')">立案与利冲</button>
            <button class="lawfirm-jump-btn" @tap="openLawFirmTab('finance')">开票与财务</button>
            <button class="lawfirm-jump-btn" @tap="openLawFirmTab('dashboard')">全所三维看板</button>
            <button class="lawfirm-jump-btn" @tap="openLawFirmTab('oa')">OA与IM联动</button>
          </view>
        </view>

        <view v-if="plugin.pluginId === 'due-diligence'" class="pws-section">
          <view class="pws-sec-bar">
            <text class="pws-sec-label">尽调作业阶段</text>
            <text class="pws-sec-sub">6 步标准流程</text>
          </view>
          <view class="pws-nav-list">
            <view
              v-for="(stage, idx) in DD_STAGES"
              :key="stage.key"
              class="pws-nav-item"
              :class="{ active: activeStageKey === stage.key }"
              @tap="selectDdStage(stage)"
            >
              <text class="pws-stage-num">{{ idx + 1 }}</text>
              <view class="pws-nav-main">
                <text class="pws-nav-title">{{ stage.title }}</text>
                <text class="pws-nav-sub">{{ stage.desc }}</text>
              </view>
            </view>
          </view>
        </view>

        <view class="pws-section">
          <view class="pws-sec-bar">
            <text class="pws-sec-label">工作区与 AI 协同</text>
          </view>
          <view class="pws-action-stack">
            <view class="pws-action-row primary" @tap="$emit('open')">
              <text>{{ $t('panels.pgOpenWorkspace') }}</text>
            </view>
            <template v-if="plugin.pluginId === 'due-diligence'">
              <view class="pws-action-row" @tap="emitAiPrompt('请根据当前项目的尽调清单与已上传材料，核查尚缺哪些关键尽调底稿并列出补充清单。')">
                <text>AI 核查尽调材料缺口</text>
              </view>
              <view class="pws-action-row" @tap="emitAiPrompt('请汇总当前项目已识别的法律尽调核心风险点，按重大风险、一般风险及整改建议生成结构化摘要。')">
                <text>AI 汇总尽调核心风险矩阵</text>
              </view>
            </template>
            <template v-else-if="plugin.pluginId === 'tencent-meeting'">
              <view class="pws-action-row" @tap="emitAiPrompt('请梳理当前项目中的腾讯会议转写记录，提炼各方核心诉求、争议焦点与会后待办事项。')">
                <text>AI 提炼会议纪要与待办</text>
              </view>
            </template>
          </view>
        </view>
      </scroll-view>
    </template>
  </view>
</template>

<script>
import { ICONS } from '@/config/icons.js'
import { getPluginGlyphPaths } from '@/config/pluginIcons.js'
import { getTeam, getProjectMembers, getCurrentUser, requestPluginIm, getLawFirmOverview } from '@/services/api.js'
import { loadImDirectory, addImFriend } from '@/utils/imDirectory.js'
import { ORG_CHANGED_EVENT } from '@/utils/orgContext.js'
import { ACCOUNT_CHANGED_EVENT } from '@/utils/requireAccount.js'

const FRIEND_ROLE_TAGS = ['外部合作律师', '客户联系人', '行业专家', '对方法务']

const CONV_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'GROUP', label: '群聊' },
  { key: 'DIRECT', label: '私聊' },
]

// 与插件 status-filter 选项一致（official-plugins/baoqingtian/web/index.html）
const BQT_STATUS_FILTERS = [
  { key: '', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'published', label: '公开发布' },
  { key: 'private', label: '仅自己可见' },
]

const DD_STAGES = [
  { key: 'checklist', title: '尽调清单与范围', desc: '按行业与交易类型生成定制尽调清单' },
  { key: 'collection', title: '资料收集与核验', desc: '对照清单跟踪材料齐备度与交叉印证' },
  { key: 'entity', title: '主体与历史沿革', desc: '股权结构、工商变更与实控人核查' },
  { key: 'contracts', title: '重大合同与债权债务', desc: '业务合同、担保、关联交易合规审查' },
  { key: 'litigation', title: '涉诉行政处罚核查', desc: '裁判文书、执行信息与监管处罚梳理' },
  { key: 'report', title: '尽调报告起草与复核', desc: '分章节起草法律尽调报告并锚定证据' },
]

export default {
  name: 'PluginWorkspaceSummary',
  props: {
    plugin: { type: Object, required: true },
    projectId: { type: [String, Number], default: '' },
  },
  emits: ['open', 'quick-action'],
  data() {
    return {
      lawfirmOverview: null,
      searchKeyword: '',
      dirExpanded: {
        org: true,
        firm: true,
        friends: true,
      },
      showAddFriend: false,
      friendDraft: {
        name: '',
        org: '',
        roleLabel: '外部合作律师',
      },
      // 只放真实数据：organization / firm 为 null 表示没有，界面给空态与入口
      directory: {
        accountKey: 'local',
        organization: null,
        firm: null,
        friends: [],
        capabilities: {},
      },
      orgMenuOpen: false,
      conversations: [],
      activeConversationId: '',
      convFilter: 'all',
      loadingIm: false,
      bqtView: 'cases',
      bqtStatus: '',
      activeStageKey: 'checklist',
    }
  },
  computed: {
    isLawFirmPlugin() {
      return !!(this.plugin && this.plugin.pluginId === 'lawfirm-management')
    },
    lawfirmStats() {
      const ov = this.lawfirmOverview || {}
      const d = ov.kpi || ov.kpis || (ov.dashboard && (ov.dashboard.kpi || ov.dashboard.kpis)) || ov.dashboard || {}
      const matters = Array.isArray(ov.intakes) ? ov.intakes : (Array.isArray(ov.matters) ? ov.matters : [])
      const clearances = Array.isArray(ov.clearances) ? ov.clearances : []
      const activeMatters = d.activeMatterCount ?? d.activeCases ?? d.activeMatters ?? matters.length
      const pendingClearances = d.pendingClearances ?? clearances.filter((c) => c.decision === 'PENDING' || c.status === 'PENDING').length
      const contractedCents = d.totalContractedCents ?? d.contractedCents
      const collectedCents = d.totalCollectedCents ?? d.collectedCents
      const contractedWan = d.totalContractedWan ?? (contractedCents != null ? (Number(contractedCents) / 1000000).toFixed(2) : '0.00')
      const collectedWan = d.totalCollectedWan ?? (collectedCents != null ? (Number(collectedCents) / 1000000).toFixed(2) : '0.00')
      return {
        activeMatters,
        pendingClearances,
        contractedText: `${contractedWan} 万`,
        collectedText: `${collectedWan} 万`,
      }
    },
    ICONS() {
      return ICONS
    },
    FRIEND_ROLE_TAGS() {
      return FRIEND_ROLE_TAGS
    },
    CONV_FILTERS() {
      return CONV_FILTERS
    },
    BQT_STATUS_FILTERS() {
      return BQT_STATUS_FILTERS
    },
    DD_STAGES() {
      return DD_STAGES
    },
    pluginGlyph() {
      return getPluginGlyphPaths(this.plugin && this.plugin.pluginId)
    },
    kw() {
      return String(this.searchKeyword || '').trim().toLowerCase()
    },
    orgSubtitle() {
      const org = this.directory.organization
      const firm = this.directory.firm
      if (!org) return '加入团队后可看到同事与律所'
      const parts = []
      if (org.myRoleLabel) parts.push(org.myRoleLabel)
      parts.push(firm ? ('律所：' + (firm.name || '未命名') + (firm.isHead ? '（总部团队）' : '')) : '未并入律所')
      return parts.join(' · ')
    },
    // 与 TeamPanel 的 canLeave / canLeaveFirm 同口径，只解释「能不能切、为什么」
    orgSwitchHint() {
      const org = this.directory.organization
      const firm = this.directory.firm
      const cap = this.directory.capabilities || {}
      if (!org) return '一个账户同一时间只属于一个团队。可在「设置 › 团队」创建团队或用邀请码加入。'
      if (cap.isTeamOwner && firm && firm.isHead) return '你是总部团队负责人：负责人不能退出团队，总部团队也不能退出律所。'
      if (cap.isTeamOwner && firm) return '你是团队负责人：不能切换团队，但可以把本团队切换到其他律所。'
      if (cap.isTeamOwner) return '你是团队负责人：不能切换团队，可以创建律所或用律所邀请码并入。'
      return '切换团队会先退出当前团队再加入新团队；律所由团队负责人切换。已有项目会话按会话成员身份保留。'
    },
    firmEmptyText() {
      const cap = this.directory.capabilities || {}
      if (!this.directory.organization) return '加入团队后，团队可以并入律所。'
      return cap.isTeamOwner ? '本团队尚未并入律所。你可以创建律所或用律所邀请码并入。' : '本团队尚未并入律所，由团队负责人操作。'
    },
    filteredOrgMembers() {
      const list = ((this.directory.organization && this.directory.organization.members) || []).filter(m => !m.isMe)
      if (!this.kw) return list
      return list.filter(m => (m.name + ' ' + (m.roleLabel || '')).toLowerCase().includes(this.kw))
    },
    filteredFirmTeams() {
      const list = (this.directory.firm && this.directory.firm.teams) || []
      if (!this.kw) return list
      return list.filter(t => String(t.name || '').toLowerCase().includes(this.kw))
    },
    filteredFriends() {
      const list = this.directory.friends || []
      if (!this.kw) return list
      return list.filter(f => (f.name + ' ' + (f.org || '') + ' ' + (f.roleLabel || '')).toLowerCase().includes(this.kw))
    },
    filteredConversations() {
      let list = this.conversations || []
      if (this.convFilter === 'unread') {
        list = list.filter(c => Number(c.unreadCount) > 0)
      } else if (this.convFilter === 'GROUP' || this.convFilter === 'DIRECT') {
        list = list.filter(c => c.type === this.convFilter)
      }
      if (!this.kw) return list
      return list.filter(c => String(c.title || '').toLowerCase().includes(this.kw))
    },
  },
  watch: {
    'plugin.pluginId': {
      immediate: true,
      handler(val) {
        if (val === 'lawfirm-management') {
          this.loadLawFirmSummary()
        } else if (val === 'project-im') {
          this.loadImData()
        }
      },
    },
    projectId() {
      if (this.plugin && this.plugin.pluginId === 'project-im') {
        this.loadImData()
      } else if (this.plugin && this.plugin.pluginId === 'lawfirm-management') {
        this.loadLawFirmSummary()
      }
    },
  },
  mounted() {
    this._onImDirectoryChanged = () => {
      if (this.plugin && this.plugin.pluginId === 'project-im') {
        this.loadDirectoryOnly()
      }
    }
    this._onPluginStateSynced = (payload) => {
      if (!payload || payload.pluginId !== this.plugin.pluginId) return
      if (payload.pluginId === 'project-im') {
        if (payload.activeConversationId !== undefined) {
          this.activeConversationId = payload.activeConversationId || ''
        }
        if (Array.isArray(payload.conversations)) {
          this.conversations = payload.conversations
        }
      } else if (payload.pluginId === 'baoqingtian') {
        if (payload.view) this.bqtView = payload.view
        if (payload.status !== undefined) this.bqtStatus = payload.status || ''
      }
    }
    uni.$on('awd:im-directory-changed', this._onImDirectoryChanged)
    uni.$on('awd:plugin-state-synced', this._onPluginStateSynced)
    // 团队 / 律所切换、账户切换：丢掉旧组织的通讯录重新拉（朋友按账户隔离，账户切换后自然换一份）
    this._onOrgOrAccountChanged = () => {
      this.orgMenuOpen = false
      if (this.plugin && this.plugin.pluginId === 'project-im') this.loadImData()
    }
    uni.$on(ORG_CHANGED_EVENT, this._onOrgOrAccountChanged)
    uni.$on(ACCOUNT_CHANGED_EVENT, this._onOrgOrAccountChanged)
  },
  beforeUnmount() {
    if (this._onImDirectoryChanged) uni.$off('awd:im-directory-changed', this._onImDirectoryChanged)
    if (this._onPluginStateSynced) uni.$off('awd:plugin-state-synced', this._onPluginStateSynced)
    if (this._onOrgOrAccountChanged) {
      uni.$off(ORG_CHANGED_EVENT, this._onOrgOrAccountChanged)
      uni.$off(ACCOUNT_CHANGED_EVENT, this._onOrgOrAccountChanged)
    }
  },
  methods: {
    async loadLawFirmSummary() {
      try {
        const res = await getLawFirmOverview(this.projectId ? { projectId: this.projectId } : {})
        const payload = res && res.data && ('intakes' in res.data || 'matters' in res.data || 'dashboard' in res.data || 'overview' in res.data || 'kpi' in res.data)
          ? res.data
          : res
        if (payload) {
          this.lawfirmOverview = payload.overview || payload
        }
      } catch (e) {
        // ignore
      }
    },
    openLawFirmTab(tab) {
      this.$emit('open')
      setTimeout(() => {
        uni.$emit('awd:lawfirm-tab', tab)
      }, 80)
    },
    avatarChar(name) {
      const s = String(name || '').trim()
      return s ? s.slice(0, 1) : '联'
    },
    roleName(role) {
      const map = { OWNER: '负责人', ADMIN: '管理员', MEMBER: '成员', CLIENT: '客户' }
      return map[role] || '成员'
    },
    toggleDirGroup(key) {
      this.dirExpanded[key] = !this.dirExpanded[key]
    },
    toggleAddFriendForm() {
      this.showAddFriend = !this.showAddFriend
    },
    openOrgSettings() {
      this.orgMenuOpen = false
      uni.$emit('awd:open-settings', { nav: 'team' })
    },
    submitAddFriend() {
      const name = String(this.friendDraft.name || '').trim()
      if (!name) {
        uni.showToast({ title: '请输入联系人姓名', icon: 'none' })
        return
      }
      try {
        const res = addImFriend(this.directory.accountKey, {
          name,
          org: this.friendDraft.org,
          roleLabel: this.friendDraft.roleLabel,
        })
        this.directory.friends = [Object.assign({ source: 'personal' }, res.added), ...this.directory.friends.filter(f => f.name !== name)]
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '添加失败', icon: 'none' })
        return
      }
      this.friendDraft.name = ''
      this.friendDraft.org = ''
      this.showAddFriend = false
      this.dirExpanded.friends = true
      this.emitCommand('refresh-directory', { reason: 'manual' })
      uni.showToast({ title: '已添加到「我的朋友」', icon: 'none' })
    },
    async loadDirectoryOnly() {
      const dir = await loadImDirectory({
        projectId: this.projectId,
        deps: { getTeam, getProjectMembers, getCurrentUser },
      })
      this.directory = dir
    },
    async loadImData() {
      this.loadingIm = true
      try {
        await this.loadDirectoryOnly()
        if (this.projectId) {
          const res = await requestPluginIm('project-im', this.projectId, 'list', {})
          if (res && res.code === 0 && res.data && Array.isArray(res.data.conversations)) {
            this.conversations = res.data.conversations
          }
        }
      } catch (e) {
        // 离线或未连接云账户时保留通讯录可用
      } finally {
        this.loadingIm = false
      }
    },
    emitCommand(command, extra = {}) {
      this.$emit('quick-action', Object.assign({
        pluginId: this.plugin.pluginId,
        command,
      }, extra))
    },
    selectConversation(c) {
      if (!c) return
      this.activeConversationId = c.id
      this.emitCommand('select-conversation', { conversationId: c.id, title: c.title })
    },
    startContactChat(contact, category) {
      if (!contact) return
      const existing = (this.conversations || []).find(c => c.type === 'DIRECT' && c.title === contact.name)
      if (existing) {
        this.selectConversation(existing)
        return
      }
      this.emitCommand('start-direct-chat', {
        contact: { name: contact.name, roleLabel: contact.roleLabel || '', org: contact.org || '' },
        category,
      })
    },
    startGroupChat(groupTitle) {
      const existing = (this.conversations || []).find(c => c.title === groupTitle)
      if (existing) {
        this.selectConversation(existing)
        return
      }
      this.emitCommand('start-group-chat', {
        title: groupTitle,
      })
    },
    switchBqtView(view) {
      this.bqtView = view
      this.emitCommand('switch-view', { view })
    },
    filterBqtStatus(status) {
      this.bqtStatus = status
      this.bqtView = 'notes'
      this.emitCommand('filter-status', { status })
    },
    emitBqtCommand(cmd) {
      this.emitCommand(cmd)
    },
    selectDdStage(stage) {
      this.activeStageKey = stage.key
      this.$emit('open')
    },
    emitAiPrompt(aiPrompt) {
      this.$emit('quick-action', {
        pluginId: this.plugin.pluginId,
        aiPrompt,
      })
    },
  },
}
</script>

<style scoped>
.lawfirm-summary-card { display: flex; flex-direction: column; gap: 10px; margin: 10px 8px 6px; padding: 10px; border-radius: var(--awd-radius-md); background: var(--awd-surface-2); border: 1px solid var(--awd-border-subtle); }
.lawfirm-stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.lawfirm-stat-item { padding: 8px; border-radius: var(--awd-radius-sm); background: var(--awd-surface); border: 1px solid var(--awd-border-subtle); }
.lawfirm-stat-label { display: block; font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); }
.lawfirm-stat-val { display: block; margin-top: 2px; font-size: var(--awd-font-size-reading); font-weight: 600; color: var(--awd-text); font-variant-numeric: tabular-nums; }
.lawfirm-stat-val.warn { color: var(--awd-warning); }
.lawfirm-stat-val.accent { color: var(--awd-accent); }
.lawfirm-quick-jumps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.lawfirm-jump-btn { min-height: 30px; line-height: 28px; padding: 0 8px; margin: 0; font-size: var(--awd-panel-fs); color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); }

.pws-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--awd-bg);
  color: var(--awd-text);
  font-size: var(--awd-panel-fs);
}

.pws-org-card {
  margin: 8px 10px 4px;
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  background: var(--awd-surface);
  overflow: hidden;
}
.pws-org-main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  cursor: pointer;
}
.pws-org-main:hover { background: var(--awd-accent-wash); }
.pws-org-avatar {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--awd-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--awd-accent);
  color: var(--awd-text-on-accent);
  font-weight: 700;
}
.pws-org-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pws-org-name, .pws-org-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pws-org-name { font-weight: 600; font-size: var(--awd-font-size-body); }
.pws-org-sub { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); }
.pws-org-menu {
  border-top: 1px solid var(--awd-border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--awd-bg);
}
.pws-org-hint { font-size: var(--awd-panel-fs-meta); line-height: 1.5; color: var(--awd-text-2); }
.pws-org-team { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 6px; border-radius: var(--awd-radius-sm); }
.pws-org-team.mine { background: var(--awd-accent-wash); }
.pws-org-team-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--awd-panel-fs); }
.pws-org-team-tag { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); flex-shrink: 0; }
.pws-org-actions { display: flex; }
.pws-dir-empty { display: flex; flex-direction: column; gap: 4px; }
.pws-dir-empty-text { display: block; padding: 4px 8px; font-size: var(--awd-panel-fs-meta); line-height: 1.5; color: var(--awd-text-2); }

.pws-im-top {
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--awd-border);
  background: var(--awd-surface);
  flex-shrink: 0;
}

.pws-search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-bg);
  border: 1px solid var(--awd-border);
}

.pws-search-icon {
  width: 13px;
  height: 13px;
  color: var(--awd-text-3);
  flex-shrink: 0;
}

.pws-search-input {
  flex: 1;
  min-width: 0;
  font-size: var(--awd-panel-fs);
  color: var(--awd-text);
  background: transparent;
  border: 0;
}

.pws-search-clear {
  font-size: var(--awd-font-size-reading);
  color: var(--awd-text-3);
  cursor: pointer;
  padding: 0 2px;
}

.pws-im-quick-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.pws-quick-btn {
  flex: 1;
  height: 25px;
  border-radius: var(--awd-radius-sm);
  border: 1px solid var(--awd-border);
  background: var(--awd-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0 6px;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.pws-quick-btn text {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 500;
  color: var(--awd-text);
}

.pws-quick-btn:hover {
  background: var(--awd-accent-wash);
  border-color: var(--awd-accent);
}

.pws-quick-btn.primary {
  background: var(--awd-accent);
  border-color: var(--awd-accent);
}

.pws-quick-btn.primary text {
  color: var(--awd-text-on-accent);
  font-weight: 600;
}

.pws-friend-form {
  margin-top: 8px;
  padding: 8px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-bg);
  border: 1px solid var(--awd-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pws-form-title {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  color: var(--awd-text-2);
}

.pws-form-input {
  height: 26px;
  padding: 0 8px;
  font-size: var(--awd-panel-fs);
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  color: var(--awd-text);
}

.pws-form-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pws-form-tag {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--awd-border);
  background: var(--awd-surface);
  cursor: pointer;
}

.pws-form-tag text {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
}

.pws-form-tag.active {
  background: var(--awd-accent-soft);
  border-color: var(--awd-accent);
}

.pws-form-tag.active text {
  color: var(--awd-accent-text);
  font-weight: 600;
}

.pws-form-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.pws-scroll {
  flex: 1;
  min-height: 0;
}

.pws-section {
  padding: 8px 0 4px;
  border-bottom: 1px solid var(--awd-border);
}

.pws-sec-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 12px 6px;
  cursor: pointer;
}

.pws-sec-label {
  font-size: var(--awd-panel-fs-sec);
  font-weight: 700;
  color: var(--awd-text-2);
  letter-spacing: 0.4px;
}

.pws-sec-sub {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-3);
}

.pws-sec-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pws-sec-count {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-3);
  font-variant-numeric: tabular-nums;
}

.pws-icon-action {
  width: 18px;
  height: 18px;
  border-radius: var(--awd-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--awd-text-2);
  cursor: pointer;
}

.pws-icon-action:hover {
  background: var(--awd-surface-2);
  color: var(--awd-text);
}

.pws-icon-action svg {
  width: 12px;
  height: 12px;
}

.pws-dir-group {
  margin: 0 6px 4px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border-subtle, var(--awd-border));
  overflow: hidden;
}

.pws-dir-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  cursor: pointer;
  user-select: none;
}

.pws-dir-head:hover {
  background: var(--awd-accent-wash);
}

.pws-chevron {
  font-size: var(--awd-font-size-body);
  color: var(--awd-text-3);
  width: 10px;
  text-align: center;
  transition: transform 0.15s ease;
}

.pws-chevron.open {
  transform: rotate(90deg);
}

.pws-dir-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--awd-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pws-dir-icon svg {
  width: 14px;
  height: 14px;
}

.pws-dir-icon.org {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
}

.pws-dir-icon.firm {
  background: var(--awd-info-soft);
  color: var(--awd-info-text);
}

.pws-dir-icon.friends {
  background: var(--awd-warning-soft);
  color: var(--awd-warning-text);
}

.pws-dir-title-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pws-dir-title {
  font-size: var(--awd-panel-fs);
  font-weight: 600;
  color: var(--awd-text);
  line-height: 1.25;
}

.pws-dir-subtitle {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pws-dir-count {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  color: var(--awd-text-3);
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--awd-bg);
}

.pws-dir-body {
  border-top: 1px solid var(--awd-border-subtle, var(--awd-border));
  padding: 4px 0;
  background: var(--awd-bg);
}

.pws-contact-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 14px;
  cursor: pointer;
}

.pws-contact-row:hover {
  background: var(--awd-accent-wash);
}

.pws-contact-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
}

.pws-contact-avatar.org {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
}

.pws-contact-avatar.firm {
  background: var(--awd-info-soft);
  color: var(--awd-info-text);
  border-radius: var(--awd-radius-sm);
}

.pws-contact-avatar.friend {
  background: var(--awd-warning-soft);
  color: var(--awd-warning-text);
}

.pws-contact-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pws-contact-line {
  display: flex;
  align-items: center;
  gap: 5px;
}

.pws-contact-name {
  font-size: var(--awd-panel-fs);
  font-weight: 500;
  color: var(--awd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pws-contact-badge {
  font-size: var(--awd-panel-fs-meta);
  padding: 0 5px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  color: var(--awd-text-2);
  flex-shrink: 0;
}

.pws-contact-meta {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pws-contact-action {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  opacity: 0.88;
}

.pws-contact-action text {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-accent-text);
  font-weight: 600;
}

.pws-contact-row:hover .pws-contact-action {
  opacity: 1;
  border-color: var(--awd-accent);
  background: var(--awd-accent-soft);
}

.pws-dir-foot-btn {
  margin: 4px 8px 2px 14px;
  padding: 4px 8px;
  border-radius: var(--awd-radius-sm);
  border: 1px dashed var(--awd-border);
  text-align: center;
  cursor: pointer;
}

.pws-dir-foot-btn text {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-accent-text);
  font-weight: 500;
}

.pws-dir-foot-btn:hover {
  background: var(--awd-accent-wash);
  border-color: var(--awd-accent);
}

.pws-conv-section {
  border-bottom: 0;
  padding-bottom: 16px;
}

.pws-conv-filters {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px 8px;
  flex-wrap: wrap;
}

.pws-filter-pill {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  cursor: pointer;
}

.pws-filter-pill text {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
}

.pws-filter-pill.active {
  background: var(--awd-accent-soft);
  border-color: var(--awd-accent);
}

.pws-filter-pill.active text {
  color: var(--awd-accent-text);
  font-weight: 600;
}

.pws-conv-empty {
  margin: 4px 10px;
  padding: 12px 10px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pws-conv-empty-title {
  font-size: var(--awd-panel-fs);
  font-weight: 600;
  color: var(--awd-text);
}

.pws-conv-empty-desc {
  font-size: var(--awd-panel-fs-meta);
  line-height: 1.5;
  color: var(--awd-text-2);
}

.pws-conv-empty-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.pws-conv-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 6px;
}

.pws-conv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--awd-radius-sm);
  cursor: pointer;
}

.pws-conv-item:hover {
  background: var(--awd-accent-wash);
}

.pws-conv-item.active {
  background: var(--awd-accent-soft);
}

.pws-conv-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--awd-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: var(--awd-panel-fs-meta);
  font-weight: 700;
}

.pws-conv-avatar.group {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
  border: 1px solid var(--awd-border);
}

.pws-conv-avatar.direct {
  background: var(--awd-surface-2);
  color: var(--awd-text);
  border: 1px solid var(--awd-border);
  border-radius: 50%;
}

.pws-conv-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pws-conv-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.pws-conv-title {
  font-size: var(--awd-panel-fs);
  font-weight: 600;
  color: var(--awd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pws-conv-unread {
  background: var(--awd-accent);
  color: var(--awd-text-on-accent);
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  padding: 0 5px;
  border-radius: 999px;
  line-height: 15px;
  flex-shrink: 0;
}

.pws-conv-sub {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-3);
}

/* ==================== 包晴天 & 通用插件左栏样式 ==================== */
.pws-brand-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: var(--awd-surface);
  border-bottom: 1px solid var(--awd-border);
}

.pws-brand-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1.5px solid var(--awd-border);
}

.pws-brand-glyph {
  width: 36px;
  height: 36px;
  border-radius: var(--awd-radius-md);
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pws-brand-glyph svg {
  width: 18px;
  height: 18px;
}

.pws-brand-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pws-brand-name {
  font-size: var(--awd-font-size-body);
  font-weight: 600;
  color: var(--awd-text);
}

.pws-brand-desc {
  font-size: var(--awd-panel-fs-meta);
  line-height: 1.4;
  color: var(--awd-text-2);
}

.pws-nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px 6px;
}

.pws-nav-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  cursor: pointer;
}

.pws-nav-item:hover {
  background: var(--awd-accent-wash);
}

.pws-nav-item.active {
  background: var(--awd-accent-soft);
  border-color: var(--awd-accent);
}

.pws-nav-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--awd-accent);
  margin-top: 5px;
  flex-shrink: 0;
}

.pws-stage-num {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
  font-size: var(--awd-panel-fs-meta);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.pws-nav-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pws-nav-title {
  font-size: var(--awd-panel-fs);
  font-weight: 600;
  color: var(--awd-text);
}

.pws-nav-sub {
  font-size: var(--awd-panel-fs-meta);
  line-height: 1.4;
  color: var(--awd-text-2);
}

.pws-action-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 8px;
}

.pws-action-row {
  padding: 7px 10px;
  border-radius: var(--awd-radius-sm);
  border: 1px solid var(--awd-border);
  background: var(--awd-surface);
  cursor: pointer;
  text-align: center;
}

.pws-action-row text {
  font-size: var(--awd-panel-fs);
  font-weight: 500;
  color: var(--awd-text);
}

.pws-action-row:hover {
  background: var(--awd-accent-wash);
  border-color: var(--awd-accent);
}

.pws-action-row.primary {
  background: var(--awd-accent);
  border-color: var(--awd-accent);
}

.pws-action-row.primary text {
  color: var(--awd-text-on-accent);
  font-weight: 600;
}
</style>
