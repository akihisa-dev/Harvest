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

function visualRows(imagesElement) {
  return [...imagesElement.children].sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail("処理が完了しませんでした");
}

test("画像操作と失敗画像の再試行で選択順序とPDFの完全性を保つ", async () => {
  const document = {
    activeElement: null,
    animations: [],
    downloads: [],
    elements: new Map(),
    listeners: new Map(),
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
    addEventListener(name, callback) { document.listeners.set(name, callback); },
    dispatch(name, event = {}) {
      let prevented = false;
      const dispatched = {preventDefault() { prevented = true; }, target: document.body, ...event};
      document.listeners.get(name)?.(dispatched);
      return {prevented, event: dispatched};
    },
  };
  document.body = new StubElement("body", document);
  for (const selector of [
    "#source-url", "#scan", "#export", "#select-all", "#clear-all", "#reset-order", "#reset",
    "#completion", "#back-to-images", "#failures", "#failed-images", "#images", "#groups",
    "#count", "#empty", "#status", "#viewer-toggle", "#viewer", "#viewer-empty",
    "#viewer-page", "#viewer-previous", "#viewer-position", "#viewer-next", "#viewer-image",
    "#viewer-filename", "#viewer-thumbnails", "#viewer-zoom-in", "#viewer-zoom-out",
    "#viewer-zoom-reset", "#viewer-stage",
  ]) document.querySelector(selector);
  const previousDocument = globalThis.document;
  const previousChrome = globalThis.chrome;
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousLocalStorage = globalThis.localStorage;
  const savedPreferences = new Map([["harvest.includeSourcePage", "true"]]);
  globalThis.localStorage = {
    getItem: key => savedPreferences.get(key) ?? null,
    setItem: (key, value) => { savedPreferences.set(key, value); },
  };
  let resultImages = [
    "https://example.com/pages/001.jpg",
    "https://example.com/pages/002.jpg",
    "https://example.com/cover/001.jpg",
    "https://example.com/cover/002.jpg",
  ];
  let executionCount = 0;
  let rejectScan = false;
  const createdUrls = [];
  globalThis.document = document;
  globalThis.window = {setTimeout: (callback, delay) => setTimeout(callback, delay === 60000 ? 0 : delay), clearTimeout, matchMedia: () => ({matches: false})};
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() {}});
  let connected;
  let capturedMessage;
  let disconnected;
  const port = {name: "", sender: {tab: {id: 7}}, postMessage() {}, disconnect() { disconnected?.(); }, onMessage: {addListener(listener) { capturedMessage = listener; }}, onDisconnect: {addListener(listener) { disconnected = listener; }}};
  globalThis.chrome = {
    windows: {
      create: async ({url}) => { createdUrls.push(url); return {id: 17, tabs: [{id: 8, url}]}; },
      remove: async () => {},
    },
    i18n: {getUILanguage: () => "ja"},
    runtime: {onConnect: {addListener(listener) { connected = listener; }}},
    tabs: {
      query: async () => [{id: 7, url: "https://example.com/view"}],
      create: async ({url}) => { createdUrls.push(url); return {id: 8, url}; },
      get: async () => ({status: "complete"}),
      remove: async () => {},
      onUpdated: {addListener() {}, removeListener() {}},
      onRemoved: {addListener() {}, removeListener() {}},
    },
    scripting: {executeScript: async (injection) => {
      if (injection.args) { port.name = injection.args[0]; connected(port); return [{result: undefined}]; }
      if (rejectScan) throw new Error("scan failed");
      executionCount += 1;
      return [{result: {
        url: "https://example.com/view", title: "ページ",
        links: [{url: "https://example.com/pages/gallery", label: "一覧"}],
        images: resultImages,
      }}];
    }},
  };
  try {
    await import(`../dist/extension/app/index.js?ui=${Date.now()}`);
    const includeSourcePage = document.querySelector("#include-source-page");
    assert.equal(includeSourcePage.checked, true, "保存済みの設定を再び開いたパネルへ反映する");
    includeSourcePage.checked = false;
    includeSourcePage.dispatch("change");
    assert.equal(savedPreferences.get("harvest.includeSourcePage"), "false");
    includeSourcePage.checked = true;
    includeSourcePage.dispatch("change");
    assert.equal(savedPreferences.get("harvest.includeSourcePage"), "true");
    const sourceDrop = document.querySelector("#source-drop");
    const pageUrlDrag = {
      types: ["text/uri-list"],
      getData: type => type === "text/uri-list" ? "https://example.com/dropped" : "",
    };
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true);
    assert.equal(document.body.className.includes("page-drop-ready"), true, "初回操作前は画面全体でURLを受け付ける");
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    const header = document.querySelector(".app-header");
    const sourceUrl = document.querySelector("#source-url");
    sourceUrl.value = "https://example.com/entered";
    sourceUrl.dispatch("input");
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, false, "URL入力後は画面下部で受け付けない");
    assert.equal(document.dispatch("dragover", {target: header, dataTransfer: pageUrlDrag}).prevented, true, "URL入力後は上部全体で受け付ける");
    assert.equal(header.className.includes("drag-over"), true);
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    sourceUrl.value = "";
    sourceUrl.dispatch("input");
    const collection = document.querySelector("#collection-toggle");
    collection.dispatch("click");
    await waitUntil(() => capturedMessage);
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true);
    assert.equal(document.body.className.includes("page-drop-ready"), true, "収集中でもURLと解析結果が空なら画面全体で受け付ける");
    assert.equal(document.dispatch("dragover", {target: sourceDrop, dataTransfer: pageUrlDrag}).prevented, true);
    assert.equal(sourceDrop.className.includes("drag-over"), true, "収集開始後もURL欄はドロップ先になる");
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    assert.equal(collection.getAttribute("aria-pressed"), "true");
    assert.equal(createdUrls.length, 0, "開始時には解析しない");
    capturedMessage({url: "https://example.com/linked"});
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.equal(createdUrls.at(-1), "https://example.com/linked");
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, false, "解析後は画面下部で受け付けない");
    assert.equal(document.dispatch("dragover", {target: header, dataTransfer: pageUrlDrag}).prevented, true, "解析後は上部全体で受け付ける");
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    globalThis.fetch = async () => ({ok: true, blob: async () => new Blob([new Uint8Array([1])], {type: "image/png"})});
    const scansBeforePdf = executionCount;
    capturedMessage({url: "https://example.com/linked"});
    capturedMessage({url: "https://example.com/linked"});
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.equal(document.downloads.length, 1, "同じリンクの再クリックはPDF保存し、処理中の連打は無視する");
    assert.equal(executionCount, scansBeforePdf, "PDF保存では再解析しない");
    assert.equal(document.querySelector("#source-url").value, "", "保存成功時は入力したURLを消す");
    assert.equal(document.querySelector("#source-drop").dataset.hasUrl, "false");
    document.downloads.length = 0;
    rejectScan = true;
    capturedMessage({url: "https://example.com/failed"});
    await waitUntil(() => !document.querySelector("#scan").disabled);
    const failedScanTabs = createdUrls.length;
    capturedMessage({url: "https://example.com/failed"});
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.equal(createdUrls.length, failedScanTabs + 1, "解析失敗後は同じリンクでも解析を再試行");
    assert.equal(document.downloads.length, 0);
    rejectScan = false;
    collection.dispatch("click");
    assert.equal(collection.getAttribute("aria-pressed"), "false");
    const scansAfterStop = executionCount;
    capturedMessage({url: "https://example.com/ignored"});
    assert.equal(executionCount, scansAfterStop);
    createdUrls.length = 0;
    executionCount = 0;
    assert.equal(document.querySelector("#source-url").value, "https://example.com/failed");
    document.querySelector("#reset").dispatch("click");
    assert.equal(document.querySelector("#source-url").value, "", "クリア時は入力したURLを消す");
    assert.equal(document.querySelector("#source-drop").dataset.hasUrl, "false");
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true, "クリア後は画面全体のドロップ受付に戻る");
    assert.equal(document.dispatch("dragover", {target: sourceDrop, dataTransfer: pageUrlDrag}).prevented, true);
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    const empty = document.querySelector("#empty");
    assert.equal(empty.textContent, "ここに画像が並びます。\n「解析」を押して、画像を集めましょう。");

    document.querySelector("#scan").dispatch("click");
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    assert.equal(empty.textContent, "画像を調べています…");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(empty.hidden, true);
    assert.equal(document.querySelector("#status").textContent, "");
    assert.equal(document.querySelector("#count").textContent, "2 / 4枚を選択・2枚を表示");
    assert.equal(document.querySelector("#images").children.length, 2);
    assert.equal(descendants(document.querySelector("#groups")).find(button => button.getAttribute("aria-pressed") === "true").textContent, "シリーズ (2枚)");
    document.querySelector("#groups").children.find(button => button.textContent === "すべて表示").dispatch("click");
    assert.equal(document.querySelector("#export").textContent, "PDFを保存（2枚）");
    const resetOrder = document.querySelector("#reset-order");
    assert.equal(resetOrder.disabled, true);

    const viewerToggle = document.querySelector("#viewer-toggle");
    const viewer = document.querySelector("#viewer");
    const viewerEmpty = document.querySelector("#viewer-empty");
    const viewerPage = document.querySelector("#viewer-page");
    const viewerPrevious = document.querySelector("#viewer-previous");
    const viewerNext = document.querySelector("#viewer-next");
    const viewerPosition = document.querySelector("#viewer-position");
    const viewerImage = document.querySelector("#viewer-image");
    const viewerThumbnails = document.querySelector("#viewer-thumbnails");
    const viewerZoomIn = document.querySelector("#viewer-zoom-in");
    const viewerZoomOut = document.querySelector("#viewer-zoom-out");
    const viewerZoomReset = document.querySelector("#viewer-zoom-reset");
    const viewerStage = document.querySelector("#viewer-stage");
    assert.equal(viewerToggle.disabled, false);
    viewerToggle.dispatch("click");
    assert.equal(viewer.hidden, false);
    assert.equal(document.querySelector(".results").hidden, true);
    assert.equal(viewerPage.hidden, false);
    assert.equal(viewerEmpty.hidden, true);
    assert.equal(viewerImage.src, resultImages[0]);
    assert.equal(viewerPosition.textContent, "1 / 2");
    assert.equal(viewerThumbnails.children.length, 2);
    const firstThumbnail = descendants(viewerThumbnails).find(element => element.tagName === "button");
    assert.ok(firstThumbnail);
    assert.equal(viewerPrevious.disabled, true);
    assert.equal(viewerNext.disabled, false);
    viewerNext.dispatch("click");
    assert.equal(viewerImage.src, resultImages[1]);
    assert.equal(viewerPosition.textContent, "2 / 2");
    assert.equal(viewerPrevious.disabled, false);
    assert.equal(viewerNext.disabled, true);
    descendants(viewerThumbnails).filter(element => element.tagName === "button")[0].dispatch("click");
    assert.equal(viewerImage.src, resultImages[0]);
    assert.equal(viewerPosition.textContent, "1 / 2");

    const initialTransform = viewerImage.style.transform;
    viewerZoomIn.dispatch("click");
    const zoomedTransform = viewerImage.style.transform;
    assert.notEqual(zoomedTransform, initialTransform);
    assert.match(zoomedTransform, /scale\(/);
    viewerStage.dispatch("wheel", {deltaY: -120});
    assert.notEqual(viewerImage.style.transform, zoomedTransform);
    const wheeledTransform = viewerImage.style.transform;
    viewerStage.dispatch("pointerdown", {clientX: 20, clientY: 30, pointerId: 1});
    viewerStage.dispatch("pointermove", {clientX: 60, clientY: 80, pointerId: 1});
    viewerStage.dispatch("pointerup", {clientX: 60, clientY: 80, pointerId: 1});
    assert.notEqual(viewerImage.style.transform, wheeledTransform);
    viewerZoomReset.dispatch("click");
    assert.match(viewerImage.style.transform, /scale\(1\)/);
    assert.equal(viewerZoomReset.textContent, "100%");
    viewerZoomOut.dispatch("click");
    assert.match(viewerImage.style.transform, /scale\(1\)/);
    viewerPrevious.dispatch("click");
    assert.equal(viewerImage.src, resultImages[0]);
    assert.equal(viewerPosition.textContent, "1 / 2");
    assert.equal(viewerPrevious.disabled, true);
    assert.equal(viewerNext.disabled, false);

    document.querySelector("#clear-all").dispatch("click");
    assert.equal(viewerEmpty.hidden, false);
    assert.equal(viewerPage.hidden, true);
    assert.equal(viewerPosition.textContent, "");
    document.querySelector("#select-all").dispatch("click");
    assert.equal(viewerEmpty.hidden, true);
    assert.equal(viewerPage.hidden, false);
    assert.equal(viewerImage.src, resultImages[0]);
    assert.equal(viewerPosition.textContent, "1 / 4");
    viewerToggle.dispatch("click");
    assert.equal(viewer.hidden, true);
    assert.equal(document.querySelector(".results").hidden, false);

    const getPdfGroupCheckbox = key => descendants(document.querySelector("#groups"))
      .find(input => input.getAttribute("data-focus-kind") === "pdf-group" && input.getAttribute("data-focus-key") === key);
    const groupChips = document.querySelector("#groups").children.filter(element => element.className === "group-chip");
    assert.ok(groupChips.length > 0);
    assert.equal(groupChips.every(chip => chip.children.length === 2 && chip.children[0].tagName === "button" && chip.children[1].tagName === "input"), true);
    const coverFilter = descendants(document.querySelector("#groups")).find(button => button.tagName === "button" && button.textContent.startsWith("表紙"));
    const coverPdfCheckbox = getPdfGroupCheckbox(coverFilter.getAttribute("data-focus-key"));
    assert.match(coverPdfCheckbox.getAttribute("aria-label"), /PDFに含める 表紙/);
    coverPdfCheckbox.checked = true;
    coverPdfCheckbox.dispatch("change");
    assert.equal(document.activeElement.getAttribute("data-focus-kind"), "pdf-group");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");
    assert.equal(document.querySelector("#images").children.length, 4);

    const groups = document.querySelector("#groups");
    const coverButton = descendants(groups).find(button => button.tagName === "button" && button.textContent.startsWith("表紙"));
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
    assert.equal(resetOrder.disabled, false);
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
    assert.equal(document.querySelector("#status").textContent, "");
    coverRows[0].dispatch("drop", {clientX: 75, clientY: 25});
    allButton.dispatch("click");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), [resultImages[1], resultImages[3], firstUrl, resultImages[2]]);
    const beforeExternalDrop = document.querySelector("#images").children.map(row => row.children[0].src);
    document.querySelector("#images").children[0].dispatch("drop");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), beforeExternalDrop);

    const failedUrl = resultImages[0];
    const fetches = [];
    let failOnce = true;
    document.querySelector("#source-url").value = "https://example.com/next";
    document.querySelector("#source-url").dispatch("input");
    globalThis.fetch = async url => {
      fetches.push(url);
      if (url === failedUrl && failOnce) throw new Error("test");
      return {ok: true, blob: async () => new Blob([new Uint8Array([1])], {type: "image/png"})};
    };
    document.querySelector("#export").dispatch("click");
    assert.equal(document.querySelector("#status").textContent, "画像を準備しています… 0 / 4");
    assert.equal(document.querySelector("#images").children.every(row => !row.draggable), true);
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    assert.equal(resetOrder.disabled, true);
    document.querySelector("#images").children[0].dispatch("pointerdown");
    document.querySelector("#images").children[0].dispatch("click");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");
    const busyOrder = document.querySelector("#images").children.map(row => row.children[0].src);
    document.querySelector("#images").children[0].dispatch("dragstart");
    document.querySelector("#images").children[1].dispatch("dragover", {clientX: 75, clientY: 150});
    document.querySelector("#images").children[1].dispatch("drop", {clientX: 75, clientY: 150});
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), busyOrder);
    await waitUntil(() => document.querySelector("#failures").hidden === false);
    assert.equal(document.downloads.length, 0);
    assert.equal(document.querySelector("#source-url").value, "https://example.com/next", "保存失敗時は再試行のためURLを残す");
    assert.equal(document.querySelector("#failures").hidden, false);
    assert.deepEqual(document.querySelector("#failed-images").children.map(row => row.textContent), ["3番 001.jpg — 画像を取得できませんでした。通信状態と画像URLを確認してください。"]);
    assert.equal(document.querySelector("#export").textContent, "失敗した1枚を再試行");
    assert.equal(document.querySelector("#images").children.find(row => row.children[0].src === failedUrl).className.includes("failed"), true);
    // Failed re-analysis must preserve both the user's work and prepared PDF pages.
    rejectScan = true;
    document.querySelector("#scan").dispatch("click");
    document.querySelector("#reset").dispatch("click");
    document.querySelector("#clear-all").dispatch("click");
    document.querySelector("#images").children[0].dispatch("keydown", {altKey: true, key: "ArrowDown"});
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), busyOrder);
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択");
    assert.match(document.querySelector("#status").textContent, /前の収集結果を保持/);
    assert.equal(document.querySelector("#export").textContent, "失敗した1枚を再試行");
    rejectScan = false;
    failOnce = false;
    createdUrls.length = 0;
    document.querySelector("#export").dispatch("click");
    await waitUntil(() => document.downloads.length === 1);
    assert.deepEqual(fetches, [...busyOrder, failedUrl]);
    assert.deepEqual(document.downloads, ["ページ.pdf"]);
    assert.equal(document.querySelector("#failures").hidden, true);
    assert.equal(document.querySelector("#status").dataset.state, "success");
    assert.equal(document.querySelector("#source-url").value, "", "再試行後に保存できたらURLを消す");
    assert.equal(includeSourcePage.checked, true, "PDF保存後も出典ページの設定を保つ");
    assert.equal(document.querySelector("#source-drop").dataset.hasUrl, "false");

    coverButton.dispatch("click");
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択・2枚を表示");
    resetOrder.dispatch("click");
    assert.equal(resetOrder.disabled, true);
    assert.equal(document.querySelector("#count").textContent, "4 / 4枚を選択・2枚を表示");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), resultImages.slice(2));
    allButton.dispatch("click");
    assert.deepEqual(document.querySelector("#images").children.map(row => row.children[0].src), resultImages);

    // Reusing a row after a successful scan of the same URLs must target the new items.
    document.querySelector("#scan").dispatch("click");
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.equal(document.querySelector("#count").textContent, "2 / 4枚を選択・2枚を表示");
    assert.equal(document.querySelector("#images").children.length, 2);
    assert.equal(descendants(document.querySelector("#groups")).find(button => button.getAttribute("aria-pressed") === "true").textContent, "シリーズ (2枚)");
    document.querySelector("#groups").children.find(button => button.textContent === "すべて表示").dispatch("click");
    const rescannedRow = document.querySelector("#images").children[0];
    rescannedRow.dispatch("pointerdown");
    rescannedRow.dispatch("click");
    assert.equal(document.querySelector("#count").textContent, "1 / 4枚を選択");

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
    assert.equal(document.querySelector("#status").textContent, "");
    assert.equal(empty.textContent, "ここに画像が並びます。\n「解析」を押して、画像を集めましょう。");
    resultImages = [];
    globalThis.fetch = previousFetch;
    document.querySelector("#scan").dispatch("click");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, "画像が見つかりませんでした。");
    assert.equal(executionCount, 3);
    assert.deepEqual(createdUrls, []);
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true, "解析結果が空なら画面全体で受け付ける");
    sourceUrl.value = "https://example.com/entered";
    sourceUrl.dispatch("input");
    document.dispatch("drop", {target: document.body, dataTransfer: pageUrlDrag});
    assert.deepEqual(createdUrls, [], "URL入力済みなら画面下部へのドロップでは解析しない");
    document.dispatch("drop", {target: header, dataTransfer: pageUrlDrag});
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.deepEqual(createdUrls, ["https://example.com/dropped"], "URL入力済みなら上部全体へのドロップで解析する");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.localStorage = previousLocalStorage;
    globalThis.document = previousDocument;
    globalThis.chrome = previousChrome;
    globalThis.window = previousWindow;
  }
});
