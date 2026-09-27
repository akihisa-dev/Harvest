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
      if (typeof value === "boolean") busy = value;
    }
  };

  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const anchor = path.find((node): node is HTMLAnchorElement => {
      if (!node || typeof node !== "object") return false;
      const element = node as Element;
      return element.nodeType === 1 && element.tagName.toLowerCase() === "a" && element.hasAttribute("href");
    });
    if (!anchor) return;

    const rawHref = anchor.getAttribute("href");
    if (!rawHref) return;
    let url: URL;
    try {
      url = new URL(rawHref, document.baseURI || location.href);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (!busy) port.postMessage({url: url.href});
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    document.removeEventListener("click", onClick, true);
  });
  document.addEventListener("click", onClick, true);
}
