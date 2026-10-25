// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source=readFileSync(new URL('../../src/components/LibreOfficeEditor.vue',import.meta.url),'utf8')
function helper(){const m=source.match(/\n    async syncNativeWritePermission\(\) \{\n([\s\S]*?)\n    \},/);assert.ok(m,'permission helper must exist');return new Function(`return async function(){${m[1]}}`)()}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
test('canWrite watcher immediately synchronizes native permission and keeps writing-assistance update',async()=>{
 const calls=[],vm={canWrite:false,initWritingAssistance(){calls.push('assistance')},syncNativeWritePermission(){calls.push(this.canWrite)}}
 const body=source.match(/\n    canWrite\(\) \{([^\n]+)\}/)?.[1];assert.ok(body)
 new Function(body).call(vm);assert.deepEqual(calls,[false,'assistance'])
})
test('component sync uses current bool and ignores failures belonging to retired surface or request',async()=>{
 const first=deferred(),second=deferred(),logs=[],calls=[]
 const surface={setReadOnly:value=>{calls.push(value);return calls.length===1?first.promise:second.promise}}
 const vm={_nativeSurface:surface,canWrite:true,appendLog:value=>logs.push(value)}
 const sync=helper(),old=sync.call(vm);vm.canWrite=false;const fresh=sync.call(vm)
 assert.deepEqual(calls,[false,true]);second.resolve({readOnly:true});await fresh;first.reject(Error('late permission response'));await old;assert.deepEqual(logs,[])
 const third=deferred();vm._nativeSurface={setReadOnly:()=>third.promise};const pending=sync.call(vm);vm._nativeSurface=null;third.reject(Error('closed surface'));await pending;assert.deepEqual(logs,[])
})
test('mount establishes desired policy before any initial blank document can accept input',()=>{
 const body=source.slice(source.indexOf('async mountEditor(info)'),source.indexOf('    createWebview('))
 assert.ok(body.indexOf('this._nativeSurface = surface')<body.indexOf('this.syncNativeWritePermission()'))
 assert.ok(body.indexOf('this.syncNativeWritePermission()')<body.indexOf('surface.start()'))
})
