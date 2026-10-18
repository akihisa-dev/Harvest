import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {launchBrowser} from './support/browser.mjs';

async function startCollection(page) {
  const source = await readFile(new URL('../dist/extension/app/content/collection-mode.js', import.meta.url), 'utf8');
  await page.evaluate(async source => {
    const port = {onMessage:{addListener(listener){window.reply=listener;}},onDisconnect:{addListener(listener){window.disconnectCollection=listener;}},postMessage(){}};
    Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{connect:()=>port}}});
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    try {(await import(url)).captureCollectionLinks('scroll-fixture');} finally {URL.revokeObjectURL(url);}
  },source);
}

async function mark(page, locator, url) {
  await locator.click();
  await page.evaluate(url => window.reply({busy:false,pdfUrl:url,canExport:true}),url);
  await page.mouse.move(0,0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('ネストと動的Shadow Root内のscrollに発光が追従し、削除・終了時に購読を解放する', async t => {
  const browser=await launchBrowser(t),page=await browser.newPage({reducedMotion:'reduce'});
  await page.setContent('<div id="outer"></div>');
  await page.evaluate(() => {
    window.scrollSubscriptions=new Map();
    const add=ShadowRoot.prototype.addEventListener,remove=ShadowRoot.prototype.removeEventListener;
    ShadowRoot.prototype.addEventListener=function(type,listener,...args){if(type==='scroll') {const set=window.scrollSubscriptions.get(this)??new Set();set.add(listener);window.scrollSubscriptions.set(this,set);}return add.call(this,type,listener,...args);};
    ShadowRoot.prototype.removeEventListener=function(type,listener,...args){if(type==='scroll')window.scrollSubscriptions.get(this)?.delete(listener);return remove.call(this,type,listener,...args);};
    const root=document.querySelector('#outer').attachShadow({mode:'open'});
    root.innerHTML='<div id="inner"></div><div id="dynamic"></div>';
    const inner=root.querySelector('#inner').attachShadow({mode:'open'});
    inner.innerHTML='<div id="scroll" tabindex="0" style="overflow:auto;height:120px;margin-top:100px"><a style="display:block;height:40px" href="https://example.test/one">One</a><div style="height:500px"></div></div>';
    window.firstScroll=inner.querySelector('#scroll');
  });
  await startCollection(page);
  await mark(page,page.getByText('One',{exact:true}),'https://example.test/one');
  assert.equal(await page.evaluate(()=>[...window.scrollSubscriptions.values()].reduce((n,set)=>n+set.size,0)),2);
  const before=await page.locator('[data-harvest-collection-marker]').evaluate(el=>parseFloat(el.style.top));
  await page.evaluate(()=>{window.firstScroll.scrollTop=20;});
  await page.waitForFunction(()=>Math.abs(parseFloat(document.querySelector('[data-harvest-collection-marker]').style.top)-window.firstScroll.querySelector('a').getBoundingClientRect().top)<1);
  const after=await page.locator('[data-harvest-collection-marker]').evaluate(el=>parseFloat(el.style.top));
  assert.ok(before-after>15);
  await page.evaluate(()=>{
    const root=document.querySelector('#outer').shadowRoot.querySelector('#dynamic').attachShadow({mode:'open'});
    root.innerHTML='<div id="scroll" tabindex="0" style="overflow:auto;height:120px"><a style="display:block;height:40px" href="https://example.test/two">Two</a><div style="height:500px"></div></div>';
    window.secondScroll=root.querySelector('#scroll');
  });
  await mark(page,page.getByText('Two',{exact:true}),'https://example.test/two');
  assert.equal(await page.evaluate(()=>[...window.scrollSubscriptions.values()].reduce((n,set)=>n+set.size,0)),3);
  await page.evaluate(()=>{window.secondScroll.scrollTop=15;});
  await page.waitForFunction(()=>{
    const target=window.secondScroll.querySelector('a').getBoundingClientRect();
    return [...document.querySelectorAll('[data-harvest-collection-marker]')].some(marker=>Math.abs(parseFloat(marker.style.top)-target.top)<1);
  });
  await page.evaluate(()=>document.querySelector('#outer').shadowRoot.querySelector('#inner').remove());
  await page.waitForFunction(()=>document.querySelectorAll('[data-harvest-collection-marker]').length===1 && [...window.scrollSubscriptions.values()].reduce((n,set)=>n+set.size,0)===2);
  assert.equal(await page.evaluate(()=>[...window.scrollSubscriptions.values()].reduce((n,set)=>n+set.size,0)),2);
  await page.evaluate(()=>window.disconnectCollection());
  assert.equal(await page.evaluate(()=>[...window.scrollSubscriptions.values()].reduce((n,set)=>n+set.size,0)),0);
  assert.equal(await page.locator('[data-harvest-collection-marker]').count(),0);
});
