import assert from 'node:assert/strict';
import test from 'node:test';
import {createMp3CoverTag} from '../dist/extension/core/mp3-cover.js';
import {readCover} from './support/mp3-cover.mjs';

test('MP3カバーは画像データと種類を保持し、誤った音声同期を防ぐ', () => {
  for (const mime of ['image/jpeg', 'image/png']) {
    for (const image of [Buffer.from([1, 2, 3]), Buffer.from([255, 224, 255, 0, 255, 216, 255])]) {
      const tag = Buffer.from(createMp3CoverTag(image, mime));
      const cover = readCover(Buffer.concat([tag, Buffer.from([255, 251, 0, 1])]));
      assert.equal(cover.mime, mime);
      assert.deepEqual(cover.image, image);
      assert.equal(cover.audioOffset, tag.length);
      assert.ok(tag.subarray(6, 10).every(byte => byte < 128));
    }
  }
  assert.throws(() => createMp3CoverTag(new Uint8Array(), 'image/jpeg'));
  assert.throws(() => createMp3CoverTag(new Uint8Array(4 * 1024 * 1024 + 1), 'image/jpeg'));
});
