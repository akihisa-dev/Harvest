import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {startServer} from './support/browser.mjs';

test('JSONと通常scriptの画像順をカード・ビュアー・PDF・ZIPまで保持する', {timeout: 60000}, async t => {
  const assets = new Map(), names = ['zeta.png', 'alpha.png', 'middle.png'];
  const {page, saved} = await animationPanel(t, assets);
  await page.setViewportSize({width: 800, height: 1000});
  const encoded = await page.evaluate(() => [120, 160, 200].map((width, index) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 60;
    const context = canvas.getContext('2d'); context.fillStyle = ['red', 'green', 'blue'][index];
    context.fillRect(0, 0, width, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  names.forEach((name, index) => assets.set(`/${name}`, Buffer.from(encoded[index], 'base64')));
  let mode = 'text';
  const server = await startServer(t, (request, response) => {
    const origin = `http://${request.headers.host}`, path = new URL(request.url, origin).pathname;
    if (path === '/gallery') {
      const urls = names.map(name => `${origin}/${name}`);
      const content = mode === 'json'
        ? JSON.stringify({pages: [{image: urls[0]}, {nested: [urls[1], urls[2]]}], duplicate: urls[0]})
        : `const pages = ${JSON.stringify(urls)};`;
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      response.end(`<title>Script gallery</title><script type="${mode === 'json' ? 'application/json' : 'text/plain'}">${content}</script>`);
    } else {
      response.writeHead(assets.has(path) ? 200 : 404, {'content-type': 'image/png'});
      response.end(assets.get(path));
    }
  });
  const origin = `http://127.0.0.1:${server.address().port}`, urls = names.map(name => `${origin}/${name}`);
  await page.context().route(`${origin}/**`, route => route.continue());
  for (const value of ['text', 'json']) {
    mode = value;
    await page.locator('#source-drop').click(); await page.locator('#source-url').fill(`${origin}/gallery`);
    await page.locator('#scan').click();
    await page.waitForFunction(() => document.querySelector('#scan').dataset.scanning === 'false' && !document.querySelector('#scan').disabled);
    await page.locator('#all-selection').check();
    await page.locator('#export-format-pdf').check(); await page.locator('#include-source-page').uncheck();
    await page.waitForFunction(() => [...document.querySelectorAll('#images img')].length === 3
      && [...document.querySelectorAll('#images img')].every(image => image.complete && image.naturalWidth > 0));
    assert.deepEqual(await page.locator('#images img').evaluateAll(images => images.map(image => image.dataset.previewUrl)), urls, value);
    await page.locator('#viewer-toggle').click();
    for (const [index, url] of urls.entries()) {
      if (index) await page.locator('#viewer-next').click();
      await page.waitForFunction(url => document.querySelector('#viewer-image').dataset.previewUrl === url
        && document.querySelector('#viewer-image').naturalWidth > 0 && !document.querySelector('.viewer-motion-image'), url);
    }
    await page.locator('#viewer-toggle').click();
    const pdf = (await saved('pdf')).bytes.toString('latin1');
    const references = [...pdf.match(/\/Kids \[([^\]]+)\]/)[1].matchAll(/(\d+) 0 R/g)];
    assert.deepEqual(references.map(([, id]) => {
      const object = pdf.match(new RegExp(`(?:^|\n)${id} 0 obj\\n([\\s\\S]*?)endobj`))[1];
      return object.match(/\/MediaBox \[0 0 (\d+) (\d+)\]/).slice(1).map(Number);
    }), [[120, 60], [160, 60], [200, 60]], value);
    const zip = (await saved('original')).bytes, entries = [];
    for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
      const size = zip.readUInt32LE(at + 18), nameSize = zip.readUInt16LE(at + 26), extra = zip.readUInt16LE(at + 28);
      const start = at + 30 + nameSize + extra;
      entries.push({name: zip.toString('utf8', at + 30, at + 30 + nameSize), bytes: zip.subarray(start, start + size)});
      at = start + size;
    }
    assert.deepEqual(entries.map(entry => entry.name), ['001.png', '002.png', '003.png'], value);
    assert.deepEqual(entries.map(entry => entry.bytes), names.map(name => assets.get(`/${name}`)), value);
  }
});
