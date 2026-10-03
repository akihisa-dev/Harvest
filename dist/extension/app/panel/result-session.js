import { initialExportFormat } from "../../core/export-formats.js";
/** Owns the title and dependent UI state of the current scan result as one lifetime. */
export function createResultSession(options) {
    let title = options.fallbackTitle;
    function resetViewer() {
        options.viewer.setOpen(false);
        options.viewer.clearCurrentPage();
    }
    return {
        get title() { return title; },
        commit(nextTitle, initialGroup, sourcePage) {
            // The scan owns atomic collection replacement; dependent state follows only a successful result.
            options.exportSession.setFormat(initialExportFormat(options.collection.items, options.getPreferredFormat()));
            title = nextTitle;
            options.sourceInput.commitResult(sourcePage);
            options.previews.clear();
            options.imageList.clearVideoSizes();
            options.exportSession.clear();
            options.imageList.showInitialGroup(initialGroup);
            resetViewer();
        },
        reset() {
            options.previews.clear();
            options.sourceInput.reset();
            options.clearAnalyzedUrl();
            options.collection.clear();
            options.exportSession.clear();
            options.imageList.clearVisibleGroups();
            resetViewer();
            options.resetScan();
            title = options.fallbackTitle;
        },
    };
}
