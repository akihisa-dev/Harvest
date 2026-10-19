import assert from 'node:assert/strict';
import test from 'node:test';
import {streamDownloadUrl, isStreamRecording, streamRecordingFilename} from '../dist/extension/core/stream-recording.js';
import {inspectStreamRecording} from '../dist/extension/app/browser/stream-recording.js';
import {scanTab} from '../dist/extension/app/browser/page-access.js';
import {ImageCollection} from '../dist/extension/core/image-collection.js';
import {isPageScan} from '../dist/extension/app/contracts/page-contracts.js';
import {createMixedExportController} from '../dist/extension/app/panel/mixed-export-controller.js';
import {downloadManagedRecording} from '../dist/extension/app/browser/managed-download.js';

const pageUrl = 'https://contoso-my.sharepoint.com/personal/user/_layouts/15/stream.aspx?id=' + encodeURIComponent('/personal/user/Documents/Recordings/定例 会議.mp4');
const url = streamDownloadUrl(pageUrl), bytes = 3 * 1024 ** 3;
const tick = () => new Promise(resolve => setImmediate(resolve));
function install(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}
function head(t, handler = () => new Response(null, {headers: {'content-type': 'video/mp4', 'content-length': String(bytes)}})) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (target, options) => {
    calls.push({target, options});
    assert.equal(target, url);assert.equal(options.method, 'HEAD');
    assert.equal(options.credentials, 'include');assert.equal(options.redirect, 'error');
    return handler(target, options);
  });
  return calls;
}
function chromeApi(t) {
  const items = new Map(), listeners = new Set(), starts = [], cancelled = [];
  const api = {
    i18n: {getUILanguage: () => 'ja'},
    downloads: {
      async download(options) {const id = starts.length + 1;starts.push(options);items.set(id, {id, state: 'in_progress'});return id;},
      async search({id}) {return items.has(id) ? [items.get(id)] : [];},
      async cancel(id) {cancelled.push(id);finish(id, 'interrupted', {error: 'USER_CANCELED'});},
      onChanged: {addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener)},
    },
  };
  const finish = (id, state, extra = {}) => {
    items.set(id, {id, state, mime: 'video/mp4', fileSize: bytes, ...extra});
    for (const listener of listeners) listener({id, state: {current: state}, ...(extra.error ? {error: {current: extra.error}} : {})});
  };
  install(t, 'chrome', api);
  return {api, finish, starts, cancelled, listeners};
}

test('Streamの会議録画を同一サイトの通常のダウンロード先に限定する', () => {
  assert.equal(new URL(url).pathname, '/personal/user/_layouts/15/download.aspx');
  assert.equal(new URL(url).searchParams.get('SourceUrl'), 'https://contoso-my.sharepoint.com/personal/user/Documents/Recordings/%E5%AE%9A%E4%BE%8B%20%E4%BC%9A%E8%AD%B0.mp4');
  assert.equal(streamRecordingFilename({pageUrl}), '定例 会議.mp4');
  const guid = '12345678-1234-abcd-1234-123456789abc';
  assert.equal(new URL(streamDownloadUrl(`https://contoso.sharepoint.com/sites/team/_layouts/15/stream.aspx?sourcedoc={${guid}}`)).searchParams.get('UniqueId'), guid);
  assert.ok(streamDownloadUrl(pageUrl.replace('stream.aspx', 'onedrive.aspx')));
  for (const invalid of [pageUrl.replace('.sharepoint.com', '.sharepoint.com.evil.test'), pageUrl.replace('https:', 'http:'),
    pageUrl.replace('https://', 'https://user:secret@'), pageUrl + '&ID=other',
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('//evil.test/file.mp4')),
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('/sites/another/file.mp4')),
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('/personal/user/../../private/file.mp4')),
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('/personal/user/a\\file.mp4')),
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('/personal/user/file.m3u8'))]) assert.equal(streamDownloadUrl(invalid), null, invalid);
});

test('3 GiBの録画は本文を読まず容量と録画情報を動画一覧まで引き継ぐ', async t => {
  head(t, () => {
    const response = new Response(null, {headers: {'content-type': 'video/mp4', 'content-length': String(bytes)}});
    for (const name of ['blob', 'arrayBuffer', 'text']) response[name] = () => {throw new Error('Do not buffer recording');};
    return response;
  });
  const stream = await inspectStreamRecording(pageUrl);
  assert.deepEqual(stream, {pageUrl, bytes});
  const media = [{url, kind: 'video', stream}];
  assert.equal(isPageScan({url: pageUrl, title: 'meeting', images: [], media}), true);
  assert.equal(isStreamRecording({...stream, pageUrl: pageUrl.replace('contoso', 'other')}, url), false);
  assert.equal(isStreamRecording({...stream, bytes: -1}, url), false);
  const collection = new ImageCollection();collection.replace([url], pageUrl, media);
  assert.deepEqual(collection.items[0].stream, stream);
  collection.restoreInitialOrderAndSelection();
  assert.equal(Object.values(collection.groups)[0].label, 'MP4 (1件)');
});

for (const failure of [401, 403, 404, 405, 302, 'html', 'manifest', 'empty', 'redirect']) test(`録画の権限・認証・応答が不適切なら取得を拒否する: ${failure}`, async t => {
  head(t, () => {
    if (failure === 'redirect') throw new TypeError('redirect rejected');
    if (typeof failure === 'number') return new Response(null, {status: failure});
    return new Response(null, {headers: {'content-type': failure === 'html' ? 'text/html' : failure === 'manifest' ? 'application/dash+xml' : 'video/mp4',
      'content-length': failure === 'empty' ? '0' : '10'}});
  });
  await assert.rejects(inspectStreamRecording(pageUrl), /ダウンロード権限/);
});

test('MP4添付名のある汎用バイナリだけを録画として扱い、不明な容量は推定しない', async t => {
  head(t, () => new Response(null, {headers: {'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="meeting.mp4"'}}));
  assert.deepEqual(await inspectStreamRecording(pageUrl), {pageUrl});
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {headers: {'content-type': 'application/octet-stream'}}));
  await assert.rejects(inspectStreamRecording(pageUrl), /ダウンロード権限/);
});

test('解析途中の移動を検出し、以前の文書の録画を公開しない', async t => {
  let moved = false;head(t, () => {moved = true;return new Response(null, {headers: {'content-type': 'video/mp4'}});});
  const event = {addListener() {}, removeListener() {}};
  install(t, 'chrome', {tabs: {onRemoved: event, get: async () => ({url: moved ? 'https://elsewhere.test/' : pageUrl})},
    scripting: {executeScript: async ({func}) => [{documentId: 'doc', result: func.name === 'scanDocument'
      ? {url: pageUrl, title: '会議録画', images: ['https://example.test/logo.png']} : pageUrl}]}});
  await assert.rejects(scanTab(1), /ページが移動/);
});

test('録画再生ページを一つの動画として解析し、ロゴや再生用候補を混ぜない', async t => {
  head(t);const event = {addListener() {}, removeListener() {}};
  install(t, 'chrome', {tabs: {onRemoved: event, get: async () => ({url: pageUrl})},
    scripting: {executeScript: async ({func}) => [{documentId: 'doc', result: func.name === 'scanDocument'
      ? {url: pageUrl, title: '会議録画', images: ['https://example.test/logo.png'], hasFrames: true} : pageUrl}]}});
  const result = await scanTab(1);
  assert.deepEqual(result.media, [{url, kind: 'video', stream: {pageUrl, bytes}}]);
  assert.deepEqual(result.images, []);assert.equal(result.hasFrames, false);
});

for (const extra of [{mime: 'text/html'}, {fileSize: 10}, {fileSize: 0}]) test(`Chromeが完了しても録画の形式・サイズが違えば成功にしない: ${JSON.stringify(extra)}`, async t => {
  head(t);const fake = chromeApi(t);
  const promise = downloadManagedRecording({pageUrl}, 'meeting.mp4', new AbortController().signal);
  const rejected = assert.rejects(promise, /ダウンロード権限/);
  await tick();fake.finish(1, 'complete', extra);await rejected;
  assert.equal(fake.listeners.size, 0);
});

test('権限確認中の中止はダウンロードを開始せず、通信も中止する', async t => {
  const fake = chromeApi(t), controller = new AbortController();
  let requestSignal;
  head(t, (_, options) => new Promise((_, reject) => {requestSignal = options.signal;requestSignal.addEventListener('abort', () => reject(requestSignal.reason), {once: true});}));
  const promise = downloadManagedRecording({pageUrl}, 'meeting.mp4', controller.signal);
  const rejected = assert.rejects(promise, {name: 'AbortError'});
  controller.abort();await rejected;
  assert.equal(requestSignal.aborted, true);assert.equal(fake.starts.length, 0);
});

for (const format of ['mp4', 'recommend', 'original']) test(`長い録画の${format}保存を中止後、Chromeで未保存分だけ再試行する`, async t => {
  const calls = head(t), fake = chromeApi(t);
  install(t, 'document', {documentElement: {setAttribute() {}}, body: {dataset: {}}, querySelectorAll: () => []});
  const selected = [1, 2].map(() => ({url, sourcePage: pageUrl, selected: true, kind: 'video', stream: {pageUrl, bytes}}));
  let completed = 0;
  const controller = createMixedExportController({getSelectedItems: () => selected, getZipFilename: () => '会議.zip', getPdfFilename: () => '会議.pdf',
    isBusy: () => false, isDisposed: () => false, onBusyChange() {}, onStatus() {}, onCloseViewer() {}, onClearSourceUrl() {}, onCompleted() {completed++;}, onScrollToFailures() {}});
  t.mock.method(URL, 'createObjectURL', () => {throw new Error('Long recordings must not become Blobs');});
  const settings = {imageFormat: 'original', videoFormat: format, includeSourcePage: false};
  const first = controller.export(settings);await tick();
  assert.equal(fake.starts[0].url, url);fake.finish(1, 'complete');await tick();
  assert.equal(fake.starts.length, 2);controller.abort();await first;
  assert.deepEqual(fake.cancelled, [2]);assert.equal(completed, 0);
  const retry = controller.export(settings);await tick();fake.finish(3, 'complete');await retry;
  assert.equal(completed, 1);assert.equal(controller.pending, null);
  assert.deepEqual(fake.starts.map(item => item.filename), ['会議_001.mp4', '会議_002.mp4', '会議_002.mp4']);
  assert.ok(calls.every(call => call.options.method === 'HEAD'));
});
