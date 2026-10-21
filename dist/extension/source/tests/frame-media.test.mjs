import assert from 'node:assert/strict';
import test from 'node:test';
import {collectPageMedia} from '../dist/extension/core/page-media.js';
import {ImageCollection} from '../dist/extension/core/image-collection.js';

const page = {url: 'https://page.test/book', images: ['https://cdn.test/pages/001.jpg', 'https://cdn.test/pages/002.jpg']};
const frame = {url: 'https://frame.test/viewer', images: ['https://cdn.test/pages/003.jpg', 'https://cdn.test/pages/004.jpg']};

test('iframeが同じグループへ合流しても外側の初期選択を増やさず、出典とリセットを保持する', () => {
  const ad = {url: 'https://ad.test/', images: [], media: [{url: 'https://ad.test/ad.mp4', kind: 'video'}]};
  const result = collectPageMedia(page, [ad, frame]);
  const collection = new ImageCollection();
  collection.replace(result.urls, page.url, result.media, result.initial);
  assert.deepEqual(collection.selectedItems.map(item => item.url), page.images);
  assert.equal(collection.itemForUrl(frame.images[0]).sourcePage, frame.url);
  collection.setAllSelected(true);
  collection.restoreInitialOrderAndSelection();
  assert.deepEqual(collection.selectedItems.map(item => item.url), page.images);
});

test('外側が空なら本文シリーズのframeを優先し、frame内の順序・重複除去を保つ', () => {
  const ad = {url: 'https://ad.test/', images: ['https://ad.test/offer.jpg']};
  const result = collectPageMedia({...page, images: []}, [ad, frame, frame]);
  assert.deepEqual(result.initial.selectedUrls, frame.images);
  assert.deepEqual(result.urls, [...ad.images, ...frame.images]);
});

test('iframeなしの正規化・既定選択と拒否件数を保つ', () => {
  const result = collectPageMedia({...page, media: [{url: 'javascript:alert(1)', kind: 'image'}]});
  assert.deepEqual(result.urls, page.images);
  assert.deepEqual(result.initial.selectedUrls, page.images);
  assert.equal(result.rejected, 1);
});

test('重複画像は実オリジン確認済みの収集元を優先し、順序・選択・重複除去を維持する', async () => {
  const {getImageFetchCredentials, validateImageFetchTarget} = await import('../dist/extension/app/media/image-fetch-policy.js');
  const image = 'https://media.test/pages/001.jpg';
  const parent = {url: 'https://outer.test/book', images: [image, 'https://outer.test/second.jpg']};
  const unrelated = {url: 'https://other.test/viewer', sourcePage: 'https://other.test/viewer', images: [image]};
  const verified = {url: 'https://media.test/viewer', sourcePage: 'https://media.test/viewer', images: [image]};
  for (const frame of [verified, {...verified, url: 'about:srcdoc'}]) {
    const result = collectPageMedia(parent, [unrelated, frame, verified]);
    const collection = new ImageCollection();
    collection.replace(result.urls, parent.url, result.media, result.initial);
    assert.deepEqual(collection.items.map(item => item.url), parent.images);
    assert.deepEqual(collection.selectedItems.map(item => item.url), result.initial.selectedUrls);
    assert.equal(collection.items[0].sourcePage, verified.sourcePage);
    assert.equal(getImageFetchCredentials(image, collection.items[0].sourcePage), 'include');
    assert.throws(() => validateImageFetchTarget('http://127.0.0.1/private.jpg', collection.items[0].sourcePage));
  }
  for (const source of [unrelated, {...verified, sourcePage: undefined}, {...verified, sourcePage: 'http://media.test/viewer'}, {...verified, sourcePage: 'https://media.test:8443/viewer'}, {url: 'about:srcdoc', images: [image]}]) {
    const result = collectPageMedia(parent, [source]);
    assert.equal(result.initial.sourcePages.get(image), parent.url);
    assert.equal(getImageFetchCredentials(image, result.initial.sourcePages.get(image)), 'omit');
  }
});


test('親の重複動画にも確認済みiframeの録画情報を引き継ぐ', async () => {
  const {streamDownloadUrl} = await import('../dist/extension/core/stream-recording.js');
  const {usesDirectRecordingDownload} = await import('../dist/extension/core/split-export-formats.js');
  const pageUrl = 'https://tenant.sharepoint.com/sites/team/_layouts/15/stream.aspx?id=/sites/team/recording.mp4';
  const url = streamDownloadUrl(pageUrl), stream = {pageUrl, bytes: 869};
  const frame = {url: pageUrl, sourcePage: pageUrl, images: [], media: [{url, kind: 'video', stream}]};
  for (const images of [[], [url]]) {
    const parent = {url: 'https://outer.test/book', images, media: images.map(url => ({url, kind: 'video'}))};
    const result = collectPageMedia(parent, [frame, frame]), collection = new ImageCollection();
    collection.replace(result.urls, parent.url, result.media, result.initial);
    assert.equal(collection.items.length, 1);
    assert.deepEqual(collection.items[0].stream, stream);
    assert.equal(collection.items[0].sourcePage, pageUrl);
    for (const format of ['original', 'mp4', 'recommend']) assert.equal(usesDirectRecordingDownload(collection.items, format), true);
    assert.equal(usesDirectRecordingDownload(collection.items, 'mp3'), false);
    assert.equal(usesDirectRecordingDownload([...collection.items, {url: 'https://outer.test/image.png', kind: 'image'}], 'mp4'), false);
  }
  for (const invalid of [{...frame, sourcePage: undefined}, {...frame, media: [{url, kind: 'video', stream: {...stream, pageUrl: 'https://other.test/'}}]}]) {
    const result = collectPageMedia({url: 'https://outer.test/', images: [url], media: [{url, kind: 'video'}]}, [invalid]);
    assert.equal(result.media[0].stream, undefined);
  }
});

test('一意な不透明iframeの表示用URLを認証へ使わず、確認済み出典へだけ昇格する', async t => {
  const {fetchOriginalMedia} = await import('../dist/extension/app/media/media-fetch.js');
  const {fetchImage} = await import('../dist/extension/app/media/image-fetch.js');
  const {pngBytes} = await import('./original-fixtures.mjs');
  const image = 'https://media.test/private.png';
  const opaque = {url: 'https://media.test/frame', images: [image]};
  const verified = {...opaque, url: 'https://media.test/verified', sourcePage: 'https://media.test/verified'};
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {calls.push(options); return new Response(pngBytes, {headers: {'content-type': 'image/png'}});});
  for (const frames of [[opaque], [opaque, verified], [verified, opaque]]) {
    const result = collectPageMedia({url: 'https://outer.test/', images: []}, frames), collection = new ImageCollection();
    collection.replace(result.urls, 'https://outer.test/', result.media, result.initial);
    const item = collection.items[0];
    assert.equal(item.sourcePage, frames[0].url, 'display and PDF provenance stay intact');
    assert.equal(item.fetchSourcePage, frames.length === 1 ? null : verified.sourcePage);
    for (const fetcher of [() => fetchOriginalMedia(item.url, 'image', item), () => fetchImage(item.url, item)]) {
      await fetcher();
      assert.equal(calls.at(-1).credentials, frames.length === 1 ? 'omit' : 'include');
    }
  }
  await assert.rejects(fetchOriginalMedia('http://127.0.0.1/private.png', 'image', {sourcePage: 'http://127.0.0.1/frame', fetchSourcePage: null}));
});
