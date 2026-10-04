import { groupMediaImages } from "./images.js";
import { isStillImage } from "./split-export-formats.js";
/** A series defaults to a reading copy; other selections preserve their originals. */
export function resolveImageExportFormat(format, selected) {
    if (format !== "recommend")
        return format;
    return imageRecommendations(selected).some(candidate => candidate.format === "pdf") ? "pdf" : "original";
}
/** Recommendations describe suitable uses; the caller still chooses one output format. */
export function imageRecommendations(selected) {
    const images = selected.filter(item => item.kind !== "video");
    if (!images.length)
        return [];
    const recommendations = [{ format: "original", reason: "preserve" }];
    const stills = images.filter(isStillImage);
    if (stills.length < 2)
        return recommendations;
    // Use the same series and set boundaries as the list, independent of its visibility.
    const groups = Object.values(groupMediaImages(stills.map(item => item.url)));
    if (groups.length === 1 && (groups[0].priority === 1 || groups[0].priority === 2)) {
        recommendations.push({ format: "pdf", reason: "series" });
    }
    return recommendations;
}
export function videoRecommendations(selected) {
    return selected.some(item => item.kind === "video")
        ? [{ format: "original", reason: "preserve" }, { format: "mp4", reason: "playback" }]
        : [];
}
