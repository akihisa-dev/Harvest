import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {redPng} from './animation-fixtures.mjs';

function entries(bytes) {
  const result = [];
  for (let at = 0; bytes.readUInt32LE(at) === 0x04034b50;) {
    const size = bytes.readUInt32LE(at + 18), names = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const start = at + 30 + names + extra;
    result.push({name: bytes.toString('utf8', at + 30, at + 30 + names), bytes: bytes.subarray(start, start + size)});
    at = start + size;
  }
  return result;
}

test('PNG指定は配信MIMEが正しい・空・JPEGのどの場合もbytesを保ってPNGを単体とZIPへ保存する', {timeout: 60000}, async t => {
  const assets = new Map(['image/png', '', 'image/jpeg'].map((mime, i) => [`/image-${i}.png`, [redPng, mime]]));
  const {page, scan, saved} = await animationPanel(t, assets);
  for (const [path] of assets) {
    await scan([path], 'png-mime');
    const result = await saved('png');
    assert.match(result.filename, /\.png$/);
    assert.deepEqual(result.bytes, redPng);
  }
  await scan([...assets.keys()], 'png-mime-zip');
  const archive = await saved('png');
  assert.match(archive.filename, /\.zip$/);
  const files = entries(archive.bytes);
  assert.equal(files.length, 3);
  for (const file of files) {
    assert.match(file.name, /\.png$/);
    assert.deepEqual(file.bytes, redPng);
  }
  const types = await page.evaluate(async base64 => {
    const {convertImage} = await import('./media/image-format.js');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return Promise.all(['image/png', '', 'image/jpeg'].map(async type => (await convertImage({kind: 'bitmap', blob: new Blob([bytes], {type})}, 'png')).type));
  }, redPng.toString('base64'));
  assert.deepEqual(types, ['image/png', 'image/png', 'image/png']);
});
