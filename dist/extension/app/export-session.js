import { mediaExportSelection } from "../core/media-selection.js";
import { deriveExportViewState, } from "./export-presentation.js";
/** Owns export requests and completion independently of status text and DOM rendering. */
export function createExportSession(options) {
    let format = options.format;
    let includeSourcePage = options.includeSourcePage;
    let completed = null;
    let activeRequest = null;
    function selectedItems() {
        return mediaExportSelection(options.getSelectedItems(), format);
    }
    return {
        get format() { return format; },
        get includeSourcePage() { return includeSourcePage; },
        get selectedItems() { return selectedItems(); },
        get state() {
            const selected = selectedItems();
            const pdf = options.getPdfController();
            const image = options.getImageController();
            return { format, includeSourcePage, selected, view: deriveExportViewState({
                    format, includeSourcePage, selected, completed,
                    pdfPending: pdf?.pending ?? null, imagePending: image?.pending ?? null,
                    pdfRunning: pdf?.isRunning ?? false, imageRunning: image?.isRunning ?? false,
                    pdfProgress: pdf?.progress ?? "", imageProgress: image?.progress ?? "",
                }) };
        },
        setFormat(value) { format = value; },
        setIncludeSourcePage(value) { includeSourcePage = value; },
        invalidateCompletion() { completed = null; },
        selectionChanged() {
            const selected = selectedItems();
            const pdfChanged = options.getPdfController()?.discardIfSelectionChanged(selected) ?? false;
            const imageChanged = options.getImageController()?.discardIfSelectionChanged(selected) ?? false;
            if (pdfChanged || imageChanged)
                completed = null;
            return pdfChanged || imageChanged;
        },
        clear() {
            completed = null;
            options.getPdfController()?.clear();
            options.getImageController()?.clear();
        },
        complete() {
            if (activeRequest)
                completed = activeRequest;
        },
        abort() {
            const controller = format === "pdf" ? options.getPdfController() : options.getImageController();
            controller?.abort();
        },
        async start() {
            if (options.isBusy() || activeRequest)
                return;
            const selected = selectedItems();
            if (!selected.length)
                return;
            const request = { format, includeSourcePage, selected };
            completed = null;
            activeRequest = request;
            try {
                if (request.format === "pdf")
                    await options.getPdfController()?.export();
                else
                    await options.getImageController()?.export(request.format);
            }
            finally {
                if (activeRequest === request)
                    activeRequest = null;
            }
        },
    };
}
