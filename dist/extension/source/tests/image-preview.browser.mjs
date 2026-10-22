import assert from "node:assert/strict";
import test from "node:test";
import {launchBrowser} from "./support/browser.mjs";
import {extensionFile} from "./support/extension-files.mjs";
import {redPng} from "./animation-fixtures.mjs";

test("HTTP成功後の壊れた画像をViewerで再試行し、一覧にも正常な画像を共有する", async t => {
  const browser = await launchBrowser(t);
  const page = await browser.newPage({reducedMotion: "reduce"});
  let requests = 0, recovered = false;
  await page.route("https://app.example.test/**", async route => {
    const file = await extensionFile(new URL(route.request().url()).pathname);
    await route.fulfill({contentType: file.contentType, body: file.body});
  });
  await page.route("https://images.example.test/one.png", route => {
    requests++;
    return route.fulfill({contentType: "image/png", body: recovered ? redPng : Buffer.from([1, 2, 3])});
  });
  await page.addInitScript(() => {
    window.previewErrors = 0;
    document.addEventListener("error", event => {
      if (event.target instanceof HTMLImageElement && event.target.src.startsWith("blob:")) window.previewErrors++;
    }, true);
    const scan = {url: "https://source.example.test/gallery", title: "Preview retry", images: ["https://images.example.test/one.png"]};
    window.chrome = {
      runtime: {onConnect: {addListener() {}}},
      i18n: {getUILanguage: () => "ja"},
      tabs: {
        query: async () => [{id: 7, url: scan.url}], get: async () => ({id: 7, url: scan.url}),
        onRemoved: {addListener() {}, removeListener() {}},
      },
      scripting: {executeScript: async () => [{result: scan}]},
    };
  });
  await page.goto("https://app.example.test/app/index.html");
  await page.locator("#scan").click();
  await page.waitForFunction(() => document.querySelector("#images img")?.dataset.previewFailed === "true");
  await page.locator("#viewer-toggle").click();
  await page.waitForFunction(() => document.querySelector("#viewer-image").dataset.previewFailed === "true");
  await page.locator('#viewer-thumbnails button[aria-current="true"]').click();
  assert.equal(requests, 1, "待ち時間内のViewer操作では連続取得しない");

  // A permanently broken response remains retryable without a request loop.
  await page.waitForTimeout(1_050);
  const previousErrors = await page.evaluate(() => window.previewErrors);
  await page.locator('#viewer-thumbnails button[aria-current="true"]').click();
  await page.waitForFunction(before => window.previewErrors > before
    && document.querySelector("#viewer-image").dataset.previewFailed === "true"
    && !document.querySelector("#viewer-image").getAttribute("src"), previousErrors);
  assert.equal(requests, 2);
  await page.waitForTimeout(1_050);
  assert.equal(requests, 2, "恒常的な表示失敗で自動の再取得を繰り返さない");

  recovered = true;
  await page.locator('#viewer-thumbnails button[aria-current="true"]').click();
  await page.waitForFunction(() => document.querySelector("#viewer-image").naturalWidth === 32
    && document.querySelector("#viewer-thumbnails img").naturalWidth === 32);
  assert.equal(requests, 3);
  const viewerSrc = await page.locator("#viewer-image").getAttribute("src");
  await page.locator("#viewer-toggle").click();
  await page.waitForFunction(() => document.querySelector("#images img").naturalWidth === 32);
  assert.equal(await page.locator("#images img").getAttribute("src"), viewerSrc);
  assert.equal(await page.locator("#images img").getAttribute("data-preview-failed"), null);
  await page.locator("#reset").click();
  assert.equal(await page.locator("#images img").count(), 0);
  assert.equal(await page.locator("#viewer-image").getAttribute("src"), null);
});
