# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Writer toolbar operations with typed writes and synchronous property readback.

The parameter/DTO names follow office_thread.js. This module deliberately does
not accept arbitrary dispatch URLs. Native dispatch acknowledgement alone cannot
establish that a toolbar action was applied.
"""
import math
import re

CN_SIZES = {'初号': 42, '小初': 36, '一号': 26, '小一': 24, '二号': 22, '小二': 18,
            '三号': 16, '小三': 15, '四号': 14, '小四': 12, '五号': 10.5, '小五': 9,
            '六号': 7.5, '小六': 6.5, '七号': 5.5, '八号': 5}
HIGHLIGHT = {'yellow': 0xffff00, 'green': 0x00ff00, 'cyan': 0x00ffff, 'magenta': 0xff00ff,
             'red': 0xff0000, 'blue': 0x0000ff, 'gray': 0xc0c0c0, 'none': -1}
UNDERLINE = {'none': 0, 'single': 1, 'double': 2, 'dotted': 3, 'dash': 5, 'dashed': 5,
             'wave': 10, 'bold': 12}
ALIGN = {'left': 0, 'right': 1, 'justify': 2, 'center': 3}


def font_size(value):
    if isinstance(value, bool):
        raise ValueError('fontSize must be a size')
    if isinstance(value, str):
        name = value.strip()
        value = next((CN_SIZES[key] for key in (name, name.removesuffix('号'), name + '号') if key in CN_SIZES),
                     re.sub(r'(pt|磅|号)$', '', name, flags=re.I).strip())
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise ValueError('Invalid fontSize') from None
    if not math.isfinite(number) or number <= 0:
        raise ValueError('Invalid fontSize')
    return number


def color(value, names=None):
    if not isinstance(value, str):
        raise ValueError('Color must be a string')
    value = value.strip().lower()
    if value == 'auto':
        return -1
    if names and value in names:
        return names[value]
    if re.fullmatch(r'#?[0-9a-f]{6}', value):
        return int(value.removeprefix('#'), 16)
    raise ValueError('Invalid color')


def format_properties(params, uno):
    allowed = {'bold', 'italic', 'underline', 'underlineStyle', 'strikeout', 'fontName',
               'fontNameAsian', 'fontNameWestern', 'fontSize', 'color', 'highlight', 'atCursor', '__agent'}
    if set(params) - allowed:
        raise ValueError('Unsupported format_selection parameter')
    for key in ('bold', 'italic', 'strikeout', 'atCursor'):
        if key in params and type(params[key]) is not bool:
            raise ValueError(f'{key} must be a boolean')
    props = {}
    def chars(name, kind, value):
        for suffix in ('', 'Asian', 'Complex'):
            props[name + suffix] = (kind, value)
    if 'bold' in params:
        chars('CharWeight', 'float', 150.0 if params['bold'] else 100.0)
    if 'italic' in params:
        chars('CharPosture', 'com.sun.star.awt.FontSlant', uno.Enum('com.sun.star.awt.FontSlant', 'ITALIC' if params['italic'] else 'NONE'))
    if 'strikeout' in params:
        props['CharStrikeout'] = ('short', 1 if params['strikeout'] else 0)
    if 'underline' in params or 'underlineStyle' in params:
        value = params.get('underlineStyle', params.get('underline'))
        if type(value) is bool:
            value = 'single' if value else 'none'
        if not isinstance(value, str) or value.lower() not in UNDERLINE:
            raise ValueError('Unsupported underline style')
        props['CharUnderline'] = ('short', UNDERLINE[value.lower()])
    if 'fontSize' in params:
        chars('CharHeight', 'float', font_size(params['fontSize']))
    for key in ('fontName', 'fontNameAsian', 'fontNameWestern'):
        if key not in params:
            continue
        value = params[key]
        if not isinstance(value, str) or not value.strip() or len(value) > 256:
            raise ValueError('Invalid font family')
        if key == 'fontName':
            chars('CharFontName', 'string', value)
        elif key == 'fontNameAsian':
            props['CharFontNameAsian'] = ('string', value)
        else:
            props['CharFontName'] = props['CharFontNameComplex'] = ('string', value)
    if 'color' in params:
        props['CharColor'] = ('long', color(params['color']))
    if 'highlight' in params:
        props['CharHighlight'] = ('long', color(params['highlight'], HIGHLIGHT))
    if not props:
        raise ValueError('No format parameters given')
    return props


def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < 0.001
    return a == b


def apply_properties(model, target, props, uno, title):
    # Validate every property and snapshot before the first mutation. Mid-write
    # failures are outcome-unknown, never a successful partially applied format.
    before = {name: target.getPropertyValue(name) for name in props}
    changes = {name: spec for name, spec in props.items() if not same(before[name], spec[1])}
    if not changes:
        return False
    recording = model.getPropertyValue('RecordChanges')
    shown = model.getPropertyValue('ShowChanges')
    margin = model.getCurrentController().getViewSettings().getPropertyValue('ShowChangesInMargin')
    manager = model.getUndoManager()
    entered, locked = False, False
    try:
        manager.enterUndoContext(title); entered = True
        model.lockControllers(); locked = True
        for name, (kind, value) in changes.items():
            uno.invoke(target, 'setPropertyValue', (name, uno.Any(kind, value)))
        for name, (_, value) in props.items():
            if not same(target.getPropertyValue(name), value):
                raise RuntimeError(f'{name} was not applied')
        if (model.getPropertyValue('RecordChanges') != recording or model.getPropertyValue('ShowChanges') != shown
                or model.getCurrentController().getViewSettings().getPropertyValue('ShowChangesInMargin') != margin):
            raise RuntimeError('Formatting changed review state')
    except Exception as error:
        raise RuntimeError(f'FORMAT_OUTCOME_UNKNOWN: {error}') from error
    finally:
        cleanup_errors = []
        if locked:
            try:
                model.unlockControllers()
            except Exception as error:
                cleanup_errors.append(str(error))
        if entered:
            try:
                manager.leaveUndoContext()
            except Exception as error:
                cleanup_errors.append(str(error))
        if cleanup_errors:
            raise RuntimeError('FORMAT_OUTCOME_UNKNOWN: ' + '; '.join(cleanup_errors))
    return True


def format_selection(model, params, uno):
    props = format_properties(params, uno)
    cursor = model.getCurrentController().getViewCursor()
    collapsed = not cursor.getString()
    if collapsed and params.get('atCursor') is not True:
        raise ValueError('Nothing selected; select first, then format')
    changed = apply_properties(model, cursor, props, uno, 'Format selection')
    return {'changed': changed, 'atCursor': collapsed, 'selectedText': cursor.getString()[:100],
            'applied': {key: value for key, value in params.items() if key not in ('atCursor', '__agent')}}


def ui_command(model, params, uno, context=None):
    if set(params) - {'name', '__agent'}:
        raise ValueError('Unsupported ui_command parameter')
    name = params.get('name')
    ctrl, cursor = model.getCurrentController(), model.getCurrentController().getViewCursor()
    if name == 'select_all':
        selected = model.getText().createTextCursor()
        selected.gotoStart(False); selected.gotoEnd(True)
        if not ctrl.select(selected) or ctrl.getViewCursor().getString() != selected.getString():
            raise RuntimeError('Select all was not applied')
        return {'name': name, 'changed': False}
    if name == 'escape':
        cursor.collapseToEnd()
        if cursor.getString():
            raise RuntimeError('Selection did not collapse')
        return {'name': name, 'changed': False}
    toggle = {'bold': ('CharWeight', lambda value: value is not None and value > 100),
              'italic': ('CharPosture', lambda value: value is not None and value.value != 'NONE'),
              'underline': ('CharUnderline', lambda value: value is not None and value != 0),
              'strikeout': ('CharStrikeout', lambda value: value is not None and value != 0)}
    if name in toggle:
        prop, enabled = toggle[name]
        current = read_format(model)['character'].get(name) if name in ('bold', 'italic') else enabled(cursor.getPropertyValue(prop))
        return {'name': name, **format_selection(model, {name: not current, 'atCursor': True}, uno)}
    if isinstance(name, str) and name.startswith('align_') and name[6:] in ALIGN:
        changed = apply_properties(model, cursor, {'ParaAdjust': ('short', ALIGN[name[6:]])}, uno, 'Paragraph alignment')
        return {'name': name, 'changed': changed}
    if name in DISPATCH_COMMANDS:
        return checked_dispatch(model, name, uno, context)
    raise ValueError('Unsupported native ui_command')


def list_styles(model, params):
    kind = params.get('kind', 'paragraph')
    if kind not in ('paragraph', 'character'):
        raise ValueError('Unsupported style family')
    family = model.getStyleFamilies().getByName('ParagraphStyles' if kind == 'paragraph' else 'CharacterStyles')
    styles = []
    for name in family.getElementNames():
        item = family.getByName(name)
        styles.append({'name': name, 'display': item.getPropertyValue('DisplayName'), 'inUse': item.isInUse()})
    return {'kind': kind, 'count': len(styles), 'styles': styles}


def list_fonts(context):
    toolkit = context.ServiceManager.createInstanceWithContext('com.sun.star.awt.Toolkit', context)
    device = toolkit.createScreenCompatibleDevice(0, 0)
    families = sorted({descriptor.Name for descriptor in device.getFontDescriptors()})
    return {'count': len(families), 'families': families}


def read_format(model):
    cursor = model.getCurrentController().getViewCursor()
    character, paragraph = {}, {}
    def read(target, key, prop, convert=lambda value: value):
        value = cursor.getPropertyValue(prop)
        if value is not None:  # Mixed properties stay unknown rather than false.
            target[key] = convert(value)
    for key, prop in [('font', 'CharFontName'), ('fontAsian', 'CharFontNameAsian')]:
        read(character, key, prop)
    read(character, 'sizePt', 'CharHeightAsian')
    if 'sizePt' not in character:
        read(character, 'sizePt', 'CharHeight')
    weights = [cursor.getPropertyValue('CharWeight' + suffix) for suffix in ('', 'Asian', 'Complex')]
    if all(value is not None for value in weights):
        character['bold'] = any(value > 100 for value in weights)
    postures = [cursor.getPropertyValue('CharPosture' + suffix) for suffix in ('', 'Asian', 'Complex')]
    if all(value is not None for value in postures):
        character['italic'] = any(value.value != 'NONE' for value in postures)
    read(character, 'underline', 'CharUnderline', lambda value: value != 0)
    read(character, 'strikeout', 'CharStrikeout', lambda value: value != 0)
    read(character, 'color', 'CharColor', lambda value: 'auto' if value == -1 else f'#{value:06x}')
    read(character, 'highlight', 'CharHighlight', lambda value: 'none' if value == -1 else f'#{value:06x}')
    read(character, 'superscript', 'CharEscapement', lambda value: value > 0)
    read(character, 'subscript', 'CharEscapement', lambda value: value < 0)
    read(paragraph, 'styleName', 'ParaStyleName')
    read(paragraph, 'alignment', 'ParaAdjust', lambda value: next((name for name, actual in ALIGN.items() if actual == value), None))
    read(paragraph, 'outlineLevel', 'OutlineLevel')
    return {'character': character, 'paragraph': paragraph, 'selection': {'collapsed': not bool(cursor.getString())}}

# Exact Writer ViewSettings used by the production toolbar. Rulers themselves
# are rendered by the native surface using the returned real page geometry.
VIEW_PROPERTIES = {'formattingMarks': 'ShowNonprintingCharacters', 'paragraphMarks': 'ShowParaBreaks',
                   'lineBreaks': 'ShowBreaks', 'spaces': 'ShowSpaces', 'tabs': 'ShowTabstops',
                   'textBoundaries': 'ShowTextBoundaries', 'ruler': 'ShowHoriRuler', 'verticalRuler': 'ShowVertRuler'}


def read_view(model):
    settings = model.getCurrentController().getViewSettings()
    result = {}
    for key, prop in VIEW_PROPERTIES.items():
        value = settings.getPropertyValue(prop)
        if type(value) is not bool:
            raise RuntimeError(f'{prop} is not readable as a boolean')
        result[key] = value
    zoom = settings.getPropertyValue('ZoomValue')
    if type(zoom) is not int or zoom <= 0:
        raise RuntimeError('ZoomValue is not readable')
    result['zoom'] = zoom
    return result


def view_change(model, work):
    modified, recording, enabled = model.isModified(), model.getPropertyValue('RecordChanges'), model.isSetModifiedEnabled()
    if enabled:
        model.disableSetModified()
    try:
        result = work()
        if model.isModified() != modified or model.getPropertyValue('RecordChanges') != recording:
            raise RuntimeError('VIEW_OUTCOME_UNKNOWN: view settings changed document state')
        return result
    finally:
        if enabled:
            try:
                model.enableSetModified()
            except Exception as error:
                raise RuntimeError(f'VIEW_OUTCOME_UNKNOWN: cannot restore modified enablement: {error}') from error


def set_view_options(model, params):
    allowed = set(VIEW_PROPERTIES) - {'verticalRuler'}
    if set(params) - allowed or any(type(value) is not bool for value in params.values()):
        raise ValueError('View options must be supported boolean values')
    settings = model.getCurrentController().getViewSettings()
    # Check all capabilities before applying even the first preference.
    writes = {VIEW_PROPERTIES[key]: value for key, value in params.items()}
    if 'ruler' in params:
        writes.update(ShowRulers=params['ruler'], ShowVertRuler=params['ruler'])
    for name in writes:
        if type(settings.getPropertyValue(name)) is not bool:
            raise RuntimeError(f'{name} is unavailable')
    def apply():
        for name, value in writes.items():
            settings.setPropertyValue(name, value)
        for name, value in writes.items():
            if settings.getPropertyValue(name) != value:
                raise RuntimeError(f'{name} was not applied')
        return read_view(model)
    return view_change(model, apply)


def set_zoom(model, params, uno):
    if set(params) - {'value', 'delta'} or ('value' in params and 'delta' in params):
        raise ValueError('Specify one zoom value or delta')
    current = read_view(model)['zoom']
    if not params:
        return {'zoom': current}
    value = params.get('value', params.get('delta'))
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('Zoom must be finite')
    value = max(20, min(600, int(math.floor((value if 'value' in params else current + value) + 0.5))))
    settings = model.getCurrentController().getViewSettings()
    def apply():
        uno.invoke(settings, 'setPropertyValue', ('ZoomType', uno.Any('short', uno.getConstantByName('com.sun.star.view.DocumentZoomType.BY_VALUE'))))
        uno.invoke(settings, 'setPropertyValue', ('ZoomValue', uno.Any('short', value)))
        actual = settings.getPropertyValue('ZoomValue')
        if actual != value:
            raise RuntimeError('Zoom was not applied')
        return {'zoom': actual}
    return view_change(model, apply)


def set_chrome(model, params):
    if set(params) - {'all', 'menubar', 'toolbars', 'statusbar'} or any(type(value) is not bool for value in params.values()):
        raise ValueError('Unsupported chrome option')
    if any(params.values()):
        raise ValueError('The tile surface cannot show a complete native window')
    manager = model.getCurrentController().getFrame().getPropertyValue('LayoutManager')
    if manager is None:
        raise RuntimeError('Native layout manager is unavailable')
    def apply():
        if params:
            manager.setVisible(False)
        visible = manager.isVisible()
        if type(visible) is not bool or (params and visible):
            raise RuntimeError('Native chrome visibility was not confirmed')
        return {'visible': visible, 'applied': {key: visible for key in params}}
    return view_change(model, apply)


def set_style(model, params, uno):
    if set(params) - {'kind', 'styleName', '__agent'}:
        raise ValueError('Unsupported style parameter')
    kind, name = params.get('kind', 'paragraph'), params.get('styleName')
    if kind not in ('paragraph', 'character') or not isinstance(name, str) or not name:
        raise ValueError('Style kind and name are required')
    family = model.getStyleFamilies().getByName('ParagraphStyles' if kind == 'paragraph' else 'CharacterStyles')
    if not family.hasByName(name):
        raise ValueError('Style does not exist')
    cursor = model.getCurrentController().getViewCursor()
    if kind == 'character' and not cursor.getString():
        raise ValueError('Select text before applying a character style')
    prop = 'ParaStyleName' if kind == 'paragraph' else 'CharStyleName'
    changed = apply_properties(model, cursor, {prop: ('string', name)}, uno, 'Apply style')
    return {'changed': changed, 'kind': kind, 'styleName': name, 'text': cursor.getString()[:200]}


DISPATCH_COMMANDS = {'superscript': '.uno:SuperScript', 'subscript': '.uno:SubScript',
                     'clear_formatting': '.uno:ResetAttributes', 'indent_more': '.uno:IncrementIndent',
                     'indent_less': '.uno:DecrementIndent', 'bullet_list': '.uno:DefaultBullet',
                     'number_list': '.uno:DefaultNumbering', 'page_break': '.uno:InsertPagebreak'}


def command_state(model):
    cursor = model.getCurrentController().getViewCursor()
    props = {name: cursor.getPropertyValue(name) for name in (
        'CharEscapement', 'ParaLeftMargin', 'ParaFirstLineIndent', 'NumberingLevel', 'ListId', 'NumberingIsNumber', 'BreakType')}
    props['BreakType'] = props['BreakType'].value
    props['page'] = cursor.getPage()
    props['numberingType'] = None
    rules = cursor.getPropertyValue('NumberingRules')
    if props['ListId'] and rules is not None:
        props['numberingType'] = next((p.Value for p in rules.getByIndex(props['NumberingLevel']) if p.Name == 'NumberingType'), None)
    text_cursor = cursor.getText().createTextCursorByRange(cursor.getStart())
    text_cursor.gotoRange(cursor.getEnd(), True)
    props['format'] = read_format(model)
    props['direct'] = {name: text_cursor.getPropertyState(name).value for name in (
        'CharWeight', 'CharWeightAsian', 'CharPosture', 'CharUnderline', 'CharColor', 'CharHeight', 'ParaAdjust')}
    return props


def checked_dispatch(model, name, uno, context):
    if context is None:
        raise ValueError('Native dispatch context is required')
    ctrl = model.getCurrentController()
    before = command_state(model)
    recording, shown = model.getPropertyValue('RecordChanges'), model.getPropertyValue('ShowChanges')
    margin = ctrl.getViewSettings().getPropertyValue('ShowChangesInMargin')
    helper = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.DispatchHelper', context)
    manager, entered = model.getUndoManager(), False
    try:
        manager.enterUndoContext('Toolbar ' + name); entered = True
        helper.executeDispatch(ctrl.getFrame(), DISPATCH_COMMANDS[name], '', 0, ())
        after = command_state(model)
        if name in ('superscript', 'subscript'):
            sign = 1 if name == 'superscript' else -1
            valid = after['CharEscapement'] == 0 if before['CharEscapement'] is not None and before['CharEscapement'] * sign > 0 else after['CharEscapement'] is not None and after['CharEscapement'] * sign > 0
        elif name == 'clear_formatting':
            valid = all(value == 'DEFAULT_VALUE' for value in after['direct'].values())
        elif name in ('bullet_list', 'number_list'):
            bullet = uno.getConstantByName('com.sun.star.style.NumberingType.CHAR_SPECIAL')
            wanted = lambda state: bool(state['ListId']) and (state['numberingType'] == bullet if name == 'bullet_list' else state['numberingType'] != bullet)
            valid = not after['ListId'] if wanted(before) else wanted(after)
        elif name.startswith('indent_'):
            sign = 1 if name == 'indent_more' else -1
            valid = ((after['NumberingLevel'] - before['NumberingLevel']) * sign > 0 if before['ListId']
                     else (after['ParaLeftMargin'] - before['ParaLeftMargin']) * sign > 0)
            # Decrement at the beginning of a list / zero indent is a real no-op.
            valid = valid or (name == 'indent_less' and after == before and
                             (before['NumberingLevel'] == 0 if before['ListId'] else before['ParaLeftMargin'] <= 0))
        else:  # Actual page-break attribute on the newly created paragraph.
            valid = after['BreakType'] in ('PAGE_BEFORE', 'PAGE_BOTH') and after['page'] != before['page']
        if not valid:
            raise RuntimeError(f'{name} postcondition was not confirmed: {before!r} -> {after!r}')
        if (model.getPropertyValue('RecordChanges') != recording or model.getPropertyValue('ShowChanges') != shown
                or ctrl.getViewSettings().getPropertyValue('ShowChangesInMargin') != margin):
            raise RuntimeError('Command changed review state')
        return {'name': name, 'changed': after != before, 'appliedState': after,
                'atCursor': name in ('superscript', 'subscript') and not bool(ctrl.getViewCursor().getString())}
    except Exception as error:
        raise RuntimeError(f'FORMAT_OUTCOME_UNKNOWN: {error}') from error
    finally:
        if entered:
            try:
                manager.leaveUndoContext()
            except Exception as error:
                raise RuntimeError(f'FORMAT_OUTCOME_UNKNOWN: {error}') from error
