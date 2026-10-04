import type { ImageItem } from "../../core/images.js";
import { ImageCollection } from "../../core/image-collection.js";
import { createCollectionController } from "./collection-controller.js";
import { prefersReducedMotion } from "./motion.js";
import { localizeErrorMessage, t } from "./localization.js";
import { createViewerController } from "./viewer-controller.js";
import { createImageListView } from "./image-list-view.js";
import { createImagePreviewLoader } from "../media/image-preview.js";
import {createMixedExportController} from "./mixed-export-controller.js";
import type { AppElements } from "./app-elements.js";
import { createAppView, type AppStatus } from "./app-view.js";
import {createSplitExportSession} from "./split-export-session.js";
import {loadSplitExportPreferences} from "../browser/split-export-preferences.js";
import {
  createExportPresentation,
  imageFilename,
} from "./export-presentation.js";
import { createScanSessionController } from "./scan-session-controller.js";
import { createSourceInputController } from "./source-input-controller.js";
import { createResultSession } from "./result-session.js";
import { bindExportPreferences } from "./export-preferences-controller.js";
import type { ExportControllerOptions } from "./export-operation.js";

/** Creates one panel instance; its state and controller graph never escape to module globals. */
export function createPanelApplication(elements: AppElements) {
  const {
    sourceUrl, sourceDrop, urlDropOverlay, collectionButton, scanButton, exportButton,
    viewerToggleButton, viewerElement, resultsElement, viewerEmptyElement, viewerPageElement,
    viewerPreviousButton, viewerNextButton, viewerPositionElement, viewerStageElement,
    viewerImageElement, viewerFilenameElement, viewerThumbnailsElement, viewerZoomInButton,
    viewerZoomOutButton, viewerZoomResetButton, allVisibilityButton, allSelectionCheckbox,
    resetOrderButton, resetButton, failuresElement, imagesElement, groupsElement,
  } = elements;

  const preferences = loadSplitExportPreferences();
  const imageCollection = new ImageCollection();
  let busy = false;
  let disposed = false;
  const exportSession = createSplitExportSession({
    imageFormat: preferences.imageFormat,
    videoFormat: preferences.videoFormat,
    includeSourcePage: preferences.includeSourcePage,
    getSelectedItems: () => imageCollection.selectedItems,
    getController: () => mixedExportController,
    isBusy: () => busy,
  });
  const appView = createAppView(elements, item => imageCollection.positionOf(item));
  let status: AppStatus = {message: "", state: "info", progress: ""};
  const imagePreviewLoader = createImagePreviewLoader();
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
    getResultFilename: () => exportPresentation.resultFilename,
    isBusy: () => busy,
    isReordering: () => imageListView.isDragging,
    onScan: () => startScan(),
  });

  function setStatus(message: string, state: AppStatus["state"] = "info", progress = ""): void {
    status = {message, state, progress};
    appView.renderProgress({export: exportSession.state, busy, status});
  }

  function setBusy(value: boolean): void {
    busy = value;
    collectionController.publishState();
    render();
  }

  function scrollToFailures(): void {
    failuresElement.scrollIntoView({block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth"});
  }

  const exportPresentation = createExportPresentation({
    getTitle: () => results.title,
    getSelection: () => ({format: exportSession.format, resolvedImageFormat: exportSession.resolvedImageFormat, videoFormat: exportSession.videoFormat, includeSourcePage: exportSession.includeSourcePage, selected: exportSession.selectedItems}),
    fallbackTitle: t("imageFallback"),
    sourceHeading: t("sourceHeading"),
  });

  function exportSelectedItems(): readonly ImageItem[] {
    return exportSession.selectedItems;
  }

  function previewName(item: ImageItem): string {
    return item.url.startsWith("data:image/svg+xml;") ? "Source" : imageFilename(item.url);
  }

  function render(): void {
    sourceInput.render();
    const exportState = exportSession.state;
    appView.render({
      export: exportState,
      busy,
      status,
      items: imageCollection.items,
      selectedCount: imageCollection.selectedItems.length,
      initialOrderAndSelection: imageCollection.matchesInitialOrderAndSelection(),
      scanState: scanSessionController.state,
      scanRunning: scanSessionController.isRunning,
    });
    const pending = exportState.view.pending;
    imageListView.render(pending ? new Set(pending.failed.keys()) : undefined, exportPresentation.sourcePreview);
    viewerController.render();
  }

  function selectionChanged(): void {
    if (exportSession.selectionChanged() && !busy) setStatus(t("selectionChanged"), "info");
    collectionController.publishState();
    render();
  }

  function startExport(): void {
    void exportSession.start();
  }

  function startScan(collectionLink?: string): void {
    if (busy) return;
    exportSession.invalidateCompletion();
    void scanSessionController.start(collectionLink);
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
    getPages: () => exportPresentation.viewerPages,
    getPageLabel: previewName,
    isBusy: () => busy,
    getImageCount: () => imageCollection.items.length,
    previewLoader: imagePreviewLoader,
    onChange: render,
  });
  const exportOptions: ExportControllerOptions = {
    getSelectedItems: exportSelectedItems,
    isBusy: () => busy,
    isDisposed: () => disposed,
    onBusyChange: setBusy,
    onStatus: setStatus,
    onCompleted: exportSession.complete,
    onCloseViewer: () => viewerController.setOpen(false),
    onClearSourceUrl: sourceInput.clearAfterExport,
    onScrollToFailures: scrollToFailures,
  };
  const mixedExportController = createMixedExportController({
    ...exportOptions,
    getPdfFilename: () => exportPresentation.pdfFilename,
    getZipFilename: () => exportPresentation.zipFilename,
  });
  const results = createResultSession({
    collection: imageCollection,
    exportSession,
    sourceInput,
    imageList: imageListView,
    viewer: viewerController,
    previews: imagePreviewLoader,
    getPreferredFormat: () => loadSplitExportPreferences().imageFormat,
    preserveFormat: true,
    clearAnalyzedUrl: collectionController.clearAnalyzedUrl,
    resetScan: () => scanSessionController.reset(),
    fallbackTitle: t("imageFallback"),
  });
  const scanSessionController = createScanSessionController({
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
    onStatus: (message, state) => setStatus(message, state, state === "busy" && message !== t("scanBusy") ? message : ""),
    onResults: results.commit,
  });

  scanButton.addEventListener("click", () => {
    if (scanSessionController.isRunning) scanSessionController.stop();
    else startScan();
  });
  exportButton.addEventListener("click", () => {
    if (exportSession.state.view.phase === "running") {
      exportSession.abort();
      return;
    }
    if (!busy) startExport();
  });
  allSelectionCheckbox.addEventListener("change", () => {
    if (busy) return;
    imageCollection.setAllSelected(allSelectionCheckbox.checked);
    selectionChanged();
  });
  resetOrderButton.addEventListener("click", () => {
    if (busy || resetOrderButton.disabled) return;
    imageCollection.restoreInitialOrderAndSelection();
    selectionChanged();
  });
  function reset(): void {
    if (busy) return;
    results.reset();
    setStatus("", "info");
    collectionController.publishState();
    render();
  }

  resetButton.addEventListener("click", reset);

  bindExportPreferences({elements, session: exportSession, onStatus: setStatus, onSelectionChange: selectionChanged, onRender: render});
  sourceInput.render();
  render();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      imagePreviewLoader.clear();
      collectionController.stop();
      scanSessionController.abort();
      mixedExportController.abort();
      imageListView.clearVideoSizes();
    },
  };
}
