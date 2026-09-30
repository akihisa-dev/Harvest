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
  const motionAnimations = new Set<Animation>();
  const motionElements = new Set<HTMLElement>();
  const hoverGhosts = new Set<HTMLElement>();
  const ghostAnimations = new Map<HTMLElement, Animation>();
  const motionFrames = new Set<number>();
  let hideTimer: number | null = null;

  const prefersReducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const animateOut = (overlay: HTMLElement): void => {
    if (prefersReducedMotion() || typeof overlay.animate !== "function") {
      overlay.remove();
      return;
    }
    const style = getComputedStyle(overlay);
    const animation = overlay.animate([
      {opacity: style.opacity, transform: style.transform},
      {opacity: "0", transform: "scale(.78)"},
    ], {duration: 160, easing: "cubic-bezier(.2,.75,.25,1)"});
    motionAnimations.add(animation);
    motionElements.add(overlay);
    const finish = (): void => {
      motionAnimations.delete(animation);
      motionElements.delete(overlay);
      overlay.remove();
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  };

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
      animateOut(state.overlay);
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
    if (busy) hideGlow();
    else redrawHover();
  };

  const glow = document.createElement("div");
  overlayElements.add(glow);
  glow.setAttribute("aria-hidden", "true");
  glow.setAttribute("data-harvest-collection-hover", "true");
  glow.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;display:none;opacity:0;transform:scale(.82);transform-origin:center;border-radius:5px;transition:opacity 160ms cubic-bezier(.2,.75,.25,1),transform 160ms cubic-bezier(.2,.75,.25,1),box-shadow 160ms ease;background:transparent;";
  document.documentElement.append(glow);
  let hovered: Element | null = null;
  let visualTarget: Element | null = null;
  const hideGlow = (): void => {
    hovered = null;
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    if (glow.style.display === "none") return;
    if (prefersReducedMotion()) {
      glow.style.display = "none";
      glow.style.opacity = "0";
      visualTarget = null;
      return;
    }
    glow.style.opacity = "0";
    glow.style.transform = "scale(.82)";
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (hovered === null) {
        glow.style.display = "none";
        visualTarget = null;
      }
    }, 180);
  };

  const pruneDetachedTargets = (): void => {
    for (const [target, state] of markedTargets) {
      if (target.isConnected) continue;
      animateOut(state.overlay);
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
      overlay.setAttribute("data-harvest-collection-marker", "true");
      overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;display:block;opacity:0;transform:scale(.88);transform-origin:center;border-radius:5px;transition:opacity 180ms cubic-bezier(.2,.75,.25,1),transform 180ms cubic-bezier(.2,.75,.25,1),box-shadow 180ms ease;background:transparent;";
      document.documentElement.append(overlay);
      if (!prefersReducedMotion()) void overlay.offsetWidth;
      state = {url, anchor, overlay};
      markedTargets.set(target, state);
      if (!prefersReducedMotion()) {
        const frame = window.requestAnimationFrame(() => {
          motionFrames.delete(frame);
          if (markedTargets.get(target)?.overlay !== overlay) return;
          overlay.style.opacity = "1";
          overlay.style.transform = "scale(1)";
        });
        motionFrames.add(frame);
      } else {
        overlay.style.transition = "none";
        overlay.style.opacity = "1";
        overlay.style.transform = "scale(1)";
      }
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
      state.overlay.style.transition = prefersReducedMotion()
        ? "none"
        : "opacity 180ms cubic-bezier(.2,.75,.25,1),transform 180ms cubic-bezier(.2,.75,.25,1),box-shadow 180ms ease";
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
    if (hovered === target || (visualTarget === target && glow.style.display !== "none")) {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      hovered = target;
      glow.style.transition = prefersReducedMotion()
        ? "none"
        : "opacity 160ms cubic-bezier(.2,.75,.25,1),transform 160ms cubic-bezier(.2,.75,.25,1),box-shadow 160ms ease";
      if (prefersReducedMotion()) {
        glow.style.opacity = "1";
        glow.style.transform = "scale(1)";
      } else {
        glow.style.opacity = "1";
        glow.style.transform = "scale(1)";
      }
      glow.style.boxShadow = desiredGlow(url.href);
      positionGlow(target, glow);
      return;
    }
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (glow.style.display !== "none" && !prefersReducedMotion() && typeof glow.animate === "function") {
      const oldGlow = glow.cloneNode(false) as HTMLElement;
      overlayElements.add(oldGlow);
      oldGlow.setAttribute("data-harvest-collection-motion-ghost", "true");
      oldGlow.style.transition = "none";
      document.documentElement.append(oldGlow);
      const oldStyle = getComputedStyle(glow);
      const animation = oldGlow.animate([
        {opacity: oldStyle.opacity, transform: oldStyle.transform},
        {opacity: "0", transform: "scale(.78)"},
      ], {duration: 140, easing: "cubic-bezier(.2,.75,.25,1)"});
      motionAnimations.add(animation);
      motionElements.add(oldGlow);
      const finish = (): void => {
        motionAnimations.delete(animation);
        motionElements.delete(oldGlow);
        hoverGhosts.delete(oldGlow);
        ghostAnimations.delete(oldGlow);
        oldGlow.remove();
      };
      animation.onfinish = finish;
      animation.oncancel = finish;
      hoverGhosts.add(oldGlow);
      ghostAnimations.set(oldGlow, animation);
      while (hoverGhosts.size > 3) {
        const oldestGhost = hoverGhosts.values().next().value as HTMLElement | undefined;
        if (!oldestGhost) break;
        ghostAnimations.get(oldestGhost)?.cancel();
        hoverGhosts.delete(oldestGhost);
        ghostAnimations.delete(oldestGhost);
        motionElements.delete(oldestGhost);
        oldestGhost.remove();
      }
    }
    hovered = target;
    visualTarget = target;
    glow.style.boxShadow = desiredGlow(url.href);
    const rect = target.getBoundingClientRect();
    glow.style.left = `${rect.left}px`;
    glow.style.top = `${rect.top}px`;
    glow.style.width = `${rect.width}px`;
    glow.style.height = `${rect.height}px`;
    glow.style.display = "block";
    if (prefersReducedMotion()) {
      glow.style.transition = "none";
      glow.style.opacity = "1";
      glow.style.transform = "scale(1)";
      return;
    }
    glow.style.transition = "none";
    glow.style.opacity = "0";
    glow.style.transform = "scale(.82)";
    void glow.offsetWidth;
    glow.style.transition = "opacity 160ms cubic-bezier(.2,.75,.25,1),transform 160ms cubic-bezier(.2,.75,.25,1),box-shadow 160ms ease";
    glow.style.opacity = "1";
    glow.style.transform = "scale(1)";
  };

  const redrawHover = (): void => {
    if (!lastHover) return;
    const url = resolveLinkUrl(lastHover.anchor);
    if (!url || !lastHover.anchor.isConnected || !lastHover.target.isConnected) {
      lastHover = null;
      hideGlow();
      return;
    }
    lastHover.url = url;
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
    document.fonts?.removeEventListener("loadingdone", scheduleRedraw);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointermove", onHover, true);
    document.removeEventListener("pointerout", onLeave, true);
    document.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("load", onResourceLoad, true);
    document.removeEventListener("transitionend", scheduleRedraw, true);
    document.removeEventListener("animationend", scheduleRedraw, true);
    window.removeEventListener("resize", onResize);
    if (redrawFrame !== null) window.cancelAnimationFrame(redrawFrame);
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    for (const frame of motionFrames) window.cancelAnimationFrame(frame);
    motionFrames.clear();
    for (const animation of motionAnimations) animation.cancel();
    motionAnimations.clear();
    for (const element of [...motionElements]) element.remove();
    motionElements.clear();
    for (const ghost of hoverGhosts) ghost.remove();
    hoverGhosts.clear();
    ghostAnimations.clear();
    for (const state of markedTargets.values()) animateOut(state.overlay);
    markedTargets.clear();
    pendingClicks.clear();
    analyzedLinks.clear();
    lastHover = null;
    visualTarget = null;
    animateOut(glow);
  });
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointermove", onHover, true);
  document.addEventListener("pointerout", onLeave, true);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
}
