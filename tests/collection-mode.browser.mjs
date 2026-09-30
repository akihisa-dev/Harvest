import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {chromium} from "playwright";

test("removed collection links lose their marker in a real DOM", async () => {
  const moduleSource = await readFile(new URL("../dist/extension/app/collection-mode.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<a id="target" href="https://example.test/target">Target</a>');
    await page.evaluate(async source => {
      window.collectionMessages = [];
      window.syntheticClickResults = [];
      const port = {
        onMessage: {addListener(listener) { window.sendCollectionMessage = listener; }},
        onDisconnect: {addListener() {}},
        postMessage(message) { window.collectionMessages.push(message); },
      };
      Object.defineProperty(window, "chrome", {configurable: true, value: {runtime: {connect: () => port}}});
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      try {
        const {captureCollectionLinks} = await import(moduleUrl);
        captureCollectionLinks("test-session");
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      const target = document.querySelector("#target");
      target.addEventListener("click", event => {
        window.syntheticClickResults.push({trusted: event.isTrusted, prevented: event.defaultPrevented});
        if (!event.isTrusted) event.preventDefault();
      });
      target.click();
      target.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
    }, moduleSource);
    assert.deepEqual(await page.evaluate(() => window.collectionMessages), [], "synthetic clicks do not reach the extension");
    assert.deepEqual(await page.evaluate(() => window.syntheticClickResults), [
      {trusted: false, prevented: false},
      {trusted: false, prevented: false},
    ], "synthetic clicks retain normal page handling");

    await page.locator("#target").click();
    assert.deepEqual(await page.evaluate(() => window.collectionMessages), [{url: "https://example.test/target"}], "trusted input reaches the extension");
    await page.evaluate(() => window.sendCollectionMessage({busy: false, pdfUrl: "https://example.test/target", canExport: true}));
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 2);

    await page.evaluate(() => { window.removedCollectionLink = document.querySelector("#target"); window.removedCollectionLink.remove(); });
    await page.waitForFunction(() => document.querySelectorAll('div[aria-hidden="true"]').length === 1);
    await page.evaluate(() => {
      document.body.append(window.removedCollectionLink);
      window.sendCollectionMessage({pdfUrl: "https://example.test/target"});
    });
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 1, "stale link state is not restored");

    await page.locator("#target").click();
    await page.evaluate(() => window.sendCollectionMessage({pdfUrl: "https://example.test/target"}));
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 2, "a new click can mark the link again");
  } finally {
    await browser.close();
  }
});
