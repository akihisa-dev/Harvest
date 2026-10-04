import assert from 'node:assert/strict';
import test from 'node:test';
import {animatedImageType} from '../dist/extension/core/animated-image.js';
import {inspectWebpAnimation} from '../dist/extension/core/webp-animation.js';
import {GifEncoder} from '../dist/extension/core/gif-encoder.js';
import {hasCompleteGif} from '../dist/extension/core/original-media-structure.js';
import {animatedWebp,staticWebp,apng} from './animation-fixtures.mjs';
test('WebP/APNGアニメ判定は境界を検証し、静止WebPを変換しない',()=>{
  assert.equal(animatedImageType(animatedWebp),'image/webp');assert.equal(animatedImageType(apng),'image/png');assert.equal(animatedImageType(staticWebp),null);
  for(let n=12;n<animatedWebp.length;n++)assert.equal(inspectWebpAnimation(animatedWebp.subarray(0,n)),'invalid');
  const large=Buffer.from(animatedWebp);large.writeUInt32LE(0xffffffff,16);assert.throws(()=>animatedImageType(large),/破損/);
  const nested=Buffer.from(animatedWebp);nested.writeUInt32LE(0xffffffff,nested.indexOf('ANMF')+28);assert.throws(()=>animatedImageType(nested),/破損/);
});
test('GIFの10ms時間丸めは累積終端を使い、極短フレーム/容量超過を欠落成功にしない',async()=>{
  const e=new GifEncoder(1,1,Infinity,4096),pixel=Uint8ClampedArray.of(255,0,0,255);for(let i=0;i<3;i++)e.add(pixel,17000);
  const bytes=new Uint8Array(await e.finish().arrayBuffer());assert.ok(hasCompleteGif(bytes));const delays=[];for(let i=0;i<bytes.length-7;i++)if(bytes[i]===33&&bytes[i+1]===249&&bytes[i+2]===4)delays.push(bytes[i+4]|bytes[i+5]<<8);assert.deepEqual(delays,[2,2,2]);
  const longer=new GifEncoder(1,1,0,32768);for(let i=0;i<10;i++)longer.add(pixel,17000);longer.add(pixel,100000);const result=new Uint8Array(await longer.finish().arrayBuffer());const times=[];for(let i=0;i<result.length-7;i++)if(result[i]===33&&result[i+1]===249&&result[i+2]===4)times.push(result[i+4]|result[i+5]<<8);assert.deepEqual(times,[...Array(10).fill(2),10]);
  assert.throws(()=>new GifEncoder(1,1,0,10),/上限/);assert.throws(()=>new GifEncoder(1,1,0,2048).add(pixel,1000),/10ms/);
});

test('GIF変換Workerは完了/空結果/失敗/中止/時間切れで終了し、再試行で再利用しない', async()=>{
  const {prepareAnimatedImage}=await import('../dist/extension/app/media/animated-image.js');
  const saved={Worker:globalThis.Worker,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};const workers=[];let timeout;
  globalThis.Worker=class{constructor(){workers.push(this);}postMessage(request){this.request=request;}terminate(){this.terminated=true;}};
  globalThis.setTimeout=callback=>{timeout=callback;return 1;};globalThis.clearTimeout=()=>{};
  const fetched={kind:'bitmap',blob:new Blob([animatedWebp],{type:'image/webp'})};

  try {
    let p=prepareAnimatedImage(fetched);await new Promise(resolve=>saved.setTimeout(resolve,10));const gif=new Blob(['gif'],{type:'image/gif'});workers[0].onmessage({data:{blob:gif}});assert.equal(await p,gif);assert.equal(workers[0].terminated,true);
    p=prepareAnimatedImage(fetched);await new Promise(resolve=>saved.setTimeout(resolve,10));workers[1].onmessage({data:{blob:null}});await assert.rejects(p,/空/);assert.equal(workers[1].terminated,true);
    p=prepareAnimatedImage(fetched);await new Promise(resolve=>saved.setTimeout(resolve,10));workers[2].onmessage({data:{error:'GIFへ変換できませんでした。'}});await assert.rejects(p,/変換できません/);assert.equal(workers[2].terminated,true);
    const controller=new AbortController();p=prepareAnimatedImage(fetched,controller.signal);await new Promise(resolve=>saved.setTimeout(resolve,10));controller.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(workers[3].terminated,true);
    p=prepareAnimatedImage(fetched);await new Promise(resolve=>saved.setTimeout(resolve,10));timeout();await assert.rejects(p,/タイムアウト/);assert.equal(workers[4].terminated,true);
  } finally {for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('GIFパレットは非websafe256色と透明＋255色を厳密保持し、超過時に適応減色する',async()=>{
  const {gifPalette}=await import('../dist/extension/core/gif-palette.js');
  for(const transparent of [false,true]){
    const rgba=new Uint8ClampedArray(256*4);
    for(let n=0;n<256;n++)rgba.set([n,(n*37+13)&255,(n*73+19)&255,transparent&&n===255?0:255],n*4);
    const result=gifPalette(rgba);assert.equal(result.transparent,transparent);
    for(let n=0;n<(transparent?255:256);n++)assert.deepEqual([...result.palette.subarray(result.indices[n]*3,result.indices[n]*3+3)],[...rgba.subarray(n*4,n*4+3)]);
    if(transparent)assert.equal(result.indices[255],0);
  }
  const rgba=new Uint8ClampedArray(256*256*4);for(let p=0;p<65536;p++){const r=p%256,g=p>>8;rgba.set([r,g,(r+g)&255,255],p*4);}
  const {palette,indices}=gifPalette(rgba);let adaptive=0,fixed=0;for(let p=0;p<65536;p++)for(let c=0;c<3;c++){const source=rgba[p*4+c];adaptive+=(source-palette[indices[p]*3+c])**2;fixed+=(source-Math.round(source/51)*51)**2;}assert.ok(adaptive<fixed/3);
});

test('GIF辞書LZWは単色画像を圧縮し、出力上限を守る',async()=>{
  const {gifLzw}=await import('../dist/extension/core/gif-lzw.js');
  assert.ok(gifLzw(new Uint8Array(1_000_000),65536).length<2048);
  assert.throws(()=>gifLzw(Uint8Array.from({length:65536},(_,i)=>(i*37+(i>>8)*71)&255),10),/上限/);
});

test('透過混在アニメでは不透明フレームも透明indexを予約し255色上限を守る',async()=>{
  const {gifPalette}=await import('../dist/extension/core/gif-palette.js');const rgba=new Uint8ClampedArray(256*4);
  for(let n=0;n<256;n++)rgba.set([n,(n*37+13)&255,(n*73+19)&255,255],n*4);
  const mixed=gifPalette(rgba,true);assert.equal(mixed.transparent,true);assert.ok([...mixed.indices].every(index=>index>0));assert.ok(new Set(mixed.indices).size<=255);
  const opaque=gifPalette(rgba);assert.equal(opaque.transparent,false);assert.equal(new Set(opaque.indices).size,256);
});

test('GIF事前走査は既知の論理画素上限をデコード前に拒否し、二回目の失敗を成功にしない',async()=>{
  const {convertAnimatedImage}=await import('../dist/extension/app/workers/animation-codec.js');const saved={ImageDecoder:globalThis.ImageDecoder,OffscreenCanvas:globalThis.OffscreenCanvas};let constructed=0,decoded=0,closed=0,framesClosed=0;
  globalThis.ImageDecoder=class{static async isTypeSupported(){return true;}constructor(){constructed++;this.tracks={ready:Promise.resolve(),selectedTrack:{animated:true,frameCount:3,repetitionCount:Infinity}};this.completed=Promise.resolve();}async decode(){decoded++;if(decoded===5)throw Error('second-pass failure');return {complete:true,image:{displayWidth:32,displayHeight:24,duration:100000,close(){framesClosed++;}}};}close(){closed++;}};
  globalThis.OffscreenCanvas=class{constructor(w,h){this.width=w;this.height=h;}getContext(){return {clearRect(){},drawImage(){},getImageData(){const data=new Uint8ClampedArray(32*24*4);for(let i=0;i<data.length;i+=4)data.set([255,0,0,255],i);return {data};}};}};
  try{
    const oversized=Buffer.from(animatedWebp);for(const offset of [24,27])oversized.writeUIntLE(4999,offset,3);
    await assert.rejects(convertAnimatedImage(new Blob([oversized]),65536),/展開量/);assert.equal(constructed,0);
    await assert.rejects(convertAnimatedImage(new Blob([animatedWebp]),65536),/second-pass/);assert.equal(decoded,5);assert.equal(framesClosed,4);assert.equal(closed,1);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
