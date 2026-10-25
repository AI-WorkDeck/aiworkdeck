# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Mock unit tests for review_uno display transitions and geometry queries.

These tests verify the Python logic against mocks only. They do NOT verify
native LibreOffice engine behavior: silent property no-ops, SvtBroadcaster
lifetime, RedlineDisplayType normalization, modified plumbing or geometry
payloads must be re-validated on a real engine by the integrating root task.
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import review_uno


class FakeUno:
    class Any:
        def __init__(self, type_name, value):
            self.type_name = type_name
            self.value = value

    @staticmethod
    def invoke(model, method, arguments):
        return getattr(model, method)(*arguments)


class FakeInfo:
    def __init__(self, names):
        self.names = set(names)

    def hasPropertyByName(self, name):
        return name in self.names


class FakeProps:
    def __init__(self, props=None, drop_writes=(), raise_writes=()):
        self.props = dict(props or {})
        self.set_calls = []
        self.drop_writes = set(drop_writes)
        self.raise_writes = dict(raise_writes)

    def getPropertyValue(self, name):
        if name not in self.props:
            raise RuntimeError(f'unknown property {name}')
        return self.props[name]

    def setPropertyValue(self, name, value):
        self.set_calls.append((name, value))
        if name in self.raise_writes:
            raise self.raise_writes[name]
        if name in self.drop_writes:
            return
        self.props[name] = value
        # Engine link: the model ShowChanges readback tracks the display enum
        # (rdt 2 -> shown, rdt 0 -> hidden; Writer normalizes 0 to 1 on read).
        if name == 'RedlineDisplayType':
            self.props['ShowChanges'] = value.value != 0
            self.props['RedlineDisplayType'] = 1 if value.value == 0 else 2


class FakeController:
    def __init__(self, props=None, view_settings=None, property_names=()):
        self.props = FakeProps(props)
        self.view_settings = FakeProps(view_settings or {})
        self.property_names = set(property_names)

    def getPropertySetInfo(self):
        return FakeInfo(self.property_names)

    def getPropertyValue(self, name):
        return self.props.getPropertyValue(name)

    def setPropertyValue(self, name, value):
        self.props.setPropertyValue(name, value)

    def getViewSettings(self):
        return self.view_settings


class FakeModel:
    def __init__(self, props=None, ctrl=None, drop_writes=()):
        self.props = FakeProps(props, drop_writes=drop_writes)
        self.ctrl = ctrl or FakeController()
        self.modified = True
        self.modified_enabled = True
        self.modified_calls = []
        self.refresh_calls = []
        self.refresh_error = None
        self.undo_manager = FakeUndoManager()

    def getCurrentController(self):
        return self.ctrl

    def getPropertyValue(self, name):
        return self.props.getPropertyValue(name)

    def setPropertyValue(self, name, value):
        self.props.setPropertyValue(name, value)

    def isSetModifiedEnabled(self):
        return self.modified_enabled

    def disableSetModified(self):
        self.modified_enabled = False
        self.modified_calls.append('disable')

    def enableSetModified(self):
        self.modified_enabled = True
        self.modified_calls.append('enable')

    def refresh(self):
        self.refresh_calls.append(self.modified_enabled)
        if self.modified_enabled:
            self.modified = True
        if self.refresh_error:
            raise self.refresh_error

    def getUndoManager(self):
        return self.undo_manager


class FakeUndoManager:
    def __init__(self):
        self.undo_titles = ['Resolution', 'Typing']
        self.redo_titles = []
        self.operations = []
        self.noop = False

    def getAllUndoActionTitles(self):
        return tuple(self.undo_titles)

    def getAllRedoActionTitles(self):
        return tuple(self.redo_titles)

    def undo(self):
        self.operations.append('undo')
        if not self.noop:
            self.redo_titles.insert(0, self.undo_titles.pop(0))

    def redo(self):
        self.operations.append('redo')
        if not self.noop:
            self.undo_titles.insert(0, self.redo_titles.pop(0))


def geometry_payload():
    return json.dumps({'version': 1, 'unit': 'twip',
                       'revisions': [{'index': 0, 'id': 7, 'available': True, 'page': 1,
                                      'anchor': {'x': 100, 'y': 200, 'width': 10, 'height': 200}}],
                       'comments': [], 'pages': [{'number': 1, 'x': 0, 'y': 0, 'width': 11906,
                                                 'height': 16838, 'sidebar': 'right', 'gutterWidth': 4200}],
                       'view': {'x': 0, 'y': 0, 'width': 16106, 'height': 10000}})


def supported_model(**kwargs):
    ctrl = FakeController(
        props={'AwdReviewSidebarWidth': 0, 'AwdReviewGeometry': geometry_payload()},
        view_settings={'ShowChangesInMargin': False},
        property_names=('AwdReviewGeometry', 'AwdReviewSidebarWidth'))
    model = FakeModel(props={'ShowChanges': True, 'RedlineDisplayType': 2}, ctrl=ctrl, **kwargs)
    return model


def all_write_names(model):
    return [name for name, _ in (model.props.set_calls + model.ctrl.props.set_calls
                                 + model.ctrl.view_settings.set_calls)]


class DisplayTransitionTests(unittest.TestCase):
    def setUp(self):
        review_uno.balloon_model = None

    def view(self, model, params):
        return review_uno.dispatch('view', params, model, FakeUno)

    def test_balloons_unsupported_fails_before_mutation(self):
        ctrl = FakeController(view_settings={'ShowChangesInMargin': False},
                              property_names=('AwdReviewGeometry',))
        model = FakeModel(props={'ShowChanges': True}, ctrl=ctrl)
        with self.assertRaises(RuntimeError):
            self.view(model, {'mode': 'balloons'})
        self.assertEqual(all_write_names(model), [])
        self.assertEqual(model.modified_calls, [])
        self.assertTrue(model.modified_enabled)

    def test_unreadable_show_changes_fails_before_mutation(self):
        model = supported_model()
        del model.props.props['ShowChanges']
        with self.assertRaises(RuntimeError):
            self.view(model, {'mode': 'final'})
        self.assertEqual(all_write_names(model), [])
        self.assertEqual(model.modified_calls, [])

    def test_silent_display_write_failure_raises_and_restores_state(self):
        # Engine accepts RedlineDisplayType but never flips ShowChanges.
        model = supported_model(drop_writes=('RedlineDisplayType',))
        model.props.props['ShowChanges'] = False
        with self.assertRaises(RuntimeError):
            self.view(model, {'mode': 'all'})
        self.assertEqual(model.modified_calls, ['disable', 'enable'])
        self.assertTrue(model.modified_enabled)
        self.assertTrue(model.modified)
        self.assertIsNone(review_uno.balloon_model)

    def test_margin_write_failure_cleans_up(self):
        model = supported_model()
        model.ctrl.view_settings.raise_writes['ShowChangesInMargin'] = RuntimeError('bridge gone')
        with self.assertRaisesRegex(RuntimeError, 'bridge gone'):
            self.view(model, {'mode': 'balloons'})
        self.assertEqual(model.modified_calls, ['disable', 'enable'])
        self.assertTrue(model.modified_enabled)
        self.assertTrue(model.modified)

    def test_final_mode_does_not_hide_a_failed_margin_write(self):
        model = supported_model()
        model.ctrl.view_settings.props['ShowChangesInMargin'] = True
        model.ctrl.view_settings.drop_writes.add('ShowChangesInMargin')
        with self.assertRaisesRegex(RuntimeError, 'not applied'):
            self.view(model, {'mode': 'final'})
        self.assertTrue(model.modified_enabled)

    def test_query_recognizes_a_new_proxy_for_the_same_native_model(self):
        model = supported_model()
        self.view(model, {'mode': 'balloons'})
        class Proxy:
            def __getattr__(self, name):
                return getattr(model, name)
            def __eq__(self, other):
                return other is model
        self.assertEqual(self.view(Proxy(), {})['mode'], 'balloons')

    def test_legacy_margin_can_only_be_restored_internally(self):
        model = supported_model()
        with self.assertRaises(ValueError):
            self.view(model, {'mode': 'margin'})
        result = self.view(model, {'mode': 'margin', 'internal': True})
        self.assertEqual(result['mode'], 'margin')
        self.assertNotIn('AwdReviewSidebarWidth', all_write_names(model))

    def test_mode_all_writes_typed_short_two(self):
        model = supported_model()
        model.props.props['ShowChanges'] = False
        result = self.view(model, {'mode': 'all'})
        self.assertEqual(result['mode'], 'all')
        self.assertEqual(result['requested'], 'all')
        writes = dict(model.props.set_calls)
        rdt = writes['RedlineDisplayType']
        self.assertEqual((rdt.type_name, rdt.value), ('short', 2))
        self.assertTrue(model.props.props['ShowChanges'])
        self.assertEqual(model.ctrl.view_settings.props['ShowChangesInMargin'], False)

    def test_mode_final_writes_typed_short_zero(self):
        model = supported_model()
        result = self.view(model, {'mode': 'final'})
        self.assertEqual(result['mode'], 'final')
        self.assertFalse(result['showChanges'])
        rdt = dict(model.props.set_calls)['RedlineDisplayType']
        self.assertEqual((rdt.type_name, rdt.value), ('short', 0))

    def test_mode_balloons_user_entry_reserves_gutter(self):
        model = supported_model()
        result = self.view(model, {'mode': 'balloons'})
        self.assertEqual(result['mode'], 'balloons')
        self.assertEqual(dict(model.ctrl.props.set_calls).get('AwdReviewSidebarWidth'), 280)
        self.assertEqual(model.ctrl.view_settings.props['ShowChangesInMargin'], True)
        self.assertTrue(result['showChanges'])

    def test_balloons_reentry_keeps_gutter(self):
        model = supported_model()
        self.view(model, {'mode': 'balloons'})
        model.ctrl.props.props['AwdReviewSidebarWidth'] = 280
        self.view(model, {'mode': 'balloons'})
        self.assertEqual(model.ctrl.props.set_calls.count(('AwdReviewSidebarWidth', 280)), 1)

    def test_internal_balloons_never_writes_width(self):
        model = supported_model()
        result = self.view(model, {'mode': 'balloons', 'internal': True})
        self.assertEqual(result['mode'], 'balloons')
        self.assertNotIn('AwdReviewSidebarWidth', all_write_names(model))

    def test_internal_switch_and_restore_preserves_width(self):
        model = supported_model()
        self.view(model, {'mode': 'balloons'})  # user entry reserves the gutter once
        self.view(model, {'mode': 'final', 'internal': True})
        self.view(model, {'mode': 'balloons', 'internal': True})
        self.assertEqual(model.ctrl.props.set_calls.count(('AwdReviewSidebarWidth', 280)), 1)
        self.assertEqual(model.ctrl.props.props['AwdReviewSidebarWidth'], 280)

    def test_leaving_balloons_clears_margin_and_flag(self):
        model = supported_model()
        self.view(model, {'mode': 'balloons'})
        result = self.view(model, {'mode': 'all'})
        self.assertEqual(result['mode'], 'all')
        self.assertEqual(model.ctrl.view_settings.props['ShowChangesInMargin'], False)
        self.assertIsNone(review_uno.balloon_model)

    def test_query_returns_actual_state_not_request(self):
        model = supported_model()
        model.ctrl.view_settings.props['ShowChangesInMargin'] = True
        state = self.view(model, {})
        self.assertEqual(state['mode'], 'margin')  # never balloons without a prior apply
        self.assertTrue(state['showChanges'])
        self.assertTrue(state['showChangesInMargin'])
        self.assertTrue(state['marginSupported'])
        self.assertEqual(all_write_names(model), [])

    def test_no_record_changes_writes_anywhere(self):
        for mode in ('all', 'final', 'balloons'):
            model = supported_model()
            self.view(model, {'mode': mode})
            for name in all_write_names(model):
                self.assertNotEqual(name, 'RecordChanges', f'{mode} wrote RecordChanges')

    def test_invalid_mode_rejected(self):
        model = supported_model()
        with self.assertRaises(ValueError):
            self.view(model, {'mode': 'margin'})
        self.assertEqual(all_write_names(model), [])

    def test_internal_flag_must_be_bool(self):
        for bad in ('yes', 1, None):
            model = supported_model()
            with self.assertRaises(ValueError):
                self.view(model, {'mode': 'balloons', 'internal': bad})
            self.assertEqual(all_write_names(model), [])

    def test_export_layout_refresh_cannot_mark_a_clean_document_dirty(self):
        model = supported_model()
        model.modified = False
        self.view(model, {'mode': 'final'})
        self.view(model, {'mode': 'all', 'internal': True, 'refresh': True})
        self.view(model, {'mode': 'final', 'internal': True, 'refresh': True})
        self.assertEqual(model.refresh_calls, [False, False])
        self.assertFalse(model.modified)
        self.assertTrue(model.modified_enabled)
        self.assertFalse(model.props.props['ShowChanges'])

    def test_refresh_failure_propagates_and_restores_modified_enablement(self):
        model = supported_model()
        model.refresh_error = RuntimeError('layout failed')
        with self.assertRaisesRegex(RuntimeError, 'layout failed'):
            self.view(model, {'mode': 'all', 'internal': True, 'refresh': True})
        self.assertEqual(model.refresh_calls, [False])
        self.assertEqual(model.modified_calls, ['disable', 'enable'])
        self.assertTrue(model.modified_enabled)
        self.assertTrue(model.modified)

    def test_refresh_preserves_preexisting_disabled_modified_state(self):
        model = supported_model()
        model.modified_enabled = False
        model.modified = False
        self.view(model, {'mode': 'all', 'internal': True, 'refresh': True})
        self.assertEqual(model.refresh_calls, [False])
        self.assertEqual(model.modified_calls, [])
        self.assertFalse(model.modified_enabled)
        self.assertFalse(model.modified)

    def test_invalid_refresh_argument_never_mutates(self):
        for params in ({'mode': 'all', 'refresh': 1}, {'refresh': True}):
            model = supported_model()
            with self.assertRaises(ValueError):
                self.view(model, params)
            self.assertEqual(model.refresh_calls, [])
            self.assertEqual(all_write_names(model), [])


class UndoStateTests(unittest.TestCase):
    def test_reads_native_titles_without_mutating(self):
        model = supported_model()
        self.assertEqual(review_uno.dispatch('undo_state', {}, model, FakeUno),
                         {'undo': {'depth': 2, 'title': 'Resolution', 'titles': ['Resolution', 'Typing']},
                          'redo': {'depth': 0, 'title': '', 'titles': []}})
        self.assertEqual(model.undo_manager.operations, [])
        self.assertEqual(model.modified_calls, [])

    def test_synchronous_undo_then_redo_are_verified_from_both_stacks(self):
        model = supported_model()
        before = review_uno.undo_state(model)
        undone = review_uno.dispatch('undo_step', {'kind': 'undo', 'expected': before}, model, FakeUno)
        self.assertTrue(undone['applied'])
        self.assertEqual(undone['state']['undo'], {'depth': 1, 'title': 'Typing', 'titles': ['Typing']})
        self.assertEqual(undone['state']['redo'], {'depth': 1, 'title': 'Resolution', 'titles': ['Resolution']})
        redone = review_uno.dispatch('undo_step', {'kind': 'redo', 'expected': undone['state']}, model, FakeUno)
        self.assertEqual(redone['state'], before)
        self.assertEqual(model.undo_manager.operations, ['undo', 'redo'])

    def test_changed_stack_never_dispatches(self):
        model = supported_model()
        before = review_uno.undo_state(model)
        model.undo_manager.undo_titles.insert(0, 'New typing')
        with self.assertRaisesRegex(RuntimeError, 'stack changed'):
            review_uno.undo_step(model, 'undo', before)
        self.assertEqual(model.undo_manager.operations, [])

    def test_silent_noop_is_not_reported_as_completed_undo(self):
        model = supported_model()
        model.undo_manager.noop = True
        with self.assertRaisesRegex(RuntimeError, 'outcome was not verified'):
            review_uno.undo_step(model, 'undo', review_uno.undo_state(model))
        self.assertEqual(model.undo_manager.operations, ['undo'])

    def test_same_depth_and_top_title_cannot_hide_damage_to_older_undo_entries(self):
        model = supported_model()
        model.undo_manager.undo_titles.append('Older edit')
        normal_undo = model.undo_manager.undo
        def damaged_undo():
            normal_undo()
            model.undo_manager.undo_titles[-1] = 'Unexpected replacement'
        model.undo_manager.undo = damaged_undo
        with self.assertRaisesRegex(RuntimeError, 'outcome was not verified'):
            review_uno.undo_step(model, 'undo', review_uno.undo_state(model))

    def test_empty_stack_never_dispatches(self):
        model = supported_model()
        result = review_uno.undo_step(model, 'redo', review_uno.undo_state(model))
        self.assertFalse(result['applied'])
        self.assertEqual(model.undo_manager.operations, [])

    def test_unknown_undo_kind_rejected(self):
        model = supported_model()
        with self.assertRaises(ValueError):
            review_uno.undo_step(model, 'repeat', review_uno.undo_state(model))
        self.assertEqual(model.undo_manager.operations, [])


class GeometryQueryTests(unittest.TestCase):
    def setUp(self):
        review_uno.balloon_model = None

    def test_available_returns_validated_payload(self):
        model = supported_model()
        result = review_uno.dispatch('geometry', {}, model, FakeUno)
        self.assertTrue(result['available'])
        self.assertEqual(result['geometry']['version'], 1)
        self.assertEqual(result['geometry']['unit'], 'twip')
        self.assertEqual(len(result['geometry']['revisions']), 1)

    def test_unavailable_on_old_runtime_without_inventing_positions(self):
        ctrl = FakeController(view_settings={'ShowChangesInMargin': False})
        model = FakeModel(props={'ShowChanges': True}, ctrl=ctrl)
        result = review_uno.dispatch('geometry', {}, model, FakeUno)
        self.assertFalse(result['available'])
        self.assertNotIn('geometry', result)
        self.assertNotIn('AwdReviewGeometry', ctrl.props.props)

    def test_malformed_payload_raises(self):
        for payload in ('{"version":2,"unit":"twip","revisions":[],"comments":[]}',
                        '{"version":1,"unit":"px","revisions":[],"comments":[]}',
                        '{"version":1,"unit":"twip"}',
                        'not json'):
            model = supported_model()
            model.ctrl.props.props['AwdReviewGeometry'] = payload
            with self.assertRaises(RuntimeError):
                review_uno.dispatch('geometry', {}, model, FakeUno)


class FakeRedline:
    def __init__(self, identifier, text):
        self.identifier = identifier
        self.text = text

    def getPropertyValue(self, name):
        if name == 'RedlineIdentifier':
            return self.identifier
        if name == 'RedlineText':
            return None
        if name == 'RedlineAuthor':
            return 'me'
        if name == 'RedlineType':
            return 'Delete'
        if name == 'RedlineStart':
            start = FakeRange()
            return start
        if name == 'RedlineEnd':
            return FakeRange()
        if name == 'RedlineDateTime':
            class D:
                Year, Month, Day, Hours, Minutes, Seconds = 2026, 10, 25, 9, 30, 0
            return D()
        if name == 'RedlineSuccessorData':
            return None
        raise RuntimeError(name)


class FakeRange:
    def getText(self):
        class T:
            def createTextCursorByRange(self, r):
                class C:
                    def gotoRange(self, r2, b):
                        pass

                    def getString(self):
                        return 'replaced text'
                return C()

            def compareRegionStarts(self, a, b):
                return 0

            def compareRegionEnds(self, a, b):
                return 0
        return T()


class FakeRedlines:
    def __init__(self, items):
        self.items = items

    def getCount(self):
        return len(self.items)

    def getByIndex(self, i):
        return self.items[i]


class PreservedMethodTests(unittest.TestCase):
    def test_check_revision_returns_single_detail(self):
        model = supported_model()
        model.redlines = None
        model.getRedlines = lambda: FakeRedlines([FakeRedline('r1', 'x')])
        result = review_uno.dispatch('check_revision', {'identifier': 'r1'}, model, FakeUno)
        self.assertEqual(result['identifier'], 'r1')
        self.assertEqual(result['text'], 'replaced text')

    def test_unknown_method_rejected(self):
        model = supported_model()
        with self.assertRaises(ValueError):
            review_uno.dispatch('nonsense', {'documentUrl': 'x'}, model, FakeUno)


class BatchSnapshotTests(unittest.TestCase):
    def fixture(self, count=600):
        model = supported_model()
        class RecordingRedlines(FakeRedlines):
            def __init__(self):
                super().__init__([FakeRedline('r' + str(i), 'x') for i in range(count)])
                self.reads = []
            def getByIndex(self, index):
                self.reads.append(index)
                return super().getByIndex(index)
        redlines = RecordingRedlines()
        model.getRedlines = lambda: redlines
        return model, redlines

    def test_reads_only_the_requested_bounded_slice(self):
        model, redlines = self.fixture()
        batch = review_uno.dispatch('snapshot_batch', {'start': 575, 'limit': 25, 'expectedCount': 600}, model, FakeUno)
        self.assertEqual(redlines.reads, list(range(575, 600)))
        self.assertEqual(batch['total'], 600)
        self.assertEqual(batch['start'], 575)
        self.assertEqual([entry['index'] for entry in batch['entries']], list(range(575, 600)))
        self.assertEqual(batch['entries'][-1]['identifier'], 'r599')

    def test_invalid_bounds_and_wrong_count_never_fetch_a_revision(self):
        for params in ({'start': 0, 'limit': 26, 'expectedCount': 600},
                       {'start': -1, 'limit': 25, 'expectedCount': 600},
                       {'start': True, 'limit': 25, 'expectedCount': 600},
                       {'start': 0, 'limit': 25, 'expectedCount': 599},
                       {'start': 600, 'limit': 25, 'expectedCount': 600}):
            model, redlines = self.fixture()
            with self.assertRaises((ValueError, RuntimeError)):
                review_uno.dispatch('snapshot_batch', params, model, FakeUno)
            self.assertEqual(redlines.reads, [])

    def test_changed_count_during_read_is_not_published(self):
        model, redlines = self.fixture(3)
        counts = iter((3, 2))
        redlines.getCount = lambda: next(counts)
        with self.assertRaisesRegex(RuntimeError, 'STALE_REVIEW_BATCH'):
            review_uno.dispatch('snapshot_batch', {'start': 0, 'limit': 25, 'expectedCount': 3}, model, FakeUno)

    def test_existing_full_snapshot_keeps_its_complete_contract(self):
        model, redlines = self.fixture()
        result = review_uno.dispatch('snapshot', {}, model, FakeUno)
        self.assertEqual(len(result['entries']), 600)
        self.assertEqual(redlines.reads, list(range(600)))
        self.assertNotIn('index', result['entries'][0])


class TrackingModel(FakeModel):
    def __init__(self, enabled=False, **kwargs):
        super().__init__(props={'RecordChanges': enabled, 'ShowChanges': True}, **kwargs)
        self.modified = False
        self.clear_error = None

    def isModified(self):
        return self.modified

    def setModified(self, value):
        self.modified_calls.append(('set', value))
        if self.clear_error:
            raise self.clear_error
        self.modified = value

    def setPropertyValue(self, name, value):
        super().setPropertyValue(name, value)
        self.modified = True


class TrackingTests(unittest.TestCase):
    def tracking(self, model, **params):
        return review_uno.dispatch('tracking', params, model, FakeUno)

    def test_new_model_enables_tracking_and_clears_only_initial_dirty(self):
        model = TrackingModel()
        before_undo = review_uno.undo_state(model)
        result = self.tracking(model, enabled=True, initialize=True)
        self.assertEqual(result, {'enabled': True, 'changed': True, 'modified': False})
        self.assertEqual(model.modified_calls, [('set', False)])
        self.assertEqual(all_write_names(model), ['RecordChanges'])
        self.assertEqual(review_uno.undo_state(model), before_undo)

    def test_user_toggle_marks_dirty_and_never_clears_existing_edits(self):
        model = TrackingModel(True)
        model.modified = True
        result = self.tracking(model, enabled=False)
        self.assertEqual(result, {'enabled': False, 'changed': True, 'modified': True})
        self.assertNotIn(('set', False), model.modified_calls)
        self.assertNotIn('ShowChanges', all_write_names(model))

    def test_user_noop_preserves_dirty_and_clean_state(self):
        for dirty in (False, True):
            model = TrackingModel(True)
            model.modified = dirty
            self.assertEqual(self.tracking(model, enabled=True),
                             {'enabled': True, 'changed': False, 'modified': dirty})
            self.assertEqual(all_write_names(model), [])
            self.assertEqual(model.modified_calls, [])

    def test_boolean_parameters_are_strict_before_any_write(self):
        for key in ('enabled', 'initialize'):
            for bad in (None, 0, 1, '', 'false', [], {}):
                model = TrackingModel()
                with self.subTest(key=key, value=bad), self.assertRaises(ValueError):
                    self.tracking(model, **{'enabled': True, key: bad})
                self.assertEqual(all_write_names(model), [])
        with self.assertRaises(ValueError):
            self.tracking(TrackingModel())
        with self.assertRaises(ValueError):
            self.tracking(TrackingModel(), enabled=False, initialize=True)

    def test_missing_or_non_boolean_readback_never_becomes_enabled(self):
        for value in (None, 1, 'true'):
            model = TrackingModel(value)
            with self.assertRaisesRegex(RuntimeError, 'RecordChanges'):
                self.tracking(model, enabled=True, initialize=True)
            self.assertEqual(model.modified_calls, [])

    def test_silent_write_failure_does_not_clear_dirty(self):
        model = TrackingModel(drop_writes=('RecordChanges',))
        with self.assertRaisesRegex(RuntimeError, 'not applied'):
            self.tracking(model, enabled=True, initialize=True)
        self.assertEqual(model.modified_calls, [])

    def test_initial_dirty_clear_failure_propagates(self):
        model = TrackingModel()
        model.clear_error = RuntimeError('dirty reset failed')
        with self.assertRaisesRegex(RuntimeError, 'dirty reset failed'):
            self.tracking(model, enabled=True, initialize=True)

    def test_silent_dirty_reset_failure_blocks_initialization(self):
        model = TrackingModel()
        model.setModified = lambda value: None
        with self.assertRaisesRegex(RuntimeError, 'modified state'):
            self.tracking(model, enabled=True, initialize=True)

    def test_protected_tracking_write_propagates_without_clearing_dirty(self):
        model = TrackingModel()
        model.props.raise_writes['RecordChanges'] = RuntimeError('protected tracking')
        with self.assertRaisesRegex(RuntimeError, 'protected tracking'):
            self.tracking(model, enabled=True, initialize=True)
        self.assertEqual(model.modified_calls, [])

    def test_tracking_resolves_exactly_one_writer_by_url(self):
        class Desktop:
            def __init__(self, models):
                self.models = list(models)

            def getComponents(self):
                return self

            def createEnumeration(self):
                return self

            def hasMoreElements(self):
                return bool(self.models)

            def nextElement(self):
                return self.models.pop(0)

        def document(url):
            model = TrackingModel()
            model.supportsService = lambda name: name == 'com.sun.star.text.TextDocument'
            model.getURL = lambda: url
            return model

        old, current = document('file:///old.docx'), document('file:///current.docx')
        bound = review_uno.model_for(Desktop([old, current]), 'file:///current.docx')
        self.tracking(bound, enabled=True, initialize=True)
        self.assertFalse(old.getPropertyValue('RecordChanges'))
        self.assertTrue(current.getPropertyValue('RecordChanges'))
        for models in ([old], [current, document('file:///current.docx')]):
            with self.assertRaisesRegex(RuntimeError, 'exactly one URL-bound'):
                review_uno.model_for(Desktop(models), 'file:///current.docx')

    def test_view_switches_preserve_enabled_and_disabled_tracking(self):
        for enabled in (False, True):
            model = supported_model()
            model.props.props['RecordChanges'] = enabled
            for mode in ('all', 'final', 'balloons'):
                review_uno.dispatch('view', {'mode': mode, 'refresh': True}, model, FakeUno)
                self.assertEqual(model.getPropertyValue('RecordChanges'), enabled)
            self.assertNotIn('RecordChanges', all_write_names(model))


if __name__ == '__main__':
    unittest.main()
