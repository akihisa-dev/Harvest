import assert from "node:assert/strict";
import test from "node:test";

test("タブの名前とURLは利用者が一覧表示を押すまで読まない", async () => {
  const listeners = new Map();
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        value: "",
        options: [],
        disabled: false,
        textContent: "",
        addEventListener(name, callback) { listeners.set(`${selector}:${name}`, callback); },
        replaceChildren() { this.options = []; this.value = ""; },
        append(option) {
          this.options.push(option);
          if (option.selected || this.options.length === 1) this.value = option.value;
        }
      });
    }
    return elements.get(selector);
  };
  const previousDocument = globalThis.document;
  const previousChrome = globalThis.chrome;
  const queries = [];
  globalThis.document = {
    querySelector: element,
    addEventListener() {},
    createElement() { return {value: "", selected: false, textContent: ""}; }
  };
  globalThis.chrome = {tabs: {query: async query => {
    queries.push(query);
    return [{id: 7, url: "https://example.com/page", title: "画像のページ"}];
  }}};
  try {
    await import(`../dist/extension/app/index.js?tab-access=${Date.now()}`);
    assert.equal(queries.length, 0);
    await listeners.get("#load-tabs:click")();
    assert.equal(queries.length, 2);
    assert.equal(element("#source-tab").value, "7");
    assert.equal(element("#source-tab").disabled, false);
  } finally {
    globalThis.document = previousDocument;
    globalThis.chrome = previousChrome;
  }
});
