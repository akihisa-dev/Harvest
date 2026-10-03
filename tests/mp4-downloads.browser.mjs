import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {mp4Bytes} from './media-fixtures.mjs';
import {createServer} from 'node:http';

for (const count of [12, 25]) test(`実拡張機能でMP4 ${count}件を完了確認して個別保存する`, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'harvest-mp4-downloads-'));
  const profile = join(temporary, 'profile'), downloads = join(temporary, 'downloads');
  await mkdir(join(profile, 'Default'), {recursive: true});
  await mkdir(downloads);
  await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({download: {default_directory: downloads, prompt_for_download: false}}));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run'],
      locale: 'ja-JP', reducedMotion: 'reduce',
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
    // Exercise Chrome's normal disk-saving behavior rather than Playwright's download override.
    await cdp.send('Browser.setDownloadBehavior', {behavior: 'default'});
    await context.route('https://files.example.test/**', route => route.fulfill({contentType: 'video/mp4',
      body: route.request().method() === 'HEAD' ? '' : mp4Bytes, headers: {'content-length': String(mp4Bytes.length)}}));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/app/index.html`);
    await page.evaluate(count => {
      window.ownDownloads = [];
      const download = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = async options => { const id = await download(options); window.ownDownloads.push(id); return id; };
      chrome.tabs.query = async () => [{id: 7, url: 'https://source.example.test/gallery'}];
      chrome.tabs.get = async () => ({id: 7, url: 'https://source.example.test/gallery'});
      chrome.scripting.executeScript = async () => [{result: {url: 'https://source.example.test/gallery', title: 'batch', images: [],
        media: Array.from({length: count}, (_, i) => ({url: `https://files.example.test/${i}.mp4`, kind: 'video'}))}}];
    }, count);
    await page.locator('#scan').click();
    await page.waitForFunction(() => (document.querySelector('#scan').dataset.scanning === "false" && !document.querySelector('#scan').disabled));
    assert.equal(await page.locator('#images > li').count(), count);
    await page.locator('#export').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
    assert.equal(await page.locator('#export').textContent(), `${count}件保存しました`);
    const states = await page.evaluate(async () => Promise.all(window.ownDownloads.map(async id => (await chrome.downloads.search({id}))[0].state)));
    assert.deepEqual(states, Array(count).fill('complete'));
    const names = Array.from({length: count}, (_, i) => `batch_${String(i + 1).padStart(3, '0')}.mp4`);
    assert.deepEqual((await readdir(downloads)).sort(), names);
    for (const name of names) assert.deepEqual(await readFile(join(downloads, name)), mp4Bytes, name);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    await rm(temporary, {recursive: true, force: true});
  }
});

for (const mode of ['rejected', 'interrupted', 'abort', 'pending-abort']) test(`実Chromeの${mode}後は未保存MP4だけを再試行する`, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'harvest-mp4-retry-'));
  const downloads = join(temporary, 'downloads'), profile = join(temporary, 'profile');
  await mkdir(join(profile, 'Default'), {recursive: true});
  await mkdir(downloads);
  await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({download: {default_directory: downloads, prompt_for_download: false}}));
  // Keep the second native download in progress so cancellation is deterministic.
  const server = createServer((req, res) => {
    res.writeHead(200, {'content-type': 'video/mp4', 'content-length': mp4Bytes.length});
    res.write(mp4Bytes.subarray(0, 800));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {channel: 'chrome', headless: true,
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run'], locale: 'ja-JP', reducedMotion: 'reduce'});
    const cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
    await cdp.send('Browser.setDownloadBehavior', {behavior: 'default'});
    await context.route('https://files.example.test/**', route => route.fulfill({contentType: 'video/mp4', body: mp4Bytes}));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/app/index.html`);
    await page.evaluate(({mode, port}) => {
      window.attempts = [];
      window.ownDownloads = [];
      const download = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = async options => {
        window.attempts.push(options.filename);
        if (window.attempts.length === 2) {
          if (mode === 'rejected') return download({...options, filename: '../invalid.mp4'});
          const id = await download({...options, url: `http://127.0.0.1:${port}/slow.mp4`});
          window.ownDownloads.push(id);
          window.waitingId = id;
          if (mode === 'pending-abort') await new Promise(resolve => { window.releaseId = resolve; });
          return id;
        }
        const id = await download(options); window.ownDownloads.push(id); return id;
      };
      chrome.tabs.query = async () => [{id: 7, url: 'https://source.example.test/gallery'}];
      chrome.tabs.get = async () => ({id: 7, url: 'https://source.example.test/gallery'});
      chrome.scripting.executeScript = async () => [{result: {url: 'https://source.example.test/gallery', title: 'retry', images: [],
        media: Array.from({length: 3}, (_, i) => ({url: `https://files.example.test/${i}.mp4`, kind: 'video'}))}}];
    }, {mode, port: server.address().port});
    await page.locator('#scan').click();
    await page.waitForFunction(() => (document.querySelector('#scan').dataset.scanning === "false" && !document.querySelector('#scan').disabled));
    await page.locator('#export').click();
    if (mode !== 'rejected') {
      await page.waitForFunction(() => window.waitingId !== undefined);
      assert.notEqual(await page.locator('#status').getAttribute('data-state'), 'success');
      assert.equal(await page.locator('#status').getAttribute('data-state'), 'busy');
      if (mode === 'interrupted') await page.evaluate(() => chrome.downloads.cancel(window.waitingId));
      else {
        await page.locator('#export').click();
        if (mode === 'pending-abort') await page.evaluate(() => window.releaseId());
      }
    }
    await page.waitForFunction(() => document.querySelector('#export').textContent === '失敗分を再試行');
    assert.notEqual(await page.locator('#status').getAttribute('data-state'), 'success');
    assert.deepEqual((await readdir(downloads)).filter(name => name.endsWith('.mp4')), ['retry_001.mp4']);
    await page.locator('#export').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
    assert.equal(await page.locator('#export').textContent(), '3件保存しました');
    assert.deepEqual(await page.evaluate(() => window.attempts), ['retry_001.mp4', 'retry_002.mp4', 'retry_002.mp4', 'retry_003.mp4']);
    assert.deepEqual((await readdir(downloads)).sort(), ['retry_001.mp4', 'retry_002.mp4', 'retry_003.mp4']);
    for (const name of await readdir(downloads)) assert.deepEqual(await readFile(join(downloads, name)), mp4Bytes);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(temporary, {recursive: true, force: true});
  }
});
