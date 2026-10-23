import {readStoredZipBytes as storedEntries} from "./support/stored-zip-reader.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {staticWebp,apng,animatedGif,singleFrameApng} from './animation-fixtures.mjs';


test('拡張子なしGIFを実レスポンスで確認し、推奨単体/選択順ZIP・表示・再試行で原本保持する', {timeout:90_000}, async t => {
  const assets=new Map([['/unknown',[animatedGif,'image/gif']],['/animation.gif',[animatedGif,'image/gif']],['/static.webp',[staticWebp,'image/webp']],['/apng.png',[apng,'image/png']]]);
  const {page,scan,saved,failed,count}=await animationPanel(t,assets);
  await scan(['/unknown']);assert.match(await page.locator('#images').innerText(),/unknown/);assert.doesNotMatch(await page.locator('#images').innerText(),/GIF ·/);
  const single=await saved('recommend');assert.match(single.filename,/\.gif$/);assert.deepEqual(single.bytes,animatedGif);
  assert.equal(await page.locator('#export-recommend-extension').textContent(),'(GIF)');
  assert.deepEqual((await saved('original')).bytes,animatedGif);
  await scan(['/unknown','/static.webp','/animation.gif','/apng.png']);await page.locator('#groups .group-chip').filter({hasText:'PNG'}).locator('button').click();await page.locator('#images > li[data-focus-url$="/apng.png"]').click();
  const entries=storedEntries((await saved('recommend')).bytes);assert.deepEqual(entries.map(entry=>entry.name),['001.gif','002.webp','003.gif']);assert.deepEqual(entries[0].bytes,animatedGif);assert.deepEqual(entries[1].bytes,staticWebp);assert.deepEqual(entries[2].bytes,animatedGif);
  for(const [body,type] of [[animatedGif,'image/png'],[staticWebp,'image/gif'],[animatedGif.subarray(0,animatedGif.length-1),'image/gif']]){
    assets.set('/unknown',[body,type]);await scan(['/unknown','/static.webp']);await page.locator('#export-format-png').check();assert.match(await failed(),/一致しません|不完全|破損/);
    assets.set('/unknown',[animatedGif,'image/gif']);const retry=storedEntries((await saved('png')).bytes);assert.deepEqual(retry[0].bytes,animatedGif);assert.equal(retry[0].name,'001.gif');
  }
  await scan(['/unknown']);assert.match((await saved('png')).filename,/\.gif$/);assert.deepEqual((await saved('png')).bytes,animatedGif);assert.deepEqual((await saved('recommend')).bytes,animatedGif);
  await page.locator('#export-format-png').check();
  const before=await count();await page.evaluate(()=>{document.querySelector('#export').click();document.querySelector('#export').click();});await page.waitForFunction(()=>document.querySelector('#export').dataset.saving==='false');assert.equal(await count(),before);
});


test('1フレームAPNGは赤い代替画像ではなく青い選択フレームを時間付きGIFへ保存する', {timeout:90_000}, async t => {
  const assets = new Map([['/single.png', [singleFrameApng, 'image/png']]]);
  const {page,scan,saved} = await animationPanel(t, assets);
  await scan(['/single.png']);
  for (const format of ['original', 'recommend']) assert.deepEqual((await saved(format)).bytes, singleFrameApng);
  for (const format of ['pdf', 'jpg', 'png', 'jxl']) {
    const output = await saved(format);
    assert.match(output.filename, /\.gif$/);
    const decoded = await page.evaluate(async bytes => {
      const decoder = new ImageDecoder({data:new Uint8Array(bytes),type:'image/gif',preferAnimation:true});
      await decoder.tracks.ready; await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      const {image} = await decoder.decode({frameIndex:0});
      const canvas = new OffscreenCanvas(8,8), context = canvas.getContext('2d');
      context.drawImage(image,0,0);
      const result = {frames:track.frameCount, repetitions:track.repetitionCount, pixel:[...context.getImageData(0,0,1,1).data]};
      image.close();decoder.close();return result;
    }, [...output.bytes]);
    assert.equal(decoded.frames, 1);
    assert.equal(output.bytes.includes(Buffer.from("NETSCAPE2.0")), false, "one play must not add a loop extension");
    assert.deepEqual(decoded.pixel, [0,0,255,255]);
    const control = output.bytes.indexOf(Buffer.from([0x21,0xf9,4]));
    assert.ok(control >= 0); assert.equal(output.bytes.readUInt16LE(control + 4), 10);
  }
});
