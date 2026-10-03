import {temporaryDirectory, launchExtensionContext} from "./support/browser.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

test('Xの4画面で原寸写真を統合し動画posterを静止画像へ混入させない', {timeout: 30000}, async (t) => {
  const extensionRoot = resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? 'dist/extension');
  const temp = await temporaryDirectory(t, join(tmpdir(), 'harvest-x-photo-'));
  let context, cdp;

  try {
    const context = await launchExtensionContext(t, `${temp}/profile`, {args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run', '--no-default-browser-check']});

    cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: extensionRoot});
    const page = await context.newPage();
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 832; c.height = 1216;
      const original = c.toDataURL('image/png').split(',')[1];
      c.width = 208; c.height = 304;
      return {original, small: c.toDataURL('image/png').split(',')[1]};
    });
    const requests = [];
    await context.route(/^https?:\/\//, route => {
      const url = new URL(route.request().url());
      requests.push(url.href);
      if (url.hostname === 'x.com') return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Controlled X fixture</title><main></main>'});
      if (url.hostname === 'pbs.twimg.com') return route.fulfill({contentType: 'image/png', body: Buffer.from(url.searchParams.get('name') === 'orig' ? png.original : png.small, 'base64')});
      return route.abort();
    });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/app/index.html`);
    for (const path of ['/i/bookmarks', '/user/status/123', '/home', '/user']) {
      const url = `https://x.com${path}`;
      await page.goto(url);
      await page.evaluate(() => {
        const main = document.querySelector('main');
        main.innerHTML = `<article data-testid="tweet"><a href="/user/status/123"><time>Today</time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/photo?format=png&amp;name=small"><img src="https://pbs.twimg.com/media/photo?format=png&amp;name=thumb"><img src="https://pbs.twimg.com/media/unknown?format=unknownformat&amp;name=small"></div><img src="https://pbs.twimg.com/media/second?format=png&amp;name=small"><img src="https://pbs.twimg.com/ext_tw_video_thumb/999/img/poster.jpg"><video preload="none" src="https://video.twimg.com/low.mp4" poster="https://pbs.twimg.com/ext_tw_video_thumb/999/img/poster.jpg"></video></article><img src="https://pbs.twimg.com/ext_tw_video_thumb/998/img/other.jpg">`;
        document.querySelector('article').__reactProps$fixture = {tweet: {rest_id: '123', legacy: {extended_entities: {media: [
          {type: 'photo', media_url_https: 'https://pbs.twimg.com/media/photo?format=png&name=orig'},
          {type: 'photo', media_url_https: 'https://pbs.twimg.com/media/second.png'},
          {type: 'photo', media_url_https: 'https://pbs.twimg.com/media/unknown?format=unknownformat&name=small'},
          {type: 'video', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/999/img/poster.jpg', video_info: {variants: [{url: 'https://video.twimg.com/clip.mp4', content_type: 'video/mp4', bitrate: 100}, {url: 'https://video.twimg.com/low.mp4', content_type: 'video/mp4', bitrate: 10}]}},
        ]}}}};
      });
      await page.bringToFront();
      const requestStart = requests.length;
      const result = await panel.evaluate(async url => {
        const load = p => import(chrome.runtime.getURL(p));
        const {scanTab} = await load('app/browser/page-access.js');
        const {scanXMedia} = await load('app/content/x-media-scan.js');
        const {parseXMedia} = await load('core/x-media.js');
        const {ImageCollection} = await load('core/image-collection.js');
        const {createScanSessionController} = await load('app/panel/scan-session-controller.js');
        const {fetchImage} = await load('app/media/image-fetch.js');
        const {getImageDimensions} = await load('core/image-dimensions.js');
        const [tab] = await chrome.tabs.query({url});
        const target = /\/status\/(\d+)/.exec(url)?.[1];
        const [read] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: scanXMedia, args: target ? [target] : [], world: 'MAIN'});
        const analysis = parseXMedia(read.result, target);
        const scan = await scanTab(tab.id, undefined, url);
        const collection = new ImageCollection();
        const statuses = [];
        const controller = createScanSessionController({collection, getEnteredUrl: () => '', getCollectionSession: () => null,
          clearAnalyzedUrl() {}, markAnalyzedUrl() {}, isBusy: () => false, isDisposed: () => false,
          onHideSourceInput() {}, onShowSourceInput() {}, onBusyChange() {}, onStatus(message, state) {statuses.push({message, state});}, onResults() {}});
        await controller.start();
        const saved = [];
        for (const item of collection.items.filter(item => new URL(item.url).pathname === '/media/photo')) {
          const fetched = await fetchImage(item.url, {sourcePage: url});
          saved.push({url: item.url, dimensions: getImageDimensions(new Uint8Array(await fetched.blob.arrayBuffer()))});
        }
        return {url, observed: read.result.posts.flatMap(p => p.observed), analysis, scan,
          collection: collection.items, selected: collection.selectedItems, controller: {state: controller.state, diagnostics: controller.diagnostics, statuses}, saved};
      }, url);
      result.requests = requests.slice(requestStart);

      assert.equal(result.controller.state, 'results');
      assert.equal(result.analysis.media.filter(i => i.url.includes('/media/photo')).length, 1);
      assert.equal(result.analysis.media.find(i => i.url.includes('/media/photo')).url, 'https://pbs.twimg.com/media/photo?format=png&name=orig');
      assert.equal(result.analysis.media.find(i => i.url.includes('/media/unknown')).url, 'https://pbs.twimg.com/media/unknown?format=unknownformat&name=small');
      assert.equal(result.analysis.media.find(i => i.kind === 'video').previewUrl, 'https://pbs.twimg.com/ext_tw_video_thumb/999/img/poster.jpg');
      assert.equal(result.saved.length, 1, path);
      assert.deepEqual(result.saved[0], {url: 'https://pbs.twimg.com/media/photo?format=png&name=orig', dimensions: {width: 832, height: 1216}}, path);
      const scoped = path === '/i/bookmarks' || path.includes('/status/');
      const second = 'https://pbs.twimg.com/media/second?format=png&name=orig';
      const unknown = 'https://pbs.twimg.com/media/unknown?format=unknownformat&name=small';
      assert.deepEqual(result.collection.map(i => i.url), [
        'https://pbs.twimg.com/media/photo?format=png&name=orig',
        ...(scoped ? [second, unknown] : [unknown, second, 'https://pbs.twimg.com/ext_tw_video_thumb/998/img/other.jpg']),
        'https://video.twimg.com/clip.mp4',
      ], path);
      assert.equal(result.collection.find(i => i.kind === 'video').previewUrl, 'https://pbs.twimg.com/ext_tw_video_thumb/999/img/poster.jpg');
      assert.ok(result.requests.includes('https://pbs.twimg.com/media/photo?format=png&name=orig'));
      assert.equal(result.collection.some(i => i.url.includes('/999/img/poster.jpg')), false, path);
      assert.equal(result.scan.images.some(i => i.includes('/999/img/poster.jpg')), false, path);
      assert.equal(result.scan.media.some(i => i.kind !== 'video' && i.url.includes('/999/img/poster.jpg')), false, path);
      assert.equal(result.controller.diagnostics.rejected, 0);
      assert.equal(result.controller.diagnostics.scan.unresolved, 0);
      assert.equal(result.controller.diagnostics.scan.limited, false);
    }

  } finally {
    await cdp?.detach();

  }

});
