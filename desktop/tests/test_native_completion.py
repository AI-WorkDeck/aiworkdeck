# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Token freshness and real Writer completion/writing/PDF roundtrips."""
from pathlib import Path
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from test_native_review_actions import ReviewModel
from test_native_document import CursorRange, Uno
import native_completion_uno as completion

SOURCE = Path(__file__).resolve().parents[1] / 'main' / 'native'


class CompletionContracts(unittest.TestCase):
    def setUp(self):
        self.commands = completion.NativeCompletionCommands()
        self.model = ReviewModel('前文待补全后文', 5, 5)

    def run_action(self, action, params=None, **overrides):
        identity = dict(document_epoch=1, revision=9, read_only=False, permission_seq=0)
        identity.update(overrides)
        return self.commands.execute(action, params or {}, self.model, Uno, None, **identity)

    def test_capture_copies_range_and_context_and_rejects_motion_revision_permission(self):
        result = self.run_action('get_completion_context')
        self.assertTrue(result['available']); self.assertEqual(result['before'], '前文待补全')
        for override in [dict(revision=10), dict(permission_seq=1), dict(document_epoch=2)]:
            self.assertEqual(self.run_action('accept_completion', {'token':result['token'],'prefix':'待补全','text':'待补全完成'}, **override)['reason'], 'stale')
        result = self.run_action('get_completion_context')
        self.model.selected = CursorRange(self.model.story, 0)
        self.assertEqual(self.run_action('accept_completion', {'token':result['token'],'prefix':'待补全','text':'待补全完成'})['reason'], 'stale')

    def test_writing_snapshot_survives_ordinary_capture_and_checks_exact_selection(self):
        self.model.selected = CursorRange(self.model.story, 2, 5)
        writing = self.run_action('capture_writing_context')
        self.assertEqual(writing['sectionTitle'], '正文'); self.assertEqual(writing['selectedText'], '待补全')
        regular = self.run_action('get_completion_context')
        self.assertNotEqual(writing['token'], regular['token'])
        params = dict(token=writing['token'],revision=9,text='新内容',expectedSelection='待补全')
        with patch.object(self.commands, 'apply', return_value={'accepted':True}) as apply:
            self.assertEqual(self.run_action('accept_writing_suggestion', params), {'accepted':True})
            self.assertEqual(apply.call_args.args[9], '采用写作建议')
        self.assertEqual(self.run_action('accept_writing_suggestion', dict(params,expectedSelection='不同'))['reason'], 'selection-mismatch')

    def test_composition_readonly_and_bad_suggestion_refuse_before_mutation(self):
        self.assertEqual(self.run_action('capture_writing_context', {'composing':True})['reason'], 'composing')
        self.assertEqual(self.run_action('capture_writing_context', read_only=True)['reason'], 'readonly')
        writing = self.run_action('capture_writing_context')
        for text in ['', '😀'*1001, '控制\x00字符']:
            self.assertEqual(self.run_action('accept_writing_suggestion', {'token':writing['token'],'text':text})['reason'], 'invalid-suggestion')
        self.assertEqual(self.model.undo_events, [])

    def test_prefix_is_not_reinserted_and_rows_require_real_body_scope(self):
        result = self.run_action('get_completion_context')
        with patch.object(self.commands, 'apply', return_value={'accepted':True}) as apply:
            self.run_action('accept_completion', {'token':result['token'],'prefix':'待补全','text':'待补全完成'})
            self.assertEqual(apply.call_args.args[7], '完成')
        self.assertEqual(self.run_action('insert_completion_content', {'token':result['token'],'rows':[[]]})['reason'], 'invalid-table')
        with patch.object(completion, 'body_index', return_value=-1):
            self.assertEqual(self.run_action('insert_completion_content', {'token':result['token'],'rows':[['列']]})['reason'], 'table-requires-body')

    def test_house_profile_uses_existing_resource_layouts_and_never_silent_defaults(self):
        canonical = SOURCE.parents[2] / 'backend/src/main/resources/style-profiles/house-default.json'
        expected = json.loads(canonical.read_text())
        self.assertEqual(completion.house_table_profile(), expected)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for script in (root/'desktop/main/native/native_completion_uno.py',
                           root/'app.asar.unpacked/main/native/native_completion_uno.py'):
                profile = root/'frontend/dist/zetaoffice/house-default.json'
                profile.parent.mkdir(parents=True,exist_ok=True)
                profile.write_text(canonical.read_text())
                with patch.object(completion, '__file__', str(script)):
                    completion.house_table_profile.cache_clear()
                    self.assertEqual(completion.house_table_profile(), expected)
                    profile.write_text('{broken json')
                    completion.house_table_profile.cache_clear()
                    with self.assertRaises(json.JSONDecodeError): completion.house_table_profile()
                    profile.unlink()
                    completion.house_table_profile.cache_clear()
                    with self.assertRaisesRegex(RuntimeError,'HOUSE table profile is unavailable'): completion.house_table_profile()
        completion.house_table_profile.cache_clear()

    def test_host_context_menu_requires_enabled_bounded_selection(self):
        self.assertEqual(self.run_action('get_context_menu_context')['reason'], 'native-menu')
        self.run_action('set_host_context_menu', {'enabled':True,'maxLength':2})
        self.model.selected = CursorRange(self.model.story, 2, 5)
        self.assertEqual(self.run_action('get_context_menu_context')['reason'], 'native-menu')
        self.run_action('set_host_context_menu', {'enabled':True,'maxLength':3})
        self.assertEqual(self.run_action('get_context_menu_context')['selectedText'], '待补全')

    def test_writing_scope_keeps_appendix_namespace_and_automatic_label_separate(self):
        from test_native_document import Paragraph
        values = [Paragraph('普通前文'), Paragraph('附件一 服务清单'), Paragraph('服务范围'), Paragraph('正文')]
        values[2].props.update(ListLabelString='第一条', ListId='list', NumberingIsNumber=True)
        with patch.object(completion,'body_index',return_value=3), patch.object(completion.document,'paragraphs',return_value=values):
            section = completion.writing_section(self.model, object())
        self.assertEqual(section['sectionPath'], ['附件一','第一条'])
        self.assertEqual(section['sectionTitle'], '附件一 / 第一条')
        self.assertEqual(section['scopeHeadings'], [{'index':1,'text':'附件一 服务清单'},{'index':2,'text':'第一条 服务范围'}])
        self.assertEqual(values[2].getString(), '服务范围')


SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_EDIT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session'),{createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_EDIT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_EDIT_CONFIG));
const make=(name,readOnly=false)=>new NativeEditorSession({config,run:root+'/'+name,readOnly,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_EDIT_TEST;return createProcessChannel(args)}}),a=make('writing'),b=make('readonly',true),c=make('reopen'),result={checks:[],root};
const check=name=>result.checks.push(name),read=(action,p={})=>a.execute(action,{...p,__agent:true}),state=()=>a.unoCall('test_state');
const select=async(text,collapse=false)=>{const found=await read('find_text_locations',{keyword:text});assert.equal(found.count,1);assert.equal((await read('set_selection',{anchor:found.matches[0].anchorId})).success,true);if(collapse)await a.execute('collapse_selection',{to:'end',__agent:true})};
const capture=()=>a.execute('capture_writing_context');
const assertHouse=table=>{
 assert.equal(table.repeat,true);assert.equal(table.headerRows,1);
 for(const line of Object.values(table.borders)){assert.equal(line.width,53);assert.equal(line.color,0);assert.equal(line.style,0)}
 for(let r=0;r<table.format.length;r++)for(let c=0;c<table.format[r].length;c++){
  const f=table.format[r][c];assert.deepEqual(f.fonts,['Arial','楷体_GB2312','Arial']);assert.deepEqual(f.sizes,[10,10,10]);assert.deepEqual(f.weights,r===0?[150,150,150]:[100,100,100]);
  assert.equal(f.color,0);assert.equal(f.top,85);assert.equal(f.bottom,85);assert.equal(f.firstLine,0);assert.deepEqual(f.spacing,{mode:1,height:423});assert.equal(f.vertical,2);assert.equal(f.align,r===0?3:c===1?1:0);
 }
};
try{
 const bytes=new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_EDIT_FIXTURE));await a.execute('load_document',{bytes,name:'writing.docx',authorName:'人工作者'});
 await select('前段',true);let context=await a.execute('get_completion_context');const before=await state();const adopted=await a.execute('accept_completion',{token:context.token,prefix:'前段',text:'前段完成'});result.adopted=adopted;assert.equal(adopted.success,true);assert.equal(adopted.inserted,'完成');assert.ok(adopted.token);let after=await state();assert.ok(after.final.includes('前段完成'));assert.ok(!after.final.includes('前段前段'));assert.equal(after.undo.undo.depth,before.undo.undo.depth+1);check('prefix completion appends only suffix and returns a fresh follow-up token');
 const content=await a.execute('insert_completion_content',{token:adopted.token,text:'\n资料首段\n资料尾段',rows:[['列一','列二'],['**原样**','12']]});assert.equal(content.success,true);assert.ok(content.table);const tableState=await a.unoCall('test_completion_tables');assert.ok(tableState.some(t=>t.name===content.table&&t.cells[1][0]==='**原样**'));const document=await read('get_document_text');assert.ok(document.paragraphs.some(p=>p.text==='资料首段'));assert.ok(document.paragraphs.some(p=>p.text==='资料尾段'));check('detail token inserts actual paragraphs and a real literal-text table');result.houseTable=tableState.find(t=>t.name===content.table);assertHouse(result.houseTable);check('HOUSE fonts sizes borders spacing vertical and content alignment match existing defaults');
 await a.execute('undo');assert.equal((await a.unoCall('test_completion_tables')).length,1);assert.ok(!(await state()).final.includes('资料首段'));await a.execute('redo');assert.equal((await a.unoCall('test_completion_tables')).length,2);check('paragraph and table insertion has one complete undo/redo group');assertHouse((await a.unoCall('test_completion_tables')).find(t=>t.name===content.table));check('redo restores complete HOUSE table formatting');
 await select('乙方应在五日内付款。');context=await capture();assert.equal(context.available,true);assert.equal(context.selectedText,'乙方应在五日内付款。');await a.execute('get_completion_context');const writingBefore=await state();const written=await a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,expectedSelection:context.selectedText,text:'乙方应在七日内付款。\n**这是原样新段落**',__agent:true});result.written=written;assert.equal(written.success,true);assert.equal(written.operation,'replace-selection');after=await state();assert.equal(after.undo.undo.depth,writingBefore.undo.undo.depth+1);assert.equal(after.show,writingBefore.show);assert.deepEqual(after.author,writingBefore.author);assert.ok(after.revisions.some(r=>r.author==='AI WorkDeck'));assert.ok((await read('get_document_text')).paragraphs.some(p=>p.text==='**这是原样新段落**'));check('independent writing snapshot replaces exact selection with tracked literal paragraphs');
 await a.execute('undo');assert.ok((await state()).final.includes('乙方应在五日内付款。'));await a.execute('redo');assert.ok((await state()).final.includes('乙方应在七日内付款。'));check('writing adoption undo and redo restore exact selection versions');
 await select('末段',true);context=await capture();await a.execute('export_document');await a.execute('export_pdf');const exported=await a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,expectedSelection:'',text:'导出后仍可续写'});assert.equal(exported.success,true);check('readonly DOCX and PDF export preserve writing token freshness');
 context=await capture();await select('后段',true);assert.equal((await a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,text:'拒绝错位置'})).reason,'stale');context=await capture();await a.execute('modify_paragraph',{index:0,newText:'其他段落的新标题',__agent:true});assert.equal((await a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,text:'拒绝旧版本'})).reason,'stale');check('cursor movement and another paragraph edit invalidate writing snapshots');
 await select('后段',true);context=await capture();assert.equal((await a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,text:'拒绝预编辑',composing:true})).reason,'composing');assert.equal((await a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,text:'x'.repeat(2001)})).reason,'invalid-suggestion');check('composition and oversized suggestions refuse without publication');
 await a.execute('set_host_context_menu',{enabled:true,maxLength:20});await select('现稿30日');const menu=await a.execute('get_context_menu_context');assert.equal(menu.success,true);assert.equal(menu.selectedText,'现稿30日');await a.unoCall('test_select_paragraph',{contains:'旧稿：'});assert.equal((await a.execute('get_context_menu_context')).reason,'native-menu');await a.execute('set_host_context_menu',{enabled:false,maxLength:20});assert.equal((await a.execute('get_context_menu_context')).reason,'native-menu');check('context menu accepts final selection but refuses inline deletion selection or disabled state');
 await select('表格甲方三日');assert.equal((await capture()).reason,'unknown-writing-scope');await select('后段',true);context=await capture();await a.execute('set_read_only',{documentEpoch:a.model.documentEpoch,permissionSeq:1,readOnly:true});await a.execute('set_read_only',{documentEpoch:a.model.documentEpoch,permissionSeq:2,readOnly:false});assert.equal((await a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,text:'拒绝旧授权'})).reason,'stale');check('table writing scope refuses and permission revoke/regrant expires pending tokens');
 const saved=await a.execute('export_document');await fs.writeFile(root+'/completion.docx',saved.bytes);const final=await state();await c.execute('load_document',{bytes:saved.bytes,name:'reopen.docx',authorName:'重开'});assert.equal((await c.unoCall('test_state')).final,final.final);assert.deepEqual((await c.unoCall('test_completion_tables')).map(t=>t.cells),(await a.unoCall('test_completion_tables')).map(t=>t.cells));check('DOCX reopen preserves exact body and true table cells');result.reopenedHouseTable=(await c.unoCall('test_completion_tables')).find(t=>t.cells[1]?.[0]==='**原样**');assertHouse(result.reopenedHouseTable);check('DOCX reopen preserves HOUSE table formatting');
 await b.execute('load_document',{bytes:saved.bytes,name:'readonly.docx',authorName:'只读'});assert.equal((await b.execute('capture_writing_context')).reason,'readonly');await assert.rejects(b.execute('accept_completion',{token:adopted.token,prefix:'前段',text:'前段禁止'}),{code:'READ_ONLY'});check('readonly cannot capture writable context or adopt text');
 await select('后段',true);context=await capture();await a.execute('load_document',{bytes:saved.bytes,name:'retarget.docx',authorName:'人工作者'});assert.equal((await a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,text:'拒绝旧模型'})).reason,'stale');check('document retarget cannot reuse any old token');
 await select('后段',true);const failedBefore=await state();context=await capture();const call=a.unoCall.bind(a);a.unoCall=(method,p)=>call(method==='accept_writing_suggestion'?'test_fail_completion':method,p);await assert.rejects(a.execute('accept_writing_suggestion',{token:context.token,revision:context.revision,text:'必须撤回',__agent:true}),/EDIT_OUTCOME_UNKNOWN/);assert.ok(a.failure);const failedAfter=await call('test_state');assert.equal(failedAfter.final,failedBefore.final);assert.deepEqual(failedAfter.undo.undo,failedBefore.undo.undo);assert.deepEqual(failedAfter.author,failedBefore.author);check('partial write rolls back its own group and poisons uncertain redo lineage');
}catch(error){result.error=error.stack;process.exitCode=1}finally{for(const s of [a,b,c])await s.close();result.exits=[a,b,c].map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})();
'''


def bridge_driver(port):
    import native_review_uno as review
    import uno
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    remote = resolver.resolve(f'uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext')
    desktop = remote.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', remote)
    from test_native_document_edit import edit, document
    for line in sys.stdin:
        request = json.loads(line)
        try:
            params, action = request['params'], request['method']
            model = review.model_for(desktop, params['documentUrl'])
            if action == 'test_completion_tables':
                enumeration, result = model.getText().createEnumeration(), []
                while enumeration.hasMoreElements():
                    table = enumeration.nextElement()
                    if table.supportsService('com.sun.star.text.TextTable'):
                        cells, formats = [], []
                        for row in range(table.getRows().getCount()):
                            values, styles = [], []
                            for col in range(table.getColumns().getCount()):
                                cell = table.getCellByName(chr(65+col)+str(row+1))
                                cursor = cell.createTextCursor(); cursor.gotoStart(False); cursor.gotoEnd(True)
                                prop = cursor.getPropertyValue; line = prop('ParaLineSpacing')
                                values.append(cell.getString())
                                styles.append(dict(fonts=[prop('CharFontName'+suffix) for suffix in ('','Asian','Complex')],
                                    sizes=[prop('CharHeight'+suffix) for suffix in ('','Asian','Complex')],
                                    weights=[prop('CharWeight'+suffix) for suffix in ('','Asian','Complex')],color=prop('CharColor'),
                                    top=prop('ParaTopMargin'),bottom=prop('ParaBottomMargin'),firstLine=prop('ParaFirstLineIndent'),
                                    spacing=dict(mode=line.Mode,height=line.Height),vertical=cell.getPropertyValue('VertOrient'),align=prop('ParaAdjust')))
                            cells.append(values);formats.append(styles)
                        border = table.getPropertyValue('TableBorder2')
                        result.append(dict(name=table.getName(),cells=cells,format=formats,
                            repeat=table.getPropertyValue('RepeatHeadline'),headerRows=table.getPropertyValue('HeaderRowCount'),
                            borders={key:dict(width=getattr(border,key).LineWidth,color=getattr(border,key).Color,style=getattr(border,key).LineStyle)
                                     for key in ('TopLine','BottomLine','LeftLine','RightLine','HorizontalLine','VerticalLine')}))
            elif action == 'test_select_paragraph':
                paragraph = next(item for item in document.paragraphs(model) if params['contains'] in item.getString())
                if model.getCurrentController().select(paragraph) is False:
                    raise RuntimeError('Fixture paragraph selection failed')
                result = dict(success=True)
            elif action == 'test_state':
                access = edit.profile_access(remote, uno)
                with document.final_text(model, uno, True):
                    final = model.getText().getString()
                result = dict(final=final, all=model.getText().getString(), modified=model.isModified(),
                    record=model.getPropertyValue('RecordChanges'), show=model.getPropertyValue('ShowChanges'),
                    modifiedEnabled=model.isSetModifiedEnabled(), author=[access.getByName('givenname'),access.getByName('sn')],
                    undo=review.undo_state(model), revisions=review.dispatch('snapshot',{},model,uno,remote)['entries'])
            elif action == 'test_fail_completion':
                original = edit.apply_replacement
                def fail_after(*args):
                    original(*args)
                    raise RuntimeError('controlled failure after completion publication')
                edit.apply_replacement = fail_after
                try:
                    result = review.dispatch('accept_writing_suggestion',params,model,uno,remote)
                finally:
                    edit.apply_replacement = original
            else:
                result = review.dispatch(action,params,model,uno,remote)
            response = dict(id=request['id'],result=result)
        except Exception as error:
            import traceback
            traceback.print_exc(file=sys.stderr)
            response = dict(id=request['id'],error=str(error))
        print(json.dumps(response,ensure_ascii=True),flush=True)


@unittest.skipUnless(os.environ.get('AWD_NATIVE_EDIT_CONFIG'), 'isolated runtime explicitly required')
class NativeCompletionRoundtrip(unittest.TestCase):
    def test_actual_completion_writing_table_export_and_retarget(self):
        from test_native_document_edit import fixture
        artifacts = Path(os.environ['AWD_NATIVE_EDIT_ARTIFACTS']); artifacts.mkdir(parents=True,exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='completion-',dir=artifacts))
        fixture(run/'synthetic.docx'); script=run/'scenario.cjs'; script.write_text(SCENARIO)
        env = {**os.environ,'AWD_NATIVE_EDIT_SOURCE':str(SOURCE),'AWD_NATIVE_EDIT_RUN':str(run),
               'AWD_NATIVE_EDIT_TEST':str(Path(__file__).resolve()),'AWD_NATIVE_EDIT_FIXTURE':str(run/'synthetic.docx')}
        with (run/'scenario.log').open('w') as log:
            child=subprocess.Popen(['node',str(script)],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            try:
                child.wait(timeout=180)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5);raise
        self.assertTrue((run/'result.json').exists(),str(run/'scenario.log'))
        result=json.loads((run/'result.json').read_text())
        self.assertEqual(child.returncode,0,result.get('error',str(run)))
        self.assertEqual(result['exits'],[{'engine':0,'uno':0}]*3)
        self.assertEqual(len(result['checks']),17)
        print('Native completion evidence:',run,flush=True)


if __name__ == '__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--port':
        bridge_driver(int(sys.argv[2]))
    else:
        unittest.main()
