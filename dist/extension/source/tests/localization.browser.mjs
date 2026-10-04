import {serveExtension} from "./support/extension-files.mjs";
import {launchBrowser} from "./support/browser.mjs";
import assert from "node:assert/strict";
import {join} from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import {redPng} from "./animation-fixtures.mjs";
import {mp4Bytes} from "./media-fixtures.mjs";

// Browser plugin not available; use the repository's Chrome/Playwright test setup.
// Flow: open panel -> analyze mixed media -> fail/retry saving -> open localized legal page.
test("日英の操作・動画保存失敗・ライセンス画面が同じ表示言語になり、元の名前は保つ", async (t) => {
  const {server} = await serveExtension(t, {headers: {
    "content-security-policy": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  }});

  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser(t);
  for (const locale of ["en-US", "ja-JP", "fr-FR"]) {
    const ja = locale === "ja-JP";
    const context = await browser.newContext({locale, reducedMotion: "reduce"});
    await context.addInitScript(language => {
      window.chrome = {
        i18n: {getUILanguage: () => language},
        runtime: {onConnect: {addListener() {}}},
        tabs: {
          query: async () => [{id: 7, url: "https://source.example.test/gallery"}],
          get: async () => ({id: 7, url: "https://source.example.test/gallery", status: "complete"}),
          onUpdated: {addListener() {}, removeListener() {}},
          onRemoved: {addListener() {}, removeListener() {}},
        },
        scripting: {executeScript: async () => [{result: {
          url: "https://source.example.test/gallery", title: "元のページ名",
          images: ["https://files.example.test/photo.png"],
          media: [{url: "https://files.example.test/動画.mp4", kind: "video"}],
        }}]},
        downloads: {
          download: async () => { throw new Error("Unknown native download failure"); },
          onChanged: {addListener() {}, removeListener() {}},
        },
      };
    }, locale);
    await context.route("https://files.example.test/**", route => {
      const video = route.request().url().endsWith(".mp4");
      const body = video ? mp4Bytes : redPng;
      return route.fulfill({status: video ? 500 : 200, contentType: video ? "video/mp4" : "image/png", body,
        headers: {"access-control-allow-origin": "*", "content-length": String(body.length)}});
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    try {
      await page.setViewportSize({width: 768, height: 700});
      await page.goto(`${origin}/app/index.html`);
      assert.equal(page.url(), `${origin}/app/index.html`);
      assert.equal(await page.title(), ja ? "Harvest | 画像を集める" : "Harvest | Collect images");
      assert.equal(await page.locator("html").getAttribute("lang"), ja ? "ja" : "en");
      await page.getByRole("button", {name: ja ? "解析" : "Analyze", exact: true}).click();
      await page.waitForFunction(() => (document.querySelector("#scan").dataset.scanning === "false" && !document.querySelector("#scan").disabled));
      await page.locator("#all-selection").check();
      await page.locator("#video-export-format-mp4").check();
      const hint = await page.locator("#export-media-hint").textContent();
      assert.match(hint, ja ? /original: 各ファイルをそのまま残す/ : /original: keep each file unchanged/);
      assert.match(hint, ja
        ? /動画はMP4で保存します。WebMは変換し、MP4は元データを使います。/
        : /Videos are saved as MP4\. WebM is converted; existing MP4 data is preserved\./);
      assert.doesNotMatch(hint, /動く画像はGIF|Animated images use GIF/, "推奨の画像保存は原本を保持する");
      await page.locator("#export").click();
      await page.waitForFunction(() => !document.querySelector("#failures").hidden);
      assert.equal(await page.locator("#failures-heading").textContent(), ja ? "保存できなかったファイル" : "Files that could not be saved");
      assert.match(await page.locator("#failed-images").textContent(), /動画\.mp4/);
      assert.match(await page.locator("#failed-images").textContent(), /応答|respond/);
      assert.equal(await page.locator("#export").textContent(), ja ? "失敗分を再試行" : "Retry failed files");
      assert.doesNotMatch(await page.locator("body").innerText(), /Unknown native|\{\w+\}/);
      await page.screenshot({path: join(tmpdir(), `harvest-localization-${locale}-failure.png`)});
      const popupPromise = context.waitForEvent("page");
      await page.getByRole("link", {name: ja ? "ライセンスとソース" : "License and source", exact: true}).click();
      const legal = await popupPromise;
      legal.on("pageerror", error => errors.push(error.message));
      await legal.waitForLoadState();
      assert.equal(legal.url(), `${origin}/app/legal.html`);
      assert.equal(await legal.title(), ja ? "Harvest | ライセンスとソース" : "Harvest | License and source");
      assert.equal(await legal.locator("html").getAttribute("lang"), ja ? "ja" : "en");
      assert.equal(await legal.locator("h2").textContent(), ja ? "同梱ライブラリ" : "Bundled libraries");
      if (!ja) assert.doesNotMatch(await legal.locator("body").innerText(), /[ぁ-んァ-ヶ一-龯]/u);
      for (const width of [360, 1100]) {
        await legal.setViewportSize({width, height: 760});
        assert.ok(await legal.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal clipping");
        await legal.screenshot({path: join(tmpdir(), `harvest-localization-${locale}-legal-${width}.png`), fullPage: true});
      }
      for (const href of await legal.locator("a").evaluateAll(links => links.map(link => link.href))) {
        if (href.startsWith(origin)) assert.equal((await context.request.get(href)).status(), 200);
      }
      assert.deepEqual(errors.filter(error=>!error.includes("status of 500")), []);
    } finally { await context.close(); }
  }
});
