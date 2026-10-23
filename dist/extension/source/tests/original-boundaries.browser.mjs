import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {baselineJpeg} from './jpeg-fixtures.mjs';
import {pngBytes} from './original-fixtures.mjs';
import {staticWebp, animatedWebp} from './animation-fixtures.mjs';
import {staticAvif, animatedAvif} from './iso-image-fixtures.mjs';

test('実Chromeの単独おすすめ保存は不完全なJPEG・PNGを失敗にして正常原本だけ再試行する', {timeout: 60000}, async t => {
  const assets = new Map();
  const {page, scan, saved, failed} = await animationPanel(t, assets);
  for (const [path, bytes, type, cut] of [['/photo.jpg', baselineJpeg, 'image/jpeg', 3], ['/photo.png', pngBytes, 'image/png', 8]]) {
    assets.set(path, [bytes.subarray(0, cut), type]);
    await scan([path]);
    await page.locator('#export-format-recommend').check();
    assert.match(await failed(), /不完全|破損/);
    assets.set(path, [bytes, type]);
    assert.deepEqual([...((await saved('recommend')).bytes)], [...bytes]);
  }
});

test('実Chromeの原本・推奨保存は不完全なWebP・AVIFを失敗にして静止・動画像の原本を再試行する', {timeout: 60000}, async t => {
  const assets = new Map();
  const {page, scan, saved, failed} = await animationPanel(t, assets);
  for (const [path, variants, type, cut] of [['/photo.webp', [staticWebp, animatedWebp], 'image/webp', 12], ['/photo.avif', [staticAvif, animatedAvif], 'image/avif', 16]]) {
    for (const format of ['original', 'recommend']) {
      for (const bytes of variants) {
        const header = Buffer.from(bytes.subarray(0, cut));
        if (type === 'image/avif') header.writeUInt32BE(cut, 0);
        assets.set(path, [header, type]);
        await scan([path]);
        await page.locator(`#export-format-${format}`).check();
        assert.match(await failed(), /不完全|破損/);
        assets.set(path, [bytes, type]);
        assert.deepEqual([...((await saved(format)).bytes)], [...bytes]);
      }
    }
  }
});

test('WebP必須ヘッダー欠落を単独・混在保存で拒否し、正常分を保持して失敗分だけ再試行する', {timeout:60_000}, async t => {
  const {animatedGif} = await import('./animation-fixtures.mjs');
  const truncated = Buffer.alloc(22);
  truncated.write('RIFF');truncated.writeUInt32LE(14,4);truncated.write('WEBPVP8L',8);truncated.writeUInt32LE(1,16);truncated[20]=0x2f;
  const badFrame = Buffer.from(animatedWebp);
  badFrame[badFrame.indexOf('VP8L')+8]=0;
  const assets = new Map([['/good.gif',[animatedGif,'image/gif']]]);
  const {page,scan,saved,failed,requests} = await animationPanel(t,assets);
  for (const format of ['original','recommend']) {
    for (const [bad,good] of [[truncated,staticWebp],[badFrame,animatedWebp]]) {
      assets.set('/photo.webp',[bad,'image/webp']);
      await scan(['/photo.webp']);
      await page.locator(`#export-format-${format}`).check();
      assert.match(await failed(),/不完全|破損/);
      assets.set('/photo.webp',[good,'image/webp']);
      assert.deepEqual((await saved(format)).bytes,good);
    }
    assets.set('/photo.webp',[truncated,'image/webp']);
    await scan(['/good.gif','/photo.webp']);
    await page.locator(`#export-format-${format}`).check();
    assert.match(await failed(),/不完全|破損/);
    const before= requests().filter(path=>path==='/good.gif').length;
    assets.set('/photo.webp',[staticWebp,'image/webp']);
    const output = await saved(format);
    assert.match(output.filename,/\.zip$/);
    assert.ok(output.bytes.includes(animatedGif));assert.ok(output.bytes.includes(staticWebp));
    assert.equal(requests().filter(path=>path==='/good.gif').length,before,'successful item is not fetched again');
  }
});
