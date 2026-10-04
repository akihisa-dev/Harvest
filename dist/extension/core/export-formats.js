import { mediaFormat } from "./images.js";
export function isMediaArchiveFormat(format) {
    return ["original", "recommend", "mp4", "gif"].includes(format);
}
/** URL-derived labels are hints; original downloads use their validated response MIME type. */
export function originalItemExtension(item) {
    if (item.originalExtension)
        return item.originalExtension.toUpperCase();
    if (item.kind === "gif")
        return "GIF";
    const { extension } = mediaFormat(item.url);
    return extension === "不明" ? null : extension;
}
