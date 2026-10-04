import assert from "node:assert/strict";
import test from "node:test";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {animationPanel} from "./support/animation-panel.mjs";
import {redPng, animatedGif} from "./animation-fixtures.mjs";
import {mp4Bytes} from "./media-fixtures.mjs";

const sizes = [[320, 300], [320, 400], [400, 300], [400, 400], [700, 300], [768, 300], [360, 800]];

async function assertFixedOperations(page, label) {
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector(".workspace-sidebar");
    const bounds = sidebar.getBoundingClientRect();
    const controls = ["#export", "#viewer-toggle", ".results-heading", ".source-page-option", "#status"]
      .map(selector => ({selector, element: document.querySelector(selector)}))
      .filter(({element}) => element.getBoundingClientRect().height > 1)
      .map(({selector, element}) => ({selector, box: element.getBoundingClientRect().toJSON()}));
    const groups = document.querySelector(".group-bar");
    return {bounds: bounds.toJSON(), controls, scrollTop: sidebar.scrollTop,
      scrollHeight: sidebar.scrollHeight, clientHeight: sidebar.clientHeight,
      groupHeight: groups.clientHeight, controlHeight: document.querySelector(".group-check").clientHeight};
  });
  assert.equal(layout.scrollTop, 0, `${label}: sidebar remains fixed`);
  assert.ok(layout.scrollHeight <= layout.clientHeight + 1, `${label}: fixed panel does not overflow`);
  for (const {selector, box} of layout.controls) {
    assert.ok(box.y >= layout.bounds.y && box.bottom <= layout.bounds.bottom + 1,
      `${label}: ${selector} stays within the fixed panel`);
  }
  assert.ok(layout.groupHeight >= layout.controlHeight, `${label}: a complete group control stays reachable (${JSON.stringify(layout)})`);
  const hint = page.locator("#export-media-hint");
  assert.equal(await hint.getAttribute("title"), await hint.textContent(), `${label}: compact hint retains its full text`);
}

for (const locale of ["ja-JP", "en-US"]) {
  test(`short mixed-media panel keeps save, stop, retry and status operable (${locale})`, {timeout: 180000}, async t => {
    const assets = new Map([
      ["/red.png", [redPng, "image/png"]],
      ["/wrong.gif", [redPng, "image/png"]],
      ["/movie.mp4", [mp4Bytes, "video/mp4"]],
    ]);
    const {page, scan, failed, saved, count} = await animationPanel(t, assets, {
      locale, responseDelayMs: (_request, path) => path === "/red.png" ? 200 : 0,
    });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({colorScheme});
      for (const [width, height] of sizes) {
        const label = `${locale} ${colorScheme} ${width}x${height}`;
        await page.setViewportSize({width, height});
        assets.set("/wrong.gif", [redPng, "image/png"]);
        await scan(["/red.png", "/wrong.gif", "/movie.mp4"], "short export");
        await page.locator("#export-format-pdf").check();
        await page.locator("#video-export-format-mp4").check();
        await page.locator("#include-source-page").check();
        await assertFixedOperations(page, `${label} ready`);
        const before = await count();
        await page.locator("#export").click();
        await page.waitForFunction(() => document.querySelector("#export").dataset.saving === "true");
        await assertFixedOperations(page, `${label} preparing`);
        await page.locator("#export").click();
        await page.waitForFunction(() => document.querySelector("#export").dataset.saving === "false");
        assert.equal(await count(), before, `${label}: cancel does not save incomplete output`);
        await assertFixedOperations(page, `${label} canceled`);
        await failed();
        await assertFixedOperations(page, `${label} retry offered`);
        assert.ok(await page.locator("#export").isEnabled(), `${label}: retry is operable`);
        assets.set("/wrong.gif", [animatedGif, "image/gif"]);
        const result = await saved("pdf");
        assert.ok(result.bytes.length >= 4, `${label}: retry produces a saved file`);
        assert.equal(result.bytes.readUInt32LE(0), 0x04034b50, `${label}: mixed retry output is a ZIP`);
        assert.equal(await count(), before + 1, `${label}: retry saves once`);
        await assertFixedOperations(page, `${label} saved`);
        if (width === 320 && height === 300) {
          await page.screenshot({path: join(tmpdir(), `harvest-124-export-${locale}-${colorScheme}.png`)});
        }
      }
    }
  });
}
