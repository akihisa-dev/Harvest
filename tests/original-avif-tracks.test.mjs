import assert from 'node:assert/strict';
import test from 'node:test';
import {animatedAvif, staticAvif} from './iso-image-fixtures.mjs';
import {hasCompleteIsoImage} from '../dist/extension/core/original-isobmff-image.js';
import {validateOriginalMedia} from '../dist/extension/app/media/original-media-validation.js';

function box(type, ...parts) { const body = Buffer.concat(parts); const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4); return Buffer.concat([header, body]); }
function words(...values) { const data = Buffer.alloc(values.length * 4); values.forEach((value, index) => data.writeUInt32BE(value, index * 4)); return data; }
function sequence(sizes = 'stsz', wide = false) {
  const lengths = sizes === 'fixed' ? [3, 3, 3] : [2, 3, 4];
  const stsz = sizes === 'stz2' ? box('stz2', words(0, 4, 3), Buffer.from([0x23, 0x40]))
    : box('stsz', sizes === 'fixed' ? words(0, 3, 3) : words(0, 0, 3, ...lengths));
  const offsets = Buffer.alloc(8 + (wide ? 16 : 8)); offsets.writeUInt32BE(2, 4);
  const movie = box('moov', box('trak', box('mdia', box('minf', box('stbl',
    box('stts', words(0, 1, 3, 100)), box('stsc', words(0, 2, 1, 2, 1, 2, 1, 1)), stsz, box(wide ? 'co64' : 'stco', offsets))))));
  const offsetBox = movie.indexOf(wide ? 'co64' : 'stco') + 4;
  const start = movie.length + 8;
  if (wide) {movie.writeBigUInt64BE(BigInt(start), offsetBox + 8); movie.writeBigUInt64BE(BigInt(start + lengths[0] + lengths[1]), offsetBox + 16);}
  else {movie.writeUInt32BE(start, offsetBox + 8); movie.writeUInt32BE(start + lengths[0] + lengths[1], offsetBox + 12);}
  return Buffer.concat([movie, box('mdat', Buffer.alloc(9))]);
}

test('AVIF原本は後続フレーム欠落とサンプル表の不整合を拒否する', async () => {
  for (const bytes of [staticAvif, animatedAvif]) assert.ok(hasCompleteIsoImage(bytes));
  const missing = Buffer.from(animatedAvif.subarray(0, -32));
  const mdat = missing.indexOf('mdat') - 4; missing.writeUInt32BE(missing.length - mdat, mdat);
  assert.equal(hasCompleteIsoImage(missing), false);
  await assert.rejects(validateOriginalMedia(new Blob([missing], {type: 'image/avif'})), /不完全|破損/);
  for (const [table, relative, value] of [['stsz', 16, animatedAvif.length], ['stco', 12, animatedAvif.length], ['stts', 12, 3], ['stsc', 16, 1]]) {
    const changed = Buffer.from(animatedAvif); changed.writeUInt32BE(value, changed.indexOf(table) + relative);
    assert.equal(hasCompleteIsoImage(changed), false, table);
  }
});
test('複数チャンク・固定サイズ・小さいサイズ表・64bit位置の全サンプルを確認する', () => {
  for (const sizes of ['stsz', 'fixed', 'stz2']) for (const wide of [false, true]) {
    const bytes = sequence(sizes, wide);
    assert.ok(hasCompleteIsoImage(bytes), `${sizes}/${wide}`);
    const changed = Buffer.from(bytes); const offset = changed.indexOf(wide ? 'co64' : 'stco') + (wide ? 20 : 16);
    if (wide) changed.writeBigUInt64BE(BigInt(bytes.length), offset); else changed.writeUInt32BE(bytes.length, offset);
    assert.equal(hasCompleteIsoImage(changed), false, '後続チャンク範囲外');
    assert.equal(hasCompleteIsoImage(bytes.subarray(0, -1)), false);
  }
});
