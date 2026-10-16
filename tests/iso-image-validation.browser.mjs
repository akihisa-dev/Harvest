import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {staticAvif, animatedAvif} from './iso-image-fixtures.mjs';

test('ISO画像原本の実Worker検査は中止でき、次の正常原本を検査できる', async t => {
  const {page} = await animationPanel(t, new Map());
  const result = await page.evaluate(async fixtures => {
    const {validateIsoImage} = await import(chrome.runtime.getURL('app/media/iso-image-validation.js'));
    let created = 0, terminated = 0;
    const Original = Worker;
    window.Worker = class extends Original { constructor(...args) {super(...args); created++;} terminate() {terminated++; super.terminate();} };
    const bytes = new Uint8Array(8 * 1_000_000);
    for (let at = 0; at < bytes.length; at += 8) bytes.set([0,0,0,8,102,114,101,101], at);
    const controller = new AbortController();
    const work = validateIsoImage(bytes, controller.signal);
    let ticked = false;
    setTimeout(() => {ticked = true; controller.abort();}, 0);
    let aborted;
    try { await work; } catch (error) {aborted = error.name;}
    const valid = [];
    for (const fixture of fixtures) valid.push(await validateIsoImage(new Uint8Array(fixture)));
    return {ticked, aborted, valid, created, terminated, detached: bytes.byteLength === 0};
  }, [[...staticAvif], [...animatedAvif]]);
  assert.deepEqual(result, {ticked: true, aborted: 'AbortError', valid: [true, true], created: 3, terminated: 3, detached: true});
});
