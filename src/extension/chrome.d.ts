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
  sidePanel: {
    setPanelBehavior(behavior: {openPanelOnActionClick: boolean}): Promise<void>;
  };
  runtime: {
    getURL(path: string): string;
    getManifest(): HarvestManifest;
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
  };
  scripting: {
    executeScript<T>(injection: {target: {tabId: number}; func: () => T}): Promise<Array<{result: T}>>;
  };
  permissions: {
    request(permissions: {origins: string[]}): Promise<boolean>;
  };
};
