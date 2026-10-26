# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Writer comments on the URL-bound model supplied by the native session.

The host must serialize calls and fence documentSeq/revision before dispatch,
resolve the human author at load, and wrap mutations in its existing undo.edit.
Each mutation is one native undo context; RecordChanges is restored in finally.
Replies use Writer's real reply command, not a best-effort ParentName imitation.
An exception after mutation is an unknown outcome, never permission to replay.
"""
from contextlib import contextmanager
from datetime import datetime
import uuid

ANNOTATION = 'com.sun.star.text.TextField.Annotation'
ACTIONS = frozenset(('list_comments', 'goto_comment', 'add_comment_at_selection',
                     'update_comment', 'delete_comment', 'reply_comment', 'set_comment_resolved'))
FENCE_FIELDS = ('id', 'author', 'content', 'timestamp', 'anchorText', 'resolved')


def fields(model):
    enumeration = model.getTextFields().createEnumeration()
    result = []
    while enumeration.hasMoreElements():
        field = enumeration.nextElement()
        if field.supportsService(ANNOTATION):
            result.append(field)
    return result


def comment_id(field):
    name = field.getPropertyValue('Name')
    if name:
        return name
    # Imported replies can legitimately have no bookmark name. ParaId is the
    # native post-it ID, stable only within this model (the host fences reloads).
    native_id = field.getPropertyValue('ParaId')
    if not isinstance(native_id, str) or not native_id or int(native_id, 16) <= 0:
        raise RuntimeError('COMMENT_ID_UNAVAILABLE')
    return 'native:' + native_id


def detail(field, index):
    date = field.getPropertyValue('DateTimeValue')
    stamp = (f'{date.Year:04}-{date.Month:02}-{date.Day:02}T{date.Hours:02}:'
             f'{date.Minutes:02}:{date.Seconds:02}.{date.NanoSeconds:09}')
    return {'index': index, 'id': comment_id(field),
            'author': field.getPropertyValue('Author'), 'content': field.getPropertyValue('Content'),
            'timestamp': stamp, 'date': stamp[:16].replace('T', ' '),
            'anchorText': field.getAnchor().getString(),
            'resolved': field.getPropertyValue('Resolved'),
            'parentId': field.getPropertyValue('ParentName') or None}


def parent_map(model, native_parents):
    # The session obtains this immediately beforehand via LOK ViewAnnotations.
    # UNO ParentName alone cannot represent a nested imported nameless reply.
    available = fields(model)
    identities = {int(field.getPropertyValue('ParaId'), 16): comment_id(field) for field in available}
    if len(identities) != len(available) or not isinstance(native_parents, list):
        raise RuntimeError('COMMENT_TOPOLOGY_UNAVAILABLE')
    parents = {}
    for item in native_parents:
        if (not isinstance(item, dict) or type(item.get('id')) is not int
                or type(item.get('parentId')) is not int or item['id'] <= 0 or item['parentId'] < 0
                or item['id'] in parents):
            raise RuntimeError('COMMENT_TOPOLOGY_UNAVAILABLE')
        parents[item['id']] = item['parentId']
    if set(parents) != set(identities) or any(parent and parent not in identities for parent in parents.values()):
        raise RuntimeError('COMMENT_TOPOLOGY_CHANGED')
    complete = {0}
    for identity in parents:
        chain, current = set(), identity
        while current not in complete:
            if current in chain:
                raise RuntimeError('COMMENT_TOPOLOGY_INVALID')
            chain.add(current)
            current = parents[current]
        complete.update(chain)
    return {identities[identity]: identities.get(parent) for identity, parent in parents.items()}


def list_comments(model, native_parents):
    parents = parent_map(model, native_parents)
    comments = [dict(detail(field, i), parentId=parents[comment_id(field)]) for i, field in enumerate(fields(model))]
    if len({item['id'] for item in comments}) != len(comments):
        raise RuntimeError('COMMENT_ID_NOT_UNIQUE')
    return {'success': True, 'comments': comments, 'count': len(comments),
            'total': len(comments), 'truncated': False}


def target(model, params):
    available = fields(model)
    ref = params.get('id')
    if isinstance(ref, str) and ref:
        matches = [(i, field) for i, field in enumerate(available) if comment_id(field) == ref]
    elif type(params.get('index')) is int and 0 <= params['index'] < len(available):
        matches = [(params['index'], available[params['index']])]
    else:
        matches = []
    if len(matches) != 1:
        raise RuntimeError('COMMENT_CHANGED')
    index, field = matches[0]
    current = detail(field, index)
    expected = params.get('expectedComment')
    if expected is not None:
        if (not isinstance(expected, dict) or params.get('id') != expected.get('id')
                or any(type(expected.get(key)) is not type(current[key])
                       or expected[key] != current[key] for key in FENCE_FIELDS)):
            raise RuntimeError('COMMENT_CHANGED')
    if 'expectedContent' in params and params['expectedContent'] != current['content']:
        raise RuntimeError('COMMENT_CHANGED')
    return field, current


def text_param(params, name):
    value = params.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError('COMMENT_TEXT_REQUIRED')
    return value


def author_name(context, uno_mod, params, reply=False):
    if reply and (params.get('asUser') is not True or params.get('__agent')):
        return 'AI WorkDeck'
    provider = context.ServiceManager.createInstanceWithContext(
        'com.sun.star.configuration.ConfigurationProvider', context)
    node = uno_mod.createUnoStruct('com.sun.star.beans.PropertyValue')
    node.Name, node.Value = 'nodepath', '/org.openoffice.UserProfile/Data'
    access = provider.createInstanceWithArguments('com.sun.star.configuration.ConfigurationAccess', (node,))
    return ' '.join(value for value in (access.getByName('givenname'), access.getByName('sn')) if value)


@contextmanager
def mutation(model, title):
    recording = model.getPropertyValue('RecordChanges')
    if type(recording) is not bool:
        raise RuntimeError('TRACKING_STATE_UNAVAILABLE')
    manager = model.getUndoManager()
    manager.enterUndoContext(title)
    try:
        if recording:
            model.setPropertyValue('RecordChanges', False)
        if model.getPropertyValue('RecordChanges') is not False:
            raise RuntimeError('TRACKING_SUSPEND_NOT_VERIFIED')
        yield
    except Exception as error:
        raise RuntimeError('COMMENT_OUTCOME_UNKNOWN: ' + str(error)) from error
    finally:
        try:
            try:
                if model.getPropertyValue('RecordChanges') != recording:
                    model.setPropertyValue('RecordChanges', recording)
                if model.getPropertyValue('RecordChanges') is not recording:
                    raise RuntimeError('TRACKING_RESTORE_NOT_VERIFIED')
            finally:
                manager.leaveUndoContext()
        except Exception as error:
            # Cleanup can fail after the document changed. Preserve the same
            # unknown boundary used by the host to prevent blind write retries.
            raise RuntimeError('COMMENT_OUTCOME_UNKNOWN: ' + str(error)) from error


def dispatch_uno(model, context, uno_mod, command, args=()):
    values = []
    for name, value in args:
        prop = uno_mod.createUnoStruct('com.sun.star.beans.PropertyValue')
        prop.Name, prop.Value = name, value
        values.append(prop)
    helper = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.DispatchHelper', context)
    helper.executeDispatch(model.getCurrentController().getFrame(), command, '', 0, tuple(values))


def dispatch(method, params, model, uno_mod, context, *, read_only, native_parents=None):
    # LOK view read-only is separate from XStorable.isReadonly(). The session
    # must inject its own flag after caller params, never accept a caller override.
    if type(read_only) is not bool:
        raise ValueError('The session read_only flag is required')
    if method not in ACTIONS:
        raise ValueError('UNSUPPORTED_COMMENT_ACTION')
    if method == 'list_comments':
        return list_comments(model, native_parents)
    if method != 'goto_comment' and (read_only or model.isReadonly()):
        raise RuntimeError('READ_ONLY')
    if method == 'add_comment_at_selection':
        text = text_param(params, 'comment')
        view_cursor = model.getCurrentController().getViewCursor()
        # Keep a model range before suspending tracking; Writer can invalidate
        # the layout-backed view cursor after final-view search and selection.
        cursor = view_cursor.getText().createTextCursorByRange(view_cursor.getStart())
        cursor.gotoRange(view_cursor.getEnd(), True)
        anchor_text = cursor.getString()
        if not anchor_text:
            raise ValueError('COMMENT_SELECTION_REQUIRED')
        author = author_name(context, uno_mod, params)
        identity = 'awd_comment_' + uuid.uuid4().hex
        field = model.createInstance(ANNOTATION)
        for key, value in [('Name', identity), ('Author', author), ('Content', text)]:
            field.setPropertyValue(key, value)
        now = datetime.now()
        date = uno_mod.createUnoStruct('com.sun.star.util.DateTime')
        date.Year, date.Month, date.Day = now.year, now.month, now.day
        date.Hours, date.Minutes, date.Seconds = now.hour, now.minute, now.second
        date.NanoSeconds = now.microsecond * 1000
        field.setPropertyValue('DateTimeValue', date)
        before = len(fields(model))
        with mutation(model, '添加批注'):
            cursor.getText().insertTextContent(cursor, field, True)
            _, item = target(model, {'id': identity})
            if (len(fields(model)) != before + 1 or item['content'] != text
                    or item['author'] != author or item['anchorText'] != anchor_text):
                raise RuntimeError('COMMENT_INSERT_NOT_VERIFIED')
        return {'success': True, 'changed': True, 'id': identity, 'author': author,
                'comment': text, 'annotatedText': anchor_text[:120], 'count': before + 1}
    field, item = target(model, params)
    if method == 'goto_comment':
        anchor = field.getAnchor()
        model.getCurrentController().select(anchor)
        cursor = model.getCurrentController().getViewCursor()
        text = anchor.getText()
        if (text.compareRegionStarts(cursor, anchor) != 0
                or text.compareRegionEnds(cursor, anchor) != 0):
            raise RuntimeError('COMMENT_LOCATION_NOT_VERIFIED')
        return {'success': True, 'index': item['index'], 'id': item['id']}
    if method in ('update_comment', 'set_comment_resolved'):
        prop = 'Content' if method == 'update_comment' else 'Resolved'
        value = text_param(params, 'content') if prop == 'Content' else params.get('resolved')
        if prop == 'Resolved' and type(value) is not bool:
            raise ValueError('resolved must be a boolean')
        old = item['content' if prop == 'Content' else 'resolved']
        if old != value:
            with mutation(model, '编辑批注' if prop == 'Content' else '设置批注状态'):
                field.setPropertyValue(prop, value)
                if field.getPropertyValue(prop) != value:
                    raise RuntimeError('COMMENT_UPDATE_NOT_VERIFIED')
        return {'success': True, 'changed': old != value, 'id': item['id'],
                'resolved': field.getPropertyValue('Resolved')}
    if method == 'delete_comment':
        # Removing a parent through UNO does not repair the surviving replies'
        # internal native parent IDs. Refuse rather than silently orphan them.
        parents = parent_map(model, native_parents)
        if item['id'] in parents.values():
            raise RuntimeError('COMMENT_HAS_REPLIES')
        before = len(fields(model))
        with mutation(model, '删除批注'):
            field.getAnchor().getText().removeTextContent(field)
            remaining = fields(model)
            if len(remaining) != before - 1 or any(comment_id(f) == item['id'] for f in remaining):
                raise RuntimeError('COMMENT_DELETE_NOT_VERIFIED')
        return {'success': True, 'changed': True, 'remaining': before - 1}
    text = text_param(params, 'text')
    author = author_name(context, uno_mod, params, reply=True)
    before = {f.getPropertyValue('ParaId') for f in fields(model)}
    native_id = str(int(field.getPropertyValue('ParaId'), 16))
    with mutation(model, '回复批注'):
        # Escape the active annotation shell; it otherwise ignores Id/Text and
        # can create an empty reply to the wrong currently focused comment.
        dispatch_uno(model, context, uno_mod, '.uno:Escape')
        dispatch_uno(model, context, uno_mod, '.uno:ReplyComment', [('Id', native_id), ('Text', text)])
        added = [f for f in fields(model) if f.getPropertyValue('ParaId') not in before]
        if len(added) != 1:
            raise RuntimeError('COMMENT_REPLY_NOT_VERIFIED')
        reply = added[0]
        # Writer appends a localized quotation and defaults to its profile
        # author. Set exact requested content/author in the same undo action.
        reply.setPropertyValue('Name', 'awd_comment_' + uuid.uuid4().hex)
        reply.setPropertyValue('Content', text)
        reply.setPropertyValue('Author', author)
        parent_name = field.getPropertyValue('Name')
        if (not parent_name or reply.getPropertyValue('ParentName') != parent_name
                or reply.getPropertyValue('Content') != text or reply.getPropertyValue('Author') != author):
            raise RuntimeError('COMMENT_REPLY_NOT_VERIFIED')
        reply_id = comment_id(reply)
    return {'success': True, 'changed': True, 'id': reply_id,
            'parentId': comment_id(field), 'author': author, 'text': text}
