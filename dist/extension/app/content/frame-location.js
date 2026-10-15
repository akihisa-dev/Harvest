/** Verify inherited provenance with browser-owned properties in the isolated world. */
export function readFrameLocation() {
    const url = location.href;
    if (!/^about:(?:srcdoc|blank)(?:[?#]|$)/.test(url))
        return { url };
    const origin = window.origin;
    if (origin === "null")
        return { url };
    try {
        let current = window;
        while (current !== current.parent) {
            current = current.parent;
            // Browser-enforced DOM access includes opaque CSP and iframe sandbox
            // origins. Stay isolated so page scripts cannot replace window.parent.
            const parentDocument = current.document;
            const parentUrl = parentDocument.location.href;
            if (/^https?:\/\//.test(parentUrl)) {
                // DOM access can be relaxed independently of the actual origin.
                return new URL(parentUrl).origin === origin ? { url, sourcePage: parentUrl } : { url };
            }
            if (!/^about:(?:srcdoc|blank)(?:[?#]|$)/.test(parentUrl))
                break;
        }
    }
    catch {
        // Cross-origin and opaque documents retain their original, untrusted URL.
    }
    return { url };
}
