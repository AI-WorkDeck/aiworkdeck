// Public-source transport evidence, not a legal review or a tamper-proof attestation.
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {publish,skillDir} from './store.js';
import {hash,safeFile} from './results.js';

const MAX_BYTES=2_000_000;
export const SOURCE_RECEIPT='template-source-receipt.json';
export const SOURCE_BODY='template-source.html';
function officialURL(job){
 const catalog=JSON.parse(readFileSync(join(skillDir,'assets/official-template-catalog.json')));
 const template=catalog.templates.find(t=>t.id===job.templateId&&t.native_asset);
 if(!job.template?.official||!template||template.landing_url!==job.template.url||template.sha256!==job.templateSha256)throw Error('TEMPLATE_SOURCE_NOT_REGISTERED');
 const url=new URL(template.landing_url);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('TEMPLATE_SOURCE_UNSAFE_URL');
 return url;
}
function checkedURL(value,source){
 if(typeof value!=='string'||!value)throw Error('TEMPLATE_SOURCE_UNSAFE_REDIRECT');
 const url=new URL(value,source);
 if(url.origin!==source.origin||url.username||url.password)throw Error('TEMPLATE_SOURCE_UNSAFE_REDIRECT');
 return url;
}
export function validateTemplateSource(job,receipt,body,verification){
 if(!job.template?.official)return null;
 const source=officialURL(job),time=Date.parse(receipt?.retrievedAt);
 if(!receipt||receipt.schema!=='dpia-template-source/v1'||receipt.method!=='https-get'||
  receipt.requestId!==(job.templateSourceRequestId||job.requestId)||receipt.basisDigest!==job.basisDigest||
  receipt.templateSha256!==job.templateSha256||receipt.url!==source.href||
  !Number.isFinite(time)||time<Date.parse(job.verificationSince||job.createdAt)||time>Date.now()+60000||
  !body?.length||body.length>MAX_BYTES||receipt.bodySha256!==hash(body))throw Error('TEMPLATE_SOURCE_RECEIPT_INVALID');
 checkedURL(receipt.finalUrl,source);
 if(verification&&(verification.checkedAt!==receipt.retrievedAt||verification.sourceSha256!==receipt.bodySha256||verification.url!==receipt.url||verification.originalSha256!==receipt.templateSha256))throw Error('TEMPLATE_SOURCE_REVIEW_MISMATCH');
 return receipt;
}
export function readTemplateSource(job,dir,verification){
 if(!job.template?.official)return null;
 let receipt,body;
 try{receipt=JSON.parse(readFileSync(safeFile(dir,SOURCE_RECEIPT)));body=readFileSync(safeFile(dir,SOURCE_BODY,MAX_BYTES));}
 catch{throw Error('TEMPLATE_SOURCE_RECEIPT_MISSING');}
 return validateTemplateSource(job,receipt,body,verification);
}
export async function captureTemplateSource(job,dir,fetchImpl=globalThis.fetch){
 if(!job.template?.official)throw Error('TEMPLATE_SOURCE_NOT_REGISTERED');
 // A completed retrieval is reusable only for the same confirmed job/basis.
 if(existsSync(join(dir,SOURCE_RECEIPT)))return readTemplateSource(job,dir);
 const source=officialURL(job),signal=AbortSignal.timeout(15000);
 let url=source,response;
 for(let redirects=0;redirects<=3;redirects++){
  response=await fetchImpl(url.href,{method:'GET',redirect:'manual',signal,credentials:'omit',headers:{Accept:'text/html'}});
  if([301,302,303,307,308].includes(response.status)){
   await response.body?.cancel();
   if(redirects===3||!response.headers.get('location'))throw Error('TEMPLATE_SOURCE_REDIRECT_LIMIT');
   url=checkedURL(new URL(response.headers.get('location'),url).href,source);continue;
  }
  break;
 }
 if(!response.ok||!/^text\/html(?:;|$)/i.test(response.headers.get('content-type')||'')){
  await response.body?.cancel();throw Error('TEMPLATE_SOURCE_FETCH_FAILED');
 }
 if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw Error('TEMPLATE_SOURCE_TOO_LARGE');}
 const chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;if(length>MAX_BYTES)throw Error('TEMPLATE_SOURCE_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 const body=Buffer.concat(chunks);
 const receipt={schema:'dpia-template-source/v1',method:'https-get',requestId:job.templateSourceRequestId||job.requestId,basisDigest:job.basisDigest,templateSha256:job.templateSha256,url:source.href,finalUrl:url.href,retrievedAt:new Date().toISOString(),bodySha256:hash(body)};
 validateTemplateSource(job,receipt,body);
 // Crash after body publication is recoverable only if a subsequent fetch is identical.
 if(existsSync(join(dir,SOURCE_BODY))){if(hash(readFileSync(safeFile(dir,SOURCE_BODY,MAX_BYTES)))!==receipt.bodySha256)throw Error('TEMPLATE_SOURCE_PARTIAL_CAPTURE_RETRY_JOB');}
 else publish(join(dir,SOURCE_BODY),body);
 publish(join(dir,SOURCE_RECEIPT),JSON.stringify(receipt,null,2)+'\n');
 return receipt;
}
