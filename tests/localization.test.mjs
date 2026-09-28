import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

function installLocalizationEnvironment(language) {
  const previous = {document: globalThis.document, chrome: globalThis.chrome};
  globalThis.document = {
    documentElement: {setAttribute() {}},
    body: {dataset: {}},
    querySelectorAll() { return []; },
  };
  globalThis.chrome = {i18n: {getUILanguage: () => language}};
  return () => Object.assign(globalThis, previous);
}

test("辞書は英語と日本語で同じキーを持ち、HTMLの静的キーを網羅する", async () => {
  const restore = installLocalizationEnvironment("en-US");
  try {
    const localization = await import(`../dist/extension/app/localization.js?keys=${Date.now()}`);
    assert.equal(localization.uiLanguage, "en");
    assert.deepEqual(Object.keys(localization.translations.en).sort(), Object.keys(localization.translations.ja).sort());
    const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
    const keys = [...html.matchAll(/\bdata-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(match => match[1]);
    for (const key of keys) assert.ok(localization.translationKeys.includes(key), `辞書にないHTMLキー: ${key}`);
    for (const value of Object.values(localization.translations.en)) {
      assert.doesNotMatch(value, /[ぁ-んァ-ヶ一-龯]/u);
    }
  } finally {
    restore();
  }
});

test("英語ではグループ名・既知エラーが英語になり、サイト値はそのまま扱える", async () => {
  const restore = installLocalizationEnvironment("en");
  try {
    const localization = await import(`../dist/extension/app/localization.js?values=${Date.now()}`);
    assert.equal(localization.formatGroupLabel("シリーズ (2枚)"), "Series (2 images)");
    assert.equal(localization.formatGroupLabel("表紙・サムネイル (1枚)"), "Cover / thumbnail (1 image)");
    assert.equal(localization.formatFailedAria(false), " ");
    assert.equal(localization.formatFailedAria(true), " Retrieval failed. ");
    assert.equal(localization.localizeErrorMessage("画像が見つかりませんでした。"), "The image was not found.");
    assert.equal(localization.localizeErrorMessage("ページを読み取れませんでした。"), "Could not read the page.");
    assert.equal(localization.localizeErrorMessage("The open page cannot be analyzed. Specify a URL.", "errorPageRead", true), "The open page cannot be analyzed. Specify a URL.");
    assert.equal(localization.localizeErrorMessage("internal detail", "errorPdfCreate", true), "Could not create the PDF.");
    assert.equal(localization.t("imageRowAria", {filename: "ページ画像.jpg", index: 1, failed: ""}), "ページ画像.jpg, number 1. Click to select for the PDF, drag or use Alt and the arrow keys to reorder");
    assert.equal(localization.t("sourceHeading"), "Source");
  } finally {
    restore();
  }
});

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
  remove() {}
  click() { if (this.tagName === "a") this.owner.downloads.push(this.download); }
  getContext() { return this.tagName === "canvas" ? {
    fillRect() {}, drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray([12, 34, 56, 255])}),
  } : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.owner.activeElement = this; }
  setPointerCapture() {}
  releasePointerCapture() {}
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
    const dispatched = {preventDefault() {}, target: this, currentTarget: this, ...event};
    this[`on${name}`]?.(dispatched);
    return this.listeners.get(name)?.(dispatched);
  }
}

function descendants(element) {
  return element.children.flatMap(child => child instanceof StubElement ? [child, ...descendants(child)] : []);
}


test("英語画面で解析・分類・選択・エラー表示が翻訳され、取得元の名前は保つ", async () => {
  const previous = {document: globalThis.document, chrome: globalThis.chrome, window: globalThis.window};
  const root = {
    activeElement: null, animations: [], downloads: [], elements: new Map(),
    createElement(tag) { return new StubElement(tag, root); },
    createElementNS(_namespace, tag) { return new StubElement(tag, root); },
    createTextNode(textContent) { return {textContent}; },
    querySelector(selector) {
      if (!this.elements.has(selector)) this.elements.set(selector, new StubElement("div", root));
      return this.elements.get(selector);
    },
    querySelectorAll(selector) {
      const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1];
      return [...this.elements.values()].flatMap(element => [element, ...descendants(element)])
        .filter(element => attribute && element.getAttribute(attribute) !== null);
    },
    addEventListener() {},
  };
  root.body = new StubElement("body", root);
  root.documentElement = new StubElement("html", root);
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  for (const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)) {
    const element = root.querySelector(`#${match[1]}`);
    for (const attribute of match[0].matchAll(/(data-i18n(?:-[a-z-]+)?)="([^"]+)"/g)) {
      element.setAttribute(attribute[1], attribute[2]);
      if (attribute[1] === "data-i18n") element.dataset.i18n = attribute[2];
    }
  }
  let fail = false;
  globalThis.document = root;
  globalThis.window = {setTimeout, clearTimeout, matchMedia: () => ({matches: true})};
  globalThis.chrome = {
    i18n: {getUILanguage: () => "en-US"},
    runtime: {onConnect: {addListener() {}}},
    tabs: {
      query: async () => [{id: 7, url: "https://example.com/view"}],
      get: async () => ({status: "complete"}),
      onUpdated: {addListener() {}, removeListener() {}},
      onRemoved: {addListener() {}, removeListener() {}},
    },
    scripting: {executeScript: async () => {
      if (fail) throw new Error("ページを読み取れませんでした。");
      return [{result: {url: "https://example.com/view", title: "元のページ名", images: [
        "https://example.com/pages/001.jpg", "https://example.com/pages/002.jpg",
      ]}}];
    }},
  };
  const waitForScan = async () => {
    for (let attempt = 0; attempt < 100 && root.querySelector("#scan").disabled; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(root.querySelector("#scan").disabled, false);
  };
  try {
    await import(`../dist/extension/app/index.js?english=${Date.now()}`);
    assert.equal(root.documentElement.getAttribute("lang"), "en");
    assert.equal(root.querySelector("#scan").textContent, "Analyze");
    assert.equal(root.querySelector("#source-url").getAttribute("placeholder"), "Enter a page URL");
    assert.equal(root.querySelector("#reset").getAttribute("aria-label"), "Clear the collected results and selection");
    root.querySelector("#scan").dispatch("click");
    await waitForScan();
    assert.ok(descendants(root.querySelector("#groups")).some(button => button.textContent === "Series\n(2 images)"));
    assert.equal(root.querySelector("#export").textContent, "Save PDF (2 images)");
    assert.equal((await import(`../dist/extension/app/localization.js?source=${Date.now()}`)).t("includeSourcePage"), "Add a source page at the end");
    const row = root.querySelector("#images").children[0];
    assert.match(row.getAttribute("aria-label"), /^001.jpg, number 1/);
    assert.equal(row.dataset.dropLabel, "Move here");
    assert.equal(root.querySelector("#viewer-toggle").getAttribute("aria-pressed"), "true");
    assert.equal(root.querySelector("#viewer-image").alt, "Selected image 1");
    assert.match(root.querySelector("#viewer-thumbnails").children[0].children[0].getAttribute("aria-label"), /001.jpg/);
    fail = true;
    root.querySelector("#scan").dispatch("click");
    await waitForScan();
    assert.equal(root.querySelector("#status").textContent, "Could not read this page. The previous collection is being kept.");
    assert.equal(root.querySelector("#images").children.length, 2);
  } finally {
    Object.assign(globalThis, previous);
  }
});
