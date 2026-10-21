import {join} from "node:path";
import {tmpdir} from "node:os";
import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {animatedGif, redPng} from './animation-fixtures.mjs';
import {mp4Bytes} from './media-fixtures.mjs';

for (const locale of ['ja-JP', 'en-US']) test(`保存ボタンは画像・PDF・画像混在を枚数、動画をパーセントで表示する: ${locale}`, {timeout: 60000}, async t => {
  const {page, scan} = await animationPanel(t, new Map([
    ['/red.png', [redPng, 'image/png']], ['/second.png', [redPng, 'image/png']], ['/movie.mp4', [mp4Bytes, 'video/mp4']], ['/animated.gif', [animatedGif, 'image/gif']],
  ]), {locale, responseDelayMs: (_request, path) => path === "/second.png" ? 1000 : 100});
  await page.setViewportSize({width: locale === 'ja-JP' ? 320 : 800, height: 400});
  assert.match(page.url(), /^chrome-extension:/);
  assert.ok(await page.title());
  await page.evaluate(() => {
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (!String(args[0]).endsWith('/movie.mp4')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let offset = 0;
      return new Response(new ReadableStream({async pull(controller) {
        await new Promise(resolve => setTimeout(resolve, 40));
        if (offset >= bytes.length) {controller.close(); return;}
        controller.enqueue(bytes.slice(offset, offset += 128));
      }}), {headers: response.headers});
    };
    new MutationObserver(() => {
      const button = document.querySelector('#export');
      if (button.dataset.saving === 'true') window.progressLabels?.push(button.querySelector('.button-label').textContent);
    }).observe(document.querySelector('#export'), {subtree: true, childList: true, characterData: true});
  });
  for (const [name, paths, imageFormat, videoFormat, percentage] of [
    ['image', ['/red.png'], 'png', 'original', false],
    ['gif', ['/animated.gif'], 'pdf', 'original', false],
    ['video', ['/movie.mp4'], 'png', 'original', true],
    ['mp4', ['/movie.mp4'], 'png', 'mp4', true],
    ['pdf', ['/red.png'], 'pdf', 'original', false],
    ['pdf-pages', ['/red.png', '/second.png'], 'pdf', 'original', false],
    ['mixed', ['/red.png', '/movie.mp4'], 'png', 'original', false],
    ['mixed-pdf', ['/red.png', '/movie.mp4'], 'pdf', 'original', false],
  ]) {
    await scan(paths, name);
    if (await page.locator('#image-export-formats').isVisible()) await page.locator(`#export-format-${imageFormat}`).check();
    if (paths.includes('/movie.mp4')) await page.locator(`#video-export-format-${videoFormat}`).check();
    await page.evaluate(() => {window.progressLabels = [];});
    await page.locator('#export').click();
    if (name === 'pdf-pages') {
      await page.waitForFunction(() => document.querySelector('#export .button-label').textContent === '1 / 2');
      await page.screenshot({path: join(tmpdir(), `harvest-pdf-count-progress-${locale}.png`)});
    }
    if (name === 'video') {
      await page.waitForFunction(() => {
        const label = document.querySelector('#export .button-label').textContent;
        return /^\d+%$/.test(label) && parseInt(label) > 0 && parseInt(label) < 80;
      });
      await page.screenshot({path: join(tmpdir(), `harvest-export-progress-${locale}.png`)});
      assert.equal(await page.locator('#export').isEnabled(), true, '進捗表示中も中止できる');
    }
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success' || !document.querySelector('#failures').hidden);
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'success', `${name}: ${await page.locator('#failures').textContent()}`);
    const labels = await page.evaluate(() => window.progressLabels);
    assert.ok(labels.length > 0, name);
    assert.ok(labels.every(label => (percentage ? /^\d+%$/ : /^\d+ \/ \d+$/).test(label)), `${name}: ${JSON.stringify(labels)}`);
    if (!percentage) {
      assert.equal(labels.at(-1), `${paths.length} / ${paths.length}`, `${name}: 保存完了確認中も元の枚数を保つ`);
      assert.ok(labels.every(label => {
        const [completed, total] = label.split(' / ').map(Number);
        return Number.isInteger(completed) && completed <= total;
      }));
    }
    if (percentage) {
      const values = labels.map(Number.parseFloat);
      assert.ok(values.every((value, index) => value < 100 && (!index || value >= values[index - 1])), `${name}: ${values}`);
    }
    assert.equal(await page.locator('#export').getAttribute('data-saved'), 'true');
    assert.ok(await page.locator('#source-drop').isVisible());
  }
});
