import { defaultDisplayedImageGroup, normalizeImageUrls } from "../core/images.js";
import { ImageCollection } from "../core/image-collection.js";
import { createSourcePageLayout } from "../core/pdf.js";
import { createCollectionController } from "./collection-controller.js";
import { scanTab, scanUrl } from "./page-access.js";
import { prefersReducedMotion, setMotionText } from "./motion.js";
import { localizeErrorMessage, t } from "./localization.js";
import { createViewerController } from "./viewer-controller.js";
import { createImageListView } from "./image-list-view.js";
import { createPdfExportController } from "./pdf-export-controller.js";
import { createImageExportController } from "./image-export-controller.js";
const sourceUrl = required("#source-url");
const sourceDrop = required("#source-drop");
const urlDropOverlay = required("#url-drop-overlay");
const collectionButton = required("#collection-toggle");
const scanButton = required("#scan");
const exportButton = required("#export");
const exportFormat = required("#export-format");
const sourcePageOption = required(".source-page-option");
const includeSourcePage = required("#include-source-page");
const sourcePagePreferenceKey = "harvest.includeSourcePage";
const exportFormatPreferenceKey = "harvest.exportFormat";
function isExportFormat(value) {
    return value === "pdf" || value === "jpg" || value === "png" || value === "jxl";
}
let selectedExportFormat = "pdf";
try {
    const storedFormat = localStorage.getItem(exportFormatPreferenceKey);
    if (storedFormat && isExportFormat(storedFormat))
        selectedExportFormat = storedFormat;
}
catch { /* Keep PDF as the default when browser storage is unavailable. */ }
exportFormat.value = selectedExportFormat;
try {
    includeSourcePage.checked = localStorage.getItem(sourcePagePreferenceKey) === "true";
}
catch {
    includeSourcePage.checked = false;
}
includeSourcePage.addEventListener("change", () => {
    try {
        localStorage.setItem(sourcePagePreferenceKey, String(includeSourcePage.checked));
    }
    catch {
        setStatus(t("errorSavePreference"), "error");
    }
    render();
});
exportFormat.addEventListener("change", () => {
    if (!isExportFormat(exportFormat.value)) {
        exportFormat.value = selectedExportFormat;
        return;
    }
    selectedExportFormat = exportFormat.value;
    try {
        localStorage.setItem(exportFormatPreferenceKey, selectedExportFormat);
    }
    catch {
        setStatus(t("errorSaveFormatPreference"), "error");
    }
    render();
});
const viewerToggleButton = required("#viewer-toggle");
const viewerElement = required("#viewer");
const resultsElement = required(".results");
const viewerEmptyElement = required("#viewer-empty");
const viewerPageElement = required("#viewer-page");
const viewerPreviousButton = required("#viewer-previous");
const viewerNextButton = required("#viewer-next");
const viewerPositionElement = required("#viewer-position");
const viewerStageElement = required("#viewer-stage");
const exportOverlay = required("#export-overlay");
const viewerImageElement = required("#viewer-image");
const viewerFilenameElement = required("#viewer-filename");
const viewerThumbnailsElement = required("#viewer-thumbnails");
const viewerZoomInButton = required("#viewer-zoom-in");
const viewerZoomOutButton = required("#viewer-zoom-out");
const viewerZoomResetButton = required("#viewer-zoom-reset");
const allVisibilityButton = required("#all-visibility");
const allSelectionCheckbox = required("#all-selection");
const resetOrderButton = required("#reset-order");
const resetButton = required("#reset");
const failuresElement = required("#failures");
const failedImagesElement = required("#failed-images");
const imagesElement = required("#images");
const groupsElement = required("#groups");
const scanOverlay = required("#scan-overlay");
const emptyElement = required("#empty");
const emptyLogoElement = required("#empty-logo");
const emptyMessageElement = required("#empty-message");
const statusElement = required("#status");
const imageCollection = new ImageCollection();
let completedExport = null;
let pageTitle = t("imageFallback");
let busy = false;
let disposed = false;
let scanController = null;
let pdfExportController = null;
let imageExportController = null;
window.addEventListener?.("pagehide", () => {
    disposed = true;
    collectionController.stop();
    scanController?.abort();
    pdfExportController?.abort();
    imageExportController?.abort();
});
let scanState = "initial";
const imageListView = createImageListView({
    collection: imageCollection,
    allVisibilityButton,
    groupsElement,
    imagesElement,
    isBusy: () => busy,
    getFilename: imageFilename,
    onChange: render,
});
function required(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing element: ${selector}`);
    return element;
}
function isWebUrl(url) {
    return url !== undefined && /^https?:\/\//i.test(url);
}
function updateSourceDrop() {
    const url = sourceUrl.value.trim();
    sourceDrop.textContent = url || t("sourceDrop");
    sourceDrop.dataset["hasUrl"] = String(Boolean(url));
}
function showSourceInput() {
    if (busy)
        return;
    sourceDrop.hidden = true;
    sourceUrl.hidden = false;
    sourceUrl.focus();
    sourceUrl.select();
}
function hideSourceInput() {
    sourceUrl.hidden = true;
    sourceDrop.hidden = false;
    updateSourceDrop();
}
function clearSourceUrl() {
    sourceUrl.value = "";
    hideSourceInput();
}
function setStatus(message, state = "info", progress = "") {
    if (state === "success") {
        completedExport = { format: selectedExportFormat, selected: [...imageCollection.selectedItems] };
        setMotionText(statusElement, "");
        statusElement.setAttribute("aria-label", "");
        statusElement.dataset["state"] = state;
        statusElement.title = "";
        return;
    }
    completedExport = null;
    setMotionText(statusElement, state === "busy" ? progress : message);
    statusElement.setAttribute("aria-label", state === "busy" ? message : "");
    statusElement.dataset["state"] = state;
    statusElement.title = message;
    const activeExport = selectedExportFormat === "pdf" ? pdfExportController : imageExportController;
    if (activeExport?.isRunning && state === "busy") {
        exportButton.textContent = progress;
        exportButton.setAttribute("aria-label", message);
    }
}
function setBusy(value) {
    busy = value;
    scanButton.disabled = value;
    sourceDrop.disabled = value;
    sourceUrl.disabled = value;
    exportFormat.disabled = value;
    includeSourcePage.disabled = value;
    resetButton.disabled = value;
    exportButton.disabled = value || !imageCollection.hasSelection;
    render();
}
async function startScan(collectionLink) {
    if (busy)
        return;
    const session = collectionController.session;
    const enteredUrl = sourceUrl.value.trim();
    let targetUrl = "";
    if (enteredUrl) {
        try {
            const parsed = new URL(enteredUrl);
            if (!isWebUrl(parsed.href))
                throw new Error();
            targetUrl = parsed.href;
        }
        catch {
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
        }
        else {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab?.id === undefined || !isWebUrl(activeTab.url)) {
                throw new Error(t("errorNoActivePage"));
            }
            result = await scanTab(activeTab.id, controller.signal);
        }
        if (disposed || controller.signal.aborted || scanController !== controller)
            return;
        const urls = normalizeImageUrls(result.images, result.url);
        // Publish only a complete scan. A rejected scan keeps the previous working set.
        imageCollection.replace(urls, result.url);
        if (collectionLink)
            collectionController.markAnalyzedUrl(collectionLink, session);
        pageTitle = result.title || t("imageFallback");
        pdfExportController?.clear();
        imageExportController?.clear();
        const initialGroup = defaultDisplayedImageGroup(imageCollection.groups);
        imageListView.showInitialGroup(initialGroup);
        viewerController.setOpen(false);
        viewerController.clearCurrentPage();
        scanState = imageCollection.items.length ? "results" : "empty";
        setStatus(imageCollection.items.length ? "" : t("scanEmpty"), "info");
    }
    catch (error) {
        if (disposed || controller.signal.aborted || scanController !== controller)
            return;
        scanState = imageCollection.items.length ? "results" : "error";
        const reason = error instanceof Error ? localizeErrorMessage(error.message, "errorPageRead", true) : t("errorPageRead");
        setStatus(reason + (imageCollection.items.length ? t("previousResults") : ""), "error");
    }
    finally {
        if (scanController === controller) {
            scanController = null;
            if (!disposed)
                setBusy(false);
        }
    }
}
function imageFilename(url) {
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
    }
    catch {
        return url;
    }
}
function exportFileBaseName() {
    return pageTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || t("imageFallback");
}
function pdfFilename() {
    return `${exportFileBaseName()}.pdf`;
}
function zipFilename() {
    return `${exportFileBaseName()}.zip`;
}
/** A local preview only; the PDF itself continues to contain selectable text. */
function sourcePreview() {
    const first = imageCollection.selectedItems[0];
    if (selectedExportFormat !== "pdf" || !includeSourcePage.checked || !first)
        return null;
    const layout = createSourcePageLayout({ heading: t("sourceHeading"), filename: pdfFilename(), url: first.sourcePage });
    const escape = (value) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
    const text = layout.lines.map(line => {
        const textLength = line.text ? ` textLength="${line.width.toFixed(3)}" lengthAdjust="spacingAndGlyphs"` : "";
        return `<text x="${line.x.toFixed(3)}" y="${(layout.height - line.y).toFixed(3)}" font-size="${line.size}"${textLength} xml:space="preserve">${escape(line.text)}</text>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}"><rect width="${layout.width}" height="${layout.height}" fill="white"/><g fill="black" font-family="monospace">${text}</g></svg>`;
    return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, sourcePage: first.sourcePage, selected: true };
}
function viewerPages() {
    const selected = imageCollection.selectedItems;
    const source = sourcePreview();
    return source ? [...selected, source] : selected;
}
function previewName(item) {
    return item.url.startsWith("data:image/svg+xml;") ? "Source" : imageFilename(item.url);
}
function render() {
    collectionController.publishState();
    const selected = imageCollection.selectedItems;
    const selectedCount = selected.length;
    const pdfSelectionChanged = pdfExportController?.discardIfSelectionChanged(selected) ?? false;
    const imageSelectionChanged = imageExportController?.discardIfSelectionChanged(selected) ?? false;
    const selectionChanged = pdfSelectionChanged || imageSelectionChanged;
    if (selectionChanged && !busy)
        setStatus(t("selectionChanged"), "info");
    const imagePending = imageExportController?.pending;
    const pendingExport = selectedExportFormat === "pdf"
        ? pdfExportController?.pending ?? null
        : imagePending?.format === selectedExportFormat ? imagePending : null;
    const exportRunning = selectedExportFormat === "pdf"
        ? pdfExportController?.isRunning ?? false
        : imageExportController?.isRunning ?? false;
    const exportProgress = selectedExportFormat === "pdf"
        ? pdfExportController?.progress ?? ""
        : imageExportController?.progress ?? "";
    const exportSaved = completedExport?.format === selectedExportFormat
        && completedExport.selected.length === selected.length
        && completedExport.selected.every((item, index) => item === selected[index]);
    scanButton.dataset["scanning"] = String(scanController !== null);
    scanButton.textContent = scanController ? "" : t("scan");
    if (scanController)
        scanButton.setAttribute("aria-label", t("scanBusy"));
    else
        scanButton.removeAttribute("aria-label");
    exportButton.dataset["saving"] = String(exportRunning);
    exportButton.dataset["saved"] = String(exportSaved && !exportRunning);
    if (!exportRunning)
        exportButton.removeAttribute("aria-label");
    if (exportRunning)
        exportButton.textContent = exportProgress;
    else if (pendingExport?.failed.size)
        exportButton.textContent = t("exportRetry");
    else if (exportSaved)
        exportButton.textContent = t("exportSaved");
    else if (selected.length)
        exportButton.textContent = t("exportAction", { format: selectedExportFormat.toUpperCase() });
    else
        exportButton.textContent = t("save");
    exportButton.title = exportButton.textContent;
    sourcePageOption.hidden = selectedExportFormat !== "pdf";
    exportFormat.value = selectedExportFormat;
    failuresElement.hidden = !pendingExport?.failed.size;
    failedImagesElement.replaceChildren(...(pendingExport?.selected.filter(item => pendingExport.failed.has(item)) ?? []).map(item => {
        const row = document.createElement("li");
        row.textContent = t("failedRow", {
            index: imageCollection.positionOf(item) + 1,
            filename: imageFilename(item.url),
            reason: localizeErrorMessage(pendingExport.failed.get(item) ?? t(selectedExportFormat === "pdf" ? "errorPdfFetch" : "errorImageConvert"), selectedExportFormat === "pdf" ? "errorPdfFetch" : "errorImageConvert"),
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
    exportFormat.disabled = busy;
    imageListView.render(pendingExport ? new Set(pendingExport.failed.keys()) : undefined, sourcePreview());
    viewerController.render();
}
function startExport() {
    completedExport = null;
    if (selectedExportFormat === "pdf")
        void pdfExportController?.export();
    else
        void imageExportController?.export(selectedExportFormat);
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
    onExport: startExport,
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
            ? { heading: t("sourceHeading"), filename, url: firstSelected.sourcePage }
            : undefined;
    },
    isBusy: () => busy,
    isDisposed: () => disposed,
    onBusyChange: setBusy,
    onStatus: setStatus,
    onCloseViewer: () => viewerController.setOpen(false),
    onClearSourceUrl: clearSourceUrl,
    onScrollToFailures() {
        failuresElement.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
    },
});
imageExportController = createImageExportController({
    getSelectedItems: () => imageCollection.selectedItems,
    getZipFilename: zipFilename,
    isBusy: () => busy,
    isDisposed: () => disposed,
    onBusyChange: setBusy,
    onStatus: setStatus,
    onCloseViewer: () => viewerController.setOpen(false),
    onClearSourceUrl: clearSourceUrl,
    onScrollToFailures() {
        failuresElement.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
    },
});
scanButton.addEventListener("click", () => { void startScan(); });
sourceDrop.addEventListener("click", showSourceInput);
sourceUrl.addEventListener("input", updateSourceDrop);
sourceUrl.addEventListener("blur", hideSourceInput);
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter")
    void startScan(); });
function isPageUrlDrag(event) {
    return Boolean(event.dataTransfer?.types.includes("text/uri-list") || event.dataTransfer?.types.includes("text/plain"));
}
function clearDropFeedback() {
    urlDropOverlay.hidden = true;
}
let urlDragDepth = 0;
document.addEventListener("dragenter", event => {
    if (isPageUrlDrag(event) && !imageListView.isDragging)
        urlDragDepth += 1;
});
document.addEventListener("dragleave", event => {
    if (!isPageUrlDrag(event) && urlDragDepth === 0)
        return;
    urlDragDepth = Math.max(0, urlDragDepth - 1);
    if (urlDragDepth === 0)
        clearDropFeedback();
});
document.addEventListener("dragover", event => {
    if (busy || imageListView.isDragging || !isPageUrlDrag(event)) {
        clearDropFeedback();
        return;
    }
    event.preventDefault();
    if (event.dataTransfer)
        event.dataTransfer.dropEffect = "copy";
    urlDropOverlay.hidden = false;
});
document.addEventListener("drop", event => {
    urlDragDepth = 0;
    clearDropFeedback();
    const dropped = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain") || "";
    const url = dropped.split(/\r?\n/).find(line => line && !line.startsWith("#"))?.trim();
    if (!url || !isWebUrl(url))
        return;
    event.preventDefault();
    if (busy || imageListView.isDragging)
        return;
    sourceUrl.value = url;
    hideSourceInput();
    void startScan();
});
exportButton.addEventListener("click", startExport);
allSelectionCheckbox.addEventListener("change", () => {
    if (busy)
        return;
    imageCollection.setAllSelected(allSelectionCheckbox.checked);
    render();
});
resetOrderButton.addEventListener("click", () => {
    if (busy || resetOrderButton.disabled)
        return;
    imageCollection.restoreInitialOrderAndSelection();
    render();
});
resetButton.addEventListener("click", () => {
    if (busy)
        return;
    clearSourceUrl();
    collectionController.clearAnalyzedUrl();
    imageCollection.clear();
    pdfExportController?.clear();
    imageExportController?.clear();
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
