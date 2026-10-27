# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Evidence bookmark contracts and an owned real Writer/DOCX roundtrip.

AWD_NATIVE_EVIDENCE_CONFIG and AWD_NATIVE_EVIDENCE_ARTIFACTS enable the actual
native test. All documents, workers and profiles belong to its temporary run.
"""
import json
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile
from xml.sax.saxutils import escape

SOURCE = Path(__file__).resolve().parents[1] / 'main' / 'native'
sys.path.insert(0, str(SOURCE))
import native_evidence_uno as evidence
if os.environ.get('AWD_NATIVE_EVIDENCE_MODULE'):
    spec = importlib.util.spec_from_file_location('evidence_baseline', os.environ['AWD_NATIVE_EVIDENCE_MODULE'])
    evidence = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evidence)


class Range:
    def __init__(self, text, start=0, end=1, level=0):
        self.text, self.start, self.end, self.level = text, start, end, level

    def getString(self):
        return self.text

    def getStart(self):
        return self.start

    def getEnd(self):
        return self.end

    def getPropertyValue(self, name):
        return self.level

    def supportsService(self, service):
        return service == 'com.sun.star.text.Paragraph'


class Enumeration:
    def __init__(self, rows):
        self.rows, self.index = rows, 0

    def hasMoreElements(self):
        return self.index < len(self.rows)

    def nextElement(self):
        row = self.rows[self.index]
        self.index += 1
        return row


class Model:
    def __init__(self, rows=None):
        self.rows = rows or {'EVID_A': Range('相同引文', 12, 16)}
        self.selected, self.display, self.modified_enabled = None, 2, True
        self.paragraphs = [Range('一级', 0, 4, 1), Range('二级', 5, 10, 2), Range('相同引文', 11, 20)]
        self.ctrl = SimpleNamespace(getViewCursor=lambda: SimpleNamespace(gotoRange=self.select), select=self.select)

    def getURL(self):
        return 'file:///owned/source.docx'

    def getBookmarks(self):
        return SimpleNamespace(hasByName=lambda name: name in self.rows,
                               getByName=lambda name: SimpleNamespace(getAnchor=lambda: self.rows[name]))

    def getText(self):
        return SimpleNamespace(createEnumeration=lambda: Enumeration(self.paragraphs),
            compareRegionStarts=lambda a, b: (a < b) - (a > b),
            compareRegionEnds=lambda a, b: (a < b) - (a > b))

    def getCurrentController(self):
        return self.ctrl

    def select(self, range, *unused):
        self.selected = range
        return True

    def getPropertyValue(self, name):
        return self.display != 0 if name == 'ShowChanges' else self.display

    def setPropertyValue(self, name, value):
        self.display = value

    def isSetModifiedEnabled(self):
        return self.modified_enabled

    def disableSetModified(self):
        self.modified_enabled = False

    def enableSetModified(self):
        self.modified_enabled = True


class Uno:
    Any = staticmethod(lambda kind, value: value)
    invoke = staticmethod(lambda target, method, args: getattr(target, method)(*args))


class EvidenceReadContracts(unittest.TestCase):
    def call(self, action, params=None, model=None, **overrides):
        return evidence.dispatch(action, params or {}, model or Model(), Uno,
                                 **dict(document_epoch=7, read_only=True, **overrides))

    def test_only_verified_read_location_actions(self):
        self.assertEqual(evidence.ACTIONS, {'get_bookmark_context', 'check_link_anchors', 'goto_bookmark',
            'get_selection_hyperlink', 'bookmark_selection', 'set_selection_hyperlink', 'adopt_legacy_links'})
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED'):
            self.call('insert_link_with_bookmark', {'name': 'EVID_A'})

    def test_exact_context_heading_chain_and_missing_bookmark_shape(self):
        self.assertEqual(self.call('get_bookmark_context', {'name': 'EVID_A'}),
            dict(success=True, exists=True, text='相同引文', sectionPath='一级/二级', sectionTitle='二级', paragraphIndex=2))
        self.assertEqual(self.call('get_bookmark_context', {'name': 'EVID_MISSING'}),
            dict(success=True, exists=False, text='', sectionPath='', sectionTitle='', paragraphIndex=-1))

    def test_cross_story_has_text_but_no_invented_body_location(self):
        model = Model()
        model.getText = lambda: SimpleNamespace(createEnumeration=lambda: Enumeration(model.paragraphs),
            compareRegionStarts=lambda *args: (_ for _ in ()).throw(RuntimeError('different story')))
        result = self.call('get_bookmark_context', {'name': 'EVID_A'}, model)
        self.assertEqual(result['text'], '相同引文')
        self.assertEqual((result['sectionPath'], result['paragraphIndex']), ('', -1))

    def test_batch_keeps_requested_order_and_reports_200_limit(self):
        result = self.call('check_link_anchors', {'names': ['EVID_A', 'missing'] * 101})
        self.assertEqual(len(result['items']), 200)
        self.assertTrue(result['truncated'])
        self.assertEqual(result['items'][:2], [dict(name='EVID_A', exists=True, text='相同引文'),
                                             dict(name='missing', exists=False, text='')])

    def test_read_errors_are_not_reported_as_orphans(self):
        model = Model()
        model.getBookmarks = lambda: SimpleNamespace(hasByName=lambda name: True,
            getByName=lambda name: (_ for _ in ()).throw(RuntimeError('bridge failed')))
        for action, params in [('get_bookmark_context', {'name': 'EVID_A'}),
                               ('check_link_anchors', {'names': ['EVID_A']})]:
            with self.assertRaisesRegex(RuntimeError, 'bridge failed'):
                self.call(action, params, model)

    def test_exact_bookmark_navigation_not_first_identical_quote(self):
        first, second = Range('相同引文', 1, 5), Range('相同引文', 30, 34)
        model = Model({'EVID_A': first, 'EVID_B': second})
        self.assertEqual(self.call('goto_bookmark', {'name': 'EVID_B'}, model), dict(success=True, name='EVID_B'))
        self.assertIs(model.selected, second)
        self.assertFalse(self.call('goto_bookmark', {'name': 'missing'}, model)['success'])

    def test_unconfirmed_selection_reports_failure(self):
        model = Model()
        model.ctrl.getViewCursor = lambda: (_ for _ in ()).throw(RuntimeError('no view'))
        model.ctrl.select = lambda target: False
        result = self.call('goto_bookmark', {'name': 'EVID_A'}, model)
        self.assertFalse(result['success'])
        self.assertEqual(result['error'], result['message'])

    def test_epoch_url_and_permission_required_and_no_cross_model_range_cache(self):
        for epoch in [None, 0, True]:
            with self.assertRaises(ValueError):
                evidence.dispatch('goto_bookmark', {'name': 'EVID_A'}, Model(), Uno, document_epoch=epoch, read_only=True)
        with self.assertRaisesRegex(ValueError, 'STALE_DOCUMENT'):
            self.call('goto_bookmark', {'name': 'EVID_A', 'documentSeq': 6})
        model = Model()
        model.getURL = lambda: ''
        with self.assertRaises(ValueError):
            self.call('get_bookmark_context', {'name': 'EVID_A'}, model)
        with self.assertRaises(ValueError):
            evidence.dispatch('check_link_anchors', {}, Model(), Uno, document_epoch=7, read_only=None)
        other = Model({'EVID_A': Range('另一文档')})
        self.assertEqual(self.call('get_bookmark_context', {'name': 'EVID_A'}, other)['text'], '另一文档')

    def test_agent_reads_restore_display_and_modified_enablement(self):
        model = Model()
        self.call('check_link_anchors', {'names': ['EVID_A'], '__agent': True}, model)
        self.assertEqual(model.display, 2)
        self.assertTrue(model.modified_enabled)


class EvidenceWriteContracts(unittest.TestCase):
    def setUp(self):
        self.model, self.events = Model(), []
        self.model.isReadonly = lambda: False
        self.model.getUndoManager = lambda: SimpleNamespace(
            enterUndoContext=lambda title: self.events.append('enter'),
            leaveUndoContext=lambda: self.events.append('leave'))

    def call(self, action, params=None, readonly=False):
        return evidence.dispatch(action, params or {}, self.model, Uno, document_epoch=7, read_only=readonly)

    def test_readonly_rejects_each_write_before_model_mutation(self):
        for action in ['bookmark_selection', 'set_selection_hyperlink', 'adopt_legacy_links']:
            with self.assertRaisesRegex(RuntimeError, 'READ_ONLY'):
                self.call(action, readonly=True)
        self.model.isReadonly = lambda: True
        with self.assertRaisesRegex(RuntimeError, 'READ_ONLY'):
            self.call('adopt_legacy_links')
        self.assertEqual(self.events, [])

    def test_invalid_name_duplicate_and_disallowed_url_are_known_prewrite_refusals(self):
        for action, params in [('bookmark_selection', {'name':'EVID_A'}), ('bookmark_selection', {'name':'lk-with-dash'}),
                               ('set_selection_hyperlink', {'url':'file:///private/file'}),
                               ('set_selection_hyperlink', {'url':'javascript:bad'})]:
            with self.assertRaises(ValueError) as failure:
                self.call(action, params)
            self.assertNotIn('OUTCOME_UNKNOWN', str(failure.exception))
        self.assertEqual(self.events, [])

    def test_expected_selection_text_mismatch_precedes_undo_context(self):
        selected = self.model.rows['EVID_A']
        selected.getText = lambda: None
        self.model.ctrl.getSelection = lambda: SimpleNamespace(getCount=lambda: 1, getByIndex=lambda index: selected)
        with self.assertRaisesRegex(ValueError, 'EVIDENCE_SELECTION_CHANGED'):
            self.call('bookmark_selection', {'name':'EVID_NEW','expectedText':'另一原文'})
        self.assertEqual(self.events, [])

    def test_write_failure_and_cleanup_failure_keep_unknown_marker_and_leave_runs(self):
        for cleanup_fails in [False, True]:
            self.events.clear()
            def leave():
                self.events.append('leave')
                if cleanup_fails:
                    raise RuntimeError('cleanup failed')
            self.model.getUndoManager = lambda: SimpleNamespace(enterUndoContext=lambda title:self.events.append('enter'),leaveUndoContext=leave)
            with patch.object(evidence,'selected_text',return_value=(object(),'原文')), \
                 patch.object(evidence,'add_bookmark',side_effect=RuntimeError('write could have applied')):
                with self.assertRaisesRegex(RuntimeError,'EVIDENCE_OUTCOME_UNKNOWN'):
                    self.call('bookmark_selection',{'name':'EVID_NEW'})
            self.assertEqual(self.events,['enter','leave'])

    def test_hyperlink_readback_failure_is_unknown_and_same_url_is_noop(self):
        cursor=SimpleNamespace(getPropertyValue=lambda name:'https://old.test/',getString=lambda:'原文',setPropertyValue=lambda name,value:None)
        with patch.object(evidence,'selected_text',return_value=(cursor,'原文')):
            with self.assertRaisesRegex(RuntimeError,'EVIDENCE_OUTCOME_UNKNOWN'):
                self.call('set_selection_hyperlink',{'url':'https://new.test/'})
            self.assertEqual(self.events,['enter','leave'])
            self.events.clear()
            result = self.call('set_selection_hyperlink',{'url':'https://old.test/'})
            self.assertTrue(result['success'])
            self.assertEqual((result['bookmarkMutations'], result['hyperlinkMutations'], result['changed']), (0, 0, False))
            self.assertEqual(self.events,[])

    def test_legacy_double_decoding_never_normalizes_invalid_database_key(self):
        self.assertEqual(evidence.legacy_key('https://checkba-internal.local/open?u=checkba%253A%252F%252Ffilelink%253Fk%253DEVID_ABC%2526projectId%253D12'),('EVID_ABC',True))
        self.assertEqual(evidence.legacy_key('checkba://filelink?k=lk_bad-identity&projectId=12'),('lk_bad-identity',False))
        self.assertIsNone(evidence.legacy_key('https://example.test/not-evidence'))


def make_fixture(path):
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    text = lambda value: '<w:r><w:t xml:space="preserve">' + escape(value) + '</w:t></w:r>'
    mark = lambda name, ident, value: f'<w:bookmarkStart w:id="{ident}" w:name="{name}"/>' + value + f'<w:bookmarkEnd w:id="{ident}"/>'
    para = lambda value: '<w:p>' + value + '</w:p>'
    body = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' + text('核验章节') + '</w:p>'
    body += para(text('第一次：') + mark('EVID_A', 1, '<w:hyperlink r:id="link1">' + text('相同引文') + '</w:hyperlink>'))
    body += '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>' + text('核验子节') + '</w:p>'
    body += para(text('第二次：') + mark('EVID_B', 2, text('相同引文')))
    body += para(mark('EVID_CHANGE', 3, text('合同价款100万元。')))
    body += para(mark('EVID_REVISED', 4, text('期限') + '<w:del w:id="9" w:author="旧作者" w:date="2026-10-01T00:00:00Z"><w:r><w:delText>30日</w:delText></w:r></w:del>' + text('45日')))
    body += '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>' + para(mark('EVID_TABLE', 5, text('单元格依据'))) + '</w:tc></w:tr></w:tbl>'
    body += para('<w:hyperlink r:id="legacy">' + text('旧式依据') + '</w:hyperlink>')
    body += para('<w:hyperlink r:id="invalid">' + text('无效旧式依据') + '</w:hyperlink>')
    types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    for name, content in [('document','document.main'),('styles','styles'),('settings','settings')]:
        types += f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{content}+xml"/>'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as doc:
        doc.writestr('[Content_Types].xml', types + '</Types>')
        doc.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        links = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        for name in ['styles', 'settings']:
            links += f'<Relationship Id="{name}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{name}" Target="{name}.xml"/>'
        links += '<Relationship Id="link1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://checkba-internal.local/open?u=checkba%3A%2F%2Ffilelink%3Fk%3DEVID_A%26projectId%3D12" TargetMode="External"/>'
        for ident,key in [('legacy','EVID_LEGACY'),('invalid','lk_bad-identity')]:
            links += f'<Relationship Id="{ident}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="checkba://filelink?k={key}&amp;projectId=12" TargetMode="External"/>'
        doc.writestr('word/_rels/document.xml.rels', links + '</Relationships>')
        doc.writestr('word/document.xml', f'<w:document xmlns:w="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}<w:sectPr/></w:body></w:document>')
        styles = f'<w:styles xmlns:w="{ns}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        for level in [1,2]:
            styles += f'<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="Heading {level}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="{level-1}"/></w:pPr></w:style>'
        doc.writestr('word/styles.xml', styles + '</w:styles>')
        doc.writestr('word/settings.xml', f'<w:settings xmlns:w="{ns}"><w:trackRevisions/><w:revisionView w:del="1" w:ins="1"/></w:settings>')


def bridge_driver(port):
    import native_review_uno as review
    from native_document_uno import final_text
    import uno
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    context = resolver.resolve(f'uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext')
    desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            params, method = request['params'], request['method']
            model = review.model_for(desktop, params['documentUrl'])
            if method in evidence.ACTIONS:
                result = evidence.dispatch(method, params, model, uno, context, document_epoch=params['nativeDocumentEpoch'], read_only=params['nativeReadOnly'])
            elif method == 'test_state':
                result = dict(body=model.getText().getString(), modified=model.isModified(), recording=model.getPropertyValue('RecordChanges'),
                    display=model.getPropertyValue('RedlineDisplayType'), enabled=model.isSetModifiedEnabled(),
                    bookmarks=list(model.getBookmarks().getElementNames()), undo=review.undo_state(model),
                    redlines=review.dispatch('snapshot', {}, model, uno, context)['entries'])
            elif method == 'test_selection':
                result = {'text': model.getCurrentController().getViewCursor().getString(),
                          'url': model.getCurrentController().getViewCursor().getPropertyValue('HyperLinkURL')}
            elif method == 'test_edit':
                if params['nativeReadOnly']:
                    raise RuntimeError('READ_ONLY')
                manager = model.getUndoManager()
                manager.enterUndoContext('Fixture edit')
                recorded = model.getPropertyValue('RecordChanges')
                model.setPropertyValue('RecordChanges', False)
                try:
                    with final_text(model, uno, True):
                        if params.get('delete'):
                            model.getBookmarks().getByName(params['delete']).getAnchor().setString('')
                        else:
                            descriptor = model.createSearchDescriptor()
                            descriptor.setSearchString(params['from'])
                            model.findFirst(descriptor).setString(params['to'])
                finally:
                    model.setPropertyValue('RecordChanges', recorded)
                    manager.leaveUndoContext()
                result = {'success': True}
            else:
                result = review.dispatch(method, params, model, uno, context)
            response = {'id': request['id'], 'result': result}
        except Exception as error:
            response = {'id': request['id'], 'error': str(error)}
        print(json.dumps(response, ensure_ascii=True), flush=True)


NATIVE_SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const source=process.env.AWD_NATIVE_EVIDENCE_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session');const {createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_EVIDENCE_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_EVIDENCE_CONFIG));
const {classifyAnchorResults}=await import(pathToFileURL(process.env.AWD_NATIVE_EVIDENCE_REPO+'/frontend/src/composables/useEvidenceAnchors.js'));
const {anchorHash}=await import(pathToFileURL(process.env.AWD_NATIVE_EVIDENCE_REPO+'/frontend/src/utils/anchorHash.js'));
const create=(name,readOnly)=>new NativeEditorSession({config,run:root+'/'+name,readOnly,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_EVIDENCE_TEST;return createProcessChannel(args)}});
const a=create('writable',false),b=create('readonly',true);const result={checks:[],root};const checked=x=>result.checks.push(x);
const invoke=(s,action,p={})=>s.task(()=>s.unoCall(action,{...p,__agent:true}));
const names=['EVID_A','EVID_B','EVID_CHANGE','EVID_REVISED','EVID_TABLE','missing'];
try{
 const bytes=new Uint8Array(await fs.readFile(root+'/fixture.docx'));await b.execute('load_document',{bytes,name:'readonly.docx',authorName:'只读核验'});
 const initial=await invoke(b,'test_state');assert.equal(initial.modified,false);assert.equal(initial.redlines.length,1);
 const context=await invoke(b,'get_bookmark_context',{name:'EVID_B'});assert.deepEqual(context,{success:true,exists:true,text:'相同引文',sectionPath:'核验章节/核验子节',sectionTitle:'核验子节',paragraphIndex:3});checked('exact existing context and native heading chain');
 const table=await invoke(b,'get_bookmark_context',{name:'EVID_TABLE'});assert.equal(table.text,'单元格依据');assert.equal(table.paragraphIndex,-1);assert.equal(table.sectionPath,'');checked('table story has content without invented paragraph');
 const anchors=await invoke(b,'check_link_anchors',{names});assert.equal(anchors.items[3].text,'期限45日');assert.equal(anchors.items[5].exists,false);checked('agent final text excludes deleted revision');
 await invoke(b,'goto_bookmark',{name:'EVID_A'});assert.ok((await invoke(b,'test_selection')).url.includes('EVID_A'));
 await invoke(b,'goto_bookmark',{name:'EVID_B'});assert.equal((await invoke(b,'test_selection')).url,'');assert.equal((await invoke(b,'test_selection')).text,'相同引文');checked('duplicate quotes navigate exact bookmark and preserve filelink');
 assert.equal((await invoke(b,'goto_bookmark',{name:'missing'})).success,false);await assert.rejects(invoke(b,'goto_bookmark',{name:'EVID_A',documentSeq:b.model.documentEpoch+1}),/STALE_DOCUMENT/);
 assert.deepEqual(await invoke(b,'test_state'),initial);checked('readonly read locate missing and stale epoch preserve bytes dirty undo revisions and view');
 await a.execute('load_document',{bytes,name:'writable.docx',authorName:'核验'});
 const cache=await Promise.all(anchors.items.filter(x=>x.exists).map(async x=>({linkKey:x.name,anchorHash:await anchorHash(x.text),status:'active'})));
 await invoke(a,'test_edit',{from:'100',to:'200'});let now=await invoke(a,'check_link_anchors',{names});let classified=await classifyAnchorResults(cache,now.items,anchorHash);assert.deepEqual(classified.staleHits.map(x=>x.linkKey),['EVID_CHANGE']);checked('existing JS hash classifier marks edited quote stale');
 await a.execute('undo');now=await invoke(a,'check_link_anchors',{names});assert.equal((await classifyAnchorResults(cache,now.items,anchorHash)).reports.length,0);await a.execute('redo');checked('text edit undo redo reconciles native anchors');
 await invoke(a,'test_edit',{delete:'EVID_B'});now=await invoke(a,'check_link_anchors',{names});classified=await classifyAnchorResults(cache,now.items,anchorHash);assert.ok(classified.reports.some(x=>x.linkKey==='EVID_B'&&!x.exists));checked('deleted bookmark classified orphan without search fallback');
 const exported=await a.execute('export_document',{name:'evidence.docx'});await fs.writeFile(root+'/evidence.docx',exported.bytes);
 await b.execute('load_document',{bytes:exported.bytes,name:'reopened.docx',authorName:'只读核验'});const reopened=await invoke(b,'check_link_anchors',{names});assert.deepEqual(reopened,now);
 const reopenedState=await invoke(b,'test_state');assert.equal(reopenedState.redlines.length,1);assert.equal(reopenedState.modified,false);
 await invoke(b,'goto_bookmark',{name:'EVID_A'});assert.ok((await invoke(b,'test_selection')).url.includes('EVID_A'));assert.deepEqual(await invoke(b,'test_state'),reopenedState);checked('DOCX reopen persists bookmarks filelink stale orphan and original revision');
 const beforeWrites=await invoke(a,'test_state');await invoke(a,'goto_bookmark',{name:'EVID_CHANGE'});
 const selection=await invoke(a,'get_selection_hyperlink');assert.equal(selection.text,'合同价款200万元。');assert.equal(selection.hasSelection,true);
 const write=(action,p={})=>a.task(async()=>{a.assertWrite();const r=await a.undo.edit(()=>a.unoCall(action,{...p,__agent:true}),{isNoop:r=>r?.bookmarkMutations===0&&r?.hyperlinkMutations===0});if(r.changed)a.changed();return r});
 const bookmark=await write('bookmark_selection',{name:'EVID_NEW',expectedText:selection.text});assert.equal(bookmark.success,true);assert.deepEqual([bookmark.bookmarkMutations,bookmark.hyperlinkMutations,bookmark.changed],[1,0,true]);assert.equal((await invoke(a,'get_bookmark_context',{name:'EVID_NEW'})).text,selection.text);
 await a.execute('undo');assert.equal((await invoke(a,'get_bookmark_context',{name:'EVID_NEW'})).exists,false);await a.execute('redo');checked('new selected bookmark exact name and single undo redo');
 await invoke(a,'goto_bookmark',{name:'EVID_NEW'});const url='https://checkba-internal.local/open?u='+encodeURIComponent('checkba://filelink?k=EVID_NEW&projectId=12');
 const linkWrite=await write('set_selection_hyperlink',{url,expectedText:selection.text});assert.deepEqual([linkWrite.bookmarkMutations,linkWrite.hyperlinkMutations,linkWrite.changed],[0,1,true]);assert.equal((await invoke(a,'get_selection_hyperlink')).url,url);
 await a.execute('undo');assert.equal((await invoke(a,'get_selection_hyperlink')).url,'');assert.equal((await invoke(a,'get_bookmark_context',{name:'EVID_NEW'})).exists,true);await a.execute('redo');checked('real hyperlink metadata single undo redo without text replacement');
 const refuseBefore=await invoke(a,'test_state');
 await assert.rejects(write('bookmark_selection',{name:'EVID_NEW'}),/bookmark exists/);
 await assert.rejects(write('set_selection_hyperlink',{url:'file:///private/document'}),/only supports/);
 await assert.rejects(write('set_selection_hyperlink',{url,expectedText:'过期原文'}),/EVIDENCE_SELECTION_CHANGED/);
 assert.deepEqual(await invoke(a,'test_state'),refuseBefore);checked('prewrite invalid duplicate and changed text leave document untouched');
 const adoption=await write('adopt_legacy_links');assert.deepEqual(adoption.adopted,['EVID_LEGACY']);assert.deepEqual([adoption.bookmarkMutations,adoption.hyperlinkMutations,adoption.changed],[1,0,true]);assert.equal(adoption.skippedInvalid,1);
 assert.equal((await invoke(a,'get_bookmark_context',{name:'EVID_LEGACY'})).text,'旧式依据');await a.execute('undo');assert.equal((await invoke(a,'get_bookmark_context',{name:'EVID_LEGACY'})).exists,false);await a.execute('redo');
 const beforeRepeat=await invoke(a,'test_state');const repeated=await write('adopt_legacy_links');assert.deepEqual(repeated.adopted,[]);assert.deepEqual([repeated.bookmarkMutations,repeated.hyperlinkMutations,repeated.changed],[0,0,false]);assert.equal(repeated.skippedInvalid,1);assert.deepEqual(await invoke(a,'test_state'),beforeRepeat);checked('legacy adoption exact key persisted invalid key skipped and undo idempotence');
 const createdState=await invoke(a,'test_state');assert.equal(createdState.body,beforeWrites.body);assert.equal(createdState.recording,beforeWrites.recording);assert.equal(createdState.enabled,true);assert.equal(createdState.display,beforeWrites.display);assert.ok(createdState.modified);assert.ok(createdState.redlines.some(x=>x.text==='30日'));checked('link metadata preserves original body revision and restores agent view');
 const review=await a.execute('list_revisions');const card=review.revisions.find(r=>r.text==='30日');assert.ok(card);
 await a.execute('resolve_revision',{action:'accept',index:card.index,identifier:card.identifier,documentSeq:review.documentSeq,revision:review.revision,expectedRevision:card});
 await invoke(a,'goto_bookmark',{name:'EVID_NEW'});const inlineState=await invoke(a,'test_state');
 const sameUrl=await write('set_selection_hyperlink',{url,expectedText:selection.text});assert.deepEqual([sameUrl.bookmarkMutations,sameUrl.hyperlinkMutations,sameUrl.changed],[0,0,false]);
 const noAdoption=await write('adopt_legacy_links');assert.deepEqual([noAdoption.bookmarkMutations,noAdoption.hyperlinkMutations,noAdoption.changed],[0,0,false]);
 assert.deepEqual(await invoke(a,'test_state'),inlineState);await a.execute('undo');assert.ok((await invoke(a,'test_state')).redlines.some(r=>r.text==='30日'));checked('same URL and adopt zero preserve both native stacks with verified inline resolution on top');
 const linked=await a.execute('export_document',{name:'linked.docx'});await fs.writeFile(root+'/linked.docx',linked.bytes);await b.execute('load_document',{bytes:linked.bytes,name:'linked-reopen.docx',authorName:'只读核验'});
 assert.equal((await invoke(b,'get_bookmark_context',{name:'EVID_NEW'})).text,selection.text);assert.equal((await invoke(b,'get_bookmark_context',{name:'EVID_LEGACY'})).text,'旧式依据');await invoke(b,'goto_bookmark',{name:'EVID_NEW'});assert.equal((await invoke(b,'get_selection_hyperlink')).url,url);
 const readonlyBefore=await invoke(b,'test_state');for(const action of ['bookmark_selection','set_selection_hyperlink','adopt_legacy_links'])await assert.rejects(invoke(b,action,{name:'EVID_NO',url}),/READ_ONLY/);assert.deepEqual(await invoke(b,'test_state'),readonlyBefore);checked('created bookmarks and URLs survive DOCX reopen while readonly all writes refuse');
 result.context=context;result.anchors=reopened;result.classification=classified;result.adoption=adoption;
}catch(error){result.error=error.stack;process.exitCode=1}finally{await a.close();await b.close();result.exits=[a,b].map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));result.pids=[a,b].map(s=>({engine:s.engine?.process.pid,uno:s.uno?.process.pid}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})();
'''


@unittest.skipUnless(os.environ.get('AWD_NATIVE_EVIDENCE_CONFIG'), 'isolated native runtime explicitly required')
class NativeEvidenceRoundtrip(unittest.TestCase):
    def test_real_bookmark_context_validation_location_and_reopen(self):
        artifacts = Path(os.environ['AWD_NATIVE_EVIDENCE_ARTIFACTS'])
        artifacts.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='integration-', dir=artifacts))
        make_fixture(run / 'fixture.docx')
        (run / 'scenario.cjs').write_text(NATIVE_SCENARIO)
        env = {**os.environ, 'AWD_NATIVE_EVIDENCE_SOURCE': str(SOURCE),
               'AWD_NATIVE_EVIDENCE_TEST': str(Path(__file__).resolve()), 'AWD_NATIVE_EVIDENCE_RUN': str(run),
               'AWD_NATIVE_EVIDENCE_REPO': str(SOURCE.parents[2])}
        with (run / 'scenario.log').open('w') as log:
            child = subprocess.Popen(['node', str(run / 'scenario.cjs')], env=env, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            try:
                child.wait(timeout=120)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
                raise
        self.assertTrue((run / 'result.json').exists(), str(run / 'scenario.log'))
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(child.returncode, 0, result.get('error', str(run)))
        self.assertEqual(len(result['checks']), 16)
        self.assertEqual(result['exits'], [{'engine': 0, 'uno': 0}] * 2)
        print('Native evidence:', run, flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--port':
        bridge_driver(int(sys.argv[2]))
    else:
        unittest.main()
