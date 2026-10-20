import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeJxl} from '../dist/extension/app/media/jxl-encoder.js';
import {createStoredZipInWorker} from '../dist/extension/app/media/stored-zip-worker.js';

function fixture(t) {
  const previous = globalThis.Worker, workers = [], timers = new Map(); let next = 0;
  globalThis.Worker = class extends EventTarget {
    requests = []; listeners = new Set(); terminated = 0;
    constructor() {super(); workers.push(this);}
    addEventListener(type, fn, options) {super.addEventListener(type, fn, options); this.listeners.add(fn);}
    removeEventListener(type, fn) {super.removeEventListener(type, fn); this.listeners.delete(fn);}
    postMessage(request) {this.requests.push(request);}
    terminate() {this.terminated++;}
    reply(data) {this.onmessage?.({data}); this.dispatchEvent(new MessageEvent('message', {data}));}
  };
  t.after(() => {globalThis.Worker = previous;});
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => {timers.set(++next, {fn, ms}); return next;});
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  return {workers, timers};
}
const image = mib => ({width: 1, height: mib * 262144, data: new Uint8ClampedArray(mib * 1024 ** 2)});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('JXLの無応答は先行画素量を含む期限で全要求を終了し、旧応答に影響されず再試行する', async t => {
  const {workers, timers} = fixture(t);
  const first = encodeJxl(image(4)), second = encodeJxl(image(8));
  const failed = Promise.all([assert.rejects(first, /JXL/), assert.rejects(second, /JXL/)]);
  assert.deepEqual([...timers.values()].map(timer => timer.ms), [124000, 132000]);
  const stale = [...timers.values()][0].fn, old = workers[0];
  stale(); await failed; assert.equal(old.terminated, 1); assert.equal(timers.size, 0);
  const retry = encodeJxl(image(1));
  stale(); old.reply({id: old.requests[0].id, buffer: new ArrayBuffer(1)});
  assert.equal(workers[1].terminated, 0);
  const buffer = new ArrayBuffer(2); workers[1].reply({id: workers[1].requests[0].id, buffer});
  assert.equal(await retry, buffer); assert.deepEqual([...timers.values()].map(timer => timer.ms), [30000]);
  [...timers.values()][0].fn(); assert.equal(workers[1].terminated, 1); assert.equal(timers.size, 0);
});

for (const outcome of ['abort', 'success', 'error']) test(`JXLの${outcome}は期限を解除し、期限との競合を一度だけ確定する`, async t => {
  const {workers, timers} = fixture(t), controller = new AbortController();
  const work = encodeJxl(image(1), controller.signal), failure = outcome === 'success' ? null : assert.rejects(work);
  const deadline = [...timers.values()][0].fn, worker = workers[0];
  if (outcome === 'abort') controller.abort();
  else if (outcome === 'error') worker.onerror();
  else worker.reply({id: worker.requests[0].id, buffer: new ArrayBuffer(1)});
  deadline(); controller.abort(); await (failure ?? work);
  if (outcome === 'success') {assert.equal(worker.terminated, 0); [...timers.values()][0].fn();}
  assert.equal(worker.terminated, 1); assert.equal(timers.size, 0);
});

for (const outcome of ['timeout', 'abort', 'success']) test(`ZIPの${outcome}で期限・購読・Workerを解放し再試行できる`, async t => {
  const {workers, timers} = fixture(t), controller = new AbortController();
  const entries = [{filename: 'check.txt', blob: new Blob(['123456789'])}];
  const work = createStoredZipInWorker(entries, {signal: controller.signal}), failed = outcome === 'success' ? null : assert.rejects(work);
  while (!workers[0]?.requests.length) await tick();
  const worker = workers[0], deadline = [...timers.values()][0].fn, reply = {id: 1, checksum: 0xcbf43926};
  assert.equal([...timers.values()][0].ms, 121000);
  const lateListeners = [...worker.listeners];
  if (outcome === 'timeout') deadline(); else if (outcome === 'abort') controller.abort(); else worker.reply(reply);
  await (failed ?? work); deadline(); controller.abort();
  for (const fn of lateListeners) fn(new MessageEvent('message', {data: reply}));
  assert.equal(worker.terminated, 1); assert.equal(worker.listeners.size, 0); assert.equal(timers.size, 0);
  const retry = createStoredZipInWorker(entries);
  while (!workers[1]?.requests.length) await tick();
  workers[1].reply(reply); const archive = await retry;
  assert.equal(new DataView(await archive.arrayBuffer()).getUint32(14, true), 0xcbf43926);
  assert.equal(workers[1].terminated, 1); assert.equal(timers.size, 0);
});

test('ZIPの大容量と次ファイルにはそれぞれ容量に応じた新しい期限を設ける', async t => {
  const {workers, timers} = fixture(t);
  const entries = [64, 2].map(mib => ({filename: `${mib}.bin`, blob: new Blob([new Uint8Array(mib * 1024 ** 2)])}));
  const work = createStoredZipInWorker(entries);
  while (!workers[0]?.requests.length) await tick();
  assert.equal([...timers.values()][0].ms, 184000); workers[0].reply({id: 1, checksum: 0});
  while (workers[0].requests.length < 2) await tick();
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].ms, 122000);
  workers[0].reply({id: 2, checksum: 0}); await work; assert.equal(timers.size, 0);
});
