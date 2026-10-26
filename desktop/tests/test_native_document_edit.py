# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Native text edit contracts; no provider/network or user document required."""
from pathlib import Path
from types import SimpleNamespace
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'main' / 'native'
sys.path.insert(0, str(SOURCE))
import native_document_uno as document
import native_document_edit_uno as edit


class EditContracts(unittest.TestCase):
    def test_only_supported_text_edit_actions(self):
        self.assertEqual(edit.ACTIONS, {'replace_at_position', 'replace_selection', 'insert_at_cursor',
                                        'modify_paragraph', 'collapse_selection', 'apply_review_edit'})

    def test_readonly_rejects_before_model_identity_or_author_access(self):
        commands = edit.NativeDocumentEdits(document.NativeDocumentCommands())
        for action in edit.ACTIONS - {'collapse_selection'}:
            with self.assertRaisesRegex(RuntimeError, 'READ_ONLY'):
                commands.execute(action, {}, object(), None, None, document_epoch=1,
                                 revision=1, read_only=True)

    def test_untrusted_permission_and_identity_refused(self):
        commands = edit.NativeDocumentEdits(document.NativeDocumentCommands())
        for kwargs in [{'document_epoch': 1, 'revision': 1, 'read_only': 'false'},
                       {'document_epoch': None, 'revision': 1, 'read_only': False},
                       {'document_epoch': 1, 'revision': -1, 'read_only': False}]:
            with self.assertRaises(ValueError):
                commands.execute('replace_selection', {'text': 'new'}, object(), None, None, **kwargs)

    def test_minimal_edits_change_only_different_chinese_characters(self):
        old = '甲方应在三十日内交付文件，乙方应在五日内付款。'
        new = '甲方应在六十日内交付文件，乙方应在七日内付款。'
        plan = edit.minimal_edits(old, new)
        self.assertEqual(sum(x['delLen'] for x in plan), 2)
        self.assertEqual(''.join(x['insText'] for x in plan), '七六')
        for item in plan:
            old = old[:item['start']] + item['insText'] + old[item['start'] + item['delLen']:]
        self.assertEqual(old, new)

    def test_long_clause_keeps_unchanged_middle_and_noop_has_no_edits(self):
        old = '甲' + '共同不变部分' * 1000 + '乙'
        new = '丙' + '共同不变部分' * 1000 + '丁'
        self.assertEqual(sum(x['delLen'] for x in edit.minimal_edits(old, new)), 2)
        self.assertEqual(edit.minimal_edits(old, old), [])

    def test_diff_matches_existing_worker_oracle(self):
        source = Path(__file__).resolve().parents[2] / 'frontend/src/zetaoffice/public/office_thread.js'
        pairs = [['甲方应付三万元，七日内到账', '乙方应付五万元，十日内到账'], ['ABCABC', 'ABXABC'],
                 ['我爱你', '我恨你'], ['全部删掉', ''], ['', '全部新增'], ['甲的乙的丙', '甲之乙之丙'],
                 ['中文' * 1100, '其他' * 1100], ['相同', '相同']]
        script = r'''
const fs=require('node:fs'),vm=require('node:vm');const src=fs.readFileSync(process.argv[1],'utf8');
const start=src.indexOf('const MINIMAL_EDITS_MAX_D ='),end=src.indexOf('// —— 最小修订比对',start);
const context={};vm.runInNewContext(src.slice(start,end)+';this.plan=minimalEdits',context);
const input=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(input.map(([a,b])=>context.plan(a,b))));
'''
        result = subprocess.run(['node', '-e', script, str(source)], input=json.dumps(pairs),
                                capture_output=True, text=True, check=True, timeout=15)
        self.assertEqual([edit.minimal_edits(*pair) for pair in pairs], json.loads(result.stdout))

    def test_actual_model_readonly_and_stale_anchor_fail_closed(self):
        commands = edit.NativeDocumentEdits(document.NativeDocumentCommands())
        with self.assertRaisesRegex(RuntimeError, 'READ_ONLY'):
            commands.execute('modify_paragraph', {'index': 0, 'newText': '拒绝'},
                             SimpleNamespace(isReadonly=lambda: True), None, None,
                             document_epoch=1, revision=0, read_only=False)
        with self.assertRaisesRegex(ValueError, 'ANCHOR_CHANGED'):
            commands.anchor_range(object(), 1, '__ai_anchor_unissued')

    def test_partial_failure_restores_author_and_balances_one_undo_but_stays_unknown(self):
        events = []
        author = {'givenname': '本人', 'sn': '姓'}
        access = SimpleNamespace(getByName=author.get, replaceByName=lambda key, value: author.__setitem__(key, value),
                                 commitChanges=lambda: events.append(('author', dict(author))))
        model = SimpleNamespace(isSetModifiedEnabled=lambda: True, getUndoManager=lambda: SimpleNamespace(
            enterUndoContext=lambda title: events.append('enter'), leaveUndoContext=lambda: events.append('leave')))
        with patch.object(edit, 'profile_access', return_value=access):
            with self.assertRaisesRegex(RuntimeError, 'EDIT_OUTCOME_UNKNOWN.*after publication'):
                with edit.mutation(model, None, None, True):
                    self.assertEqual(author, {'givenname': 'AI WorkDeck', 'sn': ''})
                    raise RuntimeError('after publication')
        self.assertEqual(author, {'givenname': '本人', 'sn': '姓'})
        self.assertEqual(events[0], 'enter')
        self.assertEqual(events[-1], 'leave')
        self.assertEqual(events.count('enter'), 1)
        self.assertEqual(events.count('leave'), 1)

    def test_cleanup_failure_is_unknown_and_disabled_modified_model_never_edits(self):
        events = []
        model = SimpleNamespace(isSetModifiedEnabled=lambda: False,
                                getUndoManager=lambda: events.append('must not enter'))
        with self.assertRaisesRegex(RuntimeError, 'EDIT_STATE_UNAVAILABLE'):
            with edit.mutation(model, None, None, False):
                self.fail('must not edit')
        self.assertEqual(events, [])
        def leave():
            raise RuntimeError('controlled leave failure')
        model = SimpleNamespace(isSetModifiedEnabled=lambda: True, getUndoManager=lambda: SimpleNamespace(
            enterUndoContext=lambda title: None, leaveUndoContext=leave))
        with self.assertRaisesRegex(RuntimeError, 'EDIT_OUTCOME_UNKNOWN.*controlled leave failure'):
            with edit.mutation(model, None, None, False):
                pass

    def test_undo_entry_failure_is_unknown_before_any_body_is_run(self):
        def enter(title):
            raise RuntimeError('controlled enter failure')
        model = SimpleNamespace(isSetModifiedEnabled=lambda: True,
                                getUndoManager=lambda: SimpleNamespace(enterUndoContext=enter))
        with self.assertRaisesRegex(RuntimeError, 'EDIT_OUTCOME_UNKNOWN.*controlled enter failure'):
            with edit.mutation(model, None, None, False):
                self.fail('must not edit after failed undo entry')


def fixture(path):
    from test_native_document import make_fixture
    make_fixture(path)
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    run = lambda text: '<w:r><w:t xml:space="preserve">' + escape(text) + '</w:t></w:r>'
    para = lambda text: '<w:p>' + run(text) + '</w:p>'
    clause = '甲方应在三十日内交付文件，乙方应在五日内付款。'
    body = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' + run('修改验收') + '</w:p>'
    body += para(clause)
    body += '<w:p>' + run('旧稿：') + '<w:del w:id="1" w:author="原作者" w:date="2026-10-01T12:00:00Z"><w:r><w:delText>30日</w:delText></w:r></w:del>' + run('；现稿30日。') + '</w:p>'
    body += para('😀甲段🙂') + para('前段') + para('后段')
    body += '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>' + para('表格甲方三日') + '</w:tc></w:tr></w:tbl>'
    body += para('末段')
    with zipfile.ZipFile(path) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    entries['word/document.xml'] = f'<w:document xmlns:w="{ns}"><w:body>{body}<w:sectPr/></w:body></w:document>'.encode()
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, value in entries.items():
            archive.writestr(name, value)


def bridge_driver(port):
    import native_review_uno as review
    import uno
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    remote = resolver.resolve(f'uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext')
    desktop = remote.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', remote)
    commands = edit.NativeDocumentEdits(review.document_commands)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            params, action = request['params'], request['method']
            model = review.model_for(desktop, params['documentUrl'])
            if action in edit.ACTIONS:
                result = commands.execute(action, params, model, uno, remote,
                                          document_epoch=params['nativeDocumentEpoch'], revision=params['nativeRevision'],
                                          read_only=params['nativeReadOnly'])
            elif action == 'test_state':
                access = edit.profile_access(remote, uno)
                with document.final_text(model, uno, True):
                    final = model.getText().getString()
                result = dict(final=final, all=model.getText().getString(), modified=model.isModified(),
                              record=model.getPropertyValue('RecordChanges'), show=model.getPropertyValue('ShowChanges'),
                              modifiedEnabled=model.isSetModifiedEnabled(), author=[access.getByName('givenname'), access.getByName('sn')],
                              undo=review.undo_state(model), revisions=review.dispatch('snapshot', {}, model, uno, remote)['entries'])
            elif action in ('test_fail_after_edit', 'test_fail_review_edit'):
                original_apply = edit.apply_replacement
                def fail_after(*args):
                    original_apply(*args)
                    raise RuntimeError('controlled failure after actual text publication')
                edit.apply_replacement = fail_after
                try:
                    result = commands.execute('apply_review_edit' if action == 'test_fail_review_edit' else 'replace_selection', params, model, uno, remote,
                                              document_epoch=params['nativeDocumentEpoch'], revision=params['nativeRevision'],
                                              read_only=params['nativeReadOnly'])
                finally:
                    edit.apply_replacement = original_apply
            else:
                result = review.dispatch(action, params, model, uno, remote)
            response = dict(id=request['id'], result=result)
        except Exception as error:
            import traceback
            traceback.print_exc(file=sys.stderr)
            response = dict(id=request['id'], error=str(error))
        print(json.dumps(response, ensure_ascii=True), flush=True)


SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_EDIT_SESSION_SOURCE||process.env.AWD_NATIVE_EDIT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session'),{createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_EDIT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_EDIT_CONFIG));
const create=(name,readOnly)=>new NativeEditorSession({config,run:root+'/'+name,readOnly,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_EDIT_TEST;return createProcessChannel(args)}});
const a=create('edit',false),b=create('reopen',false),c=create('readonly',true);const result={checks:[],root};
const checked=name=>result.checks.push(name),read=(s,action,p={})=>s.unoCall(action,{...p,__agent:true});
const write=(action,p={})=>a.task(async()=>{if(action!=='collapse_selection')a.assertWrite();const r=await a.undo.edit(()=>a.unoCall(action,{...p,__agent:p.__agent!==false}));if(r.changed)a.changed();return r});
const find=async(text)=>{const r=await read(a,'find_text_locations',{keyword:text});assert.equal(r.count,1);return r.matches[0].anchorId};
const select=async(text)=>{const anchor=await find(text);assert.equal((await read(a,'set_selection',{anchor})).success,true);return anchor};
const state=()=>a.unoCall('test_state');const original='甲方应在三十日内交付文件，乙方应在五日内付款。',updated='甲方应在六十日内交付文件，乙方应在七日内付款。';
try{
 const bytes=new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_EDIT_FIXTURE));await a.execute('load_document',{bytes,name:'edit.docx',authorName:'人类验收'});
 const initial=await state();assert.equal(initial.revisions.length,1);
 const anchor=await find(original);const before=await state();const changed=await write('replace_at_position',{anchor,newText:updated});assert.equal(changed.success,true);assert.equal(changed.changed,true);let after=await state();assert.ok(after.final.includes(updated));assert.equal(after.modified,true);assert.deepEqual(after.author,['人类验收','']);assert.equal(after.show,before.show);assert.equal(after.modifiedEnabled,true);assert.equal(after.record,true);assert.equal(after.undo.undo.depth,before.undo.undo.depth+1);
 const ai=after.revisions.filter(r=>r.author==='AI WorkDeck');assert.deepEqual(ai.filter(r=>r.type==='Delete').map(r=>r.text).sort(),['三','五']);assert.deepEqual(ai.filter(r=>r.type==='Insert').map(r=>r.text).sort(),['七','六']);checked('one undo and exact two-character tracked AI edits with human author restored');
 await a.execute('undo');assert.ok((await state()).final.includes(original));await a.execute('redo');assert.ok((await state()).final.includes(updated));checked('real native undo redo restores both text versions');
 const tracked=await a.execute('export_document',{name:'tracked.docx'});await fs.writeFile(root+'/tracked.docx',tracked.bytes);
 await select('六十日');const selectionEdit=await write('replace_selection',{text:'九十日'});assert.equal(selectionEdit.selectedText,'');assert.equal((await a.execute('get_selection')).text,'');checked('minimal selection replacement collapses actual cursor like the existing editor');
 await select('九十日');await write('replace_selection',{text:'八十日',__agent:false});assert.ok((await state()).final.includes('八十日'));assert.equal((await state()).record,true);checked('human tracked replacement verifies final text while preserving all view');
 const noopBefore=await state();await write('modify_paragraph',{index:0,newText:'修改验收'});assert.deepEqual((await state()).undo,noopBefore.undo);checked('unchanged text does not create undo or revisions');
 const staleBefore=await state();await assert.rejects(write('replace_at_position',{anchor,newText:'不可重放'}),/ANCHOR_CHANGED/);assert.deepEqual(await state(),staleBefore);checked('stale anchor refuses before mutation');
 await select('😀甲段🙂');await write('replace_selection',{text:'😀乙段🙂'});assert.ok((await state()).final.includes('😀乙段🙂'));checked('emoji whole-range fallback keeps scalar text');
 await select('前段');await write('collapse_selection',{to:'end'});await write('insert_at_cursor',{text:'\n新增第一段\n新增第二段'});const paragraphs=await read(a,'get_document_text');assert.ok(paragraphs.paragraphs.some(p=>p.text==='前段'));assert.ok(paragraphs.paragraphs.some(p=>p.text==='新增第一段'));assert.ok(paragraphs.paragraphs.some(p=>p.text==='新增第二段'));checked('actual paragraph breaks through existing insertion chain');
 const cell=await find('表格甲方三日');await write('replace_at_position',{anchor:cell,newText:'表格乙方三日'});assert.equal((await read(a,'find_text_locations',{keyword:'表格乙方三日'})).count,1);checked('own table story text edit without table structure changes');
 await a.execute('set_track_changes',{on:false});await select('后段');await write('replace_selection',{text:'硬替换后段',__agent:false});assert.equal((await state()).record,false);checked('selection replacement preserves tracking-off hard replace');
 const sameBefore=await state();const same=await write('modify_paragraph',{index:0,newText:'修改验收'});assert.equal(same.changed,true);assert.equal(same.textChanged,false);assert.equal(same.trackingChanged,true);assert.equal((await state()).record,true);assert.deepEqual((await state()).undo,sameBefore.undo);assert.equal((await state()).final,sameBefore.final);await a.execute('set_track_changes',{on:false});checked('unchanged paragraph reports state-only permanent tracking enablement without a text undo');
 const hard=await find('硬替换后段');await write('replace_at_position',{anchor:hard,newText:'最终后段'});assert.equal((await state()).record,true);checked('anchor replacement permanently enables tracking like existing worker');
 const invalidBefore=await state();await assert.rejects(write('insert_at_cursor',{text:'**不伪装Markdown**'}),/UNSUPPORTED_NATIVE_MARKDOWN_INSERT/);await assert.rejects(write('collapse_selection',{to:'middle'}),/start or end/);assert.deepEqual(await state(),invalidBefore);checked('unsupported input and invalid cursor collapse fail without edits');
 await select('末段');await write('collapse_selection',{to:'end'});await write('insert_at_cursor',{text:'人类续写',__agent:false});assert.ok((await state()).revisions.some(r=>r.author==='人类验收'&&r.type==='Insert'&&r.text==='人类续写'));checked('next human edit is actually attributed to the restored human author');
 const saved=await a.execute('export_document',{name:'final.docx'});await fs.writeFile(root+'/final.docx',saved.bytes);const final=await state();
 await b.execute('load_document',{bytes:saved.bytes,name:'reopen.docx',authorName:'重开用户'});assert.equal((await b.unoCall('test_state')).final,final.final);checked('DOCX reopen exactly preserves final story');
 await c.execute('load_document',{bytes:saved.bytes,name:'readonly.docx',authorName:'只读'});const roBefore=await c.unoCall('test_state');for(const action of ['replace_at_position','replace_selection','insert_at_cursor','modify_paragraph'])await assert.rejects(c.unoCall(action,{text:'禁止',newText:'禁止',index:0}),/READ_ONLY/);await c.unoCall('collapse_selection',{to:'start'});assert.deepEqual(await c.unoCall('test_state'),roBefore);checked('readonly rejects all four writes and allows nonmutating valid collapse');
 await select('末段');const failedBefore=await state();await assert.rejects(a.unoCall('test_fail_after_edit',{text:'未确认末段',__agent:true}),/EDIT_OUTCOME_UNKNOWN.*controlled failure/);const failedAfter=await state();assert.ok(failedAfter.final.includes('未确认末段'));assert.deepEqual(failedAfter.author,failedBefore.author);assert.equal(failedAfter.show,failedBefore.show);assert.equal(failedAfter.modifiedEnabled,true);assert.equal(failedAfter.undo.undo.depth,failedBefore.undo.undo.depth+1);checked('injected post-write failure reports unknown not success and restores author view undo scope');
 result.final=final;
}catch(error){result.error=error.stack;process.exitCode=1}finally{await a.close();await b.close();await c.close();result.pids=[a,b,c].map(s=>({engine:s.engine?.process.pid,uno:s.uno?.process.pid}));result.exits=[a,b,c].map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({root,checks:result.checks,error:result.error,exits:result.exits},null,2))}
})();
'''


def projection(path, kind):
    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    def visit(node):
        if (kind == 'final' and node.tag == ns + 'del') or (kind == 'original' and node.tag == ns + 'ins'):
            return ''
        if node.tag in (ns + 't', ns + 'delText'):
            return node.text or ''
        text = ''.join(visit(child) for child in node)
        if node.tag == ns + 'p':
            marker = node.find('./' + ns + 'pPr/' + ns + 'rPr/' + ns + ('ins' if kind == 'original' else 'del'))
            if kind == 'all' or marker is None:
                text += '\n'
        return text
    return visit(root)


@unittest.skipUnless(os.environ.get('AWD_NATIVE_EDIT_CONFIG'), 'isolated native runtime explicitly required')
class NativeEditRoundtrip(unittest.TestCase):
    def test_actual_writer_redlines_undo_export_and_reopen(self):
        artifacts = Path(os.environ['AWD_NATIVE_EDIT_ARTIFACTS'])
        artifacts.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='integration-', dir=artifacts))
        fixture(run / 'synthetic.docx')
        script = run / 'scenario.cjs'
        script.write_text(SCENARIO)
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
        self.assertEqual(result['exits'], [{'engine': 0, 'uno': 0}] * 3)
        self.assertEqual(projection(run / 'tracked.docx', 'original'), projection(run / 'synthetic.docx', 'original'))
        self.assertIn('甲方应在六十日内交付文件，乙方应在七日内付款。', projection(run / 'tracked.docx', 'final'))
        all_text = projection(run / 'tracked.docx', 'all')
        for word in ['三', '六', '五', '七', '30日']:
            self.assertIn(word, all_text)
        self.assertEqual(projection(run / 'final.docx', 'original'),
                         projection(run / 'synthetic.docx', 'original').replace('后段', '硬替换后段'))
        final = projection(run / 'final.docx', 'final')
        for text in ['甲方应在八十日内交付文件，乙方应在七日内付款。', '😀乙段🙂',
                     '前段\n新增第一段\n新增第二段\n', '表格乙方三日', '最终后段', '末段人类续写']:
            self.assertIn(text, final)
        print('Native edit evidence:', run, flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--port':
        bridge_driver(int(sys.argv[2]))
    else:
        unittest.main()
