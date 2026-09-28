/**
 * UI text is kept here so that the panel has one translation boundary.
 * Values originating from a page (titles, URLs, and image filenames) must not
 * be passed through this module.
 */

const english = {
  documentTitle: "Harvest | Collect images",
  pageUrl: "Page URL",
  optional: "Optional",
  collectionStart: "Collect",
  collectionStop: "Stop",
  collectionTitle: "While collecting, click links on the page to analyze their destinations without navigating away",
  sourceDrop: "Drop a page URL or click to enter it",
  sourcePlaceholder: "Enter a page URL",
  scan: "Analyze",
  sourceHint: "If left blank, the open page will be analyzed.",
  savePdf: "Save PDF",
  includeSourcePage: "Add a source page at the end",
  sourceHeading: "Source",
  imagesHeading: "Image groups",
  countInitial: "0 images",
  selectionToolbar: "Select and reorder images",
  workspaceControls: "Image and save controls",
  selectAll: "Select all",
  selectAllShort: "Select all",
  selectAllTitle: "Select all images, including those not displayed",
  clearAll: "Clear selection",
  clearAllShort: "Clear all",
  clearAllTitle: "Clear the selection, including images not displayed",
  resetOrder: "Restore order and selection",
  resetOrderShort: "Reset order",
  resetOrderTitle: "Restore the order and PDF selection from immediately after analysis",
  display: "Display",
  displayImages: "Images to display",
  groupControls: "Display and PDF selection for image groups",
  pdf: "PDF",
  pdfImages: "Images to include in the PDF",
  viewerMode: "Viewer mode",
  clear: "Clear",
  clearTitle: "Clear the collected results and selection",
  completionStarted: "PDF saving started.",
  backToImages: "Back to image list",
  failuresHeading: "Images that could not be retrieved",
  viewer: "Viewer for selected images",
  viewerEmpty: "No images are selected for the PDF.",
  viewerStage: "Image. Use the wheel to zoom, then drag to pan while zoomed in",
  viewerControls: "Viewer controls and thumbnails of selected images",
  previous: "Previous",
  next: "Next",
  zoomGroup: "Zoom image",
  zoomOut: "Zoom out",
  zoomReset: "Reset zoom",
  zoomIn: "Zoom in",
  allImages: "Show all images",
  showAll: "Show all",
  allGroups: "All images",
  displayGroup: "Show {label}",
  hideGroup: "Hide {label}",
  oneGroup: "Show only this group",
  includeGroup: "Include in PDF: {label}",
  countSelected: "{selected} / {total} images selected",
  countSelectedVisible: "{selected} / {total} images selected · {visible} displayed",
  exportRetry: "Retry {count} failed image{plural}",
  exportCount: "Save PDF ({count} image{plural})",
  prepareImages: "Preparing images… {completed} / {total}",
  retryImages: "Retrying images… {completed} / {total}",
  failedSummary: "{count} image{plural} could not be retrieved. Check the images and retry.",
  pdfUnsaved: "Not saved",
  pdfSaveStarted: "PDF saving started",
  pdfSaveChanged: "Changed · save again",
  pdfSaveStartedHelp: "The PDF was handed to the browser for saving. Check downloads for completion or cancellation.",
  pdfCreating: "Creating PDF…",
  pdfSaved: "Saved a PDF with {count} image{plural}.",
  previousResults: " The previous collection is being kept.",
  scanBusy: "Analyzing the page…",
  scanEmpty: "No images were found.",
  scanErrorEmpty: "Could not analyze the page. Check the page URL and try again.",
  imageBusy: "Looking for images…",
  selectionChanged: "The selection or order changed. Save the PDF again.",
  imageFallback: "Images",
  groupUploaded: "Uploaded",
  groupSeries: "Series",
  groupSet: "Set",
  groupCover: "Cover / thumbnail",
  groupOther: "Other",
  groupGeneric: "Group",
  imageAlt: "Image {index}",
  selectedImageAlt: "Selected image {index}",
  imagePosition: "Overall image {index}",
  imageFailed: "Retrieval failed",
  imageRowTitle: "Click to select for the PDF, drag to reorder (keyboard: Enter / Space to select, Alt + ↑ / ↓ to move)",
  imageRowAria: "{filename}, number {index}.{failed} Click to select for the PDF, drag or use Alt and the arrow keys to reorder",
  thumbnailAria: "Show image {index}: {filename}",
  failedRow: "Image {index}: {filename} — {reason}",
  dropUrl: "Drop a URL to analyze",
  dropImage: "Move here",
  errorPageRead: "Could not read this page.",
  errorInvalidUrl: "Enter a page URL using HTTP or HTTPS.",
  errorNoActivePage: "The open page cannot be analyzed. Specify a URL.",
  errorCollectionPage: "Open a web page to collect links.",
  errorCollectionStart: "Could not start collection mode.",
  errorScanCancelled: "Page analysis was cancelled.",
  errorScanTimeout: "Reading the page took too long. Try again.",
  errorTabRead: "Could not read the page.",
  errorTabClosed: "The tab being analyzed was closed.",
  errorPageMoved: "The page changed during analysis. Analyze it again.",
  errorOpenPage: "Could not open the specified page.",
  errorPdfAccess: "Access to the image was denied.",
  errorPdfNotFound: "The image was not found.",
  errorPdfServer: "The image server did not respond.",
  errorPdfFetch: "Could not retrieve the image.",
  errorPdfCancelled: "Image retrieval was cancelled.",
  errorPdfNotImage: "The response was not image data.",
  errorPdfTimeout: "Image retrieval took too long and was cancelled.",
  errorPdfNetwork: "Could not retrieve the image. Check the connection and image URL.",
  errorPdfDecode: "Could not read the image. Its format may be unsupported or its data may be corrupt.",
  errorPdfDimensions: "The image dimensions are invalid.",
  errorPdfTooLarge: "The image is too large to convert to a PDF.",
  errorPdfConvert: "Could not convert the image for the PDF.",
  errorPdfCreate: "Could not create the PDF.",
  errorSavePreference: "Could not save the source page setting.",
} as const;

const japanese: {[K in keyof typeof english]: string} = {
  documentTitle: "Harvest | 画像を集める",
  pageUrl: "ページURL",
  optional: "任意",
  collectionStart: "収集",
  collectionStop: "停止",
  collectionTitle: "収集中はページ内のリンクをクリックすると、移動せずリンク先を解析します",
  sourceDrop: "ページURLをドロップ、またはクリックして入力",
  sourcePlaceholder: "ページURLを入力",
  scan: "解析",
  sourceHint: "空欄なら、開いているページを解析します。",
  savePdf: "PDFを保存",
  includeSourcePage: "末尾に出典ページを追加",
  sourceHeading: "Source",
  imagesHeading: "画像グループ",
  countInitial: "0枚",
  selectionToolbar: "画像の選択と並び順",
  workspaceControls: "画像と保存の操作",
  selectAll: "すべて選択",
  selectAllShort: "全選択",
  selectAllTitle: "表示していない画像も含めて、すべて選択",
  clearAll: "選択を解除",
  clearAllShort: "選択解除",
  clearAllTitle: "表示していない画像も含めて、選択を解除",
  resetOrder: "全部元に戻す",
  resetOrderShort: "順序を戻す",
  resetOrderTitle: "解析直後の並び順とPDFへの選択に戻す",
  display: "表示",
  displayImages: "表示する画像",
  groupControls: "画像の表示とPDFへの選択",
  pdf: "PDF",
  pdfImages: "PDFに含める画像",
  viewerMode: "ビュアーモード",
  clear: "クリア",
  clearTitle: "収集結果と選択をクリア",
  completionStarted: "PDFの保存を開始しました。",
  backToImages: "画像一覧に戻る",
  failuresHeading: "取得できなかった画像",
  viewer: "選択した画像のビュアー",
  viewerEmpty: "PDFに含める画像が選択されていません。",
  viewerStage: "画像。ホイールで拡大縮小、拡大中はドラッグで移動",
  viewerControls: "ビュアー操作と選択した画像のサムネイル",
  previous: "前へ",
  next: "次へ",
  zoomGroup: "画像の拡大と縮小",
  zoomOut: "縮小",
  zoomReset: "表示倍率を戻す",
  zoomIn: "拡大",
  allImages: "すべての画像を表示する",
  showAll: "すべて表示",
  allGroups: "すべての画像",
  displayGroup: "{label}を表示",
  hideGroup: "{label}を非表示",
  oneGroup: "このまとまりだけを表示する",
  includeGroup: "PDFに含める {label}",
  countSelected: "{selected} / {total}枚を選択",
  countSelectedVisible: "{selected} / {total}枚を選択・{visible}枚を表示",
  exportRetry: "失敗した{count}枚を再試行",
  exportCount: "PDFを保存（{count}枚）",
  prepareImages: "画像を準備しています… {completed} / {total}",
  retryImages: "画像を再試行しています… {completed} / {total}",
  failedSummary: "{count}枚を取得できませんでした。画像を確認して再試行してください。",
  pdfUnsaved: "未保存",
  pdfSaveStarted: "保存を開始しました",
  pdfSaveChanged: "変更あり・要保存",
  pdfSaveStartedHelp: "ブラウザーにPDFの保存を依頼しました。完了やキャンセルはダウンロード一覧で確認してください。",
  pdfCreating: "PDFを作成しています…",
  pdfSaved: "{count}枚のPDFを保存しました。",
  previousResults: " 前の収集結果を保持しています。",
  scanBusy: "ページを調べています…",
  scanEmpty: "画像が見つかりませんでした。",
  scanErrorEmpty: "解析できませんでした。ページURLを確認して、もう一度お試しください。",
  imageBusy: "画像を調べています…",
  selectionChanged: "選択や順序が変わりました。PDFを保存してください。",
  imageFallback: "画像",
  groupUploaded: "アップロード済み",
  groupSeries: "シリーズ",
  groupSet: "セット",
  groupCover: "表紙・サムネイル",
  groupOther: "その他",
  groupGeneric: "まとまり",
  imageAlt: "画像 {index}",
  selectedImageAlt: "選択した画像 {index}",
  imagePosition: "全体の{index}番目",
  imageFailed: "取得失敗",
  imageRowTitle: "クリックでPDF選択、ドラッグで並べ替え（キーボード: Enter / Spaceで選択、Alt + ↑ / ↓で移動）",
  imageRowAria: "{filename}、{index}番目。{failed}クリックでPDF選択、ドラッグまたはAltと上下矢印で並べ替え",
  thumbnailAria: "{index}枚目: {filename}を表示",
  failedRow: "{index}番 {filename} — {reason}",
  dropUrl: "URLをドロップして解析",
  dropImage: "ここに移動",
  errorPageRead: "このページを読み取れませんでした。",
  errorInvalidUrl: "HTTPまたはHTTPSのページURLを入力してください。",
  errorNoActivePage: "開いているWebページを解析できません。URLを指定してください。",
  errorCollectionPage: "収集するWebページを開いてください。",
  errorCollectionStart: "収集モードを開始できませんでした。",
  errorScanCancelled: "ページの解析を終了しました。",
  errorScanTimeout: "ページの読み取りが時間切れになりました。もう一度お試しください。",
  errorTabRead: "ページを読み取れませんでした。",
  errorTabClosed: "解析中のタブが閉じられました。",
  errorPageMoved: "解析中にページが移動しました。もう一度解析してください。",
  errorOpenPage: "指定したページを開けませんでした。",
  errorPdfAccess: "画像へのアクセスが拒否されました。",
  errorPdfNotFound: "画像が見つかりませんでした。",
  errorPdfServer: "画像サーバーが応答できませんでした。",
  errorPdfFetch: "画像を取得できませんでした。",
  errorPdfCancelled: "画像の取得を中止しました。",
  errorPdfNotImage: "画像データではありません。",
  errorPdfTimeout: "画像の取得に時間がかかりすぎたため中止しました。",
  errorPdfNetwork: "画像を取得できませんでした。通信状態と画像URLを確認してください。",
  errorPdfDecode: "画像を読み込めませんでした。形式が対応していないか、データが壊れています。",
  errorPdfDimensions: "画像の大きさが不正です。",
  errorPdfTooLarge: "画像が大きすぎてPDF用に変換できませんでした。",
  errorPdfConvert: "画像をPDF用に変換できませんでした。",
  errorPdfCreate: "PDFを作成できませんでした。",
  errorSavePreference: "出典ページの設定を保存できませんでした。",
};

export const translations = {en: english, ja: japanese} as const;
export type TranslationKey = keyof typeof english;
export type UiLanguage = keyof typeof translations;

function detectLanguage(): UiLanguage {
  const browserChrome = (globalThis as typeof globalThis & {
    chrome?: {i18n?: {getUILanguage?: () => string}}
  }).chrome;
  const uiLanguage = browserChrome?.i18n?.getUILanguage?.() ?? "ja";
  return uiLanguage.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export const uiLanguage: UiLanguage = detectLanguage();
export const translationKeys = Object.keys(english) as TranslationKey[];

export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  const template = translations[uiLanguage][key];
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

export function localizeDocument(root: Document = document): void {
  root.documentElement?.setAttribute("lang", uiLanguage);
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = t(element.dataset["i18n"] as TranslationKey);
  }
  const attributes = [
    ["data-i18n-title", "title"],
    ["data-i18n-placeholder", "placeholder"],
    ["data-i18n-aria-label", "aria-label"],
    ["data-i18n-alt", "alt"],
  ] as const;
  for (const [dataName, attribute] of attributes) {
    for (const element of root.querySelectorAll<HTMLElement>(`[${dataName}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(dataName) as TranslationKey));
    }
  }
  if (root.body) root.body.dataset["dropLabel"] = t("dropUrl");
}

const sourceMessages: Partial<Record<string, TranslationKey>> = {
  "収集するWebページを開いてください。": "errorCollectionPage",
  "収集モードを開始できませんでした。": "errorCollectionStart",
  "ページの解析を終了しました。": "errorScanCancelled",
  "ページの読み取りが時間切れになりました。もう一度お試しください。": "errorScanTimeout",
  "ページを読み取れませんでした。": "errorTabRead",
  "解析中のタブが閉じられました。": "errorTabClosed",
  "このページを読み取れませんでした。Chromeで開けるWebページを指定してください。": "errorPageRead",
  "解析中にページが移動しました。もう一度解析してください。": "errorPageMoved",
  "指定したページを開けませんでした。": "errorOpenPage",
  "画像へのアクセスが拒否されました。": "errorPdfAccess",
  "画像が見つかりませんでした。": "errorPdfNotFound",
  "画像サーバーが応答できませんでした。": "errorPdfServer",
  "画像を取得できませんでした。": "errorPdfFetch",
  "画像の取得を中止しました。": "errorPdfCancelled",
  "画像データではありません。": "errorPdfNotImage",
  "画像の取得に時間がかかりすぎたため中止しました。": "errorPdfTimeout",
  "画像を取得できませんでした。通信状態と画像URLを確認してください。": "errorPdfNetwork",
  "画像を読み込めませんでした。形式が対応していないか、データが壊れています。": "errorPdfDecode",
  "画像の大きさが不正です。": "errorPdfDimensions",
  "画像が大きすぎてPDF用に変換できませんでした。": "errorPdfTooLarge",
  "画像をPDF用に変換できませんでした。": "errorPdfConvert",
};

export function localizeErrorMessage(message: string, fallback: TranslationKey = "errorPageRead", forceFallback = false): string {
  const key = sourceMessages[message];
  if (key) return t(key);
  const translatedKey = translationKeys.find(candidate =>
    translations.en[candidate] === message || translations.ja[candidate] === message);
  if (translatedKey) return t(translatedKey);
  if (forceFallback || (uiLanguage === "en" && /[ぁ-んァ-ヶ一-龯]/u.test(message))) return t(fallback);
  return message;
}

export function formatCount(selected: number, total: number, visible?: number): string {
  return t(visible === undefined ? "countSelected" : "countSelectedVisible", {selected, total, visible: visible ?? 0});
}

export function formatGroupLabel(label: string): string {
  const match = /^(アップロード済み|シリーズ|セット|表紙・サムネイル|その他) \((\d+)枚\)$/.exec(label);
  const genericMatch = /^.+ \((\d+)枚\)$/.exec(label);
  if (!match) {
    if (uiLanguage === "en" && genericMatch) {
      const count = Number(genericMatch[1]);
      return `${t("groupGeneric")} (${count} image${count === 1 ? "" : "s"})`;
    }
    return label;
  }
  const prefixes: Record<string, TranslationKey> = {
    "アップロード済み": "groupUploaded",
    "シリーズ": "groupSeries",
    "セット": "groupSet",
    "表紙・サムネイル": "groupCover",
    "その他": "groupOther",
  };
  const prefix = match[1]!;
  const count = Number(match[2]);
  if (uiLanguage === "ja") return label;
  return `${t(prefixes[prefix] ?? "imagesHeading")} (${count} image${count === 1 ? "" : "s"})`;
}

export function formatPlural(count: number): string {
  return uiLanguage === "ja" ? "" : count === 1 ? "" : "s";
}

export function formatFailedAria(failed: boolean): string {
  if (uiLanguage === "ja") return failed ? `${t("imageFailed")}。` : "";
  return failed ? ` ${t("imageFailed")}. ` : " ";
}

localizeDocument();
