// Explicit local artifact publication; this command never submits a model request.
import {readFileSync,readdirSync,renameSync} from 'node:fs';
import {dirname,join,basename} from 'node:path';
import {WorkbenchStore} from './workbench.js';
import {publish,readJson} from './store.js';
import {hash,safeFile} from './results.js';
import {validateAnswerReviews} from './answers.js';
const options={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,'');if(!['job','assessment','sourceIndex','intake','report','audit','answerReviews'].includes(k)||!process.argv[i+1])throw Error('INVALID_ARGUMENT');options[k]=process.argv[i+1];}
try{
 const dir=dirname(options.job),root=dirname(dirname(dir)),caseId=basename(root),store=new WorkbenchStore(dirname(root));
 if(options.job!==join(store.dir(caseId),'runs',basename(dir),'job.json'))throw Error('INVALID_JOB_PATH');
 const job=readJson(safeFile(root,options.job)),files={};
 for(const k of ['assessment','sourceIndex','intake','report','audit'])if(options[k]){
  const path=safeFile(dir,options[k]);files[k]={path:`runs/${job.requestId}/${basename(path)}`,sha256:hash(readFileSync(path))};
  if(dirname(path)!==dir)throw Error('INVALID_OUTPUT_LOCATION');
 }
 if(job.contextPath&&hash(readFileSync(safeFile(root,job.contextPath)))!==job.inputDigest)throw Error('INPUT_DIGEST_MISMATCH');
 const names=readdirSync(root).filter(n=>/^execution-\d{6}\.json$/.test(n)).sort(),execution=names.length?readJson(safeFile(root,names.at(-1))):null;
 if(execution?.requestId!==job.requestId||execution.jobSha256!==hash(readFileSync(safeFile(root,options.job)))||['cancelled','cancel_requested'].includes(execution.phase))throw Error('LATE_OR_CHANGED_JOB');
 const checked=store.results.verify(caseId,files,{parentRevisionId:job.parentRevisionId});
 const answerReviews=validateAnswerReviews(job,checked.data,options.answerReviews?readJson(safeFile(dir,options.answerReviews)):[]);
 const manifest={...job,answerReviews,schema:'dpia-result/v1',revisionId:checked.data.assessment.meta.revision_id,files};
 const out=join(dir,'result.json'),value=JSON.stringify(manifest,null,2)+'\n';
 try{publish(out,value);}catch(e){
  if(e.code!=='EEXIST')throw e;const previous=readFileSync(safeFile(dir,'result.json'),'utf8');
  if(previous!==value){
   if(execution.repairOf!==job.requestId||store.results.latest(caseId)?.requestId===job.requestId)throw Error('RESULT_ALREADY_PUBLISHED');
   const backup=join(dir,'rejected-result-'+hash(previous)+'.json');try{publish(backup,previous);}catch(e){if(e.code!=='EEXIST'||readFileSync(safeFile(dir,backup),'utf8')!==previous)throw e;}
   const staged=join(dir,'repaired-result-'+hash(value)+'.json');try{publish(staged,value);}catch(e){if(e.code!=='EEXIST'||readFileSync(safeFile(dir,staged),'utf8')!==value)throw e;}renameSync(staged,out);
  }
 }
 process.stdout.write(JSON.stringify({published:out,revisionId:manifest.revisionId,warnings:checked.validation.warnings})+'\n');
}catch(e){process.stderr.write(JSON.stringify({error:e.message,details:e.details})+'\n');process.exitCode=1;}
