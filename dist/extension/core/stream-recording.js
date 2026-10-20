function recordingPage(value) {
    try {
        const page = new URL(value);
        if (page.protocol !== "https:" || page.username || page.password || page.port
            || !/^[a-z0-9-]+\.sharepoint\.com$/i.test(page.hostname))
            return null;
        const layout = /^(.*)\/_layouts\/(?:15\/)?(?:stream|onedrive|doc|embed)\.aspx$/i.exec(page.pathname);
        if (layout)
            return { page, prefix: layout[1] };
        const library = /^(.*)\/([^/]+)\/Forms\/AllItems\.aspx$/i.exec(page.pathname);
        return library ? { page, prefix: library[1], library: `${library[1]}/${library[2]}` } : null;
    }
    catch {
        return null;
    }
}
export function isStreamRecordingPage(value) {
    const location = recordingPage(value);
    // Ordinary library/folder views must retain their general page scan.
    return location !== null && (location.library === undefined || streamDownloadUrl(value) !== null);
}
/** Resolve the file selected by the player, never a playback manifest or guessed segment URL. */
export function streamDownloadUrl(value) {
    const location = recordingPage(value);
    if (!location)
        return null;
    const { page, prefix, library } = location;
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
        file.pathname = path.split("/").map(part => encodeURIComponent(part)).join("/");
        if (file.origin !== page.origin || !file.pathname.startsWith((library ?? prefix) + "/") || !/\.mp4$/i.test(file.pathname))
            return null;
        download.searchParams.set("SourceUrl", file.href);
    }
    else {
        // An AllItems view needs an explicitly selected file in that same library.
        if (library !== undefined)
            return null;
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
    // URLSearchParams already decoded file; only pathname components need decoding.
    if (!source)
        return new URL(recording.pageUrl).searchParams.get("file") || "recording.mp4";
    const name = new URL(source).pathname.split("/").pop();
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
