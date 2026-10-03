import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {chromium} from 'playwright';
import test from 'node:test';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

const response = ids => ({data: {bookmark_timeline_v2: {timeline: {instructions: [{type: 'TimelineAddEntries', entries: ids.map(id => ({
  entryId: `tweet-${id}`, content: {itemContent: {tweet_results: {result: {rest_id: String(id),
    core: {user_results: {result: {secret: 'PRIVATE_AUTHOR'}}}, legacy: {full_text: 'PRIVATE_TEXT', extended_entities: {media: [
      {type: 'photo', media_url_https: `https://pbs.twimg.com/media/image${id}.jpg`},
      ...(id === 2 ? [{type: 'video', media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/poster.jpg', video_info: {variants: [
        {url: 'https://video.twimg.com/low.mp4', content_type: 'video/mp4', bitrate: 10},
        {url: 'https://video.twimg.com/high.mp4', content_type: 'video/mp4', bitrate: 20},
      ]}}] : []),
    ]}}}}}},
  }))}]}}}});

test('受信したブックマークをDOM脱落後も原寸・動画付きで解析し、追加通信せず画面を分離する', {timeout: 30000}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'harvest-bookmark-capture-'));
  let context, cdp;
  try {
    context = await chromium.launchPersistentContext(`${temp}/profile`, {
      channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run', '--no-default-browser-check'],
    });
    cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? 'dist/extension')});
    let nextResponse = response([1, 2]);
    let requestCount = 0;
    await context.route(/^https?:\/\//, route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/graphql/')) {
        requestCount++;
        return route.fulfill({contentType: 'application/json', body: JSON.stringify(nextResponse)});
      }
      if (url.hostname === 'pbs.twimg.com') return route.abort();
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Bookmark fixture</title><main></main>'});
    });
    const page = await context.newPage();
    await page.goto('https://x.com/i/history');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/app/index.html`);
    const request = async (cursor, xhr = false, operation = 'Bookmarks') => {
      const result = await page.evaluate(async ({cursor, xhr, operation}) => {
        const url = '/i/api/graphql/fixture/' + operation + '?variables=' + encodeURIComponent(JSON.stringify(cursor ? {cursor} : {}));
        if (!xhr) return (await fetch(url)).json();
        return new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open('GET', url);
          request.responseType = 'json';
          request.onload = () => resolve(request.response);
          request.onerror = reject;
          request.send();
        });
      }, {cursor, xhr, operation});
      assert.deepEqual(result, nextResponse, 'X自身も元のレスポンスを読める');
      if (operation === 'Bookmarks') await page.waitForFunction(() => window.__harvestBookmarkMediaV1().received, undefined, {timeout: 3000});
    };
    const snapshot = () => panel.evaluate(async () => {
      const {scanXMedia} = await import(chrome.runtime.getURL('app/content/x-media-scan.js'));
      const {parseXMedia} = await import(chrome.runtime.getURL('core/x-media.js'));
      const [tab] = await chrome.tabs.query({url: 'https://x.com/i/history'});
      const [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: scanXMedia, world: 'MAIN'});
      return {snapshot: result.result, analysis: parseXMedia(result.result)};
    });
    await request();
    await page.evaluate(() => { document.querySelector('main').innerHTML = '<article><a href="/user/status/1"><time>Now</time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/image1?format=jpg&name=small"></div></article>'; });
    let result = await snapshot();
    assert.equal(result.analysis.media.length, 3);
    assert.equal(result.analysis.media[0].url, 'https://pbs.twimg.com/media/image1?format=jpg&name=orig');
    assert.equal(result.analysis.media[2].url, 'https://video.twimg.com/high.mp4');
    assert.ok(!JSON.stringify(result).includes('PRIVATE_'), '本文とユーザー情報は保持しない');
    await page.evaluate(() => document.querySelector('main').replaceChildren());
    assert.deepEqual((await snapshot()).analysis.media, result.analysis.media, 'DOMから消えても保持する');
    const emptyDomScan = await panel.evaluate(async () => {
      const {scanTab} = await import(chrome.runtime.getURL('app/browser/page-access.js'));
      const [tab] = await chrome.tabs.query({url: 'https://x.com/i/history'});
      return scanTab(tab.id);
    });
    assert.equal(emptyDomScan.media.length, 3, '投稿DOMが空でも読み込み済み一覧を解析する');
    assert.equal(emptyDomScan.xDiagnostics.bookmarkCaptureMissing, undefined);
    nextResponse = response([2, 3]);
    await request('page2', true);
    result = await snapshot();
    assert.equal(result.snapshot.posts.length, 3);
    assert.equal(result.analysis.media.length, 4);
    assert.equal(requestCount, 2, '解析によるAPI再取得を行わない');
    nextResponse = response([9]);
    await request(undefined, true);
    assert.deepEqual((await snapshot()).snapshot.posts.map(p => p.postId), ['9'], '先頭再取得は古い一覧を置換する');
    await page.evaluate(() => history.pushState({}, '', '/home'));
    await page.evaluate(() => history.pushState({}, '', '/i/history'));
    assert.equal((await snapshot()).snapshot.posts.length, 0, '別ページへの移動で破棄する');
    nextResponse = response([10]);
    await request();
    nextResponse = {data: {unexpected: {}}};
    await request('malformed', true);
    assert.equal((await snapshot()).snapshot.limited, true, '未知の形式を取得完了にしない');
    assert.deepEqual((await snapshot()).snapshot.posts.map(p => p.postId), ['10'], '形式エラーで取得済みデータを消さない');
    await request(undefined, true, 'Likes');
    assert.equal((await snapshot()).snapshot.posts.length, 0, 'いいねタブと混ぜない');
  } finally {
    await cdp?.detach();
    await context?.close();
    await rm(temp, {recursive: true, force: true});
  }
});
