export function isStreamRecordingPage(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.port
            && /^[a-z0-9-]+\.sharepoint\.com$/i.test(url.hostname)
            && /\/_layouts\/(?:15\/)?(?:stream|onedrive|doc|embed)\.aspx$/i.test(url.pathname);
    }
    catch {
        return false;
    }
}
/** Resolve the file selected by the player, never a playback manifest or guessed segment URL. */
export function streamDownloadUrl(value) {
    if (!isStreamRecordingPage(value))
        return null;
    const page = new URL(value);
    const prefix = page.pathname.slice(0, page.pathname.toLowerCase().indexOf("/_layouts/"));
    const params = new Map();
    for (const [name, entry] of page.searchParams) {
        const key = name.toLowerCase();
        if (params.has(key))
            return null;
        params.set(key, entry);
    }
    const download = new URL(`${prefix}/_layouts/15/download.aspx`, page.origin);
    const path = params.get("id");
    if (path) {
        // id is an already-decoded server-relative file path, not an arbitrary URL.
        if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path))
            return null;
        const file = new URL(page.origin);
        file.pathname = path;
        if (file.origin !== page.origin || !file.pathname.startsWith(prefix + "/") || !/\.mp4$/i.test(file.pathname))
            return null;
        download.searchParams.set("SourceUrl", file.href);
    }
    else {
        const guid = (params.get("sourcedoc") ?? params.get("uniqueid") ?? "").replace(/^\{(.*)\}$/, "$1");
        if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(guid))
            return null;
        download.searchParams.set("UniqueId", guid);
    }
    return download.href;
}
export function streamRecordingFilename(recording) {
    const download = streamDownloadUrl(recording.pageUrl);
    const source = download ? new URL(download).searchParams.get("SourceUrl") : null;
    const name = source ? new URL(source).pathname.split("/").pop() : new URL(recording.pageUrl).searchParams.get("file");
    try {
        return name ? decodeURIComponent(name) : "recording.mp4";
    }
    catch {
        return name ?? "recording.mp4";
    }
}
export function isStreamRecording(value, downloadUrl) {
    if (!value || typeof value !== "object")
        return false;
    const item = value;
    return typeof item["pageUrl"] === "string" && streamDownloadUrl(item["pageUrl"]) === downloadUrl
        && (item["bytes"] === undefined || (typeof item["bytes"] === "number" && Number.isSafeInteger(item["bytes"]) && item["bytes"] > 0));
}
