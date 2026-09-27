/**
 * Capture ordinary clicks on links in the page where this function is injected.
 * Keep the implementation self-contained because Chrome serializes the function
 * passed to scripting.executeScript before running it in the page.
 */
export function captureCollectionLinks(session: string): void {
  const port = chrome.runtime.connect({name: session});
  let busy = false;

  const onMessage = (message: unknown): void => {
    if (typeof message === "object" && message !== null && "busy" in message) {
      const value = (message as {busy?: unknown}).busy;
      if (typeof value === "boolean") { busy = value; if (busy) hideGlow(); }
    }
  };

  const glow = document.createElement("div");
  glow.setAttribute("aria-hidden", "true");
  glow.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;display:none;border-radius:5px;box-shadow:0 0 5px 2px rgba(130,190,255,.45),0 0 14px 4px rgba(130,190,255,.22);background:transparent;";
  document.documentElement.append(glow);
  let hovered: Element | null = null;
  const hideGlow = (): void => { hovered = null; glow.style.display = "none"; };

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
    if (busy || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { hideGlow(); return; }
    const link = findLink(event);
    if (!link) { hideGlow(); return; }
    const image = event.composedPath().find((node): node is Element =>
      node instanceof Element && node.tagName.toLowerCase() === "img");
    const target = image ?? link.anchor;
    if (hovered === target) return;
    hovered = target;
    const rect = target.getBoundingClientRect();
    glow.style.left = `${rect.left}px`;
    glow.style.top = `${rect.top}px`;
    glow.style.width = `${rect.width}px`;
    glow.style.height = `${rect.height}px`;
    glow.style.display = "block";
  };

  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = findLink(event);
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hideGlow();
    if (!busy) port.postMessage({url: link.url.href});
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointermove", onHover, true);
    document.removeEventListener("pointerout", hideGlow, true);
    document.removeEventListener("scroll", hideGlow, true);
    window.removeEventListener("resize", hideGlow);
    glow.remove();
  });
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointermove", onHover, true);
  document.addEventListener("pointerout", hideGlow, true);
  document.addEventListener("scroll", hideGlow, true);
  window.addEventListener("resize", hideGlow);
}
