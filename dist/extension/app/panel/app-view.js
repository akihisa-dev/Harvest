import { availableExportFormats, isMediaArchiveFormat, originalItemExtension, recommendedItemFormat } from "../../core/export-formats.js";
import { setButtonLabel } from "./button-state.js";
import { createEmptyStateView } from "./empty-state.js";
import { imageFilename } from "./export-presentation.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { setMotionText } from "./motion.js";
function exportButtonLabel(state) {
    const { format, selected, view } = state;
    if (view.phase === "running")
        return view.progress;
    if (view.phase === "retry-required")
        return t("exportRetry");
    if (view.phase === "saved") {
        return t(isMediaArchiveFormat(format) ? "exportFilesSaved" : "exportSaved", {
            count: selected.length,
            plural: formatPlural(selected.length),
        });
    }
    if (!selected.length)
        return t("save");
    if (format === "original")
        return t("exportOriginalAction");
    if (format === "recommend")
        return t("exportRecommendAction");
    return t("exportAction", { format: format.toUpperCase() });
}
function renderExtensions(element, extensions) {
    const values = [...new Set(extensions.map(value => value ?? t("exportUnknownFormat")))];
    const label = values.length > 1 ? t("exportMixedFormats") : values[0] ?? "—";
    element.textContent = `(${label})`;
    element.title = values.join(" / ");
}
/** Displays snapshots; changing export work and notifying the page belong to application events. */
export function createAppView(elements, positionOf) {
    const { sourceDrop, sourceUrl, scanButton, resetButton, exportButton, exportFormatInputs, includeSourcePage, sourcePageOption, exportMediaHint, statusElement, failuresElement, failedImagesElement, scanOverlay, exportOverlay, emptyElement, emptyLogoElement, emptyMessageElement, allSelectionCheckbox, resetOrderButton, } = elements;
    const updateEmptyState = createEmptyStateView({ container: emptyElement, logo: emptyLogoElement, message: emptyMessageElement });
    function renderProgress(snapshot) {
        const { selected, view } = snapshot.export;
        const status = snapshot.status;
        const success = status.state === "success";
        setMotionText(statusElement, success ? "" : status.state === "busy" ? status.progress : status.message);
        statusElement.setAttribute("aria-label", status.state === "busy" ? status.message : "");
        statusElement.dataset["state"] = status.state;
        statusElement.dataset["scanProgress"] = String(snapshot.busy && view.phase !== "running" && status.state === "busy" && Boolean(status.progress));
        statusElement.title = success ? "" : status.message;
        const running = view.phase === "running";
        exportButton.dataset["saving"] = String(running);
        exportButton.dataset["saved"] = String(view.phase === "saved");
        if (running && status.state === "busy") {
            exportButton.setAttribute("aria-label", `${status.message} ${t("exportCancelHint")}`);
        }
        else if (!running)
            exportButton.removeAttribute("aria-label");
        setButtonLabel(exportButton, exportButtonLabel(snapshot.export));
        exportButton.title = running ? `${view.progress} — ${t("exportCancelHint")}` : exportButton.textContent;
        exportButton.disabled = (snapshot.busy && !running) || !selected.length;
    }
    function renderFailures({ format, view }) {
        const pending = view.pending;
        failuresElement.hidden = !pending?.failed.size;
        failedImagesElement.replaceChildren(...(pending?.selected.filter(item => pending.failed.has(item)) ?? []).map(item => {
            const row = document.createElement("li");
            const fallback = format === "pdf" ? "errorPdfFetch" : isMediaArchiveFormat(format) ? "errorFileSave" : "errorImageConvert";
            row.textContent = t("failedRow", {
                index: positionOf(item) + 1,
                filename: imageFilename(item.url),
                reason: localizeErrorMessage(pending.failed.get(item) ?? t(fallback), fallback, true),
            });
            row.title = item.url;
            return row;
        }));
    }
    function render(snapshot) {
        const { busy, items, selectedCount, scanState, scanRunning } = snapshot;
        const { format, selected, includeSourcePage: sourceIncluded, view } = snapshot.export;
        const formats = availableExportFormats(items);
        const selectedItems = items.filter(item => item.selected);
        renderExtensions(elements.exportOriginalExtension, selectedItems.map(originalItemExtension));
        renderExtensions(elements.exportRecommendExtension, selectedItems.map(item => recommendedItemFormat(item).toUpperCase()));
        const hasVideo = formats.includes("mp4");
        const excludedCount = selectedCount - selected.length;
        exportMediaHint.textContent = [
            format === "recommend" && selected.some(item => item.kind !== "video") ? t("animatedImageHint") : "",
            (format === "mp4" && hasVideo) || (format === "recommend" && selected.some(item => item.kind === "video")) ? t("videoConversionHint") : "",
            excludedCount ? t("mediaExcludedHint", { count: excludedCount, plural: formatPlural(excludedCount), format: format.toUpperCase() }) : "",
        ].filter(Boolean).join(" ");
        exportMediaHint.hidden = !exportMediaHint.textContent;
        scanButton.disabled = busy && !scanRunning;
        sourceDrop.disabled = busy;
        sourceUrl.disabled = busy;
        resetButton.disabled = busy;
        includeSourcePage.disabled = busy;
        includeSourcePage.checked = sourceIncluded;
        for (const choice of exportFormatInputs) {
            const hidden = !formats.includes(choice.format);
            const label = choice.input.closest?.("label");
            if (label)
                label.hidden = hidden;
            choice.input.disabled = busy || hidden;
            choice.input.checked = choice.format === format;
        }
        sourcePageOption.hidden = format !== "pdf";
        scanButton.dataset["scanning"] = String(scanRunning);
        setButtonLabel(scanButton, t(scanRunning ? "scanStop" : "scan"));
        if (scanRunning)
            scanButton.setAttribute("aria-label", t("scanStop"));
        else
            scanButton.removeAttribute("aria-label");
        renderProgress(snapshot);
        renderFailures(snapshot.export);
        scanOverlay.hidden = scanState !== "scanning";
        exportOverlay.hidden = view.phase !== "running";
        emptyElement.hidden = items.length > 0;
        const emptyMessage = scanState === "empty" ? t("scanEmpty") : scanState === "error" ? t("scanErrorEmpty") : "";
        updateEmptyState(scanState, emptyMessage, scanState === "scanning" ? t("scanBusy") : emptyMessage);
        allSelectionCheckbox.checked = items.length > 0 && selectedCount === items.length;
        allSelectionCheckbox.indeterminate = selectedCount > 0 && selectedCount < items.length;
        allSelectionCheckbox.disabled = busy || items.length === 0;
        allSelectionCheckbox.title = t(allSelectionCheckbox.checked ? "clearAllTitle" : "selectAllTitle");
        allSelectionCheckbox.setAttribute("aria-label", t(allSelectionCheckbox.checked ? "clearAll" : "selectAll"));
        resetOrderButton.disabled = busy || snapshot.initialOrderAndSelection;
    }
    return { render, renderProgress };
}
