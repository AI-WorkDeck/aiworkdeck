// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto, generateKeyPairSync, privateDecrypt, createDecipheriv, createCipheriv, randomBytes, constants } from 'node:crypto';
const source=readFileSync(new URL('../web/secure.js',import.meta.url),'utf8');
function fixture(options={}) {
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}); const calls=[];
  const bridge=async(name,{action,json})=>{
    calls.push({action,json});
    if(action==='transport_key') { await options.beforeKey?.(); return JSON.stringify({ok:true,data:{v:1,publicKey:publicKey.export({type:'spki',format:'der'}).toString('base64')}}); }
    assert.equal(action,'secure'); const e=JSON.parse(json);
    const key=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(e.key,'base64'));
    const raw=Buffer.from(e.data,'base64'),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));
    cipher.setAAD(Buffer.from('bqt:v1:request:'+e.nonce));cipher.setAuthTag(raw.subarray(-16));
    const payload=JSON.parse(Buffer.concat([cipher.update(raw.subarray(0,-16)),cipher.final()]));options.check?.(payload);
    const iv=randomBytes(12),response=createCipheriv('aes-256-gcm',key,iv);response.setAAD(Buffer.from('bqt:v1:response:'+e.nonce));
    const result=JSON.stringify({ok:true,data:{message:'SYNTHETIC_PRIVATE_RESULT'}});
    const data=Buffer.concat([response.update(result),response.final(),response.getAuthTag()]);
    if(options.tamper)data[0]^=1;
    return JSON.stringify({v:1,nonce:e.nonce,iv:iv.toString('base64'),data:data.toString('base64')});
  };
  const context={crypto:options.noCrypto?{}:webcrypto,TextEncoder,TextDecoder,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),awd:{tools:{invoke:bridge}}};context.window=context;vm.runInNewContext(source,context);
  return {api:context.bqtSecure,calls};
}
test('hybrid encrypted roundtrip keeps request and response data outside bridge logs',async()=>{
  const f=fixture({check:p=>{assert.equal(p.action,'login');assert.equal(p.args.authCode,'SYNTHETIC_SECRET');}});
  assert.equal(JSON.parse(await f.api.invoke('login',{authCode:'SYNTHETIC_SECRET'})).data.message,'SYNTHETIC_PRIVATE_RESULT');
  assert.equal(f.calls.length,2);assert.ok(!JSON.stringify(f.calls).includes('SYNTHETIC_SECRET'));
  await f.api.invoke('login',{authCode:'SYNTHETIC_SECRET'});assert.equal(f.calls.filter(c=>c.action==='transport_key').length,1);
  assert.notEqual(JSON.parse(f.calls[1].json).nonce,JSON.parse(f.calls[2].json).nonce);
  f.api.reset();await f.api.invoke('login',{authCode:'SYNTHETIC_SECRET'});assert.equal(f.calls.filter(c=>c.action==='transport_key').length,2);
});
test('tampered response fails without retry or plaintext fallback',async()=>{
  const f=fixture({tamper:true});await assert.rejects(f.api.invoke('note_save',{title:'SYNTHETIC_SECRET'}),/安全连接失败/);assert.equal(f.calls.length,2);
});
test('missing crypto fails before bridge and oversize plaintext fails before key request',async()=>{
  const f=fixture({noCrypto:true});await assert.rejects(f.api.invoke('login',{}),/安全连接失败/);assert.equal(f.calls.length,0);
  const big=fixture();await assert.rejects(big.api.invoke('media_upload',{base64:'A'.repeat(6*1024*1024)}));assert.equal(big.calls.length,0);
});
test('four MiB media fits encrypted envelope below nine MiB',async()=>{
  const base64=Buffer.alloc(4*1024*1024).toString('base64');const f=fixture({check:p=>assert.equal(p.args.base64.length,base64.length)});
  await f.api.invoke('media_upload',{base64});assert.ok(f.calls[1].json.length<9*1024*1024);assert.ok(f.calls[1].json.length>6*1024*1024);
});

test('context reset cancels encryption pending on the public key before write dispatch',async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const f=fixture({beforeKey:()=>waiting});const call=f.api.invoke('note_save',{title:'OLD_CONTEXT'});
  f.api.reset();release();await assert.rejects(call,/安全连接失败/);assert.equal(f.calls.length,1);
});
