# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Portable guards plus opt-in real, isolated LOK/pyuno/DOCX roundtrip.

AWD_NATIVE_COMMENT_CONFIG, AWD_NATIVE_COMMENT_FIXTURE and
AWD_NATIVE_COMMENT_ARTIFACTS enable the native test. It creates its own worker,
HOME and profile and never connects to a user's running office process.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
import xml.etree.ElementTree as ET
import zipfile

SOURCE = Path(__file__).resolve().parents[1] / 'main' / 'native'
sys.path.insert(0, str(SOURCE))
import native_comments_uno as comments


class Enumeration:
    def __init__(self, values):
        self.values = iter(values)
        self.next = next(self.values, None)

    def hasMoreElements(self):
        return self.next is not None

    def nextElement(self):
        value, self.next = self.next, next(self.values, None)
        return value


class Field:
    def __init__(self, identity='comment1'):
        self.props = {'Name': identity, 'ParaId': 'A', 'ParentName': '', 'Author': '甲',
                      'Content': '正文批注', 'Resolved': False,
                      'DateTimeValue': SimpleNamespace(Year=2026, Month=10, Day=25, Hours=12,
                                                      Minutes=10, Seconds=2, NanoSeconds=123)}

    def supportsService(self, name):
        return name == comments.ANNOTATION

    def getPropertyValue(self, name):
        return self.props[name]

    def getAnchor(self):
        return SimpleNamespace(getString=lambda: '锚点')


class Model:
    def __init__(self, fields=(), readonly=False):
        self.fields, self.readonly, self.recording, self.events = fields, readonly, True, []

    def getTextFields(self):
        return SimpleNamespace(createEnumeration=lambda: Enumeration(self.fields))

    def isReadonly(self):
        return self.readonly

    def getPropertyValue(self, name):
        return self.recording

    def setPropertyValue(self, name, value):
        self.recording = value
        self.events.append((name, value))

    def getUndoManager(self):
        return SimpleNamespace(enterUndoContext=lambda title: self.events.append('enter'),
                               leaveUndoContext=lambda: self.events.append('leave'))


class CommentGuards(unittest.TestCase):
    def test_imported_reply_without_name_has_stable_model_identity(self):
        field = Field('')
        self.assertEqual(comments.comment_id(field), 'native:A')
        self.assertFalse(comments.list_comments(Model([field]), [{'id': 10, 'parentId': 0}])['truncated'])

    def test_duplicate_identity_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'TOPOLOGY_UNAVAILABLE'):
            comments.list_comments(Model([Field(), Field()]), [{'id': 10, 'parentId': 0}])

    def test_stale_card_fails_and_id_takes_precedence_over_index(self):
        field = Field()
        model = Model([field])
        expected = comments.detail(field, 0)
        self.assertIs(comments.target(model, {'id': 'comment1', 'index': 99,
                                             'expectedComment': expected})[0], field)
        expected['content'] = '旧正文'
        with self.assertRaisesRegex(RuntimeError, 'COMMENT_CHANGED'):
            comments.target(model, {'id': 'comment1', 'expectedComment': expected})
        self.assertEqual(model.events, [])

    def test_readonly_rejects_all_writes_before_target_or_profile_access(self):
        model = Model(readonly=True)
        for method in comments.ACTIONS - {'list_comments', 'goto_comment'}:
            with self.assertRaisesRegex(RuntimeError, 'READ_ONLY'):
                comments.dispatch(method, {}, model, None, None, read_only=False)
        self.assertEqual(model.events, [])

    def test_lok_readonly_view_flag_rejects_even_when_uno_model_is_writable(self):
        model = Model([Field()])
        with self.assertRaisesRegex(RuntimeError, 'READ_ONLY'):
            comments.dispatch('update_comment', {}, model, None, None, read_only=True)
        with self.assertRaises(ValueError):
            comments.dispatch('list_comments', {}, model, None, None, read_only='false')
        self.assertEqual(model.events, [])

    def test_failed_mutation_restores_tracking_and_balances_undo(self):
        model = Model()
        with self.assertRaisesRegex(RuntimeError, 'COMMENT_OUTCOME_UNKNOWN'):
            with comments.mutation(model, '测试'):
                raise ValueError('controlled')
        self.assertTrue(model.recording)
        self.assertEqual(model.events, ['enter', ('RecordChanges', False), ('RecordChanges', True), 'leave'])

    def test_restore_failure_still_leaves_undo_and_reports_unknown(self):
        class RestoreFails(Model):
            def setPropertyValue(self, name, value):
                if value:
                    raise RuntimeError('controlled restore failure')
                super().setPropertyValue(name, value)
        model = RestoreFails()
        with self.assertRaisesRegex(RuntimeError, 'COMMENT_OUTCOME_UNKNOWN'):
            with comments.mutation(model, '测试'):
                pass
        self.assertEqual(model.events[-1], 'leave')

    def test_leave_failure_keeps_unknown_boundary_after_tracking_restored(self):
        class LeaveFails(Model):
            def getUndoManager(self):
                def leave():
                    self.events.append('leave')
                    raise RuntimeError('controlled leave failure')
                return SimpleNamespace(enterUndoContext=lambda title: self.events.append('enter'),
                                       leaveUndoContext=leave)
        model = LeaveFails()
        with self.assertRaisesRegex(RuntimeError, 'COMMENT_OUTCOME_UNKNOWN'):
            with comments.mutation(model, '测试'):
                pass
        self.assertTrue(model.recording)
        self.assertEqual(model.events[-1], 'leave')

    def test_boolean_validation_and_noop_have_no_undo(self):
        model = Model([Field()])
        with self.assertRaises(ValueError):
            comments.dispatch('set_comment_resolved', {'id': 'comment1', 'resolved': 'false'}, model, None, None, read_only=False)
        result = comments.dispatch('set_comment_resolved', {'id': 'comment1', 'resolved': False}, model, None, None, read_only=False)
        self.assertFalse(result['changed'])
        self.assertEqual(model.events, [])

    def test_topology_rejects_partial_stale_and_cyclic_native_snapshot(self):
        first, second = Field(), Field('reply')
        second.props['ParaId'] = 'B'
        model = Model([first, second])
        for snapshot in [[], [{'id': 10, 'parentId': 0}],
                         [{'id': 10, 'parentId': 0}, {'id': 12, 'parentId': 10}],
                         [{'id': 10, 'parentId': 11}, {'id': 11, 'parentId': 10}]]:
            with self.assertRaisesRegex(RuntimeError, 'COMMENT_TOPOLOGY'):
                comments.list_comments(model, snapshot)
        self.assertEqual(model.events, [])

    def test_nameless_imported_parent_cannot_be_deleted_with_surviving_child(self):
        parent, child = Field(''), Field('')
        child.props['ParaId'] = 'B'
        model = Model([parent, child])
        topology = [{'id': 10, 'parentId': 0}, {'id': 11, 'parentId': 10}]
        rows = comments.list_comments(model, topology)['comments']
        self.assertEqual(rows[1]['parentId'], 'native:A')
        with self.assertRaisesRegex(RuntimeError, 'COMMENT_HAS_REPLIES'):
            comments.dispatch('delete_comment', {'id': 'native:A'}, model, None, None,
                              read_only=False, native_parents=topology)
        self.assertEqual(model.events, [])

    def test_parent_delete_refuses_before_mutation(self):
        parent, reply = Field(), Field('reply')
        reply.props['ParentName'] = 'comment1'
        reply.props['ParaId'] = 'B'
        model = Model([parent, reply])
        with self.assertRaisesRegex(RuntimeError, 'COMMENT_HAS_REPLIES'):
            comments.dispatch('delete_comment', {'id': 'comment1'}, model, None, None, read_only=False,
                              native_parents=[{'id': 10, 'parentId': 0}, {'id': 11, 'parentId': 10}])
        self.assertEqual(model.events, [])


# This driver is only launched inside the worker/profile owned by this test.
def bridge_driver(port):
    import native_review_uno as review
    import native_document_uno as document
    import uno
    document_commands = document.NativeDocumentCommands()
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    context = resolver.resolve(f'uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext')
    desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            params, method = request['params'], request['method']
            model = review.model_for(desktop, params['documentUrl'])
            if method in document.ACTIONS:
                result = document_commands.execute(method, params, model, uno,
                    document_epoch=params['nativeDocumentEpoch'], revision=params['nativeRevision'],
                    read_only=params['nativeReadOnly'])
            elif method in comments.ACTIONS:
                result = comments.dispatch(method, params, model, uno, context, read_only=params['nativeReadOnly'],
                                           native_parents=params.get('nativeCommentParents'))
            elif method == 'test_select':
                descriptor = model.createSearchDescriptor()
                descriptor.SearchString = params['text']
                found = model.findFirst(descriptor)
                if found is None:
                    raise RuntimeError('Fixture selection not found')
                model.getCurrentController().select(found)
                result = {'selected': model.getCurrentController().getViewCursor().getString()}
            elif method == 'test_state':
                result = {'body': model.getText().getString(), 'recording': model.getPropertyValue('RecordChanges'),
                          'modified': model.isModified(), 'undo': review.undo_state(model),
                          'revisions': review.dispatch('snapshot', {}, model, uno, context)['entries']}
            elif method == 'test_selection_state':
                ctrl = model.getCurrentController()
                vc = ctrl.getViewCursor()
                ranges = ctrl.getSelection()
                result = {'view': vc.getString(),
                          'selections': [ranges.getByIndex(i).getString() for i in range(ranges.getCount())],
                          'anchors': [entry['bookmark'].getAnchor().getString() for entry in document_commands.anchors.values()]}
            else:
                result = review.dispatch(method, params, model, uno, context)
            response = {'id': request['id'], 'result': result}
        except Exception as error:
            response = {'id': request['id'], 'error': str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


NATIVE_SCENARIO = r'''
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_COMMENT_SESSION_SOURCE||process.env.AWD_NATIVE_COMMENT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session');const {createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_COMMENT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_COMMENT_CONFIG));
const create=(name,readOnly)=>{const s=new NativeEditorSession({config,run:root+'/'+name,readOnly,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_COMMENT_TEST;return createProcessChannel(args)}});const call=s.unoCall.bind(s);s.unoCall=async(action,p={})=>{let nativeCommentParents;if(['list_comments','delete_comment'].includes(action)){const response=await s.engine.call('values',{command:'.uno:ViewAnnotations',documentEpoch:s.model.documentEpoch});nativeCommentParents=JSON.parse(response.value).comments.map(({id,parentId})=>({id,parentId}));}return call(action,{...p,nativeReadOnly:readOnly,nativeCommentParents})};return s};
const a=create('a',false),b=create('b',false),c=create('readonly',true);const result={checks:[],root};
const checked=name=>result.checks.push(name);const list=s=>s.unoCall('list_comments');
const write=(s,action,p)=>s.task(async()=>{s.assertWrite();const r=await s.undo.edit(()=>s.unoCall(action,p));if(r.changed)s.changed();return r});
const stable=s=>({body:s.body,recording:s.recording,revisions:s.revisions});
try{
 await a.execute('load_document',{bytes:new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_COMMENT_FIXTURE)),name:'synthetic.docx',authorName:'批注验收甲'});
 const initial=await a.unoCall('test_state');assert.equal(initial.revisions.length,600);assert.equal(initial.recording,true);
 const located=await a.execute('find_text_locations',{__agent:true,keyword:'合成测试条款0：按期核验并交付文件。'});
 assert.equal(located.count,1);await a.execute('set_selection',{__agent:true,anchor:located.matches[0].anchorId});
 result.selection=await a.unoCall('test_selection_state');
 assert.deepEqual(result.selection,{view:'合成测试条款0：按期核验并交付文件。',selections:['合成测试条款0：按期核验并交付文件。'],anchors:['合成测试条款0：按期核验并交付文件。']});
 const inserted=await write(a,'add_comment_at_selection',{comment:'甲的原始批注'});let rows=(await list(a)).comments;let parent=rows.find(x=>x.id===inserted.id);
 assert.equal(parent.author,'批注验收甲');assert.equal(parent.anchorText,'合成测试条款0：按期核验并交付文件。');assert.equal(rows.length,1);checked('insert author and full anchor');
 const undoBefore=(await a.unoCall('undo_state')).undo.depth;
 await write(a,'update_comment',{id:parent.id,content:'甲修改后的批注',expectedComment:parent});
 assert.equal((await list(a)).comments[0].content,'甲修改后的批注');assert.equal((await a.unoCall('undo_state')).undo.depth,undoBefore+1);
 await a.execute('undo');assert.equal((await list(a)).comments[0].content,parent.content);await a.execute('redo');checked('edit one undo and redo');
 await assert.rejects(write(a,'update_comment',{id:parent.id,content:'不可写',expectedComment:parent}),/COMMENT_CHANGED/);checked('stale snapshot rejected');
 parent=(await list(a)).comments[0];await a.unoCall('goto_comment',{id:parent.id});checked('exact anchor location');
 await a.execute('load_document',{authorName:'批注验收乙'});
 const reply=await write(a,'reply_comment',{id:parent.id,text:'乙的真实回复',asUser:true});rows=(await list(a)).comments;
 assert.equal(rows.length,2);assert.equal(rows.find(x=>x.id===reply.id).parentId,parent.id);assert.equal(rows.find(x=>x.id===reply.id).author,'批注验收乙');assert.equal(rows.find(x=>x.id===reply.id).content,'乙的真实回复');
 await a.execute('undo');assert.equal((await list(a)).count,1);await a.execute('redo');assert.equal((await list(a)).count,2);checked('thread reply author exact content undo redo');
 await write(a,'set_comment_resolved',{id:parent.id,resolved:true});await write(a,'set_comment_resolved',{id:reply.id,resolved:true});
 await a.execute('undo');assert.equal((await list(a)).comments.find(x=>x.id===reply.id).resolved,false);await a.execute('redo');checked('resolve undo redo');
 await assert.rejects(write(a,'delete_comment',{id:parent.id}),/COMMENT_HAS_REPLIES/);assert.equal((await list(a)).count,2);checked('parent delete refuses orphaning');
 await write(a,'delete_comment',{id:reply.id});assert.equal((await list(a)).count,1);await a.execute('undo');assert.equal((await list(a)).count,2);await a.execute('redo');assert.equal((await list(a)).count,1);await a.execute('undo');checked('resolved leaf delete undo redo');
 assert.deepEqual(stable(await a.unoCall('test_state')),stable(initial));checked('all 600 revision identities content author and body unchanged');
 const exported=await a.execute('export_document',{name:'comments.docx'});await fs.writeFile(root+'/comments.docx',exported.bytes);
 await b.execute('load_document',{bytes:exported.bytes,name:'reopen.docx',authorName:'重开用户'});rows=(await list(b)).comments;assert.equal(rows.length,2);const reopened=await b.unoCall('test_state');const revisionContent=state=>state.revisions.map(({type,text,author,dateTime})=>({type,text,author,dateTime}));assert.equal(reopened.body,initial.body);assert.deepEqual(revisionContent(reopened),revisionContent(initial));
 const p=rows.find(x=>x.content==='甲修改后的批注'),r=rows.find(x=>x.content==='乙的真实回复');assert.ok(p.resolved&&r.resolved);assert.equal(r.parentId,p.id);assert.equal(r.author,'批注验收乙');assert.equal(p.author,'批注验收甲');checked('DOCX reopen resolved real thread authors');
 await b.unoCall('goto_comment',{id:r.id});assert.equal((await b.unoCall('test_state')).modified,false);await write(b,'update_comment',{id:r.id,content:'重开后的回复修改',expectedComment:r});checked('nameless imported reply locate edit');
 const ai=await write(b,'reply_comment',{id:r.id,text:'AI回复',asUser:true,__agent:true});rows=(await list(b)).comments;assert.equal(rows.length,3);assert.equal(rows.find(x=>x.id===ai.id).author,'AI WorkDeck');checked('reply to imported reply and agent cannot impersonate human');
 await b.execute('undo');assert.equal((await list(b)).count,2);await b.execute('redo');assert.equal((await list(b)).count,3);checked('nested reply undo redo');
 const nested=await b.execute('export_document',{name:'nested.docx'});await fs.writeFile(root+'/nested.docx',nested.bytes);
 await c.execute('load_document',{bytes:nested.bytes,name:'readonly.docx',authorName:'只读用户'});const readonly=(await list(c));assert.equal(readonly.count,3);assert.equal(readonly.truncated,false);const nestedParent=readonly.comments.find(x=>x.content==='重开后的回复修改'),nestedChild=readonly.comments.find(x=>x.content==='AI回复'),nestedRoot=readonly.comments.find(x=>x.content==='甲修改后的批注');assert.equal(nestedChild.parentId,nestedParent.id);assert.equal(nestedParent.parentId,nestedRoot.id);
 await assert.rejects(c.unoCall('update_comment',{id:readonly.comments[0].id,content:'拒绝'}),/READ_ONLY/);checked('real readonly model rejects mutation');
 result.final=readonly;result.revisionCount=(await b.unoCall('test_state')).revisions.length;assert.equal(result.revisionCount,600);
}catch(error){result.error=error.stack;process.exitCode=1}finally{await a.close();await b.close();await c.close();result.exits=[a,b,c].map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})();
'''


@unittest.skipUnless(os.environ.get('AWD_NATIVE_COMMENT_CONFIG'), 'isolated native runtime explicitly required')
class NativeCommentRoundtrip(unittest.TestCase):
    def test_real_worker_docx_threads_undo_and_readonly(self):
        artifacts = Path(os.environ['AWD_NATIVE_COMMENT_ARTIFACTS'])
        artifacts.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='integration-', dir=artifacts))
        script = run / 'scenario.cjs'
        script.write_text(NATIVE_SCENARIO)
        env = {**os.environ, 'AWD_NATIVE_COMMENT_SOURCE': str(SOURCE),
               'AWD_NATIVE_COMMENT_TEST': str(Path(__file__).resolve()), 'AWD_NATIVE_COMMENT_RUN': str(run)}
        with (run / 'scenario.log').open('w') as log:
            child = subprocess.run(['node', str(script)], env=env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(child.returncode, 0, result.get('error', str(run)))
        self.assertEqual(len(result['checks']), 14)
        self.assertEqual(result['exits'], [{'engine': 0, 'uno': 0}] * 3)
        with zipfile.ZipFile(run / 'comments.docx') as doc:
            extension = ET.fromstring(doc.read('word/commentsExtended.xml'))
            rows = list(extension)
            ns = '{http://schemas.microsoft.com/office/word/2012/wordml}'
            self.assertTrue(any(row.get(ns + 'paraIdParent') for row in rows))
            self.assertEqual(sum(row.get(ns + 'done') == '1' for row in rows), 2)
        print('Native evidence:', run, flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--port':
        bridge_driver(int(sys.argv[2]))
    else:
        unittest.main()
