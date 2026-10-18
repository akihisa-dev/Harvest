import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {redPng} from './animation-fixtures.mjs';
import {mp4Bytes} from './media-fixtures.mjs';

for (const setting of ['image','video','source']) test(`準備失敗後の${setting}設定変更で旧再試行案内を消し新設定で保存する`, {timeout:60000}, async t => {
  const assets = new Map([['/photo.png',[Buffer.from('broken'), 'image/png']],['/movie.mp4',[mp4Bytes,'video/mp4']]]);
  const {page,scan,failed,saved} = await animationPanel(t,assets);
  await scan([...assets.keys()], `settings-${setting}`);
  const initial = setting === 'image' ? 'png' : 'pdf';
  await page.locator(`#export-format-${initial}`).check();
  await page.locator('#video-export-format-original').check();
  await failed();
  assert.equal(await page.locator('#status').getAttribute('data-state'),'error');
  assert.match(await page.locator('#status').innerText(),/再試行/);
  assets.set('/photo.png',[redPng,'image/png']);
  if (setting === 'image') await page.locator('#export-format-jpg').check();
  if (setting === 'video') await page.locator('#video-export-format-mp4').check();
  if (setting === 'source') await page.locator('#include-source-page').setChecked(!await page.locator('#include-source-page').isChecked());
  assert.equal(await page.locator('#status').getAttribute('data-state'),'info');
  assert.equal(await page.locator('#status').innerText(),'保存設定が変わりました。もう一度保存してください。');
  assert.equal(await page.locator('#failures').isVisible(),false);
  assert.doesNotMatch(await page.locator('#export').innerText(),/再試行/);
  const result = await saved(setting === 'image' ? 'jpg' : 'pdf');
  assert.match(result.filename,/\.zip$/);
  assert.ok(result.bytes.length > 0);
});
