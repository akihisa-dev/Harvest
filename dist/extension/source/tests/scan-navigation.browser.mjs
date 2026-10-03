import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {chromium} from "playwright";

test("scanDocumentとscanTabは解析中のSPA遷移を拒否し、確定済み結果を保持する", async () => {
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("https://scan.example.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (/^\/(?:app|core)\/[a-z-]+\.js$/.test(path)) {
        return route.fulfill({contentType: "text/javascript", body: await readFile(new URL(`../dist/extension${path}`, import.meta.url), "utf8")});
      }
      return route.fulfill({contentType: "text/html", body: '<!doctype html><title>post</title><img data-src="https://cdn.example.test/old.jpg">'});
    });
    await page.route("https://cdn.example.test/**", route => route.abort());
    for (const mode of ["path", "query", "mixed", "hash", "redirect"]) {
      await page.goto("https://scan.example.test/postA");
      const state = await page.evaluate(async mode => {
        const oldUrl = location.href;
        if (mode === "redirect") history.replaceState(null, "", "/redirected");
        const sourceUrl = location.href;
        const callbacks = new Set();
        globalThis.chrome = {
          i18n: {getUILanguage: () => "ja"},
          tabs: {
            query: async () => [{id: 1, url: location.href}],
            get: async () => ({url: location.href}),
            onRemoved: {addListener: fn => callbacks.add(fn), removeListener: fn => callbacks.delete(fn)}
          },
          scripting: {
            executeScript: async ({func, args = []}) => {
              const work = func(...args);
              if (func.name === "scanDocument" && mode !== "redirect") {
                setTimeout(() => {
                  history.pushState(null, "", mode === "hash" ? "#section" : mode === "query" ? "?page=B" : "/postB");
                  // The previous DOM remains during the route transition.
                  setTimeout(() => {
                    if (mode === "hash") return;
                    const image = document.createElement("img");
                    image.dataset.src = "https://cdn.example.test/new.jpg";
                    if (mode === "mixed") document.body.append(image);
                    else document.body.replaceChildren(image);
                  }, 30);
                }, 20);
              }
              return [{result: await work, documentId: "fixture"}];
            }
          },
        };
        const {createScanSessionController} = await import("/app/scan-session-controller.js");
        const {ImageCollection} = await import("/core/image-collection.js");
        const collection = new ImageCollection();
        collection.replace(["https://previous.test/retained.jpg"], "https://previous.test/page");
        const previous = collection.items;
        const messages = [], publications = [];
        const controller = createScanSessionController({
          collection,
          getEnteredUrl: () => "",
          getCollectionSession: () => null,
          clearAnalyzedUrl() {},
          markAnalyzedUrl() {},
          isBusy: () => false,
          isDisposed: () => false,
          onHideSourceInput() {},
          onShowSourceInput() {},
          onBusyChange() {},
          onStatus: message => messages.push(message),
          onResults: (...args) => publications.push(args),
        });
        await controller.start();
        return {
          preserved: collection.items === previous,
          items: collection.items,
          publications,
          messages,
          listeners: callbacks.size,
          sourceUrl,
          oldUrl
        };
      }, mode);
      if (["path", "query", "mixed"].includes(mode)) {
        assert.equal(state.preserved, true, mode);
        assert.deepEqual(state.publications, []);
        assert.equal(state.items[0].sourcePage, "https://previous.test/page");
        assert.match(state.messages.at(-1), /ページが移動/);
      } else {
        assert.equal(state.preserved, false, mode);
        assert.equal(state.items[0].sourcePage, state.sourceUrl);
        assert.deepEqual(state.items.map(item => item.url), ["https://cdn.example.test/old.jpg"]);
      }
      assert.equal(state.listeners, 0);
    }
  } finally {
    await browser.close();
  }
});
