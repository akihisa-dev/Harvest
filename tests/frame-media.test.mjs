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
