# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Real Writer ruler changes, selection fences, undo and DOCX roundtrip."""
from pathlib import Path
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'main' / 'native'
sys.path.insert(0, str(SOURCE))

class NativeRulerIdentityContract(unittest.TestCase):
    def test_real_helper_rejects_revision_changed_after_capture_without_writing(self):
        from native_ruler_uno import NativeRulerCommands
        properties = dict(Width=21000, Height=29700, LeftMargin=2540, RightMargin=2540,
                          TopMargin=2540, BottomMargin=2540, PageStyleName='Default',
                          ParaLeftMargin=0, ParaRightMargin=0, ParaFirstLineIndent=0)
        cursor = SimpleNamespace(getPropertyValue=lambda name: properties[name], getPage=lambda: 1,
                                 gotoStartOfParagraph=lambda expand: None, gotoEndOfParagraph=lambda expand: None)
        text = SimpleNamespace(createTextCursorByRange=lambda target: cursor,
                               compareRegionStarts=lambda left, right: 0, compareRegionEnds=lambda left, right: 0)
        cursor.getText = lambda: text
        cursor.getStart = cursor.getEnd = lambda: cursor
        style = SimpleNamespace(getPropertyValue=lambda name: properties[name])
        styles = SimpleNamespace(getByName=lambda name: style)
        model = SimpleNamespace(getURL=lambda: 'file:///isolated-ruler.docx', isReadonly=lambda: False,
                                getCurrentController=lambda: SimpleNamespace(getViewCursor=lambda: cursor),
                                getStyleFamilies=lambda: SimpleNamespace(getByName=lambda name: styles))
        commands = NativeRulerCommands()
        params = dict(nativeDocumentEpoch=1, nativeRevision=9, nativeReadOnly=False)
        captured = commands.execute('get_ruler_state', params, model, None)
        self.assertTrue(captured['available'])
        with patch('native_ruler_uno.apply_properties') as write:
            with self.assertRaisesRegex(ValueError, 'STALE_RULER_CONTEXT'):
                commands.execute('set_ruler_state', dict(params, nativeRevision=10,
                    contextToken=captured['contextToken'], patch=dict(leftIndent=180)), model, None)
            write.assert_not_called()


SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_EDIT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session'),{createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_EDIT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_EDIT_CONFIG));
const make=(name,readOnly)=>new NativeEditorSession({config,run:root+'/'+name,readOnly,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_EDIT_TEST;return createProcessChannel(args)}}),a=make('edit',false),b=make('reopen',false),c=make('readonly',true),result={checks:[],root};
const select=async(s,text)=>{const found=await s.execute('find_text_locations',{keyword:text});assert.equal(found.count,1);await s.execute('set_selection',{anchor:found.matches[0].anchorId})};
const read=async s=>{const state=await s.execute('get_ruler_state');assert.equal(state.available,true,JSON.stringify(state));assert.equal(state.pageIndex,0);return state;};
try{
 const bytes=new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_EDIT_FIXTURE));await a.execute('load_document',{bytes,name:'edit.docx',authorName:'标尺验收'});
 const original=await a.unoCall('test_state');
 const keys=['leftMargin','rightMargin','topMargin','bottomMargin','leftIndent','rightIndent','firstLineIndent'];
 for(const key of keys){
  const before=await read(a),value=before[key]+144;
  const changed=await a.execute('set_ruler_state',{contextToken:before.contextToken,patch:{[key]:value}});
  assert.equal(changed.available,true);assert.ok(Math.abs(changed[key]-value)<1);assert.equal(changed.changed,true);
  for(const other of keys.filter(k=>k!==key))assert.equal(changed[other],before[other],key+' preserves '+other);
  await a.execute('undo');const undone=await read(a);for(const other of keys)assert.ok(Math.abs(undone[other]-before[other])<1,key+' undo preserves '+other);
  const state=await a.unoCall('test_state');assert.equal(state.final,original.final);assert.deepEqual(state.revisions,original.revisions);assert.deepEqual(state.author,original.author);assert.equal(state.record,original.record);assert.equal(state.show,original.show);
  result.checks.push(key+' readback, one undo, content/review/author preserved');
 }
 const anchor=await read(a);await select(a,'甲方应在三十日内交付文件');await assert.rejects(a.execute('set_ruler_state',{contextToken:anchor.contextToken,patch:{leftIndent:144}}),/STALE_RULER_CONTEXT/);result.checks.push('cursor movement invalidates ruler token');
 const bad=await read(a);await assert.rejects(a.execute('set_ruler_state',{contextToken:bad.contextToken,patch:{leftMargin:bad.pageWidth}}),/usable text area/);
 const before=await read(a);
 const noop=await a.execute('set_ruler_state',{contextToken:before.contextToken,patch:{leftMargin:before.leftMargin}});assert.equal(noop.changed,false);
 for(const key of keys){const current=await read(a),value=current[key]+108.25;const changed=await a.execute('set_ruler_state',{contextToken:current.contextToken,patch:{[key]:value}});assert.ok(Math.abs(changed[key]-value)<1,key+' fractional twip drag');}
 const expected=await read(a),persisted=await a.unoCall('test_state');assert.equal(persisted.final,original.final);assert.deepEqual(persisted.revisions,original.revisions);assert.deepEqual(persisted.author,original.author);assert.equal(persisted.record,original.record);assert.equal(persisted.show,original.show);
 result.checks.push('fractional twip rounding, no-op and unrelated handles preserved');
 const saved=await a.execute('export_document',{format:'docx'});await fs.writeFile(root+'/saved.docx',saved.bytes);
 await b.execute('load_document',{bytes:saved.bytes,name:'reopen.docx',authorName:'重开'});await select(b,'甲方应在三十日内交付文件');const reopened=await read(b);for(const key of keys)assert.ok(Math.abs(reopened[key]-expected[key])<1,key+' DOCX reopen');const reopenedState=await b.unoCall('test_state');assert.equal(reopenedState.final,original.final);assert.deepEqual(reopenedState.revisions.map(({identifier,...entry})=>entry),original.revisions.map(({identifier,...entry})=>entry));result.checks.push('DOCX reopen retains all seven ruler values and document/revisions');
 await c.execute('load_document',{bytes:saved.bytes,name:'readonly.docx',authorName:'只读'});const ro=await read(c);await assert.rejects(c.execute('set_ruler_state',{contextToken:ro.contextToken,patch:{leftMargin:1000}}),/read.only|READ_ONLY/i);result.checks.push('readonly reads but cannot drag');
}catch(error){result.error=error.stack;process.exitCode=1}finally{await a.close();await b.close();await c.close();result.exits=[a,b,c].map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})();
'''


@unittest.skipUnless(os.environ.get('AWD_NATIVE_EDIT_CONFIG'), 'isolated runtime explicitly required')
class NativeRulerRoundtrip(unittest.TestCase):
    def test_real_ruler_readback_undo_stale_selection_and_reopen(self):
        from test_native_document_edit import fixture
        artifacts = Path(os.environ['AWD_NATIVE_EDIT_ARTIFACTS'])
        artifacts.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='ruler-', dir=artifacts))
        fixture(run / 'synthetic.docx')
        script = run / 'scenario.cjs'; script.write_text(SCENARIO)
        env = {**os.environ, 'AWD_NATIVE_EDIT_SOURCE': str(SOURCE), 'AWD_NATIVE_EDIT_RUN': str(run),
               'AWD_NATIVE_EDIT_TEST': str(Path(__file__).resolve()), 'AWD_NATIVE_EDIT_FIXTURE': str(run / 'synthetic.docx')}
        with (run / 'scenario.log').open('w') as log:
            child = subprocess.Popen(['node', str(script)], env=env, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            try:
                child.wait(timeout=180)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=5); raise
        self.assertTrue((run / 'result.json').exists(), str(run / 'scenario.log'))
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(child.returncode, 0, result.get('error', str(run)))
        self.assertEqual(result['exits'], [{'engine':0,'uno':0}] * 3)
        print('Native ruler evidence:', run, flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--port':
        from test_native_document_edit import bridge_driver
        bridge_driver(int(sys.argv[2]))
    else:
        unittest.main()
