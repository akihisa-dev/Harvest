function required(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing element: ${selector}`);
    return element;
}
/** Resolves the side-panel DOM contract in one place before controllers are connected. */
export function queryAppElements() {
    return {
        sourceUrl: required("#source-url"),
        sourceDrop: required("#source-drop"),
        urlDropOverlay: required("#url-drop-overlay"),
        collectionButton: required("#collection-toggle"),
        scanButton: required("#scan"),
        exportButton: required("#export"),
        exportMediaHint: required("#export-media-hint"),
        exportFormatInputs: [
            { format: "original", input: required("#export-format-original") },
            { format: "pdf", input: required("#export-format-pdf") },
            { format: "jpg", input: required("#export-format-jpg") },
            { format: "png", input: required("#export-format-png") },
            { format: "jxl", input: required("#export-format-jxl") },
        ],
        sourcePageOption: required(".source-page-option"),
        includeSourcePage: required("#include-source-page"),
        viewerToggleButton: required("#viewer-toggle"),
        viewerElement: required("#viewer"),
        resultsElement: required(".results"),
        viewerEmptyElement: required("#viewer-empty"),
        viewerPageElement: required("#viewer-page"),
        viewerPreviousButton: required("#viewer-previous"),
        viewerNextButton: required("#viewer-next"),
        viewerPositionElement: required("#viewer-position"),
        viewerStageElement: required("#viewer-stage"),
        exportOverlay: required("#export-overlay"),
        viewerImageElement: required("#viewer-image"),
        viewerFilenameElement: required("#viewer-filename"),
        viewerThumbnailsElement: required("#viewer-thumbnails"),
        viewerZoomInButton: required("#viewer-zoom-in"),
        viewerZoomOutButton: required("#viewer-zoom-out"),
        viewerZoomResetButton: required("#viewer-zoom-reset"),
        allVisibilityButton: required("#all-visibility"),
        allSelectionCheckbox: required("#all-selection"),
        resetOrderButton: required("#reset-order"),
        resetButton: required("#reset"),
        failuresElement: required("#failures"),
        failedImagesElement: required("#failed-images"),
        imagesElement: required("#images"),
        groupsElement: required("#groups"),
        scanOverlay: required("#scan-overlay"),
        emptyElement: required("#empty"),
        emptyLogoElement: required("#empty-logo"),
        emptyMessageElement: required("#empty-message"),
        statusElement: required("#status"),
    };
}
