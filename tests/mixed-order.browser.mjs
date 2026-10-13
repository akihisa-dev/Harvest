import {launchBrowser} from './support/browser.mjs';
import {animationPanel} from './support/animation-panel.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import {collectPageMedia} from '../dist/extension/core/page-media.js';
import {ImageCollection} from '../dist/extension/core/image-collection.js';
import {mp4Bytes, gifBytes} from './media-fixtures.mjs';
import {pngBytes} from './original-fixtures.mjs';

test('CSS配置順を画像・GIF・動画で共有し、非表示・重複と手動順序の復元を保つ', async t => {
  const source = await readFile(new URL('../dist/extension/app/content/page-scan.js', import.meta.url), 'utf8');
  const browser = await launchBrowser(t), page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(`<base href="https://media.test/"><style>main{display:flex;flex-direction:column}img,video{width:20px;height:20px}</style>
    <main><img src="second.png" style="order:2"><video src="third.mp4" preload="none" style="order:3"></video>
    <video src="first.mp4" preload="none" style="order:1"></video><img src="fourth.gif" style="order:4">
    <video src="hidden.mp4" preload="none" style="display:none"></video><img src="second.png" style="display:none"></main>`);
  const result = await page.evaluate(async source => {
    const {scanDocument} = await import(URL.createObjectURL(new Blob([source], {type:'text/javascript'})));
    return scanDocument();
  }, source);
  const expected = ['first.mp4', 'second.png', 'third.mp4', 'fourth.gif', 'hidden.mp4'].map(name => `https://media.test/${name}`);
  assert.deepEqual(result.media.map(item => item.url), expected);
  assert.deepEqual(result.images, [expected[1], expected[3]]);
  const combined = collectPageMedia(result), collection = new ImageCollection();
  collection.replace(combined.urls, result.url, combined.media); collection.setAllSelected(true);
  assert.deepEqual(collection.selectedItems.map(item => item.url), expected);
  collection.moveVisible(collection.items, collection.items[0], collection.items[3]);
  assert.notDeepEqual(collection.items.map(item => item.url), expected);
  collection.resetOrder();
  assert.deepEqual(collection.items.map(item => item.url), expected);
});

test('実パネルの全選択と原本ZIPの連番は動画・画像・GIFのページ順を保つ', {timeout: 60000}, async t => {
  const {page, scan, saved} = await animationPanel(t, new Map([
    ['/first.mp4', [mp4Bytes, 'video/mp4']], ['/second.png', [pngBytes, 'image/png']], ['/third.gif', [gifBytes, 'image/gif']],
  ]));
  await scan(['/first.mp4', '/second.png', '/third.gif']);
  await page.locator('#video-export-format-original').check();
  const {bytes} = await saved('original');
  const entries = [];
  for (let at = 0; bytes.readUInt32LE(at) === 0x04034b50;) {
    const size = bytes.readUInt32LE(at + 18), nameSize = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const name = bytes.toString('utf8', at + 30, at + 30 + nameSize), start = at + 30 + nameSize + extra;
    entries.push({name, bytes: bytes.subarray(start, start + size)}); at = start + size;
  }
  assert.deepEqual(entries.map(entry => entry.name), ['001.mp4', '002.png', '003.gif']);
  assert.deepEqual(entries.map(entry => [...entry.bytes]), [mp4Bytes, pngBytes, gifBytes].map(bytes => [...bytes]));
});
