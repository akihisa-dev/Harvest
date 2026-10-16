import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {startServer} from './support/browser.mjs';
import {redPng, bluePng} from './animation-fixtures.mjs';
import {mp4Bytes} from './media-fixtures.mjs';

for (const [format, paths] of [
  ['pdf', ['/red.png']], ['png', ['/red.png']],
  ['png', ['/red.png', '/blue.png']], ['original', ['/red.png', '/movie.mp4']],
]) test(`${format}/${paths.length}件は保存の拒否・取消後に再試行し完了までURLを保持する`, {timeout: 60000}, async t => {
  const slow = await startServer(t, (_, res) => { res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': 65536}); res.write(Buffer.alloc(1024)); });
  const assets = new Map([['/red.png', [redPng, 'image/png']], ['/blue.png', [bluePng, 'image/png']],
    ['/movie.mp4', [mp4Bytes, 'video/mp4']], ['/slow.bin', [Buffer.alloc(65536), 'application/octet-stream']]]);
  const {page, scan, saved, requests} = await animationPanel(t, assets, {responseDelayMs: (_, path) => path === '/slow.bin' ? 30000 : 0});
  await scan(paths, 'completion');
  const source = await page.locator('#source-url').inputValue();
  await page.locator(`#export-format-${format}`).check();
  await page.evaluate(source => {
    window.originalDownload = chrome.downloads.download.bind(chrome.downloads);
    window.createdUrls = []; window.revokedUrls = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.createdUrls.push(url); return url; };
    URL.revokeObjectURL = url => { window.revokedUrls.push(url); revoke(url); };
    chrome.downloads.download = options => window.originalDownload({...options, filename: '../invalid'});
    window.slowUrl = new URL('/slow.bin', source).href;
  }, source);
  await page.evaluate(port => { window.slowUrl = `http://127.0.0.1:${port}/slow.bin`; }, slow.address().port);
  await page.locator('#export').click();
  await page.waitForFunction(() => document.querySelector('#export').textContent === '失敗分を再試行');
  assert.equal(await page.locator('#source-url').inputValue(), source);
  const fetched = requests().filter(path => path !== '/slow.bin').length;
  await page.evaluate(() => {
    chrome.downloads.download = async options => { const id = await window.originalDownload({...options, url: window.slowUrl}); window.waitingId = id; return id; };
  });
  await page.locator('#export').click();
  await page.waitForFunction(() => window.waitingId !== undefined);
  assert.equal(await page.locator('#status').getAttribute('data-state'), 'busy');
  assert.equal(await page.locator('#source-url').inputValue(), source);
  await page.evaluate(() => chrome.downloads.cancel(window.waitingId));
  await page.waitForFunction(() => document.querySelector('#export').textContent === '失敗分を再試行');
  assert.equal(await page.locator('#source-url').inputValue(), source);
  await page.evaluate(() => { chrome.downloads.download = window.originalDownload; });
  const result = await saved(format);
  assert.ok(result.bytes.length > 0);
  assert.equal(await page.locator('#source-url').inputValue(), '');
  assert.equal(requests().filter(path => path !== '/slow.bin').length, fetched, '準備済みデータは再取得しない');
  assert.equal(await page.evaluate(() => window.createdUrls.every(url => window.revokedUrls.includes(url))), true);
});
