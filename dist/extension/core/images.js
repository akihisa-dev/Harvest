export function normalizeImageUrls(candidates, pageUrl) {
    const found = new Set();
    for (const candidate of candidates) {
        try {
            let cleaned = candidate.trim().split(/\s+|%20|%2520/)[0] ?? "";
            if (cleaned.includes(","))
                cleaned = cleaned.split(",")[0] ?? "";
            if (cleaned.includes("%2C"))
                cleaned = cleaned.split("%2C")[0] ?? "";
            if (cleaned.includes("%252C"))
                cleaned = cleaned.split("%252C")[0] ?? "";
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
                .some(marker => lower.includes(marker)) || /\.(?:svg|gif|ico|php|cgi)$/i.test(url.pathname);
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
            const key = `${url.hostname}/${directory}|${prefix}|${resolution}`;
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
        let label = "画像セット";
        let priority = 5;
        if (isMangaBody) {
            label = `漫画本編 [${prefixPart === "numeric" ? "連番" : prefixPart.slice(0, 10)}]`;
            priority = 1;
        }
        else if (lowerPath.includes("cover") || lowerPath.includes("thumb")) {
            label = "表紙・サムネイル";
            priority = 2;
        }
        else {
            label = `画像セット [${prefixPart === "numeric" ? "連番" : prefixPart.slice(0, 10)}]`;
        }
        if (resolution)
            label += ` (${resolution})`;
        groups[`${priority}_${key}`] = { label: `${label} (${items.length}枚)`, priority, items, isMangaBody };
    }
    if (others.length)
        groups["99_others"] = { label: `その他・単発画像 (${others.length}枚)`, priority: 99, items: others, isMangaBody: false };
    return groups;
}
export function defaultSelectedImageGroups(groups) {
    const entries = Object.entries(groups);
    const hasMangaBody = entries.some(([, group]) => group.isMangaBody);
    return Object.fromEntries(entries.map(([key, group]) => [key, hasMangaBody ? group.isMangaBody : true]));
}
export function sortImageUrlsForSite(images, pageUrl) {
    if (!pageUrl.includes("momon-ga.com"))
        return [...images];
    return [...images].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}
export function imageGroupLabel(imageUrl) {
    const url = new URL(imageUrl);
    const path = url.pathname.split("/").filter(Boolean);
    const folder = path.length > 1 ? path[path.length - 2] : "";
    return folder ? `${url.hostname} / ${decodeURIComponentSafe(folder)}` : url.hostname;
}
export function galleryLinkScore(link, pageUrl) {
    try {
        const target = new URL(link.url, pageUrl);
        if (target.origin !== new URL(pageUrl).origin || target.href === pageUrl)
            return -1;
        const text = `${link.label} ${target.pathname}`.toLowerCase();
        const patterns = [/(?:^|[\/_-])gallery(?:[\/_-]|$)/, /(?:^|[\/_-])viewer(?:[\/_-]|$)/, /(?:^|[\/_-])read(?:[\/_-]|$)/, /(?:^|[\/_-])pages?(?:[\/_-]|$)/, /画像一覧/, /全ページ/, /ギャラリー/, /読む/, /続きを見る/];
        return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
    }
    catch {
        return -1;
    }
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
