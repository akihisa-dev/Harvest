import assert from 'node:assert/strict';
import test from 'node:test';
import {createMp3CoverTag} from '../dist/extension/core/mp3-cover.js';
import {readCover} from './support/mp3-cover.mjs';

test('MP3カバーは曲名と画像をMusicで確認した構造で保持する', () => {
  for (const mime of ['image/jpeg', 'image/png']) {
    for (const title of ['Harvest Cover Test 01', '涼宮ハルヒ 🎵', '\0日本語\0']) for (const image of [Buffer.from([1, 2, 3]), Buffer.from([255, 224, 255, 0, 255, 216, 255])]) {
      const tag = Buffer.from(createMp3CoverTag(image, mime, title));
      const cover = readCover(Buffer.concat([tag, Buffer.from([255, 251, 0, 1])]));
      assert.equal(cover.title, title.replace(/\0/g, ''));
      assert.equal(cover.mime, mime);
      assert.deepEqual(cover.image, image);
      assert.equal(cover.audioOffset, tag.length);
      assert.ok(tag.subarray(6, 10).every(byte => byte < 128));
    }
  }
  assert.throws(() => createMp3CoverTag(new Uint8Array(), 'image/jpeg', '曲名'));
  assert.throws(() => createMp3CoverTag(new Uint8Array(4 * 1024 * 1024 + 1), 'image/jpeg', '曲名'));
});
