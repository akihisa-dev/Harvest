import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {join, resolve, basename} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {mp4Bytes} from './media-fixtures.mjs';

const titles = [
  ['あ'.repeat(99) + '😀後続', 'あ'.repeat(99)],
  ['あ'.repeat(98) + '😀後続', 'あ'.repeat(98) + '😀'],
  ['日本語'.repeat(50), '日本語'.repeat(50).slice(0, 100)],
  ['😀'.repeat(60), '😀'.repeat(50)],
  ['.leading', 'leading'], ['trailing.', 'trailing'],
  ['...', '画像'], ['   ', '画像'], ['制御\u0000\n\u007f文字', '制御___文字'],
];

test('実Chromeでタイトル境界の単体・複数MP4を安全な名前で保存する', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'harvest-filenames-'));
  const profile = join(temporary, 'profile'), downloads = join(temporary, 'downloads');
  await mkdir(join(profile, 'Default'), {recursive: true}); await mkdir(downloads);
  await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({download: {default_directory: downloads, prompt_for_download: false}}));
  const existing = Buffer.from('existing fixture file');
  await writeFile(join(downloads, 'leading.mp4'), existing);
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
    await page.evaluate(() => {
      window.fixture = {}; window.downloads = [];
      const download = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = async options => { const id = await download(options); window.downloads.push({id, filename: options.filename}); return id; };
      chrome.tabs.query = async () => [{id: 7, url: 'https://source.example.test/gallery'}];
      chrome.tabs.get = async () => ({id: 7, url: 'https://source.example.test/gallery'});
      chrome.scripting.executeScript = async () => [{result: window.fixture}];
    });
    for (const [title, base] of titles) for (const count of [1, 2]) {
      await page.evaluate(({title, count}) => {window.downloads = []; window.fixture = {url: 'https://source.example.test/gallery', title, images: [],
        media: Array.from({length: count}, (_, i) => ({url: `https://files.example.test/${i}.mp4`, kind: 'video'}))};}, {title, count});
      await page.locator('#scan').click(); await page.waitForFunction(() => (document.querySelector('#scan').dataset.scanning === "false" && !document.querySelector('#scan').disabled));
      await page.locator('#export-format-mp4').check();
      assert.equal(await page.locator('#source-drop').textContent(), count === 1 ? base + '.mp4' : base + '_001.mp4');
      await page.locator('#export').click(); await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
      assert.equal(await page.locator('#export').textContent(), `${count}件保存しました`);
      const results = await page.evaluate(async () => Promise.all(window.downloads.map(async record => ({...record, item: (await chrome.downloads.search({id: record.id}))[0]}))));
      assert.deepEqual(results.map(r => r.filename), count === 1 ? [base + '.mp4'] : [base + '_001.mp4', base + '_002.mp4']);
      for (const result of results) {
        assert.equal(result.item.state, 'complete');
        assert.deepEqual(await readFile(result.item.filename), mp4Bytes);
      }
      if (title === '.leading' && count === 1) assert.equal(basename(results[0].item.filename), 'leading (1).mp4');
    }
    assert.deepEqual(await readFile(join(downloads, 'leading.mp4')), existing);
    assert.equal((await readdir(downloads)).length, titles.length * 3 + 1);
    assert.deepEqual(errors, []);
  } finally { await context?.close(); await rm(temporary, {recursive: true, force: true}); }
});
