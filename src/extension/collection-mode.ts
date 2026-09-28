/**
 * Capture ordinary clicks on links in the page where this function is injected.
 * Keep the implementation self-contained because Chrome serializes the function
 * passed to scripting.executeScript before running it in the page.
 */
export function captureCollectionLinks(session: string): void {
  const port = chrome.runtime.connect({name: session});
  let busy = false;
  let pdfUrl: string | null = null;
  let canExport = false;
  type HoverState = {anchor: HTMLAnchorElement; url: URL; target: Element; modifier: boolean};
  type PersistentGlow = {url: string; overlay: HTMLElement};
  let lastHover: HoverState | null = null;
  const pendingClicks = new Map<string, Set<Element>>();
  const analyzedLinks = new Map<string, Set<Element>>();
  const markedTargets = new Map<Element, PersistentGlow>();

  const onMessage = (message: unknown): void => {
    if (typeof message !== "object" || message === null) return;
    if ("busy" in message && typeof message.busy === "boolean") busy = message.busy;
    if ("pdfUrl" in message) pdfUrl = typeof message.pdfUrl === "string" ? message.pdfUrl : null;
    if ("canExport" in message && typeof message.canExport === "boolean") canExport = message.canExport;
    pruneDetachedTargets();
    if (!busy && typeof pdfUrl === "string") {
      const targets = pendingClicks.get(pdfUrl) ?? analyzedLinks.get(pdfUrl);
      if (targets) {
        const analyzed = analyzedLinks.get(pdfUrl) ?? new Set<Element>();
        for (const target of targets) {
          if (!target.isConnected) continue;
          analyzed.add(target);
          markTarget(target, pdfUrl);
        }
        analyzedLinks.set(pdfUrl, analyzed);
      }
    }
    redrawMarkedTargets();
    hovered = null;
    if (busy) hideGlow();
    else redrawHover();
  };

  const glow = document.createElement("div");
  glow.setAttribute("aria-hidden", "true");
  glow.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;display:none;border-radius:5px;box-shadow:inset 0 0 0 3px rgba(125,235,255,.95),0 0 0 2px rgba(125,235,255,.9),0 0 12px 5px rgba(70,210,255,.7),0 0 26px 8px rgba(70,210,255,.35);background:transparent;";
  document.documentElement.append(glow);
  let hovered: Element | null = null;
  const hideGlow = (): void => { hovered = null; glow.style.display = "none"; };

  const pruneDetachedTargets = (): void => {
    for (const [target, state] of markedTargets) {
      if (target.isConnected) continue;
      state.overlay.remove();
      markedTargets.delete(target);
    }
    for (const links of [pendingClicks, analyzedLinks]) {
      for (const [url, targets] of links) {
        for (const target of targets) if (!target.isConnected) targets.delete(target);
        if (targets.size === 0) links.delete(url);
      }
    }
    if (lastHover && (!lastHover.anchor.isConnected || !lastHover.target.isConnected)) {
      lastHover = null;
      hideGlow();
    }
  };

  const observer = new MutationObserver(records => {
    if (records.some(record => record.removedNodes.length > 0)) pruneDetachedTargets();
  });
  observer.observe(document.documentElement, {childList: true, subtree: true});

  const cyanGlow = "inset 0 0 0 3px rgba(125,235,255,.95),0 0 0 2px rgba(125,235,255,.9),0 0 12px 5px rgba(70,210,255,.7),0 0 26px 8px rgba(70,210,255,.35)";
  const goldGlow = "inset 0 0 0 4px rgba(255,235,140,1),0 0 0 3px rgba(255,205,65,1),0 0 16px 7px rgba(255,190,40,.9),0 0 34px 12px rgba(255,170,20,.55)";
  const desiredGlow = (url: string): string => canExport && url === pdfUrl ? goldGlow : cyanGlow;

  const positionGlow = (target: Element, overlay: HTMLElement): void => {
    const rect = target.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };

  const markTarget = (target: Element, url: string): void => {
    if (!target.isConnected) return;
    let state = markedTargets.get(target);
    if (!state) {
      const overlay = document.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;display:block;border-radius:5px;background:transparent;";
      document.documentElement.append(overlay);
      state = {url, overlay};
      markedTargets.set(target, state);
    } else state.url = url;
    state.overlay.style.boxShadow = desiredGlow(url);
    positionGlow(target, state.overlay);
  };

  const redrawMarkedTargets = (): void => {
    for (const [target, state] of markedTargets) {
      state.overlay.style.boxShadow = desiredGlow(state.url);
      positionGlow(target, state.overlay);
    }
  };

  const findLink = (event: MouseEvent): {anchor: HTMLAnchorElement; url: URL} | null => {
    const anchor = event.composedPath().find((node): node is HTMLAnchorElement => {
      if (!node || typeof node !== "object") return false;
      const element = node as Element;
      return element.nodeType === 1 && element.tagName.toLowerCase() === "a" && element.hasAttribute("href");
    });
    const href = anchor?.getAttribute("href");
    if (!anchor || !href) return null;
    try {
      const url = new URL(href, document.baseURI || location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? {anchor, url} : null;
    } catch { return null; }
  };

  const onHover = (event: MouseEvent): void => {
    if (busy || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      lastHover = null;
      hideGlow();
      return;
    }
    const link = findLink(event);
    if (!link) {
      lastHover = null;
      hideGlow();
      return;
    }
    const image = event.composedPath().find((node): node is Element =>
      node instanceof Element && node.tagName.toLowerCase() === "img");
    const target = image ?? link.anchor;
    lastHover = {anchor: link.anchor, url: link.url, target, modifier: false};
    drawHover(lastHover);
  };

  const drawHover = (state: HoverState): void => {
    if (busy || state.modifier) { hideGlow(); return; }
    const {target, url} = state;
    if (hovered === target) return;
    hovered = target;
    glow.style.boxShadow = desiredGlow(url.href);
    const rect = target.getBoundingClientRect();
    glow.style.left = `${rect.left}px`;
    glow.style.top = `${rect.top}px`;
    glow.style.width = `${rect.width}px`;
    glow.style.height = `${rect.height}px`;
    glow.style.display = "block";
  };

  const redrawHover = (): void => {
    if (!lastHover) return;
    hovered = null;
    drawHover(lastHover);
  };

  const onLeave = (): void => { lastHover = null; hideGlow(); };
  const onScroll = (): void => { onLeave(); pruneDetachedTargets(); redrawMarkedTargets(); };
  const onResize = (): void => { onLeave(); pruneDetachedTargets(); redrawMarkedTargets(); };

  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = findLink(event);
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hideGlow();
    if (!busy) {
      const image = event.composedPath().find((node): node is Element =>
        node instanceof Element && node.tagName.toLowerCase() === "img");
      const targets = pendingClicks.get(link.url.href) ?? new Set<Element>();
      targets.add(image ?? link.anchor);
      pendingClicks.set(link.url.href, targets);
      port.postMessage({url: link.url.href});
    }
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    observer.disconnect();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointermove", onHover, true);
    document.removeEventListener("pointerout", onLeave, true);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    for (const state of markedTargets.values()) state.overlay.remove();
    markedTargets.clear();
    pendingClicks.clear();
    analyzedLinks.clear();
    lastHover = null;
    glow.remove();
  });
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointermove", onHover, true);
  document.addEventListener("pointerout", onLeave, true);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
}
