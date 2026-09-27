import { scanDocument } from "./page-scan.js";
const timeoutMs = 20000;
/** Ends the caller's wait and always releases listeners, even when Chrome rejects. */
function bounded(start, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let cleanup;
        const finish = (error, value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            cleanup?.();
            if (error)
                reject(error);
            else
                resolve(value);
        };
        const onAbort = () => finish(new Error("ページの解析を終了しました。"));
        const timer = setTimeout(() => finish(new Error("ページの読み取りが時間切れになりました。もう一度お試しください。")), timeoutMs);
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            cleanup = start(value => finish(undefined, value), error => finish(error));
            if (settled)
                cleanup?.();
        }
        catch {
            finish(new Error("ページを読み取れませんでした。"));
        }
    });
}
export async function scanTab(tabId, signal) {
    const result = await bounded((resolve, reject) => {
        const onRemoved = (id) => {
            if (id === tabId)
                reject(new Error("解析中のタブが閉じられました。"));
        };
        chrome.tabs.onRemoved.addListener(onRemoved);
        void chrome.scripting.executeScript({ target: { tabId }, func: scanDocument }).then(([injection]) => {
            if (injection?.result)
                resolve(injection.result);
            else
                reject(new Error("ページを読み取れませんでした。"));
        }, () => reject(new Error("このページを読み取れませんでした。Chromeで開けるWebページを指定してください。")));
        return () => chrome.tabs.onRemoved.removeListener(onRemoved);
    }, signal);
    await bounded((resolve, reject) => {
        void chrome.tabs.get(tabId).then(tab => {
            if (tab.url && tab.url.split("#")[0] !== result.url.split("#")[0]) {
                reject(new Error("解析中にページが移動しました。もう一度解析してください。"));
            }
            else
                resolve();
        }, () => reject(new Error("解析中のタブが閉じられました。")));
    }, signal);
    return result;
}
export async function scanUrl(url, signal) {
    if (signal?.aborted)
        throw new Error("ページの解析を終了しました。");
    // Wait for create to settle so a tab created after cancellation can still be closed.
    const tab = await chrome.tabs.create({ url, active: false });
    const tabId = tab.id;
    if (tabId === undefined)
        throw new Error("指定したページを開けませんでした。");
    try {
        await bounded((resolve, reject) => {
            const onUpdated = (id, change) => {
                if (id === tabId && change.status === "complete")
                    resolve();
            };
            const onRemoved = (id) => {
                if (id === tabId)
                    reject(new Error("解析中のタブが閉じられました。"));
            };
            chrome.tabs.onUpdated.addListener(onUpdated);
            chrome.tabs.onRemoved.addListener(onRemoved);
            void chrome.tabs.get(tabId).then(current => {
                if (current.status === "complete")
                    resolve();
            }, () => reject(new Error("指定したページを開けませんでした。")));
            return () => {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                chrome.tabs.onRemoved.removeListener(onRemoved);
            };
        }, signal);
        return await scanTab(tabId, signal);
    }
    finally {
        await chrome.tabs.remove(tabId).catch(() => undefined);
    }
}
