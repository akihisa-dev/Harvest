import { defaultSelectedImageGroups, galleryLinkScore, groupImages, normalizeImageUrls, sortImageUrlsForSite, type ImageItem } from "../core/images.js";
import { createPdf, type PdfImagePage } from "../core/pdf.js";

interface PageScan {
  url: string;
  title: string;
  images: string[];
  links: Array<{url: string; label: string}>;
}

const source = required<HTMLSelectElement>("#source-tab");
const loadTabsButton = required<HTMLButtonElement>("#load-tabs");
const sourceUrl = required<HTMLInputElement>("#source-url");
const scanButton = required<HTMLButtonElement>("#scan");
const exportButton = required<HTMLButtonElement>("#export");
const selectAllButton = required<HTMLButtonElement>("#select-all");
const clearAllButton = required<HTMLButtonElement>("#clear-all");
const resetButton = required<HTMLButtonElement>("#reset");
const completionElement = required<HTMLDivElement>("#completion");
const backToImagesButton = required<HTMLButtonElement>("#back-to-images");
const qualityInput = required<HTMLInputElement>("#high-quality");
const imagesElement = required<HTMLOListElement>("#images");
const groupsElement = required<HTMLDivElement>("#groups");
const linksElement = required<HTMLDivElement>("#links");
const countElement = required<HTMLSpanElement>("#count");
const emptyElement = required<HTMLParagraphElement>("#empty");
const statusElement = required<HTMLParagraphElement>("#status");

let images: ImageItem[] = [];
let links: PageScan["links"] = [];
let pageTitle = "画像";
let rootPageUrl = "";
let busy = false;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function isWebUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}

function scanDocument(): PageScan {
  const candidates: string[] = [];
  const pageLinks: PageScan["links"] = [];
  const add = (value: string | null | undefined): void => {
    if (value && !value.startsWith("data:") && !value.startsWith("blob:")) candidates.push(value);
  };
  const lastSrcset = (value: string | null): string | undefined =>
    value?.split(",").map(part => part.trim().split(/\s+/)[0]).filter(Boolean).at(-1);

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
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.href;
    if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(href)) add(href);
    if (pageLinks.length < 300 && /^https?:\/\//i.test(href)) {
      pageLinks.push({url: href, label: (anchor.textContent || anchor.getAttribute("aria-label") || href).trim().slice(0, 100)});
    }
  }
  let inspectedBackgrounds = 0;
  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    if (++inspectedBackgrounds > 5000) break;
    const background = getComputedStyle(element).backgroundImage;
    for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g)) add(match[1]);
  }
  return {url: location.href, title: document.title, images: candidates, links: pageLinks};
}

function setStatus(message: string): void { statusElement.textContent = message; }

function addScan(result: PageScan): void {
  const existing = new Set(images.map(item => item.url));
  for (const url of sortImageUrlsForSite(normalizeImageUrls(result.images, result.url), result.url)) {
    if (existing.has(url)) continue;
    images.push({url, sourcePage: result.url, selected: true});
    existing.add(url);
  }
  const seen = new Set(links.map(link => link.url));
  for (const link of result.links) {
    if (galleryLinkScore(link, result.url) < 0 || seen.has(link.url)) continue;
    links.push(link);
    seen.add(link.url);
  }
  render();
}

async function scanTab(tabId: number): Promise<PageScan> {
  const [injection] = await chrome.scripting.executeScript({target: {tabId}, func: scanDocument});
  if (!injection?.result) throw new Error("ページを読み取れませんでした。");
  return injection.result;
}

async function scanUrl(url: string): Promise<PageScan> {
  const tab = await chrome.tabs.create({url, active: false});
  if (tab.id === undefined) throw new Error("リンク先を開けませんでした。");
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("リンク先の読み込みが時間切れになりました。"));
      }, 20000);
      const listener = (tabId: number, change: {status?: string}): void => {
        if (tabId !== tab.id || change.status !== "complete") return;
        window.clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
      void chrome.tabs.get(tab.id!).then(current => {
        if (current.status === "complete") listener(tab.id!, {status: "complete"});
      }).catch(() => undefined);
    });
    return await scanTab(tab.id);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function scanLink(url: string): Promise<void> {
  addScan(await scanUrl(url));
}

function setBusy(value: boolean): void {
  busy = value;
  scanButton.disabled = value || (!source.value && !sourceUrl.value.trim());
  source.disabled = value || source.options.length === 0;
  loadTabsButton.disabled = value;
  sourceUrl.disabled = value;
  qualityInput.disabled = value;
  resetButton.disabled = value;
  exportButton.disabled = value || !images.some(item => item.selected);
  render();
}

async function startScan(): Promise<void> {
  if (busy) return;
  const enteredUrl = sourceUrl.value.trim();
  let targetUrl = "";
  if (enteredUrl) {
    try {
      const parsed = new URL(enteredUrl);
      if (!isWebUrl(parsed.href)) throw new Error();
      targetUrl = parsed.href;
    } catch {
      setStatus("HTTPまたはHTTPSのページURLを入力してください。");
      return;
    }
  }
  const tabId = Number(source.value);
  if (!targetUrl && (!source.value || !Number.isInteger(tabId))) return;
  images = [];
  links = [];
  completionElement.hidden = true;
  setBusy(true);
  setStatus("ページを調べています…");
  try {
    const result = targetUrl ? await scanUrl(targetUrl) : await scanTab(tabId);
    pageTitle = result.title || "画像";
    rootPageUrl = result.url;
    addScan(result);
    const recommended = result.links
      .map(link => ({link, score: galleryLinkScore(link, result.url)}))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (recommended) {
      setStatus("画像一覧につながるリンク先を調べています…");
      try { await scanLink(recommended.link.url); }
      catch { setStatus("リンク先は読み取れませんでした。元のページの画像を表示しています。"); }
    }
    const grouped = groupImages(images.map(item => item.url));
    const initiallySelected = defaultSelectedImageGroups(grouped);
    for (const [key, group] of Object.entries(grouped)) {
      for (const item of images) if (group.items.includes(item.url)) item.selected = initiallySelected[key] ?? true;
    }
    render();
    if (!statusElement.textContent?.includes("読み取れませんでした")) {
      setStatus(images.length ? `${images.length}枚の画像が見つかりました。` : "画像が見つかりませんでした。");
    }
  } catch {
    setStatus("このページを読み取れませんでした。Chromeで開けるWebページを指定してください。");
  } finally {
    setBusy(false);
  }
}

function renderLinks(): void {
  linksElement.replaceChildren();
  const ranked = links.map(link => ({link, score: galleryLinkScore(link, rootPageUrl)}))
    .filter(entry => entry.score > 0).slice(0, 12);
  linksElement.hidden = ranked.length === 0;
  if (!ranked.length) return;
  const label = document.createElement("p");
  label.textContent = "ほかのリンク先も調べる";
  linksElement.append(label);
  for (const {link} of ranked) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = link.label || link.url;
    button.title = link.url;
    button.disabled = busy;
    button.addEventListener("click", async () => {
      setBusy(true);
      setStatus("リンク先を調べています…");
      try { await scanLink(link.url); setStatus(`${images.length}枚の画像が見つかりました。`); }
      catch { setStatus("リンク先を読み取れませんでした。"); }
      finally { setBusy(false); }
    });
    linksElement.append(button);
  }
}

function renderGroups(): void {
  groupsElement.replaceChildren();
  const groups = groupImages(images.map(item => item.url));
  groupsElement.hidden = Object.keys(groups).length === 0;
  for (const group of Object.values(groups).sort((a, b) => a.priority - b.priority)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = group.label;
    button.title = "このまとまりの選択を切り替える";
    button.disabled = busy;
    button.addEventListener("click", () => {
      const members = images.filter(item => group.items.includes(item.url));
      const select = !members.every(item => item.selected);
      for (const item of members) item.selected = select;
      render();
    });
    if (images.some(item => group.items.includes(item.url) && item.selected)) button.classList.add("active");
    groupsElement.append(button);
  }
}

function imageFilename(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || url); }
  catch { return url; }
}

function renderImages(): void {
  imagesElement.replaceChildren();
  images.forEach((item, index) => {
    const row = document.createElement("li");
    if (!item.selected) row.classList.add("unselected");
    const preview = document.createElement("img");
    preview.className = "preview";
    preview.src = item.url;
    preview.alt = `画像 ${index + 1}`;
    preview.loading = "lazy";
    preview.referrerPolicy = "no-referrer";
    const body = document.createElement("div");
    body.className = "item-body";
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
    checkbox.addEventListener("change", () => { item.selected = checkbox.checked; render(); });
    label.append(checkbox, document.createTextNode("選択"));
    actions.append(label);
    for (const [text, delta] of [["↑", -1], ["↓", 1]] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.title = delta < 0 ? "上へ移動" : "下へ移動";
      button.disabled = busy || index + delta < 0 || index + delta >= images.length;
      button.addEventListener("click", () => {
        const other = images[index + delta];
        if (!other) return;
        images[index + delta] = item;
        images[index] = other;
        render();
      });
      actions.append(button);
    }
    body.append(name, actions);
    row.append(preview, body);
    imagesElement.append(row);
  });
}

function render(): void {
  countElement.textContent = `${images.filter(item => item.selected).length} / ${images.length}枚を選択`;
  emptyElement.hidden = images.length > 0;
  selectAllButton.disabled = busy || images.length === 0;
  clearAllButton.disabled = busy || images.length === 0;
  exportButton.disabled = busy || !images.some(item => item.selected);
  renderGroups();
  renderLinks();
  renderImages();
}

async function toPdfPage(imageUrl: string, highQuality: boolean): Promise<PdfImagePage> {
  const response = await fetch(imageUrl, {credentials: "include"});
  if (!response.ok) throw new Error(`画像の取得に失敗しました (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("画像以外のデータです。");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("画像の大きさが不正です。");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を変換できませんでした。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("画像を変換できませんでした。")), "image/jpeg", highQuality ? 0.95 : 0.72));
    return {jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: bitmap.width, height: bitmap.height};
  } finally {
    bitmap.close();
  }
}

async function exportPdf(): Promise<void> {
  const selected = images.filter(item => item.selected);
  if (!selected.length) return;
  setBusy(true);
  const prepared: Array<PdfImagePage | null> = Array(selected.length).fill(null);
  let failed = 0;
  try {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({length: Math.min(3, selected.length)}, async () => {
      while (next < selected.length) {
        const index = next++;
        try { prepared[index] = await toPdfPage(selected[index]!.url, qualityInput.checked); }
        catch { failed += 1; }
        completed += 1;
        setStatus(`画像を準備しています… ${completed} / ${selected.length}`);
      }
    }));
    const pages = prepared.filter((page): page is PdfImagePage => page !== null);
    if (!pages.length) throw new Error("画像を取得できませんでした。画像のあるページを開いて再度お試しください。");
    setStatus("PDFを作成しています…");
    const blob = createPdf(pages);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${pageTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "画像"}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(failed ? `${pages.length}枚を保存しました。${failed}枚は取得できず、PDFに含まれていません。` : `${pages.length}枚のPDFを保存しました。`);
    completionElement.hidden = false;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "PDFを作成できませんでした。");
  } finally {
    setBusy(false);
  }
}

scanButton.addEventListener("click", () => { void startScan(); });
sourceUrl.addEventListener("input", () => { scanButton.disabled = busy || (!source.value && !sourceUrl.value.trim()); });
sourceUrl.addEventListener("keydown", event => { if (event.key === "Enter") void startScan(); });
document.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("text/uri-list") || event.dataTransfer?.types.includes("text/plain")) event.preventDefault(); });
document.addEventListener("drop", event => {
  if (busy) return;
  const dropped = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain") || "";
  const url = dropped.split(/\r?\n/).find(line => line && !line.startsWith("#"))?.trim();
  if (!url || !isWebUrl(url)) return;
  event.preventDefault();
  sourceUrl.value = url;
  void startScan();
});
exportButton.addEventListener("click", () => { void exportPdf(); });
selectAllButton.addEventListener("click", () => { for (const item of images) item.selected = true; render(); });
clearAllButton.addEventListener("click", () => { for (const item of images) item.selected = false; render(); });
resetButton.addEventListener("click", () => {
  images = [];
  links = [];
  pageTitle = "画像";
  rootPageUrl = "";
  completionElement.hidden = true;
  setStatus("収集結果を消しました。");
  render();
});
backToImagesButton.addEventListener("click", () => { completionElement.hidden = true; imagesElement.scrollIntoView({block: "start"}); });

loadTabsButton.addEventListener("click", async () => {
  loadTabsButton.disabled = true;
  try {
    const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
    const tabs = (await chrome.tabs.query({})).filter(tab => tab.id !== undefined && isWebUrl(tab.url));
    source.replaceChildren();
    for (const tab of tabs) {
      const option = document.createElement("option");
      option.value = String(tab.id);
      option.textContent = `${tab.title || tab.url} — ${new URL(tab.url!).hostname}`;
      if (tab.id === activeTab?.id) option.selected = true;
      source.append(option);
    }
    source.disabled = tabs.length === 0;
    loadTabsButton.textContent = "タブ一覧を更新";
    scanButton.disabled = !source.value && !sourceUrl.value.trim();
    if (!tabs.length) setStatus("収集できるWebページのタブがありません。URLを入力してください。");
  } catch {
    setStatus("開いているページを取得できませんでした。");
  } finally {
    loadTabsButton.disabled = false;
  }
});
