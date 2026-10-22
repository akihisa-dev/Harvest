import assert from 'node:assert/strict';
import test from 'node:test';
import {mp4Bytes,fragmentedMp4} from './media-fixtures.mjs';
import {muxYoutube} from '../dist/extension/app/workers/youtube-mux.js';
import {hasCompleteMp4Boxes} from '../dist/extension/core/original-media-structure.js';
import {prepareYoutubeMp4} from '../dist/extension/app/media/youtube-fetch.js';
import {BlobSource,BufferTarget,EncodedAudioPacketSource,EncodedPacket,EncodedPacketSink,Input,MP4,Mp4OutputFormat,Output} from '../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs';

async function audioFixture(frames=13,options={}){
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(options),target}),source=new EncodedAudioPacketSource('aac');
  output.addAudioTrack(source);await output.start();
  for(let i=0;i<frames;i++)await source.add(new EncodedPacket(new Uint8Array([0x21,0x10,0x04,0x60,0x8c,0x1c]),'key',i*1024/44100,1024/44100),{decoderConfig:{codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:2,description:new Uint8Array([0x12,0x10])}});
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
  const durations={videoMs:300,audioMs:300};
  const combined=await muxYoutube(video,audio,durations,65536);
  assert.deepEqual(await packets(combined,'video'),await packets(video,'video'));
  assert.deepEqual(await packets(combined,'audio'),await packets(audio,'audio'));
  await assert.rejects(muxYoutube(video,audio,{videoMs:2000,audioMs:2000},65536),/末尾/);
  await assert.rejects(muxYoutube(video,audio,durations,100),/容量/);
  await assert.rejects(muxYoutube(video,new Blob(['broken']),durations,65536),/不完全/);
});

test('完全に取得済みの映像300msと音声約511msを、別々の終端で確認して結合する',async()=>{
  const video=new Blob([mp4Bytes],{type:'video/mp4'}),audio=await audioFixture(22);
  const durations={videoMs:300,audioMs:22*1024/44100*1000};
  const combined=await muxYoutube(video,audio,durations,65536);
  assert.deepEqual(await packets(combined,'video'),await packets(video,'video'));
  assert.deepEqual(await packets(combined,'audio'),await packets(audio,'audio'));
  await assert.rejects(muxYoutube(video,audio,{...durations,audioMs:1000},65536),/末尾/);
});

test('結合は各入力を1回だけ読み、未照合のサンプルを1件以内に保つ', async t => {
  const video = new Blob([mp4Bytes], {type: 'video/mp4'}), audio = await audioFixture(128);
  const reads = [0, 0];
  for (const [index, blob] of [video, audio].entries()) {
    const read = blob.arrayBuffer.bind(blob);
    t.mock.method(blob, 'arrayBuffer', () => { reads[index]++; return read(); });
    t.mock.method(blob, 'slice', () => { assert.fail('構造検査後に入力Blobを読み直さない'); });
  }
  const {EncodedPacketSink: ProductSink} = await import('../dist/extension/app/vendor/mediabunny/index.js');
  let pending = 0, peak = 0, checked = 0;
  for (const method of ['getFirstPacket', 'getNextPacket']) {
    const original = ProductSink.prototype[method];
    t.mock.method(ProductSink.prototype, method, async function(...args) {
      const packet = await original.apply(this, args);
      const options = args[method === 'getFirstPacket' ? 0 : 1];
      if (packet && options?.metadataOnly) { pending++; peak = Math.max(peak, pending); }
      else if (packet) { pending--; checked++; }
      return packet;
    });
  }
  const combined = await muxYoutube(video, audio, {videoMs: 300, audioMs: 128 * 1024 / 44100 * 1000}, 65536);
  assert.deepEqual(reads, [1, 1]);
  assert.equal(peak, 1);
  assert.equal(pending, 0);
  assert.equal(checked, 131);
  t.mock.restoreAll();
  assert.deepEqual(await packets(combined, 'video'), await packets(video, 'video'));
  assert.deepEqual(await packets(combined, 'audio'), await packets(audio, 'audio'));
});

test('結合でも末尾のサンプル欠落を拒否し、部分的な動画を返さない', async () => {
  const bytes = Buffer.from(mp4Bytes), stsz = bytes.indexOf(Buffer.from('stsz'));
  bytes.writeUInt32BE(bytes.readUInt32BE(stsz + 24) + 100, stsz + 24);
  await assert.rejects(muxYoutube(new Blob([bytes], {type: 'video/mp4'}), await audioFixture(), {videoMs: 300, audioMs: 300}, 65536), /不完全/);
});

test('通常・分割MP4の正常サンプルを保持し、映像・音声のmdat外参照を結合前に拒否する', async () => {
  for (const fragmented of [false, true]) {
    const video = new Blob([fragmented ? fragmentedMp4 : mp4Bytes], {type: 'video/mp4'});
    const audio = await audioFixture(13, fragmented ? {fastStart: 'fragmented'} : {});
    const sources = [video, audio], durations = {videoMs: 300, audioMs: 300};
    const combined = await muxYoutube(video, audio, durations, 65536);
    assert.deepEqual(await packets(combined, 'video'), await packets(video, 'video'));
    assert.deepEqual(await packets(combined, 'audio'), await packets(audio, 'audio'));
    for (const track of [0, 1]) for (const mode of ['header', 'boundary', 'end']) {
      const bytes = Buffer.from(await sources[track].arrayBuffer());
      const mdat = bytes.indexOf(Buffer.from('mdat'));
      assert.ok(mdat > 4);
      const offset = mode === 'header' ? 0 : mode === 'boundary' ? mdat + 2 : mdat - 4 + bytes.readUInt32BE(mdat - 4) - 1;
      if (fragmented) {
        const moof = bytes.indexOf(Buffer.from('moof')) - 4, trun = bytes.indexOf(Buffer.from('trun'));
        assert.ok(moof > 0 && trun > moof);
        bytes.writeInt32BE(offset - moof, trun + 12);
      } else {
        const stco = bytes.indexOf(Buffer.from('stco'));
        assert.ok(stco > 0);
        bytes.writeUInt32BE(offset, stco + 12);
      }
      assert.equal(hasCompleteMp4Boxes(bytes), true, 'box構造だけでは破損を検出できない入力');
      const broken = [...sources];
      broken[track] = new Blob([bytes], {type: sources[track].type});
      await assert.rejects(muxYoutube(broken[0], broken[1], durations, 65536), /不完全/, `${fragmented}/${track}/${mode}`);
    }
  }
});

test('結合Workerは中止・不正な応答・時間切れで終了する',async t=>{
  const old=globalThis.Worker,workers=[];
  globalThis.Worker=class{constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}};
  t.after(()=>{if(old===undefined)delete globalThis.Worker;else globalThis.Worker=old;});
  const video=new Blob([mp4Bytes]),audio=await audioFixture(),controller=new AbortController();
  const durations={videoMs:300,audioMs:300};
  const work=prepareYoutubeMp4(video,audio,durations,controller.signal);controller.abort();await assert.rejects(work,/中止/);assert.equal(workers[0].terminated,true);
  const invalid=prepareYoutubeMp4(video,audio,durations);workers[1].onmessage({data:{blob:new Blob(['not-video'])}});await assert.rejects(invalid,/まとめ/);assert.equal(workers[1].terminated,true);
  t.mock.timers.enable({apis:['setTimeout']});const timed=prepareYoutubeMp4(video,audio,durations);t.mock.timers.tick(120000);await assert.rejects(timed,/タイムアウト/);assert.equal(workers[2].terminated,true);
});
