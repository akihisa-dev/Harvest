import { captureCollectionLinks } from "./collection-mode.js";
export function createCollectionController(options) {
    const sessions = new Set();
    const injectionStartedSessions = new Set();
    let activeSession = null;
    let activeTabId = null;
    let activePort = null;
    let lastAnalyzedUrl = null;
    function publishState() {
        const port = activePort;
        if (!port)
            return;
        const message = { busy: options.isBusy(), pdfUrl: lastAnalyzedUrl, canExport: options.canExport() };
        try {
            port.postMessage(message);
        }
        catch {
            if (activePort === port)
                stop();
        }
    }
    function stop() {
        lastAnalyzedUrl = null;
        if (activeSession !== null && !injectionStartedSessions.has(activeSession))
            sessions.delete(activeSession);
        activeSession = null;
        activeTabId = null;
        const port = activePort;
        activePort = null;
        port?.disconnect();
        options.button.textContent = options.startLabel;
        options.button.setAttribute("aria-pressed", "false");
    }
    async function toggle() {
        if (activeSession) {
            stop();
            return;
        }
        const session = `harvest-collection:${crypto.randomUUID()}`;
        sessions.add(session);
        activeSession = session;
        options.button.textContent = options.stopLabel;
        options.button.setAttribute("aria-pressed", "true");
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeSession !== session || options.isDisposed())
                return;
            if (tab?.id === undefined || !isWebUrl(tab.url))
                throw new Error(options.noPageError);
            activeTabId = tab.id;
            injectionStartedSessions.add(session);
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureCollectionLinks, args: [session] });
        }
        catch (error) {
            if (activeSession !== session)
                return;
            stop();
            options.onError(error);
        }
        finally {
            if (!injectionStartedSessions.has(session))
                sessions.delete(session);
        }
    }
    chrome.runtime.onConnect?.addListener(port => {
        if (!sessions.delete(port.name))
            return;
        injectionStartedSessions.delete(port.name);
        if (port.name !== activeSession || port.sender?.tab?.id !== activeTabId) {
            port.disconnect();
            return;
        }
        activePort?.disconnect();
        activePort = port;
        publishState();
        port.onMessage.addListener(message => {
            if (activePort !== port || !activeSession || options.isBusy() || options.isDisposed() ||
                typeof message.url !== "string" || !isWebUrl(message.url))
                return;
            if (lastAnalyzedUrl === message.url) {
                options.onExport();
                return;
            }
            options.onScanUrl(message.url);
        });
        port.onDisconnect.addListener(() => {
            if (activePort === port)
                stop();
        });
    });
    options.button.addEventListener("click", () => { void toggle(); });
    return {
        get session() { return activeSession; },
        get analyzedUrl() { return lastAnalyzedUrl; },
        toggle,
        stop,
        clearAnalyzedUrl() {
            lastAnalyzedUrl = null;
        },
        markAnalyzedUrl(url, session) {
            lastAnalyzedUrl = session !== null && session === activeSession ? url : null;
        },
        publishState,
    };
}
function isWebUrl(url) {
    return url !== undefined && /^https?:\/\//i.test(url);
}
