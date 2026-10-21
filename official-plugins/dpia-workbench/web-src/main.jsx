// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Workbench } from 'dpia-upstream-client';
import { createHostAdapter } from './host-adapter.mjs';
import { EnvironmentPanel } from './environment-panel.jsx';

const root = createRoot(document.getElementById('app'));
const h = React.createElement;
function WorkbenchFrame({ adapter, events }) {
  const [open, setOpen] = React.useState(false);
  return h(React.Fragment, null,
    h(EnvironmentPanel, { adapter, events, open, setOpen }),
    h(Workbench, { ...adapter, openEnvironment: () => setOpen(true) }));
}
function message(text, error = false) {
  root.render(h('main', { className: 'boot-message', role: error ? 'alert' : 'status' }, text));
}
message('正在连接 AI WorkDeck…');
async function start() {
  if (!window.awd) throw new Error('插件 SDK 未加载，请重新打开工作台');
  const awd = window.awd;
  const context = await awd.ready();
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
