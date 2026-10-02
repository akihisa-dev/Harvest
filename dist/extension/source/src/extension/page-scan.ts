export interface PageScan {
  url: string;
  title: string;
  images: string[];
  media?: Array<{url: string; kind: "image" | "gif" | "video"; previewUrl?: string}>;
}

/**
 * Collect image candidates from the current page.
 *
 * This function is passed directly to chrome.scripting.executeScript.  Keep
 * every helper inside the function so Chrome can serialize and run it without
 * resolving an import or a module-level variable in the extension context.
 */
export async function scanDocument(targetPostId?: string): Promise<PageScan> {
  const deadline = performance.now() + 20_000;
  const checkDeadline = (): void => {
    if (performance.now() >= deadline) throw new Error("Page scan exceeded its 20 second deadline");
  };
  // These DOM helpers stay inside the injected function: Chrome copies only its body.
  const quoteSelector = '[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="link"]:not(a):has(a[href*="/status/"])';
  const ownPostId = (root: Element): string | undefined => {
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].filter(link => {
      checkDeadline();
      if (link.parentElement?.closest(quoteSelector)) return false;
      const article = link.closest("article");
      return root.tagName.toLowerCase() === "article" ? article === root
        : !article && link.closest('dialog, [role="dialog"]') === root;
    });
    const permalink = links.find(link => link.querySelector("time"))
      ?? (root.tagName.toLowerCase() === "article" ? undefined : links[0]);
    if (!permalink) return undefined;
    try {
      const url = new URL(permalink.href, location.href);
      return /^(?:www\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)
        ? /\/status\/(\d+)(?:\/|$)/i.exec(url.pathname)?.[1] : undefined;
    } catch { return undefined; }
  };
  const inTargetPost = (element: Element): boolean => {
    if (!targetPostId) return true;
    if (!document.documentElement.contains(element)) return false;
    if (element.closest(quoteSelector)) return false;
    const article = element.closest("article");
    if (article) return ownPostId(article) === targetPostId;
    const dialog = element.closest('dialog, [role="dialog"]');
    return Boolean(dialog && ownPostId(dialog) === targetPostId);
  };
  if (targetPostId && ![...document.querySelectorAll('article[data-testid="tweet"], dialog, [role="dialog"]')].some(inTargetPost)) {
    throw new Error("Xの投稿を読み取れませんでした。");
  }
  type CandidateRecord = {
    url: string;
    detectionOrder: number;
    sources: Map<Element, Element | undefined>;
    foundOutsideElements: boolean;
  };
  type MediaKind = "image" | "gif" | "video";
  type MediaCandidateRecord = {
    url: string;
    kind: MediaKind;
    detectionOrder: number;
    sources: Set<Element>;
    foundOutsideElements: boolean;
  };
  const candidates = new Map<string, CandidateRecord>();
  const mediaCandidates = new Map<string, MediaCandidateRecord>();
  const elementUrls = new Map<Element, Set<string>>();
    const elementMediaUrls = new Map<Element, Set<string>>();
  let nextDetectionOrder = 0;
  let nextMediaDetectionOrder = 0;
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

  const mediaKindForUrl = (url: string): MediaKind | undefined => {
    try {
      const parsed = new URL(url, document.baseURI || location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
      // Match the format precedence and aliases used by core/images.ts.
      // This helper must stay local because Chrome serializes scanDocument.
      const queryFormat = [...parsed.searchParams.entries()].find(([name]) => /^(?:format|fmt|fm)$/i.test(name))?.[1];
      const format = queryFormat || parsed.pathname.match(/\.([a-z0-9]{2,8})$/i)?.[1] || "";
      if (format.toLowerCase().replace(/^x-/, "").replace(/\+xml$/, "") === "gif") return "gif";
    } catch {
      return undefined;
    }
    return undefined;
  };

  const recordMedia = (
    value: string | null | undefined,
    kind: MediaKind,
    sourceElement?: Element,
  ): void => {
    checkDeadline();
    const candidate = value?.trim();
    if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:")) return;
    let url: string;
    try {
      const parsed = new URL(candidate, document.baseURI || location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      url = parsed.href;
    } catch {
      return;
    }
    let record = mediaCandidates.get(url);
    if (!record) {
      record = {url, kind, detectionOrder: nextMediaDetectionOrder++, sources: new Set(), foundOutsideElements: false};
      mediaCandidates.set(url, record);
    } else if (kind === "gif" || (record.kind === "image" && kind === "video")) {
      // A known GIF remains a GIF even if the same URL also appears in a video element.
      record.kind = kind;
    }
    if (sourceElement) {
      record.sources.add(sourceElement);
      let urls = elementMediaUrls.get(sourceElement);
      if (!urls) {
        urls = new Set();
        elementMediaUrls.set(sourceElement, urls);
      }
      urls.add(url);
    } else {
      record.foundOutsideElements = true;
    }
  };

  const recordDirectVideo = (
    value: string | null | undefined,
    sourceElement: Element,
    declaredType?: string | null,
  ): void => {
    checkDeadline();
    const candidate = value?.trim();
    if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:")) return;
    try {
      const parsed = new URL(candidate, document.baseURI || location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      const pathIsVideo = /\.(?:mp4|webm)$/i.test(parsed.pathname)
        || /^(?:mp4|webm)$/i.test(parsed.searchParams.get("format") ?? "");
      const declaredVideo = /^video\/(?:mp4|webm)(?:\s*;|$)/i.test(declaredType?.trim() ?? "");
      if (pathIsVideo || declaredVideo) recordMedia(parsed.href, "video", sourceElement);
    } catch {
      // Media candidates must be usable HTTP(S) URLs.
    }
  };

  const scanMediaText = (value: string | null | undefined, sourceElement?: Element): void => {
    if (!value) return;
    for (const match of value.matchAll(mediaUrlPattern)) {
      checkDeadline();
      const candidate = (match[0] ?? "").replaceAll("&amp;", "&").replace(/[),.;!?]+$/, "");
      const kind = mediaKindForUrl(candidate);
      if (kind === "gif") recordMedia(candidate, kind, sourceElement);
    }
    checkDeadline();
  };

  const scanEmbeddedVideoJson = (script: Element): void => {
    const text = script.textContent ?? "";
    if (!text.includes("video_info") || !text.includes("variants")) return;
    const parseObjectAt = (start: number): {value: unknown; end: number} | undefined => {
      const opening = text[start];
      if (opening !== "{" && opening !== "[") return undefined;
      const expected: string[] = [opening === "{" ? "}" : "]"];
      let inString = false;
      let escaped = false;
      for (let index = start + 1; index < text.length; index += 1) {
        if (index % 4096 === 0) checkDeadline();
        const character = text[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
        } else if (character === "{" || character === "[") {
          expected.push(character === "{" ? "}" : "]");
        } else if (character === "}" || character === "]") {
          if (expected.pop() !== character) return undefined;
          if (expected.length === 0) {
            try {
              return {value: JSON.parse(text.slice(start, index + 1)) as unknown, end: index + 1};
            } catch {
              return undefined;
            }
          }
        }
      }
      return undefined;
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.trim()) as unknown;
    } catch {
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
        if (nextObject < 0) start = nextArray;
        else if (nextArray < 0) start = nextObject;
        else start = Math.min(nextObject, nextArray);
      }
    }
    if (parsed === undefined) return;

    const pending: unknown[] = [parsed];
    while (pending.length > 0) {
      checkDeadline();
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          checkDeadline();
          pending.push(value[index]);
        }
        continue;
      }
      const object = value as Record<string, unknown>;
      const videoInfo = object["video_info"];
      if (typeof videoInfo === "object" && videoInfo !== null && !Array.isArray(videoInfo)) {
        const variants = (videoInfo as Record<string, unknown>)["variants"];
        if (Array.isArray(variants)) {
          let best: {url: string; bitrate: number} | undefined;
          for (const variant of variants) {
            checkDeadline();
            if (typeof variant !== "object" || variant === null || Array.isArray(variant)) continue;
            const candidate = variant as Record<string, unknown>;
            if (typeof candidate["url"] !== "string") continue;
            const contentType = typeof candidate["content_type"] === "string"
              ? candidate["content_type"].toLowerCase()
              : typeof candidate["mime_type"] === "string" ? candidate["mime_type"].toLowerCase() : "";
            let isMp4 = /^video\/mp4(?:\s*;|$)/i.test(contentType);
            try {
              const variantUrl = new URL(candidate["url"], document.baseURI || location.href);
              isMp4 ||= /\.mp4$/i.test(variantUrl.pathname);
              if ((variantUrl.protocol !== "http:" && variantUrl.protocol !== "https:") || !isMp4) continue;
            } catch {
              continue;
            }
            const bitrate = typeof candidate["bitrate"] === "number" && Number.isFinite(candidate["bitrate"])
              ? candidate["bitrate"]
              : 0;
            if (!best || bitrate > best.bitrate) best = {url: candidate["url"], bitrate};
          }
          if (best) recordMedia(best.url, "video", script);
        }
      }
      const values = Object.values(object);
      for (let index = values.length - 1; index >= 0; index -= 1) {
        checkDeadline();
        const value = values[index];
        if (typeof value === "object" && value !== null) pending.push(value);
      }
    }
  };

  const add = (value: string | null | undefined, positionElement?: Element, sourceElement?: Element): void => {
    checkDeadline();
    const candidate = value?.trim();
    if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:")) return;
    try {
      const url = new URL(candidate, document.baseURI || location.href).href;
      recordCandidate(url, positionElement, sourceElement);
      const mediaKind = mediaKindForUrl(url);
      if (mediaKind === "gif") recordMedia(url, mediaKind, sourceElement);
    } catch {
      // Keep malformed values for the core normalizer to reject consistently.
      recordCandidate(candidate, positionElement, sourceElement);
    }
  };

  const recordCandidate = (url: string, positionElement?: Element, sourceElement?: Element): void => {
    let record = candidates.get(url);
    if (!record) {
      record = {url, detectionOrder: nextDetectionOrder++, sources: new Map(), foundOutsideElements: false};
      candidates.set(url, record);
    }
    if (sourceElement) {
      record.sources.set(sourceElement, positionElement);
      elementUrls.get(sourceElement)?.add(url);
    } else {
      record.foundOutsideElements = true;
    }
    recordMedia(url, mediaKindForUrl(url) ?? "image", sourceElement);
  };

  const scanText = (value: string | null | undefined, positionElement?: Element, sourceElement?: Element): void => {
    if (!value) return;
    for (const match of value.matchAll(imageUrlPattern)) {
      checkDeadline();
      const candidate = match[0];
      if (candidate) add(candidate.replaceAll("&amp;", "&"), positionElement, sourceElement);
    }
    scanMediaText(value, sourceElement);
    checkDeadline();
  };

  const isRelativeImageCandidate = (value: string): boolean => {
    const candidate = value.trim();
    if (!candidate || /^[a-z][a-z\d+.-]*:/i.test(candidate) || /[\s"'<>\\]/.test(candidate)) return false;
    const path = candidate.split(/[?#]/, 1)[0] ?? "";
    return Boolean(path) && relativeImagePathPattern.test(path);
  };

  type SrcsetEntry = {url: string; value: number; kind: "w" | "x" | null};

  const parseSrcset = (value: string): SrcsetEntry[] => {
    const entries: SrcsetEntry[] = [];
    let index = 0;
    while (index < value.length) {
      checkDeadline();
      while (index < value.length && (value[index] === "," || /\s/.test(value[index] ?? ""))) {
        if (index % 256 === 0) checkDeadline();
        index += 1;
      }
      if (index >= value.length) break;

      const start = index;
      let whitespace = -1;
      let commaSeparator = -1;
      while (index < value.length) {
        if (index % 256 === 0) checkDeadline();
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
        entries.push({url: value.slice(start, commaSeparator).trim(), value: 0, kind: null});
        index = commaSeparator + 1;
        continue;
      }
      if (whitespace < 0) {
        const rest = value.slice(start);
        entries.push({url: rest.trim(), value: 0, kind: null});
        break;
      }

      const url = value.slice(start, whitespace).trim();
      const comma = value.indexOf(",", whitespace);
      const descriptorText = (comma < 0 ? value.slice(whitespace) : value.slice(whitespace, comma)).trim();
      const descriptor = descriptorText.match(/^(\d+(?:\.\d+)?)(w|x)$/i);
      entries.push({
        url,
        value: descriptor ? Number(descriptor[1]) : 0,
        kind: descriptor ? (descriptor[2] ?? "").toLowerCase() as "w" | "x" : null,
      });
      if (comma < 0) break;
      index = comma + 1;
    }
    return entries.filter(entry => entry.url.length > 0);
  };

  const srcsetImages = (value: string | null | undefined): string[] => {
    if (!value) return [];
    const entries = parseSrcset(value);
    if (entries.length === 0) return [];
    // Width descriptors and density descriptors cannot be compared.  Prefer
    // the largest width when present, otherwise the largest density.  This
    // makes the result independent of the order used by the page.
    const widthEntries = entries.filter(entry => entry.kind === "w");
    const densityEntries = entries.filter(entry => entry.kind === "x");
    const sized = widthEntries.length > 0 ? widthEntries : densityEntries;
    if (sized.length === 0) return entries.map(entry => entry.url);
    const first = sized[0];
    if (!first) return [];
    let best = first;
    for (const entry of sized.slice(1)) {
      if (entry.value > best.value) best = entry;
    }
    return [best.url];
  };

  const scanBackground = (element: Element): void => {
    checkDeadline();
    let background = "";
    try {
      background = getComputedStyle(element).backgroundImage;
    } catch {
      // A detached or browser-owned element may not have computed styles.
    }
    const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    for (const match of background.matchAll(urlPattern)) {
      checkDeadline();
      add(match[1] ?? match[2] ?? match[3], element, element);
    }
  };

  const orderedImages = (): string[] => {
    const documentOrder = new Map<Element, number>();
    for (const [index, element] of pageElements(root, false).entries()) {
      checkDeadline();
      documentOrder.set(element, index);
    }
    const positionCache = new Map<Element, {top: number; left: number; order: number} | undefined>();
    const positioned = (element: Element): {top: number; left: number; order: number} | undefined => {
      checkDeadline();
      if (positionCache.has(element)) return positionCache.get(element);
      let result: {top: number; left: number; order: number} | undefined;
      if (!documentOrder.has(element)) {
        positionCache.set(element, result);
        return result;
      }
      for (let current: Element | null = element; current; current = composedParent(current)) {
        checkDeadline();
        let style: CSSStyleDeclaration | undefined;
        try {
          style = getComputedStyle(current);
        } catch {
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
        result = {top: rect.top, left: rect.left, order: documentOrder.get(element) ?? Number.MAX_SAFE_INTEGER};
      } catch {
        result = undefined;
      }
      checkDeadline();
      positionCache.set(element, result);
      return result;
    };

    const ordered = [...candidates.values()]
      .map(record => ({
        record,
        position: [...record.sources.values()].filter((element): element is Element => Boolean(element))
          .map(positioned).filter((value): value is {top: number; left: number; order: number} => Boolean(value))
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
        if (a.position) return -1;
        if (b.position) return 1;
        return a.record.detectionOrder - b.record.detectionOrder;
      })
      .map(({record}) => record.url);
    checkDeadline();
    return ordered;
  };

  const imagePositionElement = (element: Element): Element => {
    if (element.tagName.toLowerCase() !== "source") return element;
    const parent = element.parentElement;
    if (parent?.tagName.toLowerCase() === "picture" && typeof parent.querySelector === "function") {
      return parent.querySelector("img") ?? element;
    }
    return element;
  };

  const collectElement = (element: Element): void => {
    checkDeadline();
    if (!inTargetPost(element)) return;
    const previousUrls = elementUrls.get(element);
    const previousMediaUrls = elementMediaUrls.get(element);
    elementUrls.set(element, new Set());
    elementMediaUrls.set(element, new Set());
    const tagName = element.tagName.toLowerCase();
    if (targetPostId && (tagName === "script" || tagName === "style")) return;
    const declaredSourceType = tagName === "source" ? element.getAttribute("type") : null;
    const sourceUrl = tagName === "source"
      ? element.getAttribute("src") || (element as HTMLSourceElement).src
      : null;
    let sourceHasVideoUrl = false;
    if (sourceUrl) {
      try {
        const parsedSourceUrl = new URL(sourceUrl, document.baseURI || location.href);
        sourceHasVideoUrl = /\.(?:mp4|webm)$/i.test(parsedSourceUrl.pathname)
          || /^(?:mp4|webm)$/i.test(parsedSourceUrl.searchParams.get("format") ?? "");
      } catch {
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
      if (tagName === "script") scanEmbeddedVideoJson(element);
    }
    if (tagName === "video") {
      const video = element as HTMLVideoElement;
      recordDirectVideo(video.currentSrc, element, element.getAttribute("type"));
      recordDirectVideo(video.src, element, element.getAttribute("type"));
      recordDirectVideo(element.getAttribute("src"), element, element.getAttribute("type"));
    } else if (isVideoSource) {
      const source = element as HTMLSourceElement;
      recordDirectVideo(source.src, element, declaredSourceType);
      recordDirectVideo(element.getAttribute("src"), element, declaredSourceType);
    }
    if (tagName === "img" || tagName === "source") {
      for (const attribute of imageAttributes) {
        if (isVideoSource && attribute === "src") continue;
        add(element.getAttribute(attribute), positionElement, element);
      }
      if (!isVideoSource) {
        for (const attribute of imageSrcsetAttributes) {
          for (const candidate of srcsetImages(element.getAttribute(attribute))) add(candidate, positionElement, element);
        }
      }
      if (tagName === "img") {
        const image = element as HTMLImageElement;
        add(image.currentSrc || image.src, positionElement, element);
      }
    } else if (tagName === "image" && element.namespaceURI === "http://www.w3.org/2000/svg") {
      // SVG image references may be relative to the page and are not covered
      // by the generic absolute-URL scan. Keep ordinary anchor href handling
      // separate so it does not broaden image discovery.
      add(element.getAttribute("href"), element, element);
      add(element.getAttribute("xlink:href"), element, element);
    } else if (tagName === "a") {
      const anchor = element as HTMLAnchorElement;
      const href = anchor.href || element.getAttribute("href") || "";
      if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(href)) add(href, element, element);
    } else if (tagName === "meta") {
      const property = element.getAttribute("property")?.toLowerCase();
      const name = element.getAttribute("name")?.toLowerCase();
      if (property === "og:image" || name === "twitter:image") add(element.getAttribute("content"), undefined, element);
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (imageSrcsetAttributes.includes(name)) continue;
      if ((tagName === "img" || tagName === "source") && imageAttributes.includes(name)) continue;
      if (tagName === "a" && name === "href" && /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(attribute.value)) continue;
      if (tagName === "meta" && name === "content" && (element.getAttribute("property") === "og:image" || element.getAttribute("name") === "twitter:image")) continue;
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
    for (const url of previousUrls ?? []) {
      if (elementUrls.get(element)?.has(url)) continue;
      const record = candidates.get(url);
      record?.sources.delete(element);
      if (record && record.sources.size === 0 && !record.foundOutsideElements) candidates.delete(url);
    }
    for (const url of previousMediaUrls ?? []) {
      if (elementMediaUrls.get(element)?.has(url)) continue;
      const record = mediaCandidates.get(url);
      record?.sources.delete(element);
      if (record && record.sources.size === 0 && !record.foundOutsideElements) mediaCandidates.delete(url);
    }
  };

  const yieldToPage = async (): Promise<void> => {
    checkDeadline();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    checkDeadline();
  };

  const root = document.documentElement;
  const chunkSize = 250;
  const observedShadowRoots = new Set<ShadowRoot>();
  const pendingElements = new Set<Element>();
  const pendingRemovedElements = new Set<Element>();
  let pendingFlushPromise: Promise<void> | undefined;
  let observer: MutationObserver | undefined;
  let resolveWait: (() => void) | undefined;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let quietStarted = false;
  const maxWaitMs = 800;
  const quietWaitMs = 250;

  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (quietTimer !== undefined) clearTimeout(quietTimer);
    if (maxTimer !== undefined) clearTimeout(maxTimer);
    observer?.disconnect();
    resolveWait?.();
  };

  const waitForQuiet = (): void => {
    if (!quietStarted) return;
    if (quietTimer !== undefined) clearTimeout(quietTimer);
    quietTimer = setTimeout(finish, quietWaitMs);
  };

  const flushPending = (): Promise<void> => {
    if (pendingFlushPromise) return pendingFlushPromise;
    const run = async (): Promise<void> => {
      while (pendingElements.size > 0 || pendingRemovedElements.size > 0) {
        const removed = [...pendingRemovedElements];
        pendingRemovedElements.clear();
        for (const element of removed) {
          const tree = pageElements(element, false);
          for (const node of tree) {
            checkDeadline();
            if (isInPageTree(node)) continue;
            for (const url of elementUrls.get(node) ?? []) {
              const record = candidates.get(url);
              record?.sources.delete(node);
              if (record && record.sources.size === 0 && !record.foundOutsideElements) candidates.delete(url);
            }
            for (const url of elementMediaUrls.get(node) ?? []) {
              const record = mediaCandidates.get(url);
              record?.sources.delete(node);
              if (record && record.sources.size === 0 && !record.foundOutsideElements) mediaCandidates.delete(url);
            }
            elementUrls.delete(node);
            elementMediaUrls.delete(node);
          }
        }
        const batch = [...pendingElements];
        pendingElements.clear();
        for (const element of batch) {
          if (!isInPageTree(element)) continue;
          const tree = pageElements(element, true);
          checkDeadline();
          for (let start = 0; start < tree.length; start += chunkSize) {
            for (const node of tree.slice(start, start + chunkSize)) collectElement(node);
            if (start + chunkSize < tree.length) await yieldToPage();
          }
        }
      }
    };
    pendingFlushPromise = run().finally(() => { pendingFlushPromise = undefined; });
    return pendingFlushPromise;
  };

  const queueMutationElements = (mutations: readonly MutationRecord[]): boolean => {
    for (const mutation of mutations) {
      if (performance.now() >= deadline) return false;
      if (mutation.type === "attributes") {
        if (mutation.target.nodeType === 1) pendingElements.add(mutation.target as Element);
        continue;
      }
      for (const node of Array.from(mutation.addedNodes)) {
        if (performance.now() >= deadline) return false;
        if (node.nodeType === 1) pendingElements.add(node as Element);
      }
      for (const node of Array.from(mutation.removedNodes ?? [])) {
        if (performance.now() >= deadline) return false;
        if (node.nodeType === 1) pendingRemovedElements.add(node as Element);
      }
    }
    return true;
  };

  let waitPromise: Promise<void> | undefined;
  if (root && typeof MutationObserver !== "undefined") {
    waitPromise = new Promise<void>(resolve => { resolveWait = resolve; });
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
      if (mutations.length > 0) waitForQuiet();

    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    maxTimer = setTimeout(finish, maxWaitMs);
  }

  const composedParent = (element: Element): Element | null => {
    if (element.parentElement) return element.parentElement;
    const treeRoot = element.getRootNode?.();
    return treeRoot && "host" in treeRoot ? (treeRoot as ShadowRoot).host : null;
  };

  const isInPageTree = (element: Element): boolean => {
    for (let current: Element | null = element; current; current = composedParent(current)) {
      checkDeadline();
      if (current === root) return true;
    }
    return false;
  };

  const pageElements = (start: Element, observeRoots: boolean): Element[] => {
    const elements: Element[] = [];
    const pending: Element[] = [start];
    const pushChildren = (parent: ParentNode): void => {
      const children = Array.from(parent.children);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) pending.push(child);
      }
    };

    while (pending.length > 0) {
      checkDeadline();
      const element = pending.pop();
      if (!element) continue;
      elements.push(element);
      const shadowRoot = element.shadowRoot;
      if (shadowRoot) {
        if (observeRoots && !observedShadowRoots.has(shadowRoot)) {
          observedShadowRoots.add(shadowRoot);
          observer?.observe(shadowRoot, {childList: true, subtree: true, attributes: true});
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
    for (const element of elements.slice(start, start + chunkSize)) collectElement(element);
    if (start + chunkSize < elements.length) await yieldToPage();
  }
  if (root && typeof document.createTreeWalker === "function") {
    const textRoots: ParentNode[] = [root, ...observedShadowRoots];
    let textCount = 0;
    for (const textRoot of textRoots) {
      const walker = document.createTreeWalker(textRoot, 4);
      let textNode = walker.nextNode();
      while (textNode) {
        checkDeadline();
        const parentNode = textNode.parentNode;
        const parent = textNode.parentElement
          ?? (parentNode && "host" in parentNode ? (parentNode as ShadowRoot).host : null);
        const parentTag = parent?.tagName.toLowerCase();
        // Script and style text is collected with its owning element above.
        // Associate ordinary page text with its parent too, so removing that
        // element can remove candidates found only in its text.
        if (parentTag !== "script" && parentTag !== "style" && (!targetPostId || Boolean(parent && inTargetPost(parent)))) {
          scanText(textNode.textContent, undefined, parent ?? undefined);
        }
        textCount += 1;
        if (textCount % chunkSize === 0) await yieldToPage();
        textNode = walker.nextNode();
      }
    }
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
  } finally { finish(); }

  checkDeadline();
  if (targetPostId && ![...document.querySelectorAll('article[data-testid="tweet"], dialog, [role="dialog"]')].some(inTargetPost)) {
    throw new Error("Xの投稿を読み取れませんでした。");
  }
  if (targetPostId) {
    // A node can be moved into another post during the short observation window.
    for (const [url, record] of candidates) {
      checkDeadline();
      for (const source of record.sources.keys()) if (!inTargetPost(source)) record.sources.delete(source);
      if (record.sources.size === 0 && !record.foundOutsideElements) candidates.delete(url);
    }
    for (const [url, record] of mediaCandidates) {
      checkDeadline();
      for (const source of record.sources) if (!inTargetPost(source)) record.sources.delete(source);
      if (record.sources.size === 0 && !record.foundOutsideElements) mediaCandidates.delete(url);
    }
  }
  const images = orderedImages();
  checkDeadline();
  const media = [...mediaCandidates.values()]
    .sort((a, b) => a.detectionOrder - b.detectionOrder)
    .map(({url, kind}) => ({url, kind}));
  checkDeadline();
  return {url: location.href, title: document.title, images, ...(media.length > 0 ? {media} : {})};
}
