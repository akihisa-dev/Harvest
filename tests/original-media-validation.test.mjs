import assert from 'node:assert/strict';
import test from 'node:test';
import {mp4Bytes, brokenMedia} from './media-fixtures.mjs';
import {validateOriginalMedia} from '../dist/extension/app/media/original-media-validation.js';
import {prepareMp4} from '../dist/extension/app/media/mp4-conversion.js';
import {fetchOriginalMedia} from '../dist/extension/app/media/media-fetch.js';

function counted(blob) {
  let reads = 0;
  const read = blob.arrayBuffer.bind(blob);
  blob.arrayBuffer = () => {
    reads++;
    return read();
  };
  return {blob, reads: () => reads};
}

test('未検証のMP4は検査し、成功済みの同一Blobだけ再利用する', async () => {
  const first = counted(new Blob([mp4Bytes], {type: 'video/mp4'}));
  assert.equal(await prepareMp4(first.blob), first.blob);
  assert.equal(await prepareMp4(first.blob), first.blob);
  await validateOriginalMedia(first.blob);
  assert.equal(first.reads(), 1);
  const copy = counted(first.blob.slice(0, first.blob.size, 'video/mp4'));
  assert.equal(await prepareMp4(copy.blob), copy.blob);
  assert.equal(copy.reads(), 1, 'same bytes in a different Blob must be validated');
  const signal = AbortSignal.abort();
  await assert.rejects(validateOriginalMedia(first.blob, signal), error => error.kind === 'cancelled');
});

test('不正MP4の直接呼び出しは毎回検査して拒否する', async () => {
  for (const {type, bytes} of Object.values(brokenMedia).filter(entry => entry.type === 'video/mp4')) {
    const input = counted(new Blob([bytes], {type}));
    for (let i = 0; i < 2; i++)
      await assert.rejects(prepareMp4(input.blob), error => error.kind === 'invalid-image');
    assert.equal(input.reads(), 2);
  }
});

test('読み取り失敗と中止を成功として記録せず、同じBlobの再試行を検査する', async () => {
  for (const mode of ['failure', 'cancel']) {
    const blob = new Blob([mp4Bytes], {type: 'video/mp4'});
    const read = blob.arrayBuffer.bind(blob), controller = new AbortController();
    let reads = 0;
    blob.arrayBuffer = async () => {
      reads++;
      if (reads === 1 && mode === 'failure') throw new Error('transient read failure');
      const bytes = await read();
      if (reads === 1 && mode === 'cancel') controller.abort();
      return bytes;
    };
    await assert.rejects(prepareMp4(blob, controller.signal));
    assert.equal(await prepareMp4(blob), blob);
    assert.equal(reads, 2);
    assert.equal(await prepareMp4(blob), blob);
    assert.equal(reads, 2);
  }
});

test('取得からMP4保存準備へ渡す同じBlobは全体読み取りを1回だけ行う', async () => {
  const previousFetch = globalThis.fetch, previousRead = Blob.prototype.arrayBuffer;
  let reads = 0;
  Blob.prototype.arrayBuffer = function() {
    if (this.type === 'video/mp4') reads++;
    return previousRead.call(this);
  };
  globalThis.fetch = async () => new Response(mp4Bytes, {headers: {'content-type': 'video/mp4'}});
  try {
    const blob = await fetchOriginalMedia('https://media.test/valid.mp4', 'video');
    assert.equal(await prepareMp4(blob), blob);
    assert.equal(reads, 1);
  } finally {
    globalThis.fetch = previousFetch;
    Blob.prototype.arrayBuffer = previousRead;
  }
});

test('最後のサンプル読み取り中の中止も成功として記録しない', async () => {
  const {EncodedPacketSink} = await import('../dist/extension/app/vendor/mediabunny/index.js');
  const previous = EncodedPacketSink.prototype.getNextPacket;
  const input = counted(new Blob([mp4Bytes], {type: 'video/mp4'}));
  const controller = new AbortController();
  EncodedPacketSink.prototype.getNextPacket = async function(...args) {
    const packet = await previous.apply(this, args);
    if (packet?.data.byteLength && packet.sequenceNumber === 2) controller.abort();
    return packet;
  };
  try {
    await assert.rejects(prepareMp4(input.blob, controller.signal), error => error.kind === 'cancelled');
  } finally {
    EncodedPacketSink.prototype.getNextPacket = previous;
  }
  assert.equal(await prepareMp4(input.blob), input.blob);
  assert.equal(input.reads(), 2);
});
