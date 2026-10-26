# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Portable contract checks plus an opt-in, owned native Writer roundtrip."""
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
from xml.sax.saxutils import escape

SOURCE = Path(__file__).resolve().parents[1] / 'main' / 'native'
sys.path.insert(0, str(SOURCE))
import native_document_uno as document


class Enumeration:
    def __init__(self, values):
        self.values = iter(values)
        self.next = next(self.values, None)

    def hasMoreElements(self):
        return self.next is not None

    def nextElement(self):
        result, self.next = self.next, next(self.values, None)
        return result


class Paragraph:
    def __init__(self, text, **props):
        self.text = text
        self.props = dict(ListLabelString='', ListId='', NumberingLevel=0,
                          NumberingIsNumber=False, OutlineLevel=0, ParaStyleName='Standard', **props)

    def getString(self):
        return self.text

    def supportsService(self, service):
        return service == 'com.sun.star.text.Paragraph'

    def getPropertyValue(self, name):
        return self.props[name]


class Uno:
    @staticmethod
    def Any(kind, value):
        assert kind == 'short'
        return value

    @staticmethod
    def invoke(target, method, args):
        return getattr(target, method)(*args)


class CursorStory:
    def __init__(self, text, spans=()):
        self.text, self.spans = text, list(spans)

    def createTextCursorByRange(self, range):
        if range.story is not self:
            raise ValueError('wrong story')
        return CursorRange(self, range.start, range.end)

    def compareRegionStarts(self, left, right):
        return right.start - left.start

    def compareRegionEnds(self, left, right):
        return right.end - left.end


class CursorRange:
    def __init__(self, story, start, end=None):
        self.story, self.start, self.end = story, start, start if end is None else end

    def getText(self):
        return self.story

    def getStart(self):
        return CursorRange(self.story, self.start)

    def getEnd(self):
        return CursorRange(self.story, self.end)

    def getString(self):
        return self.story.text[self.start:self.end]

    def gotoRange(self, range, expand):
        if range.story is not self.story:
            raise ValueError('wrong story')
        self.end = range.end
        if not expand:
            self.start = range.start

    def goLeft(self, count, expand):
        target = max(0, self.start - count)
        complete = self.start - target == count
        self.start = target
        if not expand:
            self.end = target
        return complete

    def goRight(self, count, expand):
        target = min(len(self.story.text), self.end + count)
        complete = target - self.end == count
        self.end = target
        if not expand:
            self.start = target
        return complete

    def gotoStartOfParagraph(self, expand):
        self.start = self.story.text.rfind('\n', 0, self.start) + 1
        if not expand:
            self.end = self.start

    def gotoStart(self, expand):
        self.start = 0
        if not expand:
            self.end = 0

    def gotoEnd(self, expand):
        self.end = len(self.story.text)
        if not expand:
            self.start = self.end

    def gotoEndOfParagraph(self, expand):
        end = self.story.text.find('\n', self.end)
        self.end = len(self.story.text) if end < 0 else end
        if not expand:
            self.start = self.end

    def getPropertyValue(self, name):
        for start, end, props in self.story.spans:
            if (start < self.start < end if self.start == self.end
                    else start <= self.start and self.end <= end):
                return props.get(name)
        return None


class Model:
    def __init__(self, paragraphs=(), url='file:///owned/test.docx'):
        self.paragraphs, self.url = list(paragraphs), url
        self.enabled, self.modified, self.display, self.record = True, False, 2, True
        self.writes, self.selected = [], None
        self.ctrl = SimpleNamespace(getViewCursor=lambda: SimpleNamespace(gotoRange=self.select), select=self.select)

    def getURL(self):
        return self.url

    def getText(self):
        return SimpleNamespace(createEnumeration=lambda: Enumeration(self.paragraphs))

    def isReadonly(self):
        return False

    def supportsService(self, name):
        return name == 'com.sun.star.text.TextDocument'

    def isSetModifiedEnabled(self):
        return self.enabled

    def disableSetModified(self):
        self.enabled = False

    def enableSetModified(self):
        self.enabled = True

    def isModified(self):
        return self.modified

    def getPropertyValue(self, name):
        return {'ShowChanges': self.display != 0, 'RedlineDisplayType': self.display,
                'RecordChanges': self.record}[name]

    def setPropertyValue(self, name, value):
        self.writes.append((name, value))
        self.display = value
        if self.enabled:
            self.modified = True

    def getCurrentController(self):
        return self.ctrl

    def select(self, range, *unused):
        self.selected = range
        return True


class DocumentContractTests(unittest.TestCase):
    def setUp(self):
        self.commands = document.NativeDocumentCommands()

    def run_action(self, action, model, params=None, **kwargs):
        return self.commands.execute(action, params or {}, model, Uno, document_epoch=1,
                                     revision=9, read_only=True, **kwargs)

    def test_empty_find_reports_no_native_bookmark_mutation(self):
        model = Model()
        model.createSearchDescriptor = lambda: SimpleNamespace(setSearchString=lambda value: None,
                                                               setPropertyValue=lambda name, value: None)
        model.findFirst = lambda descriptor: None
        result = self.commands.find(model, {'keyword': 'absent'}, False)
        self.assertEqual(result['count'], 0)
        self.assertEqual(result['bookmarkMutations'], 0)

    def test_clear_counts_actual_removals_not_expired_handles(self):
        removed = []
        live = SimpleNamespace(getAnchor=lambda: SimpleNamespace(getText=lambda: SimpleNamespace(
            removeTextContent=lambda bookmark: removed.append(bookmark))))
        expired = object()
        model = Model()
        model.getBookmarks = lambda: SimpleNamespace(hasByName=lambda name: name == 'live',
                                                     getByName=lambda name: live)
        self.commands.anchors = {'live': {'bookmark': live}, 'expired': {'bookmark': expired},
                                'memory': {'bookmark': None}}
        result = self.commands.clear(model, False)
        self.assertEqual(result['cleared'], 3)
        self.assertEqual(result['bookmarkMutations'], 1)
        self.assertEqual(removed, [live])
        self.commands.anchors = {'expired': {'bookmark': expired}}
        self.assertEqual(self.commands.clear(model, False)['bookmarkMutations'], 0)

    def test_supported_read_actions_and_unknown_action_refuses(self):
        self.assertEqual(document.ACTIONS, {'get_document_text', 'get_paragraph', 'get_outline',
                                           'find_text_locations', 'set_selection', 'clear_anchors',
                                           'get_cursor_context', 'get_hyperlink_at_cursor',
                                           'get_review_context', 'goto_review_range'})
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED'):
            self.run_action('get_document_outline', Model())

    def test_body_only_native_numbering_and_heading_without_prefixing_text(self):
        paragraph = Paragraph('服务范围')
        paragraph.props.update(ListLabelString='第一条', ListId='list-a', NumberingLevel=2,
                               NumberingIsNumber=True, OutlineLevel=2, ParaStyleName='Heading 2')
        table = SimpleNamespace(supportsService=lambda name: False)
        result = self.run_action('get_document_text', Model([paragraph, table, Paragraph('末段')]))
        self.assertEqual(result['totalParagraphs'], 2)
        self.assertEqual(result['revision'], 9)
        self.assertEqual(result['scope'], 'body-paragraphs')
        self.assertEqual(result['paragraphs'][0], {'index': 0, 'text': '服务范围', 'headingLevel': 2,
                         'style': 'Heading 2', 'numbering': {'available': True, 'label': '第一条',
                         'listId': 'list-a', 'level': 2, 'hasLabel': True}})

    def test_numbering_unknown_is_not_confirmed_no_label(self):
        paragraph = Paragraph('甲')
        del paragraph.props['NumberingIsNumber']
        result = self.run_action('get_paragraph', Model([paragraph]))
        self.assertEqual(result['numbering'], dict(available=False, label=None, listId=None, level=None, hasLabel=None))

    def test_utf16_budget_keeps_complete_long_paragraph_and_next_page(self):
        text = '😀' * 7501
        model = Model([Paragraph(text), Paragraph('下一段')])
        result = self.run_action('get_document_text', model)
        self.assertEqual(result['paragraphs'][0]['text'], text)
        self.assertEqual(result['returned'], 1)
        self.assertEqual(result['nextStartParagraph'], 1)
        self.assertTrue(result['truncated'])
        next_page = self.run_action('get_document_text', model, {'startParagraph': 1})
        self.assertEqual(next_page['paragraphs'][0]['text'], '下一段')
        self.assertNotIn('truncated', next_page)
        self.assertEqual(document.utf16_length('中😀文'), 4)
        self.assertEqual(document.utf16_slice('a' * 159 + '😀尾', 160), 'a' * 159 + '\ud83d')

    def test_max_paragraph_window_and_out_of_range(self):
        model = Model([Paragraph(str(i)) for i in range(502)])
        self.assertEqual(self.run_action('get_document_text', model, {'maxParagraphs': 1000})['returned'], 500)
        self.assertFalse(self.run_action('get_paragraph', model, {'index': 502})['success'])
        self.assertFalse(self.run_action('get_paragraph', model, {'index': -1})['success'])
        self.assertEqual(self.run_action('get_document_text', model, {'startParagraph': 600})['returned'], 0)

    def test_outline_uses_body_index_level_or_heading_style(self):
        first, second = Paragraph('标题'), Paragraph('样式标题')
        first.props.update(OutlineLevel=3, ParaStyleName='Custom')
        second.props['ParaStyleName'] = '标题 2'
        result = self.run_action('get_outline', Model([Paragraph('普通'), first, second]))
        self.assertEqual(result, {'success': True, 'count': 2, 'outline': [
            {'paragraphIndex': 1, 'level': 3, 'style': 'Custom', 'text': '标题'},
            {'paragraphIndex': 2, 'level': 1, 'style': '标题 2', 'text': '样式标题'}]})

    def test_agent_final_view_restores_show_modified_enablement_and_recording(self):
        model = Model([Paragraph('正文')])
        self.run_action('get_document_text', model, {'__agent': True})
        self.assertEqual(model.writes, [('RedlineDisplayType', 0), ('RedlineDisplayType', 2)])
        self.assertTrue(model.enabled)
        self.assertFalse(model.modified)
        self.assertTrue(model.record)
        model.writes.clear()
        self.run_action('get_document_text', model)
        self.assertEqual(model.writes, [])

    def test_final_view_read_failure_still_restores_and_fails_closed(self):
        model = Model()
        model.getText = lambda: (_ for _ in ()).throw(RuntimeError('read failed'))
        with self.assertRaisesRegex(RuntimeError, 'read failed'):
            self.run_action('get_document_text', model, {'__agent': True})
        self.assertEqual(model.display, 2)
        self.assertTrue(model.enabled)
        refusing = Model()
        refusing.setPropertyValue = lambda name, value: None
        with self.assertRaisesRegex(RuntimeError, 'FINAL_TEXT_UNAVAILABLE'):
            self.run_action('get_document_text', refusing, {'__agent': True})
        self.assertTrue(refusing.enabled)

    def test_disabled_modified_setting_remains_disabled(self):
        model = Model()
        model.enabled, model.modified = False, True
        self.run_action('get_document_text', model, {'__agent': True})
        self.assertFalse(model.enabled)
        self.assertTrue(model.modified)

    def test_restore_invoke_failure_has_stable_fatal_code_and_still_enables_modified(self):
        model = Model()
        original = model.setPropertyValue
        def fail_restore(name, value):
            if value == 2:
                raise RuntimeError('controlled restore invoke failure')
            original(name, value)
        model.setPropertyValue = fail_restore
        with self.assertRaisesRegex(RuntimeError, 'FINAL_TEXT_RESTORE_FAILED.*controlled restore invoke failure') as error:
            self.run_action('get_document_text', model, {'__agent': True})
        self.assertTrue(model.enabled)
        self.assertIn('controlled restore invoke failure', str(error.exception.__cause__))

    def test_enable_modified_failure_has_stable_fatal_code_and_preserves_cause(self):
        model = Model()
        def fail_enable():
            raise RuntimeError('controlled enable failure')
        model.enableSetModified = fail_enable
        with self.assertRaisesRegex(RuntimeError, 'FINAL_TEXT_RESTORE_FAILED.*controlled enable failure') as error:
            self.run_action('get_document_text', model, {'__agent': True})
        self.assertEqual(model.display, 2)
        self.assertIn('controlled enable failure', str(error.exception.__cause__))

    def test_missing_identity_and_untrusted_readonly_type_fail(self):
        for kwargs in [{'document_epoch': None, 'revision': 1, 'read_only': True},
                       {'document_epoch': 1, 'revision': -1, 'read_only': True},
                       {'document_epoch': 1, 'revision': 1, 'read_only': 'false'}]:
            with self.assertRaises(ValueError):
                self.commands.execute('get_document_text', {}, Model(), Uno, **kwargs)

    def test_offsets_and_foreign_anchors_refuse_without_selection(self):
        model = Model()
        self.assertFalse(self.run_action('set_selection', model, {'start': 1, 'end': 2})['success'])
        self.assertFalse(self.run_action('set_selection', model, {'anchor': '__ai_anchor_foreign'})['success'])
        self.assertIsNone(model.selected)

    def test_clear_disposed_bookmark_and_same_name_replacement_is_not_deleted(self):
        model = Model()
        self.run_action('get_document_text', model)
        disposed = SimpleNamespace(getAnchor=lambda: (_ for _ in ()).throw(RuntimeError('disposed')))
        self.commands.anchors['__ai_anchor_old'] = dict(bookmark=disposed, range=None, text='旧字')
        model.getBookmarks = lambda: SimpleNamespace(hasByName=lambda name: False)
        result = self.commands.execute('clear_anchors', {}, model, Uno, document_epoch=1, revision=9, read_only=False)
        self.assertEqual(result, dict(success=True, cleared=1, bookmarkMutations=0))
        self.commands.anchors['__ai_anchor_old'] = dict(bookmark=disposed, range=None, text='旧字')
        model.getBookmarks = lambda: SimpleNamespace(hasByName=lambda name: True, getByName=lambda name: object())
        self.assertEqual(self.commands.execute('clear_anchors', {}, model, Uno, document_epoch=1,
                                              revision=9, read_only=False)['cleared'], 1)

    def test_same_url_new_model_or_new_epoch_invalidates_anchors(self):
        first = Model()
        self.run_action('get_document_text', first)
        self.commands.anchors['__ai_anchor_previous'] = dict(text='same', range=None, bookmark=None)
        self.run_action('get_document_text', Model())
        self.assertEqual(self.commands.anchors, {})
        self.commands.anchors['__ai_anchor_previous'] = dict(text='same', range=None, bookmark=None)
        self.commands.execute('get_document_text', {}, first, Uno, document_epoch=2, revision=9, read_only=True)
        self.assertEqual(self.commands.anchors, {})


class CursorContractTests(unittest.TestCase):
    setUp = DocumentContractTests.setUp
    run_action = DocumentContractTests.run_action

    def cursor_model(self, text, start, end=None, spans=()):
        model, story = Model(), CursorStory(text, spans)
        range = CursorRange(story, start, end)
        model.ctrl = SimpleNamespace(getViewCursor=lambda: range,
            getSelection=lambda: SimpleNamespace(getCount=lambda: 1, getByIndex=lambda i: range))
        model.getBookmarks = lambda: SimpleNamespace(hasByName=lambda name: False)
        model.getReferenceMarks = model.getBookmarks
        return model, range

    def test_cursor_context_uses_own_story_and_js_utf16_paragraph_prefix(self):
        text = 'a' * 299 + '😀中文光标' + 'b' * 230
        model, range = self.cursor_model(text, 302, 306)
        result = self.run_action('get_cursor_context', model, {'radius': 2})
        self.assertEqual(result, dict(success=True, selectedText=text[302:306], hasSelection=True,
                                     before=text[300:302], after=text[306:308], paragraph='a' * 299 + '\ud83d'))
        self.assertEqual(len(self.run_action('get_cursor_context', model)['before']), 80)
        self.assertEqual(len(self.run_action('get_cursor_context', model, {'radius': 999})['after']), 200)
        self.assertEqual(len(self.run_action('get_cursor_context', model, {'radius': -3})['after']), 1)
        self.assertEqual((range.start, range.end), (302, 306))
        self.assertEqual(model.writes, [])

    def test_layout_cursor_empty_string_does_not_hide_a_real_model_selection(self):
        model, range = self.cursor_model('表前😀表链接表后', 3, 6)
        model.ctrl.getViewCursor = lambda: CursorRange(range.story, 0)
        result = self.run_action('get_cursor_context', model)
        self.assertEqual(result['selectedText'], '表链接')
        self.assertTrue(result['hasSelection'])
        self.assertEqual((range.start, range.end), (3, 6))

    def test_cursor_agent_reads_final_view_and_restores_without_mutation(self):
        model, range = self.cursor_model('现稿', 1)
        seen = []
        original = model.ctrl.getSelection
        model.ctrl.getSelection = lambda: (seen.append(model.display), original())[1]
        self.run_action('get_cursor_context', model, {'__agent': True})
        self.assertEqual(seen, [0])
        self.assertEqual(model.display, 2)
        self.assertFalse(model.modified)
        self.assertTrue(model.record)
        self.assertTrue(model.enabled)

    def test_cursor_hyperlink_boundary_probe_and_ordinary_selection_refusal(self):
        model, range = self.cursor_model('前链接后', 1, spans=[(1, 3, {'HyperLinkURL': 'https://example.invalid/a'})])
        self.assertEqual(self.run_action('get_hyperlink_at_cursor', model),
                         dict(success=True, url='https://example.invalid/a', target=None))
        self.assertEqual((range.start, range.end), (1, 1))
        range.end = 3
        self.assertEqual(self.run_action('get_hyperlink_at_cursor', model), dict(success=True, url=''))
        range.start = range.end = 4
        self.assertEqual(self.run_action('get_hyperlink_at_cursor', model), dict(success=True, url='', target=None))

    def test_cursor_internal_target_point_utf16_and_missing_target(self):
        model, range = self.cursor_model('链接', 1, spans=[(0, 2, {'HyperLinkURL': '#%E4%B8%AD%E6%96%87'})])
        target = CursorRange(CursorStory('a' * 2999 + '😀尾'), 0)
        model.getBookmarks = lambda: SimpleNamespace(hasByName=lambda name: name == '中文',
                                                     getByName=lambda name: SimpleNamespace(getAnchor=lambda: target))
        result = self.run_action('get_hyperlink_at_cursor', model)
        self.assertEqual(result['target'], dict(name='中文', exists=True, text='a' * 2999 + '\ud83d', truncated=True))
        range.story.spans[0][2]['HyperLinkURL'] = '#%E0%A4%A'
        self.assertEqual(self.run_action('get_hyperlink_at_cursor', model)['target'],
                         dict(name='%E0%A4%A', exists=False, text='', truncated=False))
        self.assertEqual((range.start, range.end), (1, 1))

    def test_cursor_exact_reference_field_selection_and_reference_mark(self):
        model, range = self.cursor_model('前引用后', 1, 3)
        source = {'SourceName': "中文 !'()", 'ReferenceFieldSource': 0}
        field = SimpleNamespace(getAnchor=lambda: CursorRange(range.story, 1, 3),
                    supportsService=lambda name: name == 'com.sun.star.text.textfield.GetReference',
                    getPropertyValue=lambda name: source[name])
        range.story.spans = [(1, 3, {'TextField': field})]
        target = CursorRange(CursorStory('引用目标'), 0, 4)
        model.getReferenceMarks = lambda: SimpleNamespace(hasByName=lambda name: name == source['SourceName'],
                                               getByName=lambda name: SimpleNamespace(getAnchor=lambda: target))
        self.assertEqual(self.run_action('get_hyperlink_at_cursor', model), dict(success=True,
                         url="#%E4%B8%AD%E6%96%87%20!'()", target=dict(name=source['SourceName'], exists=True,
                                                                  text='引用目标', truncated=False)))
        range.end = 2
        self.assertEqual(self.run_action('get_hyperlink_at_cursor', model), dict(success=True, url=''))

    def test_cursor_nonwriter_has_no_link(self):
        model = Model()
        model.supportsService = lambda name: False
        self.assertEqual(self.run_action('get_hyperlink_at_cursor', model), dict(success=True, url=''))


def make_fixture(path):
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    run = lambda text: '<w:r><w:t xml:space="preserve">' + escape(text) + '</w:t></w:r>'
    para = lambda text: '<w:p>' + run(text) + '</w:p>'
    body = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' + run('验收标题') + '</w:p>'
    body += '<w:p>' + run('旧稿：') + '<w:del w:id="1" w:author="原作者" w:date="2026-10-01T00:00:00Z"><w:r><w:delText>30日</w:delText></w:r></w:del>' + run('；现稿甲30日；现稿乙30日。') + '</w:p>'
    body += para('a' * 159 + '😀中文定位目标与末尾')
    body += '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' + run('服务范围') + '</w:p>'
    body += '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>' + para('单元格定位目标') + '</w:tc></w:tr></w:tbl>'
    body += para('😀' * 7501) + para('长段之后')
    body += ''.join(para('容量目标' + str(i)) for i in range(52))
    types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    for name, content in [('document', 'document.main'), ('styles', 'styles'), ('numbering', 'numbering'), ('settings', 'settings')]:
        types += f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{content}+xml"/>'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as doc:
        doc.writestr('[Content_Types].xml', types + '</Types>')
        doc.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        relationships = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        for i, name in enumerate(['styles', 'numbering', 'settings']):
            relationships += f'<Relationship Id="r{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{name}" Target="{name}.xml"/>'
        doc.writestr('word/_rels/document.xml.rels', relationships + '</Relationships>')
        doc.writestr('word/document.xml', f'<w:document xmlns:w="{ns}"><w:body>{body}<w:sectPr/></w:body></w:document>')
        doc.writestr('word/styles.xml', f'<w:styles xmlns:w="{ns}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>')
        doc.writestr('word/numbering.xml', f'<w:numbering xmlns:w="{ns}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
        doc.writestr('word/settings.xml', f'<w:settings xmlns:w="{ns}"><w:trackRevisions/><w:revisionView w:del="1" w:ins="1"/></w:settings>')


def make_cursor_fixture(path):
    # A separate fixture preserves the six-action/edit/evidence regression input.
    make_fixture(path)
    with zipfile.ZipFile(path) as doc:
        parts = {name: doc.read(name) for name in doc.namelist()}
    run = lambda text: '<w:r><w:t xml:space="preserve">' + escape(text) + '</w:t></w:r>'
    para = lambda text: '<w:p>' + run(text) + '</w:p>'
    link = lambda label, anchor: '<w:hyperlink w:anchor="' + anchor + '">' + run(label) + '</w:hyperlink>'
    bookmark = lambda index, name, text: (f'<w:bookmarkStart w:id="{index}" w:name="{name}"/>'
                                        + run(text) + f'<w:bookmarkEnd w:id="{index}"/>')
    body = '<w:p>' + run('旧稿：') + '<w:del w:id="1" w:author="原作者" w:date="2026-10-01T00:00:00Z"><w:r><w:delText>删除词</w:delText></w:r></w:del>' + run('；当前光标。') + '</w:p>'
    body += para('a' * 299 + '😀中文光标' + '后' * 220)
    body += '<w:p>' + run('外前') + '<w:hyperlink r:id="external">' + run('外部链接') + '</w:hyperlink>' + run('外后') + '</w:p>'
    body += '<w:p>' + link('内部链接', '正文目标') + run(' / ') + link('点链接', '点目标') + run(' / ') + link('失效链接', '不存在') + '</w:p>'
    body += '<w:p>' + bookmark(1, '正文目标', 'a' * 2999 + '😀目标尾') + '</w:p>'
    body += '<w:p>' + bookmark(2, '点目标', '') + run('点目标所在段落') + '</w:p>'
    body += '<w:p>' + bookmark(3, '短目标', '交叉引用内容') + '</w:p>'
    body += '<w:p>' + run('引用前') + '<w:fldSimple w:instr=" REF 短目标 \\h ">' + run('交叉引用内容') + '</w:fldSimple>' + run('引用后') + '</w:p>'
    body += '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr><w:p>' + run('表前😀') + '<w:hyperlink r:id="external">' + run('表链接') + '</w:hyperlink>' + run('表后') + '</w:p></w:tc></w:tr></w:tbl>'
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    parts['word/document.xml'] = f'<w:document xmlns:w="{ns}" xmlns:r="{rel}"><w:body>{body}<w:sectPr/></w:body></w:document>'.encode()
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace(b'</Relationships>',
        f'<Relationship Id="external" Type="{rel}/hyperlink" Target="https://example.invalid/native-cursor" TargetMode="External"/></Relationships>'.encode())
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as doc:
        for name, value in parts.items():
            doc.writestr(name, value)


def bridge_driver(port):
    # Connected only to this test's worker; it never starts/attaches a user app.
    import native_review_uno as review
    import uno
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    context = resolver.resolve(f'uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext')
    desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
    commands = document.NativeDocumentCommands()
    for line in sys.stdin:
        request = json.loads(line)
        try:
            params, method = request['params'], request['method']
            model = review.model_for(desktop, params['documentUrl'])
            if method in document.ACTIONS:
                result = commands.execute(method, params, model, uno, document_epoch=params['testEpoch'],
                                          revision=params['testRevision'], read_only=params['nativeReadOnly'])
            elif method == 'test_state':
                result = {'modified': model.isModified(), 'recording': model.getPropertyValue('RecordChanges'),
                          'display': model.getPropertyValue('RedlineDisplayType'), 'show': model.getPropertyValue('ShowChanges'),
                          'modifiedEnabled': model.isSetModifiedEnabled(), 'bookmarks': list(model.getBookmarks().getElementNames()),
                          'undo': review.undo_state(model), 'body': model.getText().getString(),
                          'redlines': review.dispatch('snapshot', {}, model, uno, context)['entries']}
                if params.get('cursor'):
                    cursor = model.getCurrentController().getViewCursor()
                    before, after = document.context_around(cursor, 200)
                    result['cursor'] = dict(text=cursor.getString(), before=before, after=after,
                                            paragraph=document.paragraph_text(cursor))
            elif method == 'test_cursor_position':
                if 'field' in params:
                    fields, found = model.getTextFields().createEnumeration(), None
                    while fields.hasMoreElements():
                        field = fields.nextElement()
                        if (field.supportsService('com.sun.star.text.textfield.GetReference')
                                and field.getPropertyValue('SourceName') == params['field']):
                            found = field.getAnchor()
                            break
                else:
                    descriptor = model.createSearchDescriptor()
                    descriptor.setSearchString(params['keyword'])
                    descriptor.setPropertyValue('SearchCaseSensitive', True)
                    found = model.findFirst(descriptor)
                if found is None:
                    raise RuntimeError('Fixture cursor target missing')
                cursor = found.getText().createTextCursorByRange(found)
                if not params.get('select'):
                    cursor.collapseToStart()
                    if params.get('offset') and not cursor.goRight(params['offset'], False):
                        raise RuntimeError('Fixture cursor offset out of bounds')
                controller = model.getCurrentController()
                view_cursor = controller.getViewCursor()
                view_cursor.gotoRange(cursor.getStart(), False)
                if params.get('select'):
                    view_cursor.gotoRange(cursor.getEnd(), True)
                selections = controller.getSelection()
                if selections.getCount() != 1:
                    raise RuntimeError('Fixture positioning requires one real selection')
                selected = selections.getByIndex(0).getString()
                if selected != cursor.getString():
                    selections = controller.getSelection()
                    actual = [selections.getByIndex(i).getString() for i in range(selections.getCount())]
                    raise RuntimeError('Fixture positioning did not select the requested original text: '
                                       + repr((params.get('keyword'), found.getString(), cursor.getString(), selected,
                                               actual, view_cursor.isCollapsed(),
                                               view_cursor.getText().getString())))
                result = dict(success=True, text=selected)
            elif method == 'test_replace':
                if params['nativeReadOnly']:
                    raise RuntimeError('READ_ONLY')
                with document.final_text(model, uno, True):
                    descriptor = model.createSearchDescriptor()
                    descriptor.setSearchString(params['from'])
                    found = model.findFirst(descriptor)
                    if found is None:
                        raise RuntimeError('Fixture target missing')
                    recording = model.getPropertyValue('RecordChanges')
                    model.setPropertyValue('RecordChanges', False)
                    try:
                        found.setString(params['to'])
                    finally:
                        model.setPropertyValue('RecordChanges', recording)
                result = {'success': True}
            else:
                result = review.dispatch(method, params, model, uno, context)
            response = {'id': request['id'], 'result': result}
        except Exception as error:
            response = {'id': request['id'], 'error': str(error)}
        # ensure_ascii is required for a JS-compatible UTF16 prefix ending in a
        # lone surrogate; the transport must not crash trying to encode UTF-8.
        print(json.dumps(response, ensure_ascii=True), flush=True)


NATIVE_SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_DOCUMENT_SESSION_SOURCE||process.env.AWD_NATIVE_DOCUMENT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session');const {createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_DOCUMENT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_DOCUMENT_CONFIG));
const create=(name,readOnly)=>{const s=new NativeEditorSession({config,run:root+'/'+name,readOnly,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_DOCUMENT_TEST;return createProcessChannel(args)}});const call=s.unoCall.bind(s);s.unoCall=(action,p={})=>call(action,{...p,testEpoch:s.model.documentEpoch,testRevision:s.revision});return s};
const writable=create('writable',false),readonly=create('readonly',true);const result={checks:[],root};
const checked=name=>result.checks.push(name);const invoke=(s,a,p={})=>s.unoCall(a,{...p,__agent:true});
try{
 const bytes=new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_DOCUMENT_FIXTURE));
 await readonly.execute('load_document',{bytes,name:'readonly.docx',authorName:'只读验收'});
 const initial=await readonly.unoCall('test_state');assert.equal(initial.modified,false);assert.equal(initial.redlines.length,1);assert.equal(initial.show,true);assert.equal(initial.recording,true);
 const readRevision=readonly.revision;const first=await invoke(readonly,'get_document_text',{maxParagraphs:500});assert.equal(first.scope,'body-paragraphs');assert.equal(first.revision,readRevision);assert.ok(first.truncated);
 assert.equal(first.paragraphs[1].text,'旧稿：；现稿甲30日；现稿乙30日。');
 assert.ok(!(first.paragraphs.some(p=>p.text.includes('单元格定位目标'))));checked('final body excludes deleted text and table paragraphs');
 const spanning=await invoke(readonly,'find_text_locations',{keyword:'旧稿：；现稿甲30日；现稿乙30日。'});assert.equal(spanning.count,1);const spanningSelection=await invoke(readonly,'set_selection',{anchor:spanning.matches[0].anchorId});assert.equal(spanningSelection.success,true);assert.equal(spanningSelection.text,'旧稿：；现稿甲30日；现稿乙30日。');
 const outline=await invoke(readonly,'get_outline');assert.ok(outline.outline.some(x=>x.paragraphIndex===0&&x.level===1&&x.text==='验收标题'));checked('real native heading outline');
 const numbered=first.paragraphs.find(p=>p.text==='服务范围');assert.equal(numbered.numbering.available,true);assert.equal(numbered.numbering.label,'1.');assert.equal(numbered.numbering.hasLabel,true);assert.ok(numbered.numbering.listId);checked('native numbering remains separate');
 const long=first.paragraphs.find(p=>p.text.length===15002);assert.ok(long);assert.equal(long.text,'😀'.repeat(7501));
 assert.equal((await invoke(readonly,'get_paragraph',{index:long.index})).text,long.text);const next=await invoke(readonly,'get_document_text',{startParagraph:first.nextStartParagraph,maxParagraphs:500});assert.equal(next.paragraphs[0].text,'长段之后');checked('UTF16 page budget preserves complete long paragraph and next page');
 const found=await invoke(readonly,'find_text_locations',{keyword:'30日'});assert.equal(found.count,2);assert.deepEqual(found.matches.map(x=>x.matchIndex),[0,1]);assert.ok(found.matches[0].contextAfter.includes('现稿乙'));checked('deleted same word excluded with two final matches');
 const selected=await invoke(readonly,'set_selection',{anchor:found.matches[1].anchorId});assert.equal(selected.success,true);assert.equal(selected.text,'30日');checked('readonly native range selects exact second match');
 const emoji=await invoke(readonly,'find_text_locations',{keyword:'中文定位目标'});assert.equal(emoji.count,1);assert.equal(emoji.matches[0].paragraphLength,170);assert.equal(emoji.matches[0].paragraph.length,160);assert.equal(emoji.matches[0].paragraph.charCodeAt(159),0xD83D);assert.equal(emoji.matches[0].paragraphTruncated,true);checked('real emoji excerpt uses JS UTF16 including split surrogate');
 const table=await invoke(readonly,'find_text_locations',{keyword:'单元格定位目标'});assert.equal(table.count,1);assert.equal((await invoke(readonly,'set_selection',{anchor:table.matches[0].anchorId})).text,'单元格定位目标');assert.equal(table.matches[0].paragraph,'单元格定位目标');checked('table story search context and selection');
 const numberedFound=await invoke(readonly,'find_text_locations',{keyword:'1. 服务范围'});assert.equal(numberedFound.count,1);assert.equal(numberedFound.matches[0].matchedViaNumberingLabel,true);assert.equal(numberedFound.matches[0].paragraphIndex,numbered.index);assert.equal(numberedFound.matches[0].text,'服务范围');checked('numbering label fallback native subrange');
 const capped=await invoke(readonly,'find_text_locations',{keyword:'容量目标'});assert.equal(capped.count,50);assert.equal(capped.truncated,true);checked('search reports real truncation after 50 matches');
 const after=await readonly.unoCall('test_state');assert.deepEqual(after,initial);checked('readonly reads search selection leave text modified flag undo revisions display unchanged');
 const cleared=await invoke(readonly,'clear_anchors');assert.ok(cleared.cleared>=50);assert.equal((await invoke(readonly,'set_selection',{anchor:found.matches[0].anchorId})).success,false);
 const beforeReload=(await invoke(readonly,'find_text_locations',{keyword:'30日'})).matches[0].anchorId;
 await readonly.execute('load_document',{bytes,name:'readonly-reload.docx',authorName:'只读验收'});assert.equal((await invoke(readonly,'set_selection',{anchor:beforeReload})).success,false);checked('clear and model reload invalidate session-local handles');
 await writable.execute('load_document',{bytes,name:'writable.docx',authorName:'可写验收'});
 const writableFound=await invoke(writable,'find_text_locations',{keyword:'30日'});let state=await writable.unoCall('test_state');assert.ok(writableFound.matches.every(m=>state.bookmarks.includes(m.anchorId)));assert.equal(state.redlines.length,1);checked('writable anchors are actual native bookmarks without extra redlines');
 await writable.unoCall('test_replace',{from:'现稿甲30日',to:'现稿甲40日'});
 assert.equal((await invoke(writable,'set_selection',{anchor:writableFound.matches[0].anchorId})).success,false);
 assert.equal((await invoke(writable,'set_selection',{anchor:writableFound.matches[1].anchorId})).text,'30日');checked('changed target refuses while unrelated unchanged target survives');
 assert.equal((await invoke(writable,'set_selection',{anchor:'__ai_anchor_unknown'})).success,false);
 const cleaned=await invoke(writable,'clear_anchors');assert.equal(cleaned.cleared,2);assert.equal((await writable.unoCall('test_state')).bookmarks.length,0);checked('writable clear removes owned anchors');
 const exported=await writable.execute('export_document',{name:'native-document.docx'});await fs.writeFile(root+'/native-document.docx',exported.bytes);checked('export after read and location keeps working');
 result.readonly=after;result.bodyWindow=first;result.longParagraphIndex=long.index;
}catch(error){result.error=error.stack;process.exitCode=1}finally{await writable.close();await readonly.close();result.pids=[writable,readonly].map(s=>({engine:s.engine?.process.pid,uno:s.uno?.process.pid}));result.exits=[writable,readonly].map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,error:result.error,pids:result.pids,exits:result.exits,root},null,2))}
})();
'''


CURSOR_SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_DOCUMENT_SESSION_SOURCE||process.env.AWD_NATIVE_DOCUMENT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session');const {createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_DOCUMENT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_DOCUMENT_CONFIG));
const sessions=[],result={checks:[],reads:[],root};
try{
 const bytes=new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_DOCUMENT_FIXTURE));
 for(const readOnly of [true,false]){
  const name=readOnly?'readonly':'writable';
  const s=new NativeEditorSession({config,run:root+'/'+name,readOnly,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_DOCUMENT_TEST;return createProcessChannel(args)}});sessions.push(s);
  const call=s.unoCall.bind(s);s.unoCall=(a,p={})=>call(a,{...p,testEpoch:s.model.documentEpoch,testRevision:s.revision});
  await s.execute('load_document',{bytes,name:name+'.docx',authorName:'光标验收'});
  const initial=await s.unoCall('test_state');assert.equal(initial.modified,false);assert.equal(initial.redlines.length,1);assert.equal(initial.show,true);
  const position=p=>s.unoCall('test_cursor_position',p),checked=label=>result.checks.push(name+': '+label);
  const read=async(a,p={})=>{const before=await s.unoCall('test_state',{cursor:true});const value=await s.unoCall(a,p);assert.deepEqual(await s.unoCall('test_state',{cursor:true}),before,'read must not move cursor, change bytes, undo, tracking, review or dirty state');result.reads.push({name,action:a,params:p,value});return value};
  await position({keyword:'中文光标',select:true});
  let value=await read('get_cursor_context',{radius:2});assert.equal(value.selectedText,'中文光标');assert.equal(value.hasSelection,true);assert.equal(value.paragraph.length,300);assert.equal(value.paragraph.charCodeAt(299),0xD83D);assert.equal(value.after,'后后');checked('UTF16 300-prefix with selected original text');
  await position({keyword:'当前光标',offset:1});
  const ordinary=await read('get_cursor_context');assert.ok(ordinary.paragraph.includes('删除词'));
  const final=await read('get_cursor_context',{__agent:true});assert.equal(final.paragraph,'旧稿：；当前光标。');assert.ok(!final.before.includes('删除词'));checked('ordinary view preserves deletions; agent final excludes them and restores view');
  await position({keyword:'表链接',select:true});
  value=await read('get_cursor_context',{radius:20,__agent:true});assert.equal(value.selectedText,'表链接');assert.equal(value.before,'表前😀');assert.equal(value.after,'表后');assert.equal(value.paragraph,'表前😀表链接表后');checked('table story context does not escape into body');
  await position({keyword:'表链接'});value=await read('get_hyperlink_at_cursor');assert.equal(value.url,'https://example.invalid/native-cursor');assert.equal(value.target,null);checked('collapsed table link resolves actual cursor without navigation');
  await position({keyword:'外部链接',select:true});assert.deepEqual(await read('get_hyperlink_at_cursor'),{success:true,url:''});
  await position({keyword:'外部链接'});assert.equal((await read('get_hyperlink_at_cursor')).url,'https://example.invalid/native-cursor');checked('ordinary link selection refuses; run boundary cursor resolves');
  await position({field:'短目标',select:true});value=await read('get_hyperlink_at_cursor');assert.equal(value.target.name,'短目标');assert.equal(value.target.text,'交叉引用内容');assert.equal(value.target.exists,true);checked('exact whole REF field selection resolves target');
  await position({keyword:'内部链接',offset:1});value=await read('get_hyperlink_at_cursor',{__agent:true});assert.equal(value.target.name,'正文目标');assert.equal(value.target.exists,true);assert.equal(value.target.text.length,3000);assert.equal(value.target.text.charCodeAt(2999),0xD83D);assert.equal(value.target.truncated,true);checked('internal target UTF16 3000-prefix with JSON surrogate');
  await position({keyword:'点链接',offset:1});value=await read('get_hyperlink_at_cursor');assert.equal(value.target.name,'点目标');assert.equal(value.target.text,'点目标所在段落');assert.equal(value.target.exists,true);checked('point bookmark returns target paragraph');
  await position({keyword:'失效链接',offset:1});value=await read('get_hyperlink_at_cursor');assert.deepEqual(value.target,{name:'不存在',exists:false,text:'',truncated:false});checked('dangling target is explicitly absent');
  await position({keyword:'当前光标',offset:1});assert.deepEqual(await read('get_hyperlink_at_cursor'),{success:true,url:'',target:null});checked('ordinary collapsed text returns no hyperlink');
  assert.deepEqual(await s.unoCall('test_state'),initial);checked('all reads preserve model bytes modified undo tracking bookmarks and revisions');
 }
}catch(error){result.error=error.stack;process.exitCode=1}finally{for(const s of sessions)await s.close();result.pids=sessions.map(s=>({engine:s.engine?.process.pid,uno:s.uno?.process.pid}));result.exits=sessions.map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,error:result.error,pids:result.pids,exits:result.exits,root},null,2))}
})();
'''


@unittest.skipUnless(os.environ.get('AWD_NATIVE_DOCUMENT_CONFIG'), 'isolated native runtime explicitly required')
class NativeDocumentRoundtrip(unittest.TestCase):
    def test_real_final_read_numbering_search_anchors_and_readonly(self):
        self.run_native(make_fixture, NATIVE_SCENARIO, 'integration-', 16)

    def test_real_cursor_context_and_hyperlink_readonly_and_writable(self):
        self.run_native(make_cursor_fixture, CURSOR_SCENARIO, 'cursor-', 22)

    def run_native(self, fixture, scenario, prefix, checks):
        artifacts = Path(os.environ['AWD_NATIVE_DOCUMENT_ARTIFACTS'])
        artifacts.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix=prefix, dir=artifacts))
        fixture(run / 'synthetic.docx')
        script = run / 'scenario.cjs'
        script.write_text(scenario)
        env = {**os.environ, 'AWD_NATIVE_DOCUMENT_SOURCE': str(SOURCE),
               'AWD_NATIVE_DOCUMENT_TEST': str(Path(__file__).resolve()), 'AWD_NATIVE_DOCUMENT_RUN': str(run),
               'AWD_NATIVE_DOCUMENT_FIXTURE': str(run / 'synthetic.docx')}
        with (run / 'scenario.log').open('w') as log:
            child = subprocess.Popen(['node', str(script)], env=env, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            try:
                child.wait(timeout=180)
            except subprocess.TimeoutExpired:
                # Kill only the group this test created, including its workers.
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
                raise
        self.assertTrue((run / 'result.json').exists(), f'Runner failed before results; see {run / "scenario.log"}')
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(child.returncode, 0, result.get('error', str(run)))
        self.assertEqual(len(result['checks']), checks)
        self.assertEqual(result['exits'], [{'engine': 0, 'uno': 0}] * 2)
        print('Native document evidence:', run, flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--port':
        bridge_driver(int(sys.argv[2]))
    else:
        unittest.main()
