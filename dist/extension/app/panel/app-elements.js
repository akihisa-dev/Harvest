import { exportFormats } from "../../core/export-formats.js";
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
        exportOriginalExtension: required("#export-original-extension"),
        exportRecommendExtension: required("#export-recommend-extension"),
        exportFormatInputs: exportFormats.map(format => ({ format, input: required(`#export-format-${format}`) })),
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
