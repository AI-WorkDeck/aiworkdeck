// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Keep upstream-client.js untouched; fail the build if an upstream boundary changes. */
export function adaptUpstream(source) {
  function replace(before, after, count = 1) {
    const found = source.split(before).length - 1;
    if (found !== count) throw new Error(`Upstream adapter expected ${count} matches, found ${found}: ${before.slice(0, 100)}`);
    source = source.split(before).join(after);
  }
  replace("window.__ModuleLoader__.load({id:'dsh-dpia-workbench',factory:function(require){\n const exports={},React=require('react');", "import React from 'react';");
  const registration = source.indexOf(" exports.inject=['slots','connection','uiWorkspace'];");
  if (registration < 0 || !source.endsWith('}});\n')) throw new Error('Upstream registration boundary changed');
  source = source.slice(0, registration) + '\nexport { Workbench };\n';
  replace('function Workbench({rpc,openSession})', 'function Workbench({rpc,openSession:openHostSession,openArtifact:openHostArtifact,openEnvironment})');
  replace("  function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}", `  async function openArtifact(out){
   try{await openHostArtifact(out);setNote('已保存到项目并打开：'+(out.filename||out.path));return true;}
   catch(e){setError(errText(e));return false;}
  }
  async function openSession(id){try{await openHostSession(id);}catch(e){setError(errText(e));}}`);
  replace('download(Uint8Array.from(atob(out.base64),c=>c.charCodeAt(0)),out.filename,out.mime)', 'await openArtifact(out)', 4);
  replace("()=>download(x.content,current.title+'-内部评估.md','text/markdown')", "async()=>{const out=await command('exportInternalMarkdown',{revisionId:x.revisionId},false);if(out)await openArtifact(out);}");
  replace("if(out){await openArtifact(out);setNote('归档包已生成，共 '+out.files+' 个文件。');setModal(null);}", "if(out&&await openArtifact(out)){setNote('归档包已保存到项目并打开'+(Number.isInteger(out.files)?'，共 '+out.files+' 个文件。':'。'));setModal(null);}");
  replace("error&&h('div',{role:'alert',className:'notice error'},error),note&&h('div',{role:'status',className:'notice'},note),", "busy&&h('div',{role:'status',className:'notice','aria-live':'polite'},'正在处理，请稍候…'),error&&h('div',{role:'alert',className:'notice error'},error),note&&h('div',{role:'status',className:'notice'},note),");
  replace("h('h2',null,modal.title),h('button',{type:'button','aria-label':'关闭窗口'", "h('h2',null,modal.title),h('button',{type:'button',onClick:openEnvironment},'运行环境'),h('button',{type:'button','aria-label':'关闭窗口'");
  replace("'完整版开发中 · Skill 0.7.8'", "'DPIA 0.3.11-beta.6 · Skill 0.7.8'");
  source = source.replaceAll('DSH_DPIA_PYTHON', 'DPIA 文档运行时').replaceAll('DSH', 'AI WorkDeck');
  source = source.replaceAll('下载 Word', '保存 Word 到项目').replaceAll('下载 Markdown', '保存 Markdown 到项目')
    .replaceAll('下载原件', '保存原件到项目').replaceAll('下载 PDF', '保存 PDF 到项目')
    .replaceAll('下载这一版 Word', '保存这一版 Word 到项目').replaceAll('下载这一版 PDF', '保存这一版 PDF 到项目')
    .replaceAll('预览 / 下载内部报告', '预览 / 保存内部报告').replaceAll('选择范围并下载归档包', '选择范围并保存归档包')
    .replaceAll('生成并下载归档包（不调用模型）', '生成并保存归档包（不调用模型）');
  return source;
}
