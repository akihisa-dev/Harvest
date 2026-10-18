import assert from 'node:assert/strict';
import test from 'node:test';
import {apng} from './animation-fixtures.mjs';
import {hasCompletePng} from '../dist/extension/core/original-image-structure.js';
import {validateOriginalMedia} from '../dist/extension/app/media/original-media-validation.js';

function chunks(bytes) {
  const parts = [];
  for (let at = 8; at < bytes.length;) { const end = at + bytes.readUInt32BE(at) + 12; parts.push(Buffer.from(bytes.subarray(at, end))); at = end; }
  return parts;
}
function type(part) { return part.toString('ascii', 4, 8); }
function assemble(parts) {
  for (const part of parts) {
    let crc = 0xffffffff;
    for (const value of part.subarray(4, -4)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    part.writeUInt32BE((crc ^ 0xffffffff) >>> 0, part.length - 4);
  }
  return Buffer.concat([apng.subarray(0, 8), ...parts]);
}
test('APNGは全フレームの宣言・制御・データ・シーケンスを照合する', async () => {
  assert.ok(hasCompletePng(apng));
  const parts = chunks(apng);
  const lastFrame = parts.findLastIndex(part => type(part) === 'fcTL');
  const missing = assemble(parts.filter((part, index) => index < lastFrame || type(part) === 'IEND'));
  assert.equal(hasCompletePng(missing), false);
  await assert.rejects(validateOriginalMedia(new Blob([missing], {type: 'image/png'})), /不完全|破損/);
  const firstEnd = parts.findIndex((part, index) => index > parts.findIndex(p => type(p) === 'fcTL') && type(part) === 'fcTL');
  const single = chunks(assemble(parts.filter((part, index) => index < firstEnd || type(part) === 'IEND'))); single.find(part => type(part) === 'acTL').writeUInt32BE(1, 8);
  assert.ok(hasCompletePng(assemble(single)), '単一フレームも保持する');
  for (const mutation of [
    parts => parts.find(part => type(part) === 'acTL').writeUInt32BE(4, 8),
    parts => parts.find(part => type(part) === 'fdAT').writeUInt32BE(99, 8),
    parts => { const index = parts.findIndex(part => type(part) === 'fdAT'); parts.splice(index, 1); },
    parts => { const index = parts.findIndex(part => type(part) === 'acTL'); parts.splice(index, 1); },
    parts => parts.find(part => type(part) === 'fcTL').writeUInt32BE(999, 12),
  ]) {
    const changed = chunks(apng); mutation(changed); assert.equal(hasCompletePng(assemble(changed)), false);
  }
  const poster = chunks(apng); poster.splice(poster.findIndex(part => type(part) === 'fcTL'), 1);
  poster.find(part => type(part) === 'acTL').writeUInt32BE(2, 8);
  let sequence = 0;
  for (const part of poster) if (['fcTL', 'fdAT'].includes(type(part))) part.writeUInt32BE(sequence++, 8);
  assert.ok(hasCompletePng(assemble(poster)), '先頭の静止画像をアニメーションから除く構成も保持する');
});


test('正式APNG MIMEもPNGと同じ完全性検査を通し、原本bytesと拡張子を保持する', async t => {
  const {fetchOriginalMedia, originalMediaExtension} = await import('../dist/extension/app/media/media-fetch.js');
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const parts = chunks(apng);
  const last = parts.findLastIndex(part => type(part) === 'fcTL');
  const missing = assemble(parts.filter((part, index) => index < last || type(part) === 'IEND'));
  const corrupt = Buffer.from(apng); corrupt[corrupt.length - 1] ^= 1;
  for (const mime of ['image/png', 'image/apng']) {
    globalThis.fetch = async () => new Response(apng, {headers: {'content-type': mime}});
    const result = await fetchOriginalMedia('https://example.test/animation', 'image');
    assert.equal(result.type, 'image/png');
    assert.equal(originalMediaExtension(mime), 'png');
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), apng);
    for (const bytes of [missing, corrupt]) {
      await assert.rejects(validateOriginalMedia(new Blob([bytes], {type: mime})), /不完全|破損/);
      globalThis.fetch = async () => new Response(bytes, {headers: {'content-type': mime}});
      await assert.rejects(fetchOriginalMedia('https://example.test/animation', 'image'), /不完全|破損/);
    }
  }
});
