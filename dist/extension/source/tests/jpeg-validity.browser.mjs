import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {chromium} from "playwright";
import {baselineJpeg, progressiveJpeg, brokenJpegs, undecodableJpeg} from "./jpeg-fixtures.mjs";

test("破損JPEGはPDF・JPGの失敗として再試行し、正常なbaseline/progressiveの元データを保存する", async () => {
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("https://harvest.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({contentType: "text/html", body: "<!doctype html><html><body></body></html>"});
      const body = await readFile(new URL(`../dist/extension${path}`, import.meta.url));
      return route.fulfill({contentType: "text/javascript", body});
    });
    await page.goto("https://harvest.test/");
    const results = await page.evaluate(async fixtures => {
      const {fetchImage} = await import("/app/image-fetch.js");
      const {convertImage} = await import("/app/image-format.js");
      const {toPdfPage} = await import("/app/pdf-image.js");
      const {createPdfExportController} = await import("/app/pdf-export-controller.js");
      const {createImageExportController} = await import("/app/image-export-controller.js");
      const bytesByName = new Map(Object.entries(fixtures).map(([name, bytes]) => [name, new Uint8Array(bytes)]));
      const calls = {};
      let repair = false;
      window.fetch = async url => {
        const name = new URL(url).pathname.slice(1);
        calls[name] = (calls[name] ?? 0) + 1;
        const bytes = bytesByName.get(repair && name === "retry" ? "baseline" : name);
        return new Response(bytes, {headers: {"content-type": "image/jpeg"}});
      };
      const realDecode = window.createImageBitmap.bind(window);
      let activeBitmaps = 0;
      let decoded = 0;
      let released = 0;
      window.createImageBitmap = async (...args) => {
        const bitmap = await realDecode(...args);
        decoded += 1;
        activeBitmaps += 1;
        const close = bitmap.close.bind(bitmap);
        bitmap.close = () => { activeBitmaps -= 1; released += 1; close(); };
        return bitmap;
      };
      const rejected = [];
      for (const name of bytesByName.keys()) {
        if (name === "baseline" || name === "progressive" || name === "retry") continue;
        for (const format of ["pdf", "jpg"]) {
          try {
            if (format === "pdf") await toPdfPage(`https://harvest.test/${name}`);
            else await convertImage(await fetchImage(`https://harvest.test/${name}`, {}), "jpg");
            rejected.push({name, format, failed: false});
          } catch (error) {
            rejected.push({name, format, failed: error.kind === "invalid-image"});
          }
        }
      }
      const originals = [];
      for (const name of ["baseline", "progressive"]) {
        const pdf = await toPdfPage(`https://harvest.test/${name}`);
        const image = await fetchImage(`https://harvest.test/${name}`, {});
        const jpg = await convertImage(image, "jpg");
        originals.push({name, pdf: [...pdf.jpeg], jpg: [...new Uint8Array(await jpg.arrayBuffer())], activeBitmaps});
      }
      // Observe the browser download boundary; CRC worker behavior is covered separately.
      window.Worker = undefined;
      const downloaded = [];
      URL.createObjectURL = blob => { downloaded.push(blob); return "blob:fixture"; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = () => {};
      const retries = [];
      for (const format of ["pdf", "jpg"]) {
        repair = false;
        const successful = {url: "https://harvest.test/baseline", sourcePage: "https://harvest.test/", selected: true};
        const failed = {url: "https://harvest.test/retry", sourcePage: "https://harvest.test/", selected: true};
        let busy = false;
        const options = {
          getSelectedItems: () => [successful, failed], getFilename: () => "fixture.pdf", getZipFilename: () => "fixture.zip",
          getSourcePage: () => undefined, isBusy: () => busy, isDisposed: () => false,
          onBusyChange: value => { busy = value; }, onStatus() {}, onCloseViewer() {}, onClearSourceUrl() {}, onScrollToFailures() {},
        };
        const controller = format === "pdf" ? createPdfExportController(options) : createImageExportController(options);
        const beforeGood = calls.baseline ?? 0;
        const beforeFailed = calls.retry ?? 0;
        const beforeDownloads = downloaded.length;
        await controller.export(format);
        const retained = controller.pending?.prepared.has(successful) && controller.pending?.failed.has(failed);
        const noPartialDownload = downloaded.length === beforeDownloads;
        repair = true;
        await controller.export(format);
        const artifact = new Uint8Array(await downloaded.at(-1).arrayBuffer());
        const expected = bytesByName.get("baseline");
        const first = artifact.findIndex((_, index) => expected.every((byte, offset) => artifact[index + offset] === byte));
        retries.push({format, retained, noPartialDownload, goodCalls: calls.baseline - beforeGood,
          failedCalls: calls.retry - beforeFailed, downloads: downloaded.length - beforeDownloads,
          completed: controller.pending === null, containsOriginalBytes: first >= 0});
      }
      return {rejected, originals, retries, activeBitmaps, decoded, released};
    }, Object.fromEntries(Object.entries({baseline: baselineJpeg, progressive: progressiveJpeg,
      ...brokenJpegs, "invalid-huffman-codes": undecodableJpeg, retry: brokenJpegs["issue-25-bytes"]})
      .map(([name, bytes]) => [name, [...bytes]])));
    assert.ok(results.rejected.length > 0);
    for (const result of results.rejected) assert.equal(result.failed, true, `${result.name}: ${result.format}`);
    for (const result of results.originals) {
      const bytes = result.name === "baseline" ? baselineJpeg : progressiveJpeg;
      assert.deepEqual(result.pdf, [...bytes]);
      assert.deepEqual(result.jpg, [...bytes]);
      assert.equal(result.activeBitmaps, 0, "検証用の画素は保存せず即時解放する");
    }
    for (const result of results.retries) assert.deepEqual(result, {
      format: result.format, retained: true, noPartialDownload: true, goodCalls: 1, failedCalls: 2,
      downloads: 1, completed: true, containsOriginalBytes: true,
    });
    assert.ok(results.decoded > 0);
    assert.equal(results.activeBitmaps, 0);
    assert.equal(results.released, results.decoded);
  } finally {
    await browser.close();
  }
});
