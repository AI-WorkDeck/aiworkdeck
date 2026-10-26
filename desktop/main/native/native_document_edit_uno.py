# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Bounded text edits on the existing Writer model and its issued anchors.

The host supplies identity/permission, serializes with all native input, and
wraps edits in its existing undo lineage guard. A failure after starting an
edit is unknown: never replay it automatically. No transport/model is created.
The Myers plan is a direct adaptation of office_thread.js minimalEdits; text
with paragraph breaks or surrogate pairs uses Writer's whole-range path.
"""
from contextlib import contextmanager
import re
import native_document_uno as document

ACTIONS = frozenset(('replace_at_position', 'replace_selection', 'insert_at_cursor',
                     'modify_paragraph', 'collapse_selection', 'apply_review_edit'))
MAX_DIFF_DISTANCE = 2000
MARKDOWN = re.compile(r'(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|^\s*#{1,6}\s|^\s*>\s)', re.M)


def myers_edits(a, b, maximum):
    n, m = len(a), len(b)
    limit = min(n + m, maximum)
    offset = limit + 1
    values, snapshots = [0] * (2 * limit + 3), []
    distance = -1
    for d in range(limit + 1):
        for k in range(-d, d + 1, 2):
            if k == -d or (k != d and values[offset + k - 1] < values[offset + k + 1]):
                x = values[offset + k + 1]
            else:
                x = values[offset + k - 1] + 1
            y = x - k
            while x < n and y < m and a[x] == b[y]:
                x, y = x + 1, y + 1
            values[offset + k] = x
            if x >= n and y >= m:
                distance = d
                break
        snapshots.append(values[offset - d - 1:offset + d + 2])
        if distance >= 0:
            break
    if distance < 0:
        return None
    edits, current = [], None
    x, y = n, m
    for d in range(distance, 0, -1):
        previous, k = snapshots[d - 1], x - y
        previous_k = k + 1 if k == -d or (k != d and previous[d + k - 1] < previous[d + k + 1]) else k - 1
        previous_x = previous[d + previous_k]
        previous_y = previous_x - previous_k
        down = previous_k == k + 1
        if down:
            if current is not None and current['start'] == previous_x:
                current['insText'] = b[previous_y] + current['insText']
            else:
                if current is not None:
                    edits.append(current)
                current = dict(start=previous_x, delLen=0, insText=b[previous_y])
        elif current is not None and current['start'] == previous_x + 1:
            current['start'] = previous_x
            current['delLen'] += 1
        else:
            if current is not None:
                edits.append(current)
            current = dict(start=previous_x, delLen=1, insText='')
        x, y = previous_x, previous_y
    if current is not None:
        edits.append(current)
    return edits


def minimal_edits(old, new):
    prefix, suffix = 0, 0
    maximum = min(len(old), len(new))
    while prefix < maximum and old[prefix] == new[prefix]:
        prefix += 1
    while suffix < maximum - prefix and old[len(old) - 1 - suffix] == new[len(new) - 1 - suffix]:
        suffix += 1
    old_middle, new_middle = old[prefix:len(old) - suffix], new[prefix:len(new) - suffix]
    if not old_middle and not new_middle:
        return []
    edits = myers_edits(old_middle, new_middle, MAX_DIFF_DISTANCE) if old_middle and new_middle else None
    if edits is None:
        return [dict(start=prefix, delLen=len(old_middle), insText=new_middle)]
    for item in edits:
        item['start'] += prefix
    index = 0
    while index + 1 < len(edits):
        right, left = edits[index], edits[index + 1]
        gap = right['start'] - left['start'] - left['delLen']
        if 0 <= gap <= 1:
            left['insText'] += old[left['start'] + left['delLen']:right['start']] + right['insText']
            left['delLen'] += gap + right['delLen']
            del edits[index]
        else:
            index += 1
    return edits


def set_display(model, uno_mod, value, expected_show):
    enabled = model.isSetModifiedEnabled()
    if enabled:
        model.disableSetModified()
    try:
        uno_mod.invoke(model, 'setPropertyValue', ('RedlineDisplayType', uno_mod.Any('short', value)))
        if model.getPropertyValue('ShowChanges') is not expected_show:
            raise RuntimeError('Display write was not confirmed')
    finally:
        if enabled:
            model.enableSetModified()


@contextmanager
def final_view(model, uno_mod, agent):
    if not agent:
        yield
        return
    show = model.getPropertyValue('ShowChanges')
    if type(show) is not bool:
        raise RuntimeError('FINAL_TEXT_UNAVAILABLE')
    if not show:
        yield
        return
    display = model.getPropertyValue('RedlineDisplayType')
    try:
        set_display(model, uno_mod, 0, False)
        try:
            yield
        except Exception as error:
            raise RuntimeError(str(error)) from error
    finally:
        try:
            set_display(model, uno_mod, display, show)
        except Exception as error:
            raise RuntimeError('EDIT_OUTCOME_UNKNOWN: final view restoration failed: ' + str(error)) from error


def profile_access(context, uno_mod):
    provider = context.ServiceManager.createInstanceWithContext('com.sun.star.configuration.ConfigurationProvider', context)
    node = uno_mod.createUnoStruct('com.sun.star.beans.PropertyValue')
    node.Name, node.Value = 'nodepath', '/org.openoffice.UserProfile/Data'
    return provider.createInstanceWithArguments('com.sun.star.configuration.ConfigurationUpdateAccess', (node,))


def write_author(access, given, surname):
    access.replaceByName('givenname', given)
    access.replaceByName('sn', surname)
    access.commitChanges()
    if access.getByName('givenname') != given or access.getByName('sn') != surname:
        raise RuntimeError('Author write was not confirmed')


@contextmanager
def mutation(model, uno_mod, context, agent, title=None):
    # Display suppression may never span an actual edit or future saves would
    # miss the modified signal. Refuse an already suppressed model.
    if model.isSetModifiedEnabled() is not True:
        raise RuntimeError('EDIT_STATE_UNAVAILABLE: modified tracking is disabled')
    access = profile_access(context, uno_mod) if agent else None
    old_author = (access.getByName('givenname'), access.getByName('sn')) if access else None
    manager = model.getUndoManager()
    try:
        manager.enterUndoContext(title or ('AI 文本修改' if agent else '文本修改'))
    except Exception as error:
        raise RuntimeError('EDIT_OUTCOME_UNKNOWN: undo context could not be entered: ' + str(error)) from error
    try:
        if access:
            write_author(access, 'AI WorkDeck', '')
        yield
    except Exception as error:
        raise RuntimeError('EDIT_OUTCOME_UNKNOWN: ' + str(error)) from error
    finally:
        try:
            try:
                if access:
                    write_author(access, *old_author)
            finally:
                manager.leaveUndoContext()
        except Exception as error:
            raise RuntimeError('EDIT_OUTCOME_UNKNOWN: author/undo restoration failed: ' + str(error)) from error


def live_range(range):
    cursor = range.getText().createTextCursorByRange(range.getStart())
    cursor.gotoRange(range.getEnd(), True)
    return cursor


def story_snapshot(range):
    text = range.getText()
    before = text.createTextCursorByRange(range.getStart())
    before.gotoStart(True)
    after = text.createTextCursorByRange(range.getEnd())
    after.gotoEnd(True)
    prefix, old, suffix = before.getString(), range.getString(), after.getString()
    if text.getString() != prefix + old + suffix:
        raise RuntimeError('UNSUPPORTED_TEXT_RANGE: story boundaries cannot be verified')
    return text, prefix, old, suffix


def insert_text(cursor, text):
    story = cursor.getText()
    for index, part in enumerate(text.split('\n')):
        if index:
            story.insertControlCharacter(cursor, 0, False)  # ControlCharacter.PARAGRAPH_BREAK
        if part:
            story.insertString(cursor, part, False)


def apply_replacement(range, new, tracked):
    old = range.getString()
    if old == new:
        return
    simple = not any(char in '\r\n' or 0xD800 <= ord(char) <= 0xDFFF or ord(char) > 0xFFFF
                     for char in old + new)
    if tracked and old and simple:
        start = range.getText().createTextCursorByRange(range.getStart())
        for item in minimal_edits(old, new):
            cursor = range.getText().createTextCursorByRange(start.getStart())
            if item['start'] and not cursor.goRight(item['start'], False):
                raise RuntimeError('Native edit offset was not reached')
            if item['delLen']:
                if not cursor.goRight(item['delLen'], True):
                    raise RuntimeError('Native edit range was not reached')
                cursor.setString(item['insText'])
            elif item['insText']:
                cursor.getText().insertString(cursor, item['insText'], False)
        return
    # Native range APIs handle surrogate pairs. Newlines must use paragraph
    # control characters; insertString alone would produce a single paragraph.
    if old:
        range.setString('')
    range.collapseToEnd()
    insert_text(range, new)


class NativeDocumentEdits:
    def __init__(self, document_commands):
        self.document = document_commands

    def anchor_range(self, model, epoch, name):
        if (not isinstance(name, str) or not name or self.document.model != model
                or self.document.identity != (model.getURL(), epoch)):
            raise ValueError('ANCHOR_CHANGED: find the text again')
        anchor = self.document.anchors.get(name)
        try:
            if anchor is None:
                raise ValueError('missing snapshot')
            range = anchor['bookmark'].getAnchor() if anchor['bookmark'] else anchor['range']
            if range.getString() != anchor['text']:
                raise ValueError('target text changed')
            return live_range(range)
        except Exception as error:
            raise ValueError('ANCHOR_CHANGED: find the text again') from error

    def execute(self, action, params, model, uno_mod, context, *, document_epoch, revision, read_only):
        if action not in ACTIONS:
            raise ValueError('UNSUPPORTED_NATIVE_DOCUMENT_EDIT')
        if (type(read_only) is not bool or type(document_epoch) is not int or document_epoch < 1
                or type(revision) is not int or revision < 0 or not isinstance(params, dict)):
            raise ValueError('Native document identity, revision and permission are required')
        if action != 'collapse_selection' and (read_only or model.isReadonly()):
            raise RuntimeError('READ_ONLY')
        if not model.getURL():
            raise ValueError('Native document URL is required')
        agent = bool(params.get('__agent'))
        if action == 'apply_review_edit':
            return self.review_edit(params, model, uno_mod, context, revision, agent)
        if action == 'collapse_selection':
            to = params.get('to', 'end')
            if to not in ('start', 'end'):
                raise ValueError('collapse_selection requires start or end')
            with final_view(model, uno_mod, agent):
                cursor = model.getCurrentController().getViewCursor()
                boundary = cursor.getStart() if to == 'start' else cursor.getEnd()
                expected = cursor.getText().createTextCursorByRange(boundary)
                (cursor.collapseToStart if to == 'start' else cursor.collapseToEnd)()
                story = cursor.getText()
                if (story.compareRegionStarts(cursor, expected) != 0
                        or story.compareRegionEnds(cursor, expected) != 0):
                    raise RuntimeError('Native cursor collapse was not verified')
                return dict(success=True, to=to)
        key = 'newText' if action in ('replace_at_position', 'modify_paragraph') else 'text'
        new = params.get(key)
        if not isinstance(new, str):
            raise ValueError(key + ' must be a string; empty means deletion')
        if '\x00' in new or any(0xD800 <= ord(char) <= 0xDFFF for char in new):
            raise ValueError('Invalid text encoding')
        if action == 'insert_at_cursor' and MARKDOWN.search(new):
            raise ValueError('UNSUPPORTED_NATIVE_MARKDOWN_INSERT')
        if 'replaceSelection' in params and type(params['replaceSelection']) is not bool:
            raise ValueError('replaceSelection must be a boolean')
        with final_view(model, uno_mod, agent):
            if action == 'replace_at_position':
                target = self.anchor_range(model, document_epoch, params.get('anchor'))
            elif action == 'modify_paragraph':
                index = params.get('index')
                available = document.paragraphs(model)
                if type(index) is not int or not 0 <= index < len(available):
                    raise ValueError('paragraph index out of range (zero based)')
                target = live_range(available[index])
            else:
                target = live_range(model.getCurrentController().getViewCursor())
                if action == 'insert_at_cursor' and not params.get('replaceSelection', False):
                    target.collapseToEnd()
            story, prefix, old, suffix = story_snapshot(target)
            force_tracking = action in ('replace_at_position', 'modify_paragraph')
            recording = model.getPropertyValue('RecordChanges')
            if type(recording) is not bool:
                raise RuntimeError('TRACKING_STATE_UNAVAILABLE')
            if old == new and not (force_tracking and not recording):
                self.finish_selection(model, action, target)
                return self.result(action, params, target, new, False)
            # Human commands retain their actual current-view editing semantics.
            # Only verification uses final text: an all-markup string still
            # contains deleted runs after a successful tracked replacement.
            with final_view(model, uno_mod, True):
                _, final_prefix, _, final_suffix = story_snapshot(target)
                expected = final_prefix + new + final_suffix
            with mutation(model, uno_mod, context, agent):
                if force_tracking and not recording:
                    model.setPropertyValue('RecordChanges', True)
                    if model.getPropertyValue('RecordChanges') is not True:
                        raise RuntimeError('Tracking enablement was not confirmed')
                if story.getString() != prefix + old + suffix or target.getString() != old:
                    raise RuntimeError('Target changed before publication')
                # Match actual visible selection to the range, including cells.
                ctrl = model.getCurrentController()
                if ctrl.select(target) is False:
                    raise RuntimeError('Native selection failed')
                view = ctrl.getViewCursor()
                if (story.compareRegionStarts(view, target) != 0
                        or story.compareRegionEnds(view, target) != 0):
                    raise RuntimeError('Native selection was not verified')
                apply_replacement(target, new, force_tracking or recording)
                with final_view(model, uno_mod, True):
                    if story.getString() != expected:
                        raise RuntimeError('Edited story does not match the expected text')
                # Keep the user cursor at the edited range; never report only
                # the intended string as evidence that the native edit worked.
                self.finish_selection(model, action, target)
                return self.result(action, params, target, new, old != new, force_tracking and not recording)

    @staticmethod
    def review_edit(params, model, uno_mod, context, revision, agent):
        unchanged = dict(changed=False, textChanged=False, trackingChanged=False)
        with final_view(model, uno_mod, True):
            checked = document.check_review_range(model, params, revision)
            if not checked['success']:
                return dict(checked, **unchanged)
            replacement = params.get('replacement')
            if (not isinstance(replacement, str) or document.utf16_length(replacement) > 15000
                    or any(char in '\r\n\x00' or 0xD800 <= ord(char) <= 0xDFFF for char in replacement)):
                return dict(document.review_unavailable('invalid-replacement'), **unchanged)
            target, paragraph = checked['range'], checked['paragraph']
            # Range validation excludes surrogates through end, so these offsets
            # are also Python/UNO character offsets. The trailing text stays exact.
            expected = params['expectedParagraph'][:params['start']] + replacement + params['expectedParagraph'][params['end']:]
            recording = model.getPropertyValue('RecordChanges')
            if type(recording) is not bool:
                raise RuntimeError('TRACKING_STATE_UNAVAILABLE')
            if replacement == params['quote'] and recording:
                return dict(success=True, revision=revision, **unchanged)
            manager, title = model.getUndoManager(), '采用审校建议'
            before = list(manager.getAllUndoActionTitles())
            try:
                with mutation(model, uno_mod, context, agent, title):
                    if not recording:
                        model.setPropertyValue('RecordChanges', True)
                        if model.getPropertyValue('RecordChanges') is not True:
                            raise RuntimeError('Tracking enablement was not confirmed')
                    # No partial replacement is published before both the current
                    # paragraph and the exact live quote have been checked again.
                    if paragraph.getString() != params['expectedParagraph'] or target.getString() != params['quote']:
                        raise RuntimeError('Review range changed before publication')
                    apply_replacement(target, replacement, True)
                    if paragraph.getString() != expected:
                        raise RuntimeError('Review edit verification failed')
            except Exception as error:
                try:
                    after = list(manager.getAllUndoActionTitles())
                    # Only this command's newly appended group may be undone.
                    if len(after) == len(before) + 1 and after[1:] == before and after[0] == title:
                        manager.undo()
                    if model.getPropertyValue('RecordChanges') is not recording:
                        model.setPropertyValue('RecordChanges', recording)
                    if (paragraph.getString() != params['expectedParagraph']
                            or model.getPropertyValue('RecordChanges') is not recording
                            or list(manager.getAllUndoActionTitles()) != before):
                        raise RuntimeError('Review rollback verification failed')
                except Exception as rollback_error:
                    raise RuntimeError('EDIT_OUTCOME_UNKNOWN: ' + str(rollback_error)) from error
                # A rollback can replace the redo branch. Do not leave the host's
                # retained inline-undo identities usable after a failed mutation.
                raise RuntimeError('EDIT_OUTCOME_UNKNOWN: review edit rolled back; ' + str(error)) from error
            text_changed = replacement != params['quote']
            return dict(success=True, revision=revision, changed=text_changed or not recording,
                        textChanged=text_changed, trackingChanged=not recording)

    @staticmethod
    def finish_selection(model, action, target):
        # Selection replacement and cursor insertion leave a caret, including
        # the minimal-diff and no-op paths. Otherwise the next key would replace
        # a still-selected tail of the just-edited text.
        if action in ('replace_selection', 'insert_at_cursor'):
            target.collapseToEnd()
        ctrl = model.getCurrentController()
        if ctrl.select(target) is False:
            raise RuntimeError('Post-edit selection failed')
        view, story = ctrl.getViewCursor(), target.getText()
        if story.compareRegionStarts(view, target) != 0 or story.compareRegionEnds(view, target) != 0:
            raise RuntimeError('Post-edit selection was not verified')

    @staticmethod
    def result(action, params, target, new, text_changed, tracking_changed=False):
        paragraph = document.paragraph_text(target)
        # These are internal, verified facts for the host undo guard. A state-only
        # tracking enablement may leave both stacks unchanged; it is not a text
        # edit and must not be mistaken for replacement of an inline undo entry.
        result = dict(success=True, changed=text_changed or tracking_changed,
                      textChanged=text_changed, trackingChanged=tracking_changed)
        if action == 'replace_at_position':
            result.update(anchor=params['anchor'], newText=new, paragraphAfterEdit=document.utf16_slice(paragraph, 200),
                          paragraphAfterEditLength=document.utf16_length(paragraph),
                          paragraphAfterEditTruncated=document.utf16_length(paragraph) > 200)
        elif action == 'modify_paragraph':
            result.update(index=params['index'], paragraphAfterEdit=document.utf16_slice(paragraph, 200))
        else:
            result.update(paragraphAfterEdit=paragraph, selectedText=target.getString())
            result['inserted' if action == 'insert_at_cursor' else 'text'] = new
        return result
