import { captureCollectionLinks } from "./collection-mode.js";

interface CollectionPort {
  name: string;
  sender?: {tab?: {id?: number}};
  postMessage(message: {busy: boolean; pdfUrl: string | null; canExport: boolean}): void;
  disconnect(): void;
  onMessage: {addListener(listener: (message: {url?: unknown}) => void): void};
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

export function createCollectionController(options: CollectionControllerOptions): CollectionController {
  const sessions = new Set<string>();
  let activeSession: string | null = null;
  let activeTabId: number | null = null;
  let activePort: CollectionPort | null = null;
  let lastAnalyzedUrl: string | null = null;

  function publishState(): void {
    activePort?.postMessage({busy: options.isBusy(), pdfUrl: lastAnalyzedUrl, canExport: options.canExport()});
  }

  function stop(): void {
    lastAnalyzedUrl = null;
    activeSession = null;
    activeTabId = null;
    const port = activePort;
    activePort = null;
    port?.disconnect();
    options.button.textContent = options.startLabel;
    options.button.setAttribute("aria-pressed", "false");
  }

  async function toggle(): Promise<void> {
    if (activeSession) { stop(); return; }
    const session = `harvest-collection:${crypto.randomUUID()}`;
    sessions.add(session);
    activeSession = session;
    options.button.textContent = options.stopLabel;
    options.button.setAttribute("aria-pressed", "true");
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (activeSession !== session || options.isDisposed()) return;
      if (tab?.id === undefined || !isWebUrl(tab.url)) throw new Error(options.noPageError);
      activeTabId = tab.id;
      await chrome.scripting.executeScript({target: {tabId: tab.id}, func: captureCollectionLinks, args: [session]});
    } catch (error) {
      if (activeSession !== session) return;
      stop();
      options.onError(error);
    }
  }

  chrome.runtime.onConnect?.addListener(port => {
    if (!sessions.delete(port.name)) return;
    if (port.name !== activeSession || port.sender?.tab?.id !== activeTabId) { port.disconnect(); return; }
    activePort?.disconnect();
    activePort = port;
    publishState();
    port.onMessage.addListener(message => {
      if (activePort !== port || !activeSession || options.isBusy() || options.isDisposed() ||
          typeof message.url !== "string" || !isWebUrl(message.url)) return;
      if (lastAnalyzedUrl === message.url) { options.onExport(); return; }
      options.onScanUrl(message.url);
    });
    port.onDisconnect.addListener(() => {
      if (activePort === port) stop();
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

function isWebUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}
