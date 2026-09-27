import assert from "node:assert/strict";
import test from "node:test";

test("解析時に開いているページだけを調べ、URL指定時はそのURLを使う", async () => {
  const listeners = new Map();
  const documentListeners = new Map();
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        value: "", checked: true, disabled: false, hidden: selector === "#source-url", textContent: "", dataset: {}, style: {}, children: [],
        classList: {add() {}, remove() {}},
        addEventListener(name, callback) { listeners.set(`${selector}:${name}`, callback); },
        setAttribute() {},
        removeAttribute() {},
        focus() { globalThis.document.activeElement = this; },
        select() {},
        animate() { return {cancel() {}, finished: Promise.resolve()}; },
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
  globalThis.document = {querySelector: element, addEventListener(name, callback) { documentListeners.set(name, callback); }};
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
      return [{result: {
        url: "https://example.com/page",
        title: "ページ",
        images: [],
        links: [{url: "https://example.com/gallery", label: "一覧"}],
      }}];
    }}
  };
  try {
    await import(`../dist/extension/app/index.js?tab-access=${Date.now()}`);
    assert.deepEqual(queries, []);
    assert.equal(element("#source-url").hidden, true);
    assert.equal(element("#source-drop").hidden, false);
    let prevented = false;
    documentListeners.get("dragover")({
      target: element("#viewer"), dataTransfer: {types: ["text/uri-list"]},
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, true);
    listeners.get("#source-drop:click")();
    assert.equal(element("#source-url").hidden, false);
    assert.equal(element("#source-drop").hidden, true);
    assert.equal(globalThis.document.activeElement, element("#source-url"));
    listeners.get("#source-url:blur")();
    assert.equal(element("#source-url").hidden, true);
    assert.equal(element("#source-drop").hidden, false);
    listeners.get("#scan:click")();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(queries, [{active: true, currentWindow: true}]);
    assert.deepEqual(scannedTabs, [7]);
    assert.deepEqual(createdUrls, []);

    prevented = false;
    documentListeners.get("dragover")({
      target: element("#viewer"), dataTransfer: {types: ["text/uri-list"]},
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, false);
    documentListeners.get("drop")({
      target: element("#viewer"),
      dataTransfer: {getData: () => "https://example.com/ignored"},
      preventDefault() { prevented = true; },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(prevented, true);
    assert.deepEqual(createdUrls, []);

    prevented = false;
    documentListeners.get("dragover")({
      target: element("#source-drop"), dataTransfer: {types: ["text/uri-list"]},
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, true);
    documentListeners.get("drop")({
      target: element("#source-drop"),
      dataTransfer: {getData: type => type === "text/uri-list" ? "https://example.com/other" : ""},
      preventDefault() {},
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(element("#source-drop").textContent, "https://example.com/other");
    assert.equal(element("#source-url").hidden, true);
    assert.equal(queries.length, 1);
    assert.deepEqual(createdUrls, ["https://example.com/other"]);
    assert.deepEqual(scannedTabs, [7, 8]);
    assert.deepEqual(removedTabs, [8]);

    listeners.get("#source-drop:click")();
    prevented = false;
    documentListeners.get("dragover")({
      target: element("#source-url"), dataTransfer: {types: ["text/uri-list"]},
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, true);
    element("#source-url").value = "https://example.com/manual";
    listeners.get("#source-url:input")();
    listeners.get("#source-url:keydown")({key: "Enter"});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(element("#source-url").hidden, true);
    assert.equal(element("#source-drop").textContent, "https://example.com/manual");
    assert.deepEqual(createdUrls, ["https://example.com/other", "https://example.com/manual"]);
    assert.deepEqual(scannedTabs, [7, 8, 8]);

    listeners.get("#reset:click")();
    prevented = false;
    documentListeners.get("drop")({
      target: element("#viewer"),
      dataTransfer: {getData: type => type === "text/uri-list" ? "https://example.com/after-clear" : ""},
      preventDefault() { prevented = true; },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(prevented, true);
    assert.deepEqual(createdUrls, ["https://example.com/other", "https://example.com/manual", "https://example.com/after-clear"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.chrome = previousChrome;
    globalThis.window = previousWindow;
  }
});
