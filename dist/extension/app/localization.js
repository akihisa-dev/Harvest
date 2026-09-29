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
    collectionTitle: "Click links to analyze them, then click an analyzed link again to save selected images in the chosen format",
    sourceDrop: "Click to enter a page URL",
    sourcePlaceholder: "Enter a page URL",
    scan: "Analyze",
    sourceHint: "If left blank, the open page will be analyzed.",
    save: "Save",
    exportHeading: "Choose a format and save",
    exportFormat: "Save format",
    includeSourcePage: "Add a source page at the end",
    sourceHeading: "Source",
    imagesHeading: "Image groups",
    selectionToolbar: "Display, select, and reorder images",
    workspaceControls: "Image and save controls",
    selectAll: "Select all",
    selectAllTitle: "Select all images, including those not displayed",
    clearAll: "Clear selection",
    clearAllTitle: "Clear the selection, including images not displayed",
    resetOrder: "Restore order and selection",
    resetOrderTitle: "Restore the order and save selection from immediately after analysis",
    display: "Display",
    displayImages: "Images to display",
    groupControls: "Display and save selection for image groups",
    pdf: "PDF",
    pdfImages: "Images to include in the PDF",
    viewerMode: "Viewer mode",
    clear: "Clear",
    clearTitle: "Clear the collected results and selection",
    backToImages: "Back to image list",
    failuresHeading: "Images that could not be prepared",
    viewer: "Viewer for selected images",
    viewerEmpty: "No images are selected for saving.",
    viewerStage: "Image. Use the wheel to zoom, then drag to pan while zoomed in",
    viewerControls: "Viewer controls and thumbnails of selected images",
    previous: "Previous",
    next: "Next",
    zoomGroup: "Zoom image",
    zoomOut: "Zoom out",
    zoomReset: "Reset zoom",
    zoomIn: "Zoom in",
    allGroups: "all images",
    displayGroup: "Show {label}",
    hideGroup: "Hide {label}",
    includeGroup: "Include when saving: {label}",
    exportRetry: "Retry failed images",
    exportAction: "Save {format}",
    exportSaved: "Saved {count} image{plural}",
    prepareImages: "Preparing images… {completed} / {total}",
    retryImages: "Retrying images… {completed} / {total}",
    failedSummary: "{count} image{plural} could not be retrieved. Check the images and retry.",
    pdfCreating: "Creating PDF…",
    zipCreating: "Creating ZIP archive…",
    zipCreatingShort: "ZIP…",
    zipCreatingProgress: "Creating ZIP archive… {completed} / {total}",
    imageFailedSummary: "{count} image{plural} could not be prepared. Check the images and retry.",
    previousResults: " The previous collection is being kept.",
    scanBusy: "Analyzing the page…",
    scanEmpty: "No images were found.",
    scanErrorEmpty: "Could not analyze the page. Check the page URL and try again.",
    imageBusy: "Looking for images…",
    selectionChanged: "The selection or order changed. Save again.",
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
    imageRowTitle: "Click to select for saving, drag to reorder (keyboard: Enter / Space to select, Alt + ↑ / ↓ to move)",
    imageRowAria: "{filename}, number {index}.{failed} Click to select for saving, drag or use Alt and the arrow keys to reorder",
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
    errorImageConvert: "Could not convert the image to the selected format.",
    errorImageDimensions: "The image dimensions are invalid.",
    errorImageTooLarge: "The image is too large to convert.",
    errorJxlEncode: "Could not encode the image as JPEG XL.",
    errorZipLimit: "The images exceed the ZIP format limits.",
    errorZipCreate: "Could not create the ZIP archive.",
    errorSavePreference: "Could not save the source page setting.",
    errorSaveFormatPreference: "Could not save the export format setting.",
};
const japanese = {
    documentTitle: "Harvest | 画像を集める",
    pageUrl: "ページURL",
    optional: "任意",
    collectionStart: "収集",
    collectionStop: "停止",
    collectionTitle: "リンクをクリックして解析し、解析済みリンクをもう一度クリックすると選択画像を選んだ形式で保存します",
    sourceDrop: "クリックしてページURLを入力",
    sourcePlaceholder: "ページURLを入力",
    scan: "解析",
    sourceHint: "空欄なら、開いているページを解析します。",
    save: "保存",
    exportHeading: "保存形式と保存",
    exportFormat: "保存形式",
    includeSourcePage: "末尾に出典ページを追加",
    sourceHeading: "Source",
    imagesHeading: "画像グループ",
    selectionToolbar: "画像の表示・選択・並び順",
    workspaceControls: "画像と保存の操作",
    selectAll: "すべて選択",
    selectAllTitle: "表示していない画像も含めて、すべて選択",
    clearAll: "選択を解除",
    clearAllTitle: "表示していない画像も含めて、選択を解除",
    resetOrder: "全部元に戻す",
    resetOrderTitle: "解析直後の並び順と保存対象の選択に戻す",
    display: "表示",
    displayImages: "表示する画像",
    groupControls: "画像の表示と保存対象の選択",
    pdf: "PDF",
    pdfImages: "PDFに含める画像",
    viewerMode: "ビュアーモード",
    clear: "クリア",
    clearTitle: "収集結果と選択をクリア",
    backToImages: "画像一覧に戻る",
    failuresHeading: "準備できなかった画像",
    viewer: "選択した画像のビュアー",
    viewerEmpty: "保存する画像が選択されていません。",
    viewerStage: "画像。ホイールで拡大縮小、拡大中はドラッグで移動",
    viewerControls: "ビュアー操作と選択した画像のサムネイル",
    previous: "前へ",
    next: "次へ",
    zoomGroup: "画像の拡大と縮小",
    zoomOut: "縮小",
    zoomReset: "表示倍率を戻す",
    zoomIn: "拡大",
    allGroups: "すべての画像",
    displayGroup: "{label}を表示",
    hideGroup: "{label}を非表示",
    includeGroup: "保存対象に含める {label}",
    exportRetry: "失敗分を再試行",
    exportAction: "{format}を保存",
    exportSaved: "{count}件保存しました",
    prepareImages: "画像を準備しています… {completed} / {total}",
    retryImages: "画像を再試行しています… {completed} / {total}",
    failedSummary: "{count}枚を取得できませんでした。画像を確認して再試行してください。",
    pdfCreating: "PDFを作成しています…",
    zipCreating: "ZIPを作成しています…",
    zipCreatingShort: "ZIP作成中",
    zipCreatingProgress: "ZIPを作成しています… {completed} / {total}",
    imageFailedSummary: "{count}枚を準備できませんでした。画像を確認して再試行してください。",
    previousResults: " 前の収集結果を保持しています。",
    scanBusy: "ページを調べています…",
    scanEmpty: "画像が見つかりませんでした。",
    scanErrorEmpty: "解析できませんでした。ページURLを確認して、もう一度お試しください。",
    imageBusy: "画像を調べています…",
    selectionChanged: "選択や順序が変わりました。もう一度保存してください。",
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
    imageRowTitle: "クリックで保存対象を選択、ドラッグで並べ替え（キーボード: Enter / Spaceで選択、Alt + ↑ / ↓で移動）",
    imageRowAria: "{filename}、{index}番目。{failed}クリックで保存対象を選択、ドラッグまたはAltと上下矢印で並べ替え",
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
    errorImageConvert: "画像を選択した形式へ変換できませんでした。",
    errorImageDimensions: "画像の大きさが不正です。",
    errorImageTooLarge: "画像が大きすぎて変換できませんでした。",
    errorJxlEncode: "画像をJXLに変換できませんでした。",
    errorZipLimit: "画像の数またはサイズがZIP形式の上限を超えています。",
    errorZipCreate: "ZIPを作成できませんでした。",
    errorSavePreference: "出典ページの設定を保存できませんでした。",
    errorSaveFormatPreference: "保存形式の設定を保存できませんでした。",
};
export const translations = { en: english, ja: japanese };
function detectLanguage() {
    const browserChrome = globalThis.chrome;
    const uiLanguage = browserChrome?.i18n?.getUILanguage?.() ?? "ja";
    return uiLanguage.toLowerCase().startsWith("ja") ? "ja" : "en";
}
export const uiLanguage = detectLanguage();
export const translationKeys = Object.keys(english);
export function t(key, values = {}) {
    const template = translations[uiLanguage][key];
    return template.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? `{${name}}`));
}
export function localizeDocument(root = document) {
    root.documentElement?.setAttribute("lang", uiLanguage);
    for (const element of root.querySelectorAll("[data-i18n]")) {
        element.textContent = t(element.dataset["i18n"]);
    }
    const attributes = [
        ["data-i18n-title", "title"],
        ["data-i18n-placeholder", "placeholder"],
        ["data-i18n-aria-label", "aria-label"],
        ["data-i18n-alt", "alt"],
    ];
    for (const [dataName, attribute] of attributes) {
        for (const element of root.querySelectorAll(`[${dataName}]`)) {
            element.setAttribute(attribute, t(element.getAttribute(dataName)));
        }
    }
}
const sourceMessages = {
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
    "画像を変換できませんでした。": "errorImageConvert",
    "画像が大きすぎて変換できませんでした。": "errorImageTooLarge",
    "JXLに変換できませんでした。": "errorJxlEncode",
    "ZIPに含められる画像数の上限を超えています。": "errorZipLimit",
    "画像がZIP形式の上限を超えています。": "errorZipLimit",
    "ZIP全体がZIP形式の上限を超えています。": "errorZipLimit",
    "ZIP内のファイル名は単一の安全な名前にしてください。": "errorZipCreate",
    "ZIP内のファイル名が重複しています。": "errorZipCreate",
    "ZIP内のファイル名が長すぎます。": "errorZipCreate",
    "ZIP作成を中止しました。": "errorZipCreate",
    "Could not create ZIP archive.": "errorZipCreate",
};
export function localizeErrorMessage(message, fallback = "errorPageRead", forceFallback = false) {
    const key = sourceMessages[message];
    if (key)
        return t(key);
    const translatedKey = translationKeys.find(candidate => translations.en[candidate] === message || translations.ja[candidate] === message);
    if (translatedKey)
        return t(translatedKey);
    if (forceFallback || (uiLanguage === "en" && /[ぁ-んァ-ヶ一-龯]/u.test(message)))
        return t(fallback);
    return message;
}
export function formatGroupLabel(label) {
    const match = /^(アップロード済み|シリーズ|セット|表紙・サムネイル|その他) \((\d+)枚\)$/.exec(label);
    const genericMatch = /^.+ \((\d+)枚\)$/.exec(label);
    if (!match) {
        if (uiLanguage === "en" && genericMatch) {
            const count = Number(genericMatch[1]);
            return `${t("groupGeneric")} (${count} image${count === 1 ? "" : "s"})`;
        }
        return label;
    }
    const prefixes = {
        "アップロード済み": "groupUploaded",
        "シリーズ": "groupSeries",
        "セット": "groupSet",
        "表紙・サムネイル": "groupCover",
        "その他": "groupOther",
    };
    const prefix = match[1];
    const count = Number(match[2]);
    if (uiLanguage === "ja")
        return label;
    return `${t(prefixes[prefix] ?? "imagesHeading")} (${count} image${count === 1 ? "" : "s"})`;
}
export function formatPlural(count) {
    return uiLanguage === "ja" ? "" : count === 1 ? "" : "s";
}
export function formatFailedAria(failed) {
    if (uiLanguage === "ja")
        return failed ? `${t("imageFailed")}。` : "";
    return failed ? ` ${t("imageFailed")}. ` : " ";
}
localizeDocument();
