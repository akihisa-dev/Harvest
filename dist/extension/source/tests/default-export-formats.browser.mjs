import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {redPng} from './animation-fixtures.mjs';
import {mp4Bytes} from './media-fixtures.mjs';

const formatKeys = ['harvest.exportFormat', 'harvest.imageExportFormat', 'harvest.videoExportFormat'];

async function storedFormats(page) {
 return page.evaluate(keys => keys.map(key => localStorage.getItem(key)), formatKeys);
}

async function expectFormats(page, imageFormat, videoFormat) {
 assert.equal(await page.locator(`#export-format-${imageFormat}`).isChecked(), true);
 assert.equal(await page.locator(`#video-export-format-${videoFormat}`).isChecked(), true);
}

test('毎回推奨で開き、同じパネルの選択は再解析後も維持し、出典設定だけを保存する', {timeout: 60000}, async t => {
 const {page, scan} = await animationPanel(t, new Map([
  ['/red.png', [redPng, 'image/png']], ['/movie.mp4', [mp4Bytes, 'video/mp4']],
 ]));
 const paths = ['/red.png', '/movie.mp4'];
 await expectFormats(page, 'recommend', 'recommend');
 assert.deepEqual(await storedFormats(page), [null, null, null], '初回起動で保存形式のキーを作らない');

 const previousFormats = ['jpg', 'original', 'original'];
 await page.evaluate(({keys, values}) => {
  keys.forEach((key, index) => localStorage.setItem(key, values[index]));
  localStorage.setItem('harvest.includeSourcePage', 'true');
 }, {keys: formatKeys, values: previousFormats});
 await page.reload();
 await expectFormats(page, 'recommend', 'recommend');
 assert.deepEqual(await storedFormats(page), previousFormats, '保存済み形式を移行・削除・上書きしない');
 assert.equal(await page.locator('#include-source-page').isChecked(), true);

 await scan(paths, 'preferences');
 await page.locator('#export-format-pdf').check();
 await page.locator('#video-export-format-mp4').check();
 await page.locator('#include-source-page').uncheck();
 await expectFormats(page, 'pdf', 'mp4');
 assert.equal(await page.evaluate(() => localStorage.getItem('harvest.includeSourcePage')), 'false');
 assert.deepEqual(await storedFormats(page), previousFormats, '形式の操作で前回の保存値を更新しない');

 await scan(paths, 'preferences-rescan');
 await expectFormats(page, 'pdf', 'mp4');
 assert.equal(await page.locator('#include-source-page').isChecked(), false);
 await page.reload();
 await expectFormats(page, 'recommend', 'recommend');
 assert.equal(await page.locator('#include-source-page').isChecked(), false, '出典設定は再読込後も復元する');

 await scan(paths, 'preferences-new-panel');
 await page.locator('#export-format-pdf').check();
 await page.locator('#video-export-format-original').check();
 await page.locator('#include-source-page').check();
 const newPanel = await page.context().newPage(), errors = [];
 newPanel.on('pageerror', error => errors.push(error.message));
 await newPanel.goto(page.url());
 await expectFormats(newPanel, 'recommend', 'recommend');
 assert.equal(await newPanel.locator('#include-source-page').isChecked(), true, '出典設定は新しいパネルでも復元する');
 assert.deepEqual(await storedFormats(newPanel), previousFormats);
 await expectFormats(page, 'pdf', 'original');
 assert.deepEqual(errors, []);
});
