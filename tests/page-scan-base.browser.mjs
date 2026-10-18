import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {launchBrowser} from './support/browser.mjs';

test('baseの変更・追加・削除で相対候補を再構築し、独立した絶対URLの根拠を保つ', async t => {
  const source = await readFile(new URL('../dist/extension/app/content/page-scan.js', import.meta.url), 'utf8');
  const browser = await launchBrowser(t), page = await browser.newPage();
  await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({contentType: 'text/html', body: '<title>base fixture</title>'}) : route.abort());
  for (const mode of ['change', 'add', 'remove']) {
    await page.goto('https://example.test/viewer');
    await page.setContent(`<head>${mode === 'add' ? '' : '<base href="https://example.test/old/">'}</head><body>
      <a href="anchor.jpg">image</a><svg><image href="svg.png"></image></svg>
      <div data-src="lazy.jpg"></div><picture><source srcset="picture.jpg 2x"></picture>
      <a href="https://example.test/old/shared.jpg">absolute</a><a href="shared.jpg">relative</a>
      <div style="background-image:url(background.png)"></div></body>`);
    const result = await page.evaluate(async ({source, mode}) => {
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
      const {scanDocument} = await import(moduleUrl); URL.revokeObjectURL(moduleUrl);
      const original = getComputedStyle; let changed = false;
      window.getComputedStyle = (...args) => {
        const result = original(...args);
        if (!changed) {
          changed = true;
          setTimeout(() => {
            if (mode === 'remove') document.querySelector('base').remove();
            else if (mode === 'change') document.querySelector('base').href = 'https://example.test/new/';
            else {const base = document.createElement('base'); base.href = 'https://example.test/new/'; document.head.append(base);}
          }, 0);
        }
        return result;
      };
      try { return {scan: await scanDocument(), background: getComputedStyle(document.querySelector('[style]')).backgroundImage}; } finally { window.getComputedStyle = original; }
    }, {source, mode});
    const base = mode === 'remove' ? 'https://example.test/' : 'https://example.test/new/';
    const expected = ['anchor.jpg', 'svg.png', 'lazy.jpg', 'picture.jpg', 'shared.jpg', 'background.png'].map(name => base + name);
    expected.push('https://example.test/old/shared.jpg');
    // CSS retains the base used when the declaration was parsed. Keep its
    // independently computed URL as well as the newly resolved inline reference.
    const cssUrl = `https://example.test/${mode === 'add' ? '' : 'old/'}background.png`;
    assert.equal(result.background, `url("${cssUrl}")`);
    expected.push(cssUrl);
    assert.deepEqual(new Set(result.scan.images), new Set(expected), mode);
    assert.deepEqual(new Set(result.scan.media.map(item => item.url)), new Set(expected), mode);
  }
});
