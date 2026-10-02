/**
 * Collect image candidates from the current page.
 *
 * This function is passed directly to chrome.scripting.executeScript.  Keep
 * every helper inside the function so Chrome can serialize and run it without
 * resolving an import or a module-level variable in the extension context.
 */
export async function scanDocument(targetPostId) {
    const deadline = performance.now() + 20_000;
    const checkDeadline = () => {
        if (performance.now() >= deadline)
            throw new Error("Page scan exceeded its 20 second deadline");
    };
    // These DOM helpers stay inside the injected function: Chrome copies only its body.
    const quoteSelector = '[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="link"]:not(a):has(a[href*="/status/"])';
    const ownPostId = (root) => {
        const links = [...root.querySelectorAll('a[href*="/status/"]')].filter(link => {
            checkDeadline();
            if (link.parentElement?.closest(quoteSelector))
                return false;
            const article = link.closest("article");
            return root.tagName.toLowerCase() === "article" ? article === root
                : !article && link.closest('dialog, [role="dialog"]') === root;
        });
        const permalink = links.find(link => link.querySelector("time"))
            ?? (root.tagName.toLowerCase() === "article" ? undefined : links[0]);
        if (!permalink)
            return undefined;
        try {
            const url = new URL(permalink.href, location.href);
            return /^(?:www\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)
                ? /\/status\/(\d+)(?:\/|$)/i.exec(url.pathname)?.[1] : undefined;
        }
        catch {
            return undefined;
        }
    };
    const inTargetPost = (element) => {
        if (!targetPostId)
            return true;
        if (!document.documentElement.contains(element))
            return false;
        if (element.closest(quoteSelector))
            return false;
        const article = element.closest("article");
        if (article)
            return ownPostId(article) === targetPostId;
        const dialog = element.closest('dialog, [role="dialog"]');
        return Boolean(dialog && ownPostId(dialog) === targetPostId);
    };
    if (targetPostId && ![...document.querySelectorAll('article[data-testid="tweet"], dialog, [role="dialog"]')].some(inTargetPost)) {
        throw new Error("Xの投稿を読み取れませんでした。");
    }
    // One record owns a URL's evidence. The element index points to those same
    // evidence objects so replacement and removal update both output views together.
    const registry = (() => {
        const records = new Map();
        const elements = new Map();
        let nextImageOrder = 0;
        let nextMediaOrder = 0;
        const evidenceFor = (url, source) => {
            let record = records.get(url);
            if (!record) {
                record = { url, sources: new Map() };
                records.set(url, record);
            }
            let sourceEvidence = source ? elements.get(source) : undefined;
            if (source && !sourceEvidence) {
                sourceEvidence = new Map();
                elements.set(source, sourceEvidence);
            }
            let evidence = source ? sourceEvidence.get(url) : record.sources.get(undefined);
            if (!evidence) {
                evidence = { media: false };
                sourceEvidence?.set(url, evidence);
                record.sources.set(source, evidence);
            }
            return { record, evidence };
        };
        const prune = (record, previous, current) => {
            // Search only for evidence this source lost. Re-reading a shared URL
            // without changing its roles must not scan all its other sources again.
            let hasImage = !previous.image || Boolean(current?.image) || record.imageOrder === undefined;
            let hasMedia = !previous.media || Boolean(current?.media) || record.media === undefined;
            if (hasImage && hasMedia)
                return;
            for (const evidence of record.sources.values()) {
                checkDeadline();
                hasImage ||= Boolean(evidence.image);
                hasMedia ||= evidence.media;
                if (hasImage && hasMedia)
                    return;
            }
            if (!hasImage)
                delete record.imageOrder;
            if (!hasMedia)
                delete record.media;
            if (record.imageOrder === undefined && !record.media)
                records.delete(record.url);
        };
        const removeElement = (element) => {
            for (const [url, evidence] of elements.get(element) ?? []) {
                checkDeadline();
                const record = records.get(url);
                if (!record)
                    continue;
                record.sources.delete(element);
                prune(record, evidence);
            }
            elements.delete(element);
        };
        return {
            recordImage(url, position, source) {
                const { record, evidence } = evidenceFor(url, source);
                record.imageOrder ??= nextImageOrder++;
                evidence.image = { position };
            },
            recordMedia(url, kind, source) {
                const { record, evidence } = evidenceFor(url, source);
                if (!record.media)
                    record.media = { kind, order: nextMediaOrder++ };
                // Preserve the strongest observed kind until the last media source goes away.
                else if (kind === "gif" || (record.media.kind === "image" && kind === "video"))
                    record.media.kind = kind;
                evidence.media = true;
            },
            beginElement(element) {
                const previous = elements.get(element);
                const current = new Map();
                elements.set(element, current);
                return () => {
                    for (const [url, evidence] of previous ?? []) {
                        checkDeadline();
                        const record = records.get(url);
                        if (!record)
                            continue;
                        if (!current.has(url))
                            record.sources.delete(element);
                        prune(record, evidence, current.get(url));
                    }
                    if (current.size === 0)
                        elements.delete(element);
                };
            },
            removeElement,
            retainElements(keep) {
                for (const element of elements.keys()) {
                    checkDeadline();
                    if (!keep(element))
                        removeElement(element);
                }
            },
            images() {
                const images = [];
                for (const record of records.values()) {
                    checkDeadline();
                    if (record.imageOrder === undefined)
                        continue;
                    const positions = [];
                    for (const evidence of record.sources.values()) {
                        checkDeadline();
                        if (evidence.image?.position)
                            positions.push(evidence.image.position);
                    }
                    images.push({ url: record.url, detectionOrder: record.imageOrder, positions });
                }
                return images;
            },
            media() {
                const media = [];
                for (const record of records.values()) {
                    checkDeadline();
                    if (record.media)
                        media.push({ url: record.url, ...record.media });
                }
                return media.sort((a, b) => { checkDeadline(); return a.order - b.order; })
                    .map(({ url, kind }) => ({ url, kind }));
            },
        };
    })();
    const imageAttributes = [
        "data-original",
        "data-full",
        "data-high-res",
        "data-lib-src",
        "data-lazyload",
        "data-src",
        "data-lazy-src",
        "data-image",
        "data-url",
        "src",
    ];
    const relativeImageAttributes = imageAttributes.filter(attribute => attribute !== "data-url" && attribute !== "src");
    const imageSrcsetAttributes = ["data-srcset", "srcset"];
    const imageUrlPattern = /https?:\/\/[^\s"'\\<>]+?\.(?:jpe?g|png|webp|avif|gif)(?:[?#][^\s"'\\<>]*)?/gi;
    const mediaUrlPattern = /https?:\/\/[^\s"'\\<>]+/gi;
    const relativeImagePathPattern = /\.(?:jpe?g|png|webp|avif|gif)$/i;
    const mediaKindForUrl = (url) => {
        try {
            const parsed = new URL(url, document.baseURI || location.href);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
                return undefined;
            // Match the format precedence and aliases used by core/images.ts.
            // This helper must stay local because Chrome serializes scanDocument.
            const queryFormat = [...parsed.searchParams.entries()].find(([name]) => /^(?:format|fmt|fm)$/i.test(name))?.[1];
            const format = queryFormat || parsed.pathname.match(/\.([a-z0-9]{2,8})$/i)?.[1] || "";
            if (format.toLowerCase().replace(/^x-/, "").replace(/\+xml$/, "") === "gif")
                return "gif";
        }
        catch {
            return undefined;
        }
        return undefined;
    };
    const recordMedia = (value, kind, sourceElement) => {
        checkDeadline();
        const candidate = value?.trim();
        if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:"))
            return;
        let url;
        try {
            const parsed = new URL(candidate, document.baseURI || location.href);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
                return;
            url = parsed.href;
        }
        catch {
            return;
        }
        registry.recordMedia(url, kind, sourceElement);
    };
    const recordDirectVideo = (value, sourceElement, declaredType) => {
        checkDeadline();
        const candidate = value?.trim();
        if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:"))
            return;
        try {
            const parsed = new URL(candidate, document.baseURI || location.href);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
                return;
            const pathIsVideo = /\.(?:mp4|webm)$/i.test(parsed.pathname)
                || /^(?:mp4|webm)$/i.test(parsed.searchParams.get("format") ?? "");
            const declaredVideo = /^video\/(?:mp4|webm)(?:\s*;|$)/i.test(declaredType?.trim() ?? "");
            if (pathIsVideo || declaredVideo)
                recordMedia(parsed.href, "video", sourceElement);
        }
        catch {
            // Media candidates must be usable HTTP(S) URLs.
        }
    };
    const scanMediaText = (value, sourceElement) => {
        if (!value)
            return;
        for (const match of value.matchAll(mediaUrlPattern)) {
            checkDeadline();
            const candidate = (match[0] ?? "").replaceAll("&amp;", "&").replace(/[),.;!?]+$/, "");
            const kind = mediaKindForUrl(candidate);
            if (kind === "gif")
                recordMedia(candidate, kind, sourceElement);
        }
        checkDeadline();
    };
    const scanEmbeddedVideoJson = (script) => {
        const text = script.textContent ?? "";
        if (!text.includes("video_info") || !text.includes("variants"))
            return;
        const parseObjectAt = (start) => {
            const opening = text[start];
            if (opening !== "{" && opening !== "[")
                return undefined;
            const expected = [opening === "{" ? "}" : "]"];
            let inString = false;
            let escaped = false;
            for (let index = start + 1; index < text.length; index += 1) {
                if (index % 4096 === 0)
                    checkDeadline();
                const character = text[index];
                if (inString) {
                    if (escaped)
                        escaped = false;
                    else if (character === "\\")
                        escaped = true;
                    else if (character === '"')
                        inString = false;
                    continue;
                }
                if (character === '"') {
                    inString = true;
                }
                else if (character === "{" || character === "[") {
                    expected.push(character === "{" ? "}" : "]");
                }
                else if (character === "}" || character === "]") {
                    if (expected.pop() !== character)
                        return undefined;
                    if (expected.length === 0) {
                        try {
                            return { value: JSON.parse(text.slice(start, index + 1)), end: index + 1 };
                        }
                        catch {
                            return undefined;
                        }
                    }
                }
            }
            return undefined;
        };
        let parsed;
        try {
            parsed = JSON.parse(text.trim());
        }
        catch {
            parsed = undefined;
            // Public page state is sometimes assigned to a JavaScript variable. Parse
            // the first JSON object or array without evaluating the surrounding code.
            let start = text.search(/[\[{]/);
            let attempts = 0;
            while (start >= 0 && attempts < 16) {
                checkDeadline();
                const result = parseObjectAt(start);
                if (result) {
                    parsed = result.value;
                    break;
                }
                attempts += 1;
                const nextObject = text.indexOf("{", start + 1);
                const nextArray = text.indexOf("[", start + 1);
                if (nextObject < 0)
                    start = nextArray;
                else if (nextArray < 0)
                    start = nextObject;
                else
                    start = Math.min(nextObject, nextArray);
            }
        }
        if (parsed === undefined)
            return;
        const pending = [parsed];
        while (pending.length > 0) {
            checkDeadline();
            const value = pending.pop();
            if (!value || typeof value !== "object")
                continue;
            if (Array.isArray(value)) {
                for (let index = value.length - 1; index >= 0; index -= 1) {
                    checkDeadline();
                    pending.push(value[index]);
                }
                continue;
            }
            const object = value;
            const videoInfo = object["video_info"];
            if (typeof videoInfo === "object" && videoInfo !== null && !Array.isArray(videoInfo)) {
                const variants = videoInfo["variants"];
                if (Array.isArray(variants)) {
                    let best;
                    for (const variant of variants) {
                        checkDeadline();
                        if (typeof variant !== "object" || variant === null || Array.isArray(variant))
                            continue;
                        const candidate = variant;
                        if (typeof candidate["url"] !== "string")
                            continue;
                        const contentType = typeof candidate["content_type"] === "string"
                            ? candidate["content_type"].toLowerCase()
                            : typeof candidate["mime_type"] === "string" ? candidate["mime_type"].toLowerCase() : "";
                        let isMp4 = /^video\/mp4(?:\s*;|$)/i.test(contentType);
                        try {
                            const variantUrl = new URL(candidate["url"], document.baseURI || location.href);
                            isMp4 ||= /\.mp4$/i.test(variantUrl.pathname);
                            if ((variantUrl.protocol !== "http:" && variantUrl.protocol !== "https:") || !isMp4)
                                continue;
                        }
                        catch {
                            continue;
                        }
                        const bitrate = typeof candidate["bitrate"] === "number" && Number.isFinite(candidate["bitrate"])
                            ? candidate["bitrate"]
                            : 0;
                        if (!best || bitrate > best.bitrate)
                            best = { url: candidate["url"], bitrate };
                    }
                    if (best)
                        recordMedia(best.url, "video", script);
                }
            }
            const values = Object.values(object);
            for (let index = values.length - 1; index >= 0; index -= 1) {
                checkDeadline();
                const value = values[index];
                if (typeof value === "object" && value !== null)
                    pending.push(value);
            }
        }
    };
    const add = (value, positionElement, sourceElement) => {
        checkDeadline();
        const candidate = value?.trim();
        if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:"))
            return;
        try {
            const url = new URL(candidate, document.baseURI || location.href).href;
            recordCandidate(url, positionElement, sourceElement);
        }
        catch {
            // Keep malformed values for the core normalizer to reject consistently.
            recordCandidate(candidate, positionElement, sourceElement);
        }
    };
    const recordCandidate = (url, positionElement, sourceElement) => {
        registry.recordImage(url, positionElement, sourceElement);
        recordMedia(url, mediaKindForUrl(url) ?? "image", sourceElement);
    };
    const scanText = (value, positionElement, sourceElement) => {
        if (!value)
            return;
        for (const match of value.matchAll(imageUrlPattern)) {
            checkDeadline();
            const candidate = match[0];
            if (candidate)
                add(candidate.replaceAll("&amp;", "&"), positionElement, sourceElement);
        }
        scanMediaText(value, sourceElement);
        checkDeadline();
    };
    const isRelativeImageCandidate = (value) => {
        const candidate = value.trim();
        if (!candidate || /^[a-z][a-z\d+.-]*:/i.test(candidate) || /[\s"'<>\\]/.test(candidate))
            return false;
        const path = candidate.split(/[?#]/, 1)[0] ?? "";
        return Boolean(path) && relativeImagePathPattern.test(path);
    };
    const parseSrcset = (value) => {
        const entries = [];
        let index = 0;
        while (index < value.length) {
            checkDeadline();
            while (index < value.length && (value[index] === "," || /\s/.test(value[index] ?? ""))) {
                if (index % 256 === 0)
                    checkDeadline();
                index += 1;
            }
            if (index >= value.length)
                break;
            const start = index;
            let whitespace = -1;
            let commaSeparator = -1;
            while (index < value.length) {
                if (index % 256 === 0)
                    checkDeadline();
                if (/\s/.test(value[index] ?? "")) {
                    whitespace = index;
                    break;
                }
                if (value[index] === ",") {
                    const beforeComma = value.slice(start, index);
                    const afterComma = value.slice(index + 1);
                    // A comma can also be part of a URL. Without whitespace, split only
                    // when both sides look like separate image filenames.
                    if (/\s/.test(value[index + 1] ?? "") ||
                        (/\.(?:jpe?g|png|webp|avif|gif)$/i.test(beforeComma) &&
                            /^[^\s,]+\.(?:jpe?g|png|webp|avif|gif)(?=[\s,?#]|$)/i.test(afterComma))) {
                        commaSeparator = index;
                        break;
                    }
                }
                index += 1;
            }
            // Keep commas inside URLs such as /scan,page.jpg while recognizing
            // image filename pairs with or without whitespace after the comma.
            if (commaSeparator >= 0) {
                entries.push({ url: value.slice(start, commaSeparator).trim(), value: 0, kind: null });
                index = commaSeparator + 1;
                continue;
            }
            if (whitespace < 0) {
                const rest = value.slice(start);
                entries.push({ url: rest.trim(), value: 0, kind: null });
                break;
            }
            const url = value.slice(start, whitespace).trim();
            const comma = value.indexOf(",", whitespace);
            const descriptorText = (comma < 0 ? value.slice(whitespace) : value.slice(whitespace, comma)).trim();
            const descriptor = descriptorText.match(/^(\d+(?:\.\d+)?)(w|x)$/i);
            entries.push({
                url,
                value: descriptor ? Number(descriptor[1]) : 0,
                kind: descriptor ? (descriptor[2] ?? "").toLowerCase() : null,
            });
            if (comma < 0)
                break;
            index = comma + 1;
        }
        return entries.filter(entry => entry.url.length > 0);
    };
    const srcsetImages = (value) => {
        if (!value)
            return [];
        const entries = parseSrcset(value);
        if (entries.length === 0)
            return [];
        // Width descriptors and density descriptors cannot be compared.  Prefer
        // the largest width when present, otherwise the largest density.  This
        // makes the result independent of the order used by the page.
        const widthEntries = entries.filter(entry => entry.kind === "w");
        const densityEntries = entries.filter(entry => entry.kind === "x");
        const sized = widthEntries.length > 0 ? widthEntries : densityEntries;
        if (sized.length === 0)
            return entries.map(entry => entry.url);
        const first = sized[0];
        if (!first)
            return [];
        let best = first;
        for (const entry of sized.slice(1)) {
            if (entry.value > best.value)
                best = entry;
        }
        return [best.url];
    };
    const scanBackground = (element) => {
        checkDeadline();
        let background = "";
        try {
            background = getComputedStyle(element).backgroundImage;
        }
        catch {
            // A detached or browser-owned element may not have computed styles.
        }
        const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
        for (const match of background.matchAll(urlPattern)) {
            checkDeadline();
            add(match[1] ?? match[2] ?? match[3], element, element);
        }
    };
    const orderedImages = () => {
        const documentOrder = new Map();
        for (const [index, element] of pageElements(root, false).entries()) {
            checkDeadline();
            documentOrder.set(element, index);
        }
        const positionCache = new Map();
        const positioned = (element) => {
            checkDeadline();
            if (positionCache.has(element))
                return positionCache.get(element);
            let result;
            if (!documentOrder.has(element)) {
                positionCache.set(element, result);
                return result;
            }
            for (let current = element; current; current = composedParent(current)) {
                checkDeadline();
                let style;
                try {
                    style = getComputedStyle(current);
                }
                catch {
                    // Detached or browser-owned elements may not have computed styles.
                }
                checkDeadline();
                if (style && (style.display === "none" || style.visibility === "hidden")) {
                    positionCache.set(element, result);
                    return result;
                }
            }
            checkDeadline();
            if (typeof element.getBoundingClientRect !== "function") {
                positionCache.set(element, result);
                return result;
            }
            try {
                const rect = element.getBoundingClientRect();
                if (!Number.isFinite(rect.top) || !Number.isFinite(rect.left)
                    || (Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width <= 0 && rect.height <= 0)) {
                    positionCache.set(element, result);
                    return result;
                }
                result = { top: rect.top, left: rect.left, order: documentOrder.get(element) ?? Number.MAX_SAFE_INTEGER };
            }
            catch {
                result = undefined;
            }
            checkDeadline();
            positionCache.set(element, result);
            return result;
        };
        const ordered = registry.images()
            .map(record => ({
            record,
            position: record.positions
                .map(positioned).filter((value) => Boolean(value))
                .sort((a, b) => { checkDeadline(); return a.top - b.top || a.left - b.left || a.order - b.order; })[0],
        }))
            .sort((a, b) => {
            checkDeadline();
            if (a.position && b.position) {
                return a.position.top - b.position.top
                    || a.position.left - b.position.left
                    || a.position.order - b.position.order
                    || a.record.detectionOrder - b.record.detectionOrder;
            }
            if (a.position)
                return -1;
            if (b.position)
                return 1;
            return a.record.detectionOrder - b.record.detectionOrder;
        })
            .map(({ record }) => record.url);
        checkDeadline();
        return ordered;
    };
    const imagePositionElement = (element) => {
        if (element.tagName.toLowerCase() !== "source")
            return element;
        const parent = element.parentElement;
        if (parent?.tagName.toLowerCase() === "picture" && typeof parent.querySelector === "function") {
            return parent.querySelector("img") ?? element;
        }
        return element;
    };
    const collectElement = (element) => {
        checkDeadline();
        if (!inTargetPost(element))
            return;
        const tagName = element.tagName.toLowerCase();
        if (targetPostId && (tagName === "script" || tagName === "style"))
            return;
        const finishElement = registry.beginElement(element);
        const declaredSourceType = tagName === "source" ? element.getAttribute("type") : null;
        const sourceUrl = tagName === "source"
            ? element.getAttribute("src") || element.src
            : null;
        let sourceHasVideoUrl = false;
        if (sourceUrl) {
            try {
                const parsedSourceUrl = new URL(sourceUrl, document.baseURI || location.href);
                sourceHasVideoUrl = /\.(?:mp4|webm)$/i.test(parsedSourceUrl.pathname)
                    || /^(?:mp4|webm)$/i.test(parsedSourceUrl.searchParams.get("format") ?? "");
            }
            catch {
                sourceHasVideoUrl = false;
            }
        }
        const isVideoSource = tagName === "source"
            && (element.parentElement?.tagName.toLowerCase() === "video"
                || /^video\//i.test(declaredSourceType ?? "")
                || sourceHasVideoUrl);
        const positionElement = imagePositionElement(element);
        if (tagName === "script" || tagName === "style") {
            scanText(element.textContent, undefined, element);
            if (tagName === "script")
                scanEmbeddedVideoJson(element);
        }
        else {
            // Rebuild all evidence owned by this element together. Only direct text
            // belongs here; descendants own their own text and removal lifecycle.
            for (const parent of [element, element.shadowRoot]) {
                if (!parent)
                    continue;
                for (const node of Array.from(parent.childNodes)) {
                    checkDeadline();
                    if (node.nodeType === 3)
                        scanText(node.textContent, undefined, element);
                }
            }
        }
        if (tagName === "video") {
            const video = element;
            recordDirectVideo(video.currentSrc, element, element.getAttribute("type"));
            recordDirectVideo(video.src, element, element.getAttribute("type"));
            recordDirectVideo(element.getAttribute("src"), element, element.getAttribute("type"));
        }
        else if (isVideoSource) {
            const source = element;
            recordDirectVideo(source.src, element, declaredSourceType);
            recordDirectVideo(element.getAttribute("src"), element, declaredSourceType);
        }
        if (tagName === "img" || tagName === "source") {
            for (const attribute of imageAttributes) {
                if (isVideoSource && attribute === "src")
                    continue;
                add(element.getAttribute(attribute), positionElement, element);
            }
            if (!isVideoSource) {
                for (const attribute of imageSrcsetAttributes) {
                    for (const candidate of srcsetImages(element.getAttribute(attribute)))
                        add(candidate, positionElement, element);
                }
            }
            if (tagName === "img") {
                const image = element;
                add(image.currentSrc || image.src, positionElement, element);
            }
        }
        else if (tagName === "image" && element.namespaceURI === "http://www.w3.org/2000/svg") {
            // SVG image references may be relative to the page and are not covered
            // by the generic absolute-URL scan. Keep ordinary anchor href handling
            // separate so it does not broaden image discovery.
            add(element.getAttribute("href"), element, element);
            add(element.getAttribute("xlink:href"), element, element);
        }
        else if (tagName === "a") {
            const anchor = element;
            const href = anchor.href || element.getAttribute("href") || "";
            if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(href))
                add(href, element, element);
        }
        else if (tagName === "meta") {
            const property = element.getAttribute("property")?.toLowerCase();
            const name = element.getAttribute("name")?.toLowerCase();
            if (property === "og:image" || name === "twitter:image")
                add(element.getAttribute("content"), undefined, element);
        }
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            if (imageSrcsetAttributes.includes(name))
                continue;
            if ((tagName === "img" || tagName === "source") && imageAttributes.includes(name))
                continue;
            if (tagName === "a" && name === "href" && /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(attribute.value))
                continue;
            if (tagName === "meta" && name === "content" && (element.getAttribute("property") === "og:image" || element.getAttribute("name") === "twitter:image"))
                continue;
            const textPositionElement = tagName === "meta" || tagName === "script" || tagName === "style"
                ? undefined
                : positionElement;
            if (relativeImageAttributes.includes(name) && isRelativeImageCandidate(attribute.value)) {
                add(attribute.value, textPositionElement, element);
                continue;
            }
            scanText(attribute.value, textPositionElement, element);
        }
        scanBackground(element);
        finishElement();
    };
    const yieldToPage = async () => {
        checkDeadline();
        await new Promise(resolve => setTimeout(resolve, 0));
        checkDeadline();
    };
    const root = document.documentElement;
    const chunkSize = 250;
    const observedShadowRoots = new Set();
    const pendingElements = new Set();
    const pendingRemovedElements = new Set();
    let pendingFlushPromise;
    let observer;
    let resolveWait;
    let quietTimer;
    let maxTimer;
    let settled = false;
    let quietStarted = false;
    const maxWaitMs = 800;
    const quietWaitMs = 250;
    const finish = () => {
        if (settled)
            return;
        settled = true;
        if (quietTimer !== undefined)
            clearTimeout(quietTimer);
        if (maxTimer !== undefined)
            clearTimeout(maxTimer);
        observer?.disconnect();
        resolveWait?.();
    };
    const waitForQuiet = () => {
        if (!quietStarted)
            return;
        if (quietTimer !== undefined)
            clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietWaitMs);
    };
    const flushPending = () => {
        if (pendingFlushPromise)
            return pendingFlushPromise;
        const run = async () => {
            while (pendingElements.size > 0 || pendingRemovedElements.size > 0) {
                const removed = [...pendingRemovedElements];
                pendingRemovedElements.clear();
                for (const element of removed) {
                    const tree = pageElements(element, false);
                    for (const node of tree) {
                        checkDeadline();
                        if (isInPageTree(node))
                            continue;
                        registry.removeElement(node);
                    }
                }
                const batch = [...pendingElements];
                pendingElements.clear();
                for (const element of batch) {
                    if (!isInPageTree(element))
                        continue;
                    const tree = pageElements(element, true);
                    checkDeadline();
                    for (let start = 0; start < tree.length; start += chunkSize) {
                        for (const node of tree.slice(start, start + chunkSize))
                            collectElement(node);
                        if (start + chunkSize < tree.length)
                            await yieldToPage();
                    }
                }
            }
        };
        pendingFlushPromise = run().finally(() => { pendingFlushPromise = undefined; });
        return pendingFlushPromise;
    };
    const queueMutationElements = (mutations) => {
        for (const mutation of mutations) {
            if (performance.now() >= deadline)
                return false;
            if (mutation.type === "attributes") {
                if (mutation.target.nodeType === 1)
                    pendingElements.add(mutation.target);
                continue;
            }
            for (const node of Array.from(mutation.addedNodes)) {
                if (performance.now() >= deadline)
                    return false;
                if (node.nodeType === 1)
                    pendingElements.add(node);
            }
            for (const node of Array.from(mutation.removedNodes ?? [])) {
                if (performance.now() >= deadline)
                    return false;
                if (node.nodeType === 1)
                    pendingRemovedElements.add(node);
            }
        }
        return true;
    };
    let waitPromise;
    if (root && typeof MutationObserver !== "undefined") {
        waitPromise = new Promise(resolve => { resolveWait = resolve; });
        observer = new MutationObserver(mutations => {
            if (performance.now() >= deadline) {
                finish();
                return;
            }
            if (!queueMutationElements(mutations)) {
                finish();
                return;
            }
            if (performance.now() >= deadline) {
                finish();
                return;
            }
            if (mutations.length > 0)
                waitForQuiet();
        });
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
        });
        maxTimer = setTimeout(finish, maxWaitMs);
    }
    const composedParent = (element) => {
        if (element.parentElement)
            return element.parentElement;
        const treeRoot = element.getRootNode?.();
        return treeRoot && "host" in treeRoot ? treeRoot.host : null;
    };
    const isInPageTree = (element) => {
        for (let current = element; current; current = composedParent(current)) {
            checkDeadline();
            if (current === root)
                return true;
        }
        return false;
    };
    const pageElements = (start, observeRoots) => {
        const elements = [];
        const pending = [start];
        const pushChildren = (parent) => {
            const children = Array.from(parent.children);
            for (let index = children.length - 1; index >= 0; index -= 1) {
                const child = children[index];
                if (child)
                    pending.push(child);
            }
        };
        while (pending.length > 0) {
            checkDeadline();
            const element = pending.pop();
            if (!element)
                continue;
            elements.push(element);
            const shadowRoot = element.shadowRoot;
            if (shadowRoot) {
                if (observeRoots && !observedShadowRoots.has(shadowRoot)) {
                    observedShadowRoots.add(shadowRoot);
                    observer?.observe(shadowRoot, { childList: true, subtree: true, attributes: true });
                }
                // Visit ordinary children first to preserve their existing document
                // order, then include the host's open shadow tree.
                pushChildren(shadowRoot);
            }
            pushChildren(element);
        }
        return elements;
    };
    try {
        checkDeadline();
        const elements = pageElements(root, true);
        for (let start = 0; start < elements.length; start += chunkSize) {
            for (const element of elements.slice(start, start + chunkSize))
                collectElement(element);
            if (start + chunkSize < elements.length)
                await yieldToPage();
        }
        await flushPending();
        checkDeadline();
        if (waitPromise && !settled) {
            quietStarted = true;
            waitForQuiet();
        }
        await waitPromise;
        checkDeadline();
        await flushPending();
        checkDeadline();
    }
    finally {
        finish();
    }
    checkDeadline();
    if (targetPostId && ![...document.querySelectorAll('article[data-testid="tweet"], dialog, [role="dialog"]')].some(inTargetPost)) {
        throw new Error("Xの投稿を読み取れませんでした。");
    }
    if (targetPostId) {
        // A node can be moved into another post during the short observation window.
        registry.retainElements(inTargetPost);
    }
    const images = orderedImages();
    checkDeadline();
    const media = registry.media();
    checkDeadline();
    return { url: location.href, title: document.title, images, ...(media.length > 0 ? { media } : {}) };
}
