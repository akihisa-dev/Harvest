import {startServer, launchBrowser} from "./support/browser.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve, sep} from 'node:path';

test('ボタンのラベルと処理中表示、チェックと中間状態は同じ要素で遷移する', async (t) => {
  const base = resolve('dist/extension');
  const css = await readFile(new URL('../app/style.css', import.meta.url), 'utf8');
  const server = await startServer(t, async (req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(`<style>${css}</style><button id="scan">解析</button><button id="export">保存</button><input type="checkbox" id="check">`);
      return;
    }
    try {
      const path = resolve(base, '.' + req.url);
      if (!path.startsWith(base + sep)) throw Error();
      res.setHeader('content-type', 'text/javascript');
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });

  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const {setButtonLabel} = await import('/app/panel/button-state.js');
    window.setButtonLabel = setButtonLabel;
    setButtonLabel(document.querySelector('#scan'), '解析');
    setButtonLabel(document.querySelector('#export'), '保存');
    window.label = document.querySelector('#scan .button-label');
  });
  await page.waitForTimeout(220);
  await page.locator('#scan').evaluate(e => {
    e.dataset.scanning = 'true';
    e.setAttribute('aria-label', '停止');
    window.setButtonLabel(e, '停止');
    getComputedStyle(e).opacity;
    e.getAnimations({subtree: true}).forEach(a => {
      a.pause();
      a.currentTime = 50;
    });
  });
  const state = await page.evaluate(() => ({
    same: window.label === document.querySelector('#scan .button-label'),
    text: document.querySelector('#scan').textContent,
    label: Number(getComputedStyle(window.label).opacity),
    spinner: getComputedStyle(document.querySelector('#scan'), '::before').content
  }));
  assert.equal(state.same, true);
  assert.equal(state.text, '停止');
  assert.ok(state.label > 0 && state.label < 1);
  assert.equal(state.spinner, 'none', '停止ラベルを読み込みリングで隠さない');
  await page.locator('#export').evaluate(e => {
    window.setButtonLabel(e, '再試行');
    e.getAnimations({subtree: true}).forEach(a => {
      a.pause();
      a.currentTime = 50;
    });
  });
  const mid = await page.locator('#export .button-label').evaluate(e => Number(getComputedStyle(e).opacity));
  assert.ok(mid > 0 && mid < 1);
  const connected = await page.locator('#export').evaluate(e => {
    window.setButtonLabel(e, '保存完了');
    return e.textContent;
  });
  assert.equal(connected, '保存完了');
  for (const time of [0, 5, 20, 50]) {
    const interrupted = await page.evaluate(time => {
      const button = document.createElement('button');
      document.body.append(button);
      window.setButtonLabel(button, 'A');
      window.setButtonLabel(button, 'B');
      const animations = button.getAnimations({subtree: true});
      animations.forEach(animation => {
        animation.pause();
        animation.currentTime = time;
      });
      const previous = button.querySelector('.button-label-previous'), current = button.querySelector('.button-label');
      const before = [Number(getComputedStyle(previous).opacity), Number(getComputedStyle(current).opacity)];
      for (const text of ['C', 'D', 'E']) window.setButtonLabel(button, text);
      const after = [Number(getComputedStyle(previous).opacity), Number(getComputedStyle(current).opacity)];
      const result = {
        before,
        after,
        outgoing: previous.dataset.label,
        current: button.textContent,
        layers: button.children.length,
        animations: button.getAnimations({subtree: true}).length
      };
      animations.forEach(animation => animation.finish());
      window.lastInterrupted = button;
      return result;
    }, time);
    assert.deepEqual(interrupted.before, interrupted.after);
    assert.equal(interrupted.outgoing, 'A');
    assert.equal(interrupted.current, 'E');
    assert.equal(interrupted.layers, 2);
    assert.equal(interrupted.animations, 2);
    const completed = await page.evaluate(() => {
      const button = window.lastInterrupted, current = button.querySelector('.button-label');
      const result = {
        text: button.textContent,
        opacity: getComputedStyle(current).opacity,
        old: button.querySelector('.button-label-previous').dataset.label
      };
      button.remove();
      return result;
    });
    assert.deepEqual(completed, {text: 'E', opacity: '1', old: undefined});
  }
  await page.locator('#check').evaluate(e => { e.checked = true; });
  await page.waitForTimeout(260);
  await page.locator('#check').evaluate(e => {
    e.indeterminate = true;
    getComputedStyle(e, '::before').opacity;
    getComputedStyle(e, '::after').opacity;
    e.getAnimations({subtree: true}).forEach(a => {
      a.pause();
      a.currentTime = 50;
    });
  });
  const marks = await page.locator('#check').evaluate(e => [Number(getComputedStyle(e, '::before').opacity), Number(getComputedStyle(e, '::after').opacity)]);
  assert.ok(marks.every(x => x > 0 && x < 1), JSON.stringify({
    marks,
    animations: await page.locator('#check').evaluate(e => e.getAnimations({subtree: true}).map(a => ({time: a.currentTime, state: a.playState, frames: a.effect.getKeyframes()})))
  }));
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.locator('#export').evaluate(e => window.setButtonLabel(e, '保存'));
  assert.equal(await page.locator('#export .button-label').evaluate(e => e.getAnimations().length), 0);
});
