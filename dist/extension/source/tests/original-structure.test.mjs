import assert from 'node:assert/strict';
import test from 'node:test';
import {webmBytes, pngBytes} from './original-fixtures.mjs';
import {apng} from './animation-fixtures.mjs';
import {hasCompletePng} from '../dist/extension/core/original-image-structure.js';
import {hasCompleteWebm} from '../dist/extension/core/webm-structure.js';
import {validateOriginalMedia} from '../dist/extension/app/media/original-media-validation.js';
import {hasCompleteIsoImage} from '../dist/extension/core/original-isobmff-image.js';
import {staticAvif, animatedAvif} from './iso-image-fixtures.mjs';

test('AVIFの静止・動画原本は全ボックス境界と画像項目の格納範囲を確認する', async () => {
  for (const bytes of [staticAvif, animatedAvif]) {
    assert.ok(hasCompleteIsoImage(bytes));
    assert.ok(hasCompleteIsoImage(Buffer.concat([Buffer.alloc(7), bytes]).subarray(7)));
    for (let cut = 0; cut < bytes.length; cut++) assert.equal(hasCompleteIsoImage(bytes.subarray(0, cut)), false, String(cut));
    await validateOriginalMedia(new Blob([bytes], {type: 'image/avif'}));
    const invalidExtent = Buffer.from(bytes);
    const iloc = invalidExtent.indexOf('iloc');
    invalidExtent.writeUInt32BE(bytes.length + 1, iloc + 18);
    assert.equal(hasCompleteIsoImage(invalidExtent), false);
  }
});

test('PNG・APNGはCRCと全チャンクの境界・終端を確認する', () => {
  for (const bytes of [pngBytes, apng]) {
    assert.ok(hasCompletePng(bytes));
    const framed = Buffer.concat([Buffer.alloc(7), bytes]);
    assert.ok(hasCompletePng(framed.subarray(7)));
    const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
    assert.equal(hasCompletePng(corrupt), false);
    for (let cut = 0; cut < bytes.length; cut++) assert.equal(hasCompletePng(bytes.subarray(0, cut)), false, String(cut));
  }
});

test('WebMの未知長Segment・Clusterを許容し、要素途中の切断と空のコンテナーを拒否する', async () => {
  const live = Buffer.from(webmBytes);
  for (const id of ['18538067', '1f43b675']) {
    const start = live.lastIndexOf(Buffer.from(id, 'hex')) + 4;
    assert.ok(start >= 4);
    let width = 1, mask = 128;
    while (!(live[start] & mask)) {width++; mask >>= 1;}
    live[start] = mask | (mask - 1); live.fill(255, start + 1, start + width);
  }
  for (const bytes of [webmBytes, live]) {
    assert.ok(hasCompleteWebm(bytes));
    await validateOriginalMedia(new Blob([bytes], {type: 'video/webm'}));
    assert.equal(hasCompleteWebm(bytes.subarray(0, -1)), false);
    assert.equal(hasCompleteWebm(bytes.subarray(0, 4)), false);
  }
  const badLacing = Buffer.from(webmBytes);
  const block = badLacing.indexOf(Buffer.from('a31000003d', 'hex'));
  assert.ok(block > 0);
  badLacing[block + 8] |= 2;
  badLacing[block + 9] = 255;
  assert.equal(hasCompleteWebm(badLacing), false);
});
