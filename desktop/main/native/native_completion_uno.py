# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Token-bound completion and writing suggestions on the current native model."""
import re
import uuid
import json
import math
from functools import lru_cache
from pathlib import Path
import native_document_uno as document
import native_document_edit_uno as edit

READ_ACTIONS = frozenset(('get_completion_context', 'capture_writing_context', 'get_context_menu_context', 'set_host_context_menu'))
WRITE_ACTIONS = frozenset(('accept_completion', 'insert_completion_content', 'accept_writing_suggestion'))
ACTIONS = READ_ACTIONS | WRITE_ACTIONS


def unavailable(reason):
    return dict(document.review_unavailable(reason), changed=False, textChanged=False, trackingChanged=False)


def body_index(model, point):
    body = model.getText()
    try:
        for index, paragraph in enumerate(document.paragraphs(model)):
            if (body.compareRegionStarts(paragraph.getStart(), point) >= 0
                    and body.compareRegionEnds(paragraph.getEnd(), point) <= 0):
                return index
    except Exception:
        pass
    return -1


def writing_section(model, point):
    index = body_index(model, point)
    if index < 0:
        return None
    appendix, heading = '', ''
    appendix_source, heading_source = None, None
    for position, paragraph in enumerate(document.paragraphs(model)[:index + 1]):
        raw = paragraph.getString()
        native = document.numbering(paragraph)
        label = (native['label'] or '').strip() if native['available'] and native['hasLabel'] is not False else ''
        combined = raw
        if label and not raw.strip().startswith(label):
            space = (not re.search(r'[、.．:：）)\s]$', label) and bool(raw.strip())
                     and not re.match(r'[、.．:：）)\s]', raw.strip()))
            combined = label + (' ' if space else '') + raw
        text = combined.strip()
        marker = re.fullmatch(r'(第[一二三四五六七八九十百零〇0-9]+[条节章]|附件[一二三四五六七八九十零〇0-9]+).{0,100}', text)
        if marker:
            if marker[1].startswith('附件'):
                appendix, heading = marker[1], ''
                appendix_source, heading_source = dict(index=position, text=combined), None
            else:
                heading, heading_source = marker[1], dict(index=position, text=combined)
        else:
            level, _ = document.heading(paragraph)
            if 0 < level <= 6 and document.utf16_length(text) <= 100:
                heading = text
                heading_source = dict(index=position, text=raw or combined) if text else None
    path = [part for part in (appendix, heading) if part]
    return dict(paragraphIndex=index, sectionPath=path, sectionTitle=' / '.join(path) if path else '正文',
                scopeHeadings=[value for value in (appendix_source, heading_source) if value], scopeKnown=True)



@lru_cache(maxsize=1)
def house_table_profile():
    # The same single-source profile used by office_thread.js; the second path
    # is its existing packaged frontend copy, also used by frozen QA runtimes.
    root = Path(__file__).resolve().parents[3]
    for relative in ('backend/src/main/resources/style-profiles/house-default.json',
                     'frontend/dist/zetaoffice/house-default.json'):
        source = root / relative
        if source.is_file():
            return json.loads(source.read_text(encoding='utf-8'))
    raise RuntimeError('HOUSE table profile is unavailable')


def style_table(table, uno_mod):
    # Match buildHouse/styleTableStandard, including its fixed one-row header
    # for completion tables. Project-profile dispatch is not implemented here.
    profile = house_table_profile()
    defaults, body, spec = profile['defaults'], profile['body'], profile['table']
    cell_spec, header = spec['cell'], spec['header']
    def points(length, size):
        value = length['value']
        return value * {'pt': 1, 'chars': size, 'lines': size * 1.2,
                        'mm': 72 / 25.4, 'cm': 720 / 25.4, 'twips': .05}[length.get('unit', 'pt')]
    def mm100(length, size):
        return math.floor(points(length, size) * 2540 / 72 + .5)
    def color(value):
        return int(value.lstrip('#'), 16)
    def typed(target, name, kind, value):
        uno_mod.invoke(target, 'setPropertyValue', (name, uno_mod.Any(kind, value)))
    align = {'left': 0, 'start': 0, 'right': 1, 'end': 1, 'justify': 2, 'both': 2,
             'distribute': 2, 'center': 3}
    vertical = {'top': 1, 'center': 2, 'bottom': 3}
    size = points(cell_spec['size'], 10)
    western = body.get('font', {}).get('western') or defaults['font']['western']
    asian = body.get('font', {}).get('eastAsia') or defaults['font']['eastAsia']
    text_color = color(body.get('color', defaults['color']))
    outside = spec['borders']['outside']
    inside = spec['borders'].get('insideH', spec['borders'].get('insideV', outside))
    def border_line(width):
        line = uno_mod.createUnoStruct('com.sun.star.table.BorderLine2')
        line.Color = color(outside['color'])
        line.LineWidth = width
        line.LineStyle = {'single': 0, 'double': 3, 'dashed': 2}.get(outside['style'], 0)
        return line
    border = uno_mod.createUnoStruct('com.sun.star.table.TableBorder2')
    for edge in ('Top', 'Bottom', 'Left', 'Right', 'Horizontal', 'Vertical'):
        setattr(border, edge + 'Line', border_line(mm100((inside if edge in ('Horizontal', 'Vertical') else outside)['width'], 12)))
        setattr(border, 'Is' + edge + 'LineValid', True)
    border.IsDistanceValid = False
    table.setPropertyValue('TableBorder2', border)
    if header.get('repeatOnEachPage', True):
        table.setPropertyValue('RepeatHeadline', True)
        typed(table, 'HeaderRowCount', 'long', 1)
    spacing = uno_mod.createUnoStruct('com.sun.star.style.LineSpacing')
    line = cell_spec['lineSpacing']
    spacing.Mode = {'atLeast': 1, 'exactly': 3}.get(line.get('rule'), 0)
    spacing.Height = (mm100(line, size) if spacing.Mode in (1, 3)
                      else math.floor(line['value'] * (1 if line.get('unit') == 'percent' else 100) + .5))
    for name in table.getCellNames():
        cell = table.getCellByName(name)
        is_header = int(re.sub(r'^[A-Z]+', '', name)) == 1
        typed(cell, 'VertOrient', 'short', vertical[(header if is_header else cell_spec).get('verticalAlign', 'center')])
        if is_header and header.get('fill') is not None:
            cell.setPropertyValue('BackColor', color(header['fill']))
        cursor = cell.createTextCursor(); cursor.gotoStart(False); cursor.gotoEnd(True)
        for suffix, font in (('', western), ('Asian', asian), ('Complex', western)):
            cursor.setPropertyValue('CharFontName' + suffix, font)
            typed(cursor, 'CharHeight' + suffix, 'float', float(size))
            typed(cursor, 'CharWeight' + suffix, 'float', 150.0 if is_header and header.get('bold', True) else 100.0)
        cursor.setPropertyValue('CharColor', text_color)
        for prop, key in (('ParaTopMargin', 'spaceBefore'), ('ParaBottomMargin', 'spaceAfter'), ('ParaFirstLineIndent', 'firstLineIndent')):
            cursor.setPropertyValue(prop, mm100(cell_spec[key], size))
        cursor.setPropertyValue('ParaLineSpacing', spacing)
        numeric = re.fullmatch(r'[-+（(]?[0-9][0-9,.，%．]*[%）)]?', cell.getString().strip()) is not None
        alignment = (header.get('alignment', 'center') if is_header else
                     cell_spec.get('byContentType', {}).get('number' if numeric else 'text', {}).get('alignment', 'right' if numeric else cell_spec.get('alignment', 'left')))
        typed(cursor, 'ParaAdjust', 'short', align[alignment])


def insert_table(model, cursor, rows, uno_mod):
    count, columns = len(rows), max(map(len, rows))
    table = model.createInstance('com.sun.star.text.TextTable')
    table.initialize(count, columns)
    cursor.getText().insertTextContent(cursor, table, False)
    for row in range(count):
        for column in range(columns):
            cell = table.getCellByName(chr(65 + column) + str(row + 1))
            text = rows[row][column] if column < len(rows[row]) else ''
            cell.setString(text)
            if cell.getString() != text:
                raise RuntimeError('Completion table cell was not verified')
    style_table(table, uno_mod)
    if table.getRows().getCount() != count or table.getColumns().getCount() != columns:
        raise RuntimeError('Completion table dimensions were not verified')
    name, found = table.getName(), False
    enumeration = model.getText().createEnumeration()
    while enumeration.hasMoreElements():
        item = enumeration.nextElement()
        if found and item.supportsService('com.sun.star.text.Paragraph'):
            cursor.gotoRange(item.getStart(), False)
            return name
        if item.supportsService('com.sun.star.text.TextTable') and item.getName() == name:
            found = True
    raise RuntimeError('Completion table following paragraph is unavailable')


class NativeCompletionCommands:
    def __init__(self):
        self.identity = None
        self.completion, self.writing = None, None
        self.host_menu = dict(enabled=False, maxLength=0)

    def capture(self, model, radius, revision, permission_seq, pending=False):
        self.completion = None
        cursor = document.cursor_range(model)
        radius = int(max(1, min(document.number_param(radius, 120), 200)))
        before, after = document.context_around(cursor, radius)
        paragraph, selected = document.paragraph_text(cursor), cursor.getString()
        snapshot = dict(token='completion_' + uuid.uuid4().hex, range=edit.live_range(cursor), radius=radius,
                        before=before, after=after, paragraph=paragraph, selectedText=selected,
                        revision=revision, permissionSeq=permission_seq, pending=pending)
        self.completion = snapshot
        return dict(success=True, available=not bool(selected), before=before, after=after,
                    paragraph=document.utf16_slice(paragraph, 300), selectedText=selected,
                    hasSelection=bool(selected), token=snapshot['token'], revision=revision,
                    **({'reason': 'selection'} if selected else {}))

    def check(self, model, params, snapshot, revision, permission_seq, pending=False):
        if (not snapshot or params.get('token') != snapshot['token'] or snapshot['permissionSeq'] != permission_seq
                or snapshot['pending'] != pending or (not pending and snapshot['revision'] != revision)):
            return unavailable('stale')
        try:
            cursor, expected = document.cursor_range(model), snapshot['range']
            story = cursor.getText()
            before, after = document.context_around(cursor, snapshot['radius'])
            if (cursor.getString() != snapshot['selectedText'] or story.compareRegionStarts(cursor, expected) != 0
                    or story.compareRegionEnds(cursor, expected) != 0 or before != snapshot['before']
                    or after != snapshot['after'] or document.paragraph_text(cursor) != snapshot['paragraph']):
                return unavailable('stale')
            return dict(success=True, cursor=cursor, snapshot=snapshot)
        except Exception:
            return unavailable('stale')

    def execute(self, action, params, model, uno_mod, context, *, document_epoch, revision, read_only, permission_seq):
        if action not in ACTIONS:
            raise ValueError('UNSUPPORTED_NATIVE_COMPLETION_ACTION')
        if (type(document_epoch) is not int or document_epoch < 1 or type(revision) is not int or revision < 0
                or type(permission_seq) is not int or permission_seq < 0 or type(read_only) is not bool
                or not isinstance(params, dict) or not model.getURL()):
            raise ValueError('Native completion requires current identity, revision and permission')
        identity = (model, model.getURL(), document_epoch)
        if identity != self.identity:
            self.identity = identity
            self.completion, self.writing = None, None
            self.host_menu = dict(enabled=False, maxLength=0)
        if not model.supportsService('com.sun.star.text.TextDocument'):
            return unavailable('not-writer')
        if params.get('composing'):
            return unavailable('composing')
        if action == 'set_host_context_menu':
            self.host_menu = dict(enabled=bool(params.get('enabled')),
                maxLength=max(0, document.number_param(params.get('maxLength'), 0)))
            return dict(success=True)
        menu_selection = None
        if action == 'get_context_menu_context':
            menu_selection = document.cursor_range(model).getString()
            if not self.host_menu['enabled'] or not 0 < document.utf16_length(menu_selection) <= self.host_menu['maxLength']:
                return unavailable('native-menu')
        if action not in ('get_completion_context', 'get_context_menu_context') and (read_only or model.isReadonly()):
            return unavailable('readonly')
        with edit.final_view(model, uno_mod, True):
            if action in ('get_completion_context', 'get_context_menu_context'):
                if menu_selection is not None and document.cursor_range(model).getString() != menu_selection:
                    return unavailable('native-menu')
                if 'nativeAfterToken' in params:
                    checked = self.check(model, {'token': params['nativeAfterToken']}, self.completion,
                                         revision, permission_seq, pending=True)
                    if not checked['success']:
                        return checked
                return self.capture(model, params.get('radius'), revision, permission_seq)
            if action == 'capture_writing_context':
                self.writing = None
                result = self.capture(model, params.get('radius'), revision, permission_seq)
                if document.utf16_length(result['selectedText']) > 2000:
                    return unavailable('selection-too-long')
                cursor = self.completion['range']
                section = writing_section(model, cursor.getStart())
                if section is None:
                    return unavailable('unknown-writing-scope')
                if result['selectedText']:
                    end_section = writing_section(model, cursor.getEnd())
                    if end_section is None or end_section['sectionTitle'] != section['sectionTitle']:
                        return unavailable('selection-crosses-writing-scope')
                self.writing = dict(self.completion)
                result.pop('reason', None)
                return dict(result, **section, available=True, writable=True)
            snapshot = self.writing if action == 'accept_writing_suggestion' else self.completion
            if action == 'accept_writing_suggestion' and params.get('revision', revision) != revision:
                return unavailable('stale')
            checked = self.check(model, params, snapshot, revision, permission_seq)
            if not checked['success']:
                return checked
            text, rows = params.get('text'), params.get('rows') if action == 'insert_completion_content' else None
            if action == 'accept_completion':
                if snapshot['selectedText']:
                    return unavailable('selection')
                prefix = params.get('prefix')
                if (not isinstance(prefix, str) or not prefix or not isinstance(text, str) or len(text) <= len(prefix)
                        or not text.startswith(prefix) or '\r' in text or '\n' in text or not snapshot['before'].endswith(prefix)):
                    return unavailable('invalid-completion')
                inserted, title = text[len(prefix):], '补全文字'
            elif action == 'accept_writing_suggestion':
                if ((snapshot['selectedText'] and params.get('expectedSelection') != snapshot['selectedText'])
                        or ('expectedSelection' in params and params['expectedSelection'] != snapshot['selectedText'])):
                    return unavailable('selection-mismatch')
                if (not isinstance(text, str) or not text or document.utf16_length(text) > 2000
                        or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text)):
                    return unavailable('invalid-suggestion')
                inserted, title = re.sub(r'\r\n?', '\n', text), '采用写作建议'
            else:
                text = '' if text is None else text
                if not isinstance(text, str) or (not text and not rows):
                    return unavailable('invalid-content')
                if rows is not None and (not isinstance(rows, list) or not 1 <= len(rows) <= 200
                        or any(not isinstance(row, list) or not 1 <= len(row) <= 20
                               or any(not isinstance(cell, str) for cell in row) for row in rows)):
                    return unavailable('invalid-table')
                if rows is not None and body_index(model, checked['cursor'].getStart()) < 0:
                    return unavailable('table-requires-body')
                inserted, title = re.sub(r'\r\n?', '\n', text), '插入补全资料'
            if any(0xD800 <= ord(char) <= 0xDFFF for char in inserted):
                return unavailable('invalid-suggestion' if action == 'accept_writing_suggestion' else 'invalid-content')
            return self.apply(action, params, model, uno_mod, context, checked['cursor'], snapshot,
                              inserted, rows, title, revision, permission_seq)

    def apply(self, action, params, model, uno_mod, context, target, snapshot, inserted, rows, title, revision, permission_seq):
        manager = model.getUndoManager()
        before_undo = list(manager.getAllUndoActionTitles())
        before_tables = tuple(model.getTextTables().getElementNames())
        recording = model.getPropertyValue('RecordChanges')
        if type(recording) is not bool:
            raise RuntimeError('TRACKING_STATE_UNAVAILABLE')
        original_story = target.getText().getString()
        self.completion = None
        if action == 'accept_writing_suggestion':
            self.writing = None
        replacing = action == 'accept_writing_suggestion' and bool(snapshot['selectedText'])
        if not replacing:
            target.collapseToEnd()
        story, prefix, old, suffix = edit.story_snapshot(target)
        table_name = None
        try:
            with edit.mutation(model, uno_mod, context, bool(params.get('__agent')), title):
                edit.apply_replacement(target, inserted, recording)
                if story.getString() != prefix + inserted + suffix:
                    raise RuntimeError('Completion text was not verified')
                target.collapseToEnd()
                if rows is not None:
                    table_name = insert_table(model, target, rows, uno_mod)
                    names = tuple(model.getTextTables().getElementNames())
                    if table_name in before_tables or set(names) != set(before_tables) | {table_name}:
                        raise RuntimeError('Completion table identity was not verified')
                edit.NativeDocumentEdits.finish_selection(model, 'insert_at_cursor', target)
                if model.getPropertyValue('RecordChanges') is not recording:
                    raise RuntimeError('Completion changed tracking mode')
        except Exception as error:
            try:
                after = list(manager.getAllUndoActionTitles())
                if len(after) == len(before_undo) + 1 and after[1:] == before_undo and after[0] == title:
                    manager.undo()
                if (story.getString() != original_story or tuple(model.getTextTables().getElementNames()) != before_tables
                        or list(manager.getAllUndoActionTitles()) != before_undo):
                    raise RuntimeError('Completion rollback was not verified')
            except Exception as rollback_error:
                raise RuntimeError('EDIT_OUTCOME_UNKNOWN: ' + str(rollback_error)) from error
            raise RuntimeError('EDIT_OUTCOME_UNKNOWN: completion rolled back; ' + str(error)) from error
        try:
            result = self.capture(model, 120, revision, permission_seq, pending=True)
        except Exception as error:
            raise RuntimeError('EDIT_OUTCOME_UNKNOWN: post-edit completion context failed: ' + str(error)) from error
        result.update(changed=old != inserted or rows is not None, textChanged=old != inserted or rows is not None,
                      trackingChanged=False, inserted=inserted)
        if action == 'accept_completion':
            result['text'] = params['text']
        elif action == 'accept_writing_suggestion':
            result.update(replaced=snapshot['selectedText'], operation='replace-selection' if replacing else 'insert-suffix')
        else:
            result.update(inserted=params.get('text') or '', table=table_name)
        return result
