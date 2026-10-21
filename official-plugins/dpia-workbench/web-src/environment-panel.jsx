// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect, useRef, useState } from 'react';
const links = [
  ['Node.js 官方下载（Mac / Windows）', 'https://nodejs.org/en/download'],
  ['Python 官方下载（Mac / Windows）', 'https://www.python.org/downloads/'],
  ['LibreOffice 官方下载（Mac / Windows）', 'https://www.libreoffice.org/download/'],
];
export function EnvironmentPanel({ adapter, events, open, setOpen }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const running = useRef(false), queued = useRef(false), generation = useRef(0);
  async function refresh() {
    if (running.current) { queued.current = true; return; }
    const current = ++generation.current;
    running.current = true; setBusy(true); setError('');
    try {
      const value = await adapter.rpc({ action: 'environmentCheck' });
      if (current === generation.current) setResult(value);
    } catch (e) { if (current === generation.current) setError(e.message); }
    finally { if (current === generation.current) {
      running.current = false; setBusy(false);
      if (queued.current) { queued.current = false; refresh(); }
    } }
  }
  useEffect(() => {
    if (!open) return;
    refresh();
    const focus = () => { if (document.visibilityState !== 'hidden') refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    const unsubscribe = events.on('settings.changed', refresh);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); unsubscribe?.(); };
  }, [open]);
  useEffect(() => () => { generation.current++; }, []);
  const windows = /^windows/i.test(result?.platform || '');
  const requirement = result?.requirementsPath || '插件目录/runtime/requirements.txt';
  const quoted = "'" + requirement.replaceAll("'", windows ? "''" : "'\\''") + "'";
  const commands = windows
    ? 'py -3 -m venv "$env:LOCALAPPDATA\\AIWorkDeck\\dpia-venv"\n& "$env:LOCALAPPDATA\\AIWorkDeck\\dpia-venv\\Scripts\\python.exe" -m pip install -r ' + quoted
    : 'python3 -m venv "$HOME/.aiworkdeck/dpia-venv"\n"$HOME/.aiworkdeck/dpia-venv/bin/python" -m pip install -r ' + quoted;
  return <section className="dpia-environment" style={{ padding: '12px 20px', borderBottom: '1px solid var(--dpia-border)', background: 'var(--dpia-surface)', color: 'var(--dpia-text)', ...(open ? { position: 'fixed', inset: 16, zIndex: 10000, overflowY: 'auto', boxShadow: '0 4px 24px #0004' } : {}) }}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起运行环境' : '运行环境与准备指引'}</button>
    {open && <div aria-label="DPIA 运行环境" style={{ maxWidth: 900, paddingTop: 12 }}>
      <h2>运行环境</h2>
      <p>当前项目和已填写内容保持不变。安装软件或调整插件设置后，返回这里会重新检测。检查对象是插件运行所在的电脑或团队服务器。</p>
      <button type="button" disabled={busy} onClick={refresh}>{busy ? '正在检测…' : '重新检测'}</button>
      {error && <p role="alert">{error}。请保留当前任务，稍后重新检测。</p>}
      {result && <>
        <p role="status">{result.ready ? '基础运行环境已就绪；实际报告仍须完成内容与逐页检查。' : '还有组件需要准备，按下方提示处理后可继续当前任务。'}</p>
        <ul>{(result.checks || []).map(check => <li key={check.id} style={{ marginBottom: 10 }}><strong>{check.label} · {check.status === 'ready' ? '可用' : '需处理'}</strong><div>{check.message}</div></li>)}</ul>
      </>}
      <h3>安装与路径设置</h3>
      <p>从官方网站选择对应操作系统的安装程序并完成安装；打开下载页不代表安装完成。Node.js 选择当前 LTS（至少 20）。</p>
      <ul>{links.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}</ul>
      <p>在「插件广场 → 已安装 → DPIA 工作台 → 插件设置」填写 Node.js、Python、LibreOffice 和 PDF 中文字体路径。若安装被系统或权限策略阻止，请按安装程序的具体提示处理，或联系设备管理员后重试。</p>
      <p>Python 文档依赖请安装到独立环境，避免改变其他软件。{windows ? 'Windows 可在 PowerShell 中运行：' : 'Mac 可在终端中运行：'}</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{commands}</pre>
      <p>将上述环境的 {windows ? 'Scripts\\python.exe' : 'bin/python'} 完整路径填入插件设置。已有独立环境可直接使用其 Python 安装本插件 requirements.txt。</p>
      <p>中文字体需可嵌入的 TTF/TTC；检测只验证“中文数据保护评估”这组字，报告仍会校验实际填写字符。准备完成后点击“重新检测”，再回到原任务重试。</p>
    </div>}
  </section>;
}
