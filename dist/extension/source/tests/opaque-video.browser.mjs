import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel, readCompletedDownload} from './support/animation-panel.mjs';
import {mp4Bytes} from './media-fixtures.mjs';
import {webmBytes} from './original-fixtures.mjs';

test('拡張子のないvideo URLを収集しMP4・WebM原本として保存する', {timeout: 60000}, async t => {
  const assets = new Map([['/opaque-one', [mp4Bytes, 'video/mp4']], ['/opaque-two', [webmBytes, 'video/webm']]]);
  const {page, scan, count} = await animationPanel(t, assets);
  for (const [path, [bytes, mime]] of assets) {
    await scan([path], 'opaque-video');
    await page.locator('#video-export-format-original').check();
    const before = await count();
    await page.locator('#export').click();
    await page.waitForFunction(before => window.downloadIds.length === before + 1, before);
    await page.waitForFunction(async () => (await chrome.downloads.search({id: window.downloadIds.at(-1)}))[0]?.state === 'complete');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
    const result = await page.evaluate(async () => (await chrome.downloads.search({id: window.downloadIds.at(-1)}))[0]);
    result.bytes = await readCompletedDownload(result.filename);
    assert.equal(result.filename.endsWith(`.${mime.split('/')[1]}`), true);
    assert.deepEqual(result.bytes, bytes);
  }
});
