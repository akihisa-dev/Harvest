import {temporaryDirectory, launchExtensionContext} from './support/browser.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {resourcesFor} from './support/resources.mjs';

test('実拡張機能で同一・異なるoriginと入れ子iframeを解析し、外側の選択を保つ', {timeout: 30000}, async t => {
  const temporary = await temporaryDirectory(t, join(tmpdir(), 'harvest-frames-'));
  const context = await launchExtensionContext(t, join(temporary, 'profile'));
  const cdp = await resourcesFor(t).acquire(() => context.browser().newBrowserCDPSession(), session => session.detach());
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url());
    let body = '';
    if (url.pathname === '/book') body = '<img src="/pages/outer.jpg"><iframe src="/viewer"></iframe><iframe src="https://other.test/viewer"></iframe><iframe src="https://broken.test/blocked"></iframe>';
    else if (url.pathname === '/empty') body = '<iframe src="https://other.test/viewer"></iframe>';
    else if (url.pathname === '/plain') body = '<img src="/pages/outer.jpg">';
    else if (url.pathname === '/viewer') body = '<img src="/pages/002.jpg" style="display:block"><img src="/pages/001.jpg" style="display:block"><video src="/movie.mp4" preload="none"></video>'
      + (url.hostname === 'outer.test' ? '<iframe src="https://nested.test/inner"></iframe>' : '');
    else if (url.pathname === '/inner') body = '<img src="/pages/nested.jpg">';
    else if (url.pathname === '/blocked') return route.fulfill({status: 200, headers: {'X-Frame-Options': 'DENY'}, body: '<img src="/secret.jpg">'});
    else return route.abort();
    return route.fulfill({contentType: 'text/html', body: `<!doctype html><title>Fixture</title>${body}`});
  });
  const page = await context.newPage();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/app/index.html`);
  for (const path of ['book', 'empty', 'plain']) {
    const url = `https://outer.test/${path}`;
    await page.goto(url);
    const result = await panel.evaluate(async url => {
      const {scanTab} = await import(chrome.runtime.getURL('app/browser/page-access.js'));
      const {collectPageMedia} = await import(chrome.runtime.getURL('core/page-media.js'));
      const {ImageCollection} = await import(chrome.runtime.getURL('core/image-collection.js'));
      const [tab] = await chrome.tabs.query({url});
      const scan = await scanTab(tab.id);
      const collected = collectPageMedia(scan, scan.frames);
      const collection = new ImageCollection();
      collection.replace(collected.urls, scan.url, collected.media, collected.initial);
      return {scan, items: collection.items, selected: collection.selectedItems};
    }, url);
    if (path === 'plain') {
      assert.equal(result.scan.frames, undefined);
      assert.deepEqual(result.selected.map(item => item.url), ['https://outer.test/pages/outer.jpg']);
    } else {
      assert.deepEqual(result.scan.frames.map(frame => frame.url), path === 'book'
        ? ['https://outer.test/viewer', 'https://nested.test/inner', 'https://other.test/viewer']
        : ['https://other.test/viewer']);
      const cross = result.scan.frames.find(frame => frame.url === 'https://other.test/viewer');
      assert.deepEqual(cross.images, ['https://other.test/pages/002.jpg', 'https://other.test/pages/001.jpg']);
      assert.ok(result.items.some(item => item.url === 'https://other.test/movie.mp4' && item.kind === 'video'));
      assert.deepEqual(result.selected.map(item => item.url), path === 'book'
        ? ['https://outer.test/pages/outer.jpg'] : cross.images);
    }
  }
});
