function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalBoolean(value) {
    return value === undefined || typeof value === "boolean";
}
function optionalString(value) {
    return value === undefined || typeof value === "string";
}
function diagnostics(value) {
    if (!record(value) || typeof value["limited"] !== "boolean" || !optionalBoolean(value["bookmarkCaptureMissing"]) || !optionalBoolean(value["bookmarkIncomplete"]) || !optionalBoolean(value["bookmarkStopped"]))
        return false;
    return ["posts", "observed", "extracted", "merged", "excluded", "unavailable", "unresolved"].every(key => {
        const count = value[key];
        return typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
    });
}
/** Shape validation only; media URL selection remains the responsibility of the existing parsers. */
export function isPageScan(value) {
    if (!record(value) || typeof value["url"] !== "string" || typeof value["title"] !== "string")
        return false;
    const images = value["images"], media = value["media"];
    return Array.isArray(images) && images.every(item => typeof item === "string")
        && (value["xDiagnostics"] === undefined || diagnostics(value["xDiagnostics"]))
        && (media === undefined || (Array.isArray(media) && media.every(item => record(item)
            && typeof item["url"] === "string" && (item["kind"] === "image" || item["kind"] === "gif" || item["kind"] === "video")
            && optionalString(item["previewUrl"]))));
}
export function isXPageState(value) {
    return record(value) && typeof value["status"] === "string"
        && ["ready", "restricted", "unavailable", "timeout"].includes(value["status"]);
}
function postSnapshot(value) {
    if (!record(value) || typeof value["key"] !== "string" || !optionalString(value["postId"]))
        return false;
    const observed = value["observed"], roots = value["roots"];
    return Array.isArray(observed) && observed.every(item => record(item)
        && (item["kind"] === "image" || item["kind"] === "video")
        && optionalString(item["url"]) && optionalString(item["previewUrl"]))
        && Array.isArray(roots) && roots.every(root => record(root)
        && typeof root["requireIdentity"] === "boolean" && typeof root["player"] === "boolean");
    // roots[].value deliberately remains unknown; parseXMedia owns its bounded evidence traversal.
}
export function isXMediaSnapshot(value) {
    return record(value) && typeof value["url"] === "string" && typeof value["limited"] === "boolean"
        && optionalBoolean(value["bookmarkCaptureMissing"]) && optionalBoolean(value["bookmarkContinuation"])
        && (value["bookmarkList"] === undefined || value["bookmarkList"] === "bookmarks" || value["bookmarkList"] === "other")
        && Array.isArray(value["posts"]) && value["posts"].every(postSnapshot);
}
