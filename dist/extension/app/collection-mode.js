/**
 * Capture ordinary clicks on links in the page where this function is injected.
 * Keep the implementation self-contained because Chrome serializes the function
 * passed to scripting.executeScript before running it in the page.
 */
export function captureCollectionLinks(session) {
    const port = chrome.runtime.connect({ name: session });
    let busy = false;
    let pdfUrl = null;
    let canExport = false;
    let lastHover = null;
    const pendingClicks = new Map();
    const analyzedLinks = new Map();
    const markedTargets = new Map();
    const onMessage = (message) => {
        if (typeof message !== "object" || message === null)
            return;
        if ("busy" in message && typeof message.busy === "boolean")
            busy = message.busy;
        if ("pdfUrl" in message)
            pdfUrl = typeof message.pdfUrl === "string" ? message.pdfUrl : null;
        if ("canExport" in message && typeof message.canExport === "boolean")
            canExport = message.canExport;
        if (!busy && typeof pdfUrl === "string") {
            const targets = pendingClicks.get(pdfUrl) ?? analyzedLinks.get(pdfUrl);
            if (targets) {
                const analyzed = analyzedLinks.get(pdfUrl) ?? new Set();
                for (const target of targets) {
                    analyzed.add(target);
                    markTarget(target, pdfUrl);
                }
                analyzedLinks.set(pdfUrl, analyzed);
            }
        }
        redrawMarkedTargets();
        hovered = null;
        if (busy)
            hideGlow();
        else
            redrawHover();
    };
    const glow = document.createElement("div");
    glow.setAttribute("aria-hidden", "true");
    glow.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;display:none;border-radius:5px;box-shadow:inset 0 0 0 3px rgba(125,235,255,.95),0 0 0 2px rgba(125,235,255,.9),0 0 12px 5px rgba(70,210,255,.7),0 0 26px 8px rgba(70,210,255,.35);background:transparent;";
    document.documentElement.append(glow);
    let hovered = null;
    const hideGlow = () => { hovered = null; glow.style.display = "none"; };
    const cyanGlow = "inset 0 0 0 3px rgba(125,235,255,.95),0 0 0 2px rgba(125,235,255,.9),0 0 12px 5px rgba(70,210,255,.7),0 0 26px 8px rgba(70,210,255,.35)";
    const goldGlow = "inset 0 0 0 4px rgba(255,235,140,1),0 0 0 3px rgba(255,205,65,1),0 0 16px 7px rgba(255,190,40,.9),0 0 34px 12px rgba(255,170,20,.55)";
    const desiredGlow = (url) => canExport && url === pdfUrl ? goldGlow : cyanGlow;
    const markTarget = (target, url) => {
        const desired = desiredGlow(url);
        if (!markedTargets.has(target)) {
            const style = target.style;
            markedTargets.set(target, {
                url,
                value: style.getPropertyValue("box-shadow"),
                priority: style.getPropertyPriority("box-shadow"),
                applied: desired,
            });
        }
        else {
            const state = markedTargets.get(target);
            state.url = url;
            state.applied = desired;
        }
        const style = target.style;
        style.setProperty("box-shadow", desired, "important");
        markedTargets.get(target).applied = style.getPropertyValue("box-shadow");
    };
    const redrawMarkedTargets = () => {
        for (const [target, state] of markedTargets) {
            state.applied = desiredGlow(state.url);
            const style = target.style;
            style.setProperty("box-shadow", state.applied, "important");
            state.applied = style.getPropertyValue("box-shadow");
        }
    };
    const findLink = (event) => {
        const anchor = event.composedPath().find((node) => {
            if (!node || typeof node !== "object")
                return false;
            const element = node;
            return element.nodeType === 1 && element.tagName.toLowerCase() === "a" && element.hasAttribute("href");
        });
        const href = anchor?.getAttribute("href");
        if (!anchor || !href)
            return null;
        try {
            const url = new URL(href, document.baseURI || location.href);
            return url.protocol === "http:" || url.protocol === "https:" ? { anchor, url } : null;
        }
        catch {
            return null;
        }
    };
    const onHover = (event) => {
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
        const image = event.composedPath().find((node) => node instanceof Element && node.tagName.toLowerCase() === "img");
        const target = image ?? link.anchor;
        lastHover = { anchor: link.anchor, url: link.url, target, modifier: false };
        drawHover(lastHover);
    };
    const drawHover = (state) => {
        if (busy || state.modifier) {
            hideGlow();
            return;
        }
        const { target, url } = state;
        if (hovered === target)
            return;
        hovered = target;
        glow.style.boxShadow = desiredGlow(url.href);
        const rect = target.getBoundingClientRect();
        glow.style.left = `${rect.left}px`;
        glow.style.top = `${rect.top}px`;
        glow.style.width = `${rect.width}px`;
        glow.style.height = `${rect.height}px`;
        glow.style.display = "block";
    };
    const redrawHover = () => {
        if (!lastHover)
            return;
        hovered = null;
        drawHover(lastHover);
    };
    const onLeave = () => { lastHover = null; hideGlow(); };
    const onClick = (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
        const link = findLink(event);
        if (!link)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        hideGlow();
        if (!busy) {
            const image = event.composedPath().find((node) => node instanceof Element && node.tagName.toLowerCase() === "img");
            const targets = pendingClicks.get(link.url.href) ?? new Set();
            targets.add(image ?? link.anchor);
            pendingClicks.set(link.url.href, targets);
            port.postMessage({ url: link.url.href });
        }
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("pointermove", onHover, true);
        document.removeEventListener("pointerout", onLeave, true);
        document.removeEventListener("scroll", onLeave, true);
        window.removeEventListener("resize", onLeave);
        for (const [target, state] of markedTargets) {
            const style = target.style;
            if (style.getPropertyValue("box-shadow") !== state.applied || style.getPropertyPriority("box-shadow") !== "important")
                continue;
            if (state.value || state.priority)
                style.setProperty("box-shadow", state.value, state.priority);
            else
                style.removeProperty("box-shadow");
        }
        glow.remove();
    });
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointermove", onHover, true);
    document.addEventListener("pointerout", onLeave, true);
    document.addEventListener("scroll", onLeave, true);
    window.addEventListener("resize", onLeave);
}
