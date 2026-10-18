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


test('祖先overflowの縦横・入れ子の表示範囲で発光を切り取り、完全に隠れると消し再表示する', async t => {
  const browser=await launchBrowser(t),page=await browser.newPage({viewport:{width:600,height:600},reducedMotion:'reduce'});
  await page.setContent(`<style>body{margin:0;background:white}#outer{position:absolute;left:100px;top:200px;width:220px;height:120px;overflow:auto;border:2px solid black}#inner{width:400px;height:260px;overflow:hidden}a{display:block;margin:10px;width:160px;height:40px;color:black;background:#eee}#spacer{height:400px;width:600px}</style><div id="outer"><div id="inner"><a href="https://example.test/clipped">Clip target</a><div id="spacer"></div></div></div>`);
  await startCollection(page);
  await mark(page,page.getByText('Clip target',{exact:true}),'https://example.test/clipped');
  const marker=page.locator('[data-harvest-collection-marker]');
  const outer=page.locator('#outer');
  const noLeak = async (clip) => {
    const before=await page.screenshot({clip});
    await marker.evaluate(el=>{el.style.visibility='hidden';});
    const without=await page.screenshot({clip});
    await marker.evaluate(el=>{el.style.visibility='';});
    assert.deepEqual(before,without,'領域外の描画はマーカーの有無で変化しない');
  };
  await outer.evaluate(el=>{el.scrollTop=25;});
  await page.waitForFunction(()=>parseFloat(document.querySelector('[data-harvest-collection-marker]').style.top)===document.querySelector('a').getBoundingClientRect().top);
  assert.equal(await marker.isVisible(),true,'部分クリップでは可視部分を残す');
  await noLeak({x:70,y:150,width:280,height:50});
  const visible=await page.screenshot({clip:{x:102,y:202,width:180,height:23}});
  await marker.evaluate(el=>{el.style.visibility='hidden';});
  const unmarked=await page.screenshot({clip:{x:102,y:202,width:180,height:23}});
  await marker.evaluate(el=>{el.style.visibility='';});
  assert.notDeepEqual(visible,unmarked,'可視部分には実際に発光が描かれる');
  await page.evaluate(()=>window.reply({canExport:false}));
  await noLeak({x:70,y:150,width:280,height:50});
  await outer.evaluate(el=>{el.scrollTop=100;});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-harvest-collection-clip]')).display==='none');
  assert.equal(await marker.isVisible(),false);
  await outer.evaluate(el=>{el.scrollTop=0;el.scrollLeft=80;});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-harvest-collection-clip]')).display==='block');
  await noLeak({x:20,y:180,width:80,height:180});
  await outer.evaluate(el=>{el.scrollLeft=0;});
  await page.waitForFunction(()=>parseFloat(document.querySelector('[data-harvest-collection-marker]').style.left)===document.querySelector('a').getBoundingClientRect().left);
  assert.equal(await marker.isVisible(),true);
  await page.evaluate(()=>{const inner=document.querySelector('#inner');inner.style.height='25px';});
  await page.waitForFunction(()=>document.querySelector('[data-harvest-collection-clip]').style.clipPath.includes('373px'));
  await noLeak({x:102,y:227,width:218,height:50});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>window.disconnectCollection());
  await page.waitForFunction(()=>document.querySelectorAll('[data-harvest-collection-clip]').length===0);
  assert.equal(await page.locator('[data-harvest-collection-clip]').count(),0);
});


for (const viewportOverflow of ['html','body']) test(`ページ全体の${viewportOverflow}スクロールで可視リンクの発光を隠さない`, async t => {
  const browser=await launchBrowser(t),page=await browser.newPage({viewport:{width:600,height:600},reducedMotion:'reduce'});
  await page.setContent(`<!doctype html><style>html{overflow:${viewportOverflow === 'html' ? 'auto' : 'visible'}}body{margin:0;height:${viewportOverflow === 'html' ? '2200px' : '100vh'};overflow:${viewportOverflow === 'body' ? 'auto' : 'visible'}}a{position:absolute;left:100px;top:1200px;display:block;width:160px;height:40px;background:#eee}#spacer{height:2200px}</style><a href="https://example.test/scrolled">Scrolled target</a><div id="spacer"></div>`);
  await startCollection(page);
  await page.evaluate(()=>scrollTo(0,1000));
  await mark(page,page.getByText('Scrolled target',{exact:true}),'https://example.test/scrolled');
  assert.ok(await page.evaluate(()=>scrollY>=1000));
  const marker=page.locator('[data-harvest-collection-marker]');
  assert.equal(await marker.isVisible(),true);
  const before=await page.screenshot({clip:{x:80,y:180,width:200,height:80}});
  await marker.evaluate(el=>{el.style.visibility='hidden';});
  const without=await page.screenshot({clip:{x:80,y:180,width:200,height:80}});
  assert.notDeepEqual(before,without,'画面内にある対象の発光が実際に描かれる');
  await marker.evaluate(el=>{el.style.visibility='';});
  await page.evaluate(()=>scrollBy(0,50));
  await page.waitForFunction(()=>parseFloat(document.querySelector('[data-harvest-collection-marker]').style.top)===document.querySelector('a').getBoundingClientRect().top);
  assert.equal(await marker.isVisible(),true);
  await page.evaluate(()=>window.disconnectCollection());
});
