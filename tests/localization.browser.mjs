import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve, sep, extname, join} from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import {chromium} from "playwright";
import {mp4Bytes} from "./media-fixtures.mjs";

// Browser plugin not available; use the repository's Chrome/Playwright test setup.
// Flow: open panel -> analyze mixed media -> fail/retry saving -> open localized legal page.
test("日英の操作・動画保存失敗・ライセンス画面が同じ表示言語になり、元の名前は保つ", async () => {
  const root = resolve("dist/extension");
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(root, "." + new URL(req.url, "http://localhost").pathname);
      if (!path.startsWith(root + sep)) throw new Error("Outside extension");
      const mime = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml"};
      res.setHeader("content-type", mime[extname(path)] ?? "text/plain");
      res.setHeader("content-security-policy", "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({channel: "chrome", headless: true});
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
        const body = video ? mp4Bytes : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=", "base64");
        return route.fulfill({status: 200, contentType: video ? "video/mp4" : "image/png", body,
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
        await page.waitForFunction(() => !document.querySelector("#scan").disabled);
        await page.locator("#all-selection").check();
        await page.locator("#export-format-mp4").check();
        assert.equal(await page.locator("#export-media-hint").textContent(), ja
          ? "動画はMP4で保存します。WebMは変換し、MP4は元データを使います。 MP4の対象だけを保存します。選択中の1件は対象外です。"
          : "Videos are saved as MP4. WebM is converted; existing MP4 data is preserved. Only files for MP4 are saved. Excluded: 1 selected file.");
        await page.locator("#export").click();
        await page.waitForFunction(() => !document.querySelector("#failures").hidden);
        assert.equal(await page.locator("#failures-heading").textContent(), ja ? "保存できなかったファイル" : "Files that could not be saved");
        assert.match(await page.locator("#failed-images").textContent(), /動画\.mp4/);
        assert.ok((await page.locator("#failed-images").textContent()).endsWith(ja ? "ファイルを保存できませんでした。" : "Could not save the files."));
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
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
