import { captureCollectionLinks } from "../content/collection-mode.js";

interface CollectionPort {
  name: string;
  sender?: {tab?: {id?: number}};
  postMessage(message: {busy: boolean; pdfUrl: string | null; canExport: boolean}): void;
  disconnect(): void;
  onMessage: {addListener(listener: (message: unknown) => void): void};
  onDisconnect: {addListener(listener: () => void): void};
}

export interface CollectionControllerOptions {
  readonly button: HTMLButtonElement;
  readonly startLabel: string;
  readonly stopLabel: string;
  readonly noPageError: string;
  readonly isBusy: () => boolean;
  readonly isDisposed: () => boolean;
  readonly canExport: () => boolean;
  readonly onScanUrl: (url: string) => void;
  readonly onExport: () => void;
  readonly onError: (error: unknown) => void;
}

export interface CollectionController {
  readonly session: string | null;
  readonly analyzedUrl: string | null;
  toggle(): Promise<void>;
  stop(): void;
  clearAnalyzedUrl(): void;
  markAnalyzedUrl(url: string, session: string | null): void;
  publishState(): void;
}

interface CollectionSession {
  readonly name: string;
  phase: "preparing" | "injecting" | "connected";
  tabId: number | null;
  port: CollectionPort | null;
  analyzedUrl: string | null;
}

export function createCollectionController(options: CollectionControllerOptions): CollectionController {
  // Keep stopped injections until their one permitted connection arrives, so
  // a late page-side capture can be disconnected without touching a new one.
  const pendingConnections = new Map<string, CollectionSession>();
  let activeSession: CollectionSession | null = null;

  function publishState(): void {
    const session = activeSession;
    const port = session?.port;
    if (!port) return;
    const message = {busy: options.isBusy(), pdfUrl: session.analyzedUrl, canExport: options.canExport()};
    try {
      port.postMessage(message);
    } catch {
      if (activeSession === session) stop();
    }
  }

  function stop(): void {
    const session = activeSession;
    if (session?.phase === "preparing") pendingConnections.delete(session.name);
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

  async function toggle(): Promise<void> {
    if (options.isDisposed()) return;
    if (activeSession) {
      stop();
      return;
    }
    const session: CollectionSession = {
      name: `harvest-collection:${crypto.randomUUID()}`,
      phase: "preparing", tabId: null, port: null, analyzedUrl: null,
    };
    pendingConnections.set(session.name, session);
    activeSession = session;
    options.button.textContent = options.stopLabel;
    options.button.setAttribute("aria-pressed", "true");
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (activeSession !== session || options.isDisposed()) return;
      if (tab?.id === undefined || !isWebUrl(tab.url)) throw new Error(options.noPageError);
      session.tabId = tab.id;
      session.phase = "injecting";
      await chrome.scripting.executeScript({target: {tabId: tab.id}, func: captureCollectionLinks, args: [session.name]});
    } catch (error) {
      if (activeSession !== session) return;
      stop();
      options.onError(error);
    } finally {
      if (session.phase !== "injecting") pendingConnections.delete(session.name);
    }
  }

  chrome.runtime.onConnect?.addListener(port => {
    const session = pendingConnections.get(port.name);
    if (!session) return;
    pendingConnections.delete(port.name);
    session.phase = "connected";
    if (options.isDisposed() || session !== activeSession || port.sender?.tab?.id !== session.tabId) {
      port.disconnect();
      return;
    }
    session.port?.disconnect();
    session.port = port;
    publishState();
    port.onMessage.addListener(message => {
      if (activeSession !== session || session.port !== port || options.isBusy() || options.isDisposed() ||
          typeof message !== "object" || message === null || !("url" in message) || typeof message.url !== "string" || !isWebUrl(message.url)) return;
      if (session.analyzedUrl === message.url) {
        options.onExport();
        return;
      }
      options.onScanUrl(message.url);
    });
    port.onDisconnect.addListener(() => {
      if (activeSession === session && session.port === port) stop();
    });
  });
  options.button.addEventListener("click", () => { void toggle(); });

  return {
    get session() { return activeSession?.name ?? null; },
    get analyzedUrl() { return activeSession?.analyzedUrl ?? null; },
    toggle,
    stop,
    clearAnalyzedUrl() {
      if (activeSession) activeSession.analyzedUrl = null;
    },
    markAnalyzedUrl(url, session) {
      if (activeSession?.name === session) activeSession.analyzedUrl = url;
    },
    publishState,
  };
}

function isWebUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}
