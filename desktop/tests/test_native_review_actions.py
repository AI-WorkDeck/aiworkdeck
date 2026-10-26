# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Portable checks for the three native inline-review actions."""
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import json
import os
import signal
import shutil
import subprocess
import sys
import tempfile
import unittest
from test_native_document import CursorStory, CursorRange, Enumeration, Model, Paragraph, Uno
import native_document_uno as document
import native_document_edit_uno as edit


class ReviewParagraph(CursorRange):
    def getString(self):
        return self.story.text

    def getEnd(self):
        return CursorRange(self.story, len(self.story.text))

    def supportsService(self, name):
        return name == 'com.sun.star.text.Paragraph'

    def getPropertyValue(self, name):
        return Paragraph('').getPropertyValue(name)


class ReviewModel(Model):
    def __init__(self, text='甲方在三十日内交付', start=3, end=6):
        super().__init__()
        self.story = CursorStory(text)
        self.paragraph = ReviewParagraph(self.story, 0, len(text))
        self.story.createEnumeration = lambda: Enumeration([self.paragraph])
        self.selected = CursorRange(self.story, start, end)
        self.ctrl.getSelection = lambda: SimpleNamespace(getCount=lambda: 1, getByIndex=lambda index: self.selected)
        self.ctrl.getViewCursor = lambda: self.selected
        self.undo_titles, self.redo_titles, self.undo_events = [], [], []
        self.undo = SimpleNamespace(getAllUndoActionTitles=lambda: self.undo_titles[:],
            enterUndoContext=self.enter, leaveUndoContext=self.leave, undo=self.undo_once)

    def getText(self):
        return self.story

    def getUndoManager(self):
        return self.undo

    def setPropertyValue(self, name, value):
        if name == 'RecordChanges':
            self.record = value
            self.modified = True
        else:
            super().setPropertyValue(name, value)

    def enter(self, title):
        self.undo_events.append(('enter', title))
        self.before_text, self.title = self.story.text, title

    def leave(self):
        self.undo_events.append(('leave', self.title))
        if self.story.text != self.before_text:
            self.undo_titles.insert(0, self.title)
            self.redo_titles.clear()

    def undo_once(self):
        self.undo_events.append(('undo', self.undo_titles[0]))
        self.redo_titles.insert(0, self.undo_titles.pop(0))
        self.story.text = self.before_text


class ReviewActionContracts(unittest.TestCase):
    def setUp(self):
        self.commands = document.NativeDocumentCommands()
        self.edits = edit.NativeDocumentEdits(self.commands)
        self.model = ReviewModel()

    def params(self, **changes):
        return dict(dict(revision=9, paragraphIndex=0, start=3, end=6,
                         expectedParagraph=self.model.story.text, quote='三十日', replacement='六十日'), **changes)

    def read(self, action, params=None):
        return self.commands.execute(action, params or {}, self.model, Uno,
                                     document_epoch=1, revision=9, read_only=True)

    def write(self, params=None):
        return self.edits.execute('apply_review_edit', params or self.params(), self.model, Uno, None,
                                  document_epoch=1, revision=9, read_only=False)

    def apply(self, target, replacement, tracked):
        self.assertTrue(tracked)
        self.assertEqual(self.model.display, 0)
        self.model.story.text = self.model.story.text[:target.start] + replacement + self.model.story.text[target.end:]
        self.model.modified = True

    def test_ui_context_reads_final_text_without_agent_and_restores_view(self):
        # CursorRange is deliberately a model-selection fake, not a layout cursor.
        with patch.object(CursorRange, 'isCollapsed', lambda cursor: cursor.start == cursor.end, create=True):
            seen = []
            original = self.model.ctrl.getSelection
            self.model.ctrl.getSelection = lambda: (seen.append(self.model.display), original())[1]
            result = self.read('get_review_context')
        self.assertTrue(result['success'])
        self.assertEqual(result['text'], '甲方在三十日内交付')
        self.assertEqual((result['paragraphIndex'], result['offset'], result['selectedText']), (0, 3, '三十日'))
        self.assertTrue(result['hasSelection'])
        self.assertEqual(result['revision'], 9)
        self.assertEqual(seen, [0])
        self.assertEqual(self.model.display, 2)
        self.assertFalse(self.model.modified)
        self.assertEqual(self.model.undo_events, [])

    def test_context_rejects_foreign_story_and_caps_by_utf16_units(self):
        foreign = CursorStory('表格')
        self.model.ctrl.getSelection = lambda: SimpleNamespace(getCount=lambda: 1, getByIndex=lambda index: CursorRange(foreign, 0))
        # Real XTextRangeCompare refuses ranges belonging to another story.
        self.model.story.compareRegionStarts = lambda left, right: (_ for _ in ()).throw(ValueError('foreign'))
        self.assertEqual(self.read('get_review_context')['reason'], 'body-only')
        self.model = ReviewModel('甲' * 14999 + '😀尾', 0, 0)
        with patch.object(CursorRange, 'isCollapsed', lambda cursor: cursor.start == cursor.end, create=True):
            result = self.read('get_review_context')
        self.assertTrue(result['success']); self.assertFalse(result['available']); self.assertTrue(result['truncated'])
        self.assertEqual(result['text'], '甲' * 14999 + '\ud83d')

    def test_invalid_and_stale_ranges_refuse_before_any_mutation(self):
        cases = [({'revision': 8}, 'stale'), ({'paragraphIndex': -1}, 'invalid-range'),
                 ({'paragraphIndex': True}, 'invalid-range'), ({'start': 2.5}, 'invalid-range'),
                 ({'end': 3}, 'invalid-range'), ({'quote': '不同'}, 'invalid-range'),
                 ({'expectedParagraph': '甲' * 15001}, 'invalid-range'),
                 ({'paragraphIndex': 9}, 'stale'), ({'expectedParagraph': '乙方在三十日内交付'}, 'stale')]
        for changes, reason in cases:
            with self.subTest(changes=changes):
                result = self.write(self.params(**changes))
                self.assertEqual(result['reason'], reason)
                self.assertFalse(result['changed'])
        self.assertEqual(self.model.undo_events, [])
        self.assertEqual(self.model.story.text, '甲方在三十日内交付')

    def test_utf16_prefix_surrogates_refuse_but_suffix_preserved(self):
        self.model = ReviewModel('😀三十日', 0, 0)
        self.assertEqual(self.write(self.params(start=2, end=5))['reason'], 'unsupported-unicode-range')
        self.model = ReviewModel('甲方在三十日😀尾')
        with patch.object(edit, 'apply_replacement', self.apply):
            result = self.write()
        self.assertTrue(result['success'])
        self.assertEqual(self.model.story.text, '甲方在六十日😀尾')

    def test_invalid_replacement_refuses_and_navigation_verifies_actual_selection(self):
        for replacement in [None, '跨\n段', '跨\r段', '甲' * 15001]:
            self.assertEqual(self.write(self.params(replacement=replacement))['reason'], 'invalid-replacement')
        self.assertEqual(self.model.undo_events, [])
        self.model.selected = CursorRange(self.model.story, 0)
        self.assertTrue(self.read('goto_review_range', self.params())['success'])
        self.assertEqual(self.model.selected.getString(), '三十日')
        self.model.ctrl.select = lambda target: True  # accepted without moving is not proof
        self.model.selected = CursorRange(self.model.story, 0)
        self.assertEqual(self.read('goto_review_range', self.params())['reason'], 'unavailable-context')

    def test_verified_edit_one_undo_tracking_and_noop_receipts(self):
        self.model.record = False
        with patch.object(edit, 'apply_replacement', self.apply):
            result = self.write()
        self.assertEqual(result, dict(success=True, revision=9, changed=True, textChanged=True, trackingChanged=True))
        self.assertEqual(self.model.undo_titles, ['采用审校建议'])
        self.assertTrue(self.model.record); self.assertTrue(self.model.enabled); self.assertEqual(self.model.display, 2)
        before = self.model.undo_events[:]
        result = self.write(self.params(quote='六十日', replacement='六十日'))
        self.assertFalse(result['changed'])
        self.assertEqual(self.model.undo_events, before)

    def test_partial_failure_rolls_back_only_own_group_and_locks_unknown_lineage(self):
        self.model.undo_titles = ['此前编辑']
        def fail(target, replacement, tracked):
            self.apply(target, replacement, tracked)
            raise RuntimeError('injected after actual write')
        with patch.object(edit, 'apply_replacement', fail):
            with self.assertRaisesRegex(RuntimeError, 'EDIT_OUTCOME_UNKNOWN.*rolled back'):
                self.write()
        self.assertEqual(self.model.story.text, '甲方在三十日内交付')
        self.assertEqual(self.model.undo_titles, ['此前编辑'])
        self.assertEqual(self.model.undo_events[-1], ('undo', '采用审校建议'))
        self.assertEqual(self.model.display, 2); self.assertTrue(self.model.enabled)


REVIEW_SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_EDIT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session'),{createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_EDIT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_EDIT_CONFIG));
const create=name=>new NativeEditorSession({config,run:root+'/'+name,readOnly:false,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_EDIT_TEST;return createProcessChannel(args)}});
const a=create('review'),b=create('reopen'),result={checks:[],root};
const check=name=>result.checks.push(name),read=(action,p={})=>a.execute(action,{...p,__agent:true});
const state=()=>a.unoCall('test_state');
const select=async text=>{const found=await read('find_text_locations',{keyword:text});assert.equal(found.count,1);assert.equal((await read('set_selection',{anchor:found.matches[0].anchorId})).success,true)};
try{
 const bytes=new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_EDIT_FIXTURE));await a.execute('load_document',{bytes,name:'review.docx',authorName:'审校本人'});
 await select('现稿30日');let context=await a.execute('get_review_context');assert.equal(context.success,true);assert.equal(context.text,'旧稿：；现稿30日。');assert.equal(context.paragraphIndex,2);check('UI context excludes deleted text without __agent');
 await select('三十日');const before=await state();const body=await read('get_document_text',{maxParagraphs:500});context=await a.execute('get_review_context');assert.equal(context.revision,body.revision);assert.equal(context.success,true);assert.equal(context.selectedText,'三十日');assert.equal(context.offset,4);
 const params={revision:context.revision,paragraphIndex:context.paragraphIndex,start:4,end:7,expectedParagraph:context.text,quote:'三十日',replacement:'六十日'};
 result.trace={context,params,beforeGotoRevision:a.revision,reviewRevision:a.review?.revision};const moved=await a.execute('goto_review_range',params);Object.assign(result.trace,{moved,afterGotoRevision:a.revision});assert.equal(moved.success,true,JSON.stringify(result.trace));assert.equal((await a.execute('get_selection')).text,'三十日');check('verified review range moves actual model selection');
 const changed=await a.execute('apply_review_edit',params);assert.equal(changed.success,true);assert.equal(changed.changed,true);assert.ok(changed.revision>params.revision);let after=await state();assert.ok(after.final.includes('甲方应在六十日内交付文件'));assert.equal(after.undo.undo.depth,before.undo.undo.depth+1);assert.equal(after.undo.undo.title,'采用审校建议');assert.equal(after.show,before.show);assert.equal(after.record,true);assert.deepEqual(after.author,before.author);check('adoption is one tracked edit with restored view and human author');
 const stale=await a.execute('apply_review_edit',params);assert.equal(stale.success,false);assert.equal(stale.reason,'stale');assert.equal(a.failure,undefined);check('stale suggestion is an unchanged nonfatal refusal');
 await a.execute('undo');assert.ok((await state()).final.includes('甲方应在三十日内交付文件'));await a.execute('redo');assert.ok((await state()).final.includes('甲方应在六十日内交付文件'));check('single undo and redo restore the two complete versions');
 await select('六十日');context=await a.execute('get_review_context');const externalFence={...params,revision:context.revision,expectedParagraph:context.text,quote:'六十日'};await a.execute('modify_paragraph',{index:0,newText:'其他段发生了修改',__agent:true});assert.equal((await a.execute('goto_review_range',externalFence)).reason,'stale');assert.equal((await a.execute('apply_review_edit',externalFence)).reason,'stale');await a.execute('undo');check('an intervening edit in another paragraph invalidates old navigation and adoption');
 const saved=await a.execute('export_document');await fs.writeFile(root+'/review.docx',saved.bytes);const final=await state();await b.execute('load_document',{bytes:saved.bytes,name:'reopen.docx',authorName:'重开'});assert.equal((await b.unoCall('test_state')).final,final.final);check('DOCX reopen preserves exact final text');
 await select('六十日');const failedBefore=await state();context=await a.execute('get_review_context');const failing={revision:context.revision,paragraphIndex:context.paragraphIndex,start:4,end:7,expectedParagraph:context.text,quote:'六十日',replacement:'九十日'};
 const call=a.unoCall.bind(a);a.unoCall=(method,p)=>call(method==='apply_review_edit'?'test_fail_review_edit':method,p);
 await assert.rejects(a.execute('apply_review_edit',failing),/EDIT_OUTCOME_UNKNOWN/);assert.ok(a.failure);const failedAfter=await call('test_state');assert.equal(failedAfter.final,failedBefore.final);assert.deepEqual(failedAfter.undo.undo,failedBefore.undo.undo);assert.equal(failedAfter.show,failedBefore.show);await assert.rejects(a.execute('apply_review_edit',failing),/EDIT_OUTCOME_UNKNOWN/);check('injected partial edit rolls back only its group and blocks uncertain redo lineage');
}catch(error){result.error=error.stack;process.exitCode=1}finally{await a.close();await b.close();result.exits=[a,b].map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})();
'''

LOAD_SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_EDIT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session'),{createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_EDIT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_EDIT_CONFIG));
const a=new NativeEditorSession({config,run:root+'/review',readOnly:false,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_EDIT_TEST;return createProcessChannel(args)}}),result={checks:[],timingsMs:{},root};
const timed=async(name,action,params={})=>{const start=performance.now();const value=await a.execute(action,params);result.timingsMs[name]=Math.round((performance.now()-start)*100)/100;assert.equal(value.success,true,JSON.stringify(value));return value};
try{
 await a.execute('load_document',{bytes:new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_EDIT_FIXTURE)),name:'load-review.docx',authorName:'负载审校'});
 const before=await a.unoCall('test_state');assert.ok(before.revisions.length>=600);result.revisionCount=before.revisions.length;
 const body=await timed('firstFinalDocumentReadIncludingProof','get_document_text',{__agent:true,maxParagraphs:500});
 const context=await timed('reviewContextWithProof','get_review_context');assert.equal(context.revision,body.revision);
 const first=body.paragraphs.find(p=>p.text.length&&p.text.charCodeAt(0)<0xD800);assert.ok(first);
 await timed('gotoReviewRangeWithProof','goto_review_range',{revision:context.revision,paragraphIndex:first.index,start:0,end:1,expectedParagraph:first.text,quote:first.text[0]});
 const repeated=await timed('repeatFinalDocumentRead','get_document_text',{__agent:true,maxParagraphs:500});assert.equal(repeated.revision,body.revision);
 const after=await a.unoCall('test_state');assert.deepEqual(after,before);result.checks.push('600 revision read/navigation preserves content authors tracking undo view and dirty state');
}catch(error){result.error=error.stack;process.exitCode=1}finally{await a.close();result.exits=[{engine:a.engine?.process.exitCode,uno:a.uno?.process.exitCode}];await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})();
'''


@unittest.skipUnless(os.environ.get('AWD_NATIVE_EDIT_CONFIG'), 'isolated native runtime explicitly required')
class NativeReviewRoundtrip(unittest.TestCase):
    def test_actual_review_context_navigation_edit_undo_and_rollback(self):
        result = self.run_native(REVIEW_SCENARIO)
        self.assertEqual(result['exits'], [{'engine': 0, 'uno': 0}] * 2)
        self.assertEqual(len(result['checks']), 8)

    @unittest.skipUnless(os.environ.get('AWD_NATIVE_REVIEW_LOAD_FIXTURE'), '600-revision synthetic fixture explicitly required')
    def test_600_revision_read_proof_cost_and_no_mutation(self):
        result = self.run_native(LOAD_SCENARIO, os.environ['AWD_NATIVE_REVIEW_LOAD_FIXTURE'])
        self.assertEqual(result['exits'], [{'engine': 0, 'uno': 0}])
        self.assertEqual(len(result['checks']), 1)

    def run_native(self, scenario, source_fixture=None):
        from test_native_document_edit import fixture, SOURCE
        artifacts = Path(os.environ['AWD_NATIVE_EDIT_ARTIFACTS'])
        artifacts.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='review-actions-', dir=artifacts))
        if source_fixture:
            shutil.copyfile(source_fixture, run / 'synthetic.docx')
        else:
            fixture(run / 'synthetic.docx')
        script = run / 'scenario.cjs'
        script.write_text(scenario)
        env = {**os.environ, 'AWD_NATIVE_EDIT_SOURCE': str(SOURCE), 'AWD_NATIVE_EDIT_RUN': str(run),
               'AWD_NATIVE_EDIT_TEST': str(Path(__file__).resolve()), 'AWD_NATIVE_EDIT_FIXTURE': str(run / 'synthetic.docx')}
        with (run / 'scenario.log').open('w') as log:
            child = subprocess.Popen(['node', str(script)], env=env, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            try:
                child.wait(timeout=180)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
                raise
        self.assertTrue((run / 'result.json').exists(), str(run / 'scenario.log'))
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(child.returncode, 0, result.get('error', str(run)))
        print('Native review evidence:', run, flush=True)
        return result


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--port':
        from test_native_document_edit import bridge_driver
        bridge_driver(int(sys.argv[2]))
    else:
        unittest.main()
