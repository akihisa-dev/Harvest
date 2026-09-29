import { createSourcePageLayout } from "../core/pdf.js";
export function imageFilename(url) {
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
    }
    catch {
        return url;
    }
}
export function exportFileBaseName(pageTitle, fallback) {
    return pageTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || fallback;
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
        && options.completed.selected.length === options.selected.length
        && options.completed.selected.every((item, index) => item === options.selected[index]);
    if (saved)
        return { phase: "saved", pending: null, progress: "" };
    return options.selected.length
        ? { phase: "ready", pending: null, progress: "" }
        : { phase: "empty", pending: null, progress: "" };
}
