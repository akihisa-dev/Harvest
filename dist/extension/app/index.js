import { defaultSelectedImageGroups, filterImagesByGroup, groupImages, normalizeImageUrls, sortImageUrlsForSite } from "../core/images.js";
import { toPdfPage } from "./pdf-image.js";
import { createPdf } from "../core/pdf.js";
import { animateLayoutChange, prefersReducedMotion, reconcileKeyedChildren, setMotionText } from "./motion.js";
const sourceUrl = required("#source-url");
const sourceDrop = required("#source-drop");
const scanButton = required("#scan");
const exportButton = required("#export");
const viewerToggleButton = required("#viewer-toggle");
const viewerElement = required("#viewer");
const resultsElement = required(".results");
const viewerEmptyElement = required("#viewer-empty");
const viewerPageElement = required("#viewer-page");
const viewerPreviousButton = required("#viewer-previous");
const viewerNextButton = required("#viewer-next");
const viewerPositionElement = required("#viewer-position");
const viewerStageElement = required("#viewer-stage");
const viewerImageElement = required("#viewer-image");
const viewerFilenameElement = required("#viewer-filename");
const viewerThumbnailsElement = required("#viewer-thumbnails");
const viewerZoomInButton = required("#viewer-zoom-in");
const viewerZoomOutButton = required("#viewer-zoom-out");
const viewerZoomResetButton = required("#viewer-zoom-reset");
const selectAllButton = required("#select-all");
const clearAllButton = required("#clear-all");
const resetButton = required("#reset");
const completionElement = required("#completion");
const failuresElement = required("#failures");
const failedImagesElement = required("#failed-images");
const backToImagesButton = required("#back-to-images");
const imagesElement = required("#images");
const groupsElement = required("#groups");
const groupSelectionsElement = required("#group-selections");
const countElement = required("#count");
const emptyElement = required("#empty");
const statusElement = required("#status");
let images = [];
let pageTitle = "画像";
let activeGroupKey = null;
let viewerMode = false;
let viewerImageUrl = null;
let renderedViewerImageUrl = null;
let viewerZoom = 1;
let viewerPanX = 0;
let viewerPanY = 0;
let viewerPointer = null;
const viewerThumbRows = new Map();
let busy = false;
let pendingExport = null;
let scanState = "initial";
let focusTarget = null;
let draggedImage = null;
let suppressThumbnailClick = false;
const imageRowParts = new WeakMap();
let imageView = {
    visibleImages: [], previewOrder: [], rows: new Map(),
};
function required(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing element: ${selector}`);
    return element;
}
function isWebUrl(url) {
    return url !== undefined && /^https?:\/\//i.test(url);
}
function updateSourceDrop() {
    const url = sourceUrl.value.trim();
    sourceDrop.textContent = url || "ページURLをドロップ、またはクリックして入力";
    sourceDrop.dataset["hasUrl"] = String(Boolean(url));
}
function showSourceInput() {
    if (busy)
        return;
    sourceDrop.hidden = true;
    sourceUrl.hidden = false;
    sourceUrl.focus();
    sourceUrl.select();
}
function hideSourceInput() {
    sourceUrl.hidden = true;
    sourceDrop.hidden = false;
    updateSourceDrop();
}
function scanDocument() {
    const candidates = [];
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
    }
    let inspectedBackgrounds = 0;
    for (const element of document.querySelectorAll("*")) {
        if (++inspectedBackgrounds > 5000)
            break;
        const background = getComputedStyle(element).backgroundImage;
        for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g))
            add(match[1]);
    }
    return { url: location.href, title: document.title, images: candidates };
}
function setStatus(message, state = "info") {
    setMotionText(statusElement, message);
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
        element.focus();
        return;
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
        throw new Error("指定したページを開けませんでした。");
    try {
        await new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                reject(new Error("指定したページの読み込みが時間切れになりました。"));
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
function setBusy(value) {
    busy = value;
    scanButton.disabled = value;
    sourceDrop.disabled = value;
    sourceUrl.disabled = value;
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
            showSourceInput();
            return;
        }
    }
    hideSourceInput();
    images = [];
    pendingExport = null;
    activeGroupKey = null;
    viewerMode = false;
    viewerImageUrl = null;
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
        addScan(result);
        const grouped = groupImages(images.map(item => item.url));
        const initiallySelected = defaultSelectedImageGroups(grouped);
        for (const [key, group] of Object.entries(grouped)) {
            for (const item of images)
                if (group.items.includes(item.url))
                    item.selected = initiallySelected[key] ?? true;
        }
        render();
        scanState = images.length ? "results" : "empty";
        setStatus(images.length ? "" : "画像が見つかりませんでした。", "info");
    }
    catch {
        scanState = "error";
        setStatus("このページを読み取れませんでした。Chromeで開けるWebページを指定してください。", "error");
    }
    finally {
        setBusy(false);
    }
}
function renderGroups(groups) {
    groupsElement.hidden = Object.keys(groups).length === 0;
    const entries = groupsElement.hidden ? [] : Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority);
    reconcileKeyedChildren(groupsElement, groupsElement.hidden ? [] : ["all", ...entries.map(([key]) => key)], key => key, key => {
        const button = document.createElement("button");
        button.type = "button";
        button.addEventListener("click", () => {
            requestFocus({ kind: "group", key });
            activeGroupKey = key === "all" ? null : key;
            render();
        });
        return button;
    }, (button, key) => {
        const group = key === "all" ? undefined : groups[key];
        button.textContent = group?.label ?? "すべて表示";
        button.title = key === "all" ? "すべての画像を表示する" : "このまとまりだけを表示する";
        button.disabled = busy;
        button.setAttribute("data-focus-kind", "group");
        button.setAttribute("data-focus-key", key);
        button.setAttribute("aria-pressed", String(key === "all" ? activeGroupKey === null : activeGroupKey === key));
    });
}
function renderGroupSelections(groups) {
    groupSelectionsElement.hidden = Object.keys(groups).length === 0;
    const entries = groupSelectionsElement.hidden ? [] : Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority);
    reconcileKeyedChildren(groupSelectionsElement, entries.map(([key]) => key), key => key, key => {
        const label = document.createElement("label");
        label.className = "group-selection";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.addEventListener("change", () => {
            const currentGroups = groupImages(images.map(item => item.url));
            const currentGroup = currentGroups[key];
            if (!currentGroup)
                return;
            requestFocus({ kind: "pdf-group", key });
            const urls = new Set(currentGroup.items);
            for (const item of images)
                if (urls.has(item.url))
                    item.selected = checkbox.checked;
            render();
        });
        const name = document.createElement("span");
        label.append(checkbox, name);
        return label;
    }, (label, key) => {
        const group = groups[key];
        if (!group)
            return;
        const checkbox = label.children[0];
        const name = label.children[1];
        if (!checkbox || !name)
            return;
        const urls = new Set(group.items);
        const groupItems = images.filter(item => urls.has(item.url));
        const selectedCount = groupItems.filter(item => item.selected).length;
        checkbox.checked = groupItems.length > 0 && selectedCount === groupItems.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < groupItems.length;
        checkbox.disabled = busy;
        checkbox.setAttribute("data-focus-kind", "pdf-group");
        checkbox.setAttribute("data-focus-key", key);
        checkbox.setAttribute("aria-label", `PDFに含める ${group.label}`);
        name.textContent = group.label;
    });
}
function imageFilename(url) {
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
    }
    catch {
        return url;
    }
}
function moveImage(visibleImages, source, target) {
    if (busy || source === target)
        return;
    const reordered = [...visibleImages];
    const from = reordered.indexOf(source);
    const to = reordered.indexOf(target);
    if (from < 0 || to < 0)
        return;
    reordered.splice(from, 1);
    reordered.splice(to, 0, source);
    const visibleSet = new Set(visibleImages);
    let index = 0;
    images = images.map(item => visibleSet.has(item) ? reordered[index++] : item);
    requestFocus({ kind: "image", url: source.url, action: "drag" });
    render();
}
function showInsertion(order) {
    const { rows } = imageView;
    imageView.previewOrder = order;
    animateLayoutChange([...rows.values()], () => {
        order.forEach((item, index) => { rows.get(item.url).style.order = String(index); });
    }, draggedImage ? rows.get(draggedImage.url) : undefined);
}
function previewInsertion(target, event) {
    const { rows } = imageView;
    if (busy || !draggedImage || draggedImage === target)
        return;
    event.preventDefault();
    if (event.dataTransfer)
        event.dataTransfer.dropEffect = "move";
    const row = rows.get(target.url);
    if (!row)
        return;
    const rect = row.getBoundingClientRect();
    const isSingleColumn = [...rows.values()].every(value => Math.abs(value.getBoundingClientRect().left - rect.left) < 1);
    const after = isSingleColumn ? event.clientY >= rect.top + rect.height / 2 : event.clientX >= rect.left + rect.width / 2;
    const order = imageView.previewOrder.filter(item => item !== draggedImage);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, draggedImage);
    if (order.some((item, index) => item !== imageView.previewOrder[index]))
        showInsertion(order);
}
function finishDrop(event) {
    if (!draggedImage || busy)
        return;
    event.preventDefault();
    const source = draggedImage;
    const visibleSet = new Set(imageView.visibleImages);
    let index = 0;
    images = images.map(item => visibleSet.has(item) ? imageView.previewOrder[index++] : item);
    draggedImage = null;
    requestFocus({ kind: "image", url: source.url, action: "drag" });
    render();
}
function createImageRow(item) {
    const row = document.createElement("li");
    const preview = document.createElement("img");
    preview.className = "preview";
    preview.loading = "lazy";
    preview.referrerPolicy = "no-referrer";
    preview.draggable = false;
    const body = document.createElement("div");
    body.className = "item-body";
    const order = document.createElement("span");
    order.className = "item-order";
    const name = document.createElement("span");
    name.className = "item-title";
    const selectedMark = document.createElement("span");
    selectedMark.className = "item-selected";
    selectedMark.textContent = "✓";
    selectedMark.setAttribute("aria-hidden", "true");
    const failedMark = document.createElement("span");
    failedMark.className = "item-failed";
    failedMark.textContent = "取得失敗";
    body.append(order, name, selectedMark, failedMark);
    row.append(preview, body);
    imageRowParts.set(row, { preview, order, name, selectedMark, failedMark });
    row.addEventListener("pointerdown", () => { suppressThumbnailClick = false; });
    row.addEventListener("click", () => {
        if (suppressThumbnailClick || draggedImage || busy)
            return;
        item.selected = !item.selected;
        requestFocus({ kind: "image", url: item.url, action: "drag" });
        render();
    });
    row.addEventListener("dragstart", event => {
        if (busy) {
            event.preventDefault();
            return;
        }
        suppressThumbnailClick = true;
        draggedImage = item;
        if (event.dataTransfer) {
            event.dataTransfer.setDragImage(preview, preview.width / 2, preview.height / 2);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", "harvest-image");
        }
        row.classList.add("dragging");
    });
    row.addEventListener("dragover", event => previewInsertion(item, event));
    row.addEventListener("drop", finishDrop);
    row.addEventListener("dragend", () => {
        if (!draggedImage)
            return;
        draggedImage = null;
        row.classList.remove("dragging");
        showInsertion([...imageView.visibleImages]);
    });
    row.addEventListener("keydown", event => {
        if (event.target !== row)
            return;
        if (!event.altKey && ["Enter", " "].includes(event.key)) {
            event.preventDefault();
            if (!event.repeat && !draggedImage && !busy) {
                item.selected = !item.selected;
                requestFocus({ kind: "image", url: item.url, action: "drag" });
                render();
            }
            return;
        }
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
            return;
        event.preventDefault();
        const index = imageView.visibleImages.indexOf(item);
        const target = imageView.visibleImages[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (target)
            moveImage(imageView.visibleImages, item, target);
    });
    return row;
}
function renderImages(visibleImages) {
    imageView.visibleImages = visibleImages;
    imageView.previewOrder = [...visibleImages];
    imageView.rows = reconcileKeyedChildren(imagesElement, visibleImages, item => item.url, createImageRow, (row, item, index) => {
        const parts = imageRowParts.get(row);
        if (!parts)
            return;
        const overallIndex = images.indexOf(item);
        row.style.order = String(index);
        if (item.selected)
            row.classList.remove("unselected");
        else
            row.classList.add("unselected");
        const failed = pendingExport?.failed.has(item) ?? false;
        if (failed)
            row.classList.add("failed");
        else
            row.classList.remove("failed");
        if (draggedImage !== item)
            row.classList.remove("dragging");
        row.setAttribute("role", "button");
        row.setAttribute("aria-pressed", String(item.selected));
        row.setAttribute("aria-disabled", String(busy));
        row.draggable = !busy;
        row.tabIndex = 0;
        row.title = "クリックでPDF選択、ドラッグで並べ替え（キーボード: Enter / Spaceで選択、Alt + ↑ / ↓で移動）";
        row.setAttribute("data-focus-kind", "image");
        row.setAttribute("data-focus-url", item.url);
        row.setAttribute("data-focus-action", "drag");
        row.setAttribute("aria-label", `${imageFilename(item.url)}、${overallIndex + 1}番目。${failed ? "取得失敗。" : ""}クリックでPDF選択、ドラッグまたはAltと上下矢印で並べ替え`);
        parts.preview.src = item.url;
        parts.preview.alt = `画像 ${index + 1}`;
        parts.order.textContent = `${overallIndex + 1}`;
        parts.order.setAttribute("aria-label", `全体の${overallIndex + 1}番目`);
        parts.name.textContent = imageFilename(item.url);
        parts.name.title = item.url;
        parts.selectedMark.hidden = false;
        parts.failedMark.hidden = !failed;
    });
    imagesElement.ondragover = event => {
        if (!draggedImage || busy)
            return;
        event.preventDefault();
        let nearest = null;
        let distance = Infinity;
        for (const [url, row] of imageView.rows) {
            const rect = row.getBoundingClientRect();
            const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
            const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
            if (dx * dx + dy * dy < distance) {
                nearest = images.find(item => item.url === url) ?? null;
                distance = dx * dx + dy * dy;
            }
        }
        if (nearest)
            previewInsertion(nearest, event);
    };
    imagesElement.ondrop = finishDrop;
}
function updateViewerTransform() {
    viewerImageElement.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${viewerZoom})`;
    viewerZoomResetButton.textContent = `${Math.round(viewerZoom * 100)}%`;
    viewerZoomOutButton.disabled = viewerZoom <= 1;
    viewerZoomInButton.disabled = viewerZoom >= 8;
    viewerZoomResetButton.disabled = viewerZoom === 1;
    viewerStageElement.dataset["pannable"] = String(viewerZoom > 1);
}
function resetViewerTransform() {
    viewerZoom = 1;
    viewerPanX = 0;
    viewerPanY = 0;
    viewerPointer = null;
    delete viewerStageElement.dataset["panning"];
    updateViewerTransform();
}
function zoomViewer(factor, clientX, clientY) {
    if (!viewerMode || !viewerImageUrl)
        return;
    const nextZoom = Math.min(8, Math.max(1, viewerZoom * factor));
    if (nextZoom === viewerZoom)
        return;
    const rect = viewerStageElement.getBoundingClientRect();
    const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    const ratio = nextZoom / viewerZoom;
    viewerPanX = x - (x - viewerPanX) * ratio;
    viewerPanY = y - (y - viewerPanY) * ratio;
    viewerZoom = nextZoom;
    if (viewerZoom === 1) {
        viewerPanX = 0;
        viewerPanY = 0;
    }
    updateViewerTransform();
}
function renderViewerThumbnails(selected, currentUrl) {
    const selectedUrls = new Set(selected.map(item => item.url));
    for (const url of viewerThumbRows.keys())
        if (!selectedUrls.has(url))
            viewerThumbRows.delete(url);
    const rows = selected.map((item, index) => {
        let row = viewerThumbRows.get(item.url);
        if (!row) {
            row = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            const thumbnail = document.createElement("img");
            thumbnail.loading = "lazy";
            thumbnail.referrerPolicy = "no-referrer";
            thumbnail.draggable = false;
            thumbnail.src = item.url;
            const number = document.createElement("span");
            number.className = "viewer-thumb-number";
            button.append(thumbnail, number);
            button.addEventListener("click", () => { viewerImageUrl = item.url; renderViewer(); });
            row.append(button);
            viewerThumbRows.set(item.url, row);
        }
        const button = row.children[0];
        const number = button.children[1];
        button.setAttribute("aria-current", String(item.url === currentUrl));
        button.setAttribute("aria-label", `${index + 1}枚目: ${imageFilename(item.url)}を表示`);
        number.textContent = String(index + 1);
        return row;
    });
    viewerThumbnailsElement.replaceChildren(...rows);
    if (renderedViewerImageUrl !== currentUrl) {
        const active = viewerThumbRows.get(currentUrl)?.children[0];
        active?.scrollIntoView({ block: "nearest" });
    }
}
function renderViewer() {
    const selected = images.filter(item => item.selected);
    const index = selected.findIndex(item => item.url === viewerImageUrl);
    const currentIndex = index < 0 ? 0 : index;
    const current = selected[currentIndex];
    viewerImageUrl = current?.url ?? null;
    resultsElement.hidden = viewerMode;
    viewerElement.hidden = !viewerMode;
    viewerToggleButton.disabled = busy || images.length === 0;
    viewerToggleButton.setAttribute("aria-pressed", String(viewerMode));
    viewerToggleButton.textContent = viewerMode ? "画像一覧に戻る" : "ビュアーモード";
    viewerEmptyElement.hidden = !viewerMode || Boolean(current);
    viewerPageElement.hidden = !viewerMode || !current;
    if (!viewerMode || !current) {
        renderedViewerImageUrl = null;
        viewerThumbRows.clear();
        viewerThumbnailsElement.replaceChildren();
        resetViewerTransform();
        viewerImageElement.removeAttribute("src");
        viewerImageElement.alt = "";
        viewerPositionElement.textContent = "";
        viewerFilenameElement.textContent = "";
        return;
    }
    if (renderedViewerImageUrl !== current.url)
        resetViewerTransform();
    renderViewerThumbnails(selected, current.url);
    if (viewerImageElement.src !== current.url)
        viewerImageElement.src = current.url;
    renderedViewerImageUrl = current.url;
    viewerImageElement.alt = `選択した画像 ${currentIndex + 1}`;
    viewerPositionElement.textContent = `${currentIndex + 1} / ${selected.length}`;
    viewerFilenameElement.textContent = imageFilename(current.url);
    viewerPreviousButton.disabled = busy || currentIndex === 0;
    viewerNextButton.disabled = busy || currentIndex === selected.length - 1;
}
function render() {
    const selected = images.filter(item => item.selected);
    if (pendingExport && (selected.length !== pendingExport.selected.length ||
        selected.some((item, index) => item !== pendingExport.selected[index]))) {
        pendingExport = null;
        if (!busy)
            setStatus("選択や順序が変わりました。PDFを保存してください。", "info");
    }
    const groups = groupImages(images.map(item => item.url));
    if (activeGroupKey !== null && !groups[activeGroupKey])
        activeGroupKey = null;
    const visibleImages = filterImagesByGroup(images, activeGroupKey === null ? null : groups[activeGroupKey]);
    const selectedCount = selected.length;
    setMotionText(countElement, `${selectedCount} / ${images.length}枚を選択${activeGroupKey === null ? "" : `・${visibleImages.length}枚を表示`}`);
    exportButton.textContent = pendingExport?.failed.size
        ? `失敗した${pendingExport.failed.size}枚を再試行`
        : selectedCount ? `PDFを保存（${selectedCount}枚）` : "PDFを保存";
    failuresElement.hidden = !pendingExport?.failed.size;
    failedImagesElement.replaceChildren(...(pendingExport?.selected.filter(item => pendingExport.failed.has(item)) ?? []).map(item => {
        const row = document.createElement("li");
        row.textContent = `${images.indexOf(item) + 1}番 ${imageFilename(item.url)}`;
        row.title = item.url;
        return row;
    }));
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
    renderImages(visibleImages);
    renderViewer();
    restoreFocus();
}
async function exportPdf() {
    if (busy)
        return;
    const selected = images.filter(item => item.selected);
    if (!selected.length)
        return;
    const retry = Boolean(pendingExport?.failed.size);
    const work = pendingExport ?? { selected, prepared: new Map(), failed: new Set() };
    const remaining = work.selected.filter(item => !work.prepared.has(item));
    completionElement.hidden = true;
    setBusy(true);
    setStatus(`${retry ? "画像を再試行" : "画像を準備"}しています… 0 / ${remaining.length}`, "busy");
    try {
        work.failed.clear();
        for (const [index, image] of remaining.entries()) {
            try {
                work.prepared.set(image, await toPdfPage(image.url));
            }
            catch {
                work.failed.add(image);
            }
            setStatus(`${retry ? "画像を再試行" : "画像を準備"}しています… ${index + 1} / ${remaining.length}`, "busy");
        }
        if (work.failed.size) {
            pendingExport = work;
            viewerMode = false;
            setStatus(`${work.failed.size}枚を取得できませんでした。画像を確認して再試行してください。`, "error");
            return;
        }
        const pages = work.selected.map(item => work.prepared.get(item));
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
        pendingExport = null;
        setStatus(`${pages.length}枚のPDFを保存しました。`, "success");
        completionElement.hidden = false;
    }
    catch (error) {
        pendingExport = work.prepared.size || work.failed.size ? work : null;
        setStatus(error instanceof Error ? error.message : "PDFを作成できませんでした。", "error");
    }
    finally {
        setBusy(false);
        if (pendingExport === work && work.failed.size)
            failuresElement.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
    }
}
scanButton.addEventListener("click", () => { void startScan(); });
sourceDrop.addEventListener("click", showSourceInput);
sourceDrop.addEventListener("dragover", event => {
    if (busy || !event.dataTransfer ||
        !(event.dataTransfer.types.includes("text/uri-list") || event.dataTransfer.types.includes("text/plain")))
        return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    sourceDrop.classList.add("drag-over");
});
sourceDrop.addEventListener("dragleave", () => sourceDrop.classList.remove("drag-over"));
sourceDrop.addEventListener("drop", event => {
    sourceDrop.classList.remove("drag-over");
    event.preventDefault();
});
sourceUrl.addEventListener("input", updateSourceDrop);
sourceUrl.addEventListener("blur", hideSourceInput);
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
    hideSourceInput();
    void startScan();
});
exportButton.addEventListener("click", () => { void exportPdf(); });
viewerToggleButton.addEventListener("click", () => {
    if (busy || images.length === 0)
        return;
    viewerMode = !viewerMode;
    render();
});
viewerPreviousButton.addEventListener("click", () => {
    const selected = images.filter(item => item.selected);
    const index = selected.findIndex(item => item.url === viewerImageUrl);
    if (index > 0) {
        viewerImageUrl = selected[index - 1].url;
        renderViewer();
    }
});
viewerNextButton.addEventListener("click", () => {
    const selected = images.filter(item => item.selected);
    const index = selected.findIndex(item => item.url === viewerImageUrl);
    if (index >= 0 && index < selected.length - 1) {
        viewerImageUrl = selected[index + 1].url;
        renderViewer();
    }
});
viewerZoomInButton.addEventListener("click", () => zoomViewer(1.25));
viewerZoomOutButton.addEventListener("click", () => zoomViewer(1 / 1.25));
viewerZoomResetButton.addEventListener("click", resetViewerTransform);
viewerStageElement.addEventListener("wheel", event => {
    if (!viewerMode || !viewerImageUrl)
        return;
    event.preventDefault();
    zoomViewer(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
}, { passive: false });
viewerStageElement.addEventListener("pointerdown", event => {
    if (!viewerMode || viewerZoom <= 1 || (event.button !== undefined && event.button !== 0))
        return;
    event.preventDefault();
    viewerPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: viewerPanX, panY: viewerPanY };
    viewerStageElement.setPointerCapture(event.pointerId);
    viewerStageElement.dataset["panning"] = "true";
});
viewerStageElement.addEventListener("pointermove", event => {
    if (!viewerPointer || viewerPointer.id !== event.pointerId)
        return;
    viewerPanX = viewerPointer.panX + event.clientX - viewerPointer.x;
    viewerPanY = viewerPointer.panY + event.clientY - viewerPointer.y;
    updateViewerTransform();
});
const endViewerPan = (event) => {
    if (!viewerPointer || viewerPointer.id !== event.pointerId)
        return;
    viewerPointer = null;
    viewerStageElement.releasePointerCapture(event.pointerId);
    delete viewerStageElement.dataset["panning"];
};
viewerStageElement.addEventListener("pointerup", endViewerPan);
viewerStageElement.addEventListener("pointercancel", endViewerPan);
selectAllButton.addEventListener("click", () => { for (const item of images)
    item.selected = true; render(); });
clearAllButton.addEventListener("click", () => { for (const item of images)
    item.selected = false; render(); });
resetButton.addEventListener("click", () => {
    images = [];
    pendingExport = null;
    activeGroupKey = null;
    viewerMode = false;
    viewerImageUrl = null;
    scanState = "initial";
    pageTitle = "画像";
    completionElement.hidden = true;
    setStatus("", "info");
    render();
});
backToImagesButton.addEventListener("click", () => { completionElement.hidden = true; imagesElement.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" }); });
updateSourceDrop();
render();
