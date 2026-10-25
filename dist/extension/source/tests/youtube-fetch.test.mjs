import assert from 'node:assert/strict';
import test from 'node:test';
import {fragmentedMp4} from './media-fixtures.mjs';
import {scanYoutube} from '../dist/extension/app/browser/youtube-page-access.js';
import {fetchYoutubeVideo} from '../dist/extension/app/media/youtube-fetch.js';
import {muxYoutube} from '../dist/extension/app/workers/youtube-mux.js';
import {BlobSource,BufferTarget,EncodedAudioPacketSource,EncodedPacket,Input,MP4,Mp4OutputFormat,Output} from '../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs';
import {videoId,url,video,audio,template,b,n,t,join,part,identity,initialization} from './support/youtube-fixture.mjs';
import {readWire,wireBytes,wireNumber} from '../dist/extension/core/youtube-wire.js';

function split(bytes){let offset=0;while(offset<bytes.length){const size=new DataView(bytes.buffer,bytes.byteOffset+offset).getUint32(0);const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(type==='moof')return [bytes.subarray(0,offset),bytes.subarray(offset)];offset+=size;}throw Error('No fragment');}
async function audioBytes(frames=13){
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat({fastStart:'fragmented'}),target}),source=new EncodedAudioPacketSource('aac');output.addAudioTrack(source);await output.start();
  for(let i=0;i<frames;i++)await source.add(new EncodedPacket(new Uint8Array([0x21,0x10,0x04,0x60,0x8c,0x1c]),'key',i*1024/44100,1024/44100),{decoderConfig:{codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:2,description:new Uint8Array([0x12,0x10])}});
  source.close();await output.finalize();return new Uint8Array(target.buffer);
}
for(const {refresh,chunked,differentDurations,backoff=0,corrupt,audioOnly=false} of [
  {refresh:false,chunked:false,differentDurations:false,audioOnly:true},
  {refresh:false,chunked:false,differentDurations:false,audioOnly:true,corrupt:"audio"},
  {refresh:false,chunked:false,differentDurations:false},
  {refresh:true,chunked:false,differentDurations:false},
  {refresh:false,chunked:true,differentDurations:false},
  {refresh:false,chunked:false,differentDurations:true},
  {refresh:false,chunked:true,differentDurations:false,backoff:120},
  {refresh:false,chunked:false,differentDurations:false,corrupt:'video'},
  {refresh:false,chunked:false,differentDurations:false,corrupt:'audio'},
])test(`${corrupt ? `配信から受け取った${corrupt}のmdat外参照を保存準備で拒否する` : '解析から音声付きMP4準備まで完了する'}: refresh=${refresh}, chunked=${chunked}, differentDurations=${differentDurations}, backoff=${backoff}, audioOnly=${audioOnly}`,async tctx=>{
  const previous={chrome:globalThis.chrome,fetch:globalThis.fetch,Worker:globalThis.Worker};
  tctx.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const audioFrames=differentDurations?22:13,audioData=Buffer.from(await audioBytes(audioFrames)),videoData=Buffer.from(fragmentedMp4);
  if(corrupt){
    const bytes=corrupt==='video'?videoData:audioData,moof=bytes.indexOf(Buffer.from('moof'))-4,trun=bytes.indexOf(Buffer.from('trun'));
    assert.ok(moof>0&&trun>moof);bytes.writeInt32BE(-moof,trun+12);
  }
  const formats=[{...video,height:32,fps:10,durationMs:300,contentLength:audioOnly?108*1024*1024:fragmentedMp4.length},{...audio,durationMs:differentDurations?Math.ceil(audioFrames*1024/44100*1000):300,contentLength:audioData.length}];
  const header=(format,index,sequence,size)=>part(20,join([n(1,index),t(2,videoId),b(13,identity(format)),n(8,sequence===0?1:0),n(9,sequence),n(11,0),n(12,sequence===0?0:format.durationMs),n(14,size)]));
  const trackParts=formats.map((format,index)=>{
    const [init,media]=split(index===0?videoData:audioData);
    const item=(bytes,sequence)=>join([header(format,index,sequence,bytes.length),part(21,new Uint8Array([index,...bytes])),part(22,new Uint8Array([index]))]);
    return [initialization(format,1),item(init,0),item(media,1)];
  });
  let responses=[join((audioOnly?[trackParts[1]]:trackParts).flat())];
  if(chunked){
    const media=split(fragmentedMp4)[1],chunkSize=Math.ceil(media.length/12);
    responses=[join([...trackParts[1],...trackParts[0].slice(0,2),header(formats[0],0,1,media.length)])];
    for(let offset=0;offset<media.length;offset+=chunkSize){
      const chunk=media.subarray(offset,offset+chunkSize);
      responses.push(join([part(21,new Uint8Array([0,...chunk])),...(offset+chunkSize>=media.length?[part(22,new Uint8Array([0]))]:[])]));
    }
    assert.ok(responses.length>7);
  }
  if(backoff)responses[0]=join([part(35,n(4,backoff)),responses[0]]);
  const address=`https://www.youtube.com/watch?v=${videoId}`,closed=[],captures=[],workers=[];let requests=0,responseIndex=0;
  let waiting=false,serverWaits=0,unneededWaits=0;
  const event=()=>({addListener(){},removeListener(){}});
  globalThis.chrome={windows:{create:async()=>{throw new Error('No new window');}},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/'}],create:async()=>{throw new Error('No new tab');},remove:async()=>{throw new Error('Do not close host tab');},get:async()=>({status:'complete'}),onRemoved:event(),onUpdated:event()},scripting:{executeScript:async request=>{
    if(request.func.name==='manageYoutubeFrame'){if(request.args[2])closed.push(closed.length+1);return [{documentId:'host',result:address}];}
    if(request.target.documentIds)return [{documentId:'doc',result:true}];
    if(request.func.name!=='readYoutubePage')return [{documentId:'host',result:address}];
    captures.push(request.args[1]);return [{documentId:'doc',result:{videoId,title:'fixture',previewUrl:'',formats,...(request.args[1]?{capture:{url,body:[...template]}}:{})}}];
  }}};
  globalThis.Worker=class{constructor(){workers.push(this);}terminate(){this.terminated=true;}postMessage(request){this.request=request;void muxYoutube(request.video,request.audio,request.durations,request.maxBytes).then(blob=>{if(!this.terminated)this.onmessage({data:{blob}});}).catch(error=>this.onmessage({data:{error:error.message}}));}};
  globalThis.fetch=async(endpoint,options)=>{
    assert.equal(waiting,false,'配信先の待機指示が終わるまで次を要求しない');
    requests++;assert.equal(new URL(endpoint).hostname,'r1-test.googlevideo.com');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.equal(wireBytes(readWire(wireBytes(readWire(options.body),19)),2).length,32);
    assert.equal(wireNumber(readWire(wireBytes(readWire(options.body),1)),40),audioOnly?1:0);
    if(audioOnly)assert.equal(wireBytes(readWire(options.body),17),undefined);
    if(refresh&&requests===1)return new Response('',{status:403});
    assert.ok(responseIndex<responses.length,'取得済みの区間を追加要求しない');
    return new Response(responses[responseIndex++],{headers:{'content-type':'application/vnd.yt-ump'}});
  };
  const scan=await scanYoutube(videoId),source=scan.media[0].youtube;
  const schedule=globalThis.setTimeout;
  tctx.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{
    if(ms===0&&responseIndex>0&&responseIndex<responses.length)unneededWaits++;
    if(backoff&&ms===backoff){serverWaits++;waiting=true;return schedule(()=>{waiting=false;callback(...args);},0);}
    return schedule(callback,ms,...args);
  });
  assert.equal('capture' in source,false);const progress=[];
  if(corrupt){
    await assert.rejects(fetchYoutubeVideo(source,undefined,value=>progress.push(value),audioOnly),/YouTube動画の映像と音声をまとめられませんでした/);
    assert.ok(progress.length>0&&progress.every(value=>value<1),'破損入力で保存準備完了を通知しない');
    assert.equal(workers[0].terminated,true);assert.deepEqual(closed,[1,2]);
    return;
  }
  const blob=await fetchYoutubeVideo(source,undefined,value=>progress.push(value),audioOnly);
  assert.equal(unneededWaits,0,'受信が進んでいれば不要なタイマー待機を挟まない');
  assert.equal(serverWaits,backoff?responses.length-1:0,'配信先の待機指示は全応答で維持する');
  assert.ok(progress.length > 1);assert.equal(progress.at(-1),1);
  assert.ok(progress.every(value=>Number.isFinite(value)&&value>=0&&value<=1));
  if(chunked)assert.ok(progress.some(value=>value>0&&value<.95),'受信途中にも進捗を通知する');
  const input=new Input({formats:[MP4],source:new BlobSource(blob)});
  try{assert.equal(Boolean(await input.getPrimaryVideoTrack()),!audioOnly);assert.ok(await input.getPrimaryAudioTrack());}finally{input.dispose();}
  assert.deepEqual(captures,refresh?[false,true,true]:[false,true]);assert.deepEqual(closed,refresh?[1,2,3]:[1,2]);assert.equal(workers[0].terminated,true);
  assert.deepEqual(workers[0].request.durations,{videoMs:audioOnly?0:300,audioMs:formats[1].durationMs});
});

test('受信が進まない状態は応答回数でなく30秒の経過で中止し、認証用フレームも残さない',async tctx=>{
  const previous={chrome:globalThis.chrome,fetch:globalThis.fetch,performance:globalThis.performance,setTimeout:globalThis.setTimeout};
  tctx.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  let now=0,requests=0;const closed=[],address=`https://www.youtube.com/watch?v=${videoId}`;
  globalThis.performance={now:()=>now};
  globalThis.setTimeout=(callback,ms,...args)=>{if(ms===500){queueMicrotask(()=>{now+=500;callback(...args);});return -1;}return previous.setTimeout(callback,ms,...args);};
  const event=()=>({addListener(){},removeListener(){}});
  globalThis.chrome={windows:{create:async()=>{throw new Error('No new window');}},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/'}],create:async()=>{throw new Error('No new tab');},remove:async()=>{throw new Error('Do not close host tab');},get:async()=>({status:'complete'}),onRemoved:event(),onUpdated:event()},scripting:{executeScript:async request=>{
    if(request.func.name==='manageYoutubeFrame'){if(request.args[2])closed.push(1);return [{documentId:'host',result:address}];}
    if(request.target.documentIds)return [{documentId:'doc',result:true}];
    return request.func.name==='readYoutubePage'?[{documentId:'doc',result:{videoId,title:'fixture',previewUrl:'',formats:[video,audio],capture:{url,body:[...template]}}}]:[{documentId:'host',result:address}];
  }}};
  globalThis.fetch=async()=>{requests++;return new Response(part(35,new Uint8Array()),{headers:{'content-type':'application/vnd.yt-ump'}});};
  await assert.rejects(fetchYoutubeVideo({videoId,quality:'1080p'}),/継続/);
  assert.ok(requests>6);assert.equal(now,30000);assert.deepEqual(closed,[1]);
});

for(const outcome of ['timeout','abort'])test(`認証の読み取りが応答しなくても準備全体の期限・中止で戻り、後続取得を始めない: ${outcome}`,async t=>{
  const previous={chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,fetch:globalThis.fetch};
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  let deadline,finishRead,requests=0,cleared=false;
  const token={};
  globalThis.setTimeout=(callback,ms,...args)=>{if(ms===120000){assert.equal(deadline,undefined,'共通の期限は1回だけ設定する');deadline=callback;return token;}return previous.setTimeout(callback,ms,...args);};
  globalThis.clearTimeout=handle=>{if(handle===token)cleared=true;else previous.clearTimeout(handle);};
  const listeners=new Set(),event={addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)};
  globalThis.chrome={tabs:{query:async()=>[{id:1,url:`https://www.youtube.com/watch?v=${videoId}`}],onRemoved:event},scripting:{executeScript:async()=>new Promise(resolve=>{finishRead=resolve;})}};
  globalThis.fetch=async()=>{requests++;throw Error('Must not fetch after timeout');};
  const controller=new AbortController();
  const result=fetchYoutubeVideo({videoId,quality:'1080p'},controller.signal);
  await new Promise(resolve=>setImmediate(resolve));
  if(outcome==='timeout')deadline();else controller.abort();
  await assert.rejects(result,outcome==='timeout'?/タイムアウト/:/中止/);
  assert.equal(cleared,true);assert.equal(listeners.size,0);
  finishRead([{documentId:'doc',result:{videoId,title:'late',previewUrl:'',formats:[video,audio],capture:{url,body:[...template]}}}]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,0);
});
