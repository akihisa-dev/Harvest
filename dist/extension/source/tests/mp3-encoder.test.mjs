import assert from 'node:assert/strict';
import test from 'node:test';
import {Mp3Encoder} from '../dist/extension/core/mp3-encoder.js';
import {isAudioConversionRequest, isAudioConversionReply} from '../dist/extension/app/contracts/worker-contracts.js';

function frameLengths(bytes, channels, rate) {
  const lengths = [];
  for (let at = 0; at < bytes.length;) {
    assert.equal(bytes[at], 255); assert.equal(bytes[at + 1], 251, 'MPEG-1 Layer III');
    assert.equal(bytes[at + 2] >>> 4, 14, '320 kbps');
    assert.equal((bytes[at + 3] >>> 6) === 3, channels === 1);
    assert.equal((bytes[at + 2] >>> 2) & 3, [44100, 48000, 32000].indexOf(rate));
    assert.equal(bytes[at + 4], 0); assert.equal(bytes[at + 5] >>> 7, 0, 'no external bit reservoir');
    const length = Math.floor(144 * 320000 / rate) + ((bytes[at + 2] >>> 1) & 1);
    lengths.push(length); at += length; assert.ok(at <= bytes.length);
  }
  return lengths;
}

test('MP3は入力の分割単位によらず全サンプルを同じフレームへ符号化する', async () => {
  for (const rate of [32000, 44100, 48000]) for (const channels of [1, 2]) {
    const planes = Array.from({length: channels}, (_, ch) => Float32Array.from({length: 4731}, (_, i) => .2 * Math.sin(i * (ch + 1) * .17)));
    const whole = new Mp3Encoder(rate, channels, 100000), chunked = new Mp3Encoder(rate, channels, 100000);
    whole.add(planes);
    for (let at = 0; at < planes[0].length; at += 137) chunked.add(planes.map(plane => plane.subarray(at, at + 137)));
    const a = whole.finish(), b = chunked.finish();
    assert.equal(a.type, 'audio/mpeg');
    const bytes = new Uint8Array(await a.arrayBuffer());
    assert.deepEqual(new Uint8Array(await b.arrayBuffer()), bytes);
    assert.equal(frameLengths(bytes, channels, rate).length, Math.ceil(planes[0].length / 1152) + 1);
    assert.throws(() => chunked.finish()); assert.throws(() => chunked.add(planes));
  }
});

test('MP3は未対応入力、不正なPCM、空結果と上限超過を拒否する', () => {
  for (const [rate, channels] of [[22050, 1], [96000, 2], [48000, 6]]) assert.throws(() => new Mp3Encoder(rate, channels, 10000), /対応/);
  for (const limit of [0, NaN, Infinity, -1]) assert.throws(() => new Mp3Encoder(48000, 1, limit), /上限/);
  assert.throws(() => new Mp3Encoder(48000, 1, 10000).finish(), /空/);
  assert.throws(() => new Mp3Encoder(48000, 2, 10000).add([new Float32Array(10)]), /不正/);
  assert.throws(() => new Mp3Encoder(48000, 1, 10000).add([new Float32Array([NaN])]), /不正/);
  const bounded = new Mp3Encoder(48000, 1, 959);
  assert.throws(() => bounded.add([new Float32Array(1152)]), /上限/);
});

test('音声Workerの要求は動画入力だけ、返答はMP3だけを許可する', () => {
  const input = new Blob(['source'], {type: 'video/mp4'}), audio = new Blob(['mp3'], {type: 'audio/mpeg'});
  assert.equal(isAudioConversionRequest({blob: input, maxBytes: 100}), true);
  for (const value of [null, {}, {blob: audio, maxBytes: 100}, {blob: input, maxBytes: Infinity}, {blob: input, maxBytes: 64 * 1024 * 1024 + 1}]) assert.equal(isAudioConversionRequest(value), false);
  assert.equal(isAudioConversionReply({blob: audio}), true);
  assert.equal(isAudioConversionReply({error: 'failure'}), true);
  for (const value of [null, {}, {blob: input}, {blob: audio, error: 'failure'}, {blob: new Blob([], {type:'audio/mpeg'})}]) assert.equal(isAudioConversionReply(value), false);
});


test('音声の変換中止と不正応答ではWorkerを解放し、成功扱いにしない', async () => {
  const {prepareAudio} = await import('../dist/extension/app/media/audio-conversion.js');
  const previous = globalThis.Worker; let worker;
  globalThis.Worker = class {
    constructor() {worker = this;}
    postMessage() {}
    terminate() {this.terminated = true;}
  };
  try {
    const input = new Blob(['source'], {type: 'video/mp4'});
    const controller = new AbortController(), pending = prepareAudio(input, controller.signal);
    controller.abort(); await assert.rejects(pending, {name: 'AbortError'});
    assert.equal(worker.terminated, true);
    for (const data of [null, {blob: input}, {blob: new Blob(['too large'], {type:'audio/mpeg'})}]) {
      const next = prepareAudio(input, undefined, 1); worker.onmessage({data});
      await assert.rejects(next); assert.equal(worker.terminated, true);
    }
  } finally {globalThis.Worker = previous;}
});
