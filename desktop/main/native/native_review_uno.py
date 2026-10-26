# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""URL-bound review details and typed review state over an owned LOK bridge.

Run only with an explicitly isolated/read-only pyuno runtime. Never bootstraps soffice.
Display transitions mirror office_thread.js applyRevisionView/withViewOnlyChange:
typed short RedlineDisplayType writes verified through the readable model
ShowChanges, controller ViewSettings ShowChangesInMargin for balloons, modified
enablement preserved around the change, and AwdReviewSidebarWidth reserved (280)
only for a user entering balloons from another mode. Display transitions never
write RecordChanges; tracking has a separate, verified operation.
"""
import argparse
import hashlib
import uuid
import json
import sys
import native_toolbar_uno as toolbar
import native_comments_uno as comments
import native_document_uno as document
import native_input_uno as native_input
import native_document_edit_uno as document_edit
import native_evidence_uno as evidence
import native_export_uno as export
import native_completion_uno as completion
import native_ruler_uno as ruler

document_commands = document.NativeDocumentCommands()
input_undo = native_input.NativeInputUndo()
document_edits = document_edit.NativeDocumentEdits(document_commands)
completion_commands = completion.NativeCompletionCommands()
ruler_commands = ruler.NativeRulerCommands()
view_read_proof = None

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, required=True)

REVISION_VIEW_MODES = ('all', 'final', 'balloons')
REVIEW_GEOMETRY_PROPERTIES = ('AwdReviewGeometry', 'AwdReviewSidebarWidth')

# Last model successfully switched into balloons (office_thread.js balloonModel).
balloon_model = None


def read_show_changes(model):
    try:
        return bool(model.getPropertyValue('ShowChanges'))
    except Exception:
        return None


def read_show_changes_in_margin(ctrl):
    try:
        return bool(ctrl.getViewSettings().getPropertyValue('ShowChangesInMargin'))
    except Exception:
        return None


def supports_review_geometry(ctrl):
    try:
        info = ctrl.getPropertySetInfo()
    except Exception:
        return False
    return all(info.hasPropertyByName(name) for name in REVIEW_GEOMETRY_PROPERTIES)


def revision_view_state(model, ctrl):
    show_changes = read_show_changes(model)
    in_margin = read_show_changes_in_margin(ctrl)
    if show_changes is False:
        mode = 'final'
    elif in_margin is True:
        mode = 'balloons' if balloon_model == model else 'margin'
    else:
        mode = 'all'
    return {'mode': mode, 'showChanges': show_changes, 'showChangesInMargin': in_margin,
            'marginSupported': in_margin is not None}


def apply_revision_view(model, ctrl, mode, internal, uno_mod, refresh=False):
    # Fail before any mutation: balloons needs both Awd review properties.
    geometry_supported = supports_review_geometry(ctrl)
    if mode == 'balloons' and not geometry_supported:
        raise RuntimeError('Review balloons view requires AwdReviewGeometry and AwdReviewSidebarWidth')
    show_changes = read_show_changes(model)
    if show_changes is None:
        raise RuntimeError('ShowChanges is not readable')
    in_margin = read_show_changes_in_margin(ctrl)
    if mode == 'balloons' and in_margin is None:
        raise RuntimeError('ShowChangesInMargin is not readable')
    previous = revision_view_state(model, ctrl)
    # Pure display changes must not expire completion/review tokens or trigger
    # autosave (withViewOnlyChange): suppress modified while switching, restore
    # the previous enablement in finally. Never touches RecordChanges.
    enabled = model.isSetModifiedEnabled()
    if enabled:
        model.disableSetModified()
    try:
        # Reserve the native gutter before moving deletions out of the body, and
        # only for a user entering balloons from another mode. Internal
        # switch-and-restore paths (export, resolution) leave the width alone.
        if (mode == 'balloons' and not internal and previous['mode'] != 'balloons'
                and geometry_supported
                and ctrl.getPropertyValue('AwdReviewSidebarWidth') != 280):
            ctrl.setPropertyValue('AwdReviewSidebarWidth', 280)
        if mode in ('balloons', 'margin'):
            if in_margin is not True:
                ctrl.getViewSettings().setPropertyValue('ShowChangesInMargin', True)
        elif in_margin is True:
            ctrl.getViewSettings().setPropertyValue('ShowChangesInMargin', False)
        if show_changes != (mode != 'final'):
            uno_mod.invoke(model, 'setPropertyValue',
                           ('RedlineDisplayType', uno_mod.Any('short', 2 if mode != 'final' else 0)))
        global balloon_model
        balloon_model = model if mode == 'balloons' else None
        # Report the read-back state, not the request; Writer may normalize the
        # enum (0 -> 1), so ShowChanges is the only honest readback judge.
        state = revision_view_state(model, ctrl)
        state['requested'] = mode
        expected_margin = mode in ('balloons', 'margin')
        if (state['mode'] != mode or (state['showChangesInMargin'] is not None
                                     and state['showChangesInMargin'] != expected_margin)):
            raise RuntimeError('Display mode was not applied')
        # Export and undo detours consume layout, not just text. Writer can keep
        # old merged deletion ranges after the property write until refresh().
        # Keep this inside the view-only modified guard, including failures.
        if refresh:
            model.refresh()
        return state
    finally:
        if enabled:
            model.enableSetModified()


def review_geometry(ctrl):
    if not supports_review_geometry(ctrl):
        return {'available': False}
    try:
        geometry = json.loads(ctrl.getPropertyValue('AwdReviewGeometry'))
    except Exception as error:
        raise RuntimeError(f'Review geometry is unreadable: {error}')
    if (not isinstance(geometry, dict) or geometry.get('version') != 1
            or geometry.get('unit') != 'twip'
            or not isinstance(geometry.get('revisions'), list)
            or not isinstance(geometry.get('comments'), list)
            or not isinstance(geometry.get('pages'), list)
            or not isinstance(geometry.get('view'), dict)):
        raise RuntimeError('Unsupported review geometry payload')
    return {'available': True, 'geometry': geometry}


def model_for(desktop, url):
    components = desktop.getComponents().createEnumeration()
    matches = []
    while components.hasMoreElements():
        model = components.nextElement()
        if model.supportsService('com.sun.star.text.TextDocument') and model.getURL() == url:
            matches.append(model)
    if len(matches) != 1:
        raise RuntimeError('Expected exactly one URL-bound Writer model')
    return matches[0]


def find_revision(doc, identifier):
    redlines = doc.getRedlines()
    matches = []
    for i in range(redlines.getCount()):
        candidate = redlines.getByIndex(i)
        if str(candidate.getPropertyValue('RedlineIdentifier')) == identifier:
            matches.append(candidate)
    if len(matches) != 1:
        raise RuntimeError('Revision identity is no longer unique')
    return matches[0]


def revision_text(revision):
    hidden = revision.getPropertyValue('RedlineText')
    if hidden:
        return hidden.getString()
    start = revision.getPropertyValue('RedlineStart')
    end = revision.getPropertyValue('RedlineEnd')
    cursor = start.getText().createTextCursorByRange(start)
    cursor.gotoRange(end, True)
    return cursor.getString()


def revision_datetime(date):
    # Match utl::toISO8601 used by Writer's getTrackedChanges CAPI exactly.
    result = f'{date.Year}-{date.Month:02}-{date.Day:02}'
    nanos = date.NanoSeconds
    if date.Hours or date.Minutes or date.Seconds or nanos:
        result += f'T{date.Hours:02}:{date.Minutes:02}:{date.Seconds:02}'
        if nanos > 0:
            result += f',{nanos:09}'
    return result


def revision_authors(revision):
    author = revision.getPropertyValue('RedlineAuthor')
    successor = revision.getPropertyValue('RedlineSuccessorData')
    # CAPI getTrackedChanges uses GetAuthorString(1), unlike UNO's current
    # RedlineAuthor. Preserve both identities for legitimate stacked redlines.
    prior = [item.Value for item in successor if item.Name == 'RedlineAuthor'] if successor else [author]
    if len(prior) != 1 or not isinstance(author, str) or not isinstance(prior[0], str):
        raise RuntimeError('Revision author stack is unreadable')
    return {'author': author, 'capiAuthor': prior[0], 'successor': str(successor)}


def detail_of(revision):
    date = revision.getPropertyValue('RedlineDateTime')
    return {'identifier': str(revision.getPropertyValue('RedlineIdentifier')),
            **revision_authors(revision),
            'type': revision.getPropertyValue('RedlineType'), 'text': revision_text(revision),
            'dateTime': revision_datetime(date)}


def undo_state(model):
    manager = model.getUndoManager()
    def top(titles):
        values = [str(title) for title in titles]
        return {'depth': len(values), 'title': values[0] if values else '', 'titles': values}
    return {'undo': top(manager.getAllUndoActionTitles()),
            'redo': top(manager.getAllRedoActionTitles())}


def undo_step(model, kind, expected):
    if kind not in ('undo', 'redo'):
        raise ValueError('Unsupported undo operation')
    before = undo_state(model)
    if before != expected:
        raise RuntimeError('Undo stack changed before dispatch')
    if before[kind]['depth'] == 0:
        return {'applied': False, 'state': before}
    # XUndoManager is synchronous. A CAPI postUnoCommand acknowledgement alone
    # only says that the command was dispatched, not that undo has completed.
    getattr(model.getUndoManager(), kind)()
    after = undo_state(model)
    other = 'redo' if kind == 'undo' else 'undo'
    if (after[kind]['titles'] != before[kind]['titles'][1:]
            or after[other]['titles'] != before[kind]['titles'][:1] + before[other]['titles']):
        raise RuntimeError('Undo outcome was not verified')
    return {'applied': True, 'state': after}


def apply_tracking(model, enabled, initialize):
    previous = model.getPropertyValue('RecordChanges')
    if not isinstance(previous, bool):
        raise RuntimeError('RecordChanges is not readable as a boolean')
    changed = previous != enabled
    if changed:
        model.setPropertyValue('RecordChanges', enabled)
    actual = model.getPropertyValue('RecordChanges')
    if not isinstance(actual, bool) or actual != enabled:
        raise RuntimeError('RecordChanges was not applied')
    # The host calls initialization only for a newly opened, undisclosed model.
    # Match product retarget semantics without clearing revisions or undo. A
    # user's later preference change must remain a saveable document mutation.
    if initialize:
        model.setModified(False)
    elif changed:
        model.setModified(True)
    modified = model.isModified()
    if (not isinstance(modified, bool) or (initialize and modified)
            or (not initialize and changed and not modified)):
        raise RuntimeError('Tracking modified state was not applied')
    return {'enabled': actual, 'changed': changed, 'modified': modified}


def view_read_state(model):
    cursor = model.getCurrentController().getViewCursor()
    text = cursor.getText()
    prefix = text.createTextCursor()
    prefix.gotoStart(False)
    prefix.gotoRange(cursor.getStart(), True)
    # Preserve story identity as a UNO reference; identical cell text must not
    # make navigation to another cell look like a readback of the same range.
    digest = lambda value: hashlib.sha256(value.encode('utf-8')).hexdigest()
    return dict(text=text, start=prefix.getString(), selected=cursor.getString(),
                body=digest(model.getText().getString()), story=digest(text.getString()),
                undo=undo_state(model), recording=model.getPropertyValue('RecordChanges'),
                modified=model.isModified(), display=model.getPropertyValue('RedlineDisplayType'))


def view_read_identity(params):
    return tuple(params.get(key) for key in ('documentUrl', 'nativeDocumentEpoch', 'nativeRevision', 'nativePermissionSeq'))


def dispatch(method, params, model, uno_mod, context=None):
    ctrl = model.getCurrentController()
    if method in ('capture_view_read', 'check_view_read'):
        global view_read_proof
        state, identity = view_read_state(model), view_read_identity(params)
        if method == 'capture_view_read':
            token = uuid.uuid4().hex
            view_read_proof = (token, model, identity, state)
            return {'token': token}
        previous = view_read_proof
        if not previous or params.get('token') != previous[0] or model != previous[1] or identity != previous[2]:
            return dict(contentUnchanged=False, selectionUnchanged=False)
        before = previous[3]
        content = all(before[key] == state[key] for key in ('body', 'undo', 'recording', 'modified', 'display'))
        selected = all(before[key] == state[key] for key in ('text', 'start', 'selected', 'story'))
        return dict(contentUnchanged=content, selectionUnchanged=selected)
    if method == 'export_pdf':
        return export.export_pdf(model, uno_mod, params.get('nativeOutputPath'))
    if method in ('get_ruler_state', 'set_ruler_state'):
        return ruler_commands.execute(method, params, model, uno_mod, context)
    if method in completion.ACTIONS:
        return completion_commands.execute(method, params, model, uno_mod, context,
            document_epoch=params.get('nativeDocumentEpoch'), revision=params.get('nativeRevision'),
            read_only=params.get('nativeReadOnly'), permission_seq=params.get('nativePermissionSeq'))
    toolbar_params = {key: value for key, value in params.items() if key not in ('documentUrl', 'nativeReadOnly', 'nativeDocumentEpoch', 'nativeRevision', 'nativePermissionSeq')}
    if method in ('input_undo_begin', 'input_undo_end'):
        return input_undo.execute(method, params, model, document_epoch=params.get('nativeDocumentEpoch'),
                                  read_only=params.get('nativeReadOnly'))
    if method in document_edit.ACTIONS:
        return document_edits.execute(method, toolbar_params, model, uno_mod, context,
                                      document_epoch=params.get('nativeDocumentEpoch'),
                                      revision=params.get('nativeRevision'), read_only=params.get('nativeReadOnly'))
    if method in evidence.ACTIONS:
        return evidence.dispatch(method, toolbar_params, model, uno_mod, context,
                                 document_epoch=params.get('nativeDocumentEpoch'), read_only=params.get('nativeReadOnly'))
    if method in document.ACTIONS:
        return document_commands.execute(method, toolbar_params, model, uno_mod,
                                         document_epoch=params.get('nativeDocumentEpoch'),
                                         revision=params.get('nativeRevision'), read_only=params.get('nativeReadOnly'))
    if method in comments.ACTIONS or method == 'comments':
        return comments.dispatch('list_comments' if method == 'comments' else method, params, model, uno_mod, context,
                                 read_only=params.get('nativeReadOnly'), native_parents=params.get('nativeCommentParents'))
    if method == 'list_fonts':
        return toolbar.list_fonts(context)
    if method == 'list_styles':
        return toolbar.list_styles(model, toolbar_params)
    if method == 'view_settings':
        return toolbar.read_view(model)
    if method == 'set_view_options':
        return toolbar.set_view_options(model, toolbar_params)
    if method == 'set_zoom':
        return toolbar.set_zoom(model, toolbar_params, uno_mod)
    if method == 'set_chrome':
        return toolbar.set_chrome(model, toolbar_params)
    if method == 'set_style':
        return toolbar.set_style(model, toolbar_params, uno_mod)
    if method == 'view_metrics':
        layout = review_geometry(ctrl)
        if not layout['available']:
            raise RuntimeError('Native page geometry is unavailable')
        return {'pages': layout['geometry']['pages'], 'unit': layout['geometry']['unit']}
    if method == 'format_selection':
        return toolbar.format_selection(model, toolbar_params, uno_mod)
    if method == 'ui_command':
        return toolbar.ui_command(model, toolbar_params, uno_mod, context)
    if method == 'author':
        name = params.get('name')
        if not isinstance(name, str) or len(name) > 1024 or context is None:
            raise ValueError('A bounded author name and remote context are required')
        provider = context.ServiceManager.createInstanceWithContext(
            'com.sun.star.configuration.ConfigurationProvider', context)
        node = uno_mod.createUnoStruct('com.sun.star.beans.PropertyValue')
        node.Name, node.Value = 'nodepath', '/org.openoffice.UserProfile/Data'
        access = provider.createInstanceWithArguments(
            'com.sun.star.configuration.ConfigurationUpdateAccess', (node,))
        access.replaceByName('givenname', name)
        access.replaceByName('sn', '')
        access.commitChanges()
        if access.getByName('givenname') != name or access.getByName('sn') != '':
            raise RuntimeError('Author configuration was not applied')
        return {'authorName': name}
    if method == 'ui_state':
        cursor = ctrl.getViewCursor()
        stack = undo_state(model)
        view = revision_view_state(model, ctrl)
        return {'docKind': 'writer', **toolbar.read_format(model),
                'view': {**toolbar.read_view(model), 'recordChanges': model.getPropertyValue('RecordChanges'),
                         'revisionView': view['mode'], 'showChanges': view['showChanges'],
                         'showChangesInMargin': view['showChangesInMargin'],
                         'revisionBalloonsSupported': supports_review_geometry(ctrl)},
                'undo': {'canUndo': stack['undo']['depth'] > 0, 'canRedo': stack['redo']['depth'] > 0}}
    if method == 'tracking_state':
        enabled, modified = model.getPropertyValue('RecordChanges'), model.isModified()
        if not isinstance(enabled, bool) or not isinstance(modified, bool):
            raise RuntimeError('Tracking state is not readable as booleans')
        return {'enabled': enabled, 'modified': modified}
    if method == 'tracking':
        enabled, initialize = params.get('enabled'), params.get('initialize', False)
        if not isinstance(enabled, bool) or not isinstance(initialize, bool):
            raise ValueError('enabled and initialize must be booleans')
        if initialize and not enabled:
            raise ValueError('Initial tracking must be enabled')
        return apply_tracking(model, enabled, initialize)
    if method == 'undo_state':
        return undo_state(model)
    if method == 'undo_step':
        return undo_step(model, params.get('kind'), params.get('expected'))
    if method == 'check_revision_batch':
        targets, expected = params.get('targets'), params.get('expectedCount')
        if (not isinstance(targets, list) or not 1 <= len(targets) <= 25
                or type(expected) is not int or expected < 0
                or any(not isinstance(target, dict) or type(target.get('index')) is not int
                       or not 0 <= target['index'] < expected or not isinstance(target.get('identifier'), str)
                       for target in targets)
                or len({target['index'] for target in targets}) != len(targets)):
            raise ValueError('Invalid revision proof batch')
        redlines = model.getRedlines()
        if redlines.getCount() != expected:
            raise RuntimeError('STALE_REVIEW_BATCH: Revision count changed')
        entries = []
        for target in targets:
            detail = detail_of(redlines.getByIndex(target['index']))
            if detail['identifier'] != target['identifier']:
                raise RuntimeError('STALE_REVIEW_BATCH: Revision identity changed')
            entries.append(dict(index=target['index'], **detail))
        if redlines.getCount() != expected:
            raise RuntimeError('STALE_REVIEW_BATCH: Revision count changed during proof')
        return {'entries': entries, 'total': expected}
    if method == 'verify_location':
        revision = find_revision(model, params['identifier'])
        start, end = revision.getPropertyValue('RedlineStart'), revision.getPropertyValue('RedlineEnd')
        cursor = ctrl.getViewCursor()
        text = start.getText()
        located = (text.compareRegionStarts(start, cursor.getStart()) == 0
                   and text.compareRegionEnds(end, cursor.getEnd()) == 0)
        if not located:
            raise RuntimeError('The native selection does not match the requested revision')
        return {'located': True, 'identifier': params['identifier']}
    if method == 'check_revision':
        # Click-time identity recheck for one cached revision: locate by
        # identifier and read only that revision, never every entry's text.
        return detail_of(find_revision(model, params['identifier']))
    if method == 'view':
        refresh = params.get('refresh', False)
        if not isinstance(refresh, bool):
            raise ValueError('refresh must be a boolean')
        if 'mode' not in params:
            if refresh:
                raise ValueError('A layout refresh requires an explicit display mode')
            # Read-only query of the actual state; never echoes a request.
            return revision_view_state(model, ctrl)
        mode = params['mode']
        internal = params.get('internal', False)
        if not isinstance(internal, bool):
            raise ValueError('internal must be a boolean')
        if mode not in REVISION_VIEW_MODES and not (internal and mode == 'margin'):
            raise ValueError('Unsupported display mode')
        return apply_revision_view(model, ctrl, mode, internal, uno_mod, refresh)
    if method == 'geometry':
        result = review_geometry(ctrl)
        if result['available']:
            result.update(mode=revision_view_state(model, ctrl)['mode'],
                          sidebarWidth=ctrl.getPropertyValue('AwdReviewSidebarWidth'))
        return result
    if method == 'set_review_balloons':
        if type(params.get('enabled')) is not bool:
            raise ValueError('enabled must be a boolean')
        if not supports_review_geometry(ctrl):
            return {'success': True, 'available': False}
        width = params.get('width', 280)
        if type(width) not in (int, float) or not 180 <= width <= 360:
            raise ValueError('Invalid review sidebar width')
        width = round(width) if params['enabled'] else 0
        def apply_width():
            ctrl.setPropertyValue('AwdReviewSidebarWidth', width)
            if ctrl.getPropertyValue('AwdReviewSidebarWidth') != width:
                raise RuntimeError('VIEW_OUTCOME_UNKNOWN: Review sidebar width was not applied')
            return {'success': True, 'available': True}
        return toolbar.view_change(model, apply_width)
    if method not in ('snapshot', 'snapshot_batch'):
        raise ValueError('Unsupported review operation')
    info = ctrl.getPropertySetInfo()
    capabilities = {name: info.hasPropertyByName(name) for name in ('AwdReviewGeometry', 'AwdReviewSidebarWidth')}
    entries = []
    redlines = model.getRedlines()
    total = redlines.getCount()
    batch_start, stop = 0, total
    if method == 'snapshot_batch':
        batch_start, limit, expected = params.get('start'), params.get('limit'), params.get('expectedCount')
        if (type(batch_start) is not int or batch_start < 0 or type(limit) is not int or not 1 <= limit <= 25
                or type(expected) is not int or expected < 0):
            raise ValueError('Invalid review batch range')
        if expected != total or batch_start >= total:
            raise RuntimeError('STALE_REVIEW_BATCH: Revision count changed')
        stop = min(batch_start + limit, total)
    for index in range(batch_start, stop):
        revision = redlines.getByIndex(index)
        text = None
        hidden = revision.getPropertyValue('RedlineText')
        if hidden:
            text = hidden.getString()
        if text is None:
            start = revision.getPropertyValue('RedlineStart')
            end = revision.getPropertyValue('RedlineEnd')
            cursor = start.getText().createTextCursorByRange(start)
            cursor.gotoRange(end, True)
            text = cursor.getString()
        date = revision.getPropertyValue('RedlineDateTime')
        entries.append({'identifier': str(revision.getPropertyValue('RedlineIdentifier')),
                        **revision_authors(revision),
                        'type': revision.getPropertyValue('RedlineType'), 'text': text,
                        'dateTime': revision_datetime(date)})
        if method == 'snapshot_batch':
            entries[-1]['index'] = index
    if method == 'snapshot_batch':
        if redlines.getCount() != total:
            raise RuntimeError('STALE_REVIEW_BATCH: Revision count changed during read')
        return {'entries': entries, 'start': batch_start, 'total': total, 'controllerCapabilities': capabilities}
    return {'entries': entries, 'controllerCapabilities': capabilities,
            'displayType': model.getPropertyValue('RedlineDisplayType')}


def main():
    args = parser.parse_args()
    if not 0 < args.port < 65536:
        raise ValueError('Invalid loopback port')
    import uno
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    remote = resolver.resolve(f'uno:socket,host=127.0.0.1,port={args.port};urp;StarOffice.ComponentContext')
    desktop = remote.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', remote)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            model = model_for(desktop, request['params']['documentUrl'])
            response = {'id': request['id'], 'result': dispatch(request['method'], request['params'], model, uno, remote)}
        except Exception as error:
            response = {'id': request['id'], 'error': str(error)}
        print(json.dumps(response, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
