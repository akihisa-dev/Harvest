import {mp4Bytes} from './media-fixtures.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareMp4} from '../dist/extension/app/media/mp4-conversion.js';

const webm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], {type: 'video/webm'});

test('MP4は同じBlobを返し、GIFを動画へ変換しない', async () => {
  const mp4 = new Blob([mp4Bytes], {type: 'video/mp4'});
  assert.equal(await prepareMp4(mp4), mp4);
  await assert.rejects(prepareMp4(new Blob(['original'], {type: 'video/mp4'})), /不完全|破損/);
  await assert.rejects(prepareMp4(new Blob(['GIF89a'], {type: 'image/gif'})), /形式が一致しません/);
});

test('変換Workerは完了・失敗・中止・時間切れで終了し、再試行は新しいWorkerを使う', async () => {
  const previous = {Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  const workers = [];
  let timeoutCallback;
  let timers = 0;
  globalThis.Worker = class {
    constructor() {
      this.terminated = false;
      workers.push(this);
    }
    postMessage(request) { this.request = request; }
    terminate() { this.terminated = true; }
  };
  globalThis.setTimeout = callback => {
    timeoutCallback = callback;
    timers++;
    return timers;
  };
  globalThis.clearTimeout = () => { timers--; };
  try {
    const successful = prepareMp4(webm, undefined, 1024);
    const result = new Blob(['converted'], {type: 'video/mp4'});
    workers[0].onmessage({data: {blob: result}});
    assert.equal(await successful, result);
    assert.equal(workers[0].terminated, true);
    assert.equal(timers, 0);
    assert.equal(workers[0].request.maxBytes, 1024);

    const failed = prepareMp4(webm);
    workers[1].onmessage({data: {error: '変換に失敗'}});
    await assert.rejects(failed, /変換に失敗/);
    assert.equal(workers[1].terminated, true);

    const controller = new AbortController();
    const cancelled = prepareMp4(webm, controller.signal);
    controller.abort();
    await assert.rejects(cancelled, {name: 'AbortError'});
    assert.equal(workers[2].terminated, true);

    const timedOut = prepareMp4(webm);
    timeoutCallback();
    await assert.rejects(timedOut, /タイムアウト/);
    assert.equal(workers[3].terminated, true);
    assert.equal(timers, 0);
    assert.throws(() => prepareMp4(webm, controller.signal), error => error.kind === 'cancelled');
    assert.equal(workers.length, 4);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
