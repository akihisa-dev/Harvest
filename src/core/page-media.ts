import {defaultDisplayedImageGroup, groupMediaImages, normalizeImageUrls, type MediaImageMetadata} from "./images.js";

import {isStreamRecording} from "./stream-recording.js";

interface DocumentMedia {
  url: string;
  /** Source whose real origin was verified by the browser. */
  sourcePage?: string;
  images: readonly string[];
  media?: readonly MediaImageMetadata[];
}

function sameWebOrigin(image: string, source: string): boolean {
  try {
    const target = new URL(image), page = new URL(source);
    return (page.protocol === "http:" || page.protocol === "https:") && target.origin === page.origin;
  } catch { return false; }
}

/** Keep document provenance and selection independent from the combined URL groups. */
export function collectPageMedia(page: DocumentMedia, frames: readonly DocumentMedia[] = []) {
  const documents = [page, ...frames].map(document => {
    const urls = normalizeImageUrls([...(document.media ?? []).map(item => item.url), ...document.images], document.url);
    const media = (document.media ?? []).flatMap(item => {
      const url = normalizeImageUrls([item.url], document.url)[0];
      return url ? [{...item, url}] : [];
    });
    const groups = groupMediaImages(urls, media);
    const key = defaultDisplayedImageGroup(groups);
    return {url: document.sourcePage ?? document.url, verifiedSource: document.sourcePage !== undefined, urls, media, group: key ? groups[key] : undefined,
      rejected: (document.media ?? []).length - media.length};
  });
  // Existing page selection always wins. With an empty shell, prefer a frame
  // containing a body series, retaining frame order for otherwise equal choices.
  const preferred = documents[0]!.urls.length ? documents[0]
    : documents.slice(1).find(document => document.group?.isMangaBody)
      ?? documents.slice(1).find(document => document.urls.length);
  const sourcePages = new Map<string, string>();
  const metadata = new Map<string, MediaImageMetadata>();
  for (const document of documents) {
    for (const url of document.urls) {
      const previous = sourcePages.get(url);
      // Updating an existing Map value preserves its original display position.
      // Only an observed document with a browser-verified origin can replace it.
      if (previous === undefined || (document.verifiedSource && !sameWebOrigin(url, previous) && sameWebOrigin(url, document.url))) {
        sourcePages.set(url, document.url);
      }
    }
    for (const item of document.media) {
      const previous = metadata.get(item.url);
      // Enrich the first occurrence without changing its position or display evidence.
      if (!previous) metadata.set(item.url, item);
      else if (!previous.stream && item.kind === "video" && document.verifiedSource
        && isStreamRecording(item.stream, item.url) && sameWebOrigin(item.stream.pageUrl, document.url)) {
        metadata.set(item.url, {...previous, kind: "video", stream: item.stream});
      }
    }
  }
  return {urls: [...sourcePages.keys()], media: [...metadata.values()],
    rejected: documents.reduce((count, document) => count + document.rejected, 0),
    initial: {selectedUrls: preferred?.group?.items ?? [], sourcePages}};
}
