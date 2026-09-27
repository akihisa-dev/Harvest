import assert from "node:assert/strict";
import test from "node:test";

class StubElement {
  constructor(tagName, owner) {
    this.tagName = tagName;
    this.owner = owner;
    this.value = "";
    this.checked = true;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.className = "";
    this.classList = {add: name => { this.className += this.className ? ` ${name}` : name; }};
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  append(...children) { this.children.push(...children.filter(Boolean)); }
  replaceChildren(...children) { this.children = children.filter(Boolean); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.owner.activeElement = this; }
  scrollIntoView() {}
  dispatch(name) { return this.listeners.get(name)?.({}); }
}

function descendants(element) {
  return element.children.flatMap(child => child instanceof StubElement ? [child, ...descendants(child)] : []);
}

test("画像操作後もフォーカス、件数、表示絞り込み、全体順序を保つ", async () => {
  const document = {
    activeElement: null,
    elements: new Map(),
    createElement(tagName) { return new StubElement(tagName, document); },
    createTextNode(text) { return {textContent: text}; },
    querySelector(selector) {
      if (!document.elements.has(selector)) document.elements.set(selector, new StubElement("div", document));
      return document.elements.get(selector);
    },
    querySelectorAll(selector) {
      if (selector !== "[data-focus-kind]") return [];
      return [...document.elements.values()].flatMap(element => [element, ...descendants(element)])
        .filter(element => element.getAttribute?.("data-focus-kind"));
    },
    addEventListener() {},
  };
  for (const selector of [
    "#source-url", "#scan", "#export", "#select-all", "#clear-all", "#reset",
    "#completion", "#back-to-images", "#high-quality", "#images", "#groups", "#group-selections",
    "#count", "#empty", "#status",
  ]) document.querySelector(selector);
  const previousDocument = globalThis.document;
  const previousChrome = globalThis.chrome;
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let resultImages = [
    "https://example.com/pages/001.jpg",
    "https://example.com/pages/002.jpg",
    "https://example.com/cover/001.jpg",
    "https://example.com/cover/002.jpg",
  ];
  let executionCount = 0;
  const createdUrls = [];
  globalThis.document = document;
  globalThis.window = {setTimeout, clearTimeout};
  globalThis.chrome = {
    tabs: {
      query: async () => [{id: 7, url: "https://example.com/view"}],
      create: async ({url}) => { createdUrls.push(url); return {id: 8, url}; },
      get: async () => ({status: "complete"}),
      remove: async () => {},
      onUpdated: {addListener() {}, removeListener() {}},
    },
    scripting: {executeScript: async () => {
      executionCount += 1;
      return [{result: {
        url: "https://example.com/view", title: "ページ",
        links: [{url: "https://example.com/pages/gallery", label: "一覧"}],
        images: executionCount === 3 ? [] : resultImages,
      }}];
    }},
  };
  try {
    await import(`../dist/extension/app/index.js?ui=${Date.now()}`);
    const empty = document.querySelector("#empty");
    assert.equal(empty.textContent, "ここに画像が並びます。\n「解析」を押して、画像を集めましょう。");

    document.querySelector("#scan").dispatch("click");
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    assert.equal(empty.textContent, "画像を調べています…");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(empty.hidden, true);
    assert.equal(document.querySelector("#count").textContent, "2 / 4枚を選択");
    assert.equal(document.querySelector("#export").textContent, "PDFを保存（2枚）");

    const getPdfGroupCheckbox = key => descendants(document.querySelector("#group-selections"))
      .find(input => input.getAttribute("data-focus-kind") === "pdf-group" && input.getAttribute("data-focus-key") === key);
    const coverFilter = document.querySelector("#groups").children.find(button => button.textContent.startsWith("表紙"));
    const coverPdfCheckbox = getPdfGroupCheckbox(coverFilter.getAttribute("data-focus-key"));
    coverPdfCheckbox.checked = true;
    coverPdfCheckbox.dispatch("change");
    assert.equal(document.activeElement.getAttribute("data-focus-kind"), "pdf-group");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");
    assert.equal(document.querySelector("#images").children.length, 4);

    const groups = document.querySelector("#groups");
    const coverButton = groups.children.find(button => button.textContent.startsWith("表紙"));
    coverButton.dispatch("click");
    assert.equal(document.activeElement.getAttribute("data-focus-key"), coverButton.getAttribute("data-focus-key"));
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択・2枚を表示");
    assert.equal(document.querySelector("#images").children.length, 2);

    const coverCheckbox = document.querySelector("#images").children[0].children[1].children[2].children[0].children[0];
    const pdfMark = document.querySelector("#images").children[0].children[1].children[2].children[0].children[1];
    assert.equal(pdfMark.textContent, "PDF");
    assert.equal(pdfMark.getAttribute("aria-hidden"), "true");
    coverCheckbox.checked = false;
    coverCheckbox.dispatch("change");
    assert.equal(document.activeElement.getAttribute("data-focus-action"), "checkbox");
    assert.equal(document.querySelector("#count").textContent, "3 / 4枚を選択・2枚を表示");
    const mixedCoverCheckbox = getPdfGroupCheckbox(coverButton.getAttribute("data-focus-key"));
    assert.equal(mixedCoverCheckbox.indeterminate, true);
    mixedCoverCheckbox.checked = true;
    mixedCoverCheckbox.dispatch("change");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択・2枚を表示");
    assert.equal(document.querySelector("#images").children.length, 2);

    const allButton = groups.children.find(button => button.textContent === "すべて表示");
    allButton.dispatch("click");
    const firstRow = document.querySelector("#images").children[0];
    const firstMoveDown = firstRow.children[1].children[2].children[2];
    const firstUrl = firstRow.children[0].src;
    firstMoveDown.dispatch("click");
    assert.equal(document.activeElement.getAttribute("data-focus-url"), firstUrl);
    assert.equal(document.querySelector("#images").children[1].children[1].children[0].textContent, "2");
    assert.equal(document.querySelector("#images").children[1].children[0].src, firstUrl);
    const secondMoveDown = document.querySelector("#images").children[1].children[1].children[2].children[2];
    secondMoveDown.dispatch("click");
    const terminalMoveDown = document.querySelector("#images").children[2].children[1].children[2].children[2];
    terminalMoveDown.dispatch("click");
    assert.equal(document.activeElement.getAttribute("data-focus-url"), firstUrl);
    assert.equal(document.activeElement.getAttribute("data-focus-action"), "checkbox");

    globalThis.fetch = async () => { throw new Error("test"); };
    document.querySelector("#export").dispatch("click");
    assert.equal(document.querySelector("#status").textContent, "画像を準備しています… 0 / 4");
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    await new Promise(resolve => setImmediate(resolve));

    for (;;) {
      const checkbox = [...document.querySelector("#images").children]
        .map(row => row.children[1].children[2].children[0].children[0])
        .find(input => input.checked);
      if (!checkbox) break;
      checkbox.checked = false;
      checkbox.dispatch("change");
    }
    assert.equal(document.querySelector("#export").disabled, true);
    assert.equal(document.querySelector("#export").textContent, "PDFを保存");
    document.querySelector("#reset").dispatch("click");
    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, "ここに画像が並びます。\n「解析」を押して、画像を集めましょう。");
    resultImages = [];
    globalThis.fetch = previousFetch;
    document.querySelector("#scan").dispatch("click");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, "画像が見つかりませんでした。");
    assert.equal(executionCount, 2);
    assert.deepEqual(createdUrls, []);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.document = previousDocument;
    globalThis.chrome = previousChrome;
    globalThis.window = previousWindow;
  }
});
