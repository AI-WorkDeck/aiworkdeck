# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Writer read/location actions on the existing URL-bound native model.

The host serializes these calls with edits and supplies its own epoch, revision
and read-only permission. No model or process is opened here. Body paragraph
indexes are zero based; table stories are searched but are not body paragraphs.
Readonly anchors are live, session-local XTextRanges, never persistent bookmarks.
Writable anchors use the same __ai_anchor_ bookmark contract as office_thread.js.
"""
from contextlib import contextmanager
import math
import re
import uuid
from urllib.parse import quote, unquote

ACTIONS = frozenset(('get_document_text', 'get_paragraph', 'get_outline',
                     'find_text_locations', 'set_selection', 'clear_anchors',
                     'get_cursor_context', 'get_hyperlink_at_cursor',
                     'get_review_context', 'goto_review_range'))
ANCHOR_PREFIX = '__ai_anchor_'
ANCHOR_CHANGED = '锚点原文已变化或失效，未执行编辑；请重新 doc_find_text 核对上下文后再试'


def utf16_length(text):
    return len(text.encode('utf-16-le', 'surrogatepass')) // 2


def utf16_slice(text, end):
    # JS String.slice counts code units, including a possible trailing surrogate.
    return text.encode('utf-16-le', 'surrogatepass')[:end * 2].decode('utf-16-le', 'surrogatepass')


def number_param(value, default):
    try:
        number = float(value) if value is not None else 0
        return number if number and math.isfinite(number) else default
    except (ValueError, TypeError):
        return default


def paragraphs(model):
    enumeration = model.getText().createEnumeration()
    result = []
    while enumeration.hasMoreElements():
        item = enumeration.nextElement()
        if item.supportsService('com.sun.star.text.Paragraph'):
            result.append(item)
    return result


def numbering(paragraph):
    try:
        label = paragraph.getPropertyValue('ListLabelString')
        list_id = paragraph.getPropertyValue('ListId')
        level = paragraph.getPropertyValue('NumberingLevel')
        has_label = paragraph.getPropertyValue('NumberingIsNumber')
        if (isinstance(label, str) and isinstance(list_id, str) and type(level) is int
                and (has_label is None or type(has_label) is bool)):
            return dict(available=True, label=label, listId=list_id, level=level, hasLabel=has_label)
    except Exception:
        pass
    return dict(available=False, label=None, listId=None, level=None, hasLabel=None)


def heading(paragraph):
    try:
        level = paragraph.getPropertyValue('OutlineLevel') or 0
    except Exception:
        level = 0
    try:
        style = paragraph.getPropertyValue('ParaStyleName') or ''
    except Exception:
        style = ''
    return level, style


def context_around(range, radius=40):
    # Always use the match's own XText, including table cells and footnotes.
    text = range.getText()
    before = text.createTextCursorByRange(range.getStart())
    if not before.goLeft(radius, True):
        before.gotoStart(True)
    after = text.createTextCursorByRange(range.getEnd())
    if not after.goRight(radius, True):
        after.gotoEnd(True)
    return before.getString(), after.getString()


def paragraph_text(range):
    cursor = range.getText().createTextCursorByRange(range.getStart())
    cursor.gotoStartOfParagraph(False)
    cursor.gotoEndOfParagraph(True)
    return cursor.getString()


def cursor_range(model):
    selections = model.getCurrentController().getSelection()
    if selections.getCount() != 1:
        raise RuntimeError('CURSOR_SELECTION_UNAVAILABLE')
    selected = selections.getByIndex(0)
    # Writer's layout cursor can report empty text/wrong endpoints in a table.
    # Use the controller's actual model selection without moving the viewport.
    cursor = selected.getText().createTextCursorByRange(selected.getStart())
    cursor.gotoRange(selected.getEnd(), True)
    return cursor


def cursor_context(model, params):
    cursor = cursor_range(model)
    # Match contextAround's bounded UNO cursor count, then JS String.slice.
    radius = int(max(1, min(number_param(params.get('radius'), 80), 200)))
    before, after = context_around(cursor, radius)
    selected = cursor.getString()
    return dict(success=True, selectedText=selected, hasSelection=bool(selected),
                before=before, after=after, paragraph=utf16_slice(paragraph_text(cursor), 300))


def review_unavailable(reason):
    return dict(success=False, available=False, reason=reason, error=reason, message=reason)


def check_review_range(model, params, revision):
    # Called in final-text view; offsets belong to one immutable body paragraph.
    if not model.supportsService('com.sun.star.text.TextDocument'):
        return review_unavailable('not-writer')
    if type(params.get('revision')) is not int or params['revision'] != revision:
        return review_unavailable('stale')
    index, start, end = (params.get(key) for key in ('paragraphIndex', 'start', 'end'))
    expected, quote = params.get('expectedParagraph'), params.get('quote')
    if (any(type(value) is not int for value in (index, start, end)) or index < 0 or start < 0
            or end <= start or not isinstance(expected, str) or utf16_length(expected) > 15000
            or not isinstance(quote, str) or not quote or end > utf16_length(expected)
            or expected.encode('utf-16-le', 'surrogatepass')[start * 2:end * 2].decode('utf-16-le', 'surrogatepass') != quote):
        return review_unavailable('invalid-range')
    if any(0xD800 <= ord(char) <= 0xDFFF or ord(char) > 0xFFFF for char in utf16_slice(expected, end)):
        return review_unavailable('unsupported-unicode-range')
    try:
        available = paragraphs(model)
        paragraph = available[index] if index < len(available) else None
        if paragraph is None or paragraph.getString() != expected:
            return review_unavailable('stale')
        cursor = paragraph.getText().createTextCursorByRange(paragraph.getStart())
        if start and not cursor.goRight(start, False):
            return review_unavailable('invalid-range')
        if not cursor.goRight(end - start, True) or cursor.getString() != quote:
            return review_unavailable('stale')
        return dict(success=True, range=cursor, paragraph=paragraph)
    except Exception:
        return review_unavailable('stale')


def review_context(model, revision):
    if not model.supportsService('com.sun.star.text.TextDocument'):
        return dict(review_unavailable('not-writer'), revision=revision)
    try:
        cursor = cursor_range(model)
        body, start = model.getText(), cursor.getStart()
        for index, paragraph in enumerate(paragraphs(model)):
            try:
                belongs = (body.compareRegionStarts(paragraph.getStart(), start) >= 0
                           and body.compareRegionEnds(paragraph.getEnd(), start) <= 0)
            except Exception:
                return dict(review_unavailable('body-only'), revision=revision)
            if not belongs:
                continue
            head = body.createTextCursorByRange(paragraph.getStart())
            head.gotoRange(start, True)
            text, selected = paragraph.getString(), cursor.getString()
            return dict(success=True, available=utf16_length(text) <= 15000, revision=revision,
                        paragraphIndex=index, text=utf16_slice(text, 15000), truncated=utf16_length(text) > 15000,
                        numbering=numbering(paragraph), offset=utf16_length(head.getString()),
                        selectedText=utf16_slice(selected, 15000), hasSelection=not cursor.isCollapsed(),
                        scope='body-paragraphs')
        return dict(review_unavailable('body-only'), revision=revision)
    except Exception:
        return dict(review_unavailable('unavailable-context'), revision=revision)


def review_cursor_rect(model):
    # Read after restoring the user's view, just like the WASM result wrapper.
    result = dict(success=True)
    ctrl = model.getCurrentController()
    cursor = ctrl.getViewCursor()
    try:
        point = cursor.getPosition()
        result['pos'] = dict(X=point.X, Y=point.Y)
        result['charHeightPt'] = cursor.getPropertyValue('CharHeight')
        result['collapsed'] = cursor.isCollapsed()
        result['zoom'] = ctrl.getViewSettings().getPropertyValue('ZoomValue')
    except Exception as error:
        result['posErr'] = str(error)
    return result


def hyperlink_at_cursor(model):
    if not model.supportsService('com.sun.star.text.TextDocument'):
        return dict(success=True, url='')
    cursor = cursor_range(model)
    selected = bool(cursor.getString())
    url, field = '', None

    def read_at(range):
        nonlocal url, field
        try:
            value = range.getPropertyValue('HyperLinkURL')
            if isinstance(value, str) and value:
                url = value
        except Exception:
            pass
        try:
            field = range.getPropertyValue('TextField') or field
        except Exception:
            pass

    read_at(cursor)
    if not url and field is None:
        # At a run boundary inspect one character without moving the view cursor.
        probe = cursor.getText().createTextCursorByRange(cursor.getStart())
        if probe.goRight(1, True):
            read_at(probe)
    if selected:
        # A positioning click can select an entire REF field. Ordinary or partial
        # selections must not become link activations, even if they contain a URL.
        if field is None:
            return dict(success=True, url='')
        anchor, text = field.getAnchor(), cursor.getText()
        if text.compareRegionStarts(cursor, anchor) != 0 or text.compareRegionEnds(cursor, anchor) != 0:
            return dict(success=True, url='')
    name, source = '', 2
    if url.startswith('#'):
        encoded = url[1:]
        try:
            # decodeURIComponent rejects malformed escapes as well as UTF-8.
            if re.search(r'%(?![0-9a-fA-F]{2})', encoded):
                raise ValueError('invalid percent escape')
            name = unquote(encoded, errors='strict')
        except (ValueError, UnicodeError):
            name = encoded
    elif not url and field is not None and field.supportsService('com.sun.star.text.textfield.GetReference'):
        name = str(field.getPropertyValue('SourceName') or '')
        source = field.getPropertyValue('ReferenceFieldSource')
        if name:
            url = '#' + quote(name, safe="~!*'()-._")
    target = None
    if name:
        range = None
        if source in (0, 2):
            collection = model.getBookmarks() if source == 2 else model.getReferenceMarks()
            if collection.hasByName(name):
                range = collection.getByName(name).getAnchor()
        text = (range.getString() or paragraph_text(range)) if range is not None else ''
        target = dict(name=name, exists=range is not None, text=utf16_slice(text, 3000),
                      truncated=utf16_length(text) > 3000)
    return dict(success=True, url=url, target=target)


@contextmanager
def final_text(model, uno_mod, enabled):
    """The WASM __agent contract: exclude deleted revisions, restore exact view.

    Display writes are typed shorts and guarded against dirty notifications.
    Never toggles RecordChanges, selection, undo or the document's contents.
    Unavailable/ineffective final view refuses the read instead of using old text.
    """
    if not enabled:
        yield
        return
    previous_show = model.getPropertyValue('ShowChanges')
    if type(previous_show) is not bool:
        raise RuntimeError('FINAL_TEXT_UNAVAILABLE: ShowChanges is unreadable')
    if not previous_show:
        yield
        return
    previous_display = model.getPropertyValue('RedlineDisplayType')
    modified_enabled = model.isSetModifiedEnabled()
    if modified_enabled:
        model.disableSetModified()
    try:
        try:
            uno_mod.invoke(model, 'setPropertyValue', ('RedlineDisplayType', uno_mod.Any('short', 0)))
            if model.getPropertyValue('ShowChanges') is not False:
                raise RuntimeError('FINAL_TEXT_UNAVAILABLE: final view was not applied')
            try:
                yield
            except Exception as error:
                # pyuno exception structs cannot accept the __traceback__ write
                # contextlib makes when rethrowing the identical exception.
                raise RuntimeError(str(error)) from error
        finally:
            try:
                uno_mod.invoke(model, 'setPropertyValue',
                               ('RedlineDisplayType', uno_mod.Any('short', previous_display)))
                if model.getPropertyValue('ShowChanges') != previous_show:
                    raise RuntimeError('ShowChanges restoration was not confirmed')
            except Exception as error:
                raise RuntimeError('FINAL_TEXT_RESTORE_FAILED: ' + str(error)) from error
    finally:
        if modified_enabled:
            try:
                model.enableSetModified()
            except Exception as error:
                raise RuntimeError('FINAL_TEXT_RESTORE_FAILED: ' + str(error)) from error


def numbered_ranges(model, keyword, match_case):
    keyword = keyword.strip()
    if not keyword:
        return [], False
    norm_case = (lambda value: value) if match_case else str.lower
    compact = lambda value: re.sub(r'\s+', '', norm_case(value))
    needle, needle_compact = norm_case(keyword), compact(keyword)
    hits = []
    for index, paragraph in enumerate(paragraphs(model)):
        native = numbering(paragraph)
        label = (native['label'] or '').strip() if native['available'] and native['hasLabel'] is not False else ''
        if not label:
            continue
        raw = paragraph.getString()
        punctuation = r'[、.．:：）)\s]'
        space = not re.search(punctuation + '$', label) and bool(raw.strip()) and not re.match(punctuation, raw.strip())
        combined = raw if raw.strip().startswith(label) else label + (' ' if space else '') + raw
        if not (needle in norm_case(combined) or needle == norm_case(label)
                or (needle_compact and needle_compact in compact(combined))):
            continue
        if len(hits) == 50:
            return hits, True
        range = paragraph
        if compact(combined).startswith(needle_compact) and len(needle_compact) > len(compact(label)):
            stripped = re.sub(r'^[\s、.．:：）)]+', '', keyword[len(label):])
            position = norm_case(raw).find(norm_case(stripped)) if stripped else -1
            # Match WASM's refusal to infer cursor offsets across surrogate pairs.
            if position >= 0 and all(ord(char) < 0xD800 or 0xDFFF < ord(char) <= 0xFFFF
                                     for char in raw[:position + len(stripped)]):
                cursor = paragraph.getText().createTextCursorByRange(paragraph.getStart())
                if (not position or cursor.goRight(position, False)) and cursor.goRight(len(stripped), True):
                    range = cursor
        hits.append((range, dict(paragraphIndex=index, numbering=native, matchedViaNumberingLabel=True)))
    return hits, False


class NativeDocumentCommands:
    def __init__(self):
        self.model, self.identity = None, None
        self.anchors = {}

    def execute(self, action, params, model, uno_mod, *, document_epoch, revision, read_only):
        if action not in ACTIONS:
            raise ValueError('UNSUPPORTED_NATIVE_DOCUMENT_ACTION')
        if (type(document_epoch) is not int or document_epoch < 1 or type(revision) is not int
                or revision < 0 or type(read_only) is not bool or not isinstance(params, dict)):
            raise ValueError('Native document identity, revision and permission are required')
        identity = (model.getURL(), document_epoch)
        if not identity[0]:
            raise ValueError('Native document URL is required')
        if self.model != model or self.identity != identity:
            self.model, self.identity = model, identity
            self.anchors.clear()
        read_only = read_only or model.isReadonly()
        # Selecting while deletions are hidden lets Writer expand the selection
        # when the original review view returns. Bookmarks already retain the
        # exact document range; position the visible cursor in the user's view.
        if action == 'set_selection':
            return self.select(model, params, uno_mod)
        if action in ('get_review_context', 'goto_review_range'):
            with final_text(model, uno_mod, True):
                if action == 'get_review_context':
                    result = review_context(model, revision)
                else:
                    checked = check_review_range(model, params, revision)
                    if not checked['success']:
                        return checked
                    ctrl, target = model.getCurrentController(), checked['range']
                    if ctrl.select(target) is False:
                        return review_unavailable('unavailable-context')
                    selected, story = cursor_range(model), target.getText()
                    if (story.compareRegionStarts(selected, target) != 0
                            or story.compareRegionEnds(selected, target) != 0):
                        return review_unavailable('unavailable-context')
                    result = dict(success=True, revision=revision)
            if action == 'get_review_context' and result['success']:
                result['cursorRectRaw'] = review_cursor_rect(model)
            return result
        with final_text(model, uno_mod, bool(params.get('__agent'))):
            if action == 'get_document_text':
                return self.document_text(model, params, revision)
            if action == 'get_paragraph':
                available = paragraphs(model)
                index = number_param(params.get('index'), 0)
                if index < 0 or index >= len(available) or int(index) != index:
                    return dict(success=False, message=f'paragraph index out of range: {index} (count {len(available)})')
                paragraph = available[int(index)]
                return dict(success=True, index=int(index), text=paragraph.getString(), numbering=numbering(paragraph))
            if action == 'get_outline':
                outline = []
                for index, paragraph in enumerate(paragraphs(model)):
                    level, style = heading(paragraph)
                    if level > 0 or re.match(r'^(Heading|标题)', style):
                        outline.append(dict(paragraphIndex=index, level=level or 1, style=style, text=paragraph.getString()))
                return dict(success=True, count=len(outline), outline=outline)
            if action == 'find_text_locations':
                return self.find(model, params, read_only)
            if action == 'get_cursor_context':
                return cursor_context(model, params)
            if action == 'get_hyperlink_at_cursor':
                return hyperlink_at_cursor(model)
            return self.clear(model, read_only)

    @staticmethod
    def document_text(model, params, revision):
        available = paragraphs(model)
        start = max(0, number_param(params.get('startParagraph'), 0))
        if int(start) != start:
            raise ValueError('startParagraph must be a zero-based integer')
        start = int(start)
        maximum = max(1, min(number_param(params.get('maxParagraphs'), 200), 500))
        rows, chars = [], 0
        for index in range(start, len(available)):
            if len(rows) >= maximum or chars >= 15000:
                break
            paragraph = available[index]
            item = dict(index=index, text=paragraph.getString(), numbering=numbering(paragraph))
            level, style = heading(paragraph)
            if level > 0:
                item.update(headingLevel=level, style=style)
            chars += utf16_length(item['text'])
            rows.append(item)
        result = dict(success=True, revision=revision, scope='body-paragraphs', totalParagraphs=len(available),
                      startParagraph=start, returned=len(rows), paragraphs=rows)
        if start + len(rows) < len(available):
            result.update(truncated=True, nextStartParagraph=start + len(rows))
        return result

    def anchor(self, model, range, read_only):
        name = ANCHOR_PREFIX + uuid.uuid4().hex
        snapshot = range.getString()
        bookmark = None
        if read_only:
            # A native range is independent of the moving user selection.
            live = range.getText().createTextCursorByRange(range.getStart())
            live.gotoRange(range.getEnd(), True)
        else:
            bookmark = model.createInstance('com.sun.star.text.Bookmark')
            bookmark.setName(name)
            range.getText().insertTextContent(range, bookmark, True)
            name = bookmark.getName()
            live = bookmark.getAnchor()
        if not isinstance(name, str) or not name.startswith(ANCHOR_PREFIX) or name in self.anchors:
            raise RuntimeError('ANCHOR_ID_UNAVAILABLE')
        if live.getString() != snapshot:
            raise RuntimeError('ANCHOR_CHANGED_DURING_SEARCH')
        self.anchors[name] = dict(range=live, bookmark=bookmark, text=snapshot)
        return name

    def find(self, model, params, read_only):
        keyword = str(params.get('keyword') or '')
        descriptor = model.createSearchDescriptor()
        descriptor.setSearchString(keyword)
        descriptor.setPropertyValue('SearchCaseSensitive', bool(params.get('matchCase')))
        hits = []
        hit = model.findFirst(descriptor)
        while hit is not None and len(hits) < 50:
            hits.append((hit, {}))
            hit = model.findNext(hit, descriptor)
        truncated = hit is not None
        if not hits:
            hits, truncated = numbered_ranges(model, keyword, bool(params.get('matchCase')))
        matches = []
        for index, (range, meta) in enumerate(hits):
            before, after = context_around(range)
            paragraph = paragraph_text(range)
            matches.append(dict(matchIndex=index, anchorId=self.anchor(model, range, read_only),
                                text=range.getString(), contextBefore=before, contextAfter=after,
                                paragraph=utf16_slice(paragraph, 160), paragraphLength=utf16_length(paragraph),
                                paragraphTruncated=utf16_length(paragraph) > 160, **meta))
        result = dict(success=True, count=len(matches), matches=matches,
                      bookmarkMutations=0 if read_only else len(matches))
        if truncated:
            result.update(truncated=True, note='匹配超过 50 个，仅返回前 50——请用更长的关键词缩小范围，或用 find_replace 批量处理')
        return result

    def select(self, model, params, uno_mod):
        name = params.get('anchor')
        if not isinstance(name, str) or not name:
            return dict(success=False, message='set_selection requires {anchor}; integer offsets unsupported (§0.2)')
        anchor = self.anchors.get(name)
        if anchor is None:
            return dict(success=False, message='anchor not found: ' + name)
        try:
            range = anchor['bookmark'].getAnchor() if anchor['bookmark'] else anchor['range']
        except Exception:
            return dict(success=False, error=ANCHOR_CHANGED, message=ANCHOR_CHANGED)
        # Validate in the same text view as the search, including matches that
        # span an internal deletion. Restore that view BEFORE moving the cursor.
        with final_text(model, uno_mod, bool(params.get('__agent'))):
            if range.getString() != anchor['text']:
                return dict(success=False, error=ANCHOR_CHANGED, message=ANCHOR_CHANGED)
            before, after = context_around(range)
        ctrl = model.getCurrentController()
        try:
            ctrl.getViewCursor().gotoRange(range, False)
        except Exception:
            try:
                if ctrl.select(range) is False:
                    raise RuntimeError('selection rejected')
            except Exception:
                return dict(success=False, message='could not select anchor: ' + name)
        return dict(success=True, anchor=name, text=anchor['text'], contextBefore=before, contextAfter=after)

    def clear(self, model, read_only):
        # Clear only handles this instance issued; foreign/persisted bookmarks
        # have no trusted snapshot and are never accepted for selection here.
        cleared, mutations = 0, 0
        for name, anchor in list(self.anchors.items()):
            if anchor['bookmark'] is not None:
                if read_only:
                    raise RuntimeError('READ_ONLY: cannot remove an existing writable anchor')
                bookmarks = model.getBookmarks()
                # Replacing the target can legitimately delete its bookmark.
                # Never dereference that disposed UNO object or delete another
                # bookmark subsequently created with the same name.
                if bookmarks.hasByName(name) and bookmarks.getByName(name) == anchor['bookmark']:
                    anchor['bookmark'].getAnchor().getText().removeTextContent(anchor['bookmark'])
                    mutations += 1
            del self.anchors[name]
            cleared += 1
        return dict(success=True, cleared=cleared, bookmarkMutations=mutations)
