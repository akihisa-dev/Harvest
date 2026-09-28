import { defaultDisplayedImageGroup, normalizeImageUrls, type ImageItem } from "../core/images.js";
import { ImageCollection } from "../core/image-collection.js";
import { createCollectionController } from "./collection-controller.js";
import { scanTab, scanUrl } from "./page-access.js";
import { prefersReducedMotion, setMotionText } from "./motion.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { createViewerController } from "./viewer-controller.js";
import { createImageListView } from "./image-list-view.js";
import { createPdfExportController, type PdfExportController } from "./pdf-export-controller.js";

const sourceUrl = required<HTMLInputElement>("#source-url");
const sourceDrop = required<HTMLButtonElement>("#source-drop");
const urlDropOverlay = required<HTMLDivElement>("#url-drop-overlay");
const collectionButton = required<HTMLButtonElement>("#collection-toggle");
const scanButton = required<HTMLButtonElement>("#scan");
const exportButton = required<HTMLButtonElement>("#export");
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
const resultsElement = required<HTMLElement>(".results");
const viewerEmptyElement = required<HTMLParagraphElement>("#viewer-empty");
const viewerPageElement = required<HTMLDivElement>("#viewer-page");
const viewerPreviousButton = required<HTMLButtonElement>("#viewer-previous");
const viewerNextButton = required<HTMLButtonElement>("#viewer-next");
const viewerPositionElement = required<HTMLSpanElement>("#viewer-position");
const viewerStageElement = required<HTMLDivElement>("#viewer-stage");
const exportOverlay = required<HTMLDivElement>("#export-overlay");
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
const failuresElement = required<HTMLElement>("#failures");
const failedImagesElement = required<HTMLUListElement>("#failed-images");
const imagesElement = required<HTMLOListElement>("#images");
const groupsElement = required<HTMLDivElement>("#groups");
const scanOverlay = required<HTMLElement>("#scan-overlay");
const emptyElement = required<HTMLElement>("#empty");
const emptyLogoElement = required<HTMLImageElement>("#empty-logo");
const emptyMessageElement = required<HTMLParagraphElement>("#empty-message");
const statusElement = required<HTMLParagraphElement>("#status");

const imageCollection = new ImageCollection();
let pageTitle = t("imageFallback");
let busy = false;
let disposed = false;
let scanController: AbortController | null = null;
let pdfExportController: PdfExportController | null = null;
window.addEventListener?.("pagehide", () => {
  disposed = true;
  collectionController.stop();
  scanController?.abort();
  pdfExportController?.abort();
});

type ScanState = "initial" | "scanning" | "results" | "empty" | "error";
let scanState: ScanState = "initial";

type StatusState = "info" | "busy" | "success" | "error";
const imageListView = createImageListView({
  collection: imageCollection,
  allVisibilityButton,
  groupsElement,
  imagesElement,
  isBusy: () => busy,
  getFilename: imageFilename,
  onChange: render,
});

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
  if (pdfExportController?.isRunning && state === "busy") {
    exportButton.textContent = progress;
    exportButton.setAttribute("aria-label", message);
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
    if (collectionLink) collectionController.markAnalyzedUrl(collectionLink, session);
    pageTitle = result.title || t("imageFallback");
    pdfExportController?.clear();
    const initialGroup = defaultDisplayedImageGroup(imageCollection.groups);
    imageListView.showInitialGroup(initialGroup);
    viewerController.setOpen(false);
    viewerController.clearCurrentPage();
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

function imageFilename(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || url); }
  catch { return url; }
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

function render(): void {
  collectionController.publishState();
  const selected = imageCollection.selectedItems;
  const selectionChanged = pdfExportController?.discardIfSelectionChanged(selected) ?? false;
  if (selectionChanged && !busy) setStatus(t("selectionChanged"), "info");
  const pendingExport = pdfExportController?.pending ?? null;
  const exportRunning = pdfExportController?.isRunning ?? false;
  const selectedCount = selected.length;
  scanButton.dataset["scanning"] = String(scanController !== null);
  scanButton.textContent = scanController ? "" : t("scan");
  if (scanController) scanButton.setAttribute("aria-label", t("scanBusy"));
  else scanButton.removeAttribute("aria-label");
  exportButton.dataset["saving"] = String(exportRunning);
  if (!exportRunning) exportButton.removeAttribute("aria-label");
  exportButton.textContent = exportRunning ? pdfExportController?.progress ?? "" : pendingExport?.failed.size
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
  exportOverlay.hidden = !exportRunning;
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
  allSelectionCheckbox.checked = imageCollection.items.length > 0 && selectedCount === imageCollection.items.length;
  allSelectionCheckbox.indeterminate = selectedCount > 0 && selectedCount < imageCollection.items.length;
  allSelectionCheckbox.disabled = busy || imageCollection.items.length === 0;
  allSelectionCheckbox.title = t(allSelectionCheckbox.checked ? "clearAllTitle" : "selectAllTitle");
  allSelectionCheckbox.setAttribute("aria-label", t(allSelectionCheckbox.checked ? "clearAll" : "selectAll"));
  resetOrderButton.disabled = busy || imageCollection.matchesInitialOrderAndSelection();
  exportButton.disabled = busy || !imageCollection.hasSelection;
  imageListView.render(pendingExport ? new Set(pendingExport.failed.keys()) : undefined, sourcePreview());
  viewerController.render();
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
  onExport() { void pdfExportController?.export(); },
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
pdfExportController = createPdfExportController({
  getSelectedItems: () => imageCollection.selectedItems,
  getFilename: pdfFilename,
  getSourcePage(firstSelected, filename) {
    return includeSourcePage.checked
      ? {heading: t("sourceHeading"), filename, url: firstSelected.sourcePage}
      : undefined;
  },
  isBusy: () => busy,
  isDisposed: () => disposed,
  onBusyChange: setBusy,
  onStatus: setStatus,
  onCloseViewer: () => viewerController.setOpen(false),
  onClearSourceUrl: clearSourceUrl,
  onScrollToFailures() {
    failuresElement.scrollIntoView({block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth"});
  },
});

scanButton.addEventListener("click", () => { void startScan(); });
sourceDrop.addEventListener("click", showSourceInput);
sourceUrl.addEventListener("input", updateSourceDrop);
sourceUrl.addEventListener("blur", hideSourceInput);
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter") void startScan(); });
function isPageUrlDrag(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types.includes("text/uri-list") || event.dataTransfer?.types.includes("text/plain"));
}
function clearDropFeedback(): void {
  urlDropOverlay.hidden = true;
}
let urlDragDepth = 0;
document.addEventListener("dragenter", event => {
  if (isPageUrlDrag(event) && !imageListView.isDragging) urlDragDepth += 1;
});
document.addEventListener("dragleave", event => {
  if (!isPageUrlDrag(event) && urlDragDepth === 0) return;
  urlDragDepth = Math.max(0, urlDragDepth - 1);
  if (urlDragDepth === 0) clearDropFeedback();
});
document.addEventListener("dragover", event => {
  if (busy || imageListView.isDragging || !isPageUrlDrag(event)) {
    clearDropFeedback();
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  urlDropOverlay.hidden = false;
});
document.addEventListener("drop", event => {
  urlDragDepth = 0;
  clearDropFeedback();
  const dropped = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain") || "";
  const url = dropped.split(/\r?\n/).find(line => line && !line.startsWith("#"))?.trim();
  if (!url || !isWebUrl(url)) return;
  event.preventDefault();
  if (busy || imageListView.isDragging) return;
  sourceUrl.value = url;
  hideSourceInput();
  void startScan();
});
exportButton.addEventListener("click", () => { void pdfExportController?.export(); });
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
  pdfExportController?.clear();
  imageListView.clearVisibleGroups();
  viewerController.setOpen(false);
  viewerController.clearCurrentPage();
  scanState = "initial";
  pageTitle = t("imageFallback");
  setStatus("", "info");
  render();
});

updateSourceDrop();
render();
