import { defaultDisplayedImageGroup, defaultSelectedImageGroups, filterImagesByGroup, groupImages, normalizeImageUrls, sortImageUrlsForSite, type ImageGroups, type ImageItem } from "../core/images.js";
import { captureCollectionLinks } from "./collection-mode.js";
import { scanTab, scanUrl } from "./page-access.js";
import { preparePdfImages, PdfImageError } from "./pdf-image.js";
import { createPdf, type PdfImagePage } from "../core/pdf.js";
import { animateLayoutChange, prefersReducedMotion, reconcileKeyedChildren, setMotionText } from "./motion.js";

const sourceUrl = required<HTMLInputElement>("#source-url");
const sourceDrop = required<HTMLButtonElement>("#source-drop");
const collectionButton = required<HTMLButtonElement>("#collection-toggle");
const scanButton = required<HTMLButtonElement>("#scan");
const exportButton = required<HTMLButtonElement>("#export");
const viewerToggleButton = required<HTMLButtonElement>("#viewer-toggle");
const viewerElement = required<HTMLElement>("#viewer");
const resultsElement = required<HTMLElement>(".results");
const viewerEmptyElement = required<HTMLParagraphElement>("#viewer-empty");
const viewerPageElement = required<HTMLDivElement>("#viewer-page");
const viewerPreviousButton = required<HTMLButtonElement>("#viewer-previous");
const viewerNextButton = required<HTMLButtonElement>("#viewer-next");
const viewerPositionElement = required<HTMLSpanElement>("#viewer-position");
const viewerStageElement = required<HTMLDivElement>("#viewer-stage");
const viewerImageElement = required<HTMLImageElement>("#viewer-image");
const viewerFilenameElement = required<HTMLParagraphElement>("#viewer-filename");
const viewerThumbnailsElement = required<HTMLOListElement>("#viewer-thumbnails");
const viewerZoomInButton = required<HTMLButtonElement>("#viewer-zoom-in");
const viewerZoomOutButton = required<HTMLButtonElement>("#viewer-zoom-out");
const viewerZoomResetButton = required<HTMLButtonElement>("#viewer-zoom-reset");
const selectAllButton = required<HTMLButtonElement>("#select-all");
const clearAllButton = required<HTMLButtonElement>("#clear-all");
const resetOrderButton = required<HTMLButtonElement>("#reset-order");
const resetButton = required<HTMLButtonElement>("#reset");
const completionElement = required<HTMLDivElement>("#completion");
const failuresElement = required<HTMLElement>("#failures");
const failedImagesElement = required<HTMLUListElement>("#failed-images");
const backToImagesButton = required<HTMLButtonElement>("#back-to-images");
const imagesElement = required<HTMLOListElement>("#images");
const groupsElement = required<HTMLDivElement>("#groups");
const groupSelectionsElement = required<HTMLDivElement>("#group-selections");
const countElement = required<HTMLSpanElement>("#count");
const emptyElement = required<HTMLParagraphElement>("#empty");
const statusElement = required<HTMLParagraphElement>("#status");

let images: ImageItem[] = [];
let initialImageOrder: ImageItem[] = [];
let pageTitle = "画像";
let activeGroupKey: string | null = null;
let viewerMode = false;
let viewerImageUrl: string | null = null;
let renderedViewerImageUrl: string | null = null;
let viewerZoom = 1;
let viewerPanX = 0;
let viewerPanY = 0;
let viewerPointer: {id: number; x: number; y: number; panX: number; panY: number} | null = null;
const viewerThumbRows = new Map<string, HTMLLIElement>();
const collectionSessions = new Set<string>();
let collectionSession: string | null = null;
let collectionTabId: number | null = null;
let collectionPort: HarvestPort | null = null;

function stopCollection(): void {
  collectionSession = null;
  collectionTabId = null;
  const port = collectionPort;
  collectionPort = null;
  port?.disconnect();
  collectionButton.textContent = "収集";
  collectionButton.setAttribute("aria-pressed", "false");
}

chrome.runtime.onConnect?.addListener(port => {
  if (!collectionSessions.delete(port.name)) return;
  if (port.name !== collectionSession || port.sender?.tab?.id !== collectionTabId) { port.disconnect(); return; }
  collectionPort?.disconnect();
  collectionPort = port;
  port.postMessage({busy});
  port.onMessage.addListener(message => {
    if (collectionPort !== port || !collectionSession || busy || disposed ||
        typeof message.url !== "string" || !isWebUrl(message.url)) return;
    sourceUrl.value = message.url;
    updateSourceDrop();
    void startScan();
  });
  port.onDisconnect.addListener(() => {
    if (collectionPort === port) stopCollection();
  });
});

async function toggleCollection(): Promise<void> {
  if (collectionSession) { stopCollection(); return; }
  const session = "harvest-collection:" + crypto.randomUUID();
  collectionSessions.add(session);
  collectionSession = session;
  collectionButton.textContent = "停止";
  collectionButton.setAttribute("aria-pressed", "true");
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (collectionSession !== session || disposed) return;
    if (tab?.id === undefined || !isWebUrl(tab.url)) throw new Error("収集するWebページを開いてください。");
    collectionTabId = tab.id;
    await chrome.scripting.executeScript({target: {tabId: tab.id}, func: captureCollectionLinks, args: [session]});
  } catch (error) {
    if (collectionSession !== session) return;
    stopCollection();
    setStatus(error instanceof Error ? error.message : "収集モードを開始できませんでした。", "error");
  }
}

let busy = false;
let disposed = false;
let scanController: AbortController | null = null;
let exportController: AbortController | null = null;
window.addEventListener?.("pagehide", () => {
  disposed = true;
  stopCollection();
  scanController?.abort();
  exportController?.abort();
});

let collectionSource: readonly ImageItem[] | null = null;
let collectionGroups: ImageGroups = {};
let collectionByUrl = new Map<string, ImageItem>();
let collectionPositions = new Map<ImageItem, number>();
let collectionGroupItems = new Map<string, ImageItem[]>();
function updateCollection(): void {
  if (collectionSource === images) return;
  collectionSource = images;
  collectionGroups = groupImages(images.map(item => item.url));
  collectionByUrl = new Map(images.map(item => [item.url, item]));
  collectionPositions = new Map(images.map((item, index) => [item, index]));
  collectionGroupItems = new Map(Object.entries(collectionGroups).map(([key, group]) =>
    [key, group.items.map(url => collectionByUrl.get(url)!)]));
}
let pendingExport: {selected: ImageItem[]; prepared: Map<ImageItem, PdfImagePage>; failed: Map<ImageItem, string>} | null = null;
type ScanState = "initial" | "scanning" | "results" | "empty" | "error";
let scanState: ScanState = "initial";

type StatusState = "info" | "busy" | "success" | "error";
type FocusTarget =
  | {kind: "group"; key: string}
  | {kind: "pdf-group"; key: string}
  | {kind: "image"; url: string; action: "drag"};
let focusTarget: FocusTarget | null = null;
let draggedImage: ImageItem | null = null;
let suppressThumbnailClick = false;
interface ImageRowParts {
  preview: HTMLImageElement;
  order: HTMLSpanElement;
  name: HTMLSpanElement;
  selectedMark: HTMLSpanElement;
  failedMark: HTMLSpanElement;
}
const imageRowParts = new WeakMap<HTMLLIElement, ImageRowParts>();
let imageView: {visibleImages: readonly ImageItem[]; previewOrder: ImageItem[]; rows: Map<string, HTMLLIElement>} = {
  visibleImages: [], previewOrder: [], rows: new Map(),
};

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function isWebUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}

function updateSourceDrop(): void {
  const url = sourceUrl.value.trim();
  sourceDrop.textContent = url || "ページURLをドロップ、またはクリックして入力";
  sourceDrop.dataset["hasUrl"] = String(Boolean(url));
}

function showSourceInput(): void {
  if (busy) return;
  sourceDrop.hidden = true;
  sourceUrl.hidden = false;
  sourceUrl.focus();
  sourceUrl.select();
}

function hideSourceInput(): void {
  sourceUrl.hidden = true;
  sourceDrop.hidden = false;
  updateSourceDrop();
}

function setStatus(message: string, state: StatusState = "info"): void {
  setMotionText(statusElement, message);
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
    if (document.activeElement !== element) element.focus();
    return;
  }
}

function setBusy(value: boolean): void {
  busy = value;
  collectionPort?.postMessage({busy: value});
  scanButton.disabled = value;
  sourceDrop.disabled = value;
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
      showSourceInput();
      return;
    }
  }
  hideSourceInput();
  const controller = new AbortController();
  scanController = controller;
  scanState = "scanning";
  setBusy(true);
  setStatus("ページを調べています…", "busy");
  try {
    let result;
    if (targetUrl) {
      result = await scanUrl(targetUrl, controller.signal);
    } else {
      const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (activeTab?.id === undefined || !isWebUrl(activeTab.url)) {
        throw new Error("開いているWebページを解析できません。URLを指定してください。");
      }
      result = await scanTab(activeTab.id, controller.signal);
    }
    if (disposed || controller.signal.aborted || scanController !== controller) return;
    const urls = sortImageUrlsForSite(normalizeImageUrls(result.images, result.url), result.url);
    const grouped = groupImages(urls);
    const selectedGroups = defaultSelectedImageGroups(grouped);
    const selectedUrls = new Set(Object.entries(grouped).flatMap(([key, group]) => selectedGroups[key] ? group.items : []));
    const nextImages = urls.map(url => ({url, sourcePage: result.url, selected: selectedUrls.has(url)}));
    // Publish only a complete scan. A rejected scan keeps the previous working set.
    images = nextImages;
    initialImageOrder = [...images];
    pageTitle = result.title || "画像";
    pendingExport = null;
    activeGroupKey = defaultDisplayedImageGroup(grouped);
    viewerMode = false;
    viewerImageUrl = null;
    completionElement.hidden = true;
    scanState = images.length ? "results" : "empty";
    setStatus(images.length ? "" : "画像が見つかりませんでした。", "info");
  } catch (error) {
    if (disposed || controller.signal.aborted || scanController !== controller) return;
    scanState = images.length ? "results" : "error";
    const reason = error instanceof Error ? error.message : "このページを読み取れませんでした。";
    setStatus(reason + (images.length ? " 前の収集結果を保持しています。" : ""), "error");
  } finally {
    if (scanController === controller) {
      scanController = null;
      if (!disposed) setBusy(false);
    }
  }
}

function renderGroups(groups: ImageGroups): void {
  groupsElement.hidden = Object.keys(groups).length === 0;
  const entries = groupsElement.hidden ? [] : Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority);
  reconcileKeyedChildren(groupsElement, groupsElement.hidden ? [] : ["all", ...entries.map(([key]) => key)], key => key,
    key => {
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => {
        requestFocus({kind: "group", key});
        activeGroupKey = key === "all" ? null : key;
        render();
      });
      return button;
    },
    (button, key) => {
      const group = key === "all" ? undefined : groups[key];
      button.textContent = group?.label ?? "すべて表示";
      button.title = key === "all" ? "すべての画像を表示する" : "このまとまりだけを表示する";
      button.disabled = busy;
      button.setAttribute("data-focus-kind", "group");
      button.setAttribute("data-focus-key", key);
      button.setAttribute("aria-pressed", String(key === "all" ? activeGroupKey === null : activeGroupKey === key));
    });
}

function renderGroupSelections(groups: ImageGroups): void {
  groupSelectionsElement.hidden = Object.keys(groups).length === 0;
  const entries = groupSelectionsElement.hidden ? [] : Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority);
  reconcileKeyedChildren(groupSelectionsElement, entries.map(([key]) => key), key => key,
    key => {
      const label = document.createElement("label");
      label.className = "group-selection";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (busy) return;
        const currentGroup = collectionGroups[key];
        if (!currentGroup) return;
        requestFocus({kind: "pdf-group", key});
        const urls = new Set(currentGroup.items);
        for (const item of images) if (urls.has(item.url)) item.selected = checkbox.checked;
        render();
      });
      const name = document.createElement("span");
      label.append(checkbox, name);
      return label;
    },
    (label, key) => {
      const group = groups[key];
      if (!group) return;
      const checkbox = label.children[0] as HTMLInputElement | undefined;
      const name = label.children[1] as HTMLSpanElement | undefined;
      if (!checkbox || !name) return;
      const groupItems = collectionGroupItems.get(key) ?? [];
      const selectedCount = groupItems.filter(item => item.selected).length;
      checkbox.checked = groupItems.length > 0 && selectedCount === groupItems.length;
      checkbox.indeterminate = selectedCount > 0 && selectedCount < groupItems.length;
      checkbox.disabled = busy;
      checkbox.setAttribute("data-focus-kind", "pdf-group");
      checkbox.setAttribute("data-focus-key", key);
      checkbox.setAttribute("aria-label", `PDFに含める ${group.label}`);
      name.textContent = group.label;
    });
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

function showInsertion(order: ImageItem[]): void {
  const {rows} = imageView;
  imageView.previewOrder = order;
  animateLayoutChange([...rows.values()], () => {
    order.forEach((item, index) => { rows.get(item.url)!.style.order = String(index); });
  }, draggedImage ? rows.get(draggedImage.url) : undefined);
}

function previewInsertion(target: ImageItem, event: DragEvent): void {
  const {rows} = imageView;
  if (busy || !draggedImage || draggedImage === target) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const row = rows.get(target.url);
  if (!row) return;
  const rect = row.getBoundingClientRect();
  const isSingleColumn = [...rows.values()].every(value => Math.abs(value.getBoundingClientRect().left - rect.left) < 1);
  const after = isSingleColumn ? event.clientY >= rect.top + rect.height / 2 : event.clientX >= rect.left + rect.width / 2;
  const order = imageView.previewOrder.filter(item => item !== draggedImage);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, draggedImage);
  if (order.some((item, index) => item !== imageView.previewOrder[index])) showInsertion(order);
}

function finishDrop(event: DragEvent): void {
  if (!draggedImage || busy) return;
  event.preventDefault();
  const source = draggedImage;
  const visibleSet = new Set(imageView.visibleImages);
  let index = 0;
  images = images.map(item => visibleSet.has(item) ? imageView.previewOrder[index++]! : item);
  draggedImage = null;
  requestFocus({kind: "image", url: source.url, action: "drag"});
  render();
}

function createImageRow(initialItem: ImageItem): HTMLLIElement {
  const currentItem = (): ImageItem => collectionByUrl.get(initialItem.url)!;
  const row = document.createElement("li");
  const preview = document.createElement("img");
  preview.className = "preview";
  preview.loading = "lazy";
  preview.referrerPolicy = "no-referrer";
  preview.draggable = false;
  const body = document.createElement("div");
  body.className = "item-body";
  const order = document.createElement("span");
  order.className = "item-order";
  const name = document.createElement("span");
  name.className = "item-title";
  const selectedMark = document.createElement("span");
  selectedMark.className = "item-selected";
  selectedMark.textContent = "✓";
  selectedMark.setAttribute("aria-hidden", "true");
  const failedMark = document.createElement("span");
  failedMark.className = "item-failed";
  failedMark.textContent = "取得失敗";
  body.append(order, name, selectedMark, failedMark);
  row.append(preview, body);
  imageRowParts.set(row, {preview, order, name, selectedMark, failedMark});
  row.addEventListener("pointerdown", () => { suppressThumbnailClick = false; });
  row.addEventListener("click", () => {
    if (suppressThumbnailClick || draggedImage || busy) return;
    const item = currentItem();
    item.selected = !item.selected;
    requestFocus({kind: "image", url: item.url, action: "drag"});
    render();
  });
  row.addEventListener("dragstart", event => {
    if (busy) { event.preventDefault(); return; }
    const item = currentItem();
    suppressThumbnailClick = true;
    draggedImage = item;
    if (event.dataTransfer) {
      event.dataTransfer.setDragImage(preview, preview.width / 2, preview.height / 2);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "harvest-image");
    }
    row.classList.add("dragging");
  });
  row.addEventListener("dragover", event => previewInsertion(currentItem(), event));
  row.addEventListener("drop", finishDrop);
  row.addEventListener("dragend", () => {
    if (!draggedImage) return;
    draggedImage = null;
    row.classList.remove("dragging");
    showInsertion([...imageView.visibleImages]);
  });
  row.addEventListener("keydown", event => {
    if (event.target !== row || busy) return;
    const item = currentItem();
    if (!event.altKey && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!event.repeat && !draggedImage && !busy) { item.selected = !item.selected; requestFocus({kind: "image", url: item.url, action: "drag"}); render(); }
      return;
    }
    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const index = imageView.visibleImages.indexOf(item);
    const target = imageView.visibleImages[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (target) moveImage(imageView.visibleImages, item, target);
  });
  return row;
}

function renderImages(visibleImages: readonly ImageItem[]): void {
  imageView.visibleImages = visibleImages;
  imageView.previewOrder = [...visibleImages];
  imageView.rows = reconcileKeyedChildren(imagesElement, visibleImages, item => item.url, createImageRow, (row, item, index) => {
    const parts = imageRowParts.get(row);
    if (!parts) return;
    const overallIndex = collectionPositions.get(item)!;
    row.style.order = String(index);
    if (item.selected) row.classList.remove("unselected");
    else row.classList.add("unselected");
    const failed = pendingExport?.failed.has(item) ?? false;
    if (failed) row.classList.add("failed");
    else row.classList.remove("failed");
    if (draggedImage !== item) row.classList.remove("dragging");
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", String(item.selected));
    row.setAttribute("aria-disabled", String(busy));
    row.draggable = !busy;
    row.tabIndex = 0;
    row.title = "クリックでPDF選択、ドラッグで並べ替え（キーボード: Enter / Spaceで選択、Alt + ↑ / ↓で移動）";
    row.setAttribute("data-focus-kind", "image");
    row.setAttribute("data-focus-url", item.url);
    row.setAttribute("data-focus-action", "drag");
    row.setAttribute("aria-label", `${imageFilename(item.url)}、${overallIndex + 1}番目。${failed ? "取得失敗。" : ""}クリックでPDF選択、ドラッグまたはAltと上下矢印で並べ替え`);
    if (parts.preview.src !== item.url) parts.preview.src = item.url;
    parts.preview.alt = `画像 ${index + 1}`;
    parts.order.textContent = `${overallIndex + 1}`;
    parts.order.setAttribute("aria-label", `全体の${overallIndex + 1}番目`);
    parts.name.textContent = imageFilename(item.url);
    parts.name.title = item.url;
    parts.selectedMark.hidden = false;
    parts.failedMark.hidden = !failed;
  });
  imagesElement.ondragover = event => {
    if (!draggedImage || busy) return;
    event.preventDefault();
    let nearest: ImageItem | null = null;
    let distance = Infinity;
    for (const [url, row] of imageView.rows) {
      const rect = row.getBoundingClientRect();
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      if (dx * dx + dy * dy < distance) { nearest = collectionByUrl.get(url) ?? null; distance = dx * dx + dy * dy; }
    }
    if (nearest) previewInsertion(nearest, event);
  };
  imagesElement.ondrop = finishDrop;
}

function updateViewerTransform(): void {
  viewerImageElement.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${viewerZoom})`;
  viewerZoomResetButton.textContent = `${Math.round(viewerZoom * 100)}%`;
  viewerZoomOutButton.disabled = viewerZoom <= 1;
  viewerZoomInButton.disabled = viewerZoom >= 8;
  viewerZoomResetButton.disabled = viewerZoom === 1;
  viewerStageElement.dataset["pannable"] = String(viewerZoom > 1);
}

function resetViewerTransform(): void {
  viewerZoom = 1;
  viewerPanX = 0;
  viewerPanY = 0;
  viewerPointer = null;
  delete viewerStageElement.dataset["panning"];
  updateViewerTransform();
}

function zoomViewer(factor: number, clientX?: number, clientY?: number): void {
  if (!viewerMode || !viewerImageUrl) return;
  const nextZoom = Math.min(8, Math.max(1, viewerZoom * factor));
  if (nextZoom === viewerZoom) return;
  const rect = viewerStageElement.getBoundingClientRect();
  const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
  const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
  const ratio = nextZoom / viewerZoom;
  viewerPanX = x - (x - viewerPanX) * ratio;
  viewerPanY = y - (y - viewerPanY) * ratio;
  viewerZoom = nextZoom;
  if (viewerZoom === 1) { viewerPanX = 0; viewerPanY = 0; }
  updateViewerTransform();
}

function renderViewerThumbnails(selected: readonly ImageItem[], currentUrl: string): void {
  const selectedUrls = new Set(selected.map(item => item.url));
  for (const url of viewerThumbRows.keys()) if (!selectedUrls.has(url)) viewerThumbRows.delete(url);
  const rows = selected.map((item, index) => {
    let row = viewerThumbRows.get(item.url);
    if (!row) {
      row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const thumbnail = document.createElement("img");
      thumbnail.loading = "lazy";
      thumbnail.referrerPolicy = "no-referrer";
      thumbnail.draggable = false;
      thumbnail.src = item.url;
      const number = document.createElement("span");
      number.className = "viewer-thumb-number";
      button.append(thumbnail, number);
      button.addEventListener("click", () => { viewerImageUrl = item.url; renderViewer(); });
      row.append(button);
      viewerThumbRows.set(item.url, row);
    }
    const button = row.children[0] as HTMLButtonElement;
    const number = button.children[1] as HTMLSpanElement;
    button.setAttribute("aria-current", String(item.url === currentUrl));
    button.setAttribute("aria-label", `${index + 1}枚目: ${imageFilename(item.url)}を表示`);
    number.textContent = String(index + 1);
    return row;
  });
  viewerThumbnailsElement.replaceChildren(...rows);
  if (renderedViewerImageUrl !== currentUrl) {
    const active = viewerThumbRows.get(currentUrl)?.children[0] as HTMLButtonElement | undefined;
    active?.scrollIntoView({block: "nearest"});
  }
}

function renderViewer(): void {
  const selected = images.filter(item => item.selected);
  const index = selected.findIndex(item => item.url === viewerImageUrl);
  const currentIndex = index < 0 ? 0 : index;
  const current = selected[currentIndex];
  viewerImageUrl = current?.url ?? null;
  resultsElement.hidden = viewerMode;
  viewerElement.hidden = !viewerMode;
  viewerToggleButton.disabled = busy || images.length === 0;
  viewerToggleButton.setAttribute("aria-pressed", String(viewerMode));
  viewerToggleButton.textContent = viewerMode ? "画像一覧に戻る" : "ビュアーモード";
  viewerEmptyElement.hidden = !viewerMode || Boolean(current);
  viewerPageElement.hidden = !viewerMode || !current;
  if (!viewerMode || !current) {
    renderedViewerImageUrl = null;
    viewerThumbRows.clear();
    viewerThumbnailsElement.replaceChildren();
    resetViewerTransform();
    viewerImageElement.removeAttribute("src");
    viewerImageElement.alt = "";
    viewerPositionElement.textContent = "";
    viewerFilenameElement.textContent = "";
    return;
  }
  if (renderedViewerImageUrl !== current.url) resetViewerTransform();
  renderViewerThumbnails(selected, current.url);
  if (viewerImageElement.src !== current.url) viewerImageElement.src = current.url;
  renderedViewerImageUrl = current.url;
  viewerImageElement.alt = `選択した画像 ${currentIndex + 1}`;
  viewerPositionElement.textContent = `${currentIndex + 1} / ${selected.length}`;
  viewerFilenameElement.textContent = imageFilename(current.url);
  viewerPreviousButton.disabled = busy || currentIndex === 0;
  viewerNextButton.disabled = busy || currentIndex === selected.length - 1;
}

function render(): void {
  updateCollection();
  const selected = images.filter(item => item.selected);
  if (pendingExport && (selected.length !== pendingExport.selected.length ||
      selected.some((item, index) => item !== pendingExport!.selected[index]))) {
    pendingExport = null;
    if (!busy) setStatus("選択や順序が変わりました。PDFを保存してください。", "info");
  }
  const groups = collectionGroups;
  if (activeGroupKey !== null && !groups[activeGroupKey]) activeGroupKey = null;
  const visibleImages = filterImagesByGroup(images, activeGroupKey === null ? null : groups[activeGroupKey]!);
  const selectedCount = selected.length;
  setMotionText(countElement, `${selectedCount} / ${images.length}枚を選択${activeGroupKey === null ? "" : `・${visibleImages.length}枚を表示`}`);
  exportButton.textContent = pendingExport?.failed.size
    ? `失敗した${pendingExport.failed.size}枚を再試行`
    : selectedCount ? `PDFを保存（${selectedCount}枚）` : "PDFを保存";
  failuresElement.hidden = !pendingExport?.failed.size;
  failedImagesElement.replaceChildren(...(pendingExport?.selected.filter(item => pendingExport!.failed.has(item)) ?? []).map(item => {
    const row = document.createElement("li");
    row.textContent = `${collectionPositions.get(item)! + 1}番 ${imageFilename(item.url)} — ${pendingExport!.failed.get(item)}`;
    row.title = item.url;
    return row;
  }));
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
  resetOrderButton.disabled = busy || images.every((item, index) => item === initialImageOrder[index]);
  exportButton.disabled = busy || !images.some(item => item.selected);
  renderGroups(groups);
  renderGroupSelections(groups);
  renderImages(visibleImages);
  renderViewer();
  restoreFocus();
}

async function exportPdf(): Promise<void> {
  if (busy) return;
  const selected = images.filter(item => item.selected);
  if (!selected.length) return;
  const retry = Boolean(pendingExport?.failed.size);
  const work = pendingExport ?? {selected, prepared: new Map<ImageItem, PdfImagePage>(), failed: new Map<ImageItem, string>()};
  const remaining = work.selected.filter(item => !work.prepared.has(item));
  const controller = new AbortController();
  exportController = controller;
  completionElement.hidden = true;
  setBusy(true);
  setStatus(`${retry ? "画像を再試行" : "画像を準備"}しています… 0 / ${remaining.length}`, "busy");
  try {
    work.failed.clear();
    let completed = 0;
    await preparePdfImages(remaining, (image, result) => {
      if (result instanceof PdfImageError) work.failed.set(image, result.message);
      else work.prepared.set(image, result);
      completed += 1;
      if (!disposed) setStatus(`${retry ? "画像を再試行" : "画像を準備"}しています… ${completed} / ${remaining.length}`, "busy");
    }, {signal: controller.signal});
    if (disposed || controller.signal.aborted) return;
    if (work.failed.size) {
      pendingExport = work;
      viewerMode = false;
      setStatus(`${work.failed.size}枚を取得できませんでした。画像を確認して再試行してください。`, "error");
      return;
    }
    const pages = work.selected.map(item => work.prepared.get(item)!);
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
    pendingExport = null;
    setStatus(`${pages.length}枚のPDFを保存しました。`, "success");
    completionElement.hidden = false;
  } catch (error) {
    if (disposed) return;
    pendingExport = work.prepared.size || work.failed.size ? work : null;
    setStatus(error instanceof Error ? error.message : "PDFを作成できませんでした。", "error");
  } finally {
    exportController = null;
    if (!disposed) setBusy(false);
    if (!disposed && pendingExport === work && work.failed.size) failuresElement.scrollIntoView({block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth"});
  }
}

collectionButton.addEventListener("click", () => { void toggleCollection(); });
scanButton.addEventListener("click", () => { void startScan(); });
sourceDrop.addEventListener("click", showSourceInput);
sourceUrl.addEventListener("input", updateSourceDrop);
sourceUrl.addEventListener("blur", hideSourceInput);
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter") void startScan(); });
function acceptsPageUrlDrop(target: EventTarget | null): boolean {
  return scanState === "initial" || target === sourceDrop || target === sourceUrl;
}
function isPageUrlDrag(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types.includes("text/uri-list") || event.dataTransfer?.types.includes("text/plain"));
}
function clearDropFeedback(): void {
  document.body.classList.remove("page-drop-ready");
  sourceDrop.classList.remove("drag-over");
  sourceUrl.classList.remove("drag-over");
}
let urlDragDepth = 0;
document.addEventListener("dragenter", event => {
  if (isPageUrlDrag(event) && !draggedImage) urlDragDepth += 1;
});
document.addEventListener("dragleave", event => {
  if (!isPageUrlDrag(event) && urlDragDepth === 0) return;
  urlDragDepth = Math.max(0, urlDragDepth - 1);
  if (urlDragDepth === 0) clearDropFeedback();
});
document.addEventListener("dragover", event => {
  if (busy || draggedImage || !isPageUrlDrag(event) || !acceptsPageUrlDrop(event.target)) {
    clearDropFeedback();
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  clearDropFeedback();
  if (scanState === "initial") document.body.classList.add("page-drop-ready");
  if (event.target === sourceDrop) sourceDrop.classList.add("drag-over");
  if (event.target === sourceUrl) sourceUrl.classList.add("drag-over");
});
document.addEventListener("drop", event => {
  urlDragDepth = 0;
  clearDropFeedback();
  const dropped = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain") || "";
  const url = dropped.split(/\r?\n/).find(line => line && !line.startsWith("#"))?.trim();
  if (!url || !isWebUrl(url)) return;
  event.preventDefault();
  if (busy || !acceptsPageUrlDrop(event.target)) return;
  sourceUrl.value = url;
  hideSourceInput();
  void startScan();
});
exportButton.addEventListener("click", () => { void exportPdf(); });
viewerToggleButton.addEventListener("click", () => {
  if (busy || images.length === 0) return;
  viewerMode = !viewerMode;
  render();
});
viewerPreviousButton.addEventListener("click", () => {
  const selected = images.filter(item => item.selected);
  const index = selected.findIndex(item => item.url === viewerImageUrl);
  if (index > 0) { viewerImageUrl = selected[index - 1]!.url; renderViewer(); }
});
viewerNextButton.addEventListener("click", () => {
  const selected = images.filter(item => item.selected);
  const index = selected.findIndex(item => item.url === viewerImageUrl);
  if (index >= 0 && index < selected.length - 1) { viewerImageUrl = selected[index + 1]!.url; renderViewer(); }
});
viewerZoomInButton.addEventListener("click", () => zoomViewer(1.25));
viewerZoomOutButton.addEventListener("click", () => zoomViewer(1 / 1.25));
viewerZoomResetButton.addEventListener("click", resetViewerTransform);
viewerStageElement.addEventListener("wheel", event => {
  if (!viewerMode || !viewerImageUrl) return;
  event.preventDefault();
  zoomViewer(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
}, {passive: false});
viewerStageElement.addEventListener("pointerdown", event => {
  if (!viewerMode || viewerZoom <= 1 || (event.button !== undefined && event.button !== 0)) return;
  event.preventDefault();
  viewerPointer = {id: event.pointerId, x: event.clientX, y: event.clientY, panX: viewerPanX, panY: viewerPanY};
  viewerStageElement.setPointerCapture(event.pointerId);
  viewerStageElement.dataset["panning"] = "true";
});
viewerStageElement.addEventListener("pointermove", event => {
  if (!viewerPointer || viewerPointer.id !== event.pointerId) return;
  viewerPanX = viewerPointer.panX + event.clientX - viewerPointer.x;
  viewerPanY = viewerPointer.panY + event.clientY - viewerPointer.y;
  updateViewerTransform();
});
const endViewerPan = (event: PointerEvent): void => {
  if (!viewerPointer || viewerPointer.id !== event.pointerId) return;
  viewerPointer = null;
  viewerStageElement.releasePointerCapture(event.pointerId);
  delete viewerStageElement.dataset["panning"];
};
viewerStageElement.addEventListener("pointerup", endViewerPan);
viewerStageElement.addEventListener("pointercancel", endViewerPan);
selectAllButton.addEventListener("click", () => { if (busy) return; for (const item of images) item.selected = true; render(); });
clearAllButton.addEventListener("click", () => { if (busy) return; for (const item of images) item.selected = false; render(); });
resetOrderButton.addEventListener("click", () => {
  if (busy || resetOrderButton.disabled) return;
  images = [...initialImageOrder];
  render();
});
resetButton.addEventListener("click", () => {
  if (busy) return;
  images = [];
  initialImageOrder = [];
  pendingExport = null;
  activeGroupKey = null;
  viewerMode = false;
  viewerImageUrl = null;
  scanState = "initial";
  pageTitle = "画像";
  completionElement.hidden = true;
  setStatus("", "info");
  render();
});
backToImagesButton.addEventListener("click", () => { completionElement.hidden = true; imagesElement.scrollIntoView({block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth"}); });

updateSourceDrop();
render();
