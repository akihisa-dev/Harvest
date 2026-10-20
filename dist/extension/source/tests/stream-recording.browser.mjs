import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {streamSite} from './support/stream-site.mjs';
import {readCompletedDownload} from './support/animation-panel.mjs';

for (const [kind, current] of [['stream', false], ['library', false], ['library', true], ['embed', false], ['iframe', false]]) test(`実ページ読み取りとCookie認証から65 MiB録画の保存までを置換なしで検証: ${kind}, current=${current}`, {timeout: 60000}, async t => {
  const fixture = await streamSite(t), {panel, requests, recording} = fixture;
  const row = await fixture.scan(kind, current);
  if (!/meeting\.mp4|recording\.mp4/.test(row)) t.diagnostic(JSON.stringify({kind, row, status: await panel.locator('#status').innerText(), requests, networkErrors: fixture.networkErrors}));
  assert.match(row, /meeting\.mp4|recording\.mp4/, 'サムネイル画像だけでは成功にしない');
  assert.equal(await panel.locator('#images > li').count(), 1);
  await panel.locator('#video-export-format-mp4').check();
  await panel.locator('#export').click();
  await panel.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
  const item = await panel.evaluate(async () => (await chrome.downloads.search({id: window.downloadIds.at(-1)}))[0]);
  assert.equal(item.state, 'complete');assert.equal(item.fileSize, recording.length);
  const saved = await readCompletedDownload(item.filename);
  assert.equal(createHash('sha256').update(saved).digest('hex'), createHash('sha256').update(recording).digest('hex'));
  const played = await fixture.playSaved(item.filename);
  assert.equal(played.ended, true);assert.ok(played.duration > 0);assert.equal(played.currentTime, played.duration);
  const downloads = requests.filter(request => request.path.endsWith('/download.aspx'));
  assert.ok(downloads.some(request => request.method === 'HEAD'));
  assert.equal(downloads.filter(request => request.method === 'GET').length, 1);
  assert.ok(downloads.every(request => request.authenticated));
});

for (const permission of ['denied', 'expired']) test(`仮想Streamの${permission}は実通信で録画保存を拒否する`, {timeout: 60000}, async t => {
  const fixture = await streamSite(t), {panel, requests} = fixture;
  await fixture.scan('stream');
  assert.match(await panel.locator('#images').innerText(), /meeting\.mp4/);
  fixture.permission(permission);
  await panel.locator('#video-export-format-mp4').check();
  await panel.locator('#export').click();
  await panel.waitForFunction(() => document.querySelector('#export').dataset.saving === 'false' && !document.querySelector('#failures').hidden);
  assert.match(await panel.locator('#failures').innerText(), /ダウンロード権限|ログイン/);
  assert.equal(await panel.evaluate(() => window.downloadIds.length), 0);
  assert.equal(requests.filter(request => request.path.endsWith('/download.aspx') && request.method === 'GET').length, 0);
  assert.notEqual(await panel.locator('#status').getAttribute('data-state'), 'success');
});
