import {temporaryDirectory, launchExtensionContext} from "./support/browser.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

const postUrl = 'https://x.com/example/status/123/video/1';
const profileUrl = 'https://pbs.twimg.com/profile_images/1/avatar.jpg';
const mp4Url = 'https://video.twimg.com/example.mp4';
const lowUrl = 'https://video.twimg.com/example-low.mp4';

test('実Chromeの拡張機能から遅れて表示されるX動画プレイヤーをMAINで読み取る', {timeout: 30000}, async (t) => {
  const temporary = await temporaryDirectory(t, join(tmpdir(), 'harvest-x-video-'));
  let context, cdp;
  try {
    const context = await launchExtensionContext(t, join(temporary, 'profile'), {args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run', '--no-default-browser-check']});
    cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? 'dist/extension')});
    await context.route('https://x.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>post</title><main><img src="${profileUrl}"><div role="progressbar">Loading</div></main><script>
      setTimeout(()=>{
        document.querySelector('[role=progressbar]').remove();
        const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
        const permalink=document.createElement('a');permalink.href='/example/status/123';permalink.textContent='View post';
        dialog.append(permalink);
        const player=document.createElement('div');const video=document.createElement('video');video.preload='none';video.src='${lowUrl}';player.append(video);player.setAttribute('data-testid','videoPlayer');
        Object.defineProperty(player,'__reactProps$fixture',{value:{media:{variants:[{url:'${lowUrl}',content_type:'video/mp4',bitrate:200000},{url:'${mp4Url}',content_type:'video/mp4',bitrate:2000000}]}}});
        dialog.append(player);document.body.append(dialog);
      },1800);
    </script>`
    }));
    await context.route('https://video.twimg.com/**', route => route.abort());
    await context.route('https://pbs.twimg.com/**', route => route.fulfill({contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')}));
    const post = await context.newPage();
    await post.goto(postUrl);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/app/index.html`);
    const result = await panel.evaluate(async url => {
      const {scanTab} = await import(chrome.runtime.getURL('app/browser/page-access.js'));
      const [tab] = await chrome.tabs.query({url});
      return await scanTab(tab.id, undefined, url);
    }, postUrl);
    assert.equal(result.url, postUrl);
    assert.deepEqual(result.images, [], 'プロフィール画像を解析結果から除外する');
    assert.deepEqual(result.media, [{url: mp4Url, kind: 'video'}]);
  } finally {
    await cdp?.detach();

  }
});

test('実拡張機能で深い画面部品・補完中断があってもブックマークの写真を返す', {timeout: 30000}, async (t) => {
  const temporary = await temporaryDirectory(t, join(tmpdir(), 'harvest-x-limit-'));
  let context, cdp;
  try {
    const context = await launchExtensionContext(t, join(temporary, 'profile'), {args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run', '--no-default-browser-check']});
    cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? 'dist/extension')});
    await context.route('https://x.com/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Bookmarks</title><main></main>'}));
    await context.route('https://pbs.twimg.com/**', route => route.fulfill({contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')}));
    const page = await context.newPage();
    const url = 'https://x.com/i/history';
    await page.goto(url);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/app/index.html`);
    for (const truncated of [false, true]) {
      await page.evaluate(truncated => {
        const main = document.querySelector('main');
        main.replaceChildren();
        for (let i = 0; i < 2; i++) {
          const article = document.createElement('article');
          article.dataset.testid = 'tweet';
          article.innerHTML = `<a href="/example/status/${123 + i}"><time>Today</time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/visible-${i}.jpg"></div>`;
          let fiber = null;
          for (let depth = 0; depth < 55; depth++) fiber = {memoizedProps: {role: 'presentation'}, return: fiber};
          article.__reactFiber$fixture = fiber;
          if (truncated && i === 0) article.__reactProps$fixture = {mediaDetails: Array.from({length: 256}, () => ({mediaDetails: Array.from({length: 256}, () => ({type: 'photo', media_url_https: 'https://pbs.twimg.com/media/extra.jpg'}))}))};
          main.append(article);
        }
      }, truncated);
      const result = await panel.evaluate(async url => {
        const {scanTab} = await import(chrome.runtime.getURL('app/browser/page-access.js'));
        const [tab] = await chrome.tabs.query({url});
        return scanTab(tab.id, undefined, url);
      }, url);
      assert.equal(result.xDiagnostics.limited, truncated);
      assert.ok(result.images.includes('https://pbs.twimg.com/media/visible-0?format=jpg&name=orig'));
      assert.ok(result.images.includes('https://pbs.twimg.com/media/visible-1?format=jpg&name=orig'));
      assert.equal(result.images.some(image => image.includes('profile_images')), false);
    }
  } finally {
    await cdp?.detach();

  }
});

test('一覧で縮小表示された写真も保存用取得では元の画素数を保持する', {timeout: 30000}, async (t) => {
  const temporary = await temporaryDirectory(t, join(tmpdir(), 'harvest-x-original-'));
  let context, cdp;
  try {
    const context = await launchExtensionContext(t, join(temporary, 'profile'), {args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run', '--no-default-browser-check']});
    cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? 'dist/extension')});
    const page = await context.newPage();
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 832; canvas.height = 1216;
      const original = canvas.toDataURL('image/png').split(',')[1];
      canvas.width = 208; canvas.height = 304;
      return {original, small: canvas.toDataURL('image/png').split(',')[1]};
    });
    const requests = [];
    await context.route('https://pbs.twimg.com/media/photo**', route => {
      const size = new URL(route.request().url()).searchParams.get('name');
      requests.push(size);
      return route.fulfill({contentType: 'image/png', body: Buffer.from(size === 'orig' ? png.original : png.small, 'base64')});
    });
    await context.route('https://x.com/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Bookmarks</title><article data-testid="tweet"><a href="/example/status/123"><time>Today</time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/photo?format=png&amp;name=small"></div></article>'}));
    const url = 'https://x.com/i/history';
    await page.goto(url);
    assert.deepEqual(await page.locator('img').evaluate(img => [img.naturalWidth, img.naturalHeight]), [208, 304]);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/app/index.html`);
    const result = await panel.evaluate(async url => {
      const {scanTab} = await import(chrome.runtime.getURL('app/browser/page-access.js'));
      const {fetchImage} = await import(chrome.runtime.getURL('app/media/image-fetch.js'));
      const {getImageDimensions} = await import(chrome.runtime.getURL('core/image-dimensions.js'));
      const [tab] = await chrome.tabs.query({url});
      const scan = await scanTab(tab.id, undefined, url);
      const fetched = await fetchImage(scan.images[0], {sourcePage: url});
      const dimensions = getImageDimensions(new Uint8Array(await fetched.blob.arrayBuffer()));
      return {images: scan.images, dimensions};
    }, url);
    assert.deepEqual(result.images, ['https://pbs.twimg.com/media/photo?format=png&name=orig']);
    assert.deepEqual(result.dimensions, {width: 832, height: 1216});
    assert.ok(requests.includes('orig'));
  } finally {
    await cdp?.detach();

  }
});
