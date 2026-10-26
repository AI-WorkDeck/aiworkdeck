# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Current-page ruler edits, fenced to the observed selection and document."""
import math
import uuid

from native_toolbar_uno import apply_properties

PAGE = dict(pageWidth='Width', pageHeight='Height', leftMargin='LeftMargin',
            rightMargin='RightMargin', topMargin='TopMargin', bottomMargin='BottomMargin')
PARAGRAPH = dict(leftIndent='ParaLeftMargin', rightIndent='ParaRightMargin',
                 firstLineIndent='ParaFirstLineIndent')
WRITABLE = (set(PAGE) - {'pageWidth', 'pageHeight'}) | set(PARAGRAPH)


def twips(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError('Mixed or unavailable ruler property')
    return value * 1440 / 2540


def page_margin(model, style, key, value, uno, context):
    name = PAGE[key]
    if style.getPropertyValue(name) == value:
        return False
    horizontal = key in ('leftMargin', 'rightMargin')
    command = 'PageLRMargin' if horizontal else 'PageULMargin'
    members = [('Left', 'LeftMargin'), ('Right', 'RightMargin')] if horizontal else [('Upper', 'TopMargin'), ('Lower', 'BottomMargin')]
    margins = uno.createUnoStruct('com.sun.star.frame.status.' + ('LeftRightMargin' if horizontal else 'UpperLowerMargin'))
    for member, property_name in members:
        setattr(margins, member, round(twips(value if property_name == name else style.getPropertyValue(property_name))))
    # This slot accepts integral twips, whereas XPageStyle exposes mm/100.
    expected = round(twips(value))
    prop = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    # The pinned Writer 26.2 slot declares a method argument named Page.
    # LibreOffice/core@8221e31b3: svx/sdi/svx.sdi, PageLRMargin/PageULMargin.
    # PageLRMargin/PageULMargin were property names in older Writer versions;
    # those old names silently dispatch without an argument on this runtime.
    prop.Name, prop.Value = 'Page', margins
    args = [prop]
    manager = model.getUndoManager()
    tracking = model.getPropertyValue('RecordChanges')
    show = model.getPropertyValue('RedlineDisplayType')
    margin = model.getCurrentController().getViewSettings().getPropertyValue('ShowChangesInMargin')
    helper = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.DispatchHelper', context)
    entered = False
    try:
        manager.enterUndoContext('调整标尺'); entered = True
        # Writer's page-style property setters do not create an undo entry.
        # These native ruler commands use ChgPageDesc and keep one undoable edit.
        helper.executeDispatch(model.getCurrentController().getFrame(), '.uno:' + command, '', 0, tuple(args))
        if (abs(twips(style.getPropertyValue(name)) - expected) > 1 or model.getPropertyValue('RecordChanges') != tracking
                or model.getPropertyValue('RedlineDisplayType') != show
                or model.getCurrentController().getViewSettings().getPropertyValue('ShowChangesInMargin') != margin):
            raise RuntimeError(f'Page margin or review state differs after dispatch: {name}={style.getPropertyValue(name)}, expectedTwips={expected}, tracking={model.getPropertyValue("RecordChanges")}/{tracking}, display={model.getPropertyValue("RedlineDisplayType")}/{show}')
    except Exception as error:
        raise RuntimeError('FORMAT_OUTCOME_UNKNOWN: ' + str(error)) from error
    finally:
        if entered:
            try:
                manager.leaveUndoContext()
            except Exception as error:
                raise RuntimeError('FORMAT_OUTCOME_UNKNOWN: ' + str(error)) from error
    return True


class NativeRulerCommands:
    def __init__(self):
        self.pending = None

    def observe(self, model, params):
        cursor = model.getCurrentController().getViewCursor()
        text = cursor.getText()
        # A selection crossing paragraphs can mix page styles or indentation.
        # Do not display one paragraph's handles as authority for that selection.
        paragraph = text.createTextCursorByRange(cursor.getStart())
        paragraph.gotoStartOfParagraph(False)
        paragraph.gotoEndOfParagraph(True)
        if text.compareRegionEnds(cursor.getEnd(), paragraph.getEnd()) < 0:
            raise ValueError('multi-paragraph-selection')
        style_name = cursor.getPropertyValue('PageStyleName')
        style = model.getStyleFamilies().getByName('PageStyles').getByName(style_name)
        state = {key: twips(style.getPropertyValue(name)) for key, name in PAGE.items()}
        state.update({key: twips(cursor.getPropertyValue(name)) for key, name in PARAGRAPH.items()})
        page = cursor.getPage()
        if not isinstance(page, int) or page < 1:
            raise ValueError('page-unavailable')
        state.update(pageIndex=page - 1)
        identity = (model.getURL(), params.get('nativeDocumentEpoch'), params.get('nativeRevision'), style_name)
        if any(value is None for value in identity):
            raise ValueError('document-identity-unavailable')
        return state, identity, text, cursor, style

    def read(self, model, params):
        self.pending = None
        try:
            state, identity, text, cursor, style = self.observe(model, params)
            anchor = text.createTextCursorByRange(cursor)
        except Exception as error:
            return dict(success=True, available=False, reason=str(error))
        token = uuid.uuid4().hex
        self.pending = (token, identity, text, anchor, state)
        return dict(success=True, available=True, contextToken=token, **state)

    def execute(self, method, params, model, uno, context=None):
        if method == 'get_ruler_state':
            return self.read(model, params)
        if method != 'set_ruler_state':
            raise ValueError('Unsupported ruler method')
        if params.get('nativeReadOnly') is not False or model.isReadonly():
            raise ValueError('Ruler is read-only')
        patch = params.get('patch')
        if not isinstance(patch, dict) or len(patch) != 1 or not set(patch) <= WRITABLE:
            raise ValueError('A single ruler change is required')
        key, value = next(iter(patch.items()))
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('Ruler value must be finite twips')
        pending = self.pending
        self.pending = None
        if not pending or params.get('contextToken') != pending[0]:
            raise ValueError('STALE_RULER_CONTEXT')
        state, identity, text, cursor, style = self.observe(model, params)
        _, previous_identity, previous_text, anchor, previous_state = pending
        if (identity != previous_identity or state != previous_state or text != previous_text
                or text.compareRegionStarts(cursor, anchor) != 0
                or text.compareRegionEnds(cursor, anchor) != 0):
            raise ValueError('STALE_RULER_CONTEXT')
        # Writer stores these properties as integral hundredths of a millimetre.
        converted = round(value * 2540 / 1440)
        candidate = {**state, key: twips(converted)}
        for side in ('leftMargin', 'rightMargin', 'topMargin', 'bottomMargin'):
            if candidate[side] < 0:
                raise ValueError('Page margins must be non-negative')
        width = candidate['pageWidth'] - candidate['leftMargin'] - candidate['rightMargin']
        height = candidate['pageHeight'] - candidate['topMargin'] - candidate['bottomMargin']
        left, right = candidate['leftIndent'], candidate['rightIndent']
        if (width <= 0 or height <= 0 or left + right >= width
                or left < -candidate['leftMargin'] or right < -candidate['rightMargin']
                or not -candidate['leftMargin'] <= left + candidate['firstLineIndent'] < width - right):
            raise ValueError('Ruler change leaves no usable text area')
        if key in PAGE:
            if context is None:
                raise ValueError('Native dispatch context is required')
            changed = page_margin(model, style, key, converted, uno, context)
        else:
            changed = apply_properties(model, cursor, {PARAGRAPH[key]: ('long', converted)}, uno, '调整标尺')
        result = self.read(model, params)
        # Writer stores integral twips and exposes rounded mm/100 through UNO.
        if not result.get('available') or abs(result[key] - candidate[key]) > 1:
            raise RuntimeError('FORMAT_OUTCOME_UNKNOWN: ruler readback failed')
        return {**result, 'changed': changed}
