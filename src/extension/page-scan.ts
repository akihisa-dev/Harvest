export interface PageScan {
  url: string;
  title: string;
  images: string[];
}

/**
 * Collect image candidates from the current page.
 *
 * This function is passed directly to chrome.scripting.executeScript.  Keep
 * every helper inside the function so Chrome can serialize and run it without
 * resolving an import or a module-level variable in the extension context.
 */
export async function scanDocument(): Promise<PageScan> {
  const deadline = performance.now() + 20_000;
  const checkDeadline = (): void => {
    if (performance.now() >= deadline) throw new Error("Page scan exceeded its 20 second deadline");
  };
  type CandidateRecord = {
    url: string;
    detectionOrder: number;
    sources: Map<Element, Element | undefined>;
    foundOutsideElements: boolean;
  };
  const candidates = new Map<string, CandidateRecord>();
  const elementUrls = new Map<Element, Set<string>>();
  let nextDetectionOrder = 0;
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
  const relativeImagePathPattern = /\.(?:jpe?g|png|webp|avif|gif)$/i;

  const add = (value: string | null | undefined, positionElement?: Element, sourceElement?: Element): void => {
    checkDeadline();
    const candidate = value?.trim();
    if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:")) return;
    try {
      const url = new URL(candidate, document.baseURI || location.href).href;
      recordCandidate(url, positionElement, sourceElement);
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
  };

  const scanText = (value: string | null | undefined, positionElement?: Element, sourceElement?: Element): void => {
    if (!value) return;
    for (const match of value.matchAll(imageUrlPattern)) {
      checkDeadline();
      const candidate = match[0];
      if (candidate) add(candidate.replaceAll("&amp;", "&"), positionElement, sourceElement);
    }
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
    for (const [index, element] of Array.from(document.querySelectorAll<Element>("*")).entries()) {
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
      for (let current: Element | null = element; current; current = current.parentElement) {
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
    const previousUrls = elementUrls.get(element);
    elementUrls.set(element, new Set());
    const tagName = element.tagName.toLowerCase();
    const positionElement = imagePositionElement(element);
    if (tagName === "script" || tagName === "style") scanText(element.textContent, undefined, element);
    if (tagName === "img" || tagName === "source") {
      for (const attribute of imageAttributes) add(element.getAttribute(attribute), positionElement, element);
      for (const attribute of imageSrcsetAttributes) {
        for (const candidate of srcsetImages(element.getAttribute(attribute))) add(candidate, positionElement, element);
      }
      if (tagName === "img") {
        const image = element as HTMLImageElement;
        add(image.currentSrc || image.src, positionElement, element);
      }
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
  };

  const yieldToPage = async (): Promise<void> => {
    checkDeadline();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    checkDeadline();
  };

  const root = document.documentElement;
  const chunkSize = 250;
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
          const tree = [element, ...Array.from(element.querySelectorAll<Element>("*"))];
          for (const node of tree) {
            checkDeadline();
            if (root?.contains(node)) continue;
            for (const url of elementUrls.get(node) ?? []) {
              const record = candidates.get(url);
              record?.sources.delete(node);
              if (record && record.sources.size === 0 && !record.foundOutsideElements) candidates.delete(url);
            }
            elementUrls.delete(node);
          }
        }
        const batch = [...pendingElements];
        pendingElements.clear();
        for (const element of batch) {
          if (!root?.contains(element)) continue;
          const tree = [element, ...Array.from(element.querySelectorAll<Element>("*"))];
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

  try {
  checkDeadline();
  const elements = Array.from(document.querySelectorAll<Element>("*"));
  for (let start = 0; start < elements.length; start += chunkSize) {
    for (const element of elements.slice(start, start + chunkSize)) collectElement(element);
    if (start + chunkSize < elements.length) await yieldToPage();
  }
  if (root && typeof document.createTreeWalker === "function") {
    const walker = document.createTreeWalker(root, 4);
    let textNode = walker.nextNode();
    let textCount = 0;
    while (textNode) {
      checkDeadline();
      const parent = textNode.parentElement;
      const parentTag = parent?.tagName.toLowerCase();
      // Script and style text is collected with its owning element above.
      // Associate ordinary page text with its parent too, so removing that
      // element can remove candidates found only in its text.
      if (parentTag !== "script" && parentTag !== "style") {
        scanText(textNode.textContent, undefined, parent ?? undefined);
      }
      textCount += 1;
      if (textCount % chunkSize === 0) await yieldToPage();
      textNode = walker.nextNode();
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
  const images = orderedImages();
  checkDeadline();
  return {url: location.href, title: document.title, images};
}
