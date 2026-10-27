"""Small native-PDF contract group. Synthetic engineering files, not business reports."""
import importlib.util, json, os, subprocess, tempfile, unittest
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject
from reportlab.pdfgen import canvas

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('report_pdf',ROOT/'report-pdf.py')
pdf=importlib.util.module_from_spec(spec);spec.loader.exec_module(pdf)


class NativePdf(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dpia-pdf-');self.addCleanup(self.temp.cleanup)
        self.dir=Path(self.temp.name);self.original=self.dir/'source.pdf'
        c=canvas.Canvas(str(self.original),pagesize=(595,842))
        c.setFont('Helvetica',14);c.drawString(45,790,'SYNTHETIC - native PDF engineering fixture')
        c.setFont('Helvetica',11);c.drawString(45,738,'Controller:')
        c.acroForm.textfield(name='controller',x=45,y=700,width=400,height=25,value='')
        c.drawString(45,650,'Retention (unknown):')
        c.acroForm.textfield(name='retention',x=45,y=615,width=400,height=25,value='')
        c.drawString(75,558,'Review recorded (synthetic)')
        c.acroForm.checkbox(name='review',x=45,y=550,checked=False)
        c.showPage();c.setFont('Helvetica',14);c.drawString(45,790,'SYNTHETIC - original non-fillable page')
        c.setFont('Helvetica',11);c.drawString(45,730,'Purpose:')
        c.rect(45,635,500,80);c.drawString(45,585,'Unresolved question:');c.rect(45,515,500,55)
        c.save()
        self.job={'templatePath':str(self.original),'templateSha256':pdf.sha(self.original),'basisDigest':'fixture-basis','language':'en','reportType':'draft'}
        info=pdf.inspect(PdfReader(self.original));self.widgets={w['name']:w for w in info['widgets']}
        def field(key,text='',status='answered'):
            w=self.widgets.get(key);loc={'page':w['page'],'rect':w['rect'],'fieldName':key} if w else {'page':1,'rect':[45,635,545,715] if key=='purpose' else [45,515,545,570]}
            return {'key':key,'location':loc,'status':status,'text':text,'rationale':'Synthetic mapping check','question':'What is the actual policy?','impact':'Needed to assess this field.','recommendation':'Supply the actual record.'}
        self.content={'basisDigest':'fixture-basis','templateVerification':{'originalLanguage':'en'},'fields':[field('controller','Synthetic Controller Ltd'),field('retention',status='unknown'),field('review','/Yes'),field('purpose','Synthetic engineering purpose. No business conclusion.'),field('missing',status='unknown')],'pdfPages':[{'page':0,'kind':'fields','fieldKeys':['controller','retention','review'],'reason':'All interactive fields mapped'},{'page':1,'kind':'fields','fieldKeys':['purpose','missing'],'reason':'Both static answer areas mapped'}]}

    def test_unicode_static_answers_embed_a_font(self):
        self.content['fields'][3]['text'] = '中文评估范围：保留未知，不自动确认。'
        pdf.fill(self.job,self.content,self.dir)
        page=PdfReader(self.dir/'native-report.pdf').pages[1]
        self.assertIn('中文评估范围', page.extract_text())
        fonts=[x.get_object() for x in page['/Resources']['/Font'].values()]
        self.assertTrue(any('/FontDescriptor' in f and '/FontFile2' in f['/FontDescriptor'] for f in fonts))

    def test_preserves_native_pages_forms_unknown_comments_and_merge(self):
        digest=pdf.sha(self.original);result=pdf.fill(self.job,self.content,self.dir)
        self.assertEqual(result['interactiveFields'],3)
        self.assertEqual(pdf.check(self.job,self.dir)['errors'],[])
        reader=PdfReader(self.dir/'native-report.pdf')
        self.assertEqual(reader.get_fields()['controller']['/V'],'Synthetic Controller Ltd')
        self.assertEqual(reader.get_fields()['retention']['/V'],'')
        self.assertEqual(reader.get_fields()['review']['/V'],'/Yes')
        self.assertEqual(pdf.sha(self.original),digest)
        self.assertEqual(len(reader.pages),2)
        self.assertEqual(len([a for p in reader.pages for a in p.get('/Annots',[]) if a.get_object().get('/Subtype')=='/Text']),2)
        appendix=self.dir/'appendix.pdf';c=canvas.Canvas(str(appendix));c.drawString(40,740,'SYNTHETIC converted working-copy appendix');c.save()
        r=subprocess.run([os.sys.executable,str(ROOT/'report-pdf.py')],input=json.dumps({'mode':'merge','job':self.job,'out':str(self.dir),'appendix':str(appendix),'destination':str(self.dir/'combined.pdf')}),capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertEqual(len(PdfReader(self.dir/'combined.pdf').pages),3)

    def test_rejects_omitted_fields_overflow_wrong_language_and_stale_values(self):
        self.content['fields'][3]['text']='Long text '*1000
        with self.assertRaisesRegex(ValueError,'exceeds'):pdf.fill(self.job,self.content,self.dir)
        self.assertFalse((self.dir/'native-report.pdf').exists())
        self.content['fields'][3]['text']='Synthetic purpose.'
        self.content['fields'].pop(2);self.content['pdfPages'][0]['fieldKeys'].remove('review')
        with self.assertRaisesRegex(ValueError,'omitted'):pdf.fill(self.job,self.content,self.dir)
        self.content['templateVerification']['originalLanguage']='zh-CN'
        with self.assertRaisesRegex(ValueError,'source language'):pdf.fill(self.job,self.content,self.dir)
        with self.assertRaisesRegex(ValueError,'Canonical'):pdf.verify_values(PdfReader(self.original),{'controller':'Invented value'})

    def test_ambiguous_field_objects_are_blocked_but_true_orphans_recover(self):
        reader=PdfReader(self.original);writer=PdfWriter();writer.clone_document_from_reader(reader)
        form=writer.root_object['/AcroForm'];old=form['/Fields'][0].get_object()
        duplicate=DictionaryObject({NameObject('/T'):TextStringObject('controller'),NameObject('/FT'):NameObject('/Tx'),NameObject('/V'):TextStringObject('stale')})
        form['/Fields'][0]=writer._add_object(duplicate)
        ambiguous=self.dir/'ambiguous.pdf'
        with ambiguous.open('wb') as f:writer.write(f)
        with self.assertRaisesRegex(ValueError,'conflicts'):pdf.inspect(PdfReader(ambiguous))
        # An actual orphan has no canonical same-name object and no Parent.
        writer=PdfWriter();writer.clone_document_from_reader(reader);del writer.root_object['/AcroForm']['/Fields'][0]
        orphan=self.dir/'orphan.pdf'
        with orphan.open('wb') as f:writer.write(f)
        self.assertEqual(pdf.inspect(PdfReader(orphan))['orphans'],['controller'])
        self.job.update(templatePath=str(orphan),templateSha256=pdf.sha(orphan))
        pdf.fill(self.job,self.content,self.dir)
        self.assertEqual(pdf.check(self.job,self.dir)['errors'],[])


if __name__=='__main__':unittest.main()
