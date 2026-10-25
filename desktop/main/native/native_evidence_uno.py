# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Existing evidence bookmark reads and navigation on one URL-bound Writer model.

The host serializes calls with edits and injects its current document epoch and
permission. This module holds no ranges across calls or models. EVID_ names and
filelink URLs remain document data; anchorHash/stale/orphan classification stays
in the existing frontend/backend implementation. __agent reads use final text.
No document, database or network connection is opened here.
"""
import re
from urllib.parse import unquote
from native_document_uno import final_text, paragraphs, utf16_slice
from native_document_edit_uno import final_view, mutation

READ_ACTIONS = frozenset(('get_bookmark_context', 'check_link_anchors', 'goto_bookmark', 'get_selection_hyperlink'))
WRITE_ACTIONS = frozenset(('bookmark_selection', 'set_selection_hyperlink', 'adopt_legacy_links'))
ACTIONS = READ_ACTIONS | WRITE_ACTIONS


def failure(message):
    return dict(success=False, error=message, message=message)


def bookmark_range(model, name):
    bookmarks = model.getBookmarks()
    if not bookmarks.hasByName(name):
        return None
    # Read failures must propagate: treating a broken UNO bridge as a missing
    # bookmark would permanently mark a still-valid evidence link as orphaned.
    return bookmarks.getByName(name).getAnchor()


def heading_context(model, range):
    chain, seen = [], 99
    try:
        body = model.getText()
        available = paragraphs(model)
        start = range.getStart()
        index = next((i for i, paragraph in enumerate(available)
                      if body.compareRegionStarts(paragraph.getStart(), start) >= 0
                      and body.compareRegionEnds(paragraph.getEnd(), start) <= 0), -1)
        if index < 0:
            return chain, -1
        for paragraph in reversed(available[:index + 1]):
            try:
                level = paragraph.getPropertyValue('OutlineLevel') or 0
            except Exception:
                level = 0
            if 0 < level < seen:
                chain.insert(0, utf16_slice(paragraph.getString().strip(), 200))
                seen = level
            if seen <= 1:
                break
        return chain, index
    except Exception:
        # Body paragraph positions cannot describe another story (table cell,
        # header, footnote); preserve the bookmark text with an unknown index.
        return [], -1


def dispatch(action, params, model, uno_mod, context=None, *, document_epoch, read_only):
    if action not in ACTIONS:
        raise ValueError('UNSUPPORTED_NATIVE_EVIDENCE_ACTION')
    if (not isinstance(params, dict) or type(document_epoch) is not int or document_epoch < 1
            or type(read_only) is not bool or not model.getURL()):
        raise ValueError('Native document URL, epoch and permission are required')
    if 'documentSeq' in params and (type(params['documentSeq']) is not int or params['documentSeq'] != document_epoch):
        raise ValueError('STALE_DOCUMENT')
    if params.get('documentUrl', model.getURL()) != model.getURL():
        raise ValueError('STALE_DOCUMENT')
    if action in WRITE_ACTIONS:
        if read_only or model.isReadonly():
            raise RuntimeError('READ_ONLY: evidence mutation is not permitted')
        try:
            # The read-only final_text helper suppresses dirty notifications
            # across its body. Writes must use the existing write-aware guard.
            with final_view(model, uno_mod, bool(params.get('__agent'))):
                return write_action(action, params, model, uno_mod, context)
        except Exception as error:
            if str(error).startswith('EDIT_OUTCOME_UNKNOWN:'):
                raise RuntimeError('EVIDENCE_OUTCOME_UNKNOWN: ' + str(error)) from error
            raise
    with final_text(model, uno_mod, bool(params.get('__agent'))):
        if action == 'get_selection_hyperlink':
            range = selection(model)
            if range is None:
                return dict(success=True, url='', hasSelection=False)
            text = range.getString()
            value = range.getText().createTextCursorByRange(range).getPropertyValue('HyperLinkURL')
            return dict(success=True, url=value if isinstance(value, str) else '', hasSelection=bool(text), text=text)
        if action == 'check_link_anchors':
            names = params.get('names') if isinstance(params.get('names'), list) else []
            items = []
            for name in names[:200]:
                name = str(name)
                range = bookmark_range(model, name)
                items.append(dict(name=name, exists=range is not None, text=range.getString() if range is not None else ''))
            return dict(success=True, items=items, truncated=len(names) > 200)
        name = str(params.get('name') or '')
        range = bookmark_range(model, name)
        if action == 'get_bookmark_context':
            chain, index = heading_context(model, range) if range is not None else ([], -1)
            return dict(success=True, exists=range is not None, text=range.getString() if range is not None else '',
                        sectionPath='/'.join(chain), sectionTitle=chain[-1] if chain else '', paragraphIndex=index)
        if range is None:
            return failure('bookmark not found: ' + name)
        controller = model.getCurrentController()
        try:
            controller.getViewCursor().gotoRange(range, False)
        except Exception:
            try:
                if controller.select(range) is False:
                    raise RuntimeError('selection rejected')
            except Exception:
                return failure('could not select bookmark: ' + name)
        return dict(success=True, name=name)


def selection(model):
    selected = model.getCurrentController().getSelection()
    if selected is None or not hasattr(selected, 'getCount') or not selected.getCount():
        return None
    range = selected.getByIndex(0)
    return range if hasattr(range, 'getString') and hasattr(range, 'getText') else None


def selected_text(model, params):
    range = selection(model)
    if range is None or not range.getString():
        raise ValueError('no text selection for evidence link')
    text = range.getString()
    if 'expectedText' in params and (not isinstance(params['expectedText'], str) or params['expectedText'] != text):
        raise ValueError('EVIDENCE_SELECTION_CHANGED')
    cursor = range.getText().createTextCursorByRange(range.getStart())
    cursor.gotoRange(range.getEnd(), True)
    return cursor, text


def add_bookmark(model, name, range, text):
    bookmark = model.createInstance('com.sun.star.text.Bookmark')
    bookmark.setName(name)
    range.getText().insertTextContent(range, bookmark, True)
    if bookmark.getName() != name or bookmark.getAnchor().getString() != text:
        raise RuntimeError('Evidence bookmark write was not confirmed')


def legacy_key(url):
    for unused in range(2):
        if not re.search(r'%[0-9A-Fa-f]{2}', url):
            break
        try:
            url = unquote(url, errors='strict')
        except UnicodeDecodeError:
            break
    match = re.search(r'filelink\?k=([^&#\s]+)', url)
    if not match:
        return None
    key = match.group(1)
    return key, bool(re.fullmatch(r'[A-Za-z0-9_]{1,64}', key))


def legacy_targets(model):
    # Match the existing body-paragraph/first-portion adoption contract. Never
    # normalize an invalid key into a different database link identity.
    targets, invalid = [], set()
    bookmarks, seen, skipped = model.getBookmarks(), set(), 0
    for paragraph in paragraphs(model):
        portions = paragraph.createEnumeration()
        while portions.hasMoreElements():
            portion = portions.nextElement()
            url = portion.getPropertyValue('HyperLinkURL')
            parsed = legacy_key(url) if isinstance(url, str) and url else None
            if not parsed:
                continue
            name, valid = parsed
            if not valid:
                invalid.add(name)
                continue
            if name in seen or bookmarks.hasByName(name) or not portion.getString():
                skipped += 1
                continue
            cursor = portion.getText().createTextCursorByRange(portion.getStart())
            cursor.gotoRange(portion.getEnd(), True)
            targets.append((name, cursor, cursor.getString()))
            seen.add(name)
    return targets, skipped, len(invalid)


def write_action(action, params, model, uno_mod, context):
    # Parameter, identity and selection failures precede the mutation boundary.
    # The host wraps each action in its existing undo lineage and catches the
    # unknown marker; this is not a transaction spanning the three link RPCs.
    agent = bool(params.get('__agent'))
    if action == 'adopt_legacy_links':
        targets, skipped, invalid = legacy_targets(model)
        if targets:
            with mutation(model, uno_mod, context, agent):
                for name, cursor, text in targets:
                    if model.getBookmarks().hasByName(name) or cursor.getString() != text:
                        raise RuntimeError('Legacy evidence target changed')
                    add_bookmark(model, name, cursor, text)
        return dict(success=True, adopted=[name for name, cursor, text in targets], skipped=skipped, skippedInvalid=invalid,
                    bookmarkMutations=len(targets), hyperlinkMutations=0, changed=bool(targets))
    if action == 'bookmark_selection':
        name = params.get('name')
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,64}', name):
            raise ValueError('bookmark name must match [A-Za-z0-9_]{1,64}')
        if model.getBookmarks().hasByName(name):
            raise ValueError('bookmark exists: ' + name)
        cursor, text = selected_text(model, params)
        with mutation(model, uno_mod, context, agent):
            add_bookmark(model, name, cursor, text)
        return dict(success=True, name=name, text=text, bookmarkMutations=1, hyperlinkMutations=0, changed=True)
    url = params.get('url')
    if not isinstance(url, str) or not re.match(r'^(https?://|checkba://)', url, re.I):
        raise ValueError('url only supports http/https/checkba')
    cursor, text = selected_text(model, params)
    changed = cursor.getPropertyValue('HyperLinkURL') != url
    if changed:
        with mutation(model, uno_mod, context, agent):
            cursor.setPropertyValue('HyperLinkURL', url)
            if cursor.getPropertyValue('HyperLinkURL') != url or cursor.getString() != text:
                raise RuntimeError('Evidence hyperlink write was not confirmed')
    return dict(success=True, text=text, url=url, bookmarkMutations=0, hyperlinkMutations=int(changed), changed=changed)
