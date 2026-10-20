import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {redPng, bluePng} from './animation-fixtures.mjs';

for (const kind of ['jxl', 'zip']) test(`実Chromeの${kind}無応答は期限で保存中を解除し再保存できる`, {timeout: 60000}, async t => {
  const fixture = await animationPanel(t, new Map([['/a.png', [redPng, 'image/png']], ['/b.png', [bluePng, 'image/png']]]));
  const {page} = fixture;
  await fixture.scan(kind === 'zip' ? ['/a.png', '/b.png'] : ['/a.png']);
  await page.evaluate(kind => {
    const NativeWorker = window.Worker, nativeSet = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
    window.holdWorker = true; window.observedWorkers = []; window.deadlineTimers = new Set(); window.deadlines = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {super(url, options); this.target = String(url).includes(kind === 'jxl' ? 'jxl-encode-worker' : 'stored-zip-crc-worker'); if (this.target) window.observedWorkers.push(this);}
      postMessage(...args) {if (this.target && window.holdWorker) return; return super.postMessage(...args);}
      terminate() {this.terminated = (this.terminated ?? 0) + 1; super.terminate();}
    };
    window.setTimeout = (fn, ms, ...args) => {
      if (ms < 120000) return nativeSet(fn, ms, ...args);
      window.deadlines.push(ms);
      const id = nativeSet(() => {window.deadlineTimers.delete(id); fn(...args);}, window.holdWorker ? 200 : ms);
      window.deadlineTimers.add(id); return id;
    };
    window.clearTimeout = id => {window.deadlineTimers.delete(id); nativeClear(id);};
  }, kind);
  await page.locator(`#export-format-${kind === 'jxl' ? 'jxl' : 'original'}`).check();
  await page.locator('#export').click();
  await page.waitForFunction(() => window.observedWorkers.length && document.querySelector('#export').dataset.saving === 'false');
  assert.equal(await fixture.count(), 0);
  assert.equal(await page.locator('#status').getAttribute('data-state'), 'error');
  assert.equal(await page.locator('#scan').isEnabled(), true);
  assert.deepEqual(await page.evaluate(() => ({timers: window.deadlineTimers.size, terminated: window.observedWorkers[0].terminated})), {timers: 0, terminated: 1});
  assert.ok(await page.evaluate(() => window.deadlines.includes(121000)));
  await page.evaluate(() => {
    window.holdWorker = false;
    // A response arriving from the terminated generation cannot finish the next save.
    window.observedWorkers[0].dispatchEvent(new MessageEvent('message', {data: {id: 1, buffer: new ArrayBuffer(1), checksum: 0}}));
  });
  const saved = await fixture.saved(kind === 'jxl' ? 'jxl' : 'original');
  assert.ok(saved.bytes.length > 0);
  assert.equal(await page.evaluate(() => window.deadlineTimers.size), 0);
  if (kind === 'zip') assert.equal(saved.bytes.readUInt32LE(0), 0x04034b50);
  else assert.ok(saved.filename.endsWith('.jxl'));
});

test('実Chromeの16 MiB画素のJXL変換は容量別期限内に正常完了する', {timeout: 90000}, async t => {
  const {serveExtension} = await import('./support/extension-files.mjs');
  const {launchBrowser} = await import('./support/browser.mjs');
  const {url} = await serveExtension(t), browser = await launchBrowser(t), page = await browser.newPage();
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const {encodeJxl} = await import('/app/media/jxl-encoder.js');
    const image = new ImageData(2048, 2048);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = (i / 4) % 256; image.data[i + 1] = Math.floor(i / 8192) % 256;
      image.data[i + 2] = 64; image.data[i + 3] = 255;
    }
    const started = performance.now(), output = await encodeJxl(image);
    return {bytes: output.byteLength, signature: [...new Uint8Array(output, 0, 2)], elapsed: performance.now() - started};
  });
  assert.ok(result.bytes > 0); assert.deepEqual(result.signature, [0xff, 0x0a]);
  t.diagnostic(`16 MiB JXL: ${Math.round(result.elapsed)} ms`);
});
