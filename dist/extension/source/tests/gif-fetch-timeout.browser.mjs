import assert from 'node:assert/strict';import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';import {animatedGif,redPng} from './animation-fixtures.mjs';import {mp4Bytes} from './media-fixtures.mjs';
const fetchBody=request=>request.method==='GET'&&request.headers['sec-fetch-dest']!=='image';
test('既知GIFは推奨と各変換形式の実UIで22秒の本文を待ち、全GIF原本を保存する',{timeout:90000},async t=>{
 await Promise.all(['recommend','pdf','jpg','png','jxl'].map(async format=>{
  const path=format==='pdf'?'/animation?format=gif':'/animation.gif',assets=new Map([[path,[animatedGif,'image/gif']],['/animation',[animatedGif,'image/gif']]]);
  const {page,scan,saved}=await animationPanel(t,assets,{responseDelayMs:(request)=>fetchBody(request)?22000:0});
  await scan([path],`slow-${format}`);const start=performance.now(),output=await saved(format);
  assert.ok(performance.now()-start>=21500);assert.match(output.filename,/\.gif$/);assert.deepEqual(output.bytes,animatedGif);assert.equal(await page.locator('#status').getAttribute('data-state'),'success');
 }));
});
test('推奨原本とGIFと動画は120秒、明示画像変換は20秒とし、中止と再試行を維持する',{timeout:60000},async t=>{
 const assets=new Map([['/a.gif',[animatedGif,'image/gif']],['/a.png',[redPng,'image/png']],['/unknown',[animatedGif,'image/gif']],['/a.mp4',[mp4Bytes,'video/mp4']]]);let delay=22000;
 const {page,scan,saved,failed}=await animationPanel(t,assets,{responseDelayMs:request=>fetchBody(request)?delay:0});
 await scan(['/a.gif'],'timeout-controls');
 const results=await page.evaluate(async()=>{
  const {prepareMixedExport}=await import('./media/mixed-export-preparation.js');const {resolveImageExportFormat}=await import('../core/export-recommendations.js');const origin=new URL(document.querySelector('#images > li[data-focus-url]').dataset.focusUrl).origin,real=window.setTimeout,limits=[];
  // Exercise real response-body aborts quickly while retaining and checking the requested production deadlines.
  window.setTimeout=function(callback,ms,...args){if(ms===20000||ms===120000){limits.push(ms);return real.call(this,callback,30,...args);}return real.call(this,callback,ms,...args);};
  const cases=[['known','/a.gif','gif','recommend'],['refined','/unknown','image','recommend'],['unknown','/unknown','image','recommend'],['static','/a.png','image','png'],['unknown-converted','/unknown','image','png'],['video','/a.mp4','video','original'],['original','/a.gif','gif','original']],out=[];
  try{for(const [name,path,kind,imageFormat] of cases){const item={url:origin+path,kind,selected:true,sourcePage:origin+'/gallery',...(name==='refined'?{recommendedFormat:'gif'}:{})},work={selected:[item],prepared:new Map(),failed:new Map(),saved:new Set(),imageFormat,resolvedImageFormat:resolveImageExportFormat(imageFormat,[item]),videoFormat:'original',includeSourcePage:false};const start=performance.now();await prepareMixedExport(work,{signal:new AbortController().signal,isStopped:()=>false,onProgress(){}});out.push({name,limit:limits.at(-1),elapsed:performance.now()-start,prepared:work.prepared.size,failures:[...work.failed.values()]});}}finally{window.setTimeout=real;}return out;
 });
 assert.deepEqual(results.map(r=>r.limit),[120000,120000,120000,20000,20000,120000,120000]);for(const r of results){assert.equal(r.prepared,0);assert.equal(r.failures.length,1);assert.match(r.failures[0],/時間|タイムアウト/);assert.ok(r.elapsed<3000);}
 // A public UI deadline failure leaves retry available and does not create a download.
 await page.locator('#export-format-recommend').check();
 await page.evaluate(()=>{window.gifTestTimer=window.setTimeout;window.setTimeout=function(callback,ms,...args){return window.gifTestTimer.call(this,callback,ms===120000?30:ms,...args);};});
 assert.match(await failed(),/時間|タイムアウト/);assert.match(await page.locator('#export').innerText(),/再試行/);
 await page.evaluate(()=>{window.setTimeout=window.gifTestTimer;delete window.gifTestTimer;});
 delay=0;assert.deepEqual((await saved('recommend')).bytes,animatedGif);
 delay=22000;await scan(['/a.gif'],'cancel-body');
 // Public UI cancellation aborts a pending body rather than waiting for the 120-second deadline.
 await page.locator('#export-format-recommend').check();await page.locator('#export').click();await page.waitForFunction(()=>document.querySelector('#export').dataset.saving==='true');const before=performance.now();await page.locator('#export').click();await page.waitForFunction(()=>document.querySelector('#export').dataset.saving==='false');assert.ok(performance.now()-before<3000);
 delay=0;assert.deepEqual((await saved('recommend')).bytes,animatedGif);
});
