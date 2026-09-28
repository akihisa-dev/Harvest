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
            const lower = url.href.toLowerCase();
            const contentPath = ["/fanzine/", "/covers/", "/pages/", "/storage/", "/uploads/", "/viewer/"]
                .some(marker => lower.includes(marker));
            const excluded = ["avatar", "logo", "icon", "button", "advert", "tracking", "pixel", "analytics", "banner", "/theme", "/plugins/", "/wp-includes/", "loading"]
                .some(marker => lower.includes(marker)) || /\.(?:svg|ico|php|cgi)$/i.test(url.pathname);
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
            const parts = url.pathname.split("/").filter(Boolean);
            const directory = parts.length > 1 ? parts[parts.length - 2] : "root";
            const { prefix, resolution } = filenamePattern(url.pathname);
            // Numeric query values commonly identify pages. Keep parameter names
            // and fixed values so different image series do not share a group.
            const queryParts = [...url.searchParams.entries()]
                .map(([name, value]) => [name, /^\d+$/.test(value) ? null : value]);
            queryParts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
            const querySignature = queryParts.length ? `|${JSON.stringify(queryParts)}` : "";
            const key = `${url.hostname}/${directory}|${prefix}|${resolution}${querySignature}`;
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
