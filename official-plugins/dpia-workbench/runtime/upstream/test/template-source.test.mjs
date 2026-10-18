import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureTemplateSource,readTemplateSource,validateTemplateSource,SOURCE_BODY,SOURCE_RECEIPT} from '../template-source.js';
import {resumeReportFiles} from '../report-resume.js';
import {skillDir} from '../store.js';
import {hash} from '../results.js';
const template=JSON.parse(readFileSync(join(skillDir,'assets/official-template-catalog.json'))).templates.find(t=>t.id==='edpb-2026-v1');
function fixture(t){const root=realpathSync(mkdtempSync(join(tmpdir(),'dpia-source-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const job={requestId:'dpia-source-test',templateId:template.id,template:{official:true,url:template.landing_url},templateSha256:template.sha256,basisDigest:'synthetic-basis',createdAt:'2026-01-01T00:00:00Z',files:{assessment:{sha256:'synthetic-assessment'}}};return {root,job};}
const response=()=>new Response('<html>SYNTHETIC transport test only; not a real source review.</html>',{headers:{'content-type':'text/html; charset=utf-8'}});
const verification=r=>({checkedAt:r.retrievedAt,sourceSha256:r.bodySha256,url:r.url,originalSha256:r.templateSha256});
test('DPIAP-009: actual fetch bytes are bound to the job; repeated invocation reuses unchanged evidence',async t=>{
 const {root,job}=fixture(t);let calls=0;
 const receipt=await captureTemplateSource(job,root,async (url,options)=>{calls++;assert.equal(url,template.landing_url);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');return response();});
 assert.equal(calls,1);assert.deepEqual(readTemplateSource(job,root,verification(receipt)),receipt);
 assert.deepEqual(await captureTemplateSource(job,root,()=>{throw Error('unexpected refetch');}),receipt);
 assert.equal(receipt.bodySha256,hash(readFileSync(join(root,SOURCE_BODY))));
});
test('DPIAP-009: missing, foreign, stale, altered and model-redated evidence fails closed',async t=>{
 const {root,job}=fixture(t);assert.throws(()=>readTemplateSource(job,root),/RECEIPT_MISSING/);
 const r=await captureTemplateSource(job,root,async()=>response()),body=readFileSync(join(root,SOURCE_BODY));
 for(const patch of [{requestId:'old-job'},{basisDigest:'other'},{retrievedAt:'2025-01-01T00:00:00Z'},{templateSha256:'old'},{finalUrl:'http://localhost/'},{finalUrl:null}])assert.throws(()=>validateTemplateSource(job,{...r,...patch},body));
 assert.throws(()=>validateTemplateSource(job,r,Buffer.from('changed')),/RECEIPT_INVALID/);
 assert.throws(()=>readTemplateSource(job,root,{...verification(r),checkedAt:'2099-01-01T00:00:00Z'}),/REVIEW_MISMATCH/);
 assert.throws(()=>readTemplateSource(job,root,{}),/REVIEW_MISMATCH/);
 assert.equal(readTemplateSource({...job,template:{official:false}},root),null);
});
test('DPIAP-009: only registered HTTPS sources and bounded HTML responses can create a receipt',async t=>{
 const {root,job}=fixture(t);
 const attempts=[async()=>new Response('',{status:302,headers:{location:'https://untrusted.example/'}}),async()=>new Response('blocked',{status:403}),async()=>new Response('json',{headers:{'content-type':'application/json'}}),async()=>new Response('large',{headers:{'content-type':'text/html','content-length':'2000001'}}),async()=>{throw Error('offline');},async()=>new Response('x'.repeat(2000001),{headers:{'content-type':'text/html'}})];
 for(const fetcher of attempts){await assert.rejects(captureTemplateSource(job,root,fetcher));assert.equal(existsSync(join(root,SOURCE_RECEIPT)),false);}
 await assert.rejects(captureTemplateSource({...job,template:{official:true,url:'https://localhost/'}},root,()=>{throw Error('must not fetch');}),/NOT_REGISTERED/);
 let calls=0;const r=await captureTemplateSource(job,root,async()=>++calls===1?new Response('',{status:302,headers:{location:'/source-test'}}):response());assert.equal(new URL(r.finalUrl).pathname,'/source-test');assert.equal(calls,2);
});
test('DPIAP-009: interrupted publication can recover matching bytes but cannot overwrite a different source',async t=>{
 const {root,job}=fixture(t);writeFileSync(join(root,SOURCE_BODY),'different');
 await assert.rejects(captureTemplateSource(job,root,async()=>response()),/PARTIAL_CAPTURE_RETRY_JOB/);assert.equal(existsSync(join(root,SOURCE_RECEIPT)),false);
 writeFileSync(join(root,SOURCE_BODY),Buffer.from(await response().arrayBuffer()));await captureTemplateSource(job,root,async()=>response());assert.ok(readTemplateSource(job,root));
});
test('DPIAP-009: official retry reuses bound source evidence; legacy or tampered provenance regenerates before rendering',async t=>{
 const {root,job}=fixture(t),previous=join(root,'reports',job.requestId);mkdirSync(previous,{recursive:true});
 writeFileSync(join(previous,'report.docx'),'synthetic document');writeFileSync(join(previous,'bindings.json'),JSON.stringify({docx_sha256:hash('synthetic document'),assessment_sha256:job.files.assessment.sha256}));
 writeFileSync(join(previous,'field-review.json'),JSON.stringify({basisDigest:job.basisDigest,templateVerification:{checkedAt:new Date().toISOString()}}));
 const bad=join(root,'bad');mkdirSync(bad);assert.equal(resumeReportFiles(root,job,bad).stage,'compose');assert.equal(existsSync(join(bad,'report.docx')),false);
 const r=await captureTemplateSource(job,previous,async()=>response());writeFileSync(join(previous,'field-review.json'),JSON.stringify({basisDigest:job.basisDigest,templateVerification:verification(r)}));
 const next=join(root,'next');mkdirSync(next);const resumed=resumeReportFiles(root,job,next);assert.equal(resumed.stage,'render');assert.ok(resumed.reused.includes(SOURCE_RECEIPT));
 assert.ok(readTemplateSource({...job,requestId:'new-job',templateSourceRequestId:job.requestId},next,verification(r)));
 writeFileSync(join(previous,SOURCE_BODY),'tampered');const damaged=join(root,'damaged');mkdirSync(damaged);assert.equal(resumeReportFiles(root,job,damaged).stage,'compose');
});
