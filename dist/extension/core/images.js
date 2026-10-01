/** Groups collected media by type and file format while retaining image-series grouping. */
export function groupMediaImages(urls, metadata = []) {
    const metadataByUrl = new Map(metadata.map(item => [item.url, item]));
    const buckets = new Map();
    for (const url of urls) {
        const details = metadataByUrl.get(url);
        const detected = mediaFormat(url);
        const kind = details?.kind ?? "image";
        // GIF and video identities take precedence over a file's incidental suffix.
        const extension = kind === "gif" ? "GIF" : kind === "video" ? (detected.extension || "不明") : detected.extension;
        const bucketKey = `${kind}:${extension || "不明"}`;
        const bucket = buckets.get(bucketKey) ?? { kind, extension: extension || "不明", urls: [] };
        bucket.urls.push(url);
        buckets.set(bucketKey, bucket);
    }
    const groups = {};
    // Insert video groups first so the default priority-zero choice is stable.
    for (const kind of ["video", "gif", "image"]) {
        const entries = [...buckets.entries()].filter(([, bucket]) => bucket.kind === kind);
        for (const [bucketKey, bucket] of entries) {
            if (kind === "video" || kind === "gif") {
                const key = `0_${bucketKey}`;
                const label = kind === "gif" ? "GIF" : bucket.extension === "不明" ? "動画" : bucket.extension;
                groups[key] = { label: `${label} (${bucket.urls.length}件)`, priority: 0, items: bucket.urls, isMangaBody: false };
                continue;
            }
            const legacy = groupImages(bucket.urls);
            for (const [legacyKey, group] of Object.entries(legacy)) {
                const extensionLabel = bucket.extension === "不明" ? "画像" : bucket.extension;
                const label = group.label.replace(/ \(\d+枚\)$/, "");
                const key = `image_${bucketKey}_${legacyKey}`;
                groups[key] = {
                    ...group,
                    label: `${extensionLabel} · ${label} (${group.items.length}枚)`,
                    priority: group.priority,
                };
            }
        }
    }
    return groups;
}
function mediaFormat(value) {
    try {
        if (value.startsWith("data:")) {
            const mime = value.slice(5, value.indexOf(",")).split(";")[0]?.toLowerCase() ?? "";
            const subtype = mime.split("/")[1] ?? "";
            return { extension: normalizeFormat(subtype) };
        }
        const url = new URL(value);
        const pathExtension = url.pathname.match(/\.([a-z0-9]{2,8})$/i)?.[1];
        const queryFormat = [...url.searchParams.entries()].find(([name]) => /^(?:format|fmt|fm)$/i.test(name))?.[1];
        return { extension: queryFormat ? normalizeFormat(queryFormat) : pathExtension ? normalizeFormat(pathExtension) : "不明" };
    }
    catch {
        return { extension: "不明" };
    }
}
function normalizeFormat(value) {
    const format = value.toLowerCase().replace(/^x-/, "").replace(/\+xml$/, "");
    const aliases = { jpeg: "JPG", jpg: "JPG", png: "PNG", webp: "WEBP", avif: "AVIF", gif: "GIF", mp4: "MP4", webm: "WEBM", mov: "MOV", m4v: "M4V", bmp: "BMP", tif: "TIFF", tiff: "TIFF", jxl: "JXL", svg: "SVG" };
    return aliases[format] ?? "不明";
}
export function filterImagesByGroup(images, group) {
    if (!group)
        return [...images];
    const urls = new Set(group.items);
    return images.filter(item => urls.has(item.url));
}
export function normalizeImageUrls(candidates, pageUrl) {
    const found = new Set();
    for (const candidate of candidates) {
        try {
            // Candidates are URLs; srcset descriptors are parsed at collection time.
            const cleaned = candidate.trim();
            if (!cleaned)
                continue;
            const url = new URL(cleaned, pageUrl);
            if (url.protocol !== "http:" && url.protocol !== "https:")
                continue;
            url.hash = "";
            const lower = decodeURIComponentSafe(url.pathname).toLowerCase();
            const contentPath = ["/fanzine/", "/covers/", "/pages/", "/storage/", "/uploads/", "/viewer/"]
                .some(marker => lower.includes(marker));
            const excluded = /(?:^|[\/_.-])(?:avatars?|logos?|icons?|buttons?|adverts?|advertisement|tracking|pixels?|analytics|banners?|loading)(?=$|[\/_.-]|\d)/.test(lower)
                || /\/(?:themes?|plugins|wp-includes)(?:\/|$)/.test(lower)
                || /\.(?:svg|ico)$/i.test(url.pathname);
            if (excluded && !contentPath)
                continue;
            found.add(url.href);
        }
        catch {
            // A malformed candidate cannot be fetched or exported.
        }
    }
    return [...found];
}
export function groupImages(images) {
    const raw = new Map();
    for (const image of images) {
        if (image.startsWith("data:")) {
            const items = raw.get("uploaded") ?? [];
            items.push(image);
            raw.set("uploaded", items);
            continue;
        }
        try {
            const url = new URL(image);
            const parentPath = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
            const { prefix, resolution } = filenamePattern(url.pathname);
            // Numeric query values commonly identify pages. Keep parameter names
            // and fixed values so different image series do not share a group.
            const queryParts = [...url.searchParams.entries()]
                .map(([name, value]) => [name, /^\d+$/.test(value) ? null : value]);
            queryParts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
            const querySignature = queryParts.length ? `|${JSON.stringify(queryParts)}` : "";
            const key = `${url.origin}${parentPath}|${prefix}|${resolution}${querySignature}`;
            const items = raw.get(key) ?? [];
            items.push(image);
            raw.set(key, items);
        }
        catch {
            const items = raw.get("unknown") ?? [];
            items.push(image);
            raw.set("unknown", items);
        }
    }
    const groups = {};
    const others = [];
    for (const [key, items] of raw) {
        if (key === "uploaded") {
            groups["0_uploaded"] = { label: `アップロード済み (${items.length}枚)`, priority: 0, items, isMangaBody: false };
            continue;
        }
        if (items.length < 2) {
            others.push(...items);
            continue;
        }
        const [pathPart = "", prefixPart = "numeric", resolution = ""] = key.split("|");
        const lowerPath = pathPart.toLowerCase();
        const isMangaBody = lowerPath.includes("/fanzine") || lowerPath.includes("/pages") || lowerPath.includes("/storage") || lowerPath.includes("/viewer") || items.length >= 10;
        let label = prefixPart === "numeric" ? "シリーズ" : "セット";
        let priority = prefixPart === "numeric" ? 1 : 2;
        if (!isMangaBody && (lowerPath.includes("cover") || lowerPath.includes("thumb"))) {
            label = "表紙・サムネイル";
            priority = 3;
        }
        if (resolution)
            label += ` (${resolution})`;
        groups[`${priority}_${key}`] = { label: `${label} (${items.length}枚)`, priority, items, isMangaBody };
    }
    if (others.length)
        groups["99_others"] = { label: `その他 (${others.length}枚)`, priority: 99, items: others, isMangaBody: false };
    return groups;
}
export function defaultDisplayedImageGroup(groups) {
    const entries = Object.entries(groups).sort((a, b) => {
        if (a[1].priority === 0 || b[1].priority === 0)
            return a[1].priority - b[1].priority;
        if (a[1].isMangaBody !== b[1].isMangaBody)
            return a[1].isMangaBody ? -1 : 1;
        return a[1].priority - b[1].priority || b[1].items.length - a[1].items.length;
    });
    return entries[0]?.[0] ?? null;
}
export function defaultSelectedImageGroups(groups) {
    const preferred = defaultDisplayedImageGroup(groups);
    return Object.fromEntries(Object.keys(groups).map(key => [key, key === preferred]));
}
export function imageGroupLabel(imageUrl) {
    const url = new URL(imageUrl);
    const path = url.pathname.split("/").filter(Boolean);
    const folder = path.length > 1 ? path[path.length - 2] : "";
    return folder ? `${url.hostname} / ${decodeURIComponentSafe(folder)}` : url.hostname;
}
function decodeURIComponentSafe(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
function filenamePattern(pathname) {
    const filename = pathname.split("/").pop() || "";
    const match = filename.match(/([0-9]{3,4})x([0-9]{3,4})/i);
    const resolution = match ? `${Math.round(Number(match[1]) / 10) * 10}x${Math.round(Number(match[2]) / 10) * 10}` : "";
    const prefix = filename.match(/^([^0-9]+)/)?.[1] || "numeric";
    return { prefix, resolution };
}
