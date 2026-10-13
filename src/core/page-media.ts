import {defaultDisplayedImageGroup, groupMediaImages, normalizeImageUrls, type MediaImageMetadata} from "./images.js";

interface DocumentMedia {
  url: string;
  images: readonly string[];
  media?: readonly MediaImageMetadata[];
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
    return {url: document.url, urls, media, group: key ? groups[key] : undefined,
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
    for (const url of document.urls) if (!sourcePages.has(url)) sourcePages.set(url, document.url);
    for (const item of document.media) if (!metadata.has(item.url)) metadata.set(item.url, item);
  }
  return {urls: [...sourcePages.keys()], media: [...metadata.values()],
    rejected: documents.reduce((count, document) => count + document.rejected, 0),
    initial: {selectedUrls: preferred?.group?.items ?? [], sourcePages}};
}
