// Local report operations. Invocation belongs to one already-confirmed DSH report job.
import {readFileSync,readdirSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {dirname,basename,join,relative} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WorkbenchStore} from './workbench.js';
import {publish} from './store.js';
import {captureTemplateSource,readTemplateSource} from './template-source.js';
import {hash,safeFile} from './results.js';
const command=process.argv[2],options={};
for(let i=3;i<process.argv.length;i+=2){if(!['--job','--reason','--content'].includes(process.argv[i])||!process.argv[i+1])throw Error('INVALID_ARGUMENT');options[process.argv[i].slice(2)]=process.argv[i+1];}
try{
 const dir=dirname(options.job),caseDir=dirname(dirname(dir)),caseId=basename(caseDir),requestId=basename(dir),store=new WorkbenchStore(dirname(caseDir));
 if(options.job!==join(store.dir(caseId),'reports',requestId,'job.json'))throw Error('INVALID_JOB_PATH');
 const job=store.reports.job(caseId,requestId),nativePdf=job.template.format==='pdf';
 const pdfOperation=args=>{const r=spawnSync(store.assets.python(),[fileURLToPath(new URL('./report-pdf.py',import.meta.url))],{input:JSON.stringify(args),encoding:'utf8',timeout:30000,maxBuffer:2_000_000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});let data;try{data=JSON.parse(r.stdout);}catch{throw Error('NATIVE_PDF_OPERATION_UNAVAILABLE');}if(r.error||r.status!==0){const e=Error('NATIVE_PDF_OPERATION_FAILED');e.details=data.error;throw e;}return data;};
 if(command==='summary'){
  console.log(JSON.stringify(store.reports.summary(caseId,requestId)));
 }else if(command==='verify-template'){
  if(store.reports.status(caseId,requestId).phase==='ready')throw Error('REPORT_ALREADY_FINALIZED');
  console.log(JSON.stringify(await captureTemplateSource(job,dir)));
 }else if(command==='compose'){
  if(store.reports.status(caseId,requestId).phase==='ready')throw Error('REPORT_ALREADY_FINALIZED');
  const content=safeFile(dir,options.content,8_000_000);
  readTemplateSource(job,dir,JSON.parse(readFileSync(content)).templateVerification||{});
  if(nativePdf)pdfOperation({mode:'inspect',document:job.templatePath});
  if(job.templatePath&&!nativePdf){const preflight=spawnSync(store.assets.python(),[fileURLToPath(new URL('./report-check.py',import.meta.url))],{input:JSON.stringify({mode:'preflight',document:job.templatePath}),encoding:'utf8',timeout:15000,maxBuffer:50000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});if(preflight.status!==0||JSON.parse(preflight.stdout).errors?.length)throw Error('TEMPLATE_PREFLIGHT_FAILED');}
  const result=spawnSync(store.assets.python(),[fileURLToPath(new URL('./report-compose.py',import.meta.url))],{input:JSON.stringify({job,content,out:dir}),encoding:'utf8',timeout:30000,maxBuffer:50000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});let response;try{response=JSON.parse(result.stdout);}catch{throw Error('REPORT_COMPOSER_UNAVAILABLE');}if(result.error||result.status!==0){const e=Error('REPORT_COMPOSITION_FAILED');e.details=response.error;throw e;}store.reports.save(caseId,requestId,{phase:'composed',basisDigest:job.basisDigest});console.log(JSON.stringify(response));
 }else if(command==='outline'){
  const fields=job.fieldMap?JSON.parse(readFileSync(safeFile(caseDir,job.fieldMap))).fields:[];
  const a=JSON.parse(readFileSync(safeFile(caseDir,job.files.assessment.path)));
  const choicesRun=job.fieldMap?spawnSync(store.assets.python(),[fileURLToPath(new URL('./report-compose.py',import.meta.url))],{input:JSON.stringify({mode:'choices',job}),encoding:'utf8',timeout:15000,maxBuffer:200000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}):null;
  if(choicesRun&&(choicesRun.error||choicesRun.status!==0))throw Error('TEMPLATE_CHOICES_UNAVAILABLE');const choices=choicesRun?JSON.parse(choicesRun.stdout):{};
  console.log(JSON.stringify({basisDigest:job.basisDigest,choices,...(nativePdf?{nativePdf:pdfOperation({mode:'inspect',document:job.templatePath}),pdfPages:[]}:{}),templateVerification:{publisher:job.template.title.split(' ')[0],url:job.template.url||'',checkedAt:null,sourceSha256:null,status:null,language:job.language,originalLanguage:job.template.language==='user_selected'?null:job.template.language,scopeReason:null,originalSha256:job.templateSha256,evidence:null},fields:fields.map(f=>({key:f.key,label:f.label,status:null,text:null,rationale:null,factIds:[],ruleIds:[],sourceIds:[],question:null,impact:null,recommendation:null})),dimensions:a.rule_assessments.filter(r=>r.rule_id.startsWith('EU-C')).map(r=>({ruleId:r.rule_id,status:null,reason:null,text:null})),risks:a.risks.map(r=>({id:r.id,text:null})),actions:a.actions.map(a=>({id:a.id,text:null})),contentReview:{status:'pending',notes:null}},null,2));
 }else if(command==='fail'){
  if(!options.reason?.trim())throw Error('FAILURE_REASON_REQUIRED');
  if(store.reports.status(caseId,requestId).phase==='ready')throw Error('REPORT_ALREADY_FINALIZED');
  console.log(JSON.stringify(store.reports.save(caseId,requestId,{phase:'failed',basisDigest:job.basisDigest,reason:options.reason.slice(0,2000)})));
 }else if(command==='render'){
  if(store.reports.status(caseId,requestId).phase==='ready')throw Error('REPORT_ALREADY_FINALIZED');
  readTemplateSource(job,dir,JSON.parse(readFileSync(safeFile(dir,'field-review.json'))).templateVerification||{});
  const document=safeFile(caseDir,join(dir,'report.docx'),25_000_000),digest=hash(readFileSync(document)),root=join(dir,'render');
  if(existsSync(root))throw Error('RENDER_OUTPUT_EXISTS_USE_NEW_ATTEMPT');
  const preflight=spawnSync(store.assets.python(),[fileURLToPath(new URL('./report-check.py',import.meta.url))],{input:JSON.stringify({mode:'preflight',document}),encoding:'utf8',timeout:15000,maxBuffer:50000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});let inspected;try{inspected=JSON.parse(preflight.stdout);}catch{throw Error('REPORT_PREFLIGHT_FAILED');}if(preflight.error||preflight.status!==0||inspected.errors?.length)throw Error('REPORT_PREFLIGHT_FAILED');
  store.reports.save(caseId,requestId,{phase:'rendering',basisDigest:job.basisDigest,documentSha256:digest});
  const renderer=process.env.DSH_DPIA_RENDERER||join(homedir(),'.local/bin/codex-render-docx');
  const wordRoot=nativePdf?join(dir,'word-render'):root;
  if(nativePdf&&existsSync(wordRoot))throw Error('RENDER_OUTPUT_EXISTS_USE_NEW_ATTEMPT');
  // AI WorkDeck: use the configured product Python for the shipped renderer (also on Windows).
  const r=spawnSync(process.env.AWD_DPIA_PYTHON_RENDERER?store.assets.python():renderer,[...(process.env.AWD_DPIA_PYTHON_RENDERER?[renderer]:[]),document,'--output_dir',wordRoot,'--emit_pdf'],{encoding:'utf8',timeout:240000,maxBuffer:1_000_000});
  if(r.error||r.status!==0){store.reports.save(caseId,requestId,{phase:'render_failed',reason:(r.stderr||r.error?.message||'Renderer failed').slice(-2000)});throw Error('DOCUMENT_RENDER_FAILED');}
  if(hash(readFileSync(document))!==digest)throw Error('REPORT_CHANGED_DURING_RENDER');
  let nativeReceipt={};
  if(nativePdf){
   safeFile(caseDir,join(dir,'native-report.pdf'),50_000_000);safeFile(caseDir,join(dir,'pdf-bindings.json'));mkdirSync(root,{mode:0o700});
   pdfOperation({mode:'merge',job,out:dir,appendix:safeFile(caseDir,join(wordRoot,'report.pdf'),50_000_000),destination:join(root,'report.pdf')});
   const poppler=process.env.DSH_DPIA_PDFTOPPM||join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm');
   const fontConfig=join(homedir(),'.config/codex-docs/fontconfig-macos-cjk.conf'),pdfEnvironment={...process.env};if(!pdfEnvironment.FONTCONFIG_FILE&&existsSync(fontConfig)){pdfEnvironment.FONTCONFIG_FILE=fontConfig;pdfEnvironment.FONTCONFIG_PATH=dirname(fontConfig);}
   // AI WorkDeck's PDFium wrapper implements only this fixed page-rendering command.
   const rendered=spawnSync(process.env.AWD_DPIA_PYTHON_RENDERER?store.assets.python():poppler,[...(process.env.AWD_DPIA_PYTHON_RENDERER?[poppler]:[]),'-r','120','-png',join(root,'report.pdf'),join(root,'page')],{encoding:'utf8',timeout:240000,maxBuffer:100000,env:pdfEnvironment});
   if(rendered.error||rendered.status!==0){store.reports.save(caseId,requestId,{phase:'render_failed',reason:(rendered.stderr||rendered.error?.message||'PDF rendering failed').slice(-2000)});throw Error('NATIVE_PDF_RENDER_FAILED');}
   for(const name of readdirSync(root).filter(n=>/^page-\d+\.png$/.test(n))){const canonical='page-'+parseInt(name.slice(5))+'.png';if(name!==canonical){if(existsSync(join(root,canonical)))throw Error('DUPLICATE_PDF_PAGE');renameSync(join(root,name),join(root,canonical));}}
   nativeReceipt={nativePdfSha256:hash(readFileSync(safeFile(caseDir,join(dir,'native-report.pdf'),50_000_000))),pdfBindingsSha256:hash(readFileSync(safeFile(caseDir,join(dir,'pdf-bindings.json'))))};
  }
  const pages=readdirSync(root).filter(n=>/^page-\d+\.png$/.test(n)).sort((a,b)=>parseInt(a.slice(5))-parseInt(b.slice(5))),pdf=safeFile(caseDir,join(root,'report.pdf'),50_000_000);
  const count=spawnSync(store.assets.python(),[fileURLToPath(new URL('./report-check.py',import.meta.url))],{input:JSON.stringify({mode:'pdfPages',document:pdf}),encoding:'utf8',timeout:15000,maxBuffer:5000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  let pageCount;try{pageCount=JSON.parse(count.stdout).pages;}catch{throw Error('PDF_PAGE_COUNT_UNAVAILABLE');}
  if(count.error||count.status!==0||!pageCount||pageCount!==pages.length)throw Error('REPORT_PAGE_COUNT_MISMATCH');
  const receipt={...nativeReceipt,schema:'dpia-report-render/v1',basisDigest:job.basisDigest,documentSha256:digest,pdf:{path:relative(caseDir,pdf),sha256:hash(readFileSync(pdf))},pageCount,pages:pages.map(n=>({file:'render/'+n,sha256:hash(readFileSync(safeFile(caseDir,join(root,n),30_000_000)))})),renderedAt:new Date().toISOString()};
  publish(join(dir,'render-receipt.json'),JSON.stringify(receipt,null,2)+'\n');store.reports.save(caseId,requestId,{phase:'awaiting_page_review',basisDigest:job.basisDigest,pageCount});console.log(JSON.stringify({...receipt,summary:store.reports.summary(caseId,requestId)}));
 }else if(command==='complete'){const completed=store.reports.complete(caseId,requestId);console.log(JSON.stringify({...completed,summary:store.reports.summary(caseId,requestId)}));}
 else throw Error('UNKNOWN_REPORT_COMMAND');
}catch(e){console.error(JSON.stringify({error:e.message,details:e.details}));process.exitCode=1;}
