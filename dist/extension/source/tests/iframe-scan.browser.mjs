import {temporaryDirectory, launchExtensionContext} from './support/browser.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {resourcesFor} from './support/resources.mjs';
import {pngBytes as png} from './original-fixtures.mjs';

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

test('継承about文書は検証済みの親を出典に使い、sandboxと別originへ認証を広げない', {timeout: 30000}, async t => {
  const temporary = await temporaryDirectory(t, join(tmpdir(), 'harvest-inherited-frames-'));
  const context = await launchExtensionContext(t, join(temporary, 'profile'));
  const cdp = await resourcesFor(t).acquire(() => context.browser().newBrowserCDPSession(), session => session.detach());
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
  await context.addCookies([{url: 'https://outer.test', name: 'session', value: 'synthetic', sameSite: 'None', secure: true}]);
  const srcdoc = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('.png')) return route.fulfill({status: route.request().headers().cookie?.includes('session=synthetic') ? 200 : 403,
      contentType: 'image/png', body: png});
    const image = name => `<img src="/${name}.png">`;
    let body;
    if (url.pathname === '/book') body = `<iframe srcdoc="${srcdoc(image('srcdoc'))}"></iframe>`
      + `<iframe id="blank"></iframe><iframe srcdoc="${srcdoc(`<iframe srcdoc="${srcdoc(image('nested'))}"></iframe>`)}"></iframe>`
      + `<iframe sandbox="allow-scripts" srcdoc="${srcdoc(image('opaque'))}"></iframe>`
      + '<iframe src="https://other.test/viewer"></iframe><iframe src="/csp"></iframe>';
    else if (url.pathname === '/viewer') body = `<iframe srcdoc="${srcdoc('<img src="https://outer.test/cross.png">')}"></iframe>`;
    else if (url.pathname === '/csp') return route.fulfill({contentType: 'text/html',
      headers: {'Content-Security-Policy': 'sandbox allow-scripts'},
      body: `<iframe srcdoc="${srcdoc(image('csp'))}"></iframe>`});
    else return route.abort();
    return route.fulfill({contentType: 'text/html', body: `<!doctype html><title>Fixture</title>${body}`});
  });
  const page = await context.newPage();
  await page.goto('https://outer.test/book');
  await page.evaluate(() => { document.querySelector('#blank').contentDocument.body.innerHTML = '<img src="https://outer.test/blank.png">'; });
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/app/index.html`);
  const result = await panel.evaluate(async () => {
    const {scanTab} = await import(chrome.runtime.getURL('app/browser/page-access.js'));
    const {collectPageMedia} = await import(chrome.runtime.getURL('core/page-media.js'));
    const {getImageFetchCredentials, validateImageFetchTarget} = await import(chrome.runtime.getURL('app/media/image-fetch-policy.js'));
    const {fetchOriginalMedia} = await import(chrome.runtime.getURL('app/media/media-fetch.js'));
    const {fetchImage} = await import(chrome.runtime.getURL('app/media/image-fetch.js'));
    const {decodeImage} = await import(chrome.runtime.getURL('app/media/image-decode.js'));
    const [tab] = await chrome.tabs.query({url: 'https://outer.test/book'});
    const scan = await scanTab(tab.id);
    const collected = collectPageMedia(scan, scan.frames);
    const sources = Object.fromEntries(collected.initial.sourcePages);
    const checks = [];
    for (const name of ['srcdoc', 'blank', 'nested']) {
      const url = `https://outer.test/${name}.png`, sourcePage = sources[url];
      const original = await fetchOriginalMedia(url, 'image', {sourcePage});
      const decoded = await decodeImage(await fetchImage(url, {sourcePage}), {});
      checks.push({name, sourcePage, size: original.size, width: decoded.width, height: decoded.height});
    }
    const denied = [];
    for (const name of ['opaque', 'cross', 'csp']) {
      const url = `https://outer.test/${name}.png`, sourcePage = sources[url];
      let failure = false;
      try { await fetchOriginalMedia(url, 'image', {sourcePage}); } catch { failure = true; }
      denied.push({name, credentials: getImageFetchCredentials(url, sourcePage), failure});
    }
    let localDenied = false;
    try { validateImageFetchTarget('http://127.0.0.1/private.png', sources['https://outer.test/srcdoc.png']); } catch { localDenied = true; }
    return {checks, denied, localDenied, frames: scan.frames};
  });
  for (const check of result.checks) {
    assert.equal(check.sourcePage, 'https://outer.test/book');
    assert.equal(check.size, png.length);
    assert.equal(check.width, 1);
    assert.equal(check.height, 1);
  }
  assert.deepEqual(result.denied, ['opaque', 'cross', 'csp'].map(name => ({name, credentials: 'omit', failure: true})));
  assert.ok(result.localDenied);
  assert.ok(result.frames.some(frame => frame.url === 'about:blank' && frame.sourcePage === 'https://outer.test/book'));
  assert.ok(result.frames.some(frame => frame.sourcePage === 'https://other.test/viewer'));
});

test('親DOMの読み取りが許可されても実オリジンの異なるabout文書へ出典を付けない', {timeout: 30000}, async t => {
  const temporary = await temporaryDirectory(t, join(tmpdir(), 'harvest-frame-origin-'));
  const context = await launchExtensionContext(t, join(temporary, 'profile'));
  const cdp = await resourcesFor(t).acquire(() => context.browser().newBrowserCDPSession(), session => session.detach());
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('.png')) return route.fulfill({contentType: 'image/png', body: png});
    const target = url.searchParams.get('target');
    const body = target ? `<iframe src="${target}/child"></iframe>`
      : '<script>document.domain="review.test"</script><iframe></iframe>';
    return route.fulfill({headers: {'Origin-Agent-Cluster': '?0'}, contentType: 'text/html', body: `<!doctype html>${body}`});
  });
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/app/index.html`);
  for (const target of ['https://b.review.test', 'https://a.review.test:8443']) {
    const page = await context.newPage();
    const url = `https://a.review.test/parent?target=${encodeURIComponent(target)}`;
    await page.goto(url);
    await page.evaluate(() => { frames[0].frames[0].location = 'about:blank'; });
    await page.waitForFunction(() => {
      try { return frames[0].frames[0].document.readyState === 'complete'; } catch { return false; }
    });
    await page.evaluate(target => {
      const doc = frames[0].frames[0].document;
      doc.body.innerHTML = `<img src="${target}/fixture.png">`;
      doc.domain = 'review.test';
    }, target);
    const result = await panel.evaluate(async ({url, target}) => {
      const {scanTab} = await import(chrome.runtime.getURL('app/browser/page-access.js'));
      const {collectPageMedia} = await import(chrome.runtime.getURL('core/page-media.js'));
      const {getImageFetchCredentials} = await import(chrome.runtime.getURL('app/media/image-fetch-policy.js'));
      const [tab] = await chrome.tabs.query({url});
      const details = await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, func: () => {
        if (location.href !== 'about:blank') return null;
        return {origin: window.origin, parentUrl: parent.document.location.href};
      }});
      const scan = await scanTab(tab.id);
      const collected = collectPageMedia(scan, scan.frames);
      const sourcePage = collected.initial.sourcePages.get(`${target}/fixture.png`);
      return {details: details.map(entry => entry.result).filter(Boolean), sourcePage,
        credentials: getImageFetchCredentials(`${target}/fixture.png`, sourcePage)};
    }, {url, target});
    assert.equal(result.details.length, 1);
    assert.equal(result.details[0].origin, 'https://a.review.test');
    assert.equal(new URL(result.details[0].parentUrl).origin, target);
    assert.equal(result.sourcePage, 'about:blank');
    assert.equal(result.credentials, 'omit');
    await page.close();
  }
});
