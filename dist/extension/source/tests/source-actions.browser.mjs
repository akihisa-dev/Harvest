import {temporaryDirectory, launchExtensionContext} from './support/browser.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

async function inspectActions(page, label) {
  await page.waitForTimeout(220); // Include the settled label after its transition.
  const result = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.source-actions button')].map(button => {
      const box = button.getBoundingClientRect(), style = getComputedStyle(button);
      const range = document.createRange();
      range.selectNodeContents(button.querySelector('.button-label') ?? button);
      const inner = {
        left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        top: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
        bottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
      };
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {id: button.id, text: button.textContent, box: box.toJSON(), inner,
        textRects: [...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => rect.toJSON()),
        hit: hit === button || button.contains(hit)};
    });
    const source = document.querySelector('#source-url').hidden ? document.querySelector('#source-drop') : document.querySelector('#source-url');
    const sourceBox = source.getBoundingClientRect();
    return {buttons, source: sourceBox.toJSON(), viewport: innerWidth,
      pageWidth: document.documentElement.scrollWidth, actions: document.querySelector('.source-actions').getBoundingClientRect().toJSON()};
  });
  assert.ok(result.pageWidth <= result.viewport, `${label}: horizontal page overflow`);
  assert.ok(result.source.width >= 40 && result.source.right <= result.buttons[0].box.left, `${label}: source input remains reachable`);
  for (const button of result.buttons) {
    assert.ok(button.hit, `${label}: ${button.id} pointer target`);
    assert.ok(button.box.left >= 0 && button.box.right <= result.viewport, `${label}: ${button.id} viewport`);
    assert.ok(button.textRects.length, `${label}: ${button.id} has painted text`);
    for (const rect of button.textRects) {
      assert.ok(rect.left >= button.inner.left - 0.5 && rect.right <= button.inner.right + 0.5,
        `${label}: ${button.id} text ${rect.left}..${rect.right} outside inner ${button.inner.left}..${button.inner.right}`);
      assert.ok(rect.top >= button.inner.top - 0.5 && rect.bottom <= button.inner.bottom + 0.5,
        `${label}: ${button.id} text height outside padding`);
    }
  }
  for (let i = 1; i < result.buttons.length; i++) assert.ok(result.buttons[i - 1].box.right <= result.buttons[i].box.left, `${label}: adjacent button overlap`);
}

test('実Chromeの上部操作ラベルは狭幅と状態変化後もボタン内側に収まる', async t => {
  const temporary = await temporaryDirectory(t, join(tmpdir(), 'harvest-source-actions-'));
  const context = await launchExtensionContext(t, join(temporary, 'profile'));
  const cdp = await context.browser().newBrowserCDPSession();
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
  let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=', 'base64');
  await context.route('**/*', route => route.request().url().startsWith('chrome-extension:') ? route.continue()
    : route.request().url().startsWith('https://files.example.test/') ? route.fulfill({contentType: 'image/png', body: png}) : route.abort());
  for (const locale of ['ja', 'en']) for (const width of [320, 400, 800]) {
    const page = await context.newPage(), errors = [], label = `${locale}/${width}`;
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({width, height: 600});
    await page.addInitScript(locale => { chrome.i18n.getUILanguage = () => locale; }, locale);
    await page.goto(`chrome-extension://${id}/app/index.html`);
    png = Buffer.from(await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(2, 2);
      canvas.getContext('2d').fillRect(0, 0, 2, 2);
      return [...new Uint8Array(await (await canvas.convertToBlob({type: 'image/png'})).arrayBuffer())];
    }));
    await page.evaluate(() => {
      window.fixture = {url: 'https://source.example.test/gallery', title: 'Fixture', images: ['https://files.example.test/a.png']};
      chrome.tabs.query = async () => [{id: 7, url: window.fixture.url}];
      chrome.tabs.get = async () => ({id: 7, url: window.fixture.url});
      chrome.scripting.executeScript = async request => {
        if (request.func.name === 'scanDocument' && window.holdScan) await new Promise(resolve => { window.releaseScan = resolve; });
        return [{result: window.fixture}];
      };
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...args) {
        if (window.holdEncode) window.releaseEncode = () => toBlob.apply(this, args);
        else toBlob.apply(this, args);
      };
    });
    await inspectActions(page, `${label}/normal`);
    await page.locator('#source-drop').click();
    await page.locator('#source-url').fill('');
    await inspectActions(page, `${label}/input`);
    await page.locator('#collection-toggle').click();
    assert.equal(await page.locator('#collection-toggle').getAttribute('aria-pressed'), 'true');
    await inspectActions(page, `${label}/collecting`);
    await page.locator('#collection-toggle').click();
    assert.equal(await page.locator('#collection-toggle').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => { window.holdScan = true; });
    await page.locator('#scan').click();
    await page.waitForFunction(() => window.releaseScan);
    await inspectActions(page, `${label}/scanning`);
    await page.locator('#scan').click();
    await page.waitForFunction(() => document.querySelector('#scan').dataset.scanning === 'false');
    await page.evaluate(() => { window.holdScan = false; window.releaseScan(); });
    await inspectActions(page, `${label}/scan-stopped`);
    await page.locator('#scan').click();
    await page.waitForFunction(() => document.querySelector('#scan').dataset.scanning === 'false');
    await page.locator('#export-format-jpg').check();
    await page.evaluate(() => { window.holdEncode = true; });
    await page.locator('#export').click();
    await page.waitForFunction(() => window.releaseEncode);
    assert.ok(await page.locator('#scan').isDisabled());
    await inspectActions(page, `${label}/saving`);
    await page.locator('#export').click();
    await page.evaluate(() => { window.holdEncode = false; window.releaseEncode(); });
    await page.waitForFunction(() => document.querySelector('#export').dataset.saving === 'false');
    await page.locator('#reset').click();
    await inspectActions(page, `${label}/cleared`);
    assert.deepEqual(errors, [], label);
    await page.close();
  }
});
