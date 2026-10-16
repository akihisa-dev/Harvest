import { defaultDisplayedImageGroup, groupMediaImages, normalizeImageUrls } from "./images.js";
function sameWebOrigin(image, source) {
    try {
        const target = new URL(image), page = new URL(source);
        return (page.protocol === "http:" || page.protocol === "https:") && target.origin === page.origin;
    }
    catch {
        return false;
    }
}
/** Keep document provenance and selection independent from the combined URL groups. */
export function collectPageMedia(page, frames = []) {
    const documents = [page, ...frames].map(document => {
        const urls = normalizeImageUrls([...(document.media ?? []).map(item => item.url), ...document.images], document.url);
        const media = (document.media ?? []).flatMap(item => {
            const url = normalizeImageUrls([item.url], document.url)[0];
            return url ? [{ ...item, url }] : [];
        });
        const groups = groupMediaImages(urls, media);
        const key = defaultDisplayedImageGroup(groups);
        return { url: document.sourcePage ?? document.url, verifiedSource: document.sourcePage !== undefined, urls, media, group: key ? groups[key] : undefined,
            rejected: (document.media ?? []).length - media.length };
    });
    // Existing page selection always wins. With an empty shell, prefer a frame
    // containing a body series, retaining frame order for otherwise equal choices.
    const preferred = documents[0].urls.length ? documents[0]
        : documents.slice(1).find(document => document.group?.isMangaBody)
            ?? documents.slice(1).find(document => document.urls.length);
    const sourcePages = new Map();
    const metadata = new Map();
    for (const document of documents) {
        for (const url of document.urls) {
            const previous = sourcePages.get(url);
            // Updating an existing Map value preserves its original display position.
            // Only an observed document with a browser-verified origin can replace it.
            if (previous === undefined || (document.verifiedSource && !sameWebOrigin(url, previous) && sameWebOrigin(url, document.url))) {
                sourcePages.set(url, document.url);
            }
        }
        for (const item of document.media)
            if (!metadata.has(item.url))
                metadata.set(item.url, item);
    }
    return { urls: [...sourcePages.keys()], media: [...metadata.values()],
        rejected: documents.reduce((count, document) => count + document.rejected, 0),
        initial: { selectedUrls: preferred?.group?.items ?? [], sourcePages } };
}
