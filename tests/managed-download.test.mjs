import assert from 'node:assert/strict';
import test from 'node:test';
import {mp4Bytes} from './media-fixtures.mjs';
import {downloadManagedBlob} from '../dist/extension/app/browser/managed-download.js';

function api() {
  const listeners = new Set(), items = new Map(), starts = [], queries = [], cancelled = [];
  let next = 1;
  const result = {
    listeners, items, starts, queries, cancelled,
    finish(id, state, error) {
      items.set(id, {id, state, error});
      for (const listener of listeners) listener({id, state: {current: state}, error: {current: error}});
    },
    downloads: {
      async download(options) { const id = next++; starts.push({id, ...options}); items.set(id, {id, state: 'in_progress'}); return id; },
      async search(query) { queries.push(query); return items.has(query.id) ? [items.get(query.id)] : []; },
      async cancel(id) { cancelled.push(id); result.finish(id, 'interrupted', 'USER_CANCELED'); },
      onChanged: {addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener)},
    },
  };
  return result;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function install(t, fake) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', {configurable: true, value: {i18n: {getUILanguage: () => 'en'}, downloads: fake.downloads}});
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'chrome', previous); else delete globalThis.chrome; });
}

test('保存完了までBlobを保持し、自分のID以外の通知を無視する', async t => {
  const fake = api(); install(t, fake);
  const revoked = [];
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  let complete = false;
  const promise = downloadManagedBlob(new Blob(['data']), 'movie.mp4', new AbortController().signal).then(() => { complete = true; });
  await tick();
  fake.finish(99, 'complete');
  await tick();
  assert.equal(complete, false);
  assert.equal(revoked.length, 0);
  fake.finish(1, 'complete');
  await promise;
  assert.equal(revoked.length, 1);
  assert.equal(fake.listeners.size, 0);
  assert.deepEqual(fake.queries, [{id: 1}], '履歴全体を照会しない');
  assert.equal(fake.starts[0].conflictAction, 'uniquify', '既存ファイルを上書きしない');
});

test('開始通知の競合、Chromeの拒否と中断を扱い、通知とBlobを解放する', async t => {
  const fake = api(); install(t, fake);
  t.mock.method(fake.downloads, 'download', async () => { fake.finish(1, 'complete'); return 1; });
  await downloadManagedBlob(new Blob(['data']), 'early.mp4', new AbortController().signal);
  assert.equal(fake.listeners.size, 0);
  t.mock.method(fake.downloads, 'download', async () => { throw new Error('not permitted'); });
  await assert.rejects(downloadManagedBlob(new Blob(['data']), 'denied.mp4', new AbortController().signal), /not permitted/);
  assert.equal(fake.listeners.size, 0);
  t.mock.method(fake.downloads, 'download', async () => { fake.finish(2, 'interrupted', 'FILE_FAILED'); return 2; });
  await assert.rejects(downloadManagedBlob(new Blob(['data']), 'failed.mp4', new AbortController().signal), /FILE_FAILED/);
  assert.equal(fake.listeners.size, 0);
});

test('許可待ち中の中止はID取得後に自分の保存だけを中止する', async t => {
  const fake = api(); install(t, fake);
  let start;
  t.mock.method(fake.downloads, 'download', () => new Promise(resolve => { start = resolve; }));
  const controller = new AbortController();
  const promise = downloadManagedBlob(new Blob(['data']), 'pending.mp4', controller.signal);
  const rejected = assert.rejects(promise, /USER_CANCELED/);
  controller.abort();
  assert.deepEqual(fake.cancelled, []);
  start(7);
  await rejected;
  assert.deepEqual(fake.cancelled, [7]);
  assert.equal(fake.listeners.size, 0);
});

test('中止と完了の競合では実際に完了したファイルを成功として保持する', async t => {
  const fake = api(); install(t, fake);
  t.mock.method(fake.downloads, 'cancel', async id => { fake.finish(id, 'complete'); });
  const controller = new AbortController();
  const promise = downloadManagedBlob(new Blob(['data']), 'complete.mp4', controller.signal);
  await tick();
  controller.abort();
  await promise;
  assert.equal(fake.listeners.size, 0);
});

test('ID通知待ち中に完了した保存は中止の拒否後も完了扱いにする', async t => {
  const fake = api(); install(t, fake);
  let start;
  t.mock.method(fake.downloads, 'download', () => new Promise(resolve => { start = resolve; }));
  t.mock.method(fake.downloads, 'cancel', async () => { throw new Error('already complete'); });
  const controller = new AbortController();
  const promise = downloadManagedBlob(new Blob(['data']), 'complete.mp4', controller.signal);
  fake.finish(7, 'complete');
  controller.abort();
  start(7);
  await promise;
  assert.equal(fake.listeners.size, 0);
});

async function controllerFixture(t) {
  const fake = api(); install(t, fake);
  const previousDocument = globalThis.document;
  globalThis.document = {documentElement: {setAttribute() {}}, body: {dataset: {}}, querySelectorAll: () => []};
  t.after(() => { globalThis.document = previousDocument; });
  const {createMixedExportController} = await import('../dist/extension/app/panel/mixed-export-controller.js');
  const selected = Array.from({length: 3}, (_, i) => ({url: `https://files.example.test/${i}.mp4`, sourcePage: 'https://page.example.test/', kind: 'video'}));
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return new Response(mp4Bytes, {headers: {'content-type': 'video/mp4'}}); });
  let completed = 0;
  const statuses = [];
  const controller = createMixedExportController({getSelectedItems: () => selected, getZipFilename: () => 'batch.zip', getPdfFilename: () => 'batch.pdf', isBusy: () => false,
    isDisposed: () => false, onBusyChange() {}, onStatus: (...args) => statuses.push(args), onCloseViewer() {}, onClearSourceUrl() {},
    onCompleted: () => completed++, onScrollToFailures() {}});
  return {fake, controller, requests, statuses, get completed() { return completed; }};
}

for (const stop of ['interrupt', 'abort']) test(`個別MP4の${stop}後は保存済み分を重複させず未保存分だけ再試行する`, async t => {
  const fixture = await controllerFixture(t), {fake, controller} = fixture;
  const execution = controller.export({imageFormat: 'original', videoFormat: 'mp4', includeSourcePage: false});
  await tick();
  assert.equal(fake.starts.length, 1);
  assert.equal(fixture.completed, 0);
  fake.finish(1, 'complete');
  await tick();
  assert.equal(fake.starts.length, 2);
  if (stop === 'abort') controller.abort();
  else fake.finish(2, 'interrupted', 'FILE_FAILED');
  await execution;
  assert.equal(fixture.completed, 0);
  assert.equal(controller.pending.failed.size, 2);
  assert.equal(fixture.statuses.some(status => status[1] === 'success'), false);
  const retry = controller.export({imageFormat: 'original', videoFormat: 'mp4', includeSourcePage: false});
  await tick();
  assert.equal(fake.starts[2].filename, 'batch_002.mp4');
  fake.finish(3, 'complete');
  await tick();
  assert.equal(fake.starts[3].filename, 'batch_003.mp4');
  fake.finish(4, 'complete');
  await retry;
  assert.equal(fixture.completed, 1);
  assert.equal(controller.pending, null);
  assert.equal(fixture.requests.length, 3, '準備済みMP4を再取得しない');
  assert.deepEqual(fake.starts.map(item => item.filename), ['batch_001.mp4', 'batch_002.mp4', 'batch_002.mp4', 'batch_003.mp4']);
});

test('MP4の準備に失敗した場合は保存を一件も開始しない', async t => {
  const fixture = await controllerFixture(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('broken', {headers: {'content-type': 'video/mp4'}}));
  await fixture.controller.export({imageFormat: 'original', videoFormat: 'mp4', includeSourcePage: false});
  assert.equal(fixture.fake.starts.length, 0);
  assert.equal(fixture.completed, 0);
  assert.equal(fixture.controller.pending.failed.size, 3);
});
