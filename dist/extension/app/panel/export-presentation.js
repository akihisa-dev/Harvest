import { createSourcePageLayout } from "../../core/pdf.js";
import { itemArchiveFormat, originalItemExtension } from "../../core/export-formats.js";
import { selectionsMatch } from "./export-lifecycle.js";
import { replaceLoneSurrogates } from "../../core/source-text.js";
import { individualFilename, saveFilesIndividually } from "../../core/export-files.js";
export function imageFilename(url) {
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
    }
    catch {
        return url;
    }
}
/** Keep the existing length budget without splitting Unicode or creating hidden filenames. */
export function exportFileBaseName(pageTitle, fallback) {
    function normalize(value) {
        const truncated = replaceLoneSurrogates(value)
            .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
            .replace(/^[.\s]+|[.\s]+$/g, "")
            .slice(0, 100);
        // The title may end with the first half of a surrogate pair after truncation.
        return truncated.replace(/[\ud800-\udbff]$/, "").replace(/[.\s]+$/g, "");
    }
    return normalize(pageTitle) || normalize(fallback) || "Harvest";
}
export function createSourcePreview(selected, format, includeSourcePage, heading, filename) {
    const first = selected[0];
    if (format !== "pdf" || !includeSourcePage || !first)
        return null;
    const layout = createSourcePageLayout({ heading, filename, url: first.sourcePage });
    const escape = (value) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
    const text = layout.lines.map(line => {
        const textLength = line.text ? ` textLength="${line.width.toFixed(3)}" lengthAdjust="spacingAndGlyphs"` : "";
        return `<text x="${line.x.toFixed(3)}" y="${(layout.height - line.y).toFixed(3)}" font-size="${line.size}"${textLength} xml:space="preserve">${escape(line.text)}</text>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}"><rect width="${layout.width}" height="${layout.height}" fill="white"/><g fill="black" font-family="monospace">${text}</g></svg>`;
    return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, sourcePage: first.sourcePage, selected: true };
}
/** Keeps output labels and both preview surfaces tied to the same export selection rules. */
export function createExportPresentation(options) {
    function filename(extension) {
        return `${exportFileBaseName(options.getTitle(), options.fallbackTitle)}.${extension}`;
    }
    function preview(selection) {
        return createSourcePreview(selection.selected, selection.format, selection.includeSourcePage, options.sourceHeading, filename("pdf"));
    }
    return {
        get pdfFilename() { return filename("pdf"); },
        get zipFilename() { return filename("zip"); },
        get resultFilename() {
            const { format, selected } = options.getSelection();
            if (format === "pdf")
                return filename("pdf");
            if (!saveFilesIndividually(format, selected.length, selected))
                return filename("zip");
            const extension = selected[0]
                ? format === "original" ? originalItemExtension(selected[0])?.toLowerCase() : itemArchiveFormat(format, selected[0])
                : null;
            if (!extension)
                return exportFileBaseName(options.getTitle(), options.fallbackTitle);
            const first = `${"1".padStart(Math.max(3, String(selected.length).length), "0")}.${extension}`;
            return individualFilename(filename("zip"), first, selected.length);
        },
        get sourcePreview() { return preview(options.getSelection()); },
        get viewerPages() {
            const selection = options.getSelection();
            const source = preview(selection);
            return source ? [...selection.selected, source] : selection.selected;
        },
    };
}
export function deriveExportViewState(options) {
    const pending = options.format === "pdf"
        ? options.pdfPending
        : options.imagePending?.format === options.format ? options.imagePending : null;
    const running = options.format === "pdf" ? options.pdfRunning : options.imageRunning;
    const progress = options.format === "pdf" ? options.pdfProgress : options.imageProgress;
    if (running)
        return { phase: "running", pending, progress };
    if (pending?.failed.size)
        return { phase: "retry-required", pending, progress: "" };
    const saved = options.completed?.format === options.format
        && (options.format !== "pdf" || options.completed.includeSourcePage === options.includeSourcePage)
        && selectionsMatch(options.completed.selected, options.selected);
    if (saved)
        return { phase: "saved", pending: null, progress: "" };
    return options.selected.length
        ? { phase: "ready", pending: null, progress: "" }
        : { phase: "empty", pending: null, progress: "" };
}
