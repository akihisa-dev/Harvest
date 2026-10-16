import assert from "node:assert/strict";
import test from "node:test";
import {serveExtension} from "./support/extension-files.mjs";
import {launchBrowser} from "./support/browser.mjs";

test("拡大画像をキーボードで各端まで移動でき、入力と別操作のキーを奪わない", async t => {
  const {url} = await serveExtension(t), browser = await launchBrowser(t);
  const context = await browser.newContext({locale: "ja-JP", reducedMotion: "reduce"});
  await context.addInitScript(() => {
    window.chrome = {i18n: {getUILanguage: () => "ja"}, runtime: {onConnect: {addListener() {}}},
      tabs: {query: async () => [{id: 1, url: "https://reader.test/book"}], get: async () => ({id: 1, url: "https://reader.test/book"}), onRemoved: {addListener() {}, removeListener() {}}},
      scripting: {executeScript: async () => [{result: {url: "https://reader.test/book", title: "Book", images: ["https://images.test/pages/001.png", "https://images.test/pages/002.png"]}}]}};
  });
  const page = await context.newPage();
  await page.goto(url);
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 600;
    canvas.getContext("2d").fillRect(0, 0, 800, 600); return canvas.toDataURL().split(",")[1];
  }), "base64");
  await context.route("https://images.test/**", route => route.fulfill({contentType: "image/png", body: png, headers: {"access-control-allow-origin": "*"}}));
  await page.locator("#scan").focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#scan").dataset.scanning === "false");
  await page.locator("#viewer-toggle").focus(); await page.keyboard.press("Enter");
  const stage = page.locator("#viewer-stage"), image = page.locator("#viewer-image");
  await page.waitForFunction(() => document.querySelector("#viewer-image").naturalWidth === 800);
  assert.equal(await stage.getAttribute("tabindex"), "0");
  assert.match(await stage.getAttribute("aria-label"), /矢印キー.*Home/);
  const transform = () => image.evaluate(image => { const m = new DOMMatrix(getComputedStyle(image).transform); return {x: m.e, y: m.f, zoom: m.a}; });
  for (const width of [360, 800]) {
    await page.setViewportSize({width, height: 800});
    await page.locator("#viewer-zoom-in").focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("Enter");
    assert.equal((await transform()).zoom, 8);
    await stage.focus();
    assert.equal(await stage.evaluate(el => getComputedStyle(el).outlineStyle), "solid");
    for (const [key, axis, sign] of [["ArrowRight", "x", -1], ["ArrowLeft", "x", 1], ["ArrowDown", "y", -1], ["ArrowUp", "y", 1]]) {
      await page.keyboard.press("Home");
      for (let i = 0; i < 80; i++) await page.keyboard.press(key);
      const edge = await transform();
      assert.ok(edge[axis] * sign > 0, `${width}/${key}: 対応する端へ移動する`);
      for (let i = 0; i < 5; i++) await page.keyboard.press(key);
      assert.deepEqual(await transform(), edge, "端を越えて画像を見失わない");
      assert.equal(await stage.evaluate(el => el === document.activeElement), true);
    }
    await page.keyboard.press("Home");
    assert.deepEqual(await transform(), {x: 0, y: 0, zoom: 8});
    await page.locator("#source-drop").focus(); await page.keyboard.press("Enter");
    await page.locator("#source-url").fill("https://reader.test/next");
    await page.keyboard.press("ArrowLeft");
    assert.deepEqual(await transform(), {x: 0, y: 0, zoom: 8});
    await page.locator("#viewer-next").focus(); await page.keyboard.press("ArrowRight");
    assert.deepEqual(await transform(), {x: 0, y: 0, zoom: 8});
    await page.keyboard.press("Enter");
    assert.deepEqual(await transform(), {x: 0, y: 0, zoom: 1}, "ページ変更で倍率と位置を初期化する");
    await page.locator("#viewer-zoom-in").focus(); await page.keyboard.press("Enter");
    await stage.focus(); await page.keyboard.press("ArrowLeft");
    await page.locator("#viewer-zoom-reset").focus(); await page.keyboard.press("Enter");
    assert.deepEqual(await transform(), {x: 0, y: 0, zoom: 1});
    await page.locator("#viewer-previous").focus(); await page.keyboard.press("Enter");
  }
});
