import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {launchBrowser} from './support/browser.mjs';
import {pngBytes} from './original-fixtures.mjs';
import {collectPageMedia} from '../dist/extension/core/page-media.js';
import {ImageCollection} from '../dist/extension/core/image-collection.js';

test('srcsetの1x省略と明示で収集・初期選択が一致し、最大候補と表示中の画像を保つ', async t => {
  const source = await readFile(new URL('../dist/extension/app/content/page-scan.js', import.meta.url), 'utf8');
  const browser = await launchBrowser(t);
  for (const deviceScaleFactor of [0.5, 1, 2]) {
    const context = await browser.newContext({deviceScaleFactor});
    try {
      const page = await context.newPage();
      await page.route('**/*', route => route.fulfill({contentType: 'image/png', body: pngBytes}));
      const results = [];
      for (const srcset of ['/pages/full.png, /pages/half.png 0.5x', '/pages/full.png 1x, /pages/half.png 0.5x']) {
        await page.setContent('<base href="https://example.test/"><img>');
        const {scan, currentSrc} = await page.evaluate(async ({source, srcset}) => {
          const image = document.querySelector('img');
          image.srcset = srcset;
          await image.decode();
          const moduleUrl = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
          try {
            const {scanDocument} = await import(moduleUrl);
            return {scan: await scanDocument(), currentSrc: image.currentSrc};
          } finally { URL.revokeObjectURL(moduleUrl); }
        }, {source, srcset});
        const expected = ['https://example.test/pages/full.png'];
        if (deviceScaleFactor === 0.5) expected.push('https://example.test/pages/half.png');
        assert.equal(currentSrc, expected.at(-1));
        const collected = collectPageMedia(scan), collection = new ImageCollection();
        collection.replace(collected.urls, scan.url, collected.media);
        const items = collection.items.map(({url, selected}) => ({url, selected}));
        assert.deepEqual(items, expected.map(url => ({url, selected: true})), `${deviceScaleFactor}: ${srcset}`);
        results.push(items);
      }
      assert.deepEqual(results[0], results[1]);
    } finally { await context.close(); }
  }
});
