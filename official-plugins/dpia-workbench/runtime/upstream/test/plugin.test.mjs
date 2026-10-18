import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { Store } from '../store.js';
import { makeRoute } from '../index.js';

function fixture(t) { const root=mkdtempSync(join(tmpdir(),'dpia-test-')); t.after(()=>rmSync(root,{recursive:true,force:true})); return {root,store:new Store(root)}; }
function create(store) { return store.run({action:'create',title:'SYNTHETIC：学习助手'}); }
test('DPIAP-001/002: stable assessment identity survives a new store instance',t=>{
 const {store,root}=fixture(t);const c=create(store); assert.equal(c.assessment.meta.workflow_version,'gdpr-v1');
 const recovered=new Store(root).run({action:'get',id:c.id});assert.equal(recovered.assessment.meta.assessment_id,c.assessment.meta.assessment_id);
 assert.equal(recovered.version,1);assert.equal(new Store(root).run({action:'list'}).cases.length,1);
});
test('DPIAP-002: evidence is immutable text with actual digest and persistent history',t=>{
 const {store,root}=fixture(t);let c=create(store); c=store.run({action:'evidence',id:c.id,version:c.version,title:'设计说明',text:'SYNTHETIC：保留七天',locator:'第 2 段'});
 const e=c.evidence[0];assert.equal(e.sha256,createHash('sha256').update('SYNTHETIC：保留七天').digest('hex'));
 assert.equal(readFileSync(e.path,'utf8'),'SYNTHETIC：保留七天');assert.equal(new Store(root).run({action:'get',id:c.id}).evidence.length,1);
 assert.equal(readdirSync(join(root,c.id)).filter(n=>/^state-/.test(n)).length,2);
});
test('DPIAP-002/003: facts retain source and answers remain pending professional verification',t=>{
 const {store}=fixture(t);let c=create(store);
 c=store.run({action:'gap',id:c.id,version:c.version,question:'日志保存多久？',impact:'影响存储限制分析'});
 c=store.run({action:'answer',id:c.id,version:c.version,gapId:c.gaps[0].id,text:'SYNTHETIC：尚未设计',title:'业务答复'});
 assert.equal(c.gaps[0].status,'answered_pending_review'); assert.ok(c.gaps[0].sourceId);assert.equal(c.assessment.meta.stage,'draft');
 c=store.run({action:'fact',id:c.id,version:c.version,text:'保存期限尚未设计',sourceId:c.evidence[0].id});
 assert.equal(c.facts[0].status,'reported'); assert.equal(c.assessment.facts.length,0);
});
test('DPIAP-002: stale edits are refused without overwriting the accepted update',t=>{
 const {store}=fixture(t);const c=create(store);store.run({action:'gap',id:c.id,version:1,question:'Q1',impact:'I1'});
 assert.throws(()=>store.run({action:'gap',id:c.id,version:1,question:'Q2',impact:'I2'}),/STALE_VERSION/);
 assert.equal(store.run({action:'get',id:c.id}).gaps.length,1);
});
test('DPIAP-002: input boundary rejects traversal, unsupported actions, empty and oversized evidence',t=>{
 const {store}=fixture(t); const c=create(store);
 for(const id of ['../outside','/etc/passwd','constructor'])assert.throws(()=>store.run({action:'get',id}),/INVALID_ID/);
 assert.throws(()=>store.run({action:'delete',id:c.id}),/UNKNOWN_ACTION/);
 for(const text of ['', 'x'.repeat(100001)])assert.throws(()=>store.run({action:'evidence',id:c.id,version:1,title:'x',text,locator:'x'}),/INVALID_TEXT/);
 assert.throws(()=>store.run({action:'fact',id:c.id,version:1,text:'guess',sourceId:'unknown'}),/SOURCE_NOT_FOUND/);
});
test('DPIAP-002: corrupted latest snapshot is surfaced without silent reset or fallback',t=>{
 const {store,root}=fixture(t);const c=create(store);writeFileSync(join(root,c.id,'state-000001.json'),'{broken');
 assert.throws(()=>store.run({action:'get',id:c.id}),/CORRUPT_STATE/);
 const list=store.run({action:'list'});assert.equal(list.cases.length,0);assert.equal(list.errors.length,1);
});
test('DPIAP-003: handoff references original pinned Skill and saved context without invoking a model',t=>{
 const {store}=fixture(t);const c=create(store);const out=store.run({action:'handoff',id:c.id});
 assert.match(out.prompt,/assess-product-dpia/);assert.match(out.prompt,/0\.7\.8/);assert.match(out.prompt,/不自动/);
 assert.ok(readFileSync(out.contextPath,'utf8').includes(c.assessment.meta.assessment_id));
 const v=store.run({action:'validate',id:c.id});assert.equal(v.exitCode,0);
});
test('DPIAP-001/004: authenticated route and actual DSH ModuleLoader contract register without stealing focus',async t=>{
 const {store}=fixture(t);const route=makeRoute(store);assert.equal(route.path,'/api/dpia.workbench');assert.deepEqual(route.methods,['POST']);
 const req=payload=>new Request('http://localhost/api/dpia.workbench',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 assert.equal((await route.fetch(req({}))).status,400);
 const res=await route.fetch(req({type:'client-request',rpcId:'test-1',method:'dpia.workbench',payload:{action:'list'}}));
 const json=await res.json();assert.equal(json.type,'server-response');assert.equal(json.result.ok,true);
 const bad=await route.fetch(req({type:'client-request',rpcId:'test-2',method:'dpia.workbench',payload:{action:'delete'}}));const failure=(await bad.json()).result;assert.equal(failure.ok,false);assert.deepEqual(failure.error.details,{});assert.equal(typeof failure.error.code,'string');assert.equal(typeof failure.error.message,'string');
 const opts=[];let client;
 vm.runInNewContext(readFileSync(new URL('../client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:spec=>{assert.equal(spec.id,'dsh-dpia-workbench');client=spec.factory(name=>{assert.equal(name,'react');return {Component:class {},createElement:()=>null};});}}}});
 client.apply({slots:{inject:(name,fn)=>fn(),register:o=>{opts.push(o);return ()=>{};}},connection:{rpc:{call:async()=>({ok:true,value:{cases:[],errors:[]}})}},effect:fn=>fn()});
 assert.ok(opts.some(o=>o.name==='main'&&o.key==='dpia-workbench'));assert.ok(opts.some(o=>o.name==='sidebar.panellist'&&o.id==='dpia-workbench'));
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));assert.ok(pkg.dsh.bundle.patch);assert.ok(pkg.exports['./client']);
});
