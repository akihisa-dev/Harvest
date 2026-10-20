import assert from 'node:assert/strict';
import test from 'node:test';
import {validateWebm} from '../dist/extension/app/media/webm-validation.js';

test('WebM検査Workerは既存bufferを転送し、完了・失敗・中止・期限で終了する', async t => {
  const workers = [];
  let timer;
  t.mock.method(globalThis, 'setTimeout', callback => {timer = callback; return 1;});
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', {configurable: true, value: class {
    constructor() {workers.push(this);}
    postMessage(bytes, transfer) {this.bytes = bytes; this.transfer = transfer;}
    terminate() {this.terminated = true;}
  }});
  t.after(() => {if (saved) Object.defineProperty(globalThis, 'Worker', saved); else delete globalThis.Worker;});
  for (const result of [true, false, 'bad']) {
    const bytes = new Uint8Array(10), promise = validateWebm(bytes), worker = workers.at(-1);
    assert.equal(worker.bytes, bytes.buffer); assert.equal(worker.transfer[0], bytes.buffer);
    worker.onmessage({data: result});
    if (typeof result === 'boolean') assert.equal(await promise, result); else await assert.rejects(promise, /不正/);
    assert.ok(worker.terminated);
  }
  let promise = validateWebm(new Uint8Array(10)); workers.at(-1).onerror(); await assert.rejects(promise, /失敗/);
  const controller = new AbortController(); promise = validateWebm(new Uint8Array(10), controller.signal); controller.abort(); await assert.rejects(promise, {name: 'AbortError'});
  promise = validateWebm(new Uint8Array(10)); timer(); await assert.rejects(promise, /タイムアウト/);
  assert.ok(workers.every(worker => worker.terminated));
});
