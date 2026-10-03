interface HarvestPort {
  name: string;
  sender?: {tab?: HarvestTab};
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {addListener(listener: (message: {url?: unknown; busy?: boolean}) => void): void};
  onDisconnect: {addListener(listener: () => void): void};
}

interface HarvestTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  status?: string;
}

interface HarvestManifest {
  optional_host_permissions?: string[];
}

declare const chrome: {
  downloads: {
    download(options: {url: string; filename: string; conflictAction: "uniquify"}): Promise<number>;
    search(query: {id: number}): Promise<Array<{id: number; state: string; error?: string}>>;
    cancel(id: number): Promise<void>;
    onChanged: {
      addListener(listener: (delta: {id: number; state?: {current?: string}; error?: {current?: string}}) => void): void;
      removeListener(listener: (delta: {id: number; state?: {current?: string}; error?: {current?: string}}) => void): void;
    };
  };
  i18n: {
    getUILanguage(): string;
  };
  sidePanel: {
    setPanelBehavior(behavior: {openPanelOnActionClick: boolean}): Promise<void>;
  };
  runtime: {
    connect(options: {name: string}): HarvestPort;
    onConnect: {addListener(listener: (port: HarvestPort) => void): void};
    getURL(path: string): string;
    getManifest(): HarvestManifest;
  };
  windows: {
    create(options: {url: string; focused: boolean; state: "minimized"; type: "normal"}): Promise<{id?: number; tabs?: HarvestTab[]} | undefined>;
    remove(windowId: number): Promise<void>;
  };
  tabs: {
    query(queryInfo: Record<string, unknown>): Promise<HarvestTab[]>;
    create(createProperties: {url: string; active?: boolean}): Promise<HarvestTab>;
    get(tabId: number): Promise<HarvestTab>;
    remove(tabId: number): Promise<void>;
    onUpdated: {
      addListener(listener: (tabId: number, changeInfo: {status?: string}) => void): void;
      removeListener(listener: (tabId: number, changeInfo: {status?: string}) => void): void;
    };
    onRemoved: {
      addListener(listener: (tabId: number) => void): void;
      removeListener(listener: (tabId: number) => void): void;
    };
  };
  scripting: {
    executeScript<T, A extends unknown[]>(injection: {target: {tabId: number}; world?: "ISOLATED" | "MAIN"; func: (...args: A) => T; args?: A}): Promise<Array<{result: Awaited<T>; documentId?: string}>>;
  };
  permissions: {
    request(permissions: {origins: string[]}): Promise<boolean>;
  };
};
