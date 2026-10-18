import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
import {publish,readJson} from './store.js';
import {safeFile,hash} from './results.js';
import {readTemplateSource,SOURCE_RECEIPT,SOURCE_BODY} from './template-source.js';
export function resumeReportFiles(root,prior,dir){
 const previous=join(root,'reports',prior.requestId),read=name=>readFileSync(safeFile(root,join(previous,name),50_000_000));
 let document,bindings,review;
 try{document=read('report.docx');bindings=JSON.parse(read('bindings.json'));review=JSON.parse(read('field-review.json'));}catch{return {stage:'compose',reused:[]};}
 if(bindings.docx_sha256!==hash(document)||bindings.assessment_sha256!==prior.files.assessment.sha256||review.basisDigest!==prior.basisDigest)return {stage:'compose',reused:[]};
 const reused=['report.docx','bindings.json','field-review.json'];
 if(prior.template?.official){
  try{readTemplateSource(prior,previous,review.templateVerification||{});}catch{return {stage:'compose',reused:[]};}
  reused.push(SOURCE_RECEIPT,SOURCE_BODY);
 }
 let nativeHashes={};
 if(prior.template?.format==='pdf'){
  try{const native=read('native-report.pdf'),map=read('pdf-bindings.json'),data=JSON.parse(map);if(data.basisDigest!==prior.basisDigest||data.pdfSha256!==hash(native)||data.originalSha256!==prior.templateSha256||review.nativePdf?.bindingsSha256!==hash(map))throw Error();nativeHashes={nativePdfSha256:hash(native),pdfBindingsSha256:hash(map)};reused.push('native-report.pdf','pdf-bindings.json');}catch{return {stage:'compose',reused:[]};}
 }
 // All prior files remain in their original attempt. Copy only a coherent set.
 for(const name of reused)publish(join(dir,name),read(name));
 if(existsSync(join(previous,'report-content.json')))publish(join(dir,'report-content.json'),read('report-content.json'));
 let receipt,pages,pdf;
 try{
  receipt=JSON.parse(read('render-receipt.json'));
  if(receipt.documentSha256!==hash(document)||receipt.basisDigest!==prior.basisDigest||!Array.isArray(receipt.pages)||receipt.pages.length!==receipt.pageCount||!receipt.pageCount)throw Error();
  if(Object.entries(nativeHashes).some(([key,value])=>receipt[key]!==value))throw Error();
  if(receipt.pdf.path!==relative(root,join(previous,'render/report.pdf')))throw Error();
  pdf=read('render/report.pdf');if(hash(pdf)!==receipt.pdf.sha256)throw Error();
  pages=receipt.pages.map((p,i)=>{if(p.file!==`render/page-${i+1}.png`)throw Error();const bytes=read(p.file);if(hash(bytes)!==p.sha256)throw Error();return {name:p.file,bytes};});
 }catch{return {stage:'render',reused};}
 mkdirSync(join(dir,'render'),{mode:0o700});publish(join(dir,'render/report.pdf'),pdf);for(const p of pages)publish(join(dir,p.name),p.bytes);
 const updated={...receipt,pdf:{...receipt.pdf,path:relative(root,join(dir,'render/report.pdf'))},reusedFrom:prior.requestId};publish(join(dir,'render-receipt.json'),JSON.stringify(updated,null,2)+'\n');
 return {stage:'page_review',reused:[...reused,'render/report.pdf','render-receipt.json',...pages.map(p=>p.name)]};
}
