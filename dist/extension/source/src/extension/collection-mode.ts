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
  type PersistentGlow = {url: string; anchor: HTMLAnchorElement; overlay: HTMLElement};
  let lastHover: HoverState | null = null;
  const pendingClicks = new Map<string, Set<Element>>();
  const analyzedLinks = new Map<string, Set<Element>>();
  const markedTargets = new Map<Element, PersistentGlow>();
  const targetAnchors = new WeakMap<Element, HTMLAnchorElement>();
  const overlayElements = new WeakSet<Element>();

  const resolveLinkUrl = (anchor: HTMLAnchorElement): URL | null => {
    const href = anchor.getAttribute("href");
    if (!href) return null;
    try {
      const url = new URL(href, document.baseURI || location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch { return null; }
  };

  const unlinkTargetForUrl = (target: Element, url: string): void => {
    for (const links of [pendingClicks, analyzedLinks]) {
      const targets = links.get(url);
      if (!targets) continue;
      targets.delete(target);
      if (targets.size === 0) links.delete(url);
    }
    const state = markedTargets.get(target);
    if (state?.url === url) {
      state.overlay.remove();
      markedTargets.delete(target);
    }
  };

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
          const anchor = targetAnchors.get(target);
          if (!anchor || resolveLinkUrl(anchor)?.href !== pdfUrl) {
            unlinkTargetForUrl(target, pdfUrl);
            continue;
          }
          analyzed.add(target);
          markTarget(target, pdfUrl, anchor);
        }
        if (analyzed.size > 0) analyzedLinks.set(pdfUrl, analyzed);
        else analyzedLinks.delete(pdfUrl);
      }
    }
    redrawMarkedTargets();
    hovered = null;
    if (busy) hideGlow();
    else redrawHover();
  };

  const glow = document.createElement("div");
  overlayElements.add(glow);
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
    for (const record of records) {
      if (record.type !== "attributes" || record.attributeName !== "href") continue;
      const anchor = record.target as HTMLAnchorElement;
      const currentUrl = resolveLinkUrl(anchor)?.href ?? null;
      for (const links of [pendingClicks, analyzedLinks]) {
        for (const [url, targets] of links) {
          if (url === currentUrl) continue;
          for (const target of targets) {
            if (target === anchor || targetAnchors.get(target) === anchor) unlinkTargetForUrl(target, url);
          }
        }
      }
      for (const [target, state] of markedTargets) {
        if (state.anchor === anchor && state.url !== currentUrl) unlinkTargetForUrl(target, state.url);
      }
    }
    if (records.some(record => record.removedNodes.length > 0)) pruneDetachedTargets();
    const isOwnedOverlay = (node: Node): boolean => node instanceof Element && overlayElements.has(node);
    const pageChanged = records.some(record => {
      if (record.type === "attributes" && overlayElements.has(record.target as Element)) return false;
      if (record.type === "childList") {
        const changedNodes = [...record.addedNodes, ...record.removedNodes];
        return changedNodes.some(node => !isOwnedOverlay(node));
      }
      return !overlayElements.has(record.target as Element);
    });
    if (pageChanged) scheduleRedraw();
  });
  observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, characterData: true});

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

  const markTarget = (target: Element, url: string, anchor: HTMLAnchorElement): void => {
    if (!target.isConnected) return;
    let state = markedTargets.get(target);
    if (!state) {
      const overlay = document.createElement("div");
      overlayElements.add(overlay);
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;display:block;border-radius:5px;background:transparent;";
      document.documentElement.append(overlay);
      state = {url, anchor, overlay};
      markedTargets.set(target, state);
    } else {
      state.url = url;
      state.anchor = anchor;
    }
    state.overlay.style.boxShadow = desiredGlow(url);
    positionGlow(target, state.overlay);
  };

  const redrawMarkedTargets = (): void => {
    for (const [target, state] of markedTargets) {
      if (resolveLinkUrl(state.anchor)?.href !== state.url) {
        unlinkTargetForUrl(target, state.url);
        continue;
      }
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
    if (!anchor) return null;
    const url = resolveLinkUrl(anchor);
    return url ? {anchor, url} : null;
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
    if (hovered === target) scheduleRedraw();
    else drawHover(lastHover);
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

  let redrawFrame: number | null = null;
  const scheduleRedraw = (): void => {
    if (redrawFrame !== null) return;
    redrawFrame = window.requestAnimationFrame(() => {
      redrawFrame = null;
      pruneDetachedTargets();
      redrawMarkedTargets();
      redrawHover();
    });
  };

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRedraw);
  resizeObserver?.observe(document.documentElement);
  const onResourceLoad = (): void => scheduleRedraw();
  document.addEventListener("load", onResourceLoad, true);
  document.addEventListener("transitionend", scheduleRedraw, true);
  document.addEventListener("animationend", scheduleRedraw, true);
  document.fonts?.addEventListener("loadingdone", scheduleRedraw);

  const onLeave = (): void => { lastHover = null; hideGlow(); };
  const onScroll = (): void => { onLeave(); pruneDetachedTargets(); scheduleRedraw(); };
  const onResize = (): void => { onLeave(); pruneDetachedTargets(); scheduleRedraw(); };

  const onClick = (event: MouseEvent): void => {
    if (!event.isTrusted) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = findLink(event);
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hideGlow();
    if (!busy) {
      const image = event.composedPath().find((node): node is Element =>
        node instanceof Element && node.tagName.toLowerCase() === "img");
      const target = image ?? link.anchor;
      targetAnchors.set(target, link.anchor);
      const targets = pendingClicks.get(link.url.href) ?? new Set<Element>();
      targets.add(target);
      pendingClicks.set(link.url.href, targets);
      port.postMessage({url: link.url.href});
    }
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    observer.disconnect();
    resizeObserver?.disconnect();
    if (redrawFrame !== null) window.cancelAnimationFrame(redrawFrame);
    document.fonts?.removeEventListener("loadingdone", scheduleRedraw);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointermove", onHover, true);
    document.removeEventListener("pointerout", onLeave, true);
    document.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("load", onResourceLoad, true);
    document.removeEventListener("transitionend", scheduleRedraw, true);
    document.removeEventListener("animationend", scheduleRedraw, true);
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
