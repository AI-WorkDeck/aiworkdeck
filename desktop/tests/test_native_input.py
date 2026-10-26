# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Portable grouping guards; real LOK input/undo evidence is run separately."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'main' / 'native'))
from native_input_uno import NativeInputUndo


class Manager:
    def __init__(self):
        self.undo, self.redo, self.actions, self.enters, self.leaves = ['old'], ['redo'], [], 0, 0
        self.fail_leave = False

    def getAllUndoActionTitles(self): return self.undo
    def getAllRedoActionTitles(self): return self.redo
    def enterUndoContext(self, title): self.enters += 1
    def leaveUndoContext(self):
        self.leaves += 1
        if self.fail_leave: raise RuntimeError('leave failed')
        if self.actions: self.undo.insert(0, '输入'); self.redo.clear()


class InputTests(unittest.TestCase):
    def setUp(self):
        self.helper, self.manager = NativeInputUndo(), Manager()
        self.collapsed = False
        self.model = SimpleNamespace(getURL=lambda: 'file:///owned.docx', isReadonly=lambda: False,
            getUndoManager=lambda: self.manager, getPropertyValue=lambda name: True,
            getCurrentController=lambda: SimpleNamespace(
                getViewCursor=lambda: SimpleNamespace(isCollapsed=lambda: self.collapsed),
                getViewSettings=lambda: SimpleNamespace(getPropertyValue=lambda name: False)))

    def call(self, action, **params):
        return self.helper.execute(action, {'inputSeq': 4, 'permissionSeq': 2, **params}, self.model,
                                   document_epoch=3, read_only=False)

    def test_selected_delete_and_insert_become_one_group(self):
        self.assertTrue(self.call('input_undo_begin')['grouped'])
        self.manager.actions = ['delete selection', 'commit text']
        self.assertTrue(self.call('input_undo_end', applied=True)['closed'])
        self.assertEqual(self.manager.undo, ['输入', 'old'])
        self.assertEqual(self.manager.leaves, 1)

    def test_collapsed_cursor_does_not_start_or_end_an_undo_context(self):
        self.collapsed = True
        self.assertFalse(self.call('input_undo_begin')['grouped'])
        self.assertEqual((self.manager.enters, self.manager.leaves), (0, 0))

    def test_revoked_unconsumed_input_closes_same_context_without_changes(self):
        self.call('input_undo_begin')
        result = self.helper.execute('input_undo_end', {'inputSeq': 4, 'permissionSeq': 2, 'applied': False},
                                     self.model, document_epoch=3, read_only=True)
        self.assertTrue(result['closed'])
        self.assertEqual(self.manager.undo, ['old']); self.assertEqual(self.manager.redo, ['redo'])

    def test_wrong_epoch_sequence_or_permission_never_closes_another_context(self):
        self.call('input_undo_begin')
        for epoch, seq, permission in [(4, 4, 2), (3, 5, 2), (3, 4, 3)]:
            with self.assertRaisesRegex(RuntimeError, 'identity changed'):
                self.helper.execute('input_undo_end', {'inputSeq': seq, 'permissionSeq': permission, 'applied': True},
                                     self.model, document_epoch=epoch, read_only=False)
        self.assertEqual(self.manager.leaves, 0)

    def test_cleanup_failure_and_unverified_native_outcome_are_unknown(self):
        self.call('input_undo_begin'); self.manager.fail_leave = True
        with self.assertRaisesRegex(RuntimeError, 'INPUT_OUTCOME_UNKNOWN.*leave failed'):
            self.call('input_undo_end', applied=True)
        self.assertEqual(self.manager.leaves, 1)
        self.setUp(); self.call('input_undo_begin')
        with self.assertRaisesRegex(RuntimeError, 'not one undo group'):
            self.call('input_undo_end', applied=True)

    def test_readonly_cannot_begin_and_invalid_flags_are_not_coerced(self):
        for readonly in (True, 'false'):
            with self.assertRaises((RuntimeError, ValueError)):
                self.helper.execute('input_undo_begin', {'inputSeq': 4, 'permissionSeq': 2}, self.model,
                                     document_epoch=3, read_only=readonly)
        self.assertEqual(self.manager.enters, 0)


if __name__ == '__main__':
    unittest.main()
