import {launchBrowser} from "./support/browser.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('条件付き領域は途中の高さを持ち、逆操作と動きを減らす設定に追従する', async (t) => {
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  const css = await readFile(new URL('../app/style.css', import.meta.url), 'utf8');
  await page.setContent(`<style>${css}</style><div style="padding:20px"><section id="failures"><h3>失敗</h3><ul><li>画像を取得できません</li></ul></section><button id="after">後続</button><div id="url-drop-overlay" hidden>URL</div></div>`);
  await page.locator("#failures").evaluate(async e => {
    getComputedStyle(e).height;
    await Promise.all(e.getAnimations().map(a => a.finished));
  });
  const full = await page.locator('#failures').evaluate(e => e.getBoundingClientRect().height);
  await page.locator('#failures').evaluate(async e => {
    e.hidden = true;
    getComputedStyle(e).opacity;
    for (const a of e.getAnimations()) {
      a.pause();
      a.currentTime = 50;
    }
  });
  const middle = await page.locator('#failures').evaluate(e => ({height: e.getBoundingClientRect().height, opacity: Number(getComputedStyle(e).opacity), hidden: e.hidden}));
  assert.ok(middle.height > 0 && middle.height < full, JSON.stringify({middle, full}));
  assert.ok(middle.opacity > 0 && middle.opacity < 1);
  assert.equal(middle.hidden, true);
  await page.locator('#failures').evaluate(e => {
    e.hidden = false;
    e.getAnimations().forEach(a => a.play());
  });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#failures').evaluate(e => e.getBoundingClientRect().height), full);
  await page.locator('#url-drop-overlay').evaluate(async e => {
    e.hidden = false;
    getComputedStyle(e).opacity;
    for (const a of e.getAnimations()) {
      a.pause();
      a.currentTime = 40;
    }
  });
  assert.ok(await page.locator('#url-drop-overlay').evaluate(e => Number(getComputedStyle(e).opacity) < 1));
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.locator('#failures').evaluate(e => { e.hidden = true; });
  assert.equal(await page.locator('#failures').evaluate(e => e.getBoundingClientRect().height), 0);
  await page.locator('#url-drop-overlay').evaluate(e => { e.hidden = true; });
  assert.equal(await page.locator('#url-drop-overlay').evaluate(e => getComputedStyle(e).display), 'none');
});
