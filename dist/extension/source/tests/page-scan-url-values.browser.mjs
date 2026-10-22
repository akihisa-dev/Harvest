import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {launchBrowser} from './support/browser.mjs';
import {pngBytes} from './original-fixtures.mjs';
import {mp4Bytes} from './media-fixtures.mjs';
import {collectPageMedia} from '../dist/extension/core/page-media.js';
import {ImageCollection} from '../dist/extension/core/image-collection.js';

test('通常URL属性の末尾NBSPをChromeと同じURLで収集し、正しい候補だけを初期選択する', async t => {
  const source = await readFile(new URL('../dist/extension/app/content/page-scan.js', import.meta.url), 'utf8');
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'example.test') return route.abort();
    if (url.pathname === '/gallery') return route.fulfill({contentType: 'text/html', body: '<!doctype html><body></body>'});
    const video = url.pathname.includes('.mp4');
    return route.fulfill({contentType: video ? 'video/mp4' : 'image/png', body: video ? mp4Bytes : pngBytes});
  });
  for (const kind of ['img', 'lazy', 'meta', 'video', 'source']) {
    await page.goto('https://example.test/gallery');
    const {scan, expected, currentSrc} = await page.evaluate(async ({source, kind}) => {
      const video = kind === 'video' || kind === 'source';
      const value = `/pages/one.${video ? 'mp4' : 'png'}\u00a0`;
      const element = document.createElement(kind === 'lazy' ? 'img' : kind);
      let displayed = element;
      if (kind === 'meta') {
        element.setAttribute('property', 'og:image');
        element.setAttribute('content', value);
        document.head.append(element);
      } else {
        element.setAttribute(kind === 'lazy' ? 'data-src' : 'src', value);
        if (kind === 'source') {
          displayed = document.createElement('video');
          element.setAttribute('type', 'video/mp4');
          displayed.append(element);
        }
        document.body.append(displayed);
      }
      if (kind === 'img') await element.decode();
      if (video) await new Promise((resolve, reject) => {
        displayed.addEventListener('loadedmetadata', resolve, {once: true});
        displayed.addEventListener('error', () => reject(new Error('正常動画の読み込み失敗')), {once: true});
        displayed.load();
      });
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
      try {
        const {scanDocument} = await import(moduleUrl);
        return {scan: await scanDocument(), expected: new URL(value, location.href).href, currentSrc: displayed.currentSrc};
      } finally { URL.revokeObjectURL(moduleUrl); }
    }, {source, kind});
    if (['img', 'video', 'source'].includes(kind)) assert.equal(currentSrc, expected, kind);
    const collected = collectPageMedia(scan), collection = new ImageCollection();
    collection.replace(collected.urls, scan.url, collected.media);
    assert.deepEqual(collection.items.map(({url, selected}) => ({url, selected})), [{url: expected, selected: true}], kind);
  }
});
