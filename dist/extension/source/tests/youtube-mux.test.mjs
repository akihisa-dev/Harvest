import assert from 'node:assert/strict';
import test from 'node:test';
import {mp4Bytes} from './media-fixtures.mjs';
import {muxYoutube} from '../dist/extension/app/workers/youtube-mux.js';
import {prepareYoutubeMp4} from '../dist/extension/app/media/youtube-fetch.js';
import {BlobSource,BufferTarget,EncodedAudioPacketSource,EncodedPacket,EncodedPacketSink,Input,MP4,Mp4OutputFormat,Output} from '../dist/extension/app/vendor/mediabunny/index.js';

async function audioFixture(){
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target}),source=new EncodedAudioPacketSource('aac');
  output.addAudioTrack(source);await output.start();
  for(let i=0;i<13;i++)await source.add(new EncodedPacket(new Uint8Array([0x21,0x10,0x04,0x60,0x8c,0x1c]),'key',i*1024/44100,1024/44100),{decoderConfig:{codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:2,description:new Uint8Array([0x12,0x10])}});
  source.close();await output.finalize();return new Blob([target.buffer],{type:'audio/mp4'});
}
async function packets(blob,kind){
  const input=new Input({formats:[MP4],source:new BlobSource(blob)});
  try{const track=kind==='video'?await input.getPrimaryVideoTrack():await input.getPrimaryAudioTrack();assert.ok(track);
    const result=[];for await(const p of new EncodedPacketSink(track).packets())result.push({data:[...p.data],timestamp:p.timestamp,duration:p.duration});return result;
  }finally{input.dispose();}
}
test('MP4結合は映像と音声の圧縮データ・表示時間・末尾を保持する',async()=>{
  const video=new Blob([mp4Bytes],{type:'video/mp4'}),audio=await audioFixture();
  const combined=await muxYoutube(video,audio,300,65536);
  assert.deepEqual(await packets(combined,'video'),await packets(video,'video'));
  assert.deepEqual(await packets(combined,'audio'),await packets(audio,'audio'));
  await assert.rejects(muxYoutube(video,audio,2000,65536),/末尾/);
  await assert.rejects(muxYoutube(video,audio,300,100),/容量/);
  await assert.rejects(muxYoutube(video,new Blob(['broken']),300,65536),/不完全/);
});

test('結合Workerは中止・不正な応答・時間切れで終了する',async t=>{
  const old=globalThis.Worker,workers=[];
  globalThis.Worker=class{constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}};
  t.after(()=>{if(old===undefined)delete globalThis.Worker;else globalThis.Worker=old;});
  const video=new Blob([mp4Bytes]),audio=await audioFixture(),controller=new AbortController();
  const work=prepareYoutubeMp4(video,audio,300,controller.signal);controller.abort();await assert.rejects(work,/中止/);assert.equal(workers[0].terminated,true);
  const invalid=prepareYoutubeMp4(video,audio,300);workers[1].onmessage({data:{blob:new Blob(['not-video'])}});await assert.rejects(invalid,/まとめ/);assert.equal(workers[1].terminated,true);
  t.mock.timers.enable({apis:['setTimeout']});const timed=prepareYoutubeMp4(video,audio,300);t.mock.timers.tick(120000);await assert.rejects(timed,/タイムアウト/);assert.equal(workers[2].terminated,true);
});
