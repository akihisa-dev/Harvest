import { captureCollectionLinks } from "./collection-mode.js";
export function createCollectionController(options) {
    // Keep stopped injections until their one permitted connection arrives, so
    // a late page-side capture can be disconnected without touching a new one.
    const pendingConnections = new Map();
    let activeSession = null;
    function publishState() {
        const session = activeSession;
        const port = session?.port;
        if (!port)
            return;
        const message = { busy: options.isBusy(), pdfUrl: session.analyzedUrl, canExport: options.canExport() };
        try {
            port.postMessage(message);
        }
        catch {
            if (activeSession === session)
                stop();
        }
    }
    function stop() {
        const session = activeSession;
        if (session?.phase === "preparing")
            pendingConnections.delete(session.name);
        activeSession = null;
        if (session) {
            session.analyzedUrl = null;
            const port = session.port;
            session.port = null;
            port?.disconnect();
        }
        options.button.textContent = options.startLabel;
        options.button.setAttribute("aria-pressed", "false");
    }
    async function toggle() {
        if (activeSession) {
            stop();
            return;
        }
        const session = {
            name: `harvest-collection:${crypto.randomUUID()}`,
            phase: "preparing", tabId: null, port: null, analyzedUrl: null,
        };
        pendingConnections.set(session.name, session);
        activeSession = session;
        options.button.textContent = options.stopLabel;
        options.button.setAttribute("aria-pressed", "true");
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeSession !== session || options.isDisposed())
                return;
            if (tab?.id === undefined || !isWebUrl(tab.url))
                throw new Error(options.noPageError);
            session.tabId = tab.id;
            session.phase = "injecting";
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureCollectionLinks, args: [session.name] });
        }
        catch (error) {
            if (activeSession !== session)
                return;
            stop();
            options.onError(error);
        }
        finally {
            if (session.phase !== "injecting")
                pendingConnections.delete(session.name);
        }
    }
    chrome.runtime.onConnect?.addListener(port => {
        const session = pendingConnections.get(port.name);
        if (!session)
            return;
        pendingConnections.delete(port.name);
        session.phase = "connected";
        if (session !== activeSession || port.sender?.tab?.id !== session.tabId) {
            port.disconnect();
            return;
        }
        session.port?.disconnect();
        session.port = port;
        publishState();
        port.onMessage.addListener(message => {
            if (activeSession !== session || session.port !== port || options.isBusy() || options.isDisposed() ||
                typeof message.url !== "string" || !isWebUrl(message.url))
                return;
            if (session.analyzedUrl === message.url) {
                options.onExport();
                return;
            }
            options.onScanUrl(message.url);
        });
        port.onDisconnect.addListener(() => {
            if (activeSession === session && session.port === port)
                stop();
        });
    });
    options.button.addEventListener("click", () => { void toggle(); });
    return {
        get session() { return activeSession?.name ?? null; },
        get analyzedUrl() { return activeSession?.analyzedUrl ?? null; },
        toggle,
        stop,
        clearAnalyzedUrl() {
            if (activeSession)
                activeSession.analyzedUrl = null;
        },
        markAnalyzedUrl(url, session) {
            if (activeSession)
                activeSession.analyzedUrl = session === activeSession.name ? url : null;
        },
        publishState,
    };
}
function isWebUrl(url) {
    return url !== undefined && /^https?:\/\//i.test(url);
}
