function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/** Resolves the side-panel DOM contract in one place before controllers are connected. */
export function queryAppElements() {
  return {
    sourceUrl: required<HTMLInputElement>("#source-url"),
    sourceDrop: required<HTMLButtonElement>("#source-drop"),
    urlDropOverlay: required<HTMLDivElement>("#url-drop-overlay"),
    collectionButton: required<HTMLButtonElement>("#collection-toggle"),
    scanButton: required<HTMLButtonElement>("#scan"),
    exportButton: required<HTMLButtonElement>("#export"),
    exportMediaHint: required<HTMLParagraphElement>("#export-media-hint"),
    exportFormatInputs: [
      {format: "mp4" as const, input: required<HTMLInputElement>("#export-format-mp4")},
      {format: "gif" as const, input: required<HTMLInputElement>("#export-format-gif")},
      {format: "pdf" as const, input: required<HTMLInputElement>("#export-format-pdf")},
      {format: "jpg" as const, input: required<HTMLInputElement>("#export-format-jpg")},
      {format: "png" as const, input: required<HTMLInputElement>("#export-format-png")},
      {format: "jxl" as const, input: required<HTMLInputElement>("#export-format-jxl")},
    ],
    sourcePageOption: required<HTMLLabelElement>(".source-page-option"),
    includeSourcePage: required<HTMLInputElement>("#include-source-page"),
    viewerToggleButton: required<HTMLButtonElement>("#viewer-toggle"),
    viewerElement: required<HTMLElement>("#viewer"),
    resultsElement: required<HTMLElement>(".results"),
    viewerEmptyElement: required<HTMLParagraphElement>("#viewer-empty"),
    viewerPageElement: required<HTMLDivElement>("#viewer-page"),
    viewerPreviousButton: required<HTMLButtonElement>("#viewer-previous"),
    viewerNextButton: required<HTMLButtonElement>("#viewer-next"),
    viewerPositionElement: required<HTMLSpanElement>("#viewer-position"),
    viewerStageElement: required<HTMLDivElement>("#viewer-stage"),
    exportOverlay: required<HTMLDivElement>("#export-overlay"),
    viewerImageElement: required<HTMLImageElement>("#viewer-image"),
    viewerFilenameElement: required<HTMLParagraphElement>("#viewer-filename"),
    viewerThumbnailsElement: required<HTMLOListElement>("#viewer-thumbnails"),
    viewerZoomInButton: required<HTMLButtonElement>("#viewer-zoom-in"),
    viewerZoomOutButton: required<HTMLButtonElement>("#viewer-zoom-out"),
    viewerZoomResetButton: required<HTMLButtonElement>("#viewer-zoom-reset"),
    allVisibilityButton: required<HTMLButtonElement>("#all-visibility"),
    allSelectionCheckbox: required<HTMLInputElement>("#all-selection"),
    resetOrderButton: required<HTMLButtonElement>("#reset-order"),
    resetButton: required<HTMLButtonElement>("#reset"),
    failuresElement: required<HTMLElement>("#failures"),
    failedImagesElement: required<HTMLUListElement>("#failed-images"),
    imagesElement: required<HTMLOListElement>("#images"),
    groupsElement: required<HTMLDivElement>("#groups"),
    scanOverlay: required<HTMLElement>("#scan-overlay"),
    emptyElement: required<HTMLElement>("#empty"),
    emptyLogoElement: required<HTMLImageElement>("#empty-logo"),
    emptyMessageElement: required<HTMLParagraphElement>("#empty-message"),
    statusElement: required<HTMLParagraphElement>("#status"),
  };
}
