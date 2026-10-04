import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {animatedWebp,animatedGif,redPng,bluePng} from './animation-fixtures.mjs';
import {mp4Bytes} from './media-fixtures.mjs';
function entries(bytes){const result=[];let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const size=bytes.readUInt32LE(at+22),nameSize=bytes.readUInt16LE(at+26),start=at+30+nameSize;result.push({name:bytes.subarray(at+30,start).toString(),bytes:bytes.subarray(start,start+size)});at=start+size;}return result;}
test('独立画像/動画形式で静止PDF＋GIF＋MP4を全件ZIP保存し、失敗分のみ再試行する',{timeout:90000},async t=>{
 const assets=new Map([['/red.png',[redPng,'image/png']],['/blue.png',[bluePng,'image/png']],['/a.webp',[animatedWebp,'image/webp']],['/g.gif',[animatedGif,'image/gif']],['/movie.mp4',[mp4Bytes,'video/mp4']]]);
 const {page,scan,saved,failed,count,requests}=await animationPanel(t,assets);
 await scan(['/red.png','/a.webp','/blue.png','/g.gif','/movie.mp4'],'mixed');
 assert.equal(await page.locator('#image-export-formats').isVisible(),true);assert.equal(await page.locator('#video-export-formats').isVisible(),true);
 await page.locator('#video-export-format-mp4').check();await page.locator('#export-format-pdf').check();await page.locator('#include-source-page').check();
 const zip=await saved('pdf'),items=entries(zip.bytes);assert.equal(items.length,4);assert.deepEqual(items.map(item=>item.name),[...items.map(item=>item.name)].sort());
 const pdf=items.find(item=>item.name.endsWith('.pdf'));assert.ok(pdf);assert.equal((pdf.bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,3);
 assert.deepEqual(items.find(item=>item.name.endsWith('.mp4')).bytes,mp4Bytes);
 const gifs=items.filter(item=>item.name.endsWith('.gif'));assert.equal(gifs.length,2);assert.ok(gifs.some(item=>item.bytes.equals(animatedGif)));
 assert.match(await page.locator('#export').innerText(),/5件/);assert.match(await page.locator('#export-media-hint').innerText(),/動く画像はGIF/);assert.doesNotMatch(await page.locator('#export-media-hint').innerText(),/対象外/);
 for(const format of ['jpg','png','jxl']){
  const output=entries((await saved(format)).bytes);assert.equal(output.length,5);assert.equal(output.filter(item=>item.name.endsWith('.gif')).length,2);assert.deepEqual(output.find(item=>item.name.endsWith('.mp4')).bytes,mp4Bytes);assert.equal(output.filter(item=>item.name.endsWith(`.${format}`)).length,2);
 }
 await page.locator('#video-export-format-original').check();const original=entries((await saved('original')).bytes);assert.deepEqual(original.map(item=>item.bytes.length).sort((a,b)=>a-b),[redPng,bluePng,animatedWebp,animatedGif,mp4Bytes].map(b=>b.length).sort((a,b)=>a-b));for(const source of [redPng,bluePng,animatedWebp,animatedGif,mp4Bytes])assert.ok(original.some(item=>item.bytes.equals(source)));
 await page.locator('#export-format-pdf').check();await page.locator('#video-export-format-mp4').check();
 assets.set('/a.webp',[animatedWebp.subarray(0,animatedWebp.length-8),'image/webp']);await scan(['/red.png','/a.webp','/movie.mp4'],'retry');await failed();const before=await count(),redBefore=requests().filter(path=>path==='/red.png').length,movieBefore=requests().filter(path=>path==='/movie.mp4').length;assets.set('/a.webp',[animatedWebp,'image/webp']);assert.equal(entries((await saved('pdf')).bytes).length,3);assert.equal(await count(),before+1);assert.equal(requests().filter(path=>path==='/red.png').length,redBefore);assert.equal(requests().filter(path=>path==='/movie.mp4').length,movieBefore);
 await scan(['/movie.mp4'],'only-video');assert.equal(await page.locator('#image-export-formats').isVisible(),false);assert.equal(await page.locator('#video-export-format-mp4').isChecked(),true);
 await scan(['/red.png'],'only-image');assert.equal(await page.locator('#video-export-formats').isVisible(),false);assert.equal(await page.locator('#export-format-pdf').isChecked(),true);assert.equal(await page.locator('#include-source-page').isChecked(),true);
 await scan(['/red.png','/a.webp','/movie.mp4'],'cancel');const beforeCancel=await count();await page.evaluate(()=>{document.querySelector('#export').click();document.querySelector('#export').click();});await page.waitForFunction(()=>document.querySelector('#export').dataset.saving==='false');assert.equal(await count(),beforeCancel);
});

test('GIF分類URLのPNG/JPEGは全形式で拒否し、未知imageの実GIFは保全する',{timeout:60000},async t=>{
 const assets=new Map([['/wrong.gif',[redPng,'image/png']],['/ok.png',[bluePng,'image/png']],['/unknown',[animatedGif,'image/gif']]]);
 const {page,scan,saved,failed,count}=await animationPanel(t,assets);
 const jpeg=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;canvas.getContext('2d').fillRect(0,0,32,24);return canvas.toDataURL('image/jpeg').split(',')[1];}),'base64');
 for(const [bytes,mime] of [[redPng,'image/png'],[jpeg,'image/jpeg']]){
  assets.set('/wrong.gif',[bytes,mime]);
  for(const format of ['original','recommend','pdf','jpg','png','jxl']){
   await scan(['/ok.png','/wrong.gif'],`wrong-${mime}-${format}`);await page.locator(`#export-format-${format}`).check();const before=await count();await failed();assert.equal(await count(),before);
  }
 }
 await scan(['/unknown'],'unknown-gif');assert.deepEqual((await saved('pdf')).bytes,animatedGif);
});
