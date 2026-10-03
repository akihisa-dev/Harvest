import { individualFilename, saveFilesIndividually } from "../core/export-files.js";
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
import { createSourceInputController } from "./source-input-controller.js";
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
const sourceInput = createSourceInputController({
    input: sourceUrl,
    display: sourceDrop,
    dropOverlay: urlDropOverlay,
    placeholder: t("sourceDrop"),
    getResultFilename: resultFilename,
    isBusy: () => busy,
    isReordering: () => imageListView.isDragging,
    onScan: () => startScan(),
});
function setStatus(message, state = "info", progress = "") {
    status = { message, state, progress };
    appView.renderProgress({ export: exportSession.state, busy, status });
}
function setBusy(value) {
    busy = value;
    collectionController.publishState();
    render();
}
function scrollToFailures() {
    failuresElement.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
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
function resultFilename() {
    const format = exportSession.format;
    if (format === "pdf")
        return pdfFilename();
    const count = exportSelectedItems().length;
    if (!saveFilesIndividually(format, count))
        return zipFilename();
    const first = `${"1".padStart(Math.max(3, String(count).length), "0")}.${format}`;
    return individualFilename(zipFilename(), first, count);
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
    sourceInput.render();
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
        sourceInput.setDraft(url);
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
    onClearSourceUrl: sourceInput.clearAfterExport,
    onScrollToFailures: scrollToFailures,
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
    onClearSourceUrl: sourceInput.clearAfterExport,
    onScrollToFailures: scrollToFailures,
});
scanSessionController = createScanSessionController({
    collection: imageCollection,
    getEnteredUrl: () => sourceInput.enteredUrl,
    getCollectionSession: () => collectionController.session,
    clearAnalyzedUrl: collectionController.clearAnalyzedUrl,
    markAnalyzedUrl: collectionController.markAnalyzedUrl,
    isBusy: () => busy,
    isDisposed: () => disposed,
    onHideSourceInput: sourceInput.hide,
    onShowSourceInput: sourceInput.show,
    onBusyChange: setBusy,
    onStatus: setStatus,
    onResults(nextPageTitle, initialGroup, sourcePage) {
        exportSession.setFormat(initialExportFormat(imageCollection.items, loadExportPreferences().format));
        pageTitle = nextPageTitle;
        sourceInput.commitResult(sourcePage);
        imagePreviewLoader.clear();
        imageListView.clearVideoSizes();
        exportSession.clear();
        imageListView.showInitialGroup(initialGroup);
        viewerController.setOpen(false);
        viewerController.clearCurrentPage();
    },
});
scanButton.addEventListener("click", () => startScan());
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
    imagePreviewLoader.clear();
    sourceInput.reset();
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
sourceInput.render();
render();
