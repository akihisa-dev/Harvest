import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeImageUrls} from '../dist/extension/core/images.js';

test('画像の用途はパスで判定し、ホストや無関係なクエリで本文画像を落とさない',()=>{
  const keep=['https://analytics.example/gallery/001.jpg?loading=eager','https://example.com/gallery/002.jpg?analytics=0','https://example.com/iconic/003.jpg','https://example.com/pages/logo-01.jpg'];
  const drop=['https://example.com/assets/logo.png?path=/pages/','https://example.com/assets/icon-01.png','https://example.com/tracking/pixel.gif','https://example.com/plugins/a/image.png'];
  assert.deepEqual(normalizeImageUrls([...keep,...drop],'https://example.com'),keep);
});
