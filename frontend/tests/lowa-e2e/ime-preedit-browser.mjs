// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
const page=await browser.newPage();await page.setContent('<style>:root{--awd-text:#111;--awd-surface:#fff;--awd-border:#ccc}</style><div style="position:relative;width:800px;height:600px"><canvas width="800" height="600"></canvas></div>');
const src=fs.readFileSync(new URL('../../src/composables/zetaOfficeImeOverlay.js', import.meta.url),'utf8').replaceAll('export ','');
await page.addScriptTag({content:src+';window.commits=[];window.overlay=attachImeOverlay({canvas:document.querySelector("canvas"),commit:t=>{commits.push(t);return {success:true}}});'});
const cdp=await page.createCDPSession();
for(const text of ['dan', 'women' .repeat(35)]){
 await cdp.send('Input.imeSetComposition',{text,selectionStart:2,selectionEnd:2});
 const state=await page.$eval('[data-lo-ime]',e=>({value:e.value,start:e.selectionStart,opacity:getComputedStyle(e).opacity,caret:getComputedStyle(e).caretColor,rect:e.getBoundingClientRect().toJSON(),scroll:e.scrollLeft}));
 assert.equal(state.value,text);assert.equal(state.start,2);assert.equal(state.opacity,'1');assert.notEqual(state.caret,'rgba(0, 0, 0, 0)');
 await cdp.send('Input.imeSetComposition',{text,selectionStart:text.length-2,selectionEnd:text.length-2});
 assert.equal(await page.$eval('[data-lo-ime]',e=>e.selectionStart),text.length-2);
 await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});
 assert.equal(await page.$eval('[data-lo-ime]',e=>e.style.opacity),'0');
}
await cdp.send('Input.imeSetComposition',{text:'zhongwen',selectionStart:3,selectionEnd:3});
await cdp.send('Input.insertText',{text:'中文'});
assert.deepEqual(await page.evaluate(()=>commits),['中文']);
console.log('PASS Chrome CDP short/long preedit native middle caret, moved caret, cancel and single commit');
}finally{await browser.close()}
