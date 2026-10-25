# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Group a native IME replacement without replacing its LOK input path."""


def stacks(manager):
    return {'undo': list(manager.getAllUndoActionTitles()),
            'redo': list(manager.getAllRedoActionTitles())}


def review_state(model):
    return (model.getPropertyValue('RecordChanges'), model.getPropertyValue('ShowChanges'),
            model.getCurrentController().getViewSettings().getPropertyValue('ShowChangesInMargin'))


class NativeInputUndo:
    def __init__(self):
        self.pending = None

    def execute(self, action, params, model, *, document_epoch, read_only):
        seq, permission = params.get('inputSeq'), params.get('permissionSeq')
        if (type(document_epoch) is not int or document_epoch < 1 or type(read_only) is not bool
                or type(seq) is not int or seq < 1 or type(permission) is not int or permission < 0):
            raise ValueError('Invalid native input context identity')
        identity = (model, model.getURL(), document_epoch, permission, seq)
        if not identity[1]:
            raise ValueError('Native input URL is required')
        if action == 'input_undo_begin':
            if read_only or model.isReadonly():
                raise RuntimeError('READ_ONLY: cannot start native input')
            if self.pending is not None:
                raise RuntimeError('INPUT_OUTCOME_UNKNOWN: an input context is already open')
            collapsed = model.getCurrentController().getViewCursor().isCollapsed()
            if type(collapsed) is not bool:
                raise RuntimeError('INPUT_OUTCOME_UNKNOWN: selection is unreadable')
            if collapsed:
                # Preserve Writer's ordinary typing coalescing. No end RPC or
                # undo context is added for text at an empty cursor.
                return {'grouped': False, 'inputSeq': seq, 'permissionSeq': permission}
            manager = model.getUndoManager()
            before, review = stacks(manager), review_state(model)
            try:
                manager.enterUndoContext('输入')
            except Exception as error:
                raise RuntimeError('INPUT_OUTCOME_UNKNOWN: ' + str(error)) from error
            self.pending = (identity, manager, before, review)
            return {'grouped': True, 'inputSeq': seq, 'permissionSeq': permission}
        if action != 'input_undo_end':
            raise ValueError('Unsupported native input context action')
        if type(params.get('applied')) is not bool:
            raise ValueError('Native input outcome is required')
        if self.pending is None or self.pending[0] != identity:
            raise RuntimeError('INPUT_OUTCOME_UNKNOWN: input context identity changed')
        _, manager, before, review = self.pending
        # Cleanup remains permitted after a concurrent revocation. It closes
        # the exact owned context, without inserting or replaying any text.
        try:
            manager.leaveUndoContext()
            self.pending = None
            after = stacks(manager)
            if review_state(model) != review:
                raise RuntimeError('native input changed tracking or display')
            if params['applied']:
                if (after['undo'] != ['输入'] + before['undo'] or after['redo']):
                    raise RuntimeError('native replacement was not one undo group')
            elif after != before:
                raise RuntimeError('unconsumed native input changed undo history')
        except Exception as error:
            raise RuntimeError('INPUT_OUTCOME_UNKNOWN: ' + str(error)) from error
        return {'closed': True, 'inputSeq': seq, 'permissionSeq': permission}
