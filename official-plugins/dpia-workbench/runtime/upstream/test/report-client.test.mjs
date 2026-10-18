// Component interaction with a minimal React hook harness; no browser or Host claim.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(fail=false){
 const hooks=[],effects=[];let cursor=0,component,props,tree,ready=false;const calls=[];
 const c={id:'case-1',title:'Synthetic',version:1,reminders:{},events:[]};
 const report=()=>({requestId:'report-1',phase:ready?'ready':'awaiting_page_review',reportType:'formal',language:'en',template:'Fixture',summary:{jobPluginVersion:null,runtimePluginVersion:'test-runtime',notice:'冻结底稿',decisions:[{jurisdiction:'EU',recommendation:'changes_required',rationale:'SYNTHETIC hold pending A1'}]}});
 const rpc=async p=>{calls.push(p.action);if(p.action==='list')return {cases:[c],testFixtures:[],errors:[]};if(p.action==='get')return c;if(p.action==='execution')return {requestId:'report-1',kind:'report',phase:'accepted',unfinished:!ready,stoppedAt:'2026-10-03',revision:1};if(p.action==='reportList')return [report()];if(p.action==='completeReport'){if(fail)throw Error('REPORT_PAGE_REVIEW_FAILED');ready=true;return report();}throw Error('Unexpected '+p.action);};
 const React={Component:class {},createElement:(type,props,...children)=>type?.name==='PageContent'?type(props):({type: type?.name==='RenderBoundary'?'fragment':type,props:props||{},children:children.flat(Infinity)}),Fragment:'fragment',
 useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],v=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},
 useRef(initial){const i=cursor++;return hooks[i]??=( {current:initial});},
 useEffect(fn,deps){const i=cursor++,old=hooks[i];if(!old||deps.some((v,j)=>!Object.is(v,old[j]))){hooks[i]=deps;effects.push(fn);}}};
 vm.runInNewContext(readFileSync(new URL('../client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load(spec){spec.factory(()=>React).apply({connection:{rpc:{call:async(a,b,p)=>({ok:true,value:await rpc(p)})}},slots:{inject:(n,fn)=>fn(),register:(options,fn)=>{if(options.name==='main'){component=fn;props=options.inject();}}},uiWorkspace:{openSession(){}}});}}},setInterval:()=>1,clearInterval(){},setTimeout,console});
 function render(){cursor=0;tree=component(props);}
 async function settle(){for(let i=0;i<3;i++){render();for(const fn of effects.splice(0))fn();await new Promise(r=>setImmediate(r));}render();}
 const text=n=>typeof n==='string'?n:n&&typeof n==='object'?(n.children||[]).map(text).join(''):'';
 const find=(n,label)=>n&&typeof n==='object'?(n.type==='button'&&text(n)===label?n:(n.children||[]).map(x=>find(x,label)).find(Boolean)):null;
 return {calls,settle,text:()=>text(tree),click:async label=>{const b=find(tree,label);assert.ok(b,'Missing button '+label);await b.props.onClick();await settle();}};
}
test('DPIAP-011: completing a report refreshes both download controls and old execution warning',async()=>{
 const f=fixture();await f.settle();await f.click('Synthetic结果尚未同步');await f.click('报告与版本');assert.match(f.text(),/本轮尚未完成交付/);assert.match(f.text(),/任务创建插件版本：历史未记录；当前插件版本：test-runtime/);assert.match(f.text(),/changes_required/);assert.match(f.text(),/SYNTHETIC hold pending A1/);
 await f.click('全部检查后完成交付（不调用模型）');assert.doesNotMatch(f.text(),/本轮尚未完成交付/);assert.match(f.text(),/下载这一版 Word/);assert.ok(f.calls.includes('execution'));assert.ok(!f.calls.includes('start'));
});
test('DPIAP-009: failed completion keeps the warning and download closed',async()=>{
 const f=fixture(true);await f.settle();await f.click('Synthetic结果尚未同步');await f.click('报告与版本');await f.click('全部检查后完成交付（不调用模型）');assert.match(f.text(),/本轮尚未完成交付/);assert.doesNotMatch(f.text(),/下载这一版 Word/);assert.match(f.text(),/页面检查/);
});
