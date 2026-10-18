// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export function createHostAdapter(awd) {
  let active = true;
  const assertActive = () => { if (!active) throw new Error('项目或账号已切换，请重新打开 DPIA 工作台'); };
  async function rpc(payload) {
    assertActive();
    const output = await awd.tools.invoke('dpia_workbench_action', {
      action: payload.action, json: JSON.stringify(payload),
    });
    assertActive();
    let result;
    try { result = typeof output === 'string' ? JSON.parse(output) : output; }
    catch { throw new Error('工作台响应不完整，请刷新后核对状态'); }
    if (result?.ok !== true) {
      const error = new Error(result?.error?.message || '工作台操作失败');
      error.details = result?.error?.details;
      throw error;
    }
    return result.value;
  }
  return {
    rpc,
    dispose() { active = false; },
    async openSession(sessionId) {
      const info = await rpc({ action: 'sessionInfo', sessionId });
      if (typeof info?.conversationId !== 'string' || !info.conversationId) throw new Error('执行会话尚未建立');
      assertActive();
      await awd.call('chat.open', { conversationId: info.conversationId });
    },
    async openArtifact(artifact) {
      assertActive();
      if (typeof artifact?.path !== 'string' || !artifact.path.trim()) throw new Error('产物尚未保存到项目，请重试');
      await awd.ui.openFile(artifact.path);
    },
    async openUrl(url) {
      assertActive();
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('仅支持不含登录信息的 HTTPS 来源地址');
      await awd.call('ui.openUrl', { url: parsed.href });
    },
  };
}
