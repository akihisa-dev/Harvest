import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {animatedWebp,staticWebp,apng,animatedGif,opaqueClearWebp,opaqueClearPng,clearOpaqueWebp,clearOpaquePng} from './animation-fixtures.mjs';
async function inspect(page,bytes,type) {
  return page.evaluate(async ({bytes,type})=>{
    const decoder=new ImageDecoder({data:new Uint8Array(bytes),type,preferAnimation:true});await decoder.tracks.ready;await decoder.completed;
    const track=decoder.tracks.selectedTrack,frames=[];
    for(let i=0;i<track.frameCount;i++){
      const {image}=await decoder.decode({frameIndex:i});try{const c=new OffscreenCanvas(image.displayWidth,image.displayHeight),ctx=c.getContext('2d');ctx.drawImage(image,0,0);frames.push({rgba:[...ctx.getImageData(0,0,image.displayWidth,image.displayHeight).data],duration:image.duration});}finally{image.close();}
    }
    const result={frames,repeats:track.repetitionCount};decoder.close();return result;
  },{bytes:[...bytes],type});
}
test('推奨でアニメWebP/APNGの原本を保ち、画像変換では全フレーム・時間・有限ループ付きGIFと失敗/再試行を維持する', {timeout:90000},async t=>{
  const assets=new Map([['/a.webp',[animatedWebp,'image/webp']],['/a.png',[apng,'image/png']],['/s.webp',[staticWebp,'image/webp']],['/g.gif',[animatedGif,'image/gif']]]);
  const {page,scan,saved,failed,count}=await animationPanel(t,assets);
  for(const [path,source,type] of [['/a.webp',animatedWebp,'image/webp'],['/a.png',apng,'image/png']]){
    await scan([path]);const recommended=await saved('recommend');assert.match(recommended.filename,path.endsWith('.webp')?/\.webp$/:/\.png$/);assert.deepEqual(recommended.bytes,source,'推奨は動く原本も再変換しない');
    const output=await saved('png');assert.match(output.filename,/\.gif$/);
    const original=await inspect(page,source,type),converted=await inspect(page,output.bytes,'image/gif');assert.deepEqual(converted,original);assert.equal(converted.frames.length,3);assert.deepEqual(converted.frames.map(frame=>frame.duration),[100000,200000,300000]);assert.deepEqual((await saved('original')).bytes,source);
  }
  for(const [path,source,type] of [['/opaque-clear.webp',opaqueClearWebp,'image/webp'],['/opaque-clear.png',opaqueClearPng,'image/png'],['/clear-opaque.webp',clearOpaqueWebp,'image/webp'],['/clear-opaque.png',clearOpaquePng,'image/png']]){assets.set(path,[source,type]);await scan([path]);assert.deepEqual((await saved('recommend')).bytes,source);const output=await saved('png');assert.deepEqual(await inspect(page,output.bytes,'image/gif'),await inspect(page,source,type));}
  await scan(['/a.webp','/s.webp','/g.gif']);assert.match((await saved('recommend')).filename,/\.zip$/);
  assets.set('/a.webp',[animatedWebp.subarray(0,animatedWebp.length-8),'image/webp']);await scan(['/a.webp','/s.webp']);await page.locator('#export-format-png').check();assert.match(await failed(),/不完全|破損/);
  assets.set('/a.webp',[animatedWebp,'image/webp']);assert.match((await saved('png')).filename,/\.zip$/);
  await scan(['/s.webp']);const still=await saved('recommend');assert.match(still.filename,/\.webp$/);assert.deepEqual(still.bytes,staticWebp);
  const colors=await page.evaluate(async()=>{
    const {GifEncoder}=await import('../core/gif-encoder.js');
    const results=[];
    for(const transparent of [false,true]){
      const rgba=new Uint8ClampedArray(256*256*4);let seed=913;
      for(let p=0;p<65536;p++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=seed>>>24;rgba.set([n,(n*37+13)&255,(n*73+19)&255,transparent&&n===255?0:255],p*4);}
      const encoder=new GifEncoder(256,256,0,200000);encoder.add(rgba,100000);const blob=encoder.finish();
      const decoder=new ImageDecoder({data:await blob.arrayBuffer(),type:'image/gif'});await decoder.completed;const {image}=await decoder.decode();
      try{const canvas=new OffscreenCanvas(256,256),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const actual=ctx.getImageData(0,0,256,256).data;let exact=true;for(let p=0;p<65536;p++){if(actual[p*4+3]!==rgba[p*4+3])exact=false;if(rgba[p*4+3])for(let c=0;c<3;c++)if(actual[p*4+c]!==rgba[p*4+c])exact=false;}results.push({transparent,exact,bytes:blob.size});}finally{image.close();decoder.close();}
    }
    return results;
  });
  assert.deepEqual(colors.map(result=>result.exact),[true,true]);

  await scan(['/a.webp']);await page.locator('#export-format-png').check();const before=await count();await page.evaluate(()=>{document.querySelector('#export').click();document.querySelector('#export').click();});await page.waitForFunction(()=>document.querySelector('#export').dataset.saving==='false');assert.equal(await count(),before);
});
