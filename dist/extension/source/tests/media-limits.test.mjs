import assert from 'node:assert/strict';
import test from 'node:test';
import {MAX_MEDIA_BYTES} from '../dist/extension/core/media-limits.js';
import {joinBytes} from '../dist/extension/core/youtube-wire.js';
import {readImageBytes,readMediaBytes} from '../dist/extension/app/media/image-response-bytes.js';
import {fetchOriginalMedia} from '../dist/extension/app/media/media-fetch.js';
import {prepareMp4} from '../dist/extension/app/media/mp4-conversion.js';
import {isAudioConversionRequest,isYoutubeMuxRequest} from '../dist/extension/app/contracts/worker-contracts.js';
import {mp4Bytes} from './media-fixtures.mjs';

const response = bytes => new Response(new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),{headers:{'content-type':'video/mp4','content-length':String(bytes.length)}});

test('108 MiBの正常なMP4を取得・検査・保存準備し、YouTubeの結合用バイト列でも64 MiBを超えられる',async t=>{
  // A valid free box makes the input large without inventing millions of samples.
  const free=new Uint8Array(108*1024*1024-mp4Bytes.length);
  new DataView(free.buffer).setUint32(0,free.length);free.set([102,114,101,101],4);free[free.length-1]=7;
  const bytes=joinBytes([new Uint8Array(mp4Bytes),free]);
  assert.equal(bytes.length,108*1024*1024);assert.equal(bytes.at(-1),7);
  t.mock.method(globalThis,'fetch',async()=>response(bytes));
  const blob=await fetchOriginalMedia('https://example.test/large.mp4','video');
  assert.equal(blob.size,bytes.length);assert.equal(await prepareMp4(blob),blob);
});

test('画像は64 MiBを維持し、動画・音声は512 MiB超過を本文取得前と受信中に拒否する',async()=>{
  const stream=()=>new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));controller.enqueue(new Uint8Array([4,5]));controller.close();}});
  await assert.rejects(readMediaBytes(new Response(stream()),4));
  const declared=size=>new Response(new Uint8Array([1]),{headers:{'content-length':String(size)}});
  await assert.rejects(readImageBytes(declared(64*1024*1024+1),MAX_MEDIA_BYTES));
  await assert.rejects(readMediaBytes(declared(MAX_MEDIA_BYTES+1)));
  assert.deepEqual([...await readMediaBytes(declared(108*1024*1024))],[1]);
  for(const limit of [0,-1,NaN,Infinity,1.5])await assert.rejects(readMediaBytes(declared(1),limit),RangeError);
  const blob=new Blob(['fixture'],{type:'video/mp4'}),audio=new Blob(['audio'],{type:'audio/mp4'});
  assert.equal(isAudioConversionRequest({blob,maxBytes:MAX_MEDIA_BYTES}),true);
  assert.equal(isAudioConversionRequest({blob,maxBytes:MAX_MEDIA_BYTES+1}),false);
  assert.equal(isYoutubeMuxRequest({video:blob,audio,durations:{videoMs:1,audioMs:1},maxBytes:MAX_MEDIA_BYTES}),true);
  assert.equal(isYoutubeMuxRequest({video:blob,audio,durations:{videoMs:1,audioMs:1},maxBytes:MAX_MEDIA_BYTES+1}),false);
});
