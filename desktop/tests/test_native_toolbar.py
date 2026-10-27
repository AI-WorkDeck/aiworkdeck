# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Validation/guard tests only; actual Writer format roundtrip is a separate probe."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'main' / 'native'))
import native_toolbar_uno as toolbar


class Uno:
    @staticmethod
    def Enum(kind, value):
        return SimpleNamespace(typeName=kind, value=value)

    @staticmethod
    def Any(kind, value):
        return value

    @staticmethod
    def invoke(target, method, args):
        return getattr(target, method)(*args)


class Model:
    def __init__(self, reject=False):
        self.props = {name + suffix: 100.0 for name in ['CharWeight'] for suffix in ['', 'Asian', 'Complex']}
        self.props['CharWeightAsian'] = 150.0
        self.recording = True
        self.events, self.writes = [], []
        self.reject = reject
        self.ctrl = SimpleNamespace(getViewCursor=lambda: self, getViewSettings=lambda: SimpleNamespace(getPropertyValue=lambda name: False))
        self.manager = SimpleNamespace(enterUndoContext=lambda title: self.events.append('enter'), leaveUndoContext=lambda: self.events.append('leave'))

    def getPropertyValue(self, name):
        if name == 'RecordChanges':
            return self.recording
        if name == 'ShowChanges':
            return True
        return self.props.get(name)

    def setPropertyValue(self, name, value):
        self.writes.append((name, value))
        if not self.reject:
            self.props[name] = value

    def getString(self):
        return '中文'

    def getCurrentController(self):
        return self.ctrl

    def getUndoManager(self):
        return self.manager

    def lockControllers(self):
        self.events.append('lock')

    def unlockControllers(self):
        self.events.append('unlock')


class ToolbarTests(unittest.TestCase):
    def test_chinese_and_numeric_sizes(self):
        for value, expected in [('小四', 12), ('小四号', 12), ('五号', 10.5), ('12pt', 12), (14, 14)]:
            self.assertEqual(toolbar.font_size(value), expected)

    def test_invalid_sizes_fail(self):
        for value in [True, False, 0, -1, float('nan'), 'Infinity', '错误']:
            with self.assertRaises(ValueError):
                toolbar.font_size(value)

    def test_boolean_and_extra_parameters_fail_before_writing(self):
        for params in [{'bold': 1}, {'italic': 'false'}, {'fontSize': 12, 'paragraphIndex': 1}, {'color': 'bad'}]:
            model = Model()
            with self.assertRaises(ValueError):
                toolbar.format_selection(model, params, Uno)
            self.assertEqual(model.writes, [])
            self.assertEqual(model.events, [])

    def test_cjk_and_western_siblings_are_explicit(self):
        props = toolbar.format_properties({'fontSize': '小四', 'bold': True, 'fontName': 'A', 'fontNameAsian': '宋体'}, Uno)
        self.assertEqual(props['CharWeightAsian'], ('float', 150.0))
        self.assertEqual(props['CharHeightComplex'], ('float', 12.0))
        self.assertEqual(props['CharFontNameAsian'], ('string', '宋体'))
        self.assertEqual(props['CharFontName'], ('string', 'A'))

    def test_asian_bold_toolbar_toggle_uses_same_real_state_as_ui(self):
        model = Model()
        self.assertTrue(toolbar.read_format(model)['character']['bold'])
        result = toolbar.ui_command(model, {'name': 'bold'}, Uno)
        self.assertTrue(result['changed'])
        self.assertFalse(toolbar.read_format(model)['character']['bold'])
        self.assertEqual(model.events, ['enter', 'lock', 'unlock', 'leave'])
        self.assertTrue(model.recording)

    def test_silent_native_property_noop_is_outcome_unknown_and_balanced(self):
        model = Model(reject=True)
        with self.assertRaisesRegex(RuntimeError, 'FORMAT_OUTCOME_UNKNOWN'):
            toolbar.format_selection(model, {'bold': True}, Uno)
        self.assertEqual(model.events, ['enter', 'lock', 'unlock', 'leave'])

    def test_noop_format_does_not_create_undo_context(self):
        model = Model()
        for key in model.props:
            model.props[key] = 150.0
        self.assertFalse(toolbar.format_selection(model, {'bold': True}, Uno)['changed'])
        self.assertEqual(model.events, [])

    def test_dispatch_urls_are_not_accepted(self):
        model = Model()
        with self.assertRaises(ValueError):
            toolbar.ui_command(model, {'name': '.uno:Save'}, Uno)
        self.assertEqual(model.writes, [])


class DispatchTests(unittest.TestCase):
    def dispatch_context(self, model):
        model.ctrl.getFrame=lambda:object()
        return SimpleNamespace(ServiceManager=SimpleNamespace(createInstanceWithContext=lambda *_:SimpleNamespace(executeDispatch=lambda *_:None)))
    def test_silent_native_dispatch_is_rejected_and_undo_context_is_balanced(self):
        model=Model(); state={'CharEscapement':0}
        with patch.object(toolbar,'command_state',return_value=state):
            with self.assertRaisesRegex(RuntimeError,'FORMAT_OUTCOME_UNKNOWN'):
                toolbar.checked_dispatch(model,'superscript',Uno,self.dispatch_context(model))
        self.assertEqual(model.events,['enter','leave'])
    def test_existing_page_break_alone_cannot_prove_new_break_was_inserted(self):
        model=Model(); state={'BreakType':'PAGE_BEFORE','page':2}
        with patch.object(toolbar,'command_state',return_value=state):
            with self.assertRaisesRegex(RuntimeError,'postcondition'):
                toolbar.checked_dispatch(model,'page_break',Uno,self.dispatch_context(model))
        self.assertEqual(model.events,['enter','leave'])
    def test_clear_format_actual_values_change_even_when_viewcursor_property_state_does_not(self):
        model=Model(); before={'direct':{'CharWeight':'DEFAULT_VALUE'},'format':{'bold':True}}
        after={'direct':{'CharWeight':'DEFAULT_VALUE'},'format':{'bold':False}}
        with patch.object(toolbar,'command_state',side_effect=[before,after]):
            result=toolbar.checked_dispatch(model,'clear_formatting',Uno,self.dispatch_context(model))
        self.assertTrue(result['changed'])


class ViewModel:
    def __init__(self):
        self.props = {prop: False for prop in toolbar.VIEW_PROPERTIES.values()}
        self.props.update(ShowRulers=False, ZoomValue=100, ZoomType=0)
        self.modified, self.enabled, self.recording = True, True, True
        self.writes, self.events = [], []
        self.reject = None
        self.visible = True
    def getCurrentController(self):
        return SimpleNamespace(getViewSettings=lambda: self, getFrame=lambda: SimpleNamespace(getPropertyValue=lambda _: self))
    def getPropertyValue(self, name):
        return self.recording if name == 'RecordChanges' else self.props[name]
    def setPropertyValue(self, name, value):
        self.writes.append((name,value))
        if name != self.reject:
            self.props[name] = value
    def isModified(self): return self.modified
    def isSetModifiedEnabled(self): return self.enabled
    def disableSetModified(self): self.enabled=False; self.events.append('disable')
    def enableSetModified(self): self.enabled=True; self.events.append('enable')
    def setVisible(self, value): self.visible=value
    def isVisible(self): return self.visible


class ViewTests(unittest.TestCase):
    def test_session_identity_metadata_does_not_leak_into_view_options(self):
        import native_review_uno as review
        metadata = dict(documentUrl='file:///owned.docx', nativeReadOnly=False,
                        nativeDocumentEpoch=2, nativeRevision=4, nativePermissionSeq=3)
        model = ViewModel()
        uno = SimpleNamespace(Any=Uno.Any, invoke=Uno.invoke, getConstantByName=lambda _: 3)
        self.assertEqual(review.dispatch('set_zoom', {**metadata, 'delta': 10}, model, uno)['zoom'], 110)
        self.assertTrue(review.dispatch('set_view_options', {**metadata, 'ruler': True}, model, Uno)['ruler'])
        self.assertFalse(review.dispatch('set_chrome', {**metadata, 'menubar': False,
                            'toolbars': False, 'statusbar': False}, model, Uno)['visible'])
        self.assertTrue(model.modified)
        self.assertTrue(model.recording)

    def test_view_options_strict_boolean_and_unknown_rejected_before_writes(self):
        for options in [{'ruler':1},{'formattingMarks':'true'},{'unknown':True}]:
            model=ViewModel()
            with self.assertRaises(ValueError): toolbar.set_view_options(model,options)
            self.assertEqual(model.writes,[])
    def test_view_options_preserve_dirty_tracking_and_setmodified_enablement(self):
        model=ViewModel()
        result=toolbar.set_view_options(model,{'ruler':True,'formattingMarks':True,'spaces':False})
        self.assertTrue(result['ruler']); self.assertTrue(result['verticalRuler']); self.assertFalse(result['spaces'])
        self.assertTrue(model.modified); self.assertTrue(model.recording); self.assertTrue(model.enabled)
        self.assertEqual(model.events,['disable','enable'])
    def test_missing_property_prevents_partial_mutation(self):
        model=ViewModel(); model.props['ShowSpaces']=None
        with self.assertRaisesRegex(RuntimeError,'unavailable'): toolbar.set_view_options(model,{'ruler':True,'spaces':True})
        self.assertEqual(model.writes,[])
    def test_failed_readback_restores_setmodified_enablement(self):
        model=ViewModel(); model.reject='ShowSpaces'
        with self.assertRaisesRegex(RuntimeError,'not applied'): toolbar.set_view_options(model,{'spaces':True})
        self.assertTrue(model.enabled); self.assertTrue(model.modified)
    def test_view_does_not_enable_previously_disabled_setmodified(self):
        model=ViewModel(); model.enabled=False
        toolbar.set_view_options(model,{'spaces':True})
        self.assertFalse(model.enabled); self.assertEqual(model.events,[])
    def test_match_options_reads_all_ruler_properties_without_writing(self):
        model=ViewModel()
        result=toolbar.match_view_options(model, {'ruler':False,'formattingMarks':False})
        self.assertTrue(result['matches']); self.assertEqual(result['view']['zoom'],100)
        self.assertEqual(model.writes,[]); self.assertEqual(model.events,[])
        for prop in ['ShowRulers','ShowVertRuler','ShowHoriRuler']:
            model.props[prop]=True
            self.assertFalse(toolbar.match_view_options(model,{'ruler':False})['matches'],prop)
            model.props[prop]=False
        self.assertTrue(model.modified); self.assertTrue(model.recording)
    def test_matching_options_setter_is_a_true_noop(self):
        model=ViewModel()
        toolbar.set_view_options(model,{'ruler':False,'spaces':False})
        self.assertEqual(model.writes,[]); self.assertEqual(model.events,[])
        toolbar.set_view_options(model,{'ruler':True,'spaces':False})
        self.assertEqual({name for name,_ in model.writes},{'ShowHoriRuler','ShowRulers','ShowVertRuler'})
    def test_match_options_rejects_bad_values_and_strips_only_native_metadata(self):
        import native_review_uno as review
        model=ViewModel()
        for params in [None,[],True,{'ruler':1},{'zoom':100},{'verticalRuler':True}]:
            with self.assertRaises(ValueError): toolbar.match_view_options(model,params)
        self.assertTrue(review.dispatch('match_view_options',{'ruler':False,'documentUrl':'file:///owned.docx',
            'nativeReadOnly':True,'nativeDocumentEpoch':7,'nativeRevision':1,'nativePermissionSeq':0},model,Uno)['matches'])
        self.assertEqual(model.writes,[]); self.assertEqual(model.events,[])
    def test_zoom_is_actual_typed_readback_and_clamped(self):
        model=ViewModel()
        uno=SimpleNamespace(invoke=Uno.invoke,Any=Uno.Any,getConstantByName=lambda _:3)
        self.assertEqual(toolbar.set_zoom(model,{'value':250.5},uno)['zoom'],251)
        self.assertEqual(toolbar.set_zoom(model,{'delta':1000},uno)['zoom'],600)
        self.assertEqual(toolbar.set_zoom(model,{'value':1},uno)['zoom'],20)
        self.assertTrue(model.modified); self.assertTrue(model.recording)
        self.assertEqual(model.writes[0],('ZoomType',3))
    def test_bad_zoom_does_not_write(self):
        for options in [{'value':True},{'delta':float('nan')},{'value':100,'delta':5}]:
            model=ViewModel()
            with self.assertRaises(ValueError): toolbar.set_zoom(model,options,Uno)
            self.assertEqual(model.writes,[])
    def test_chrome_hide_is_verified_and_complete_window_show_is_not_faked(self):
        model=ViewModel()
        self.assertFalse(toolbar.set_chrome(model,{'menubar':False,'toolbars':False,'statusbar':False})['visible'])
        self.assertTrue(model.modified); self.assertTrue(model.enabled)
        with self.assertRaises(ValueError): toolbar.set_chrome(model,{'all':True})


if __name__ == '__main__':
    unittest.main()
