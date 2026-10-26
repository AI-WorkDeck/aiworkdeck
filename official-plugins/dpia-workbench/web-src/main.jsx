// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Workbench } from 'dpia-upstream-client';
import { createHostAdapter } from './host-adapter.mjs';
import { EnvironmentPanel } from './environment-panel.jsx';

const root = createRoot(document.getElementById('app'));
const h = React.createElement;
let isEnglishMode = false;
const EN_EXACT = {
  'DPIA 工作台 · AI WorkDeck': 'DPIA Workbench · AI WorkDeck',
  'DPIA 工作台': 'DPIA Workbench',
  '材料、分析、补答、整改与报告，关联到同一评估版本。': 'Materials, analysis, Q&A follow-up, remediation, and reports linked to the same assessment revision.',
  '正在连接 AI WorkDeck…': 'Connecting to AI WorkDeck…',
  '正在处理，请稍候…': 'Processing, please wait…',
  '插件 SDK 未加载，请重新打开工作台': 'Plugin SDK not loaded; please reopen DPIA Workbench',
  '请先打开项目，再使用 DPIA 工作台': 'Please open a project first before using DPIA Workbench',
  '项目或账号已切换。请在当前项目重新打开 DPIA 工作台。': 'Project or account switched. Please reopen DPIA Workbench in the current project.',
  '运行环境与准备指引': 'Runtime Environment & Setup Guide',
  '收起运行环境': 'Hide Runtime Environment',
  '运行环境': 'Runtime Environment',
  '当前项目和已填写内容保持不变。安装软件或调整插件设置后，返回这里会重新检测。检查对象是插件运行所在的电脑或团队服务器。': 'Your current project and inputs remain intact. After installing software or updating plugin settings, return here to re-check.',
  '重新检测': 'Re-check Environment',
  '正在检测…': 'Checking…',
  '基础运行环境已就绪；实际报告仍须完成内容与逐页检查。': 'Base runtime environment is ready; reports still require content and page-by-page review.',
  '还有组件需要准备，按下方提示处理后可继续当前任务。': 'Some components still need setup. Follow the instructions below to continue.',
  '安装与路径设置': 'Installation & Path Settings',
  '评估案件': 'Assessment Cases',
  '搜索案件': 'Search cases',
  '搜索项目': 'Search cases',
  '案件筛选': 'Case filter',
  '当前案件': 'Active Cases',
  '待处理': 'Pending',
  '已归档': 'Archived',
  '没有匹配的案件。': 'No matching cases.',
  '测试样例（非正式评估）': 'Test Fixtures (Non-Production)',
  '刷新': 'Refresh',
  '新建评估': 'New Assessment',
  '创建评估': 'Create Assessment',
  '项目名称': 'Case Title',
  '新评估为空，不预设日志问题或合规结论。': 'New assessments start blank without preset questions or compliance conclusions.',
  '从材料开始': 'Start from Materials',
  '创建或选择一个评估。只有明确发起分析时才调用模型。': 'Create or select an assessment. The AI model is only invoked when you explicitly start an analysis.',
  '总览': 'Overview',
  '材料与事实': 'Materials & Facts',
  '问题与补答': 'Questions & Q&A',
  '评估与风险': 'Assessment & Risks',
  '整改与复评': 'Remediation & Re-assessment',
  '报告与版本': 'Reports & Versions',
  '开始分析': 'Start Analysis',
  '基于当前材料继续分析': 'Continue Analysis with Current Materials',
  '重试同一请求': 'Retry Same Request',
  '打开执行会话': 'Open Execution Session',
  '刷新运行状态': 'Refresh Run Status',
  '重试同步（不调用模型）': 'Retry Sync (No Model Call)',
  '中止当前任务': 'Cancel Current Task',
  '本轮结果': 'Current Revision Results',
  '本轮限制': 'Current Limitations',
  '既有成果': 'Existing Deliverables',
  '来源与证据': 'Sources & Evidence',
  '事实与来源': 'Facts & Sources',
  '人工记录': 'Manual Records',
  '具体问题与补答': 'Questions & Follow-up Answers',
  '筛查与维度': 'Screening & Dimensions',
  '风险及判断依据': 'Risks & Basis',
  '整改与效果复评': 'Remediation & Effectiveness Review',
  '报告生成与交付': 'Report Generation & Delivery',
  '意见、确认与审批记录': 'Opinions, Confirmations & Approvals',
  '案件归档与恢复': 'Case Archiving & Recovery',
  '归档案件': 'Archive Case',
  '恢复案件': 'Restore Case',
  '关闭 ×': 'Close ×',
  '关闭窗口': 'Close dialog'
};
function trEn(s) {
  if (!isEnglishMode || !s || typeof s !== 'string') return s;
  const t = s.trim();
  if (!t) return s;
  if (EN_EXACT[t]) return s.replace(t, EN_EXACT[t]);
  return s;
}
function walkAndTranslate(nodeRoot) {
  if (!isEnglishMode || !nodeRoot || typeof NodeFilter === 'undefined') return;
  const walker = document.createTreeWalker(nodeRoot, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.currentNode;
  while (node) {
    if (node.nodeType === 3) {
      const next = trEn(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    } else if (node.nodeType === 1) {
      for (const attr of ['placeholder', 'aria-label', 'title', 'alt']) {
        const val = node.getAttribute?.(attr);
        if (val) {
          const next = trEn(val);
          if (next !== val) node.setAttribute(attr, next);
        }
      }
    }
    node = walker.nextNode();
  }
}
function maybeEnableEnglish(ctx) {
  if (isEnglishMode) return;
  let lang = ctx?.language || ctx?.locale || '';
  if (!lang) {
    try { lang = localStorage.getItem('checkba_locale') || localStorage.getItem('awd_locale') || ''; } catch {}
  }
  if (!String(lang).toLowerCase().startsWith('en')) return;
  isEnglishMode = true;
  document.documentElement.lang = 'en-US';
  document.title = trEn(document.title);
  walkAndTranslate(document.body);
  if (typeof MutationObserver !== 'undefined') {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') {
          const next = trEn(m.target.nodeValue);
          if (next !== m.target.nodeValue) m.target.nodeValue = next;
        } else if (m.type === 'attributes') {
          const val = m.target.getAttribute?.(m.attributeName);
          if (val) {
            const next = trEn(val);
            if (next !== val) m.target.setAttribute(m.attributeName, next);
          }
        } else {
          for (const n of m.addedNodes) walkAndTranslate(n);
        }
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title', 'alt'] });
  }
}
maybeEnableEnglish(null);
function WorkbenchFrame({ adapter, events }) {
  const [open, setOpen] = React.useState(false);
  return h(React.Fragment, null,
    h(EnvironmentPanel, { adapter, events, open, setOpen }),
    h(Workbench, { ...adapter, openEnvironment: () => setOpen(true) }));
}
function message(text, error = false) {
  root.render(h('main', { className: 'boot-message', role: error ? 'alert' : 'status' }, trEn(text)));
}
message('正在连接 AI WorkDeck…');
async function start() {
  if (!window.awd) throw new Error('插件 SDK 未加载，请重新打开工作台');
  const awd = window.awd;
  const context = await awd.ready();
  maybeEnableEnglish(context);
  if (!context?.projectId) throw new Error('请先打开项目，再使用 DPIA 工作台');
  const adapter = createHostAdapter(awd);
  const onExternalLink = (event) => {
    const link = event.target.closest?.('a[href]');
    if (!link || !/^https?:\/\//i.test(link.href)) return;
    event.preventDefault();
    adapter.openUrl(link.href).catch((error) => {
      document.getElementById('host-error').textContent = '打开来源失败：' + error.message;
    });
  };
  const discard = () => {
    adapter.dispose();
    document.removeEventListener('click', onExternalLink, true);
    document.getElementById('host-error').textContent = '';
    message('项目或账号已切换。请在当前项目重新打开 DPIA 工作台。');
  };
  awd.events.on('project.switched', discard);
  awd.events.on('account.changed', discard);
  document.addEventListener('click', onExternalLink, true);
  root.render(h(WorkbenchFrame, { adapter, events: awd.events }));
}
start().catch((error) => message(error.message, true));
