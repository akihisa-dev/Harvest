import { defaultSelectedImageGroups, filterImagesByGroup, galleryLinkScore, groupImages, normalizeImageUrls, sortImageUrlsForSite } from "../core/images.js";
import { createPdf } from "../core/pdf.js";
const sourceUrl = required("#source-url");
const scanButton = required("#scan");
const exportButton = required("#export");
const selectAllButton = required("#select-all");
const clearAllButton = required("#clear-all");
const resetButton = required("#reset");
const completionElement = required("#completion");
const backToImagesButton = required("#back-to-images");
const qualityInput = required("#high-quality");
const imagesElement = required("#images");
const groupsElement = required("#groups");
const groupSelectionsElement = required("#group-selections");
const linksElement = required("#links");
const countElement = required("#count");
const emptyElement = required("#empty");
const statusElement = required("#status");
let images = [];
let links = [];
let pageTitle = "画像";
let rootPageUrl = "";
let activeGroupKey = null;
let busy = false;
let scanState = "initial";
let focusTarget = null;
function required(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing element: ${selector}`);
    return element;
}
function isWebUrl(url) {
    return url !== undefined && /^https?:\/\//i.test(url);
}
function scanDocument() {
    const candidates = [];
    const pageLinks = [];
    const add = (value) => {
        if (value && !value.startsWith("data:") && !value.startsWith("blob:"))
            candidates.push(value);
    };
    const lastSrcset = (value) => value?.split(",").map(part => part.trim().split(/\s+/)[0]).filter(Boolean).at(-1);
    for (const img of document.images) {
        add(img.getAttribute("data-original"));
        add(img.getAttribute("data-full"));
        add(img.getAttribute("data-high-res"));
        add(img.getAttribute("data-lib-src"));
        add(img.getAttribute("data-lazyload"));
        add(lastSrcset(img.getAttribute("data-srcset")));
        add(lastSrcset(img.getAttribute("srcset")));
        add(img.getAttribute("data-src"));
        add(img.getAttribute("data-lazy-src"));
        add(img.currentSrc || img.src);
    }
    for (const picture of document.querySelectorAll("picture source")) {
        add(lastSrcset(picture.getAttribute("srcset")));
    }
    for (const meta of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) {
        add(meta.getAttribute("content"));
    }
    for (const match of document.documentElement.outerHTML.matchAll(/https?:\/\/[^\s"'\\<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'\\<>]*)?/gi)) {
        add(match[0].replaceAll("&amp;", "&"));
    }
    for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.href;
        if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(href))
            add(href);
        if (pageLinks.length < 300 && /^https?:\/\//i.test(href)) {
            pageLinks.push({ url: href, label: (anchor.textContent || anchor.getAttribute("aria-label") || href).trim().slice(0, 100) });
        }
    }
    let inspectedBackgrounds = 0;
    for (const element of document.querySelectorAll("*")) {
        if (++inspectedBackgrounds > 5000)
            break;
        const background = getComputedStyle(element).backgroundImage;
        for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g))
            add(match[1]);
    }
    return { url: location.href, title: document.title, images: candidates, links: pageLinks };
}
function setStatus(message, state = "info") {
    statusElement.textContent = message;
    statusElement.dataset["state"] = state;
}
function requestFocus(target) { focusTarget = target; }
function restoreFocus() {
    const target = focusTarget;
    focusTarget = null;
    if (!target)
        return;
    for (const element of document.querySelectorAll("[data-focus-kind]")) {
        if (element.getAttribute("data-focus-kind") !== target.kind)
            continue;
        if (target.kind === "group" || target.kind === "pdf-group") {
            if (element.getAttribute("data-focus-key") !== target.key)
                continue;
        }
        else if (element.getAttribute("data-focus-url") !== target.url ||
            element.getAttribute("data-focus-action") !== target.action)
            continue;
        const disabled = "disabled" in element && Boolean(element.disabled);
        if (!disabled || target.kind !== "image" || target.action === "checkbox") {
            element.focus();
            return;
        }
        for (const fallback of document.querySelectorAll("[data-focus-kind]")) {
            if (fallback.getAttribute("data-focus-kind") === "image" &&
                fallback.getAttribute("data-focus-url") === target.url &&
                fallback.getAttribute("data-focus-action") === "checkbox") {
                fallback.focus();
                return;
            }
        }
    }
}
function addScan(result) {
    const existing = new Set(images.map(item => item.url));
    for (const url of sortImageUrlsForSite(normalizeImageUrls(result.images, result.url), result.url)) {
        if (existing.has(url))
            continue;
        images.push({ url, sourcePage: result.url, selected: true });
        existing.add(url);
    }
    const seen = new Set(links.map(link => link.url));
    for (const link of result.links) {
        if (galleryLinkScore(link, result.url) < 0 || seen.has(link.url))
            continue;
        links.push(link);
        seen.add(link.url);
    }
    render();
}
async function scanTab(tabId) {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: scanDocument });
    if (!injection?.result)
        throw new Error("ページを読み取れませんでした。");
    return injection.result;
}
async function scanUrl(url) {
    const tab = await chrome.tabs.create({ url, active: false });
    if (tab.id === undefined)
        throw new Error("リンク先を開けませんでした。");
    try {
        await new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                reject(new Error("リンク先の読み込みが時間切れになりました。"));
            }, 20000);
            const listener = (tabId, change) => {
                if (tabId !== tab.id || change.status !== "complete")
                    return;
                window.clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            };
            chrome.tabs.onUpdated.addListener(listener);
            void chrome.tabs.get(tab.id).then(current => {
                if (current.status === "complete")
                    listener(tab.id, { status: "complete" });
            }).catch(() => undefined);
        });
        return await scanTab(tab.id);
    }
    finally {
        await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
}
async function scanLink(url) {
    addScan(await scanUrl(url));
}
function setBusy(value) {
    busy = value;
    scanButton.disabled = value;
    sourceUrl.disabled = value;
    qualityInput.disabled = value;
    resetButton.disabled = value;
    exportButton.disabled = value || !images.some(item => item.selected);
    render();
}
async function startScan() {
    if (busy)
        return;
    const enteredUrl = sourceUrl.value.trim();
    let targetUrl = "";
    if (enteredUrl) {
        try {
            const parsed = new URL(enteredUrl);
            if (!isWebUrl(parsed.href))
                throw new Error();
            targetUrl = parsed.href;
        }
        catch {
            setStatus("HTTPまたはHTTPSのページURLを入力してください。", "error");
            return;
        }
    }
    images = [];
    links = [];
    activeGroupKey = null;
    scanState = "scanning";
    completionElement.hidden = true;
    setBusy(true);
    setStatus("ページを調べています…", "busy");
    try {
        let result;
        if (targetUrl) {
            result = await scanUrl(targetUrl);
        }
        else {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab?.id === undefined || !isWebUrl(activeTab.url)) {
                scanState = "error";
                setStatus("開いているWebページを解析できません。URLを指定してください。", "error");
                return;
            }
            result = await scanTab(activeTab.id);
        }
        pageTitle = result.title || "画像";
        rootPageUrl = result.url;
        addScan(result);
        const recommended = result.links
            .map(link => ({ link, score: galleryLinkScore(link, result.url) }))
            .filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score)[0];
        let recommendedLinkFailed = false;
        if (recommended) {
            setStatus("画像一覧につながるリンク先を調べています…", "busy");
            try {
                await scanLink(recommended.link.url);
            }
            catch {
                recommendedLinkFailed = true;
                scanState = "error";
                setStatus("リンク先は読み取れませんでした。元のページの画像を表示しています。", "error");
            }
        }
        const grouped = groupImages(images.map(item => item.url));
        const initiallySelected = defaultSelectedImageGroups(grouped);
        for (const [key, group] of Object.entries(grouped)) {
            for (const item of images)
                if (group.items.includes(item.url))
                    item.selected = initiallySelected[key] ?? true;
        }
        render();
        if (!recommendedLinkFailed) {
            scanState = images.length ? "results" : "empty";
            setStatus(images.length ? `${images.length}枚の画像が見つかりました。` : "画像が見つかりませんでした。", images.length ? "success" : "info");
        }
    }
    catch {
        scanState = "error";
        setStatus("このページを読み取れませんでした。Chromeで開けるWebページを指定してください。", "error");
    }
    finally {
        setBusy(false);
    }
}
function renderLinks() {
    linksElement.replaceChildren();
    const ranked = links.map(link => ({ link, score: galleryLinkScore(link, rootPageUrl) }))
        .filter(entry => entry.score > 0).slice(0, 12);
    linksElement.hidden = ranked.length === 0;
    if (!ranked.length)
        return;
    const label = document.createElement("p");
    label.textContent = "ほかのリンク先も調べる";
    linksElement.append(label);
    for (const { link } of ranked) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = link.label || link.url;
        button.title = link.url;
        button.disabled = busy;
        button.addEventListener("click", async () => {
            scanState = "scanning";
            setBusy(true);
            setStatus("リンク先を調べています…", "busy");
            try {
                await scanLink(link.url);
                scanState = images.length ? "results" : "empty";
                setStatus(`${images.length}枚の画像が見つかりました。`, "success");
            }
            catch {
                scanState = images.length ? "results" : "error";
                setStatus("リンク先を読み取れませんでした。", "error");
            }
            finally {
                setBusy(false);
            }
        });
        linksElement.append(button);
    }
}
function renderGroups(groups) {
    groupsElement.replaceChildren();
    groupsElement.hidden = Object.keys(groups).length === 0;
    if (groupsElement.hidden)
        return;
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.textContent = "すべて表示";
    allButton.disabled = busy;
    allButton.setAttribute("data-focus-kind", "group");
    allButton.setAttribute("data-focus-key", "all");
    allButton.setAttribute("aria-pressed", String(activeGroupKey === null));
    allButton.addEventListener("click", () => { requestFocus({ kind: "group", key: "all" }); activeGroupKey = null; render(); });
    groupsElement.append(allButton);
    for (const [key, group] of Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority)) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = group.label;
        button.title = "このまとまりだけを表示する";
        button.disabled = busy;
        button.setAttribute("data-focus-kind", "group");
        button.setAttribute("data-focus-key", key);
        button.setAttribute("aria-pressed", String(activeGroupKey === key));
        button.addEventListener("click", () => { requestFocus({ kind: "group", key }); activeGroupKey = key; render(); });
        groupsElement.append(button);
    }
}
function renderGroupSelections(groups) {
    groupSelectionsElement.replaceChildren();
    groupSelectionsElement.hidden = Object.keys(groups).length === 0;
    if (groupSelectionsElement.hidden)
        return;
    for (const [key, group] of Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority)) {
        const urls = new Set(group.items);
        const groupItems = images.filter(item => urls.has(item.url));
        const selectedCount = groupItems.filter(item => item.selected).length;
        const label = document.createElement("label");
        label.className = "group-selection";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = groupItems.length > 0 && selectedCount === groupItems.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < groupItems.length;
        checkbox.disabled = busy;
        checkbox.setAttribute("data-focus-kind", "pdf-group");
        checkbox.setAttribute("data-focus-key", key);
        checkbox.setAttribute("aria-label", `PDFに含める ${group.label}`);
        checkbox.addEventListener("change", () => {
            requestFocus({ kind: "pdf-group", key });
            for (const item of groupItems)
                item.selected = checkbox.checked;
            render();
        });
        const name = document.createElement("span");
        name.textContent = group.label;
        label.append(checkbox, name);
        groupSelectionsElement.append(label);
    }
}
function imageFilename(url) {
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
    }
    catch {
        return url;
    }
}
function renderImages(visibleImages) {
    imagesElement.replaceChildren();
    visibleImages.forEach((item, index) => {
        const overallIndex = images.indexOf(item);
        const row = document.createElement("li");
        if (!item.selected)
            row.classList.add("unselected");
        const preview = document.createElement("img");
        preview.className = "preview";
        preview.src = item.url;
        preview.alt = `画像 ${index + 1}`;
        preview.loading = "lazy";
        preview.referrerPolicy = "no-referrer";
        const body = document.createElement("div");
        body.className = "item-body";
        const order = document.createElement("span");
        order.className = "item-order";
        order.textContent = `${overallIndex + 1}`;
        order.setAttribute("aria-label", `全体の${overallIndex + 1}番目`);
        const name = document.createElement("span");
        name.className = "item-title";
        name.textContent = imageFilename(item.url);
        name.title = item.url;
        const actions = document.createElement("div");
        actions.className = "item-actions";
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.selected;
        checkbox.disabled = busy;
        checkbox.setAttribute("data-focus-kind", "image");
        checkbox.setAttribute("data-focus-url", item.url);
        checkbox.setAttribute("data-focus-action", "checkbox");
        checkbox.setAttribute("aria-label", `PDFに含める ${name.textContent}`);
        checkbox.addEventListener("change", () => { requestFocus({ kind: "image", url: item.url, action: "checkbox" }); item.selected = checkbox.checked; render(); });
        const pdfMark = document.createElement("span");
        pdfMark.className = "pdf-mark";
        pdfMark.setAttribute("aria-hidden", "true");
        pdfMark.textContent = "PDF";
        label.append(checkbox, pdfMark);
        actions.append(label);
        for (const [text, delta] of [["↑", -1], ["↓", 1]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = text;
            button.title = delta < 0 ? "上へ移動" : "下へ移動";
            const action = delta < 0 ? "move-up" : "move-down";
            button.setAttribute("data-focus-kind", "image");
            button.setAttribute("data-focus-url", item.url);
            button.setAttribute("data-focus-action", action);
            button.setAttribute("aria-label", `${name.textContent}を${delta < 0 ? "上" : "下"}へ移動`);
            button.disabled = busy || index + delta < 0 || index + delta >= visibleImages.length;
            button.addEventListener("click", () => {
                const other = visibleImages[index + delta];
                if (!other)
                    return;
                requestFocus({ kind: "image", url: item.url, action });
                const itemIndex = images.indexOf(item);
                const otherIndex = images.indexOf(other);
                images[itemIndex] = other;
                images[otherIndex] = item;
                render();
            });
            actions.append(button);
        }
        body.append(order, name, actions);
        row.append(preview, body);
        imagesElement.append(row);
    });
}
function render() {
    const groups = groupImages(images.map(item => item.url));
    if (activeGroupKey !== null && !groups[activeGroupKey])
        activeGroupKey = null;
    const visibleImages = filterImagesByGroup(images, activeGroupKey === null ? null : groups[activeGroupKey]);
    const selectedCount = images.filter(item => item.selected).length;
    countElement.textContent = `${selectedCount} / ${images.length}枚を選択${activeGroupKey === null ? "" : `・${visibleImages.length}枚を表示`}`;
    exportButton.textContent = selectedCount ? `PDFを保存（${selectedCount}枚）` : "PDFを保存";
    emptyElement.hidden = images.length > 0;
    emptyElement.textContent = scanState === "scanning"
        ? "画像を調べています…"
        : scanState === "empty"
            ? "画像が見つかりませんでした。"
            : scanState === "error"
                ? "解析できませんでした。ページURLを確認して、もう一度お試しください。"
                : "ここに画像が並びます。\n「解析」を押して、画像を集めましょう。";
    selectAllButton.disabled = busy || images.length === 0;
    clearAllButton.disabled = busy || images.length === 0;
    exportButton.disabled = busy || !images.some(item => item.selected);
    renderGroups(groups);
    renderGroupSelections(groups);
    renderLinks();
    renderImages(visibleImages);
    restoreFocus();
}
async function toPdfPage(imageUrl, highQuality) {
    const response = await fetch(imageUrl, { credentials: "include" });
    if (!response.ok)
        throw new Error(`画像の取得に失敗しました (${response.status})`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/"))
        throw new Error("画像以外のデータです。");
    const bitmap = await createImageBitmap(blob);
    try {
        if (bitmap.width < 1 || bitmap.height < 1)
            throw new Error("画像の大きさが不正です。");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context)
            throw new Error("画像を変換できませんでした。");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);
        const jpeg = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("画像を変換できませんでした。")), "image/jpeg", highQuality ? 0.95 : 0.72));
        return { jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: bitmap.width, height: bitmap.height };
    }
    finally {
        bitmap.close();
    }
}
async function exportPdf() {
    const selected = images.filter(item => item.selected);
    if (!selected.length)
        return;
    setBusy(true);
    const prepared = Array(selected.length).fill(null);
    let failed = 0;
    setStatus(`画像を準備しています… 0 / ${selected.length}`, "busy");
    try {
        let next = 0;
        let completed = 0;
        await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
            while (next < selected.length) {
                const index = next++;
                try {
                    prepared[index] = await toPdfPage(selected[index].url, qualityInput.checked);
                }
                catch {
                    failed += 1;
                }
                completed += 1;
                setStatus(`画像を準備しています… ${completed} / ${selected.length}`, "busy");
            }
        }));
        const pages = prepared.filter((page) => page !== null);
        if (!pages.length)
            throw new Error("画像を取得できませんでした。画像のあるページを開いて再度お試しください。");
        setStatus("PDFを作成しています…", "busy");
        const blob = createPdf(pages);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${pageTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "画像"}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        setStatus(failed ? `${pages.length}枚を保存しました。${failed}枚は取得できず、PDFに含まれていません。` : `${pages.length}枚のPDFを保存しました。`, "success");
        completionElement.hidden = false;
    }
    catch (error) {
        setStatus(error instanceof Error ? error.message : "PDFを作成できませんでした。", "error");
    }
    finally {
        setBusy(false);
    }
}
scanButton.addEventListener("click", () => { void startScan(); });
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter")
    void startScan(); });
document.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("text/uri-list") || event.dataTransfer?.types.includes("text/plain"))
    event.preventDefault(); });
document.addEventListener("drop", event => {
    if (busy)
        return;
    const dropped = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain") || "";
    const url = dropped.split(/\r?\n/).find(line => line && !line.startsWith("#"))?.trim();
    if (!url || !isWebUrl(url))
        return;
    event.preventDefault();
    sourceUrl.value = url;
    void startScan();
});
exportButton.addEventListener("click", () => { void exportPdf(); });
selectAllButton.addEventListener("click", () => { for (const item of images)
    item.selected = true; render(); });
clearAllButton.addEventListener("click", () => { for (const item of images)
    item.selected = false; render(); });
resetButton.addEventListener("click", () => {
    images = [];
    links = [];
    activeGroupKey = null;
    scanState = "initial";
    pageTitle = "画像";
    rootPageUrl = "";
    completionElement.hidden = true;
    setStatus("収集結果を消しました。", "info");
    render();
});
backToImagesButton.addEventListener("click", () => { completionElement.hidden = true; imagesElement.scrollIntoView({ block: "start" }); });
render();
