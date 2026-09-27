import { defaultSelectedImageGroups, filterImagesByGroup, groupImages, normalizeImageUrls, sortImageUrlsForSite, type ImageGroups, type ImageItem } from "../core/images.js";
import { toPdfPage } from "./pdf-image.js";
import { createPdf, type PdfImagePage } from "../core/pdf.js";

interface PageScan {
  url: string;
  title: string;
  images: string[];
}

const sourceUrl = required<HTMLInputElement>("#source-url");
const scanButton = required<HTMLButtonElement>("#scan");
const exportButton = required<HTMLButtonElement>("#export");
const selectAllButton = required<HTMLButtonElement>("#select-all");
const clearAllButton = required<HTMLButtonElement>("#clear-all");
const resetButton = required<HTMLButtonElement>("#reset");
const completionElement = required<HTMLDivElement>("#completion");
const backToImagesButton = required<HTMLButtonElement>("#back-to-images");
const imagesElement = required<HTMLOListElement>("#images");
const groupsElement = required<HTMLDivElement>("#groups");
const groupSelectionsElement = required<HTMLDivElement>("#group-selections");
const countElement = required<HTMLSpanElement>("#count");
const emptyElement = required<HTMLParagraphElement>("#empty");
const statusElement = required<HTMLParagraphElement>("#status");

let images: ImageItem[] = [];
let pageTitle = "画像";
let activeGroupKey: string | null = null;
let busy = false;
type ScanState = "initial" | "scanning" | "results" | "empty" | "error";
let scanState: ScanState = "initial";

type StatusState = "info" | "busy" | "success" | "error";
type FocusTarget =
  | {kind: "group"; key: string}
  | {kind: "pdf-group"; key: string}
  | {kind: "image"; url: string; action: "checkbox" | "drag"};
let focusTarget: FocusTarget | null = null;
let draggedImage: ImageItem | null = null;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function isWebUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}

function scanDocument(): PageScan {
  const candidates: string[] = [];
  const add = (value: string | null | undefined): void => {
    if (value && !value.startsWith("data:") && !value.startsWith("blob:")) candidates.push(value);
  };
  const lastSrcset = (value: string | null): string | undefined =>
    value?.split(",").map(part => part.trim().split(/\s+/)[0]).filter(Boolean).at(-1);

  for (const img of document.images) {
    add(img.getAttribute("data-original"));
    add(img.getAttribute("data-full"));
    add(img.getAttribute("data-high-res"));
    add(img.getAttribute("data-lib-src"));
    add(img.getAttribute("data-lazyload"));
    add(lastSrcset(img.getAttribute("data-srcset")));
    add(lastSrcset(img.getAttribute("srcset")));
    add(img.getAttribute("data-src"));
    add(img.getAttribute("data-lazy-src"));
    add(img.currentSrc || img.src);
  }
  for (const picture of document.querySelectorAll("picture source")) {
    add(lastSrcset(picture.getAttribute("srcset")));
  }
  for (const meta of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) {
    add(meta.getAttribute("content"));
  }
  for (const match of document.documentElement.outerHTML.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'\\<>]*)?/gi)) {
    add(match[0].replaceAll("&amp;", "&"));
  }
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.href;
    if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(href)) add(href);
  }
  let inspectedBackgrounds = 0;
  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    if (++inspectedBackgrounds > 5000) break;
    const background = getComputedStyle(element).backgroundImage;
    for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g)) add(match[1]);
  }
  return {url: location.href, title: document.title, images: candidates};
}

function setStatus(message: string, state: StatusState = "info"): void {
  statusElement.textContent = message;
  statusElement.dataset["state"] = state;
}

function requestFocus(target: FocusTarget): void { focusTarget = target; }

function restoreFocus(): void {
  const target = focusTarget;
  focusTarget = null;
  if (!target) return;
  for (const element of document.querySelectorAll<HTMLElement>("[data-focus-kind]")) {
    if (element.getAttribute("data-focus-kind") !== target.kind) continue;
    if (target.kind === "group" || target.kind === "pdf-group") {
      if (element.getAttribute("data-focus-key") !== target.key) continue;
    } else if (element.getAttribute("data-focus-url") !== target.url ||
               element.getAttribute("data-focus-action") !== target.action) continue;
    const disabled = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
    if (!disabled || target.kind !== "image" || target.action === "checkbox") {
      element.focus();
      return;
    }
    for (const fallback of document.querySelectorAll<HTMLElement>("[data-focus-kind]")) {
      if (fallback.getAttribute("data-focus-kind") === "image" &&
          fallback.getAttribute("data-focus-url") === target.url &&
          fallback.getAttribute("data-focus-action") === "checkbox") {
        fallback.focus();
        return;
      }
    }
  }
}

function addScan(result: PageScan): void {
  const existing = new Set(images.map(item => item.url));
  for (const url of sortImageUrlsForSite(normalizeImageUrls(result.images, result.url), result.url)) {
    if (existing.has(url)) continue;
    images.push({url, sourcePage: result.url, selected: true});
    existing.add(url);
  }
  render();
}

async function scanTab(tabId: number): Promise<PageScan> {
  const [injection] = await chrome.scripting.executeScript({target: {tabId}, func: scanDocument});
  if (!injection?.result) throw new Error("ページを読み取れませんでした。");
  return injection.result;
}

async function scanUrl(url: string): Promise<PageScan> {
  const tab = await chrome.tabs.create({url, active: false});
  if (tab.id === undefined) throw new Error("指定したページを開けませんでした。");
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("指定したページの読み込みが時間切れになりました。"));
      }, 20000);
      const listener = (tabId: number, change: {status?: string}): void => {
        if (tabId !== tab.id || change.status !== "complete") return;
        window.clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
      void chrome.tabs.get(tab.id!).then(current => {
        if (current.status === "complete") listener(tab.id!, {status: "complete"});
      }).catch(() => undefined);
    });
    return await scanTab(tab.id);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

function setBusy(value: boolean): void {
  busy = value;
  scanButton.disabled = value;
  sourceUrl.disabled = value;
  resetButton.disabled = value;
  exportButton.disabled = value || !images.some(item => item.selected);
  render();
}

async function startScan(): Promise<void> {
  if (busy) return;
  const enteredUrl = sourceUrl.value.trim();
  let targetUrl = "";
  if (enteredUrl) {
    try {
      const parsed = new URL(enteredUrl);
      if (!isWebUrl(parsed.href)) throw new Error();
      targetUrl = parsed.href;
    } catch {
      setStatus("HTTPまたはHTTPSのページURLを入力してください。", "error");
      return;
    }
  }
  images = [];
  activeGroupKey = null;
  scanState = "scanning";
  completionElement.hidden = true;
  setBusy(true);
  setStatus("ページを調べています…", "busy");
  try {
    let result: PageScan;
    if (targetUrl) {
      result = await scanUrl(targetUrl);
    } else {
      const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (activeTab?.id === undefined || !isWebUrl(activeTab.url)) {
        scanState = "error";
        setStatus("開いているWebページを解析できません。URLを指定してください。", "error");
        return;
      }
      result = await scanTab(activeTab.id);
    }
    pageTitle = result.title || "画像";
    addScan(result);
    const grouped = groupImages(images.map(item => item.url));
    const initiallySelected = defaultSelectedImageGroups(grouped);
    for (const [key, group] of Object.entries(grouped)) {
      for (const item of images) if (group.items.includes(item.url)) item.selected = initiallySelected[key] ?? true;
    }
    render();
    scanState = images.length ? "results" : "empty";
    setStatus(images.length ? `${images.length}枚の画像が見つかりました。` : "画像が見つかりませんでした。", images.length ? "success" : "info");
  } catch {
    scanState = "error";
    setStatus("このページを読み取れませんでした。Chromeで開けるWebページを指定してください。", "error");
  } finally {
    setBusy(false);
  }
}

function renderGroups(groups: ImageGroups): void {
  groupsElement.replaceChildren();
  groupsElement.hidden = Object.keys(groups).length === 0;
  if (groupsElement.hidden) return;
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.textContent = "すべて表示";
  allButton.disabled = busy;
  allButton.setAttribute("data-focus-kind", "group");
  allButton.setAttribute("data-focus-key", "all");
  allButton.setAttribute("aria-pressed", String(activeGroupKey === null));
  allButton.addEventListener("click", () => { requestFocus({kind: "group", key: "all"}); activeGroupKey = null; render(); });
  groupsElement.append(allButton);
  for (const [key, group] of Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = group.label;
    button.title = "このまとまりだけを表示する";
    button.disabled = busy;
    button.setAttribute("data-focus-kind", "group");
    button.setAttribute("data-focus-key", key);
    button.setAttribute("aria-pressed", String(activeGroupKey === key));
    button.addEventListener("click", () => { requestFocus({kind: "group", key}); activeGroupKey = key; render(); });
    groupsElement.append(button);
  }
}

function renderGroupSelections(groups: ImageGroups): void {
  groupSelectionsElement.replaceChildren();
  groupSelectionsElement.hidden = Object.keys(groups).length === 0;
  if (groupSelectionsElement.hidden) return;
  for (const [key, group] of Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority)) {
    const urls = new Set(group.items);
    const groupItems = images.filter(item => urls.has(item.url));
    const selectedCount = groupItems.filter(item => item.selected).length;
    const label = document.createElement("label");
    label.className = "group-selection";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = groupItems.length > 0 && selectedCount === groupItems.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < groupItems.length;
    checkbox.disabled = busy;
    checkbox.setAttribute("data-focus-kind", "pdf-group");
    checkbox.setAttribute("data-focus-key", key);
    checkbox.setAttribute("aria-label", `PDFに含める ${group.label}`);
    checkbox.addEventListener("change", () => {
      requestFocus({kind: "pdf-group", key});
      for (const item of groupItems) item.selected = checkbox.checked;
      render();
    });
    const name = document.createElement("span");
    name.textContent = group.label;
    label.append(checkbox, name);
    groupSelectionsElement.append(label);
  }
}

function imageFilename(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || url); }
  catch { return url; }
}

function moveImage(visibleImages: readonly ImageItem[], source: ImageItem, target: ImageItem): void {
  if (busy || source === target) return;
  const reordered = [...visibleImages];
  const from = reordered.indexOf(source);
  const to = reordered.indexOf(target);
  if (from < 0 || to < 0) return;
  reordered.splice(from, 1);
  reordered.splice(to, 0, source);
  const visibleSet = new Set(visibleImages);
  let index = 0;
  images = images.map(item => visibleSet.has(item) ? reordered[index++]! : item);
  requestFocus({kind: "image", url: source.url, action: "drag"});
  render();
}

function renderImages(visibleImages: readonly ImageItem[]): void {
  draggedImage = null;
  imagesElement.replaceChildren();
  const rows = new Map<ImageItem, HTMLLIElement>();
  let previewOrder = [...visibleImages];
  function showInsertion(order: ImageItem[]): void {
    const positions = new Map([...rows].map(([item, row]) => [item, row.getBoundingClientRect()]));
    for (const row of rows.values()) row.getAnimations().forEach(animation => animation.cancel());
    previewOrder = order;
    order.forEach((item, index) => { rows.get(item)!.style.order = String(index); });
    for (const [item, row] of rows) {
      const before = positions.get(item)!;
      const after = row.getBoundingClientRect();
      const x = before.left - after.left;
      const y = before.top - after.top;
      if (item !== draggedImage && (x || y) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        row.animate([{transform: `translate(${x}px, ${y}px)`}, {transform: "translate(0, 0)"}],
          {duration: 180, easing: "ease-out"});
      }
    }
  }
  function previewInsertion(target: ImageItem, event: DragEvent): void {
    if (busy || !draggedImage || draggedImage === target) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const rect = rows.get(target)!.getBoundingClientRect();
    const isSingleColumn = [...rows.values()].every(row => Math.abs(row.getBoundingClientRect().left - rect.left) < 1);
    const after = isSingleColumn ? event.clientY >= rect.top + rect.height / 2 : event.clientX >= rect.left + rect.width / 2;
    const order = previewOrder.filter(item => item !== draggedImage);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, draggedImage);
    if (order.some((item, index) => item !== previewOrder[index])) showInsertion(order);
  }
  function finishDrop(event: DragEvent): void {
    if (!draggedImage || busy) return;
    event.preventDefault();
    const source = draggedImage;
    const visibleSet = new Set(visibleImages);
    let index = 0;
    images = images.map(item => visibleSet.has(item) ? previewOrder[index++]! : item);
    draggedImage = null;
    requestFocus({kind: "image", url: source.url, action: "drag"});
    render();
  }
  imagesElement.ondragover = event => {
    if (!draggedImage || busy) return;
    event.preventDefault();
    // Gaps between grid cells also accept insertion at the nearest thumbnail.
    let nearest: ImageItem | null = null;
    let distance = Infinity;
    for (const [item, row] of rows) {
      const rect = row.getBoundingClientRect();
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      if (dx * dx + dy * dy < distance) { nearest = item; distance = dx * dx + dy * dy; }
    }
    if (nearest) previewInsertion(nearest, event);
  };
  imagesElement.ondrop = finishDrop;
  visibleImages.forEach((item, index) => {
    const overallIndex = images.indexOf(item);
    const row = document.createElement("li");
    rows.set(item, row);
    row.style.order = String(index);
    if (!item.selected) row.classList.add("unselected");
    const preview = document.createElement("img");
    preview.className = "preview";
    preview.src = item.url;
    preview.alt = `画像 ${index + 1}`;
    preview.loading = "lazy";
    preview.referrerPolicy = "no-referrer";
    const body = document.createElement("div");
    body.className = "item-body";
    const order = document.createElement("span");
    order.className = "item-order";
    order.textContent = `${overallIndex + 1}`;
    order.setAttribute("aria-label", `全体の${overallIndex + 1}番目`);
    const name = document.createElement("span");
    name.className = "item-title";
    name.textContent = imageFilename(item.url);
    name.title = item.url;
    const actions = document.createElement("div");
    actions.className = "item-actions";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.selected;
    checkbox.disabled = busy;
    checkbox.setAttribute("data-focus-kind", "image");
    checkbox.setAttribute("data-focus-url", item.url);
    checkbox.setAttribute("data-focus-action", "checkbox");
    checkbox.setAttribute("aria-label", `PDFに含める ${name.textContent}`);
    checkbox.addEventListener("change", () => { requestFocus({kind: "image", url: item.url, action: "checkbox"}); item.selected = checkbox.checked; render(); });
    label.append(checkbox);
    actions.append(label);
    row.draggable = !busy;
    row.tabIndex = 0;
    row.title = "ドラッグで並べ替え（キーボード: Alt + ↑ / ↓）";
    row.setAttribute("data-focus-kind", "image");
    row.setAttribute("data-focus-url", item.url);
    row.setAttribute("data-focus-action", "drag");
    row.setAttribute("aria-label", `${name.textContent}、${overallIndex + 1}番目。ドラッグまたはAltと上下矢印で並べ替え`);
    preview.draggable = false;
    row.addEventListener("dragstart", event => {
      if (busy || (event.target && event.target instanceof Element && event.target.closest(".item-actions"))) {
        event.preventDefault();
        return;
      }
      draggedImage = item;
      if (event.dataTransfer) event.dataTransfer.setDragImage(preview, preview.width / 2, preview.height / 2);
      row.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "harvest-image");
      }
    });
    row.addEventListener("dragover", event => previewInsertion(item, event));
    row.addEventListener("drop", finishDrop);
    row.addEventListener("dragend", () => {
      if (!draggedImage) return;
      draggedImage = null;
      row.classList.remove("dragging");
      showInsertion([...visibleImages]);
    });
    row.addEventListener("keydown", event => {
      if (event.target !== row || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const target = visibleImages[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (target) moveImage(visibleImages, item, target);
    });
    body.append(order, name, actions);
    row.append(preview, body);
    imagesElement.append(row);
  });
}

function render(): void {
  const groups = groupImages(images.map(item => item.url));
  if (activeGroupKey !== null && !groups[activeGroupKey]) activeGroupKey = null;
  const visibleImages = filterImagesByGroup(images, activeGroupKey === null ? null : groups[activeGroupKey]!);
  const selectedCount = images.filter(item => item.selected).length;
  countElement.textContent = `${selectedCount} / ${images.length}枚を選択${activeGroupKey === null ? "" : `・${visibleImages.length}枚を表示`}`;
  exportButton.textContent = selectedCount ? `PDFを保存（${selectedCount}枚）` : "PDFを保存";
  emptyElement.hidden = images.length > 0;
  emptyElement.textContent = scanState === "scanning"
    ? "画像を調べています…"
    : scanState === "empty"
      ? "画像が見つかりませんでした。"
      : scanState === "error"
        ? "解析できませんでした。ページURLを確認して、もう一度お試しください。"
        : "ここに画像が並びます。\n「解析」を押して、画像を集めましょう。";
  selectAllButton.disabled = busy || images.length === 0;
  clearAllButton.disabled = busy || images.length === 0;
  exportButton.disabled = busy || !images.some(item => item.selected);
  renderGroups(groups);
  renderGroupSelections(groups);
  renderImages(visibleImages);
  restoreFocus();
}

async function exportPdf(): Promise<void> {
  const selected = images.filter(item => item.selected);
  if (!selected.length) return;
  setBusy(true);
  const prepared: Array<PdfImagePage | null> = Array(selected.length).fill(null);
  let failed = 0;
  setStatus(`画像を準備しています… 0 / ${selected.length}`, "busy");
  try {
    for (const [index, image] of selected.entries()) {
      try { prepared[index] = await toPdfPage(image.url); }
      catch { failed += 1; }
      setStatus(`画像を準備しています… ${index + 1} / ${selected.length}`, "busy");
    }
    const pages = prepared.filter((page): page is PdfImagePage => page !== null);
    if (!pages.length) throw new Error("画像を取得できませんでした。画像のあるページを開いて再度お試しください。");
    setStatus("PDFを作成しています…", "busy");
    const blob = createPdf(pages);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${pageTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "画像"}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(failed ? `${pages.length}枚を保存しました。${failed}枚は取得できず、PDFに含まれていません。` : `${pages.length}枚のPDFを保存しました。`, "success");
    completionElement.hidden = false;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "PDFを作成できませんでした。", "error");
  } finally {
    setBusy(false);
  }
}

scanButton.addEventListener("click", () => { void startScan(); });
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter") void startScan(); });
document.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("text/uri-list") || event.dataTransfer?.types.includes("text/plain")) event.preventDefault(); });
document.addEventListener("drop", event => {
  if (busy) return;
  const dropped = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain") || "";
  const url = dropped.split(/\r?\n/).find(line => line && !line.startsWith("#"))?.trim();
  if (!url || !isWebUrl(url)) return;
  event.preventDefault();
  sourceUrl.value = url;
  void startScan();
});
exportButton.addEventListener("click", () => { void exportPdf(); });
selectAllButton.addEventListener("click", () => { for (const item of images) item.selected = true; render(); });
clearAllButton.addEventListener("click", () => { for (const item of images) item.selected = false; render(); });
resetButton.addEventListener("click", () => {
  images = [];
  activeGroupKey = null;
  scanState = "initial";
  pageTitle = "画像";
  completionElement.hidden = true;
  setStatus("収集結果を消しました。", "info");
  render();
});
backToImagesButton.addEventListener("click", () => { completionElement.hidden = true; imagesElement.scrollIntoView({block: "start"}); });

render();
