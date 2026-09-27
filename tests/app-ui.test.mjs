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
    this.style = {order: ""};
    this.classList = {add: name => { this.className += this.className ? ` ${name}` : name; }, remove: name => { this.className = this.className.split(" ").filter(value => value !== name).join(" "); }};
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  append(...children) { this.children.push(...children.filter(Boolean)); }
  replaceChildren(...children) { this.children = children.filter(Boolean); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.owner.activeElement = this; }
  scrollIntoView() {}
  getBoundingClientRect() {
    const order = Number(this.style.order || 0);
    return {left: 0, right: 150, top: order * 100, bottom: order * 100 + 100, width: 150, height: 100, x: 0, y: order * 100};
  }
  animate(keyframes, options) {
    this.owner.animations.push({element: this, keyframes, options});
    return {finished: Promise.resolve(), cancel() {}};
  }
  getAnimations() { return []; }
  dispatch(name, event = {}) {
    const dispatched = {preventDefault() {}, ...event};
    this[`on${name}`]?.(dispatched);
    return this.listeners.get(name)?.(dispatched);
  }
}

function descendants(element) {
  return element.children.flatMap(child => child instanceof StubElement ? [child, ...descendants(child)] : []);
}

function visualRows(imagesElement) {
  return [...imagesElement.children].sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
}

test("画像操作後もフォーカス、件数、表示絞り込み、全体順序を保つ", async () => {
  const document = {
    activeElement: null,
    animations: [],
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
    "#completion", "#back-to-images", "#images", "#groups", "#group-selections",
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
  globalThis.window = {setTimeout, clearTimeout, matchMedia: () => ({matches: false})};
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

    const coverRow = document.querySelector("#images").children[0];
    assert.equal(descendants(coverRow).some(element => element.tagName === "input"), false);
    assert.equal(coverRow.getAttribute("aria-pressed"), "true");
    coverRow.dispatch("pointerdown");
    coverRow.dispatch("click");
    assert.equal(document.activeElement.getAttribute("data-focus-action"), "drag");
    assert.equal(document.querySelector("#images").children[0].getAttribute("aria-pressed"), "false");
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
    const firstUrl = firstRow.children[0].src;
    const initialOrder = document.querySelector("#images").children.map(row => row.children[0].src);
    assert.equal(firstRow.draggable, true);
    assert.equal(firstRow.children[0].draggable, false);
    assert.equal(descendants(firstRow).some(element => element.tagName === "button"), false);
    firstRow.dispatch("pointerdown");
    firstRow.dispatch("dragstart");
    assert.equal(firstRow.className.includes("dragging"), true);
    const lastRowBeforeDrop = document.querySelector("#images").children[3];
    lastRowBeforeDrop.dispatch("dragover", {clientX: 75, clientY: 350});
    const imagesElement = document.querySelector("#images");
    assert.deepEqual(imagesElement.children.map(row => row.children[0].src), initialOrder);
    assert.deepEqual(visualRows(imagesElement).map(row => row.children[0].src), [resultImages[1], resultImages[2], resultImages[3], firstUrl]);
    assert.ok(document.animations.length > 0);
    lastRowBeforeDrop.dispatch("drop", {clientX: 75, clientY: 350});
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), [resultImages[1], resultImages[2], resultImages[3], firstUrl]);
    document.querySelector("#images").children[3].dispatch("click");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");
    assert.equal(document.activeElement.getAttribute("data-focus-url"), firstUrl);
    assert.equal(document.activeElement.getAttribute("data-focus-action"), "drag");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");
    const lastRow = document.querySelector("#images").children[3];
    lastRow.dispatch("keydown", {target: lastRow, altKey: true, key: "ArrowUp"});
    assert.equal(document.querySelector("#images").children[2].children[0].src, firstUrl);

    const beforeCancel = document.querySelector("#images").children.map(row => row.children[0].src);
    const cancelSource = document.querySelector("#images").children[1];
    cancelSource.dispatch("dragstart");
    document.querySelector("#images").children[3].dispatch("dragover", {clientX: 75, clientY: 350});
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), beforeCancel);
    cancelSource.dispatch("dragend");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), beforeCancel);
    assert.equal(cancelSource.className.includes("dragging"), false);
    cancelSource.dispatch("click");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");
    cancelSource.dispatch("pointerdown");
    cancelSource.dispatch("click");
    assert.equal(document.querySelector("#count").textContent, "3 / 4枚を選択");
    const keyboardRow = document.querySelector("#images").children[1];
    keyboardRow.dispatch("keydown", {target: keyboardRow, key: " "});
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");

    coverButton.dispatch("click");
    const coverRows = document.querySelector("#images").children;
    const hiddenUrl = resultImages[0];
    assert.equal([...coverRows].some(row => row.children[0].src === hiddenUrl), false);
    coverRows[1].dispatch("dragstart");
    coverRows[0].dispatch("dragover", {clientX: 75, clientY: 25});
    assert.equal(document.querySelector("#status").dataset.state, "success");
    coverRows[0].dispatch("drop", {clientX: 75, clientY: 25});
    allButton.dispatch("click");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), [resultImages[1], resultImages[3], firstUrl, resultImages[2]]);
    const beforeExternalDrop = document.querySelector("#images").children.map(row => row.children[0].src);
    document.querySelector("#images").children[0].dispatch("drop");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), beforeExternalDrop);

    globalThis.fetch = async () => { throw new Error("test"); };
    document.querySelector("#export").dispatch("click");
    assert.equal(document.querySelector("#status").textContent, "画像を準備しています… 0 / 4");
    assert.equal(document.querySelector("#images").children.every(row => !row.draggable), true);
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    document.querySelector("#images").children[0].dispatch("pointerdown");
    document.querySelector("#images").children[0].dispatch("click");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");
    const busyOrder = document.querySelector("#images").children.map(row => row.children[0].src);
    document.querySelector("#images").children[0].dispatch("dragstart");
    document.querySelector("#images").children[1].dispatch("dragover", {clientX: 75, clientY: 150});
    document.querySelector("#images").children[1].dispatch("drop", {clientX: 75, clientY: 150});
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), busyOrder);
    await new Promise(resolve => setImmediate(resolve));

    for (;;) {
      const selectedRow = document.querySelector("#images").children.find(row => row.getAttribute("aria-pressed") === "true");
      if (!selectedRow) break;
      selectedRow.dispatch("pointerdown");
      selectedRow.dispatch("click");
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
