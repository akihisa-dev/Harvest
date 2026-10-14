import assert from 'node:assert/strict';
import test from 'node:test';
import {fragmentedMp4} from './media-fixtures.mjs';
import {scanYoutube} from '../dist/extension/app/browser/youtube-page-access.js';
import {fetchYoutubeVideo} from '../dist/extension/app/media/youtube-fetch.js';
import {muxYoutube} from '../dist/extension/app/workers/youtube-mux.js';
import {BlobSource,BufferTarget,EncodedAudioPacketSource,EncodedPacket,Input,MP4,Mp4OutputFormat,Output} from '../dist/extension/app/vendor/mediabunny/index.js';
import {videoId,url,video,audio,template,b,n,t,join,part,identity,initialization} from './support/youtube-fixture.mjs';
import {readWire,wireBytes} from '../dist/extension/core/youtube-wire.js';

function split(bytes){let offset=0;while(offset<bytes.length){const size=new DataView(bytes.buffer,bytes.byteOffset+offset).getUint32(0);const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(type==='moof')return [bytes.subarray(0,offset),bytes.subarray(offset)];offset+=size;}throw Error('No fragment');}
async function audioBytes(){
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat({fastStart:'fragmented'}),target}),source=new EncodedAudioPacketSource('aac');output.addAudioTrack(source);await output.start();
  for(let i=0;i<13;i++)await source.add(new EncodedPacket(new Uint8Array([0x21,0x10,0x04,0x60,0x8c,0x1c]),'key',i*1024/44100,1024/44100),{decoderConfig:{codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:2,description:new Uint8Array([0x12,0x10])}});
  source.close();await output.finalize();return new Uint8Array(target.buffer);
}
for(const refresh of [false,true])test(`解析から認証更新・分割取得・音声付きMP4準備まで既存経路で完了する: refresh=${refresh}`,async tctx=>{
  const previous={chrome:globalThis.chrome,fetch:globalThis.fetch,Worker:globalThis.Worker};
  tctx.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const audioData=await audioBytes(),formats=[{...video,height:32,fps:10,durationMs:300,contentLength:fragmentedMp4.length},{...audio,durationMs:300,contentLength:audioData.length}];
  const response=join(formats.flatMap((format,index)=>{
    const [init,media]=split(index===0?fragmentedMp4:audioData);
    const item=(bytes,sequence)=>join([part(20,join([n(1,index),t(2,videoId),b(13,identity(format)),n(8,sequence===0?1:0),n(9,sequence),n(11,0),n(12,sequence===0?0:300),n(14,bytes.length)])),part(21,new Uint8Array([index,...bytes])),part(22,new Uint8Array([index]))]);
    return [initialization(format,1),item(init,0),item(media,1)];
  }));
  const address=`https://www.youtube.com/watch?v=${videoId}`,closed=[],captures=[],workers=[];let windowId=0,requests=0;
  const event=()=>({addListener(){},removeListener(){}});
  globalThis.chrome={windows:{create:async()=>({id:++windowId,tabs:[{id:windowId}]}),remove:async id=>closed.push(id)},tabs:{get:async()=>({status:'complete'}),onRemoved:event(),onUpdated:event()},scripting:{executeScript:async request=>{
    if(request.func.name!=='readYoutubePage')return [{documentId:'doc',result:address}];
    captures.push(request.args[1]);return [{documentId:'doc',result:{videoId,title:'fixture',previewUrl:'',formats,...(request.args[1]?{capture:{url,body:[...template]}}:{})}}];
  }}};
  globalThis.Worker=class{constructor(){workers.push(this);}terminate(){this.terminated=true;}postMessage(request){void muxYoutube(request.video,request.audio,request.durationMs,request.maxBytes).then(blob=>{if(!this.terminated)this.onmessage({data:{blob}});}).catch(error=>this.onmessage({data:{error:error.message}}));}};
  globalThis.fetch=async(endpoint,options)=>{
    requests++;assert.equal(new URL(endpoint).hostname,'r1-test.googlevideo.com');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.equal(wireBytes(readWire(wireBytes(readWire(options.body),19)),2).length,32);
    return refresh&&requests===1?new Response('',{status:403}):new Response(response,{headers:{'content-type':'application/vnd.yt-ump'}});
  };
  const scan=await scanYoutube(videoId),source=scan.media[0].youtube;
  assert.equal('capture' in source,false);const blob=await fetchYoutubeVideo(source);
  const input=new Input({formats:[MP4],source:new BlobSource(blob)});
  try{assert.ok(await input.getPrimaryVideoTrack());assert.ok(await input.getPrimaryAudioTrack());}finally{input.dispose();}
  assert.deepEqual(captures,refresh?[false,true,true]:[false,true]);assert.deepEqual(closed,refresh?[1,2,3]:[1,2]);assert.equal(workers[0].terminated,true);
});
