import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Reports} from '../reports.js';
import {hash} from '../results.js';
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;
function fixture(t,decisions=[{jurisdiction:'EU',recommendation:'changes_required',rationale:'SYNTHETIC: hold deployment pending A1.'}]){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'dpia-summary-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'assessment.json');writeFileSync(path,JSON.stringify({decisions}));
 const job={pluginVersion:version,revisionId:'frozen-r1',basisDigest:'basis1',reportType:'formal',files:{assessment:{path,sha256:hash(readFileSync(path))}}};
 const reports=new Reports({dir:()=>root}),state={phase:'awaiting_page_review'};
 reports.job=()=>job;reports.status=()=>state;
 return {job,state,reports,path,summary:()=>reports.summary('case','request')};
}
test('summary preserves changes_required and rationale, separate from delivery state',t=>{const f=fixture(t),s=f.summary();assert.equal(s.decisions[0].recommendation,'changes_required');assert.equal(s.decisions[0].rationale,'SYNTHETIC: hold deployment pending A1.');assert.equal(s.downloadReady,false);assert.equal(s.phase,'awaiting_page_review');assert.equal(s.jobPluginVersion,version);});
test('historical job version stays unknown and is not replaced with runtime version',t=>{const f=fixture(t);delete f.job.pluginVersion;const s=f.summary();assert.equal(s.jobPluginVersion,null);assert.equal(s.runtimePluginVersion,version);f.job.pluginVersion='0.3.4';assert.equal(f.summary().jobPluginVersion,'0.3.4');assert.equal(f.summary().runtimePluginVersion,version);});
test('all delivery phases preserve the assessment recommendation',t=>{const f=fixture(t);for(const phase of ['queued','composed','rendering','awaiting_page_review','failed','render_failed','ready']){f.state.phase=phase;assert.equal(f.summary().downloadReady,phase==='ready');assert.equal(f.summary().decisions[0].recommendation,'changes_required');}});
test('multiple jurisdictions and unknown decision codes are retained without inference',t=>{const decisions=[{jurisdiction:'EU',recommendation:'undetermined',rationale:'pending'},{jurisdiction:'other',recommendation:'new_code',rationale:'original'}];assert.deepEqual(fixture(t,decisions).summary().decisions,decisions);});
test('missing decision is not presented as approval or rejection',t=>{const f=fixture(t,null);assert.deepEqual(f.summary().decisions,[]);});
test('tampered frozen assessment fails closed without using latest or historical text',t=>{const f=fixture(t);writeFileSync(f.path,JSON.stringify({decisions:[{recommendation:'approved'}]}));assert.throws(f.summary,/REPORT_BASIS_MISMATCH/);});
