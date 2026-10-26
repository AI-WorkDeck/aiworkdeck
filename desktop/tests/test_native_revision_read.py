# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Opt-in real-engine review/view callbacks with 600 tracked changes."""
from pathlib import Path
import json
import os
import signal
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'main' / 'native'
SCENARIO = r'''

const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_EDIT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session'),{createProcessChannel}=require(source+'/process-channel');
(async()=>{
 const root=process.env.AWD_NATIVE_EDIT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_EDIT_CONFIG));
 let phase='start';const events=[],counts={},results=[],rpc={};
 const s=new NativeEditorSession({config,run:root+'/engine',readOnly:false,channel:args=>{const cb=args.onEvent;const channel=createProcessChannel({...args,onEvent:e=>{if(e.type==='callback'){counts[e.callbackType]=(counts[e.callbackType]||0)+1;if([30,31,2,3,4].includes(e.callbackType))events.push({phase,revision:s.revision,...e})}cb?.(e)}});const original=channel.call;channel.call=async(action,p)=>{rpc[action]=(rpc[action]||0)+1;return original.call(channel,action,p)};return channel}});
 const settle=async()=>{for(let attempt=0;attempt<200;attempt++){await new Promise(r=>setTimeout(r,5));await s.queue;if(!s.viewReadGuard?.scheduled&&!s.viewReadGuard?.pending.size)return}throw Error('proof did not settle')};
 const step=async(action,params={})=>{phase=action;const before=s.revision,c={...counts},start=performance.now();try{const result=await s.execute(action,params);await settle();if(['set_revision_view','export_document','export_pdf','get_document_text','get_review_context'].includes(action))assert.equal(s.revision,before,action+' must not invalidate content');if(result.revision!==undefined)assert.equal(result.revision,s.revision,action+' returned stale revision');results.push({action,before,after:s.revision,resultRevision:result.revision,count:result.count,elapsedMs:performance.now()-start,rpc:{...rpc},events:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v-(c[k]||0)]))});return result;}catch(e){results.push({action,before,after:s.revision,error:e.stack});throw e}};
 try{
 await step('load_document',{bytes:new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_EDIT_FIXTURE)),name:'probe.docx',authorName:'隔离回调验证'});

 await step('set_revision_view',{mode:'final'});
 await step('export_document',{format:'docx'});
 await step('get_document_text',{__agent:true});
 await step('set_revision_view',{mode:'balloons'});
 await step('export_pdf');
 await step('get_document_text',{__agent:true});
 await step('get_review_context');
 const capturedRevision=s.revision;
 await step('native_input',{action:'input_text',params:{documentEpoch:s.model.documentEpoch,inputSeq:1,text:'真实输入'}});
 await step('get_document_text',{__agent:true});
 assert.equal(s.revision,capturedRevision+1,'real input invalidates once');
 const stale=await step('goto_review_range',{revision:capturedRevision});assert.equal(stale.reason,'stale');
 const list=await step('list_revisions');
 if(list)await step('resolve_revision',{documentSeq:list.documentSeq,revision:list.revision,index:0,identifier:list.revisions[0].identifier,expectedRevision:list.revisions[0],action:'accept'});
 await step('get_document_text',{__agent:true});
 await step('undo');await step('get_document_text',{__agent:true});
 const found=await step('find_text_locations',{keyword:'真实输入'});assert.equal(found.count,1);await step('set_selection',{anchor:found.matches[0].anchorId});
 await step('add_comment_at_selection',{comment:'隔离的只读证明验收批注',asUser:true});
 await step('get_document_text',{__agent:true});
 const proof=s.viewReadGuard.selectionProof;assert.deepEqual(await s.unoCall('check_view_read',{token:proof}),{contentUnchanged:true,selectionUnchanged:true});
 await s.unoCall('collapse_selection',{to:'end'});const moved=await s.unoCall('check_view_read',{token:proof});assert.equal(moved.selectionUnchanged,false,'external cursor movement cannot be labeled readback');
 await step('get_document_text',{__agent:true});
 phase='external';const old=s.revision;await s.unoCall('insert_at_cursor',{text:'外部写入',__agent:false});await new Promise(r=>setTimeout(r,30));await s.queue;results.push({action:'external',before:old,after:s.revision});assert.ok(s.revision>old,'external write invalidates old revision');
 await step('get_document_text',{__agent:true});
 }catch(error){results.push({error:error.stack});process.exitCode=1}finally{await s.close();await fs.writeFile(root+'/events.json',JSON.stringify(events));await fs.writeFile(root+'/results.json',JSON.stringify(results,null,2));console.log(root);console.log(JSON.stringify(results,null,2));}
})();
'''

@unittest.skipUnless(os.environ.get('AWD_NATIVE_EDIT_CONFIG') and os.environ.get('AWD_NATIVE_EDIT_FIXTURE'),
                     'isolated runtime and synthetic 600-revision fixture explicitly required')
class NativeRevisionRead(unittest.TestCase):
    def test_read_views_exports_and_actual_mutations(self):
        artifacts = Path(os.environ['AWD_NATIVE_EDIT_ARTIFACTS'])
        artifacts.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='verified-', dir=artifacts))
        script = run / 'scenario.cjs'; script.write_text(SCENARIO)
        env = {**os.environ, 'AWD_NATIVE_EDIT_SOURCE': str(SOURCE), 'AWD_NATIVE_EDIT_RUN': str(run)}
        with (run / 'scenario.log').open('w') as log:
            child = subprocess.Popen(['node', str(script)], env=env, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            try:
                child.wait(timeout=180)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=5); raise
        result = json.loads((run / 'results.json').read_text())
        self.assertEqual(child.returncode, 0, json.dumps(result[-3:], ensure_ascii=False))
        print('Native read-proof evidence:', run, flush=True)

if __name__ == '__main__':
    unittest.main()
