import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {mp4Bytes} from './media-fixtures.mjs';

test('実拡張機能の再解析で動画サイズを更新し、HEAD失敗から回復する', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'harvest-size-reanalysis-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
      channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run'],
      locale: 'ja-JP', reducedMotion: 'reduce',
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
    let length = 1000, status = 200, heads = 0;
    await context.route('https://files.example.test/**', route => {
      const head = route.request().method() === 'HEAD';
      if (head) heads++;
      return route.fulfill({status: head ? status : 200, contentType: 'video/mp4', body: head ? '' : mp4Bytes,
        headers: {'content-length': String(head ? length : mp4Bytes.length)}});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/app/index.html`);
    await page.evaluate(() => {
      chrome.tabs.query = async () => [{id: 7, url: 'https://source.example.test/gallery'}];
      chrome.tabs.get = async () => ({id: 7, url: 'https://source.example.test/gallery'});
      chrome.scripting.executeScript = async () => [{result: {url: 'https://source.example.test/gallery',
        title: 'size', images: [], media: [{url: 'https://files.example.test/movie.mp4', kind: 'video'}]}}];
    });
    const scan = async expected => {
      await page.locator('#scan').click();
      await page.waitForFunction(() => !document.querySelector('#scan').disabled);
      await page.waitForFunction(expected => document.querySelector('.item-resolution')?.textContent === expected, expected);
    };
    await scan('1.0 KB');
    assert.equal(heads, 1);
    await page.locator('#all-selection').uncheck();
    await page.locator('#all-selection').check();
    assert.equal(heads, 1, '選択変更は再取得しない');
    length = 2000;
    await scan('2.0 KB');
    assert.equal(heads, 2);
    status = 405;
    await scan('サイズ不明');
    assert.equal(heads, 3);
    status = 200;
    await scan('2.0 KB');
    assert.equal(heads, 4);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    await rm(temporary, {recursive: true, force: true});
  }
});
