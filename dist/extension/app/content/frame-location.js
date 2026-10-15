/** Verify inherited provenance with browser-owned properties in the isolated world. */
export function readFrameLocation() {
    const url = location.href;
    if (!/^about:(?:srcdoc|blank)(?:[?#]|$)/.test(url))
        return { url };
    try {
        let current = window;
        while (current !== current.parent) {
            current = current.parent;
            // Browser-enforced DOM access includes opaque CSP and iframe sandbox
            // origins. Stay isolated so page scripts cannot replace window.parent.
            const parentDocument = current.document;
            const parentUrl = parentDocument.location.href;
            if (/^https?:\/\//.test(parentUrl))
                return { url, sourcePage: parentUrl };
            if (!/^about:(?:srcdoc|blank)(?:[?#]|$)/.test(parentUrl))
                break;
        }
    }
    catch {
        // Cross-origin and opaque documents retain their original, untrusted URL.
    }
    return { url };
}
