import assert from "node:assert/strict";
import test from "node:test";

test("解析時に開いているページだけを調べ、URL指定時はそのURLを使う", async () => {
  const listeners = new Map();
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        value: "", checked: true, disabled: false, hidden: false, textContent: "", dataset: {},
        addEventListener(name, callback) { listeners.set(`${selector}:${name}`, callback); },
        replaceChildren() {},
        append() {}
      });
    }
    return elements.get(selector);
  };
  const previousDocument = globalThis.document;
  const previousChrome = globalThis.chrome;
  const previousWindow = globalThis.window;
  const queries = [];
  const scannedTabs = [];
  const createdUrls = [];
  const removedTabs = [];
  globalThis.document = {querySelector: element, addEventListener() {}};
  globalThis.window = {setTimeout, clearTimeout};
  globalThis.chrome = {
    tabs: {
      query: async query => { queries.push(query); return [{id: 7, url: "https://example.com/page"}]; },
      create: async ({url}) => { createdUrls.push(url); return {id: 8, url}; },
      get: async () => ({status: "complete"}),
      remove: async id => { removedTabs.push(id); },
      onUpdated: {addListener() {}, removeListener() {}}
    },
    scripting: {executeScript: async ({target}) => {
      scannedTabs.push(target.tabId);
      return [{result: {url: "https://example.com/page", title: "ページ", images: [], links: []}}];
    }}
  };
  try {
    await import(`../dist/extension/app/index.js?tab-access=${Date.now()}`);
    assert.deepEqual(queries, []);
    listeners.get("#scan:click")();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(queries, [{active: true, currentWindow: true}]);
    assert.deepEqual(scannedTabs, [7]);

    element("#source-url").value = "https://example.com/other";
    listeners.get("#scan:click")();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queries.length, 1);
    assert.deepEqual(createdUrls, ["https://example.com/other"]);
    assert.deepEqual(scannedTabs, [7, 8]);
    assert.deepEqual(removedTabs, [8]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.chrome = previousChrome;
    globalThis.window = previousWindow;
  }
});
