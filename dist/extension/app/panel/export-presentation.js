import { createSourcePageLayout } from "../../core/pdf.js";
import { isStillImage, pdfSourceFilename } from "../../core/split-export-formats.js";
import { resolveImageExportFormat } from "../../core/export-recommendations.js";
import { originalItemExtension } from "../../core/export-formats.js";
import { replaceLoneSurrogates } from "../../core/source-text.js";
import { individualFilename } from "../../core/export-files.js";
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
    function outputFormat(selection) {
        return selection.resolvedImageFormat ?? resolveImageExportFormat(selection.format, selection.selected);
    }
    function filename(extension) {
        return `${exportFileBaseName(options.getTitle(), options.fallbackTitle)}.${extension}`;
    }
    function preview(selection) {
        const still = selection.selected.filter(isStillImage);
        const sourceFilename = pdfSourceFilename(selection.selected.length, selection.selected.indexOf(still[0]), selection.selected.length - still.length, filename("pdf"));
        return createSourcePreview(still, outputFormat(selection), selection.includeSourcePage, options.sourceHeading, sourceFilename);
    }
    return {
        get pdfFilename() { return filename("pdf"); },
        get zipFilename() { return filename("zip"); },
        get resultFilename() {
            const selection = options.getSelection();
            const { selected, videoFormat } = selection;
            const format = outputFormat(selection);
            if (!selected.length)
                return filename(format === "pdf" ? "pdf" : "zip");
            const still = selected.filter(isStillImage), pdf = format === "pdf" && still.length > 0;
            const count = format === "pdf" ? selected.length - still.length + (pdf ? 1 : 0) : selected.length;
            if (count === 1 && pdf)
                return filename("pdf");
            const videosOnly = selected.length > 0 && selected.every(item => item.kind === "video");
            if (count > 1 && !(videosOnly && videoFormat !== "original"))
                return filename("zip");
            const item = selected[0], original = item?.kind === "video" ? videoFormat === "original" : format === "original";
            const extension = !item ? null : original ? originalItemExtension(item)?.toLowerCase()
                : item.kind === "video" ? "mp4" : !isStillImage(item) ? "gif" : format === "recommend" ? "png" : format;
            if (!extension)
                return exportFileBaseName(options.getTitle(), options.fallbackTitle);
            const first = `${"1".padStart(Math.max(3, String(selected.length).length), "0")}.${extension}`;
            return individualFilename(filename("zip"), first, count);
        },
        get sourcePreview() { return preview(options.getSelection()); },
        get viewerPages() {
            const selection = options.getSelection();
            const source = preview(selection);
            return source ? [...selection.selected, source] : selection.selected;
        },
    };
}
