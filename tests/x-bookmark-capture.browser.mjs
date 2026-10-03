import {temporaryDirectory, launchExtensionContext} from "./support/browser.mjs";
import assert from 'node:assert/strict';
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

test('受信したブックマークをDOM脱落後も原寸・動画付きで解析し、追加通信せず画面を分離する', {timeout: 30000}, async (t) => {
  const temp = await temporaryDirectory(t, join(tmpdir(), 'harvest-bookmark-capture-'));
  let context, cdp;
  try {
    const context = await launchExtensionContext(t, `${temp}/profile`, {args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run', '--no-default-browser-check']});
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

  }
});

test('RequestのPOST本文を消費せずページ追加し、非同期判定も要求開始順と画面の世代を守る', {timeout: 30000}, async (t) => {
  const temp = await temporaryDirectory(t, join(tmpdir(), 'harvest-bookmark-request-'));
  let context, cdp;
  const pending = new Map(), requests = [];
  try {
    const context = await launchExtensionContext(t, `${temp}/profile`, {args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run', '--no-default-browser-check']});
    cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', {path: resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? 'dist/extension')});
    await context.route(/^https?:\/\//, async route => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.includes('/graphql/')) return route.fulfill({contentType: 'text/html', body: '<!doctype html><main></main>'});
      requests.push({method: req.method(), body: req.postData(), header: req.headers()['x-fixture']});
      const finish = () => url.searchParams.get('fail') === 'network' ? route.abort('failed') : route.fulfill({
        status: url.searchParams.get('fail') === 'http' ? 500 : 200, contentType: 'application/json',
        body: url.searchParams.get('fail') === 'json' ? 'invalid json' : JSON.stringify(response([Number(url.searchParams.get('id'))])),
        });
      const key = url.searchParams.get('delay');
      if (key) { pending.set(key, finish); return; }
      return finish();
    });
    const page = await context.newPage();
    await page.goto('https://x.com/i/history');
    const snapshot = () => page.evaluate(() => {
      const data = window.__harvestBookmarkMediaV1();
      return {ids: data.posts.map(p => p.postId), limited: data.limited, received: data.received};
    });
    const expect = async (ids, limited = false) => {
      await page.waitForFunction(({ids, limited}) => {
        const data = window.__harvestBookmarkMediaV1();
        return JSON.stringify(data.posts.map(p => p.postId)) === JSON.stringify(ids) && data.limited === limited;
      }, {ids: ids.map(String), limited}, {timeout: 3000});
    };
    let sequence = 0;
    const start = async (id, options = {}) => {
      const key = String(++sequence);
      await page.evaluate(({id, options, key}) => {
        window.fixtureJobs ??= {};
        window.fixtureMetadata ??= {};
        const variables = options.cursor ? {cursor: options.cursor} : {};
        const body = JSON.stringify({variables});
        const url = new URL('/i/api/graphql/fixture/' + (options.operation ?? 'Bookmarks'), location.href);
        url.searchParams.set('id', id);
        if (options.delay) url.searchParams.set('delay', key);
        if (options.fail) url.searchParams.set('fail', options.fail);
        let input = url.href, init;
        if (options.kind === 'get') url.searchParams.set('variables', JSON.stringify(variables));
        if (options.kind === 'get') input = url.href;
        else if (options.kind === 'init') init = {method: 'POST', body, headers: {'x-fixture': 'preserved'}};
        else {
          const inputBody = options.override === 'body'
            ? JSON.stringify({variables: options.cursor ? {} : {cursor: 'input-only'}}) : body;
          input = new Request(url, {method: 'POST', body: inputBody, headers: {'x-fixture': 'preserved'}});
          if (options.override === 'body') init = {body, headers: {'x-fixture': 'preserved'}};
          if (options.override === 'headers') init = {headers: {'x-fixture': 'overridden'}};
          if (options.override === 'null') init = {body: null};
          if (options.override === 'undefined') init = {body: undefined};
          if (options.override === 'blob') init = {body: new Blob([body])};
          if (options.metadata || options.readFailure) {
            const clone = input.clone.bind(input);
            input.clone = () => {
              if (options.readFailure === 'clone') throw new Error('fixture clone failure');
              const copy = clone(), text = copy.text.bind(copy);
              copy.text = () => options.readFailure === 'text' ? Promise.reject(new Error('fixture read failure'))
                : new Promise((resolve, reject) => {
                  window.fixtureMetadata[key] = async () => options.metadataFailure
                    ? reject(new Error('fixture delayed read failure')) : resolve(await text());
                });
              return copy;
            };
          }
        }
        if (options.transport === 'xhr') {
          const xhr = window.fixtureXHR ??= new XMLHttpRequest();
          xhr.open('POST', url); xhr.responseType = 'json';
          window.fixtureJobs[key] = new Promise(resolve => {
            xhr.onload = () => resolve({status: xhr.status, data: xhr.response});
            xhr.onerror = () => resolve({error: true});
            xhr.onabort = () => resolve({aborted: true});
          });
          xhr.send(body);
        } else window.fixtureJobs[key] = fetch(input, init).then(async r => ({status: r.status, data: await r.json()})).catch(() => ({error: true}));
      }, {id, options, key});
      return key;
    };
    const result = key => page.evaluate(key => window.fixtureJobs[key], key);
    const metadata = key => page.evaluate(key => window.fixtureMetadata[key](), key);
    const release = async key => {
      for (let attempts = 0; !pending.has(key) && attempts < 100; attempts++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.ok(pending.has(key), 'X自身の要求がfixtureへ届く');
      await pending.get(key)(); pending.delete(key);
      return result(key);
    };
    const request = async (id, options) => {
      const key = await start(id, options);
      const original = await result(key);
      assert.deepEqual(original.data, response([id]), '元の応答をX自身が読める');
      return key;
    };
    for (const options of [
      {kind: 'get'}, {kind: 'init'}, {}, {override: 'body'}, {override: 'headers'}, {override: 'null'}, {override: 'undefined'},
    ]) {
      await request(1, options); await expect([1]);
      await request(3, {...options, cursor: 'page2'}); await expect([1, 3]);
      const wire = requests.at(-1);
      assert.equal(wire.method, options.kind === 'get' ? 'GET' : 'POST');
      assert.equal(wire.body, options.kind === 'get' ? null : JSON.stringify({variables: {cursor: 'page2'}}));
      if (options.kind !== 'get') assert.equal(wire.header, options.override === 'headers' ? 'overridden' : 'preserved');
      await request(4, options); await expect([4]);
    }
    for (const options of [{readFailure: 'clone'}, {readFailure: 'text'}, {override: 'blob'}]) {
      await request(1); await expect([1]);
      await request(3, {...options, cursor: 'page2'}); await expect([1], true);
    }
    // A delayed head-body read precedes an already returned cursor page, including XHR.
    for (const transport of ['fetch', 'xhr']) {
      await request(1); await expect([1]);
      const head = await start(3, {metadata: true});
      const next = await start(4, {kind: 'init', cursor: 'page2', transport});
      assert.deepEqual((await result(next)).data, response([4]));
      assert.deepEqual((await result(head)).data, response([3]), '応答の消費をmetadata待ちで妨げない');
      await metadata(head); await expect([3, 4]);
    }
    // A later head replaces a preceding delayed cursor (or head), regardless of body-read completion order.
    for (const cursor of [undefined, 'page2']) {
      await request(1); await expect([1]);
      const old = await start(3, {metadata: true, cursor});
      const head = await start(4, {metadata: true});
      await result(old); await result(head);
      await metadata(head); await metadata(old); await expect([4]);
    }
    for (const cursor of [undefined, 'page2']) for (const transition of ['history', 'likes', 'head'])
      for (const fail of [undefined, 'http', 'json', 'network', 'metadata']) {
      await request(1); await expect([1]);
      const old = await start(3, {metadata: true, metadataFailure: fail === 'metadata', cursor, delay: true, fail});
      if (transition === 'history') await page.evaluate(() => {
        history.pushState({}, '', '/home'); history.pushState({}, '', '/i/history');
      });
      if (transition === 'likes') await request(9, {operation: 'Likes'});
      const head = await start(4, {kind: 'init'});
      await result(head);
      await metadata(old); await release(old); await expect([4]);
      // A subsequent cursor response establishes that late old failures did not set limited.
      await request(5, {cursor: 'page2'}); await expect([4, 5]);
    }
    // XHR load must snapshot its response before the same object is opened again.
    const head = await start(6, {metadata: true});
    await request(7, {cursor: 'page2', transport: 'xhr'});
    await request(8, {cursor: 'page3', transport: 'xhr'});
    await metadata(head); await result(head); await expect([6, 7, 8]);
    assert.deepEqual(await snapshot(), {ids: ['6', '7', '8'], limited: false, received: true});
    assert.equal(requests.length, sequence, '捕捉処理は追加API要求を送らない');
  } finally {
    await cdp?.detach();

  }
});
