// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createReviewUndo}=require('../review-undo.cjs');

function harness(initial='balloons'){
 const calls=[],undo=['Typing'],redo=[];
 let mode=initial,failRestore=false,failStep=false;
 const state=()=>({undo:{depth:undo.length,title:undo[0]||'',titles:[...undo]},redo:{depth:redo.length,title:redo[0]||'',titles:[...redo]}});
 const helper=createReviewUndo({
  view:async params=>{
   if(params){
    calls.push(['view',params.mode,params.internal,params.refresh]);
    if(failRestore&&params.mode===initial)throw Error('restore failed');
    mode=params.mode;
   }
   return {mode,showChangesInMargin:['balloons','margin'].includes(mode)};
  },
  undoState:async()=>state(),
  undoStep:async(kind,expected)=>{
   calls.push([kind,mode]);assert.deepEqual(expected,state());
   if(failStep)throw Error('native outcome unknown');
   const [source,target]=kind==='undo'?[undo,redo]:[redo,undo];
   target.unshift(source.shift());
   return {applied:true,state:state()};
  }
 });
 return {helper,calls,undo,redo,state,
  resolution:()=>helper.resolve(async()=>{calls.push(['resolve',mode]);undo.unshift('Resolution');redo.length=0;return {applied:true}}),
  edit:(title='New typing')=>helper.edit(async()=>{undo.unshift(title);redo.length=0;return {applied:true}}),
  setMode:next=>{mode=next},mode:()=>mode,
  failRestore:()=>{failRestore=true},failStep:()=>{failStep=true}};
}

for(const mode of ['balloons','margin'])test(`long-deletion resolution and its undo/redo use inline layout from ${mode}`,async()=>{
 const h=harness(mode);await h.resolution();
 assert.equal(h.mode(),mode);
 await h.helper.step('undo');await h.helper.step('redo');
 assert.deepEqual(h.calls,[
  ['view','all',true,true],['resolve','all'],['view',mode,true,true],
  ['view','all',true,true],['undo','all'],['view',mode,true,true],
  ['view','all',true,true],['redo','all'],['view',mode,true,true]
 ]);
 assert.deepEqual(h.undo,['Resolution','Typing']);assert.deepEqual(h.redo,[]);
});

test('ordinary margin edit undoes in its recording view without an inline detour',async()=>{
 const h=harness();await h.helper.step('undo');
 assert.deepEqual(h.calls,[['undo','balloons']]);
});

test('two margin resolutions retain separate undo and redo detours',async()=>{
 const h=harness();await h.resolution();await h.resolution();h.calls.length=0;
 await h.helper.step('undo');await h.helper.step('undo');
 await h.helper.step('redo');await h.helper.step('redo');
 assert.deepEqual(h.calls.filter(c=>c[0]==='undo'||c[0]==='redo'),
  [['undo','all'],['undo','all'],['redo','all'],['redo','all']]);
 assert.deepEqual(h.undo,['Resolution','Resolution','Typing']);assert.deepEqual(h.redo,[]);
});

test('an ordinary edit above the remembered resolution keeps its own view; resolution detours only on top',async()=>{
 const h=harness();await h.resolution();h.calls.length=0;
 await h.edit();await h.helper.step('undo');
 assert.deepEqual(h.calls,[['undo','balloons']]);
 await h.helper.step('undo');
 assert.deepEqual(h.calls.slice(1),[['view','all',true,true],['undo','all'],['view','balloons',true,true]]);
});

test('untracked same-title stack change blocks undo rather than dropping the required detour',async()=>{
 const h=harness();await h.resolution();h.calls.length=0;
 h.undo.unshift('Resolution');await assert.rejects(h.helper.step('undo'),/未跟踪/);
 assert.deepEqual(h.calls,[]);
});

test('untracked replacement at the same depth blocks undo',async()=>{
 const h=harness();await h.resolution();h.calls.length=0;
 h.undo[0]='New typing';await assert.rejects(h.helper.step('undo'),/未跟踪/);
 assert.deepEqual(h.calls,[]);
});

test('ordinary edit on a new branch cannot inherit a discarded resolution with the same title and depth',async()=>{
 const h=harness();await h.resolution();await h.resolution();
 await h.helper.step('undo');await h.edit('Resolution');h.calls.length=0;
 await h.helper.step('undo');await h.helper.step('undo');
 assert.deepEqual(h.calls.filter(c=>c[0]==='undo'),[['undo','balloons'],['undo','all']]);
});

test('coalescing ordinary typing preserves older inline resolutions',async()=>{
 const h=harness();await h.resolution();await h.edit();
 await h.helper.edit(async()=>({applied:true}));h.calls.length=0;
 await h.helper.step('undo');await h.helper.step('undo');
 assert.deepEqual(h.calls.filter(c=>c[0]==='undo'),[['undo','balloons'],['undo','all']]);
});

test('replacing a remembered resolution with indistinguishable title and depth blocks writing',async()=>{
 const h=harness();await h.resolution();
 await assert.rejects(h.helper.edit(async()=>({applied:true})),/替换了已有修订撤销项/);
 assert.throws(h.helper.assertSafe,/停止写入/);
});

test('verified bookmark no-op preserves a resolution and its redo branch',async()=>{
 const h=harness();await h.resolution();
 const options={isNoop:result=>result.bookmarkMutations===0};
 await h.helper.edit(async()=>({bookmarkMutations:0}),options);
 await h.edit();await h.helper.step('undo');
 await h.helper.edit(async()=>({bookmarkMutations:0}),options);
 await h.helper.step('undo');
 assert.deepEqual(h.calls.filter(c=>c[0]==='undo'),[['undo','balloons'],['undo','all']]);
});

test('a claimed bookmark no-op with a changed native stack locks writing',async()=>{
 const h=harness();await h.resolution();
 await assert.rejects(h.helper.edit(async()=>{h.undo.unshift('Insert bookmark');return {bookmarkMutations:0}},
  {isNoop:result=>result.bookmarkMutations===0}),/未修改操作改变了撤销栈/);
 assert.throws(h.helper.assertSafe,/停止写入/);
});

test('ordinary typing before tracked resolutions does not add native stack reads',async()=>{
 let reads=0;
 const helper=createReviewUndo({view:async()=>{throw Error('unused')},undoState:async()=>{reads++;throw Error('unused')},undoStep:async()=>{throw Error('unused')}});
 let writes=0;await helper.edit(async()=>{writes++});await helper.edit(async()=>{writes++});
 assert.equal(writes,2);assert.equal(reads,0);
});

test('undo in user-selected inline view transfers the remembered entry for redo after switching back',async()=>{
 const h=harness();await h.resolution();h.calls.length=0;
 h.setMode('all');await h.helper.step('undo');
 h.setMode('balloons');await h.helper.step('redo');
 assert.deepEqual(h.calls,[['undo','all'],['view','all',true,true],['redo','all'],['view','balloons',true,true]]);
});

test('final-view resolution switches to visible inline markup and restores final',async()=>{
 const h=harness('final');await h.resolution();
 assert.deepEqual(h.calls,[['view','all',true,true],['resolve','all'],['view','final',true,true]]);
});

test('already inline resolution does not toggle display or refresh layout',async()=>{
 const h=harness('all');await h.resolution();assert.deepEqual(h.calls,[['resolve','all']]);
});

test('resolution created in inline view remains tracked after a later switch to margin',async()=>{
 const h=harness('all');await h.resolution();h.setMode('balloons');h.calls.length=0;
 await h.helper.step('undo');
 assert.deepEqual(h.calls,[['view','all',true,true],['undo','all'],['view','balloons',true,true]]);
});

test('new document clears remembered entries even when title and depth match',async()=>{
 const h=harness();await h.resolution();h.calls.length=0;
 h.helper.reset();await h.helper.step('undo');assert.deepEqual(h.calls,[['undo','balloons']]);
});

test('empty undo and redo do not dispatch or change layout',async()=>{
 const h=harness();h.undo.length=0;
 assert.equal((await h.helper.step('undo')).applied,false);
 assert.equal((await h.helper.step('redo')).applied,false);
 assert.deepEqual(h.calls,[]);
});

test('failed resolution restores view without inventing an undo marker',async()=>{
 const h=harness();
 await assert.rejects(h.helper.resolve(async()=>{throw Error('stale target')}),/stale target/);
 assert.equal(h.mode(),'balloons');h.calls.length=0;
 await h.helper.step('undo');assert.deepEqual(h.calls,[['undo','balloons']]);
});

test('failed undo restores display but locks further writing without retry',async()=>{
 const h=harness();await h.resolution();h.calls.length=0;h.failStep();
 await assert.rejects(h.helper.step('undo'),/native outcome unknown/);
 assert.equal(h.mode(),'balloons');assert.throws(h.helper.assertSafe,/停止写入/);
 await assert.rejects(h.helper.step('undo'),/停止写入/);
 assert.equal(h.calls.filter(c=>c[0]==='undo').length,1);
});

test('failed restore after a successful resolution locks further writes',async()=>{
 const h=harness();h.failRestore();
 await assert.rejects(h.resolution(),/restore failed/);
 assert.deepEqual(h.undo,['Resolution','Typing']);assert.throws(h.helper.assertSafe,/停止写入/);
});
