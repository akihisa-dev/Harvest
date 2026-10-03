import assert from "node:assert/strict";
import test from "node:test";
import {ImageCollection} from "../dist/extension/core/image-collection.js";

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
    this.replaceChildrenCalls = 0;
    this.listeners = new Map();
    this.pointerCaptures = new Set();
    this.className = "";
    this.style = {order: ""};
    this.classList = {
      add: name => { this.className += this.className ? ` ${name}` : name; },
      remove: name => { this.className = this.className.split(" ").filter(value => value !== name).join(" "); }
    };
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  append(...children) { this.children.push(...children.filter(Boolean)); }
  replaceChildren(...children) {
    this.replaceChildrenCalls++;
    this.children = children.filter(Boolean);
  }
  remove() {}
  click() { if (this.tagName === "a") this.owner.downloads.push(this.download); }
  getContext() {
    return this.tagName === "canvas"
      ? {
        fillRect() {}, drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray([12, 34, 56, 255])}),
      }
      : null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.owner.activeElement = this; }
  setPointerCapture(pointerId) { this.pointerCaptures.add(pointerId); }
  hasPointerCapture(pointerId) { return this.pointerCaptures.has(pointerId); }
  releasePointerCapture(pointerId) { this.pointerCaptures.delete(pointerId); }
  scrollIntoView() {}
  getBoundingClientRect() {
    this.owner.rectMeasurements = (this.owner.rectMeasurements ?? 0) + 1;
    if (this.owner.rectFor) return this.owner.rectFor(this);
    const order = Number(this.style.order || 0);
    return {left: 0, right: 150, top: order * 100, bottom: order * 100 + 100, width: 150, height: 100, x: 0, y: order * 100};
  }
  animate(keyframes, options) {
    this.owner.animations.push({element: this, keyframes, options});
    return {finished: Promise.resolve(), cancel() {} };
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

function previewUrl(image) {
  return image.dataset.previewUrl ?? image.src;
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
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
    createElementNS(_namespace, tagName) { return new StubElement(tagName, document); },
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
    "#source-url",
    "#scan",
    "#export",
    "#all-visibility",
    "#all-selection",
    "#reset-order",
    "#reset",
    "#failures",
    "#failed-images",
    "#images",
    "#groups",
    "#empty",
    "#empty-logo",
    "#empty-message",
    "#scan-overlay",
    "#url-drop-overlay",
    "#status",
    "#viewer-toggle",
    "#viewer",
    "#viewer-empty",
    "#viewer-page",
    "#viewer-previous",
    "#viewer-position",
    "#viewer-next",
    "#viewer-image",
    "#export-overlay",
    "#viewer-filename",
    "#viewer-thumbnails",
    "#viewer-zoom-in",
    "#viewer-zoom-out",
    "#viewer-zoom-reset",
    "#viewer-stage",
  ])
    document.querySelector(selector);
  for (const format of ["pdf", "jpg", "png", "jxl"]) {
    const option = document.querySelector(`#export-format-${format}`);
    option.value = format;
    option.checked = format === "pdf";
  }
  document.querySelector("#url-drop-overlay").hidden = true;
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
  let scanResultUrl = "https://example.com/view";
  const createdUrls = [];
  globalThis.document = document;
  const {createImageListView} = await import("../dist/extension/app/panel/image-list-view.js");
  const inertPreviewLoader = {set() {}, clearImage() {}, clear() {} };
  globalThis.window = {
    setTimeout: (callback, delay) => setTimeout(callback, delay === 60000 ? 0 : delay),
    clearTimeout,
    matchMedia: () => ({matches: false})
  };
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() {} });
  const measuredCollection = new ImageCollection();
  measuredCollection.replace(Array.from({length: 500}, (_, index) =>
    `https://example.com/pages/${String(index + 1).padStart(4, "0")}.jpg`), "https://example.com/pages/");
  const measuredRows = document.createElement("ol");
  const measuredList = createImageListView({
    collection: measuredCollection,
    allVisibilityButton: document.createElement("button"),
    groupsElement: document.createElement("div"),
    imagesElement: measuredRows,
    isBusy: () => false,
    getFilename: url => url.split("/").pop(),
    previewLoader: inertPreviewLoader,
    onChange() {},
  });
  measuredList.showInitialGroup(null);
  measuredList.render();
  assert.equal(measuredRows.children.length, 500, "measurement fixture contains hundreds of image rows");
  document.rectMeasurements = 0;
  measuredRows.children[250].dispatch("dragstart");
  assert.equal(document.rectMeasurements, 500, "drag start measures each row once");
  const measuredTarget = measuredRows.children[249];
  measuredTarget.dispatch("dragover", {clientX: 75, clientY: 24_925});
  const measurementsAfterLayoutChange = document.rectMeasurements;
  assert.equal(measurementsAfterLayoutChange - 500, 4,
    "an adjacent move measures only the two rows that change slots, before and after animation");
  for (let index = 0; index < 10; index++) {
    measuredTarget.dispatch("dragover", {clientX: 75, clientY: 24_925});
    measuredRows.dispatch("dragover", {clientX: 75, clientY: 24_925});
  }
  assert.equal(document.rectMeasurements, measurementsAfterLayoutChange,
    "repeated dragover events across a 500-row list reuse cached rectangles when order is unchanged");
  measuredRows.children[250].dispatch("dragend");

  const sourceCollection = new ImageCollection();
  const sourceUrls = ["https://example.com/source-test/1.jpg", "https://example.com/source-test/2.jpg"];
  sourceCollection.replace(sourceUrls, "https://example.com/source-test/");
  const sourceRows = document.createElement("ol");
  const sourceList = createImageListView({
    collection: sourceCollection,
    allVisibilityButton: document.createElement("button"),
    groupsElement: document.createElement("div"),
    imagesElement: sourceRows,
    isBusy: () => false,
    getFilename: url => url.split("/").pop(),
    previewLoader: inertPreviewLoader,
    onChange() {},
  });
  sourceList.showInitialGroup(null);
  const sourcePreview = url => ({url, selected: false});
  sourceList.render(new Set(), sourcePreview("data:image/svg+xml,source-one"));
  const sourceImageRows = [...sourceRows.children];
  const sourceRow = sourceRows.children[2];
  const sourceListReplacements = sourceRows.replaceChildrenCalls;
  sourceCollection.toggleSelected(sourceUrls[0]);
  sourceList.render(new Set(), sourcePreview("data:image/svg+xml,source-two"));
  assert.equal(sourceRows.replaceChildrenCalls, sourceListReplacements,
    "a selection update with Source preview does not replace list children");
  assert.equal(sourceRows.children[0], sourceImageRows[0], "the first image row remains mounted");
  assert.equal(sourceRows.children[1], sourceImageRows[1], "the second image row remains mounted");
  assert.equal(sourceRows.children[2], sourceRow, "the Source row is reused");
  assert.equal(sourceRow.children[0].getAttribute("src"), "data:image/svg+xml,source-two", "the reused Source preview follows content updates");

  document.rectFor = element => {
    const order = Number(element.style.order || 0);
    const left = order % 2 * 200;
    const top = Math.floor(order / 2) * 100;
    return {left, right: left + 150, top, bottom: top + 100, width: 150, height: 100, x: left, y: top};
  };
  const gridCollection = new ImageCollection();
  const gridUrls = Array.from({length: 4}, (_, index) => `https://example.com/pages/grid-${index + 1}.jpg`);
  gridCollection.replace(gridUrls, "https://example.com/pages/");
  const gridRows = document.createElement("ol");
  const gridList = createImageListView({
    collection: gridCollection,
    allVisibilityButton: document.createElement("button"),
    groupsElement: document.createElement("div"),
    imagesElement: gridRows,
    isBusy: () => false,
    getFilename: url => url.split("/").pop(),
    previewLoader: inertPreviewLoader,
    onChange() {},
  });
  gridList.showInitialGroup(null);
  gridList.render();
  gridRows.children[0].dispatch("dragstart");
  gridRows.children[1].dispatch("dragover", {clientX: 300, clientY: 25});
  gridRows.children[1].dispatch("drop");
  assert.deepEqual(gridCollection.items.map(item => item.url), [gridUrls[1], gridUrls[0], gridUrls[2], gridUrls[3]],
    "multi-column drag placement uses the horizontal pointer position");
  document.rectFor = undefined;

  let connected;
  let capturedMessage;
  let disconnected;
  const port = {
    name: "",
    sender: {tab: {id: 7}},
    postMessage() {},
    disconnect() { disconnected?.(); },
    onMessage: {addListener(listener) { capturedMessage = listener; } },
    onDisconnect: {addListener(listener) { disconnected = listener; } }
  };
  globalThis.chrome = {
    windows: {
      create: async ({url}) => {
        createdUrls.push(url);
        return {id: 17, tabs: [{id: 8, url}]};
      },
      remove: async () => {},
    },
    i18n: {getUILanguage: () => "ja"},
    runtime: {onConnect: {addListener(listener) { connected = listener; } }},
    tabs: {
      query: async () => [{id: 7, url: "https://example.com/view"}],
      create: async ({url}) => {
        createdUrls.push(url);
        return {id: 8, url};
      },
      get: async () => ({status: "complete"}),
      remove: async () => {},
      onUpdated: {addListener() {}, removeListener() {} },
      onRemoved: {addListener() {}, removeListener() {} },
    },
    scripting: {
      executeScript: async (injection) => {
        if (injection.args) {
          port.name = injection.args[0];
          connected(port);
          return [{result: undefined}];
        }
        if (rejectScan) throw new Error("scan failed");
        executionCount += 1;
        return [{
          result: {
            url: scanResultUrl,
            title: "ページ",
            links: [{url: "https://example.com/pages/gallery", label: "一覧"}],
            images: resultImages,
          }
        }];
      }
    },
  };
  try {
    await import(`../dist/extension/app/index.js?ui=${Date.now()}`);
    const includeSourcePage = document.querySelector("#include-source-page");
    assert.equal(includeSourcePage.checked, true, "保存済みの設定を再び開いたパネルへ反映する");
    const exportFormat = document.querySelector("#export-format-pdf");
    const exportFormats = ["pdf", "jpg", "png", "jxl"].map(format => document.querySelector(`#export-format-${format}`));
    const sourcePageOption = document.querySelector(".source-page-option");
    assert.equal(exportFormats.filter(option => option.checked).length, 1, "保存形式は1つだけ選択する");
    assert.equal(exportFormat.checked, true, "初回は既存どおりPDFを選ぶ");
    const changeExportFormat = format => {
      for (const option of exportFormats) option.checked = option.value === format;
      document.querySelector(`#export-format-${format}`).dispatch("change");
    };
    changeExportFormat("jxl");
    assert.equal(savedPreferences.get("harvest.exportFormat"), "jxl", "保存形式だけをブラウザー内に記録する");
    assert.equal(sourcePageOption.hidden, true, "出典ページ設定は画像形式では隠す");
    assert.equal(includeSourcePage.checked, true, "保存形式を変えてもPDFの出典設定を保つ");
    changeExportFormat("pdf");
    assert.equal(sourcePageOption.hidden, false, "PDFへ戻すと出典ページ設定を再表示する");
    includeSourcePage.checked = false;
    includeSourcePage.dispatch("change");
    assert.equal(savedPreferences.get("harvest.includeSourcePage"), "false");
    includeSourcePage.checked = true;
    includeSourcePage.dispatch("change");
    assert.equal(savedPreferences.get("harvest.includeSourcePage"), "true");
    includeSourcePage.checked = false;
    includeSourcePage.dispatch("change");
    const sourceDrop = document.querySelector("#source-drop");
    const urlDropOverlay = document.querySelector("#url-drop-overlay");
    const pageUrlDrag = {
      types: ["text/uri-list"],
      getData: type => type === "text/uri-list" ? "https://example.com/dropped" : "",
    };
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true);
    assert.equal(urlDropOverlay.hidden, false, "初回操作前は画面全体の案内を表示する");
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    assert.equal(urlDropOverlay.hidden, true, "ドラッグが外れたら案内を消す");
    const header = document.querySelector(".app-header");
    const sourceUrl = document.querySelector("#source-url");
    sourceUrl.value = "https://example.com/entered";
    sourceUrl.dispatch("input");
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true, "URL入力後も画面下部で受け付ける");
    assert.equal(urlDropOverlay.hidden, false);
    assert.equal(document.dispatch("dragover", {target: document.querySelector("#empty"), dataTransfer: pageUrlDrag}).prevented, true, "URL入力後も中央の空白領域で受け付ける");
    assert.equal(document.dispatch("dragover", {target: header, dataTransfer: pageUrlDrag}).prevented, true, "URL入力後は上部全体で受け付ける");
    assert.equal(urlDropOverlay.hidden, false, "どの場所でも同じ画面全体の案内を表示する");
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    sourceUrl.value = "";
    sourceUrl.dispatch("input");
    const collection = document.querySelector("#collection-toggle");
    collection.dispatch("click");
    await waitUntil(() => capturedMessage);
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true);
    assert.equal(urlDropOverlay.hidden, false, "収集中も画面全体の案内を表示する");
    assert.equal(document.dispatch("dragover", {target: sourceDrop, dataTransfer: pageUrlDrag}).prevented, true);
    assert.equal(urlDropOverlay.hidden, false, "URL欄でも個別の案内に切り替わらない");
    assert.equal(sourceDrop.className.includes("drag-over"), false);
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    assert.equal(collection.getAttribute("aria-pressed"), "true");
    assert.equal(createdUrls.length, 0, "開始時には解析しない");
    capturedMessage({url: "https://example.com/linked"});
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.equal(createdUrls.at(-1), "https://example.com/linked");
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true, "解析後も画面下部で受け付ける");
    assert.equal(document.dispatch("dragover", {target: document.querySelector("#viewer"), dataTransfer: pageUrlDrag}).prevented, true, "解析後も中央の表示領域で受け付ける");
    assert.equal(document.dispatch("dragover", {target: header, dataTransfer: pageUrlDrag}).prevented, true, "解析後は上部全体で受け付ける");
    assert.equal(document.dispatch("dragover", {target: document.querySelector(".workspace-sidebar"), dataTransfer: pageUrlDrag}).prevented, true, "解析後は右の操作欄でも受け付ける");
    assert.equal(urlDropOverlay.hidden, false);
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    globalThis.fetch = async () => new Response(new Uint8Array([1]), {headers: {"Content-Type": "image/png"}});
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
    assert.equal(sourceDrop.textContent, "ページ.pdf", "保存後の再解析失敗でも旧結果のファイル名を表示する");
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
    assert.equal(urlDropOverlay.hidden, false);
    document.dispatch("dragleave", {dataTransfer: pageUrlDrag});
    const empty = document.querySelector("#empty");
    const emptyLogo = document.querySelector("#empty-logo");
    const emptyMessage = document.querySelector("#empty-message");
    const exportButton = document.querySelector("#export");
    assert.equal(exportButton.dataset.saving, "false", "通常時は保存中の表示を出さない");
    assert.equal(emptyLogo.hidden, false);
    assert.equal(emptyMessage.hidden, false, "空状態のライブ領域を維持して文言の出入りを連続化する");

    const scanOverlay = document.querySelector("#scan-overlay");
    const scanButton = document.querySelector("#scan");
    const exportOverlay = document.querySelector("#export-overlay");
    assert.equal(exportOverlay.hidden, true, "PDF保存前はビュアーのオーバーレイを隠す");
    assert.equal(scanButton.textContent, "解析", "通常時は解析ボタンに文字を表示する");
    const thumbnailsBeforeScan = document.querySelector("#images").children.map(row => previewUrl(row.children[0]));
    scanButton.dispatch("click");
    assert.equal(scanButton.dataset.scanning, "true", "解析中はボタンのロード表示を有効にする");
    assert.equal(scanButton.textContent, "解析", "解析中も同じラベルを保持し、見た目だけ処理中へ移す");
    assert.equal(scanButton.getAttribute("aria-label"), "ページを調べています…", "解析中のボタンには読み上げ名を残す");
    assert.equal(scanOverlay.hidden, false, "既存画像を表示中でも解析リングを重ねる");
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), thumbnailsBeforeScan, "解析中も既存画像を保持する");
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    assert.equal(document.querySelector("#status").textContent, "", "解析中は状態文を画面に出さない");
    assert.equal(document.querySelector("#status").getAttribute("aria-label"), "ページを調べています…", "解析中の状態文は読み上げ用に残す");
    assert.equal(empty.dataset.state, "scanning");
    assert.equal(emptyLogo.getAttribute("aria-hidden"), "true", "解析中のロゴは読み上げ対象から外す");
    assert.equal(emptyMessage.textContent, "", "解析中は案内文を空にする");
    assert.equal(emptyMessage.getAttribute("aria-label"), "ページを調べています…", "空状態の読み上げ文は解析開始と同時に更新する");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(empty.hidden, true);
    assert.equal(scanOverlay.hidden, true, "解析完了後はリングを隠す");
    assert.equal(scanButton.dataset.scanning, "false", "解析完了後はボタンのロード表示を消す");
    assert.equal(scanButton.textContent, "解析", "解析完了後はボタンの文字を戻す");
    assert.equal(scanButton.getAttribute("aria-label"), null, "解析完了後は通常のボタン名に戻す");
    assert.equal(document.querySelector("#status").textContent, "");
    assert.equal(document.querySelector("#images").children.length, 2);
    assert.equal(document.querySelector("#groups").children[0].children[0].textContent, "シリーズ\nJPG\n(2枚)");
    const retainedRows = document.querySelector("#images").children.slice();
    sourceUrl.value = "https://example.com/new-page";
    sourceUrl.dispatch("input");
    sourceUrl.dispatch("blur");
    assert.equal(sourceDrop.textContent, "ページ.pdf", "入力だけで表示中の結果のファイル名を変更しない");
    rejectScan = true;
    scanButton.dispatch("click");
    await waitUntil(() => !scanButton.disabled);
    assert.equal(sourceDrop.textContent, "ページ.pdf", "再解析失敗時も旧結果のファイル名を表示する");
    assert.equal(sourceUrl.value, "https://example.com/new-page", "再試行用の入力を保持する");
    assert.deepEqual(document.querySelector("#images").children, retainedRows, "失敗時は旧結果と順序を保持する");
    rejectScan = false;
    scanResultUrl = "https://example.com/new-page";
    scanButton.dispatch("click");
    await waitUntil(() => !scanButton.disabled);
    assert.equal(sourceDrop.textContent, "ページ.pdf", "成功時に結果とファイル名表示を同時に切り替える");
    scanResultUrl = "https://example.com/view";
    sourceUrl.value = "";
    scanButton.dispatch("click");
    await waitUntil(() => !scanButton.disabled);
    const orderBeforeFormatChange = document.querySelector("#images").children.map(row => previewUrl(row.children[0]));
    const selectionBeforeFormatChange = document.querySelector("#images").children.map(row => row.getAttribute("aria-pressed"));
    exportFormat.value = "png";
    exportFormat.dispatch("change");
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), orderBeforeFormatChange);
    assert.deepEqual(document.querySelector("#images").children.map(row => row.getAttribute("aria-pressed")), selectionBeforeFormatChange);
    exportFormat.value = "pdf";
    exportFormat.dispatch("change");
    document.querySelector("#all-visibility").dispatch("click");
    assert.equal(document.querySelector("#export").textContent, "PDFを保存");
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
    assert.equal(viewerToggle.getAttribute("aria-pressed"), "false", "解析後は画像一覧を初期表示する");
    assert.equal(viewer.hidden, true);
    assert.equal(document.querySelector(".results").hidden, false);
    viewerToggle.dispatch("click");
    assert.equal(viewerToggle.getAttribute("aria-pressed"), "true", "ボタンでビュアーに切り替えられる");
    assert.equal(viewer.hidden, false);
    assert.equal(document.querySelector(".results").hidden, true);
    assert.equal(viewerPage.hidden, false);
    assert.equal(viewerEmpty.hidden, true);
    assert.equal(previewUrl(viewerImage), resultImages[0]);
    assert.equal(viewerPosition.textContent, "1 / 2");
    assert.equal(viewerThumbnails.children.length, 2);
    includeSourcePage.checked = true;
    includeSourcePage.dispatch("change");
    assert.equal(viewerThumbnails.children.length, 3, "オンならSourceページを末尾へ表示する");
    assert.equal(document.querySelector("#images").children.at(-1).className, "source-preview");
    const sourceThumbnail = viewerThumbnails.children[2].children[0];
    sourceThumbnail.dispatch("click");
    assert.equal(viewerPosition.textContent, "3 / 3");
    assert.equal(viewerNext.disabled, true);
    const sourceSvg = decodeURIComponent(previewUrl(viewerImage).split(",")[1]);
    assert.match(sourceSvg, /Source/);
    assert.match(sourceSvg, /ページ\.pdf/);
    assert.match(sourceSvg, /https:\/\/example.com\/view/);
    const {createSourcePageLayout} = await import("../dist/extension/core/pdf.js");
    const sourceLayout = createSourcePageLayout({
      heading: "Source",
      filename: "ページ.pdf",
      url: "https://example.com/view",
    });
    const previewLines = [...sourceSvg.matchAll(
      /<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"(?: textLength="([^"]+)" lengthAdjust="spacingAndGlyphs")? xml:space="preserve">([^<]*)<\/text>/g,
    )].map(([, x, y, size, width, text]) => ({
      x: Number(x),
      y: Number(y),
      size: Number(size),
      width: width === undefined ? null : Number(width),
      text,
    }));
    assert.deepEqual(previewLines, sourceLayout.lines.map(line => ({
      x: Number(line.x.toFixed(3)),
      y: Number((sourceLayout.height - line.y).toFixed(3)),
      size: line.size,
      width: line.text ? Number(line.width.toFixed(3)) : null,
      text: line.text,
    })), "SVG preview positions, sizes, widths, and line breaks match the core layout result");
    includeSourcePage.checked = false;
    includeSourcePage.dispatch("change");
    assert.equal(viewerThumbnails.children.length, 2, "オフならSourceページを除去する");
    assert.equal(viewerPosition.textContent, "1 / 2");
    const firstThumbnail = descendants(viewerThumbnails).find(element => element.tagName === "button");
    assert.ok(firstThumbnail);
    assert.equal(viewerPrevious.disabled, true);
    assert.equal(viewerNext.disabled, false);
    viewerNext.dispatch("click");
    assert.equal(previewUrl(viewerImage), resultImages[1]);
    assert.equal(viewerPosition.textContent, "2 / 2");
    assert.equal(viewerPrevious.disabled, false);
    assert.equal(viewerNext.disabled, true);
    descendants(viewerThumbnails).filter(element => element.tagName === "button")[0].dispatch("click");
    assert.equal(previewUrl(viewerImage), resultImages[0]);
    assert.equal(viewerPosition.textContent, "1 / 2");
    viewerThumbnails.dispatch("wheel", {deltaY: 120, deltaX: 0, timeStamp: 1000});
    assert.equal(previewUrl(viewerImage), resultImages[1], "一覧のスクロールで次の画像を表示する");
    assert.equal(viewerPosition.textContent, "2 / 2");
    assert.equal(viewerThumbnails.children[1].children[0].getAttribute("aria-current"), "true");
    viewerThumbnails.dispatch("wheel", {deltaY: 600, deltaX: 0, timeStamp: 1050});
    assert.equal(viewerPosition.textContent, "2 / 2", "連続したスクロールでは画像を飛ばさない");
    viewerThumbnails.dispatch("wheel", {deltaY: -120, deltaX: 0, timeStamp: 1300});
    assert.equal(previewUrl(viewerImage), resultImages[0], "逆方向のスクロールで前の画像を表示する");
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
    assert.equal(viewerStage.hasPointerCapture(1), false, "pointerupでキャプチャを解除する");
    assert.notEqual(viewerImage.style.transform, wheeledTransform);
    viewerZoomReset.dispatch("click");
    assert.match(viewerImage.style.transform, /scale\(1\)/);
    assert.equal(viewerZoomReset.textContent, "100%");
    viewerZoomOut.dispatch("click");
    assert.match(viewerImage.style.transform, /scale\(1\)/);
    viewerPrevious.dispatch("click");
    assert.equal(previewUrl(viewerImage), resultImages[0]);
    assert.equal(viewerPosition.textContent, "1 / 2");
    assert.equal(viewerPrevious.disabled, true);
    assert.equal(viewerNext.disabled, false);

    viewerZoomIn.dispatch("click");
    viewerStage.dispatch("pointerdown", {clientX: 20, clientY: 30, pointerId: 2});
    assert.equal(viewerStage.hasPointerCapture(2), true);
    assert.equal(viewerStage.dataset.panning, "true");
    viewerNext.dispatch("click");
    assert.equal(viewerStage.hasPointerCapture(2), false, "画像切替時にキャプチャを解除する");
    assert.equal(viewerStage.dataset.panning, undefined, "画像切替時にパン表示を解除する");

    const allSelection = document.querySelector("#all-selection");
    allSelection.checked = false;
    allSelection.dispatch("change");
    assert.equal(viewerEmpty.hidden, false);
    assert.equal(viewerPage.hidden, true);
    assert.equal(viewerPosition.textContent, "");
    allSelection.checked = true;
    allSelection.dispatch("change");
    assert.equal(viewerEmpty.hidden, true);
    assert.equal(viewerPage.hidden, false);
    assert.equal(previewUrl(viewerImage), resultImages[0]);
    assert.equal(viewerPosition.textContent, "1 / 4");
    viewerToggle.dispatch("click");
    assert.equal(viewer.hidden, true);
    assert.equal(document.querySelector(".results").hidden, false);

    const getPdfGroupCheckbox = key => descendants(document.querySelector("#groups"))
      .find(input => input.getAttribute("data-focus-kind") === "pdf-group" && input.getAttribute("data-focus-key") === key);
    const groupChips = document.querySelector("#groups").children.filter(element => element.className === "group-chip");
    assert.ok(groupChips.length > 0);
    assert.ok(groupChips.some(chip => /^シリーズ\nJPG\n\(\d+枚\)$/.test(chip.children[0].textContent)), "シリーズ名、ファイル種類、枚数を三行に分ける");
    assert.equal(groupChips.every(chip => chip.children.length === 3 && chip.children[0].tagName === "span" && chip.children[1].tagName === "button" && chip.children[2].children[0].tagName === "input"), true);
    const groupButton = prefix => groupChips.find(chip => chip.children[0].textContent.startsWith(prefix))?.children[1];
    const coverFilter = groupButton("表紙");
    const coverPdfCheckbox = getPdfGroupCheckbox(coverFilter.getAttribute("data-focus-key"));
    assert.match(coverPdfCheckbox.getAttribute("aria-label"), /保存対象に含める JPG · 表紙/);
    coverPdfCheckbox.checked = true;
    coverPdfCheckbox.dispatch("change");
    assert.equal(document.activeElement.getAttribute("data-focus-kind"), "pdf-group");
    assert.equal(document.querySelector("#images").children.length, 4);

    const groups = document.querySelector("#groups");
    const coverButton = groupButton("表紙");
    groupButton("シリーズ").dispatch("click");
    assert.equal(document.activeElement.getAttribute("data-focus-kind"), "group");
    assert.equal(document.querySelector("#images").children.length, 2);

    const coverRow = document.querySelector("#images").children[0];
    assert.equal(descendants(coverRow).some(element => element.tagName === "input"), false);
    assert.equal(coverRow.getAttribute("aria-pressed"), "true");
    coverRow.dispatch("pointerdown");
    coverRow.dispatch("click");
    assert.equal(document.activeElement.getAttribute("data-focus-action"), "drag");
    assert.equal(document.querySelector("#images").children[0].getAttribute("aria-pressed"), "false");
    const mixedCoverCheckbox = getPdfGroupCheckbox(coverButton.getAttribute("data-focus-key"));
    assert.equal(mixedCoverCheckbox.indeterminate, true);
    mixedCoverCheckbox.checked = true;
    mixedCoverCheckbox.dispatch("change");
    assert.equal(document.querySelector("#images").children.length, 2);

    const allButton = document.querySelector("#all-visibility");
    const retainedEye = allButton.children[0];
    const retainedSlash = retainedEye.children[3];
    allButton.dispatch("click");
    assert.equal(allButton.children[0], retainedEye, "表示切替でも同じ目の要素を保持する");
    assert.equal(retainedEye.children[3], retainedSlash, "斜線を作り直さず表示状態だけ変える");
    assert.equal(allButton.dataset.shown, allButton.getAttribute("aria-pressed"));
    const firstRow = document.querySelector("#images").children[0];
    const firstUrl = previewUrl(firstRow.children[0]);
    const initialOrder = document.querySelector("#images").children.map(row => previewUrl(row.children[0]));
    assert.equal(firstRow.draggable, true);
    assert.equal(firstRow.children[0].draggable, false);
    assert.equal(descendants(firstRow).some(element => element.tagName === "button"), false);
    firstRow.dispatch("pointerdown");
    firstRow.dispatch("dragstart");
    assert.equal(firstRow.className.includes("dragging"), true);
    const lastRowBeforeDrop = document.querySelector("#images").children[3];
    lastRowBeforeDrop.dispatch("dragover", {clientX: 75, clientY: 350});
    const imagesElement = document.querySelector("#images");
    assert.deepEqual(imagesElement.children.map(row => previewUrl(row.children[0])), initialOrder);
    assert.deepEqual(visualRows(imagesElement).map(row => previewUrl(row.children[0])), [resultImages[1], resultImages[2], resultImages[3], firstUrl]);
    assert.ok(document.animations.length > 0);
    lastRowBeforeDrop.dispatch("drop", {clientX: 75, clientY: 350});
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), [resultImages[1], resultImages[2], resultImages[3], firstUrl]);
    assert.equal(resetOrder.disabled, false);
    document.querySelector("#images").children[3].dispatch("click");
    assert.equal(document.activeElement.getAttribute("data-focus-url"), firstUrl);
    assert.equal(document.activeElement.getAttribute("data-focus-action"), "drag");
    const lastRow = document.querySelector("#images").children[3];
    lastRow.dispatch("keydown", {target: lastRow, altKey: true, key: "ArrowUp"});
    assert.equal(previewUrl(document.querySelector("#images").children[2].children[0]), firstUrl);

    const beforeCancel = document.querySelector("#images").children.map(row => previewUrl(row.children[0]));
    const cancelSource = document.querySelector("#images").children[1];
    cancelSource.dispatch("dragstart");
    document.querySelector("#images").children[3].dispatch("dragover", {clientX: 75, clientY: 350});
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), beforeCancel);
    cancelSource.dispatch("dragend");
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), beforeCancel);
    assert.equal(cancelSource.className.includes("dragging"), false);
    cancelSource.dispatch("click");
    cancelSource.dispatch("pointerdown");
    cancelSource.dispatch("click");
    const keyboardRow = document.querySelector("#images").children[1];
    keyboardRow.dispatch("keydown", {target: keyboardRow, key: " "});

    groupButton("シリーズ").dispatch("click");
    const coverRows = document.querySelector("#images").children;
    const hiddenUrl = resultImages[0];
    assert.equal([...coverRows].some(row => previewUrl(row.children[0]) === hiddenUrl), false);
    coverRows[1].dispatch("dragstart");
    coverRows[0].dispatch("dragover", {clientX: 75, clientY: 25});
    assert.equal(document.querySelector("#status").textContent, "");
    coverRows[0].dispatch("drop", {clientX: 75, clientY: 25});
    allButton.dispatch("click");
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), [resultImages[1], resultImages[3], firstUrl, resultImages[2]]);
    const beforeExternalDrop = document.querySelector("#images").children.map(row => previewUrl(row.children[0]));
    document.querySelector("#images").children[0].dispatch("drop");
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), beforeExternalDrop);

    const failedUrl = resultImages[0];
    const fetches = [];
    let failOnce = true;
    let releaseFailedFetch;
    const failedFetchGate = new Promise(resolve => { releaseFailedFetch = resolve; });
    document.querySelector("#source-url").value = "https://example.com/next";
    document.querySelector("#source-url").dispatch("input");
    globalThis.fetch = async url => {
      fetches.push(url);
      if (url === failedUrl && failOnce) {
        await failedFetchGate;
        throw new Error("test");
      }
      return new Response(new Uint8Array([1]), {headers: {"Content-Type": "image/png"}});
    };
    document.querySelector("#export").dispatch("click");
    assert.equal(exportButton.dataset.saving, "true", "PDF保存中はボタンにロードマークを出す");
    assert.equal(exportButton.textContent, "0 / 4", "保存中はボタンに処理済み枚数と対象枚数を表示する");
    assert.equal(exportButton.getAttribute("aria-label"), "画像を準備しています… 0 / 4 もう一度押すと保存を中止します", "保存中のボタンは進捗と中止方法を読み上げられる");
    assert.equal(exportOverlay.hidden, false, "PDF保存中はビュアーにオーバーレイを重ねる");
    assert.equal(exportButton.disabled, false, "保存中も再クリックで中止できる");
    assert.equal(document.querySelector("#status").textContent, "0 / 4", "PDF作成中も枚数の進捗を画面に表示する");
    assert.equal(document.querySelector("#status").getAttribute("aria-label"), "画像を準備しています… 0 / 4", "PDF作成の状態と進捗を読み上げ用に残す");
    assert.equal(document.querySelector("#images").children.every(row => !row.draggable), true);
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    assert.equal(resetOrder.disabled, true);
    document.querySelector("#images").children[0].dispatch("pointerdown");
    document.querySelector("#images").children[0].dispatch("click");
    const busyOrder = document.querySelector("#images").children.map(row => previewUrl(row.children[0]));
    document.querySelector("#images").children[0].dispatch("dragstart");
    document.querySelector("#images").children[1].dispatch("dragover", {clientX: 75, clientY: 150});
    document.querySelector("#images").children[1].dispatch("drop", {clientX: 75, clientY: 150});
    assert.equal(document.querySelector("#status").dataset.state, "busy");
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), busyOrder);
    await waitUntil(() => exportButton.textContent === "2 / 4");
    assert.equal(exportButton.getAttribute("aria-label"), "画像を準備しています… 2 / 4 もう一度押すと保存を中止します", "処理に合わせて進捗と中止方法が更新される");
    releaseFailedFetch();
    await waitUntil(() => document.querySelector("#failures").hidden === false);
    assert.equal(exportButton.dataset.saving, "false", "保存失敗後はロードマークを消す");
    assert.equal(exportButton.getAttribute("aria-label"), null, "保存失敗後は通常のボタン名に戻す");
    assert.equal(exportOverlay.hidden, true, "保存失敗後はビュアーのオーバーレイを消す");
    assert.equal(document.downloads.length, 0);
    assert.equal(document.querySelector("#source-url").value, "https://example.com/next", "保存失敗時は再試行のためURLを残す");
    assert.equal(document.querySelector("#failures").hidden, false);
    assert.deepEqual(document.querySelector("#failed-images").children.map(row => row.textContent), ["3番 001.jpg — 画像を取得できませんでした。通信状態と画像URLを確認してください。"]);
    assert.equal(document.querySelector("#export").textContent, "失敗分を再試行");
    assert.equal(document.querySelector("#images").children.find(row => previewUrl(row.children[0]) === failedUrl).className.includes("failed"), true);
    // Failed re-analysis must preserve both the user's work and prepared PDF pages.
    rejectScan = true;
    document.querySelector("#scan").dispatch("click");
    document.querySelector("#reset").dispatch("click");
    allSelection.checked = false;
    allSelection.dispatch("change");
    document.querySelector("#images").children[0].dispatch("keydown", {altKey: true, key: "ArrowDown"});
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), busyOrder);
    assert.match(document.querySelector("#status").textContent, /前の収集結果を保持/);
    assert.equal(document.querySelector("#status").title, document.querySelector("#status").textContent, "画面で省略された状態文も全文を確認できる");
    assert.equal(document.querySelector("#export").textContent, "失敗分を再試行");
    rejectScan = false;
    failOnce = false;
    createdUrls.length = 0;
    document.querySelector("#export").dispatch("click");
    assert.equal(exportButton.dataset.saving, "true", "再試行中もロードマークを出す");
    assert.equal(exportButton.textContent, "0 / 1", "再試行中は残り枚数に対する進捗を表示する");
    assert.equal(exportOverlay.hidden, false, "再試行中もビュアーにオーバーレイを重ねる");
    await waitUntil(() => document.downloads.length === 1);
    await waitUntil(() => exportButton.dataset.saving === "false");
    assert.equal(exportButton.textContent, "4件保存しました", "保存完了は保存件数とともに保存ボタン内へ表示する");
    assert.equal(exportButton.dataset.saved, "true", "保存完了状態を保存ボタンへ設定する");
    assert.equal(exportOverlay.hidden, true, "保存開始後はビュアーのオーバーレイを消す");
    assert.equal(fetches.at(-1), failedUrl, "再試行では失敗した画像を取得する");
    assert.equal(fetches.every(url => busyOrder.includes(url)), true, "プレビューと保存は一覧にある画像だけを取得する");
    assert.equal(fetches.filter(url => url === failedUrl).length >= 2, true, "失敗画像は保存の再試行で再取得する");
    assert.deepEqual(document.downloads, ["ページ.pdf"]);
    assert.equal(document.querySelector("#failures").hidden, true);
    assert.equal(document.querySelector("#status").dataset.state, "success");
    assert.equal(document.querySelector("#status").textContent, "", "保存完了文はビュアー欄の状態表示に出さない");
    assert.equal(document.querySelector("#status").title, "", "保存完了文をビュアー欄のツールチップにも出さない");
    assert.equal(document.querySelector("#source-url").value, "", "再試行後に保存できたらURLを消す");
    assert.equal(includeSourcePage.checked, false, "PDF保存後も出典ページの設定を保つ");
    assert.equal(document.querySelector("#source-drop").dataset.hasUrl, "false");

    const completedDownloadCount = document.downloads.length;
    let cancelledFetches = 0;
    globalThis.fetch = async (_url, options) => {
      cancelledFetches += 1;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), {once: true}));
    };
    exportButton.dispatch("click");
    await waitUntil(() => cancelledFetches > 0);
    const cancelProgress = exportButton.textContent;
    assert.match(cancelProgress, /^\d+ \/ \d+$/);
    assert.equal(exportButton.disabled, false, "PDF保存中のボタンは中止操作を受け付ける");
    exportButton.dispatch("click");
    assert.equal(exportButton.textContent, cancelProgress, "再クリック後も中止処理が終わるまで進捗を保つ");
    assert.equal(exportButton.getAttribute("aria-label"), `画像を準備しています… ${cancelProgress} もう一度押すと保存を中止します`);
    await waitUntil(() => exportButton.dataset.saving === "false");
    assert.equal(document.downloads.length, completedDownloadCount, "中止したPDFをダウンロードしない");
    assert.equal(document.querySelector("#status").dataset.state, "info", "中止は失敗ではなく案内として表示する");

    globalThis.fetch = async () => new Response(new Uint8Array([1]), {headers: {"Content-Type": "image/png"}});
    exportButton.dispatch("click");
    await waitUntil(() => document.downloads.length === completedDownloadCount + 1);
    await waitUntil(() => exportButton.dataset.saving === "false");
    assert.equal(document.downloads.at(-1), "ページ.pdf", "中止後にPDFを最初から保存できる");

    includeSourcePage.checked = true;
    includeSourcePage.dispatch("change");
    assert.equal(exportButton.dataset.saved, "false", "保存後に出典ページを追加すると保存完了状態を外す");
    includeSourcePage.checked = false;
    includeSourcePage.dispatch("change");
    assert.equal(exportButton.dataset.saved, "true", "元の出典ページ設定へ戻すと保存済み状態へ戻る");
    const savedSelection = document.querySelector("#images").children.find(row => row.getAttribute("aria-pressed") === "true");
    savedSelection.dispatch("pointerdown");
    savedSelection.dispatch("click");
    assert.equal(exportButton.dataset.saved, "false", "保存対象が変わったら保存完了状態を外す");
    assert.equal(exportButton.textContent, "PDFを保存", "保存対象が変わったら保存操作を表示する");
    savedSelection.dispatch("pointerdown");
    savedSelection.dispatch("click");
    rejectScan = true;
    document.querySelector("#scan").dispatch("click");
    await waitUntil(() => !document.querySelector("#scan").disabled);
    rejectScan = false;

    groupButton("シリーズ").dispatch("click");
    resetOrder.dispatch("click");
    assert.equal(resetOrder.disabled, true);
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), resultImages.slice(2));
    allButton.dispatch("click");
    assert.deepEqual(document.querySelector("#images").children.map(row => previewUrl(row.children[0])), resultImages);

    // Reusing a row after a successful scan of the same URLs must target the new items.
    document.querySelector("#scan").dispatch("click");
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.equal(document.querySelector("#images").children.length, 2);
    assert.equal(document.querySelector("#groups").children[0].children[0].textContent, "シリーズ\nJPG\n(2枚)");
    document.querySelector("#all-visibility").dispatch("click");
    const rescannedRow = document.querySelector("#images").children[0];
    rescannedRow.dispatch("pointerdown");
    rescannedRow.dispatch("click");

    for (; ;) {
      const selectedRow = document.querySelector("#images").children.find(row => row.getAttribute("aria-pressed") === "true");
      if (!selectedRow) break;
      selectedRow.dispatch("pointerdown");
      selectedRow.dispatch("click");
    }
    assert.equal(document.querySelector("#export").disabled, true);
    assert.equal(document.querySelector("#export").textContent, "保存");
    document.querySelector("#reset").dispatch("click");
    assert.equal(empty.hidden, false);
    assert.equal(document.querySelector("#status").textContent, "");
    assert.equal(emptyLogo.hidden, false);
    assert.equal(emptyMessage.hidden, false);
    resultImages = [];
    globalThis.fetch = previousFetch;
    document.querySelector("#scan").dispatch("click");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(empty.hidden, false);
    assert.equal(emptyLogo.getAttribute("aria-hidden"), "true");
    assert.equal(emptyMessage.getAttribute("aria-label"), "画像が見つかりませんでした。");
    assert.equal(executionCount, 5);
    assert.deepEqual(createdUrls, []);
    assert.equal(document.dispatch("dragover", {target: document.body, dataTransfer: pageUrlDrag}).prevented, true, "解析結果が空なら画面全体で受け付ける");
    sourceUrl.value = "https://example.com/entered";
    sourceUrl.dispatch("input");
    document.dispatch("drop", {target: document.querySelector(".workspace-sidebar"), dataTransfer: pageUrlDrag});
    assert.equal(urlDropOverlay.hidden, true, "ドロップ後は画面全体の案内を消す");
    await waitUntil(() => !document.querySelector("#scan").disabled);
    assert.deepEqual(createdUrls, ["https://example.com/dropped"], "URL入力済みでも右の操作欄へのドロップで解析する");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.localStorage = previousLocalStorage;
    globalThis.document = previousDocument;
    globalThis.chrome = previousChrome;
    globalThis.window = previousWindow;
  }
});
