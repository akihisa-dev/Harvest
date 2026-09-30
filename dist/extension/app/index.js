import { ImageCollection } from "../core/image-collection.js";
import { createCollectionController } from "./collection-controller.js";
import { prefersReducedMotion, setMotionText } from "./motion.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { createViewerController } from "./viewer-controller.js";
import { createImageListView } from "./image-list-view.js";
import { createImagePreviewLoader } from "./image-preview.js";
import { createPdfExportController } from "./pdf-export-controller.js";
import { createImageExportController } from "./image-export-controller.js";
import { queryAppElements } from "./app-elements.js";
import { loadExportPreferences, saveExportFormat, saveSourcePagePreference } from "./export-preferences.js";
import { createSourcePreview, deriveExportViewState, exportFileBaseName, imageFilename, } from "./export-presentation.js";
import { createScanSessionController } from "./scan-session-controller.js";
const { sourceUrl, sourceDrop, urlDropOverlay, collectionButton, scanButton, exportButton, exportFormatInputs, sourcePageOption, includeSourcePage, viewerToggleButton, viewerElement, resultsElement, viewerEmptyElement, viewerPageElement, viewerPreviousButton, viewerNextButton, viewerPositionElement, viewerStageElement, exportOverlay, viewerImageElement, viewerFilenameElement, viewerThumbnailsElement, viewerZoomInButton, viewerZoomOutButton, viewerZoomResetButton, allVisibilityButton, allSelectionCheckbox, resetOrderButton, resetButton, failuresElement, failedImagesElement, imagesElement, groupsElement, scanOverlay, emptyElement, emptyLogoElement, emptyMessageElement, statusElement, } = queryAppElements();
const preferences = loadExportPreferences();
let selectedExportFormat = preferences.format;
for (const { format, input } of exportFormatInputs)
    input.checked = format === selectedExportFormat;
includeSourcePage.checked = preferences.includeSourcePage;
includeSourcePage.addEventListener("change", () => {
    if (!saveSourcePagePreference(includeSourcePage.checked))
        setStatus(t("errorSavePreference"), "error");
    render();
});
for (const { format, input } of exportFormatInputs) {
    input.addEventListener("change", () => {
        if (!input.checked)
            return;
        selectedExportFormat = format;
        if (!saveExportFormat(selectedExportFormat))
            setStatus(t("errorSaveFormatPreference"), "error");
        render();
    });
}
const imageCollection = new ImageCollection();
let completedExport = null;
let pageTitle = t("imageFallback");
let busy = false;
let disposed = false;
let scanSessionController = null;
let pdfExportController = null;
let imageExportController = null;
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
    onChange: render,
});
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
        completedExport = {
            format: selectedExportFormat,
            selected: [...imageCollection.selectedItems],
            includeSourcePage: includeSourcePage.checked,
        };
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
        exportButton.title = `${progress} — ${t("exportCancelHint")}`;
        exportButton.setAttribute("aria-label", `${message} ${t("exportCancelHint")}`);
    }
}
function setBusy(value) {
    busy = value;
    scanButton.disabled = value;
    sourceDrop.disabled = value;
    sourceUrl.disabled = value;
    for (const { input } of exportFormatInputs)
        input.disabled = value;
    includeSourcePage.disabled = value;
    resetButton.disabled = value;
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
    return createSourcePreview(imageCollection.selectedItems, selectedExportFormat, includeSourcePage.checked, t("sourceHeading"), pdfFilename());
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
    const scanState = scanSessionController?.state ?? "initial";
    const scanRunning = scanSessionController?.isRunning ?? false;
    const selected = imageCollection.selectedItems;
    const selectedCount = selected.length;
    const pdfSelectionChanged = pdfExportController?.discardIfSelectionChanged(selected) ?? false;
    const imageSelectionChanged = imageExportController?.discardIfSelectionChanged(selected) ?? false;
    const selectionChanged = pdfSelectionChanged || imageSelectionChanged;
    if (selectionChanged && !busy)
        setStatus(t("selectionChanged"), "info");
    const exportState = deriveExportViewState({
        format: selectedExportFormat,
        includeSourcePage: includeSourcePage.checked,
        selected,
        completed: completedExport,
        pdfPending: pdfExportController?.pending ?? null,
        imagePending: imageExportController?.pending ?? null,
        pdfRunning: pdfExportController?.isRunning ?? false,
        imageRunning: imageExportController?.isRunning ?? false,
        pdfProgress: pdfExportController?.progress ?? "",
        imageProgress: imageExportController?.progress ?? "",
    });
    const pendingExport = exportState.pending;
    const exportRunning = exportState.phase === "running";
    const exportSaved = exportState.phase === "saved";
    scanButton.dataset["scanning"] = String(scanRunning);
    scanButton.textContent = scanRunning ? "" : t("scan");
    if (scanRunning)
        scanButton.setAttribute("aria-label", t("scanBusy"));
    else
        scanButton.removeAttribute("aria-label");
    exportButton.dataset["saving"] = String(exportRunning);
    exportButton.dataset["saved"] = String(exportSaved && !exportRunning);
    if (!exportRunning)
        exportButton.removeAttribute("aria-label");
    if (exportRunning)
        exportButton.textContent = exportState.progress;
    else if (exportState.phase === "retry-required")
        exportButton.textContent = t("exportRetry");
    else if (exportSaved)
        exportButton.textContent = t("exportSaved", { count: selectedCount, plural: formatPlural(selectedCount) });
    else if (selected.length)
        exportButton.textContent = t("exportAction", { format: selectedExportFormat.toUpperCase() });
    else
        exportButton.textContent = t("save");
    exportButton.title = exportRunning
        ? `${exportState.progress} — ${t("exportCancelHint")}`
        : exportButton.textContent;
    sourcePageOption.hidden = selectedExportFormat !== "pdf";
    for (const { format, input } of exportFormatInputs)
        input.checked = format === selectedExportFormat;
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
    exportButton.disabled = (busy && !exportRunning) || !imageCollection.hasSelection;
    for (const { input } of exportFormatInputs)
        input.disabled = busy;
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
        void scanSessionController?.start(url);
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
    previewLoader: imagePreviewLoader,
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
    onResults(nextPageTitle, initialGroup) {
        imagePreviewLoader.clear();
        pageTitle = nextPageTitle;
        pdfExportController?.clear();
        imageExportController?.clear();
        imageListView.showInitialGroup(initialGroup);
        viewerController.setOpen(false);
        viewerController.clearCurrentPage();
    },
});
scanButton.addEventListener("click", () => { void scanSessionController?.start(); });
sourceDrop.addEventListener("click", showSourceInput);
sourceUrl.addEventListener("input", updateSourceDrop);
sourceUrl.addEventListener("blur", hideSourceInput);
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter")
    void scanSessionController?.start(); });
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
    void scanSessionController?.start();
});
exportButton.addEventListener("click", () => {
    const activeExport = selectedExportFormat === "pdf" ? pdfExportController : imageExportController;
    if (activeExport?.isRunning) {
        activeExport.abort();
        return;
    }
    if (!busy)
        startExport();
});
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
    imagePreviewLoader.clear();
    clearSourceUrl();
    collectionController.clearAnalyzedUrl();
    imageCollection.clear();
    pdfExportController?.clear();
    imageExportController?.clear();
    imageListView.clearVisibleGroups();
    viewerController.setOpen(false);
    viewerController.clearCurrentPage();
    scanSessionController?.reset();
    pageTitle = t("imageFallback");
    setStatus("", "info");
    render();
});
updateSourceDrop();
render();
