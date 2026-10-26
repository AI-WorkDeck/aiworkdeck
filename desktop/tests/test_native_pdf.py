# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""PDF preserves the current Writer projection and never takes source ownership."""
from pathlib import Path
from types import SimpleNamespace
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'main' / 'native'
sys.path.insert(0, str(SOURCE))
import native_export_uno as export


class PdfContracts(unittest.TestCase):
    def model(self):
        state = dict(modified=False, tracking=True, display=2, margin=False, url='file:///source.docx')
        manager = SimpleNamespace(getAllUndoActionTitles=lambda: ['prior'], getAllRedoActionTitles=lambda: [])
        model = SimpleNamespace(supportsService=lambda name: name == 'com.sun.star.text.TextDocument',
            getUndoManager=lambda: manager, getURL=lambda: state['url'], isModified=lambda: state['modified'],
            isSetModifiedEnabled=lambda: True, isReadonly=lambda: True,
            getPropertyValue=lambda name: state[{'RecordChanges':'tracking','RedlineDisplayType':'display'}[name]],
            setModified=lambda value: state.__setitem__('modified', value),
            getCurrentController=lambda: SimpleNamespace(getViewSettings=lambda: SimpleNamespace(
                getPropertyValue=lambda name: state['margin'])))
        uno = SimpleNamespace(createUnoStruct=lambda name: SimpleNamespace(), systemPathToFileUrl=lambda path: 'file://' + path)
        return model, state, uno

    def test_readonly_export_restores_dirty_and_uses_copy_filter_in_current_view(self):
        model, state, uno = self.model()
        def store(url, properties):
            self.assertEqual(url, 'file:///owned/export.pdf')
            self.assertEqual({p.Name:p.Value for p in properties}, {'FilterName':'writer_pdf_Export','Overwrite':True})
            self.assertEqual((state['display'], state['tracking']), (2, True))
            state['modified'] = True
        model.storeToURL = store
        self.assertEqual(export.export_pdf(model, uno, '/owned/export.pdf'), {'success':True})
        self.assertFalse(state['modified'])
        self.assertEqual(state['url'], 'file:///source.docx')

    def test_store_failure_restores_dirty_and_preserves_original_failure(self):
        model, state, uno = self.model()
        state['modified'] = True
        def fail(*unused):
            state['modified'] = False
            raise RuntimeError('controlled export failure')
        model.storeToURL = fail
        with self.assertRaisesRegex(RuntimeError, '^controlled export failure$'):
            export.export_pdf(model, uno, '/owned/export.pdf')
        self.assertTrue(state['modified'])

    def test_unexpected_ownership_or_tracking_change_is_unknown(self):
        for key, value in [('url','file:///wrong.pdf'), ('tracking',False), ('display',0)]:
            model, state, uno = self.model()
            model.storeToURL = lambda *unused: state.__setitem__(key,value)
            with self.assertRaisesRegex(RuntimeError, 'PDF_EXPORT_OUTCOME_UNKNOWN'):
                export.export_pdf(model, uno, '/owned/export.pdf')


SCENARIO = r'''
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const source=process.env.AWD_NATIVE_EDIT_SOURCE;
const {NativeEditorSession}=require(source+'/editor-session'),{createProcessChannel}=require(source+'/process-channel');
(async()=>{const root=process.env.AWD_NATIVE_EDIT_RUN,config=JSON.parse(await fs.readFile(process.env.AWD_NATIVE_EDIT_CONFIG));
const make=(name,readOnly)=>new NativeEditorSession({config,run:root+'/'+name,readOnly,channel:args=>{if(!args.framed)args.args[1]=process.env.AWD_NATIVE_EDIT_TEST;return createProcessChannel(args)}}),a=make('readonly',true),b=make('dirty',false),result={checks:[],root};
const save=async(s,name)=>{const before=await s.unoCall('test_state'),revision=s.revision;const value=await s.execute('export_pdf',{nativeOutputPath:'/untrusted/path.pdf'});assert.equal(value.success,true);assert.equal(value.size,value.bytes.length);assert.equal(Buffer.from(value.bytes).subarray(0,5).toString(),'%PDF-');assert.deepEqual(await s.unoCall('test_state'),before);await fs.writeFile(root+'/'+name+'.pdf',value.bytes);result.checks.push(name+' preserves content, view, tracking, authors, undo, dirty state');};
try{
 const bytes=new Uint8Array(await fs.readFile(process.env.AWD_NATIVE_EDIT_FIXTURE));await a.execute('load_document',{bytes,name:'readonly.docx',authorName:'只读'});await save(a,'readonly-all');await a.execute('set_revision_view',{mode:'final'});await save(a,'readonly-final');
 await b.execute('load_document',{bytes,name:'dirty.docx',authorName:'本人'});await b.execute('modify_paragraph',{index:0,newText:'已经修改的验收标题',__agent:true});assert.equal((await b.unoCall('test_state')).modified,true);await save(b,'dirty-all');
}catch(error){result.error=error.stack;process.exitCode=1}finally{await a.close();await b.close();result.exits=[a,b].map(s=>({engine:s.engine?.process.exitCode,uno:s.uno?.process.exitCode}));await fs.writeFile(root+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})();
'''


@unittest.skipUnless(os.environ.get('AWD_NATIVE_EDIT_CONFIG'), 'isolated runtime explicitly required')
class NativePdfRoundtrip(unittest.TestCase):
    def test_visible_all_final_readonly_and_dirty_exports(self):
        from test_native_document_edit import fixture
        if not shutil.which('pdftotext'):
            self.skipTest('pdftotext is required to independently verify visible PDF text')
        artifacts = Path(os.environ['AWD_NATIVE_EDIT_ARTIFACTS'])
        artifacts.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='pdf-', dir=artifacts))
        fixture(run / 'synthetic.docx')
        script = run / 'scenario.cjs'; script.write_text(SCENARIO)
        env = {**os.environ, 'AWD_NATIVE_EDIT_SOURCE': str(SOURCE), 'AWD_NATIVE_EDIT_RUN': str(run),
               'AWD_NATIVE_EDIT_TEST': str(Path(__file__).resolve()), 'AWD_NATIVE_EDIT_FIXTURE': str(run / 'synthetic.docx')}
        with (run / 'scenario.log').open('w') as log:
            child = subprocess.Popen(['node', str(script)], env=env, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            try:
                child.wait(timeout=180)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=5); raise
        self.assertTrue((run / 'result.json').exists(), str(run / 'scenario.log'))
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(child.returncode, 0, result.get('error', str(run)))
        self.assertEqual(result['exits'], [{'engine':0,'uno':0}] * 2)
        texts = {}
        for name in ('readonly-all','readonly-final','dirty-all'):
            subprocess.run(['pdftotext', str(run / (name+'.pdf')), str(run / (name+'.txt'))], check=True)
            texts[name] = ''.join((run / (name+'.txt')).read_text().split())
        self.assertEqual(texts['readonly-all'].count('30日'), 2)
        self.assertEqual(texts['readonly-final'].count('30日'), 1)
        self.assertIn('已经修改的验收标题', texts['dirty-all'])
        print('Native PDF evidence:', run, flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--port':
        from test_native_document_edit import bridge_driver
        bridge_driver(int(sys.argv[2]))
    else:
        unittest.main()
