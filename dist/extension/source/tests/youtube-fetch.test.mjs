import assert from 'node:assert/strict';
import test from 'node:test';
import {fragmentedMp4} from './media-fixtures.mjs';
import {scanYoutube} from '../dist/extension/app/browser/youtube-page-access.js';
import {fetchYoutubeVideo} from '../dist/extension/app/media/youtube-fetch.js';
import {muxYoutube} from '../dist/extension/app/workers/youtube-mux.js';
import {BlobSource,BufferTarget,EncodedAudioPacketSource,EncodedPacket,Input,MP4,Mp4OutputFormat,Output} from '../dist/extension/app/vendor/mediabunny/index.js';
import {videoId,url,video,audio,template,b,n,t,join,part,identity,initialization} from './support/youtube-fixture.mjs';
import {readWire,wireBytes,wireNumber} from '../dist/extension/core/youtube-wire.js';

function split(bytes){let offset=0;while(offset<bytes.length){const size=new DataView(bytes.buffer,bytes.byteOffset+offset).getUint32(0);const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(type==='moof')return [bytes.subarray(0,offset),bytes.subarray(offset)];offset+=size;}throw Error('No fragment');}
async function audioBytes(frames=13){
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat({fastStart:'fragmented'}),target}),source=new EncodedAudioPacketSource('aac');output.addAudioTrack(source);await output.start();
  for(let i=0;i<frames;i++)await source.add(new EncodedPacket(new Uint8Array([0x21,0x10,0x04,0x60,0x8c,0x1c]),'key',i*1024/44100,1024/44100),{decoderConfig:{codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:2,description:new Uint8Array([0x12,0x10])}});
  source.close();await output.finalize();return new Uint8Array(target.buffer);
}
for(const {refresh,chunked,differentDurations} of [
  {refresh:false,chunked:false,differentDurations:false},
  {refresh:true,chunked:false,differentDurations:false},
  {refresh:false,chunked:true,differentDurations:false},
  {refresh:false,chunked:false,differentDurations:true},
])test(`解析から音声付きMP4準備まで完了する: refresh=${refresh}, chunked=${chunked}, differentDurations=${differentDurations}`,async tctx=>{
  const previous={chrome:globalThis.chrome,fetch:globalThis.fetch,Worker:globalThis.Worker};
  tctx.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const audioFrames=differentDurations?22:13,audioData=await audioBytes(audioFrames);
  const formats=[{...video,height:32,fps:10,durationMs:300,contentLength:fragmentedMp4.length},{...audio,durationMs:differentDurations?Math.ceil(audioFrames*1024/44100*1000):300,contentLength:audioData.length}];
  const header=(format,index,sequence,size)=>part(20,join([n(1,index),t(2,videoId),b(13,identity(format)),n(8,sequence===0?1:0),n(9,sequence),n(11,0),n(12,sequence===0?0:format.durationMs),n(14,size)]));
  const trackParts=formats.map((format,index)=>{
    const [init,media]=split(index===0?fragmentedMp4:audioData);
    const item=(bytes,sequence)=>join([header(format,index,sequence,bytes.length),part(21,new Uint8Array([index,...bytes])),part(22,new Uint8Array([index]))]);
    return [initialization(format,1),item(init,0),item(media,1)];
  });
  let responses=[join(trackParts.flat())];
  if(chunked){
    const media=split(fragmentedMp4)[1],chunkSize=Math.ceil(media.length/12);
    responses=[join([...trackParts[1],...trackParts[0].slice(0,2),header(formats[0],0,1,media.length)])];
    for(let offset=0;offset<media.length;offset+=chunkSize){
      const chunk=media.subarray(offset,offset+chunkSize);
      responses.push(join([part(21,new Uint8Array([0,...chunk])),...(offset+chunkSize>=media.length?[part(22,new Uint8Array([0]))]:[])]));
    }
    assert.ok(responses.length>7);
  }
  const address=`https://www.youtube.com/watch?v=${videoId}`,closed=[],captures=[],workers=[];let tabId=0,requests=0,responseIndex=0;
  const event=()=>({addListener(){},removeListener(){}});
  globalThis.chrome={windows:{create:async()=>{throw new Error('No new window');}},tabs:{create:async options=>{assert.equal(options.active,false);return {id:++tabId};},remove:async id=>closed.push(id),get:async()=>({status:'complete'}),onRemoved:event(),onUpdated:event()},scripting:{executeScript:async request=>{
    if(request.func.name!=='readYoutubePage')return [{documentId:'doc',result:address}];
    captures.push(request.args[1]);return [{documentId:'doc',result:{videoId,title:'fixture',previewUrl:'',formats,...(request.args[1]?{capture:{url,body:[...template]}}:{})}}];
  }}};
  globalThis.Worker=class{constructor(){workers.push(this);}terminate(){this.terminated=true;}postMessage(request){this.request=request;void muxYoutube(request.video,request.audio,request.durations,request.maxBytes).then(blob=>{if(!this.terminated)this.onmessage({data:{blob}});}).catch(error=>this.onmessage({data:{error:error.message}}));}};
  globalThis.fetch=async(endpoint,options)=>{
    requests++;assert.equal(new URL(endpoint).hostname,'r1-test.googlevideo.com');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.equal(wireBytes(readWire(wireBytes(readWire(options.body),19)),2).length,32);
    assert.equal(wireNumber(readWire(wireBytes(readWire(options.body),1)),40),0);
    if(refresh&&requests===1)return new Response('',{status:403});
    assert.ok(responseIndex<responses.length,'取得済みの区間を追加要求しない');
    return new Response(responses[responseIndex++],{headers:{'content-type':'application/vnd.yt-ump'}});
  };
  const scan=await scanYoutube(videoId),source=scan.media[0].youtube;
  assert.equal('capture' in source,false);const blob=await fetchYoutubeVideo(source);
  const input=new Input({formats:[MP4],source:new BlobSource(blob)});
  try{assert.ok(await input.getPrimaryVideoTrack());assert.ok(await input.getPrimaryAudioTrack());}finally{input.dispose();}
  assert.deepEqual(captures,refresh?[false,true,true]:[false,true]);assert.deepEqual(closed,refresh?[1,2,3]:[1,2]);assert.equal(workers[0].terminated,true);
  assert.deepEqual(workers[0].request.durations,{videoMs:300,audioMs:formats[1].durationMs});
});

test('受信が進まない状態は応答回数でなく30秒の経過で中止し、認証用ページも残さない',async tctx=>{
  const previous={chrome:globalThis.chrome,fetch:globalThis.fetch,performance:globalThis.performance,setTimeout:globalThis.setTimeout};
  tctx.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  let now=0,requests=0;const closed=[],address=`https://www.youtube.com/watch?v=${videoId}`;
  globalThis.performance={now:()=>now};
  globalThis.setTimeout=(callback,ms,...args)=>{if(ms===500){queueMicrotask(()=>{now+=500;callback(...args);});return -1;}return previous.setTimeout(callback,ms,...args);};
  const event=()=>({addListener(){},removeListener(){}});
  globalThis.chrome={windows:{create:async()=>{throw new Error('No new window');}},tabs:{create:async()=>({id:1}),remove:async id=>closed.push(id),get:async()=>({status:'complete'}),onRemoved:event(),onUpdated:event()},scripting:{executeScript:async request=>request.func.name==='readYoutubePage'
    ?[{documentId:'doc',result:{videoId,title:'fixture',previewUrl:'',formats:[video,audio],capture:{url,body:[...template]}}}]:[{documentId:'doc',result:address}]}};
  globalThis.fetch=async()=>{requests++;return new Response(part(35,new Uint8Array()),{headers:{'content-type':'application/vnd.yt-ump'}});};
  await assert.rejects(fetchYoutubeVideo({videoId,quality:'1080p'}),/継続/);
  assert.ok(requests>6);assert.equal(now,30000);assert.deepEqual(closed,[1]);
});
