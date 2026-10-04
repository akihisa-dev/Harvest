import {launchBrowser} from './support/browser.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {gifBytes} from './media-fixtures.mjs';

test('imgの非同期currentSrc切替を反映し、共有URLと最大srcset候補を保持する', async (t) => {
  const source = await readFile(new URL('../dist/extension/app/content/page-scan.js', import.meta.url), 'utf8');
  const browser = await launchBrowser(t);
  t.diagnostic(`Browser: ${browser.version()}`);
  const page = await browser.newPage({deviceScaleFactor: 1});
  await page.route('https://scan.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('.gif')) {
      if (path.includes('new-')) await new Promise(resolve => setTimeout(resolve, 100));
      return route.fulfill({contentType: 'image/gif', body: gifBytes, headers: {'cache-control': 'no-store'}});
    }
    return route.fulfill({contentType: 'text/html', body: '<html><body><main></main></body></html>'});
  });
  for (const mode of ['img-src', 'img-srcset', 'picture-replace', 'picture-remove', 'picture-media', 'picture-replace-shared', 'static-max', 'static-picture-max']) {
    for (const phase of mode.startsWith('static') ? ['static'] : ['initial-scan', 'quiet-window']) {
      await page.goto(`https://scan.test/${mode}/${phase}`);
      const observed = await page.evaluate(async ({source, mode, phase}) => {
        const moduleUrl = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
        const {scanDocument} = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        const main = document.querySelector('main');
        const image = document.createElement('img');
        const picture = document.createElement('picture');
        const oldSource = document.createElement('source');
        const base = location.origin;
        const url = name => `${base}/${name}.gif`;
        const oldUrl = url('old-small');
        const newUrl = url('new-small');
        const set = prefix => `${url(prefix + '-small')} 1x, ${url(prefix + '-large')} 2x`;
        const pictureMode = mode.startsWith('picture') || mode === 'static-picture-max';
        image.src = pictureMode ? url('fallback') : oldUrl;
        if (mode === 'img-srcset' || mode === 'static-max') image.srcset = set('old');
        if (pictureMode) {
          oldSource.srcset = set('old');
          oldSource.media = '(min-width: 1px)';
          if (mode === 'picture-remove' || mode === 'picture-media') image.srcset = set('new');
          picture.append(oldSource, image);
          main.append(picture);
        } else main.append(image);
        await image.decode();
        if (mode.endsWith('shared')) {
          const shared = document.createElement('img');
          shared.src = oldUrl;
          main.append(shared);
          await shared.decode();
        }
        // Force yielding during initial traversal so a queued attribute mutation
        // can be flushed before the delayed image response completes.
        if (phase === 'initial-scan') main.append(...Array.from({length: 1000}, () => document.createElement('div')));
        const initial = image.currentSrc;
        const started = performance.now();
        const loads = [];
        image.addEventListener('load', () => loads.push({ms: performance.now() - started, currentSrc: image.currentSrc}));
        const mutations = [];
        const observer = new MutationObserver(records => mutations.push({ms: performance.now() - started, currentSrc: image.currentSrc, records: records.map(r => ({type: r.type, tag: r.target.nodeName, attribute: r.attributeName}))}));
        observer.observe(main, {subtree: true, attributes: true, childList: true});
        const scan = scanDocument();
        let afterChange = initial;
        let changedAt;
        if (phase !== 'static') setTimeout(() => {
          changedAt = performance.now() - started;
          if (mode === 'img-src') image.src = newUrl;
          else if (mode === 'img-srcset') { image.src = url('fallback'); image.srcset = set('new'); }
          else if (mode === 'picture-remove') oldSource.remove();
          else if (mode === 'picture-media') oldSource.media = '(max-width: 0px)';
          else {
            const next = document.createElement('source');
            next.srcset = set('new');
            oldSource.replaceWith(next);
          }
          afterChange = image.currentSrc;
        }, phase === 'initial-scan' ? 0 : 40);
        const result = await scan;
        const endedAt = performance.now() - started;
        const atScan = image.currentSrc;
        observer.disconnect();
        await image.decode();
        const final = image.currentSrc;
        const attributes = [...main.querySelectorAll('*')].filter(e => e.attributes.length).map(e => ({tag: e.tagName, attributes: [...e.attributes].map(a => [a.name, a.value])}));
        const otherCurrent = [...main.querySelectorAll('img')].filter(e => e !== image).map(e => e.currentSrc);
        const expected = new Set([phase === 'static' ? oldUrl : newUrl]);
        if (mode === 'img-srcset') { expected.add(url('fallback')); expected.add(url('new-large')); }
        if (mode === 'static-max') expected.add(url('old-large'));
        if (pictureMode) { expected.add(url('fallback')); expected.add(url(phase === 'static' ? 'old-large' : 'new-large')); }
        if (mode === 'picture-media') expected.add(url('old-large'));
        if (mode.endsWith('shared')) expected.add(oldUrl);
        // Only largest srcset entries are independent candidates under the existing
        // specification. A smaller inactive entry does not justify old currentSrc.
        const oldCandidateOwners = [...main.querySelectorAll('img, source')].filter(e =>
          ['src', 'data-src', 'data-original'].some(a => e.getAttribute(a) === oldUrl)
          || ['srcset', 'data-srcset'].some(a => {
            const entries = (e.getAttribute(a) ?? '').split(',').map(value => value.trim().split(/\s+/));
            const largest = entries.sort((a, b) => parseFloat(b[1] ?? '0') - parseFloat(a[1] ?? '0'))[0];
            return largest?.[0] === oldUrl;
          })).map(e => e.tagName);
        const images = result.images;
        const media = (result.media ?? []).map(item => item.url);
        return {initial, afterChange, atScan, final, changedAt, endedAt, loads, mutations, attributes, otherCurrent, oldCandidateOwners,
          images, media, expected: [...expected], stale: images.filter(u => !expected.has(u)), missing: [...expected].filter(u => !images.includes(u))};
      }, {source, mode, phase});
      t.diagnostic(JSON.stringify({mode, phase, ...observed}));
      assert.equal(observed.initial, 'https://scan.test/old-small.gif');
      assert.equal(observed.atScan, `https://scan.test/${phase === 'static' ? 'old' : 'new'}-small.gif`, 'real currentSrc must switch before scan completes');
      assert.equal(observed.final, observed.atScan, 'currentSrc remains the same after scan');
      assert.deepEqual([...observed.images].sort(), [...observed.media].sort(), 'both output views must agree');
      assert.deepEqual(observed.otherCurrent, mode.endsWith('shared') ? ['https://scan.test/old-small.gif'] : []);
      if (phase !== 'static') assert.ok(observed.loads.some(load => load.currentSrc === observed.atScan && load.ms <= observed.endedAt));
      assert.deepEqual([...observed.images].sort(), [...observed.expected].sort(), JSON.stringify({mode, phase, ...observed}));
      if (phase !== 'static') assert.deepEqual(observed.oldCandidateOwners, mode.endsWith('shared') ? ['IMG'] : [], 'old URL has no independent candidate evidence except in shared control');
      if (mode.endsWith('shared')) assert.ok(observed.images.includes('https://scan.test/old-small.gif'));
    }
  }
});
