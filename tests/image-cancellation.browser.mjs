import assert from 'node:assert/strict';
import test from 'node:test';
import {serveExtension} from './support/extension-files.mjs';
import {launchBrowser} from './support/browser.mjs';

for (const format of ['jpg', 'png']) for (const phase of ['decode', 'encode']) test(`実Chromeで${format}の${phase}返答前に中止し再変換できる`, async t => {
  const {url} = await serveExtension(t), browser = await launchBrowser(t), page = await browser.newPage();
  await page.goto(url);
  const result = await page.evaluate(async ({format, phase}) => {
    const {convertImage} = await import('/app/media/image-format.js');
    const canvas = new OffscreenCanvas(2, 2);
    canvas.getContext('2d').fillRect(0, 0, 2, 2);
    const blob = await canvas.convertToBlob({type: 'image/webp'}), fetched = {kind: 'bitmap', blob, dimensions: null};
    const nativeDecode = window.createImageBitmap, nativeEncode = HTMLCanvasElement.prototype.toBlob, nativeCreate = document.createElement.bind(document);
    let release, closed = 0, allocated;
    window.createImageBitmap = async (...args) => {
      const bitmap = await nativeDecode(...args), close = bitmap.close.bind(bitmap);
      bitmap.close = () => {closed++; close();};
      return phase === 'decode' ? new Promise(resolve => {release = () => resolve(bitmap);}) : bitmap;
    };
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      const callback = args[0];
      return nativeEncode.call(this, value => {release = () => callback(value);}, ...args.slice(1));
    };
    document.createElement = (...args) => {
      const element = nativeCreate(...args); if (args[0] === 'canvas') allocated = element; return element;
    };
    try {
      const controller = new AbortController();
      const work = convertImage(fetched, format, controller.signal).then(() => 'resolved', error => error.kind);
      while (!release) await new Promise(resolve => setTimeout(resolve, 0));
      controller.abort();
      const outcome = await work;
      const beforeRelease = {closed, canvas: allocated ? [allocated.width, allocated.height] : null};
      release(); await new Promise(resolve => setTimeout(resolve, 0));
      const afterRelease = closed;
      window.createImageBitmap = nativeDecode; HTMLCanvasElement.prototype.toBlob = nativeEncode; document.createElement = nativeCreate;
      const retry = await convertImage(fetched, format);
      return {outcome, beforeRelease, afterRelease, type: retry.type, bytes: retry.size};
    } finally {
      window.createImageBitmap = nativeDecode; HTMLCanvasElement.prototype.toBlob = nativeEncode; document.createElement = nativeCreate;
    }
  }, {format, phase});
  assert.equal(result.outcome, 'cancelled');
  assert.equal(result.beforeRelease.closed, phase === 'decode' ? 0 : 1);
  assert.deepEqual(result.beforeRelease.canvas, phase === 'decode' ? null : [0, 0]);
  assert.equal(result.afterRelease, 1);
  assert.equal(result.type, format === 'jpg' ? 'image/jpeg' : 'image/png'); assert.ok(result.bytes > 0);
});
