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
