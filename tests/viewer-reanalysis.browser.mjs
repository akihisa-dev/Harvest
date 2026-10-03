import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {extname, resolve, sep} from "node:path";
import test from "node:test";
import {chromium} from "playwright";

const extension = resolve("dist/extension");
const mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=", "base64");

test("再解析した同じ画像URLを中央に再表示し、現在のsourcePageで取得する", async () => {
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://app.example.test/**", async route => {
      const path = resolve(extension, "." + new URL(route.request().url()).pathname);
      assert.ok(path.startsWith(extension + sep));
      await route.fulfill({contentType: mime[extname(path)] ?? "application/octet-stream", body: await readFile(path)});
    });
    await page.route("https://images.example.test/**", route => route.fulfill({contentType: "image/png", body: png}));
    await page.addInitScript(() => {
      window.__previewRequests = [];
      const fetchOriginal = window.fetch;
      window.fetch = (url, options) => {
        window.__previewRequests.push({url: String(url), credentials: options?.credentials});
        return fetchOriginal(url, options);
      };
      window.chrome = {
        runtime: {onConnect: {addListener() {}}},
        i18n: {getUILanguage: () => "ja"},
        tabs: {
          query: async () => [{id: 7, url: window.__scanFixture.url}],
          get: async () => ({id: 7, url: window.__scanFixture.url}),
          onRemoved: {addListener() {}, removeListener() {}},
        },
        scripting: {executeScript: async () => [{result: window.__scanFixture}]},
      };
    });
    await page.goto("https://app.example.test/app/index.html");
    async function scan(sourcePage) {
      await page.evaluate(url => {
        window.__scanFixture = {url, title: "Viewer regression", images: [1, 2].map(i => `https://images.example.test/${i}.png`)};
      }, sourcePage);
      await page.locator("#scan").click();
      await page.waitForFunction(() => (document.querySelector("#scan").dataset.scanning === "false" && !document.querySelector("#scan").disabled));
    }
    async function openViewer() {
      await page.locator("#viewer-toggle").click();
      await page.waitForFunction(() => {
        const image = document.querySelector("#viewer-image");
        return image.getAttribute("src") && image.complete && image.naturalWidth > 0;
      }, null, {timeout: 5000});
      assert.equal(await page.locator("#viewer-image").getAttribute("data-preview-url"), "https://images.example.test/1.png");
      assert.equal(await page.locator("#viewer-image").isVisible(), true);
    }
    await scan("https://source.example.test/gallery");
    await openViewer();
    const originalSrc = await page.locator("#viewer-image").getAttribute("src");
    await page.locator("#viewer-toggle").click();
    await scan("https://source.example.test/gallery");
    await openViewer();
    assert.notEqual(await page.locator("#viewer-image").getAttribute("src"), originalSrc, "再解析後は新しいプレビューをバインドする");

    await page.locator("#viewer-next").click();
    await page.waitForFunction(() => document.querySelector("#viewer-image").dataset.previewUrl === "https://images.example.test/2.png"
      && document.querySelector("#viewer-image").naturalWidth > 0 && !document.querySelector(".viewer-motion-image"));
    // Reanalysis while open also clears the previous page and its visual layers.
    await scan("https://images.example.test/gallery");
    await openViewer();
    const requests = await page.evaluate(() => window.__previewRequests.filter(request => request.url === "https://images.example.test/1.png"));
    assert.deepEqual(requests.map(request => request.credentials), ["omit", "omit", "include"], "共有URLも現在のsourcePageの取得方針に従う");
    assert.equal(await page.locator(".viewer-motion-image").count(), 0);

    await page.locator("#reset").click();
    assert.equal(await page.locator("#viewer-image").getAttribute("src"), null);
    assert.equal(await page.locator("#viewer-thumbnails img").count(), 0);
    await scan("https://source.example.test/gallery");
    await openViewer();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
