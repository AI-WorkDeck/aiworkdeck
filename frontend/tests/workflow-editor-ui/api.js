// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const records = {};
const sample = pid => [{
  skillId: 'contract-review',
  shortName: '合同审查',
  activeVersionId: 'default',
  activeVersionName: '系统默认版',
  activeIsSystemDefault: true,
  versions: [{
    id: 'default',
    name: '系统默认版',
    systemDefault: true,
    quickPrompt: '合成快捷指令' + pid,
    promptTemplate: '合成规则' + pid,
    output: '合成结果' + pid
  }, {
    id: 'custom-' + pid,
    name: '合成个人版本' + pid,
    systemDefault: false,
    quickPrompt: '个人指令' + pid,
    promptTemplate: '个人规则' + pid,
    output: '个人结果' + pid
  }]
}];
window.__workflowFixtures = {
  calls: [],
  delay: 0,
  holdMutations: false,
  pendingMutations: [],
  completedMutations: [],
  releaseMutations() {
    this.pendingMutations.splice(0).forEach(resolve => resolve());
  },
  fail: false
};
const f = window.__workflowFixtures;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitForMutation(type, pid) {
  if (f.holdMutations) await new Promise(resolve => f.pendingMutations.push(resolve));
  f.completedMutations.push([type, pid]);
}
export async function getBuiltinWorkflows(pid) {
  const data = JSON.parse(JSON.stringify(records[pid] || sample(pid)));
  f.calls.push(['get', pid]);
  await wait(f.delay);
  if (f.fail) throw Error('synthetic read error');
  return {
    workflows: data
  };
}
;
export async function saveBuiltinWorkflowVersion(id, payload) {
  f.calls.push(['save', id, payload]);
  const rows = JSON.parse(JSON.stringify(records[payload.projectId] || sample(payload.projectId)));
  rows[0].versions.push({
    ...payload,
    id: payload.id || 'new-version',
    systemDefault: false
  });
  records[payload.projectId] = rows;
  await waitForMutation('save', payload.projectId);
  return {
    workflows: rows
  };
}
;
export async function selectBuiltinWorkflowVersion(id, payload) {
  f.calls.push(['select', id, payload]);
  await waitForMutation('select', payload.projectId);
  return {
    workflows: sample(payload.projectId)
  };
}
;
export async function deleteBuiltinWorkflowVersion(id, version, pid) {
  f.calls.push(['delete', id, version, pid]);
  await waitForMutation('delete', pid);
  return {
    workflows: sample(pid)
  };
}
;
