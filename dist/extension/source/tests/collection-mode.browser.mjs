import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {chromium} from "playwright";

test("removed collection links lose their marker in a real DOM", async () => {
  const moduleSource = await readFile(new URL("../dist/extension/app/content/collection-mode.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<a id="target" href="https://example.test/target">Target</a><a id="keyboard" href="https://example.test/keyboard">Keyboard</a>');
    await page.evaluate(async source => {
      window.collectionMessages = [];
      window.syntheticClickResults = [];
      const port = {
        onMessage: {addListener(listener) { window.sendCollectionMessage = listener; } },
        onDisconnect: {addListener() {} },
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
    await page.locator("#keyboard").focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.collectionMessages), [
      {url: "https://example.test/target"},
      {url: "https://example.test/keyboard"},
    ], "a keyboard-generated trusted click reaches the extension");
    await page.evaluate(() => window.sendCollectionMessage({busy: false, pdfUrl: "https://example.test/target", canExport: true}));
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 2);

    await page.evaluate(() => {
      window.removedCollectionLink = document.querySelector("#target");
      window.removedCollectionLink.remove();
    });
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

test("href changes clear old collection markers and reject stale results in a real DOM", async () => {
  const moduleSource = await readFile(new URL("../dist/extension/app/content/collection-mode.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<a id="target" href="https://example.test/a">Target</a>');
    await page.evaluate(async source => {
      const port = {
        onMessage: {addListener(listener) { window.sendCollectionMessage = listener; } },
        onDisconnect: {addListener() {} },
        postMessage() {},
      };
      Object.defineProperty(window, "chrome", {configurable: true, value: {runtime: {connect: () => port}}});
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      try {
        const {captureCollectionLinks} = await import(moduleUrl);
        captureCollectionLinks("test-session");
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    }, moduleSource);

    const target = page.locator("#target");
    await target.click();
    await page.evaluate(() => window.sendCollectionMessage({busy: false, pdfUrl: "https://example.test/a", canExport: true}));
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 2);

    await target.evaluate(element => element.setAttribute("href", "https://example.test:443/a"));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 2, "equivalent URLs retain their marker");

    await target.evaluate(element => element.setAttribute("href", "https://example.test/b"));
    await page.waitForFunction(() => document.querySelectorAll('div[aria-hidden="true"]').length === 1);
    await page.evaluate(() => window.sendCollectionMessage({pdfUrl: "https://example.test/a"}));
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 1, "old analyzed URLs stay cleared");

    await target.click();
    await target.evaluate(element => element.setAttribute("href", "https://example.test/c"));
    await page.evaluate(() => window.sendCollectionMessage({pdfUrl: "https://example.test/b"}));
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 1, "a pending result cannot mark a changed link");

    await target.click();
    await page.evaluate(() => window.sendCollectionMessage({pdfUrl: "https://example.test/c"}));
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 2, "the new URL can be marked after its own click");
  } finally {
    await browser.close();
  }
});

test("page layout shifts reposition persistent and hovered collection glows", async () => {
  const moduleSource = await readFile(new URL("../dist/extension/app/content/collection-mode.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<a id="target" href="https://example.test/layout">Target</a>');
    await page.evaluate(async source => {
      const port = {
        onMessage: {addListener(listener) { window.sendCollectionMessage = listener; } },
        onDisconnect: {addListener() {} },
        postMessage() {},
      };
      Object.defineProperty(window, "chrome", {configurable: true, value: {runtime: {connect: () => port}}});
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      try {
        const {captureCollectionLinks} = await import(moduleUrl);
        captureCollectionLinks("test-session");
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    }, moduleSource);

    const target = page.locator("#target");
    await target.click();
    await page.evaluate(() => window.sendCollectionMessage({busy: false, pdfUrl: "https://example.test/layout", canExport: true}));
    await target.hover();
    assert.equal(await page.locator('div[aria-hidden="true"]').count(), 2);

    await page.evaluate(() => {
      const targetElement = document.querySelector("#target");
      const spacer = document.createElement("div");
      spacer.style.height = "8px";
      targetElement.parentNode.insertBefore(spacer, targetElement);
    });
    await page.waitForFunction(() => {
      const rect = document.querySelector("#target").getBoundingClientRect();
      const overlays = [...document.querySelectorAll('div[aria-hidden="true"]')];
      return overlays.length === 2 && overlays.every(overlay => Math.abs(Number.parseFloat(overlay.style.top) - rect.top) < 1);
    });
    const positions = await page.evaluate(() => {
      const targetTop = document.querySelector("#target").getBoundingClientRect().top;
      const overlayTops = [...document.querySelectorAll('div[aria-hidden="true"]')].map(overlay => Number.parseFloat(overlay.style.top));
      return {targetTop, overlayTops};
    });
    assert.ok(positions.targetTop > 10, "the DOM change moved the link while the pointer remained over it");
    assert.ok(positions.overlayTops.every(top => Math.abs(top - positions.targetTop) < 1), "both glows follow the moved link");
  } finally {
    await browser.close();
  }
});
