import { defaultDisplayedImageGroup, normalizeImageUrls, type ImageItem } from "../core/images.js";
import { ImageCollection } from "../core/image-collection.js";
import { createCollectionController } from "./collection-controller.js";
import { scanTab, scanUrl } from "./page-access.js";
import { preparePdfImages, PdfImageError } from "./pdf-image.js";
import { createPdf, type PdfImagePage } from "../core/pdf.js";
import { prepareSourceGlyphs } from "./pdf-source-glyphs.js";
import { animateLayoutChange, prefersReducedMotion, reconcileKeyedChildren, setMotionText } from "./motion.js";
import { formatCount, formatFailedAria, formatGroupLabel, formatPlural, localizeErrorMessage, t } from "./localization.js";
import { createViewerController } from "./viewer-controller.js";

const sourceUrl = required<HTMLInputElement>("#source-url");
const sourceDrop = required<HTMLButtonElement>("#source-drop");
const headerElement = required<HTMLDivElement>(".app-header");
headerElement.dataset["dropLabel"] = t("dropUrl");
const collectionButton = required<HTMLButtonElement>("#collection-toggle");
const scanButton = required<HTMLButtonElement>("#scan");
const exportButton = required<HTMLButtonElement>("#export");
const pdfSaveStateElement = required<HTMLSpanElement>("#pdf-save-state");
const includeSourcePage = required<HTMLInputElement>("#include-source-page");
const sourcePagePreferenceKey = "harvest.includeSourcePage";
try { includeSourcePage.checked = localStorage.getItem(sourcePagePreferenceKey) === "true"; }
catch { includeSourcePage.checked = false; }
includeSourcePage.addEventListener("change", () => {
  try { localStorage.setItem(sourcePagePreferenceKey, String(includeSourcePage.checked)); }
  catch { setStatus(t("errorSavePreference"), "error"); }
  render();
});
const viewerToggleButton = required<HTMLButtonElement>("#viewer-toggle");
const viewerElement = required<HTMLElement>("#viewer");
const mainElement = required<HTMLElement>("main");
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
const allVisibilityButton = required<HTMLButtonElement>("#all-visibility");
const allSelectionCheckbox = required<HTMLInputElement>("#all-selection");
const resetOrderButton = required<HTMLButtonElement>("#reset-order");
const resetButton = required<HTMLButtonElement>("#reset");
const completionElement = required<HTMLDivElement>("#completion");
const failuresElement = required<HTMLElement>("#failures");
const failedImagesElement = required<HTMLUListElement>("#failed-images");
const backToImagesButton = required<HTMLButtonElement>("#back-to-images");
const imagesElement = required<HTMLOListElement>("#images");
const groupsElement = required<HTMLDivElement>("#groups");
const countElement = required<HTMLSpanElement>("#count");
const scanOverlay = required<HTMLElement>("#scan-overlay");
const emptyElement = required<HTMLElement>("#empty");
const emptyLogoElement = required<HTMLImageElement>("#empty-logo");
const emptyMessageElement = required<HTMLParagraphElement>("#empty-message");
const statusElement = required<HTMLParagraphElement>("#status");

const imageCollection = new ImageCollection();
let pageTitle = t("imageFallback");
let savedPdfSignature: string | null = null;

function pdfSignature(): string {
  return JSON.stringify([pageTitle, includeSourcePage.checked, imageCollection.selectedItems.map(item => [item.url, item.sourcePage])]);
}
let visibleGroupKeys = new Set<string>();
let busy = false;
let disposed = false;
let scanController: AbortController | null = null;
let exportController: AbortController | null = null;
window.addEventListener?.("pagehide", () => {
  disposed = true;
  collectionController.stop();
  scanController?.abort();
  exportController?.abort();
});

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
  sourceDrop.textContent = url || t("sourceDrop");
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

function clearSourceUrl(): void {
  sourceUrl.value = "";
  hideSourceInput();
}

function setStatus(message: string, state: StatusState = "info", progress = ""): void {
  setMotionText(statusElement, state === "busy" ? progress : message);
  statusElement.setAttribute("aria-label", state === "busy" ? message : "");
  statusElement.dataset["state"] = state;
  statusElement.title = message;
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
  scanButton.disabled = value;
  sourceDrop.disabled = value;
  sourceUrl.disabled = value;
  includeSourcePage.disabled = value;
  resetButton.disabled = value;
  exportButton.disabled = value || !imageCollection.hasSelection;
  render();
}

async function startScan(collectionLink?: string): Promise<void> {
  if (busy) return;
  const session = collectionController.session;
  const enteredUrl = sourceUrl.value.trim();
  let targetUrl = "";
  if (enteredUrl) {
    try {
      const parsed = new URL(enteredUrl);
      if (!isWebUrl(parsed.href)) throw new Error();
      targetUrl = parsed.href;
    } catch {
      setStatus(t("errorInvalidUrl"), "error");
      showSourceInput();
      return;
    }
  }
  collectionController.clearAnalyzedUrl();
  hideSourceInput();
  const controller = new AbortController();
  scanController = controller;
  scanState = "scanning";
  setBusy(true);
  setStatus(t("scanBusy"), "busy");
  try {
    let result;
    if (targetUrl) {
      result = await scanUrl(targetUrl, controller.signal);
    } else {
      const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (activeTab?.id === undefined || !isWebUrl(activeTab.url)) {
        throw new Error(t("errorNoActivePage"));
      }
      result = await scanTab(activeTab.id, controller.signal);
    }
    if (disposed || controller.signal.aborted || scanController !== controller) return;
    const urls = normalizeImageUrls(result.images, result.url);
    // Publish only a complete scan. A rejected scan keeps the previous working set.
    imageCollection.replace(urls, result.url);
    savedPdfSignature = null;
    if (collectionLink) collectionController.markAnalyzedUrl(collectionLink, session);
    pageTitle = result.title || t("imageFallback");
    pendingExport = null;
    const initialGroup = defaultDisplayedImageGroup(imageCollection.groups);
    visibleGroupKeys = new Set(initialGroup === null ? Object.keys(imageCollection.groups) : [initialGroup]);
    viewerController.setOpen(imageCollection.items.length > 0);
    viewerController.clearCurrentPage();
    completionElement.hidden = true;
    scanState = imageCollection.items.length ? "results" : "empty";
    setStatus(imageCollection.items.length ? "" : t("scanEmpty"), "info");
  } catch (error) {
    if (disposed || controller.signal.aborted || scanController !== controller) return;
    scanState = imageCollection.items.length ? "results" : "error";
    const reason = error instanceof Error ? localizeErrorMessage(error.message, "errorPageRead", true) : t("errorPageRead");
    setStatus(reason + (imageCollection.items.length ? t("previousResults") : ""), "error");
  } finally {
    if (scanController === controller) {
      scanController = null;
      if (!disposed) setBusy(false);
    }
  }
}

function renderEye(button: HTMLButtonElement, shown: boolean, label: string): void {
  const eye = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  eye.classList.add("eye-icon");
  eye.setAttribute("viewBox", "0 0 24 24");
  eye.setAttribute("aria-hidden", "true");
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outline.setAttribute("d", "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z");
  const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  pupil.setAttribute("cx", "12");
  pupil.setAttribute("cy", "12");
  pupil.setAttribute("r", "2.5");
  eye.append(outline, pupil);
  if (!shown) {
    const gap = document.createElementNS("http://www.w3.org/2000/svg", "path");
    gap.setAttribute("d", "M3 21 21 3");
    gap.classList.add("eye-slash-gap");
    const slash = document.createElementNS("http://www.w3.org/2000/svg", "path");
    slash.setAttribute("d", "M3 21 21 3");
    slash.classList.add("eye-slash");
    eye.append(gap, slash);
  }
  button.replaceChildren(eye);
  button.title = t(shown ? "hideGroup" : "displayGroup", {label});
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(shown));
}

function renderGroups(groups: ImageCollection["groups"]): void {
  groupsElement.hidden = Object.keys(groups).length === 0;
  const entries = groupsElement.hidden ? [] : Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority);
  reconcileKeyedChildren(groupsElement, entries.map(([key]) => key), key => key,
    key => {
      const label = document.createElement("span");
      label.className = "group-label";
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => {
        requestFocus({kind: "group", key});
        if (visibleGroupKeys.has(key)) visibleGroupKeys.delete(key);
        else visibleGroupKeys.add(key);
        render();
      });
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (busy || !imageCollection.groups[key]) return;
        requestFocus({kind: "pdf-group", key});
        imageCollection.setGroupSelected(key, checkbox.checked);
        render();
      });
      const checkboxLabel = document.createElement("label");
      checkboxLabel.className = "group-check";
      checkboxLabel.append(checkbox);
      const chip = document.createElement("div");
      chip.className = "group-chip";
      chip.append(label, button, checkboxLabel);
      return chip;
    },
    (element, key) => {
      const group = groups[key];
      const groupLabel = formatGroupLabel(group?.label ?? "");
      (element.children[0] as HTMLSpanElement).textContent = groupLabel;
      const button = element.children[1] as HTMLButtonElement;
      renderEye(button, visibleGroupKeys.has(key), groupLabel);
      button.disabled = busy;
      button.setAttribute("data-focus-kind", "group");
      button.setAttribute("data-focus-key", key);
      const checkbox = element.children[2]!.children[0] as HTMLInputElement;
      const selection = imageCollection.groupSelection(key);
      checkbox.checked = selection.checked;
      checkbox.indeterminate = selection.indeterminate;
      checkbox.disabled = busy;
      checkbox.setAttribute("data-focus-kind", "pdf-group");
      checkbox.setAttribute("data-focus-key", key);
      checkbox.setAttribute("aria-label", t("includeGroup", {label: groupLabel}));
    });
}

function imageFilename(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || url); }
  catch { return url; }
}

function moveImage(visibleImages: readonly ImageItem[], source: ImageItem, target: ImageItem): void {
  if (busy || !imageCollection.moveVisible(visibleImages, source, target)) return;
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
  imageCollection.applyVisibleOrder(imageView.visibleImages, imageView.previewOrder);
  draggedImage = null;
  requestFocus({kind: "image", url: source.url, action: "drag"});
  render();
}

function createImageRow(initialItem: ImageItem): HTMLLIElement {
  const currentItem = (): ImageItem => imageCollection.itemForUrl(initialItem.url)!;
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
  failedMark.textContent = t("imageFailed");
  body.append(order, name, selectedMark, failedMark);
  row.append(preview, body);
  imageRowParts.set(row, {preview, order, name, selectedMark, failedMark});
  row.addEventListener("pointerdown", () => { suppressThumbnailClick = false; });
  row.addEventListener("click", () => {
    if (suppressThumbnailClick || draggedImage || busy) return;
    const item = currentItem();
    imageCollection.toggleSelected(item.url);
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
      if (!event.repeat && !draggedImage && !busy) { imageCollection.toggleSelected(item.url); requestFocus({kind: "image", url: item.url, action: "drag"}); render(); }
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

function pdfFilename(): string {
  return `${pageTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || t("imageFallback")}.pdf`;
}

/** A local preview only; the PDF itself continues to contain selectable text. */
function sourcePreview(): ImageItem | null {
  const first = imageCollection.selectedItems[0];
  if (!includeSourcePage.checked || !first) return null;
  const escape = (value: string): string => value.replace(/[&<>"']/g, character =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"})[character]!);
  const wrap = (value: string): string[] => {
    const lines: string[] = [];
    let line = "";
    let width = 0;
    for (const character of value) {
      const advance = character.codePointAt(0)! < 256 ? 1 : 2;
      if (width + advance > 65) { lines.push(line); line = ""; width = 0; }
      line += character;
      width += advance;
    }
    lines.push(line);
    return lines;
  };
  const lines = [...wrap(pdfFilename()), "", ...wrap(first.sourcePage)];
  const size = Math.min(12, 670 / Math.max(lines.length, 1) / 1.5);
  const text = lines.map((line, index) => `<text x="48" y="${100 + index * size * 1.5}" font-size="${size}">${escape(line)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842"><rect width="595" height="842" fill="white"/><g fill="black" font-family="monospace"><text x="48" y="65" font-size="18">Source</text>${text}</g></svg>`;
  return {url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, sourcePage: first.sourcePage, selected: true};
}

function viewerPages(): ImageItem[] {
  const selected = imageCollection.selectedItems;
  const source = sourcePreview();
  return source ? [...selected, source] : selected;
}

function previewName(item: ImageItem): string {
  return item.url.startsWith("data:image/svg+xml;") ? "Source" : imageFilename(item.url);
}

function renderImages(visibleImages: readonly ImageItem[]): void {
  imageView.visibleImages = visibleImages;
  imageView.previewOrder = [...visibleImages];
  imageView.rows = reconcileKeyedChildren(imagesElement, visibleImages, item => item.url, createImageRow, (row, item, index) => {
    const parts = imageRowParts.get(row);
    if (!parts) return;
    const overallIndex = imageCollection.positionOf(item)!;
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
    row.title = t("imageRowTitle");
    row.dataset["dropLabel"] = t("dropImage");
    row.setAttribute("data-focus-kind", "image");
    row.setAttribute("data-focus-url", item.url);
    row.setAttribute("data-focus-action", "drag");
    row.setAttribute("aria-label", t("imageRowAria", {
      filename: imageFilename(item.url), index: overallIndex + 1, failed: formatFailedAria(failed),
    }));
    if (parts.preview.src !== item.url) parts.preview.src = item.url;
    parts.preview.alt = t("imageAlt", {index: index + 1});
    parts.order.textContent = `${overallIndex + 1}`;
    parts.order.setAttribute("aria-label", t("imagePosition", {index: overallIndex + 1}));
    parts.name.textContent = imageFilename(item.url);
    parts.name.title = item.url;
    parts.selectedMark.hidden = false;
    parts.failedMark.hidden = !failed;
  });
  const source = sourcePreview();
  if (source) {
    const row = document.createElement("li");
    row.className = "source-preview";
    row.style.order = String(visibleImages.length);
    const preview = document.createElement("img");
    preview.className = "preview";
    preview.src = source.url;
    preview.alt = "Source";
    const name = document.createElement("div");
    name.className = "item-body";
    name.textContent = "Source";
    row.append(preview, name);
    imagesElement.append(row);
  }
  imagesElement.ondragover = event => {
    if (!draggedImage || busy) return;
    event.preventDefault();
    let nearest: ImageItem | null = null;
    let distance = Infinity;
    for (const [url, row] of imageView.rows) {
      const rect = row.getBoundingClientRect();
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      if (dx * dx + dy * dy < distance) { nearest = imageCollection.itemForUrl(url) ?? null; distance = dx * dx + dy * dy; }
    }
    if (nearest) previewInsertion(nearest, event);
  };
  imagesElement.ondrop = finishDrop;
}

function render(): void {
  collectionController.publishState();
  const selected = imageCollection.selectedItems;
  if (pendingExport && (selected.length !== pendingExport.selected.length ||
      selected.some((item, index) => item !== pendingExport!.selected[index]))) {
    pendingExport = null;
    if (!busy) setStatus(t("selectionChanged"), "info");
  }
  const groups = imageCollection.groups;
  for (const key of visibleGroupKeys) if (!groups[key]) visibleGroupKeys.delete(key);
  const visibleUrls = new Set([...visibleGroupKeys].flatMap(key => groups[key]?.items ?? []));
  const visibleImages = imageCollection.items.filter(item => visibleUrls.has(item.url));
  const selectedCount = selected.length;
  const saved = savedPdfSignature !== null && savedPdfSignature === pdfSignature();
  pdfSaveStateElement.hidden = imageCollection.items.length === 0;
  pdfSaveStateElement.dataset["state"] = saved ? "saved" : savedPdfSignature === null ? "unsaved" : "changed";
  pdfSaveStateElement.setAttribute("aria-label", t(saved ? "pdfSaveStarted" : savedPdfSignature === null ? "pdfUnsaved" : "pdfSaveChanged"));
  pdfSaveStateElement.title = saved ? t("pdfSaveStartedHelp") : "";
  setMotionText(countElement, formatCount(selectedCount, imageCollection.items.length,
    visibleImages.length === imageCollection.items.length ? undefined : visibleImages.length));
  exportButton.textContent = pendingExport?.failed.size
    ? t("exportRetry", {count: pendingExport.failed.size, plural: formatPlural(pendingExport.failed.size)})
    : selectedCount ? t("exportCount", {count: selectedCount, plural: formatPlural(selectedCount)}) : t("savePdf");
  failuresElement.hidden = !pendingExport?.failed.size;
  failedImagesElement.replaceChildren(...(pendingExport?.selected.filter(item => pendingExport!.failed.has(item)) ?? []).map(item => {
    const row = document.createElement("li");
    row.textContent = t("failedRow", {
      index: imageCollection.positionOf(item)! + 1,
      filename: imageFilename(item.url),
      reason: localizeErrorMessage(pendingExport!.failed.get(item) ?? t("errorPdfFetch")),
    });
    row.title = item.url;
    return row;
  }));
  scanOverlay.hidden = scanState !== "scanning";
  emptyElement.hidden = imageCollection.items.length > 0;
  emptyLogoElement.hidden = scanState !== "initial";
  emptyElement.dataset["state"] = scanState;
  emptyMessageElement.hidden = scanState === "initial" || scanState === "scanning";
  emptyMessageElement.textContent = scanState === "scanning"
    ? ""
    : scanState === "empty"
      ? t("scanEmpty")
      : scanState === "error"
        ? t("scanErrorEmpty")
        : "";
  const allVisible = Object.keys(groups).length > 0 && visibleGroupKeys.size === Object.keys(groups).length;
  renderEye(allVisibilityButton, allVisible, t("allGroups"));
  allVisibilityButton.disabled = busy || imageCollection.items.length === 0;
  allSelectionCheckbox.checked = imageCollection.items.length > 0 && selectedCount === imageCollection.items.length;
  allSelectionCheckbox.indeterminate = selectedCount > 0 && selectedCount < imageCollection.items.length;
  allSelectionCheckbox.disabled = busy || imageCollection.items.length === 0;
  allSelectionCheckbox.title = t(allSelectionCheckbox.checked ? "clearAllTitle" : "selectAllTitle");
  allSelectionCheckbox.setAttribute("aria-label", t(allSelectionCheckbox.checked ? "clearAll" : "selectAll"));
  resetOrderButton.disabled = busy || imageCollection.matchesInitialOrderAndSelection();
  exportButton.disabled = busy || !imageCollection.hasSelection;
  renderGroups(groups);
  renderImages(visibleImages);
  viewerController.render();
  restoreFocus();
}

async function exportPdf(): Promise<void> {
  if (busy) return;
  const selected = imageCollection.selectedItems;
  if (!selected.length) return;
  const retry = Boolean(pendingExport?.failed.size);
  const work = pendingExport ?? {selected, prepared: new Map<ImageItem, PdfImagePage>(), failed: new Map<ImageItem, string>()};
  const remaining = work.selected.filter(item => !work.prepared.has(item));
  const controller = new AbortController();
  exportController = controller;
  completionElement.hidden = true;
  setBusy(true);
  setStatus(t(retry ? "retryImages" : "prepareImages", {completed: 0, total: remaining.length}), "busy", `0 / ${remaining.length}`);
  try {
    work.failed.clear();
    let completed = 0;
    await preparePdfImages(remaining, (image, result) => {
      if (result instanceof PdfImageError) work.failed.set(image, result.message);
      else work.prepared.set(image, result);
      completed += 1;
      if (!disposed) setStatus(t(retry ? "retryImages" : "prepareImages", {completed, total: remaining.length}), "busy", `${completed} / ${remaining.length}`);
    }, {signal: controller.signal});
    if (disposed || controller.signal.aborted) return;
    if (work.failed.size) {
      pendingExport = work;
      viewerController.setOpen(false);
      setStatus(t("failedSummary", {count: work.failed.size, plural: formatPlural(work.failed.size)}), "error");
      return;
    }
    const pages = work.selected.map(item => work.prepared.get(item)!);
    setStatus(t("pdfCreating"), "busy", `${pages.length} / ${pages.length}`);
    const filename = pdfFilename();
    const sourcePage = includeSourcePage.checked ? {
      heading: t("sourceHeading"), filename, url: work.selected[0]!.sourcePage,
    } : undefined;
    const glyphs = sourcePage ? await prepareSourceGlyphs(
      [sourcePage.heading, sourcePage.filename, sourcePage.url], controller.signal,
    ) : undefined;
    if (disposed || controller.signal.aborted) return;
    const blob = createPdf(pages, sourcePage ? {...sourcePage, glyphs} : undefined);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    savedPdfSignature = pdfSignature();
    clearSourceUrl();
    pendingExport = null;
    setStatus(t("pdfSaved", {count: pages.length, plural: formatPlural(pages.length)}), "success");
    completionElement.hidden = false;
  } catch (error) {
    if (disposed) return;
    pendingExport = work.prepared.size || work.failed.size ? work : null;
    setStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorPdfCreate", true) : t("errorPdfCreate"), "error");
  } finally {
    exportController = null;
    if (!disposed) setBusy(false);
    if (!disposed && pendingExport === work && work.failed.size) failuresElement.scrollIntoView({block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth"});
  }
}

const collectionController = createCollectionController({
  button: collectionButton,
  startLabel: t("collectionStart"),
  stopLabel: t("collectionStop"),
  noPageError: t("errorCollectionPage"),
  isBusy: () => busy,
  isDisposed: () => disposed,
  canExport: () => imageCollection.hasSelection,
  onScanUrl(url) {
    sourceUrl.value = url;
    updateSourceDrop();
    void startScan(url);
  },
  onExport() { void exportPdf(); },
  onError(error) {
    setStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorCollectionStart", true) : t("errorCollectionStart"), "error");
  },
});
const viewerController = createViewerController({
  elements: {
    toggle: viewerToggleButton,
    viewer: viewerElement,
    empty: viewerEmptyElement,
    page: viewerPageElement,
    previous: viewerPreviousButton,
    next: viewerNextButton,
    position: viewerPositionElement,
    stage: viewerStageElement,
    image: viewerImageElement,
    filename: viewerFilenameElement,
    thumbnails: viewerThumbnailsElement,
    zoomIn: viewerZoomInButton,
    zoomOut: viewerZoomOutButton,
    zoomReset: viewerZoomResetButton,
    results: resultsElement,
  },
  getPages: viewerPages,
  getPageLabel: previewName,
  isBusy: () => busy,
  getImageCount: () => imageCollection.items.length,
  onChange: render,
});

scanButton.addEventListener("click", () => { void startScan(); });
sourceDrop.addEventListener("click", showSourceInput);
sourceUrl.addEventListener("input", updateSourceDrop);
sourceUrl.addEventListener("blur", hideSourceInput);
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter") void startScan(); });
function isMainPageUrlDropTarget(target: EventTarget | null): boolean {
  return target === mainElement || target === emptyElement || target === viewerElement || target === imagesElement ||
    (typeof Node !== "undefined" && target instanceof Node && mainElement.contains(target));
}
function acceptsPageUrlDrop(target: EventTarget | null): boolean {
  return pageWideUrlDropAvailable() || target === headerElement || target === sourceDrop || target === sourceUrl ||
    isMainPageUrlDropTarget(target) ||
    (typeof Node !== "undefined" && target instanceof Node && headerElement.contains(target));
}
function pageWideUrlDropAvailable(): boolean {
  return sourceUrl.value.trim() === "" && imageCollection.items.length === 0;
}
function isPageUrlDrag(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types.includes("text/uri-list") || event.dataTransfer?.types.includes("text/plain"));
}
function clearDropFeedback(): void {
  document.body.classList.remove("page-drop-ready");
  headerElement.classList.remove("drag-over");
  mainElement.classList.remove("drag-over");
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
  if (pageWideUrlDropAvailable()) document.body.classList.add("page-drop-ready");
  else if (isMainPageUrlDropTarget(event.target)) mainElement.classList.add("drag-over");
  else headerElement.classList.add("drag-over");
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
  if (busy || draggedImage || !acceptsPageUrlDrop(event.target)) return;
  sourceUrl.value = url;
  hideSourceInput();
  void startScan();
});
exportButton.addEventListener("click", () => { void exportPdf(); });
allVisibilityButton.addEventListener("click", () => {
  if (busy || allVisibilityButton.disabled) return;
  visibleGroupKeys = visibleGroupKeys.size === Object.keys(imageCollection.groups).length
    ? new Set() : new Set(Object.keys(imageCollection.groups));
  render();
});
allSelectionCheckbox.addEventListener("change", () => {
  if (busy) return;
  imageCollection.setAllSelected(allSelectionCheckbox.checked);
  render();
});
resetOrderButton.addEventListener("click", () => {
  if (busy || resetOrderButton.disabled) return;
  imageCollection.restoreInitialOrderAndSelection();
  render();
});
resetButton.addEventListener("click", () => {
  if (busy) return;
  clearSourceUrl();
  collectionController.clearAnalyzedUrl();
  imageCollection.clear();
  savedPdfSignature = null;
  pendingExport = null;
  visibleGroupKeys.clear();
  viewerController.setOpen(false);
  viewerController.clearCurrentPage();
  scanState = "initial";
  pageTitle = t("imageFallback");
  completionElement.hidden = true;
  setStatus("", "info");
  render();
});
backToImagesButton.addEventListener("click", () => { completionElement.hidden = true; imagesElement.scrollIntoView({block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth"}); });

updateSourceDrop();
render();
