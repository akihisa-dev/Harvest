import { mediaExportSelection } from "../../core/media-selection.js";
import { deriveExportViewState, } from "./export-presentation.js";
/** Owns export requests and completion independently of status text and DOM rendering. */
export function createExportSession(options) {
    let format = options.format;
    let includeSourcePage = options.includeSourcePage;
    let completed = null;
    let activeRequest = null;
    function invalidateCompletion() {
        completed = null;
        if (activeRequest)
            activeRequest.acceptsCompletion = false;
    }
    function selectedItems() {
        return mediaExportSelection(options.getSelectedItems(), format);
    }
    function discardIncompatibleWork() {
        const pdf = options.getPdfController();
        const image = options.getImageController();
        if (format !== "pdf" && pdf?.pending && !pdf.isRunning)
            pdf.clear();
        if (image?.pending && image.pending.format !== format && !image.isRunning)
            image.clear();
    }
    return {
        get format() { return format; },
        get includeSourcePage() { return includeSourcePage; },
        get selectedItems() { return selectedItems(); },
        get state() {
            const selected = selectedItems();
            const pdf = options.getPdfController();
            const image = options.getImageController();
            const view = deriveExportViewState({
                format,
                includeSourcePage,
                selected,
                completed,
                pdfPending: pdf?.pending ?? null,
                imagePending: image?.pending ?? null,
                pdfRunning: pdf?.isRunning ?? false,
                imageRunning: image?.isRunning ?? false,
                pdfProgress: pdf?.progress ?? "",
                imageProgress: image?.progress ?? "",
            });
            return { format, includeSourcePage, selected, view };
        },
        setFormat(value) {
            format = value;
            discardIncompatibleWork();
        },
        setIncludeSourcePage(value) { includeSourcePage = value; },
        invalidateCompletion,
        selectionChanged() {
            const selected = selectedItems();
            const pdfChanged = options.getPdfController()?.discardIfSelectionChanged(selected) ?? false;
            const imageChanged = options.getImageController()?.discardIfSelectionChanged(selected) ?? false;
            if (pdfChanged || imageChanged)
                completed = null;
            return pdfChanged || imageChanged;
        },
        clear() {
            invalidateCompletion();
            options.getPdfController()?.clear();
            options.getImageController()?.clear();
        },
        complete() {
            if (activeRequest?.acceptsCompletion)
                completed = activeRequest.snapshot;
        },
        abort() {
            if (activeRequest) {
                activeRequest.acceptsCompletion = false;
                activeRequest.abort();
            }
        },
        async start() {
            if (options.isBusy() || activeRequest)
                return;
            const selected = selectedItems();
            if (!selected.length)
                return;
            discardIncompatibleWork();
            const pdf = options.getPdfController();
            const image = options.getImageController();
            const controller = format === "pdf" ? pdf : image;
            if (!controller)
                return;
            const snapshot = { format, includeSourcePage, selected };
            const request = { snapshot, abort: () => controller.abort(), acceptsCompletion: true };
            completed = null;
            activeRequest = request;
            try {
                if (snapshot.format === "pdf")
                    await pdf?.export();
                else
                    await image?.export(snapshot.format);
            }
            finally {
                if (activeRequest === request)
                    activeRequest = null;
                discardIncompatibleWork();
            }
        },
    };
}
