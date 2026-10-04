import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {staticWebp,apng,animatedGif} from './animation-fixtures.mjs';

function storedEntries(bytes) {
  const entries=[];
  for(let offset=0;bytes.readUInt32LE(offset)===0x04034b50;){
    const size=bytes.readUInt32LE(offset+22), start=offset+30+bytes.readUInt16LE(offset+26);
    entries.push({name:bytes.subarray(offset+30,start).toString(),bytes:bytes.subarray(start,start+size)});offset=start+size;
  }
  return entries;
}
test('拡張子なしGIFを実レスポンスで確認し、推奨単体/選択順ZIP・表示・再試行で原本保持する', {timeout:90_000}, async t => {
  const assets=new Map([['/unknown',[animatedGif,'image/gif']],['/animation.gif',[animatedGif,'image/gif']],['/static.webp',[staticWebp,'image/webp']],['/apng.png',[apng,'image/png']]]);
  const {page,scan,saved,failed,count}=await animationPanel(t,assets);
  await scan(['/unknown']);assert.match(await page.locator('#images').innerText(),/unknown/);assert.doesNotMatch(await page.locator('#images').innerText(),/GIF ·/);
  const single=await saved('recommend');assert.match(single.filename,/\.gif$/);assert.deepEqual(single.bytes,animatedGif);
  assert.equal(await page.locator('#export-recommend-extension').textContent(),'(GIF)');
  assert.deepEqual((await saved('original')).bytes,animatedGif);
  await scan(['/unknown','/static.webp','/animation.gif','/apng.png']);await page.locator('#groups .group-chip').filter({hasText:'PNG'}).locator('button').click();await page.locator('#images > li[data-focus-url$="/apng.png"]').click();
  const entries=storedEntries((await saved('recommend')).bytes);assert.deepEqual(entries.map(entry=>entry.name),['001.gif','002.png','003.gif']);assert.deepEqual(entries[0].bytes,animatedGif);assert.deepEqual(entries[2].bytes,animatedGif);
  for(const [body,type] of [[animatedGif,'image/png'],[staticWebp,'image/gif'],[animatedGif.subarray(0,animatedGif.length-1),'image/gif']]){
    assets.set('/unknown',[body,type]);await scan(['/unknown','/static.webp']);await page.locator('#export-format-recommend').check();assert.match(await failed(),/一致しません|不完全|破損/);
    assets.set('/unknown',[animatedGif,'image/gif']);const retry=storedEntries((await saved('recommend')).bytes);assert.deepEqual(retry[0].bytes,animatedGif);assert.equal(retry[0].name,'001.gif');
  }
  await scan(['/unknown']);assert.match((await saved('png')).filename,/\.png$/);assert.deepEqual((await saved('recommend')).bytes,animatedGif);
  const before=await count();await page.evaluate(()=>{document.querySelector('#export').click();document.querySelector('#export').click();});await page.waitForFunction(()=>document.querySelector('#export').dataset.saving==='false');assert.equal(await count(),before);
});
