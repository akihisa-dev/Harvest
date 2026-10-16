import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {hasCompleteIsoImage} from '../dist/extension/core/original-isobmff-image.js';
import {validateIsoImage} from '../dist/extension/app/media/iso-image-validation.js';
import {staticAvif, animatedAvif} from './iso-image-fixtures.mjs';

test('多数の小boxの検査は小さいヒープ内で終了し正常原本も維持する', () => {
  const module = new URL('../dist/extension/core/original-isobmff-image.js', import.meta.url).href;
  execFileSync(process.execPath, ['--max-old-space-size=32', '--input-type=module', '-e', `
    import {hasCompleteIsoImage} from ${JSON.stringify(module)};
    const bytes = new Uint8Array(8 * 1_000_000);
    for (let offset = 0; offset < bytes.length; offset += 8) bytes.set([0,0,0,8,102,114,101,101], offset);
    if (hasCompleteIsoImage(bytes)) throw Error('must reject missing image metadata');
  `], {timeout: 15000});
  for (const bytes of [staticAvif, animatedAvif]) assert.ok(hasCompleteIsoImage(bytes));
});

test('ISO検査Workerは既存bufferを転送し、完了・失敗・中止・期限で終了する', async t => {
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
    const bytes = new Uint8Array(10), promise = validateIsoImage(bytes), worker = workers.at(-1);
    assert.equal(worker.bytes, bytes.buffer); assert.equal(worker.transfer[0], bytes.buffer);
    worker.onmessage({data: result});
    if (typeof result === 'boolean') assert.equal(await promise, result); else await assert.rejects(promise, /不正/);
    assert.ok(worker.terminated);
  }
  let promise = validateIsoImage(new Uint8Array(10)); workers.at(-1).onerror(); await assert.rejects(promise, /失敗/);
  const controller = new AbortController(); promise = validateIsoImage(new Uint8Array(10), controller.signal); controller.abort(); await assert.rejects(promise, {name: 'AbortError'});
  promise = validateIsoImage(new Uint8Array(10)); timer(); await assert.rejects(promise, /タイムアウト/);
  assert.ok(workers.every(worker => worker.terminated));
});
