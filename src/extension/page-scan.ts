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
  const candidates = new Set<string>();
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
  const imageSrcsetAttributes = ["data-srcset", "srcset"];
  const imageUrlPattern = /https?:\/\/[^\s"'\\<>]+?\.(?:jpe?g|png|webp|avif)(?:[?#][^\s"'\\<>]*)?/gi;

  const add = (value: string | null | undefined): void => {
    const candidate = value?.trim();
    if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:")) return;
    try {
      candidates.add(new URL(candidate, document.baseURI || location.href).href);
    } catch {
      // Keep malformed values for the core normalizer to reject consistently.
      candidates.add(candidate);
    }
  };

  const scanText = (value: string | null | undefined): void => {
    if (!value) return;
    for (const match of value.matchAll(imageUrlPattern)) {
      const candidate = match[0];
      if (candidate) add(candidate.replaceAll("&amp;", "&"));
    }
  };

  type SrcsetEntry = {url: string; value: number; kind: "w" | "x" | null};

  const parseSrcset = (value: string): SrcsetEntry[] => {
    const entries: SrcsetEntry[] = [];
    let index = 0;
    while (index < value.length) {
      while (index < value.length && (value[index] === "," || /\s/.test(value[index] ?? ""))) index += 1;
      if (index >= value.length) break;

      const start = index;
      let whitespace = -1;
      let commaSeparator = -1;
      while (index < value.length) {
        if (/\s/.test(value[index] ?? "")) {
          whitespace = index;
          break;
        }
        if (value[index] === "," && /\s/.test(value[index + 1] ?? "")) {
          commaSeparator = index;
          break;
        }
        index += 1;
      }

      // With no descriptor, keep a comma in the URL unless it is clearly a
      // srcset separator (a comma followed by whitespace).  This preserves
      // valid URLs such as /scan,page.jpg while still accepting the common
      // "small.jpg, large.jpg" form.
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
    let background = "";
    try {
      background = getComputedStyle(element).backgroundImage;
    } catch {
      // A detached or browser-owned element may not have computed styles.
    }
    const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    for (const match of background.matchAll(urlPattern)) {
      add(match[1] ?? match[2] ?? match[3]);
    }
  };

  const collectElement = (element: Element): void => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === "img" || tagName === "source") {
      for (const attribute of imageAttributes) add(element.getAttribute(attribute));
      for (const attribute of imageSrcsetAttributes) {
        for (const candidate of srcsetImages(element.getAttribute(attribute))) add(candidate);
      }
      if (tagName === "img") {
        const image = element as HTMLImageElement;
        add(image.currentSrc || image.src);
      }
    } else if (tagName === "a") {
      const anchor = element as HTMLAnchorElement;
      const href = anchor.href || element.getAttribute("href") || "";
      if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(href)) add(href);
    } else if (tagName === "meta") {
      const property = element.getAttribute("property")?.toLowerCase();
      const name = element.getAttribute("name")?.toLowerCase();
      if (property === "og:image" || name === "twitter:image") add(element.getAttribute("content"));
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (imageSrcsetAttributes.includes(name)) continue;
      if ((tagName === "img" || tagName === "source") && imageAttributes.includes(name)) continue;
      if (tagName === "a" && name === "href" && /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(attribute.value)) continue;
      if (tagName === "meta" && name === "content" && (element.getAttribute("property") === "og:image" || element.getAttribute("name") === "twitter:image")) continue;
      scanText(attribute.value);
    }
    scanBackground(element);
  };

  const yieldToPage = async (): Promise<void> => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };

  const root = document.documentElement;
  const chunkSize = 250;
  const pendingElements = new Set<Element>();
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
      while (pendingElements.size > 0) {
        const batch = [...pendingElements];
        pendingElements.clear();
        for (const element of batch) {
          const tree = [element, ...Array.from(element.querySelectorAll<Element>("*"))];
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

  const queueMutationElements = (mutations: readonly MutationRecord[]): void => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target.nodeType === 1) pendingElements.add(mutation.target as Element);
        continue;
      }
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType === 1) pendingElements.add(node as Element);
      }
    }
  };

  let waitPromise: Promise<void> | undefined;
  if (root && typeof MutationObserver !== "undefined") {
    waitPromise = new Promise<void>(resolve => { resolveWait = resolve; });
    observer = new MutationObserver(mutations => {
      queueMutationElements(mutations);
      if (mutations.length > 0) waitForQuiet();

    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "src", "srcset", "href", "data-src", "data-srcset", "data-original", "data-full", "data-high-res", "data-lazyload", "data-lazy-src", "data-lib-src", "data-image", "data-url"],
    });
    maxTimer = setTimeout(finish, maxWaitMs);
  }

  try {
  const elements = Array.from(document.querySelectorAll<Element>("*"));
  for (let start = 0; start < elements.length; start += chunkSize) {
    for (const element of elements.slice(start, start + chunkSize)) collectElement(element);
    if (start + chunkSize < elements.length) await yieldToPage();
  }
  for (const node of Array.from(document.querySelectorAll<HTMLScriptElement>("script, style"))) {
    scanText(node.textContent);
  }
  if (root && typeof document.createTreeWalker === "function") {
    const walker = document.createTreeWalker(root, 4);
    let textNode = walker.nextNode();
    let textCount = 0;
    while (textNode) {
      scanText(textNode.textContent);
      textCount += 1;
      if (textCount % chunkSize === 0) await yieldToPage();
      textNode = walker.nextNode();
    }
  }
  await flushPending();
  if (waitPromise && !settled) {
    quietStarted = true;
    waitForQuiet();
  }
  await waitPromise;
  await flushPending();
  } finally { finish(); }

  return {url: location.href, title: document.title, images: [...candidates]};
}
