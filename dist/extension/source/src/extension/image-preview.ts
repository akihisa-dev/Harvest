import type { ImageItem } from "../core/images.js";
import { fetchImage } from "./image-fetch.js";
import type { ImageDataOptions } from "./image-data-contract.js";

interface PreviewFetchOptions extends ImageDataOptions {
  readonly sourcePage: string;
}

interface PreviewEntry {
  readonly key: string;
  readonly item: ImageItem;
  readonly controller: AbortController;
  readonly elements: Set<HTMLImageElement>;
  started: boolean;
  queued: boolean;
  objectUrl?: string;
}

interface BoundPreview {
  readonly key: string;
}

export interface ImagePreviewLoader {
  /** Attach a local image or schedule a network preview; eager previews start immediately. */
  set(image: HTMLImageElement, item: ImageItem, eager?: boolean): void;
  /** Release one image element's fetch and object URL reference. */
  clearImage(image: HTMLImageElement): void;
  /** Cancel pending previews and release every object URL owned by this loader. */
  clear(): void;
}

function entryKey(item: ImageItem): string {
  return JSON.stringify([item.url, item.sourcePage]);
}

function previewBlob(item: Awaited<ReturnType<typeof fetchImage>>): Blob {
  return item.kind === "bitmap" ? item.blob : new Blob([item.page.jpeg.slice().buffer as ArrayBuffer], {type: "image/jpeg"});
}

/** Loads all remote previews through the shared, policy-controlled image fetcher. */
export function createImagePreviewLoader(): ImagePreviewLoader {
  const maximumConcurrentFetches = 3;
  const entries = new Map<string, PreviewEntry>();
  const bindings = new Map<HTMLImageElement, BoundPreview>();
  const queue: PreviewEntry[] = [];
  let activeFetches = 0;
  const observer = typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(changes => {
      for (const change of changes) {
        if (!change.isIntersecting) continue;
        const key = bindings.get(change.target as HTMLImageElement)?.key;
        const entry = key ? entries.get(key) : undefined;
        if (entry) start(entry);
      }
    });

  function pumpQueue(): void {
    while (activeFetches < maximumConcurrentFetches && queue.length) {
      const entry = queue.shift()!;
      entry.queued = false;
      if (entries.get(entry.key) !== entry || !entry.elements.size) continue;
      entry.started = true;
      activeFetches += 1;
      const options = {signal: entry.controller.signal, sourcePage: entry.item.sourcePage} as PreviewFetchOptions;
      void fetchImage(entry.item.url, options).then(fetched => {
        if (entries.get(entry.key) !== entry || !entry.elements.size) return;
        const objectUrl = URL.createObjectURL(previewBlob(fetched));
        entry.objectUrl = objectUrl;
        for (const image of entry.elements) {
          image.src = objectUrl;
          image.dataset["previewUrl"] = entry.item.url;
          delete image.dataset["previewFailed"];
        }
      }).catch(() => {
        if (entries.get(entry.key) !== entry) return;
        for (const image of entry.elements) image.dataset["previewFailed"] = "true";
      }).finally(() => {
        activeFetches -= 1;
        pumpQueue();
      });
    }
  }

  function start(entry: PreviewEntry): void {
    if (entry.started || entry.queued || entry.objectUrl || !entry.elements.size) return;
    entry.queued = true;
    queue.push(entry);
    pumpQueue();
  }

  function release(image: HTMLImageElement): void {
    observer?.unobserve(image);
    const binding = bindings.get(image);
    if (!binding) return;
    bindings.delete(image);
    delete image.dataset["previewUrl"];
    const entry = entries.get(binding.key);
    if (!entry) return;
    entry.elements.delete(image);
    if (entry.objectUrl && image.src === entry.objectUrl) image.removeAttribute("src");
    if (entry.elements.size) return;
    entry.controller.abort();
    if (entry.queued) {
      const queueIndex = queue.indexOf(entry);
      if (queueIndex >= 0) queue.splice(queueIndex, 1);
      entry.queued = false;
    }
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    entries.delete(entry.key);
  }

  function clearImage(image: HTMLImageElement): void {
    release(image);
    image.removeAttribute("src");
    delete image.dataset["previewUrl"];
    delete image.dataset["previewFailed"];
  }

  return {
    set(image, item, eager = false) {
      const key = entryKey(item);
      const current = bindings.get(image);
      if (current?.key === key) {
        const entry = entries.get(key);
        if (eager && entry) start(entry);
        return;
      }
      release(image);
      delete image.dataset["previewFailed"];
      if (item.url.startsWith("data:")) {
        if (image.getAttribute("src") !== item.url) image.src = item.url;
        image.dataset["previewUrl"] = item.url;
        return;
      }

      image.removeAttribute("src");
      image.dataset["previewUrl"] = item.url;
      image.loading = "lazy";
      let entry = entries.get(key);
      if (!entry) {
        entry = {key, item, controller: new AbortController(), elements: new Set(), started: false, queued: false};
        entries.set(key, entry);
      }
      entry.elements.add(image);
      bindings.set(image, {key});
      if (entry.objectUrl) image.src = entry.objectUrl;
      else if (eager || !observer) start(entry);
      else observer?.observe(image);
    },
    clearImage,
    clear() {
      for (const image of [...bindings.keys()]) clearImage(image);
      for (const entry of entries.values()) {
        entry.controller.abort();
        if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      }
      entries.clear();
    },
  };
}
