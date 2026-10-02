import { initialExportFormat, restoredExportFormat } from "../core/export-formats.js";
import { ImageCollection } from "../core/image-collection.js";
import { createCollectionController } from "./collection-controller.js";
import { prefersReducedMotion } from "./motion.js";
import { localizeErrorMessage, t } from "./localization.js";
import { createViewerController } from "./viewer-controller.js";
import { createImageListView } from "./image-list-view.js";
import { createImagePreviewLoader } from "./image-preview.js";
import { createPdfExportController } from "./pdf-export-controller.js";
import { createImageExportController } from "./image-export-controller.js";
import { queryAppElements } from "./app-elements.js";
import { createAppView } from "./app-view.js";
import { createExportSession } from "./export-session.js";
import { loadExportPreferences, saveExportFormat, saveSourcePagePreference } from "./export-preferences.js";
import { createSourcePreview, exportFileBaseName, imageFilename, } from "./export-presentation.js";
import { createScanSessionController } from "./scan-session-controller.js";
const elements = queryAppElements();
const { sourceUrl, sourceDrop, urlDropOverlay, collectionButton, scanButton, exportButton, exportFormatInputs, includeSourcePage, viewerToggleButton, viewerElement, resultsElement, viewerEmptyElement, viewerPageElement, viewerPreviousButton, viewerNextButton, viewerPositionElement, viewerStageElement, viewerImageElement, viewerFilenameElement, viewerThumbnailsElement, viewerZoomInButton, viewerZoomOutButton, viewerZoomResetButton, allVisibilityButton, allSelectionCheckbox, resetOrderButton, resetButton, failuresElement, imagesElement, groupsElement, } = elements;
const preferences = loadExportPreferences();
includeSourcePage.addEventListener("change", () => {
    exportSession.setIncludeSourcePage(includeSourcePage.checked);
    if (!saveSourcePagePreference(exportSession.includeSourcePage)) {
        exportSession.invalidateCompletion();
        setStatus(t("errorSavePreference"), "error");
    }
    render();
});
for (const { format, input } of exportFormatInputs) {
    input.addEventListener("change", () => {
        if (!input.checked)
            return;
        exportSession.setFormat(format);
        if (!saveExportFormat(format)) {
            exportSession.invalidateCompletion();
            setStatus(t("errorSaveFormatPreference"), "error");
        }
        selectionChanged();
    });
}
const imageCollection = new ImageCollection();
let pageTitle = t("imageFallback");
let resultSourceUrl = null;
let sourceDisplayCleared = false;
let busy = false;
let disposed = false;
let scanSessionController = null;
let pdfExportController = null;
let imageExportController = null;
const exportSession = createExportSession({
    format: restoredExportFormat(preferences.format),
    includeSourcePage: preferences.includeSourcePage,
    getSelectedItems: () => imageCollection.selectedItems,
    getPdfController: () => pdfExportController,
    getImageController: () => imageExportController,
    isBusy: () => busy,
});
const appView = createAppView(elements, item => imageCollection.positionOf(item));
let status = { message: "", state: "info", progress: "" };
const imagePreviewLoader = createImagePreviewLoader();
window.addEventListener?.("pagehide", () => {
    disposed = true;
    imagePreviewLoader.clear();
    collectionController.stop();
    scanSessionController?.abort();
    pdfExportController?.abort();
    imageExportController?.abort();
});
const imageListView = createImageListView({
    collection: imageCollection,
    allVisibilityButton,
    groupsElement,
    imagesElement,
    isBusy: () => busy,
    getFilename: imageFilename,
    previewLoader: imagePreviewLoader,
    onChange: selectionChanged,
});
function updateSourceDrop() {
    const draft = sourceUrl.value.trim();
    const url = sourceDisplayCleared && !draft ? "" : resultSourceUrl ?? draft;
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
    sourceDisplayCleared = true;
    sourceUrl.value = "";
    hideSourceInput();
}
function setStatus(message, state = "info", progress = "") {
    status = { message, state, progress };
    appView.renderProgress({ export: exportSession.state, busy, status });
}
function setBusy(value) {
    busy = value;
    collectionController.publishState();
    render();
}
function fileBaseName() {
    return exportFileBaseName(pageTitle, t("imageFallback"));
}
function pdfFilename() {
    return `${fileBaseName()}.pdf`;
}
function zipFilename() {
    return `${fileBaseName()}.zip`;
}
/** A local preview only; the PDF itself continues to contain selectable text. */
function sourcePreview() {
    return createSourcePreview(exportSelectedItems(), exportSession.format, exportSession.includeSourcePage, t("sourceHeading"), pdfFilename());
}
function exportSelectedItems() {
    return exportSession.selectedItems;
}
function viewerPages() {
    const selected = exportSelectedItems();
    const source = sourcePreview();
    return source ? [...selected, source] : selected;
}
function previewName(item) {
    return item.url.startsWith("data:image/svg+xml;") ? "Source" : imageFilename(item.url);
}
function render() {
    const exportState = exportSession.state;
    appView.render({
        export: exportState,
        busy,
        status,
        items: imageCollection.items,
        selectedCount: imageCollection.selectedItems.length,
        initialOrderAndSelection: imageCollection.matchesInitialOrderAndSelection(),
        scanState: scanSessionController?.state ?? "initial",
        scanRunning: scanSessionController?.isRunning ?? false,
    });
    const pending = exportState.view.pending;
    imageListView.render(pending ? new Set(pending.failed.keys()) : undefined, sourcePreview());
    viewerController.render();
}
function selectionChanged() {
    if (exportSession.selectionChanged() && !busy)
        setStatus(t("selectionChanged"), "info");
    collectionController.publishState();
    render();
}
function startExport() {
    void exportSession.start();
}
function startScan(collectionLink) {
    if (busy)
        return;
    exportSession.invalidateCompletion();
    void scanSessionController?.start(collectionLink);
}
const collectionController = createCollectionController({
    button: collectionButton,
    startLabel: t("collectionStart"),
    stopLabel: t("collectionStop"),
    noPageError: t("errorCollectionPage"),
    isBusy: () => busy,
    isDisposed: () => disposed,
    canExport: () => exportSelectedItems().length > 0,
    onScanUrl(url) {
        sourceUrl.value = url;
        updateSourceDrop();
        startScan(url);
    },
    onExport: startExport,
    onError(error) {
        exportSession.invalidateCompletion();
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
    previewLoader: imagePreviewLoader,
    onChange: render,
});
pdfExportController = createPdfExportController({
    getSelectedItems: exportSelectedItems,
    getFilename: pdfFilename,
    getSourcePage(firstSelected, filename) {
        return exportSession.includeSourcePage
            ? { heading: t("sourceHeading"), filename, url: firstSelected.sourcePage }
            : undefined;
    },
    isBusy: () => busy,
    isDisposed: () => disposed,
    onBusyChange: setBusy,
    onStatus: setStatus,
    onCompleted: exportSession.complete,
    onCloseViewer: () => viewerController.setOpen(false),
    onClearSourceUrl: clearSourceUrl,
    onScrollToFailures() {
        failuresElement.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
    },
});
imageExportController = createImageExportController({
    getSelectedItems: exportSelectedItems,
    getZipFilename: zipFilename,
    isBusy: () => busy,
    isDisposed: () => disposed,
    onBusyChange: setBusy,
    onStatus: setStatus,
    onCompleted: exportSession.complete,
    onCloseViewer: () => viewerController.setOpen(false),
    onClearSourceUrl: clearSourceUrl,
    onScrollToFailures() {
        failuresElement.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
    },
});
scanSessionController = createScanSessionController({
    collection: imageCollection,
    getEnteredUrl: () => sourceUrl.value.trim(),
    getCollectionSession: () => collectionController.session,
    clearAnalyzedUrl: collectionController.clearAnalyzedUrl,
    markAnalyzedUrl: collectionController.markAnalyzedUrl,
    isBusy: () => busy,
    isDisposed: () => disposed,
    onHideSourceInput: hideSourceInput,
    onShowSourceInput: showSourceInput,
    onBusyChange: setBusy,
    onStatus: setStatus,
    onResults(nextPageTitle, initialGroup, sourcePage) {
        exportSession.setFormat(initialExportFormat(imageCollection.items, loadExportPreferences().format));
        resultSourceUrl = sourcePage;
        sourceDisplayCleared = false;
        updateSourceDrop();
        imagePreviewLoader.clear();
        pageTitle = nextPageTitle;
        exportSession.clear();
        imageListView.showInitialGroup(initialGroup);
        viewerController.setOpen(false);
        viewerController.clearCurrentPage();
    },
});
scanButton.addEventListener("click", () => startScan());
sourceDrop.addEventListener("click", showSourceInput);
sourceUrl.addEventListener("input", updateSourceDrop);
sourceUrl.addEventListener("blur", hideSourceInput);
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter")
    startScan(); });
function isWebUrl(url) {
    return url !== undefined && /^https?:\/\//i.test(url);
}
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
    startScan();
});
exportButton.addEventListener("click", () => {
    if (exportSession.state.view.phase === "running") {
        exportSession.abort();
        return;
    }
    if (!busy)
        startExport();
});
allSelectionCheckbox.addEventListener("change", () => {
    if (busy)
        return;
    imageCollection.setAllSelected(allSelectionCheckbox.checked);
    selectionChanged();
});
resetOrderButton.addEventListener("click", () => {
    if (busy || resetOrderButton.disabled)
        return;
    imageCollection.restoreInitialOrderAndSelection();
    selectionChanged();
});
resetButton.addEventListener("click", () => {
    if (busy)
        return;
    resultSourceUrl = null;
    imagePreviewLoader.clear();
    clearSourceUrl();
    collectionController.clearAnalyzedUrl();
    imageCollection.clear();
    exportSession.clear();
    imageListView.clearVisibleGroups();
    viewerController.setOpen(false);
    viewerController.clearCurrentPage();
    scanSessionController?.reset();
    pageTitle = t("imageFallback");
    setStatus("", "info");
    collectionController.publishState();
    render();
});
updateSourceDrop();
render();
