# Harvest

[English](#english) | [日本語](#日本語)

## English

Harvest is a Chrome extension that collects images, GIFs, and videos from a page and saves selected items as PDF, JPG, PNG, JXL, MP4, or GIF. Every selected item is included. Still images can form one PDF; mixed outputs are packaged in one ZIP. A lone output downloads directly, while video-only recommended/MP4 exports use individual downloads. You can analyze the current page or enter a URL, browse groups, select individual items, and change their order. Collection is limited to the page you specify.

### How to use

1. Open a page containing images in Chrome and click the Harvest icon to open the side panel.
2. Analyze the current page, or enter a URL and click **Analyze**. You can drop a URL anywhere in the side panel, even when another URL or analysis results are already present. A full-panel drop guide appears while dragging a URL. An entered or dropped URL takes precedence over the current page.
3. After analysis, the image list appears with an initial group selected for saving. Loaded image and GIF thumbnails show their resolution above the filename. Click an image to toggle selection; drag it or use the keyboard to reorder it. Videos, GIFs, and still images are grouped by format, preserving groupings such as image series. Each group's eye button controls visibility, and its checkbox controls selection for saving. Choose image and video formats independently, then click **Save** once for all selected items. PDF combines still images; animated images and videos remain separate outputs in the same ZIP. A lone output downloads directly. Video-only recommended/MP4 exports download individually.

While analyzing an ordinary page or an individual X post, **Stop** cancels the pending analysis and keeps the previous results, selection, and order. You can analyze again once it stops. An already injected page reader may finish, but its result is not published. Bookmark analysis instead waits for the current continuation request and displays the bookmarks collected so far.

#### Analyze links continuously

Click **Collect** at the top to analyze links on the current page by clicking them. Links to analyze glow light blue; links you can click again to save the current selection glow a stronger gold. The color changes after analysis even if the pointer stays still. Successfully analyzed links keep glowing after the pointer leaves, and the glow disappears when the link is removed from the page. No text labels are added, and stopping collection removes all glows. A normal left click prevents navigation and analyzes the linked page in a minimized analysis window, replacing the results.

Click a successfully analyzed link again to save the current selection and order in the chosen format. Other links start a new analysis; clicking a failed link retries it. **Stop** restores normal link behavior. Link clicks during analysis or saving neither navigate nor start another analysis. Modified clicks and non-HTTP/HTTPS links behave normally. Navigating away ends collection mode; click **Collect** again on the new page.

#### Selection, visibility, and order

After analysis, Harvest preferentially displays and selects the group identified as the main content. Otherwise, it prefers series, sets, covers/thumbnails, then other images. Ties favor the group with more images, then the first discovered group. Eye buttons show or hide a group's images. Checkboxes include or exclude them from saving without changing visibility.

**Select all** and **Clear selection** affect the entire collection, including hidden images. Initial order follows positions on the page when analysis finishes: top to bottom, then left to right at the same height, with element order breaking ties. Candidates without a visible position follow in discovery order. Harvest does not infer page numbers from filenames. The number at the top left of each image is its position in the entire collection.

The circular arrow restores the order and save selection from immediately after analysis, preserving visibility. **Clear** removes the results, selection, and visibility state.

Successful saving and **Clear** also empty the entered URL. Failed saving preserves the URL for retrying.

#### Updates during analysis and failure handling

Harvest collects and deduplicates image candidates, splitting the page scan into smaller tasks. It briefly watches for added images and changed image URLs during analysis: until 250 ms without changes, with an 800 ms maximum. If an image URL changes, the old URL is removed when that image was its only source. For images that appear only after scrolling or clicking, perform that action before analyzing.

Failed reanalysis preserves the previous results, selection, and order. Results are replaced only after a new analysis succeeds. Pages that do not finish loading, and tabs closed or navigated away during analysis, produce an error and can be analyzed again.

#### Appearance and viewer

Selection, visibility changes, and reordering use short transitions. Animations are skipped when the device requests reduced motion.

Controls follow the browser or system light/dark setting, including changes while the panel is open. The interface and **License and source** page follow Chrome's display language: Japanese for Japanese, English otherwise. Controls, accessible labels, and known error messages use that language; unknown errors use a translated general message. After changing the language, restart Chrome if needed and reopen the panel. Images, page titles, filenames, and PDF colors are preserved. The source page heading remains **Source** in both languages. There is no separate language switch in Harvest.

Controls are monochrome, while images and saved PDFs retain their original colors. Analysis initially opens the image list. URL entry, Analyze, Clear, and Collect are at the top; format, saving, source-page settings, viewer switching, and group controls are to the right of the images. **Viewer mode** previews selected images; **Back to image list** returns to the list. Select images with thumbnails or Previous/Next, and zoom with the wheel or zoom buttons.

Drag a zoomed image to pan. Group labels show counts, and image labels show positions in the full collection. Save controls show the selected item count, progress while saving, and a retry action after failure; completion shows the saved count. Click the save button again during saving to cancel while retaining the progress display. Once requests and conversion stop, prepared images are discarded and saving becomes available again. Incomplete PDFs and ZIPs are not saved; the same selection can be saved again.

The all-images eye and checkbox control visibility and save selection for the whole collection; group controls affect only their own group. A crossed-out eye indicates hidden images. When there are many groups, only the group list scrolls; save settings and collection-wide visibility and selection controls stay fixed. Narrow, short panels use compact controls to keep the last group reachable.

Saved filenames use the page title. Unsupported filename symbols and control characters are replaced, and leading or trailing dots and whitespace are removed. Long titles are shortened without splitting an emoji; an empty result uses the default image name. A directly saved PDF uses the page title; a PDF inside a ZIP uses its numbered entry name. The PDF source page and both preview surfaces show that actual PDF name. Multiple MP4 files keep their sequence numbers.

#### PDF source page

**Add a source page at the end** applies when the chosen format produces a still-image PDF, including when recommended resolves to PDF. When enabled, it appends one page containing the **Source** heading, saved PDF filename, and source page URL. Text, including Japanese and emoji, can be displayed, selected, and copied. The source page also appears at the end of the image list and viewer thumbnails and can be previewed in the viewer. When the output format is not PDF, this setting is hidden and the source page is omitted. Returning to PDF, including through recommended, restores the saved setting and preview. This source-page setting is stored in the browser and retained the next time the panel opens. Both image and video formats start at recommended whenever the panel opens. Page URLs and collected results are not stored as preferences.

#### PDF quality and retries

Each selected still image becomes a PDF page matching its original dimensions, always at the highest available quality. Supported JPEGs are embedded unchanged after structural and decoding checks; other images use lossless compression of browser-decoded pixels. Transparency is composited over white. Image and page dimensions are preserved, without upscaling or invented detail. Detail already lost through source compression, or color changes introduced by browser decoding, cannot be restored.

This quality can increase PDF size and memory use. Up to three images are fetched concurrently, while decoding and conversion run one at a time. Each fetch, including its response body, times out after 20 seconds. Large pixel operations run in smaller chunks, and cancelling PDF creation also stops image compression. Image and drawing memory is released after conversion or cancellation. If an image cannot be fetched, saving stops and its number, filename, and failure reason are shown.

Retry fetches only failed images and saves the PDF once all are ready. Changing selection or order makes the next save prepare the selection again from the beginning. Chrome internal pages and pages Chrome cannot open are unsupported.

#### Saving GIFs and videos

Video thumbnails show the file size before conversion, or **Size unknown** when the server does not provide it. Successful reanalysis refreshes size information even for an unchanged video URL. This is not the size of the converted video or ZIP.

Image formats are original, recommended, PDF, JPG, PNG, and JXL; video formats are original, recommended, and MP4. The two choices are independent. An absent media type hides its format section without changing its choice in the open panel. GIF detection recognizes a `.gif` URL suffix or `format=gif`, `fmt=gif`, or `fm=gif`, ignoring case in parameter names and values. Format parameters take precedence over the extension, and saving also validates the fetched data. GIFs belong to the image section. Choosing PDF, JPG, PNG, or JXL preserves animation as a GIF. Recommended preserves source bytes unless the selected still images qualify for a series PDF.

Video-only recommended/MP4 exports save each selected video separately, using the page title for one file and the title plus sequence numbers for multiple files. Mixed image/video exports and multiple original video outputs use one ZIP. A single output downloads directly.

These video-only recommended/MP4 files are saved one at a time through Chrome's download manager. Success is shown only after every download completes, including any destination selection or Chrome confirmation. Refusal, failure, and cancellation are not treated as success. Only unsaved files are retried, retaining their original sequence numbers. Completed files are not undone. Existing files are not overwritten: Chrome chooses a non-conflicting filename.

Original MP4 and GIF data is preserved without conversion. WebM is converted to MP4 for video recommended/MP4, while video original retains it. An item labeled “GIF” on X is saved as a video when its actual data is MP4; it is not converted to GIF. Video rows use the retrieved thumbnail or, if none is available, a video indicator. No selected item is excluded because of the other media type's format choice.

Harvest reads MP4 and WebM URLs from video elements, and MP4 URLs from playback information in the page or data used to display X posts. WebM is still saved as MP4, with a conversion notice before saving. Conversion uses H.264 video and AAC audio while preserving resolution, frame timing, channel count, and sample rate. Recompression may change quality and file size. Unsupported video or audio stops saving with an explanation; tracks are not silently removed.

For X, Harvest chooses the highest bitrate among available MP4 candidates. After the initial page load, it waits for posts and video content and reads again, including playback information in expanded video views. A specified post URL limits collection to the matching post's body, images, and videos, excluding quotes, replies, and recommendations. Expanded views are read only when they can be matched to that post. Profile images are excluded. Display restrictions, incomplete loading, missing downloadable MP4 URLs, or data that cannot be saved as MP4 produce an explanation; profile images alone do not count as a successful analysis.

The bookmarks area of history (`/i/history`) and the older bookmarks page (`/i/bookmarks`) also wait for posts and retry reading, excluding profile images. Data attached to displayed posts supplements photos without image elements and multiple videos, without duplicating photos whose URL formats or display sizes differ. List views include quoted and reposted media. Video thumbnails are distinguished from videos, and quality variants of a video are merged. Harvest compares visible media with results per post and rereads incomplete posts once. Remaining gaps or scan limits produce an explanation and preserve previous results. All collected media groups are initially visible. On bookmark lists, Analyze asks X’s own continuation action to load remaining pages sequentially without scrolling. Stop keeps the collected results; failures leave a partial-result notice. URLs remain only in side-panel memory and are discarded when it closes.

Media cannot be saved if the page exposes no playback information or provides only segmented or live streams. A selection containing videos, known GIFs, or original images is fetched one at a time, with a 64 MiB file limit. Known GIFs, videos, and original-media fetches have a 120-second timeout; still or unclassified image fetches have a 20-second timeout. WebM conversion also runs one at a time, with a 64 MiB output limit and 120-second timeout. Downloads do not start if any file cannot be prepared; failed items can be retried or saving cancelled. Fetched and converted data exists only in panel and worker memory and is discarded on completion, cancellation during preparation, or panel closure. If MP4 saving fails or is cancelled after downloads begin, prepared data and completed item numbers remain in memory for retrying. They are discarded on completion, changes to results/selection/format, Clear, or panel closure.

Conversion workers terminate on success, failure, cancellation, or timeout. Conversion does not send data externally or persist it.

#### Saving original or recommended formats

Within the image section, `original(extension)` and `recommended(extension)` appear above PDF, JPG, PNG, and JXL. In narrow panels, original and recommended stack vertically so the text and recommendation marks fit. The video section offers original, recommended, and MP4 independently. Labels follow the selection, showing “mixed” or “unknown” when needed, with the full list in a tooltip. Original extensions use the validated response type when available, otherwise URL hints. Saved extensions use the validated response type.

Image formats marked with ★ are suitable for different uses. Original is recommended to keep each file unchanged. PDF is also recommended to read a series in one document when at least two selected still images belong to one series or set under the list's existing URL-pattern and format grouping. A single still image, multiple still-image groups, covers, miscellaneous images, and uploads do not trigger the PDF recommendation. Recommendations follow selection; the eye buttons only change visibility.

The image recommended option saves that series as PDF when it qualifies; otherwise it preserves original image bytes, including animated WebP and APNG. Video recommended uses MP4. Video original and MP4 both receive ★ with their purposes: keeping each file unchanged and playback, respectively. These marks describe alternatives; saving uses one chosen format per media type without also creating the other recommended version. Recommendations do not guarantee the highest quality or smallest file.

Choosing PDF, JPG, PNG, or JXL, or using recommended when it resolves to PDF, converts animated WebP, APNG, and supported animated AVIF to GIFs using a local worker, preserving composed frames, order, and repetitions. Video original preserves source bytes; video recommended/MP4 converts WebM to MP4 and retains existing MP4 bytes. All selected items are prepared before any download starts.

PDF combines only still images in selection order, with the optional source page last. When GIFs or videos are also selected, that PDF and the individual media files share one ZIP. ZIP entry numbers follow the source selection; the PDF uses the first still image's number, so numbering can have gaps. One output downloads directly. Video-only recommended/MP4 exports retain sequential managed downloads. Selection, order, both chosen formats, the resolved image output format, and the source-page setting are fixed when saving starts. Retries and completion retain that resolved format even if fetching reveals more information about an image. A retry with the same settings reuses successful preparations; changing settings, selection, or order invalidates them. Cancellation, Clear, rescanning, and panel closure do not accept an old completion as success.

Whenever the side panel opens, both image and video formats start at recommended. Changes remain in memory for that panel, including after rescanning or when a media section is hidden or unselected. Format choices are not written to browser storage. Existing `harvest.exportFormat`, `harvest.imageExportFormat`, and `harvest.videoExportFormat` entries are ignored and left unchanged. Only the source-page preference continues to be saved in `harvest.includeSourcePage`; a failure to save it is reported.

GIF conversion preserves exact frame RGB with up to 256 colors per frame when no pixel in the animation is transparent under the alpha-below-128 rule. If any frame contains such a transparent pixel, a transparent index is reserved in every frame: even opaque frames have at most 255 opaque colors plus transparency. Larger palettes use per-frame adaptive median-cut reduction. Alpha below 128 becomes transparent; other pixels are opaque. A transparency prepass and conversion each process one frame at a time without retaining all frame pixels.

Each frame receives a 20 ms minimum before cumulative end times are rounded to 10 ms units, to avoid players stretching 10 ms GIF frames to 100 ms. Short frames can therefore slow down: 17 ms × 3 becomes 20/20/20 ms, changing a 51 ms cycle to 60 ms. Added time is not subtracted from later frames. The rounding error is at most 5 ms relative to the times after applying the minimum, not relative to the original animation with short frames. Actual playback timing depends on the player. Frames shorter than 10 ms, unrepresentable timing/loops, damaged data, unavailable decoders, and limit violations stop saving instead of flattening the image. Limits remain 64 MiB output, 120 seconds, 10,000 frames, and 64 million decoded pixels in total.

When the resolved image output format is PDF, JPG, PNG, or JXL, fetched MIME and GIF structure are verified, and existing GIF bytes are preserved even without a GIF URL hint. A URL classified as GIF that returns a different media type fails explicitly. Filenames, ZIP entries, and original/recommended labels follow the verified format. Confirmed original extensions are held only in panel memory and discarded on rescanning, Clear, or panel closure. Only the source-page setting persists; format choices, page URLs, and collected results do not.

#### Saving JPG, PNG, and JXL

For still images, a single output is saved directly using the page title. Multiple outputs, including separately preserved animated GIFs or selected videos, are numbered in their current order, such as `001.jpg`, and saved in one ZIP. JPG reuses suitable JPEGs without recompression; other images are converted at maximum quality, with transparency rendered white. PNG reuses original PNG data or converts losslessly while preserving transparency. JXL uses lossless encoding of decoded pixels, without further quality loss. Conversion and ZIP creation run in the browser. Only selected images are fetched, up to three concurrently, and converted one at a time.

Successfully prepared images remain in memory for retrying failed items. The total prepared size, including numbered filenames and metadata, is checked against ZIP limits: approximately 4 GiB and at most 65,535 images. Exceeding the limit stops remaining requests, discards prepared results, and displays the reason. Reduce the image count and save again. Clicking save again or closing the panel cancels active requests and ZIP creation; incomplete ZIPs are not saved.

Only the PDF source-page preference persists; format choices and image data do not.

### Access and data

Installation requires access to ordinary HTTP/HTTPS websites. When you analyze a page, Harvest reads its title, URL, image/media URLs, and the data needed to create the selected files. An entered URL targets that page. The `sidePanel` permission displays Harvest beside the current page when its icon is clicked. JXL WebAssembly code is bundled, never fetched externally.

The `downloads` permission saves individual MP4 files and checks completion or interruption. Chrome presents this as permission to manage downloads. Harvest queries or cancels only download IDs it created, without reading other downloads or the full history. IDs and completion state stay in panel memory; history and file contents are not sent externally. Chrome and the user manage saved files and download history. Harvest does not delete existing history or saved files. Updating an existing installation may require permission approval again.

Collection, conversion, PDF creation, and ZIP creation run inside the browser, without an external collection server. The JXL encoder is bundled. Entered URLs open in a minimized analysis window that closes after reading, without adding a tab to your browsing window or moving focus to the analysis window. Fetching media sends ordinary browser requests to the hosting sites. Collected results and prepared images are not persisted and are discarded when the side panel closes. Only the source-page preference is stored in the browser. Only files you save remain on disk.

Image fetching rejects localhost and private-IP URLs outside the source page's origin before sending a request. Public hostnames are also designated as public-network requests to Chrome, restricting connections that resolve or redirect to local destinations. Login credentials are used only when the image and source page share the same scheme, hostname, and port. Restrictions after DNS resolution depend on Chrome support and are not guaranteed in older Chrome versions that ignore this option.

### Development environment

- Node.js 22–26
- pnpm 12.5.1
- Chrome with Manifest V3 support

The pnpm version is pinned in `package.json` and `pnpm-lock.yaml`; regular settings live in `pnpm-workspace.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm setup:hooks
pnpm verify:full
```

`pnpm build` creates `dist/extension/`. Load it with **Load unpacked** on Chrome's extensions page. `pnpm package:extension` creates the distribution ZIP. You can also open `配布ZIPを作成.bat` on Windows or `配布ZIPを作成.command` on macOS; both invoke the same process. It checks the required Node.js and pinned pnpm versions, builds the extension, validates ZIP integrity and the top-level `manifest.json`, then writes `dist/Harvest-extension-<version>.zip`. `dist/extension/` is tracked in Git and kept synchronized with source. Other `dist/` outputs, including ZIPs, are not tracked.

#### Source layout

Chrome-independent selection, ordering, ZIP assembly, and PDF assembly live in `src/core/`. UI, browser integration, and image format conversion live in `src/extension/`.

`response-fetch.ts` handles image/video requests and timeouts; `image-fetch.ts` and `media-fetch.ts` validate fetched content; `image-decode.ts` and `pdf-image.ts` prepare pixels for PDF; `image-format.ts` and `image-export-controller.ts` handle image conversion and retries. The JXL encoder and its Apache-2.0 license are bundled. Existing PDF creation and image preparation calling interfaces are preserved. See [core processing](src/core/README.md) and [UI and browser integration](src/extension/README.md) for responsibility boundaries; these documents are in Japanese.

The build places compiled modules together, and `check:build` verifies that their imports resolve within the distribution.

#### Development and submission guides

See [AGENTS.md](AGENTS.md) for working rules, [CONTRIBUTING.md](CONTRIBUTING.md) for contribution steps, and [repository setup](docs/repository-setup.md) for GitHub operations. These guides are in Japanese.

Chrome Web Store submission uses the [submission guide](store/submit.md) and [listing text](store/listing-ja.md), both in Japanese. Data handling is described in the [privacy policy](docs/privacy-policy.md), also in Japanese.

### License

GNU Affero General Public License version 3 only (AGPL-3.0-only). See [LICENSE](LICENSE) for the full text.

The ZIP submitted to the store includes the full license, corresponding source, and instructions for building the same version. Open **License and source** in the extension for details.

The initial screen displays `assets/brand/harvest-geometric-logo.svg` in the center. The build copies it into the extension's `brand/` directory and bundled source.

## 日本語

Harvestは、Chromeで開いているページの画像・GIF・動画を集め、選択した項目をPDF、JPG、PNG、JXL、MP4、GIFで保存するChrome拡張機能です。全選択項目を処理し、静止画像は一つのPDFへ、混在する出力は一つのZIPへまとめます。一つの出力は直接保存し、動画のみのrecommended/MP4は個別保存します。現在のページの解析とURLの直接入力に対応し、画像のまとまりごとの表示、個別選択、順序の変更ができます。画像の収集対象は指定したページだけです。

### 使い方

1. Chromeで画像のあるページを開き、Harvestのアイコンを押してサイドパネルを開きます。
2. 表示中のページを解析するか、URLを入力して「解析」を押します。URLは入力済みのURLや解析結果があってもサイドパネル全体へドロップできます。URLをドラッグすると画面全体にドロップの案内が表示されます。URLを入力・ドロップした場合は、そのURLを解析します。
3. 解析後は画像一覧が表示され、初期選択したまとまりの画像が保存対象になります。サムネイルでは読み込めた画像・GIFの解像度をファイル名の上へ表示します。画像をクリックして選択を切り替え、ドラッグまたはキーボード操作で順番を変更します。動画・GIF・静止画像は形式ごとの別グループに分け、静止画像のシリーズなどのまとまりも保持します。まとまりごとの目のボタンで表示を、チェックボックスで保存対象を切り替えます。画像と動画の形式を別々に選び、「保存」を一度押して全選択項目を処理します。PDFは静止画像をまとめ、動く画像と動画は同じZIP内の別ファイルになります。一つの出力は直接保存し、動画のみのrecommended/MP4は個別保存します。

普通のWebページやX個別投稿の解析中に「停止」を押すと、未完了の解析を中止し、前の結果・選択・並び順を保持します。停止後は再び解析できます。ページへ実行済みの読み取りが完了しても、その結果は反映しません。ブックマークでは実行中の続き取得1回を待ち、取得済みの分を表示します。

#### リンクを続けて解析する

上部の「収集」を押すと、現在開いているページのリンクをクリックして解析できます。解析するリンクは水色に発光し、再クリックで選択中の画像を保存するリンクはより強い金色に発光します。解析後はカーソルを動かさなくても色が切り替わります。解析に成功したリンクはカーソルを外しても発光を保ち、対象リンクがページから削除されると発光も消えます。文字は表示せず、収集を停止すると発光をすべて解除します。通常の左クリックはページ移動を止め、リンク先を最小化した解析用ウィンドウで解析して結果を置き換えます。

解析に成功したリンクをもう一度クリックすると、現在選択している画像と並び順を選択中の形式で保存します。別のリンクは新しく解析し、解析に失敗したリンクの再クリックは解析を再試行します。「停止」を押すと通常のリンク操作に戻ります。解析・保存中のリンククリックは移動せず、追加の解析も行いません。修飾キー付きクリックとHTTP/HTTPS以外のリンクは通常どおり動作します。ページを移動した場合は収集モードが終了するため、新しいページでは再度「収集」を押してください。

#### 画像の選択・表示・並び順

解析後は本文と判定したまとまりを優先して初期表示し、保存対象にも選択します。本文を判定できない場合は、シリーズ、セット、表紙・サムネイル、その他の順で選びます。同じ順位のまとまりが複数ある場合は画像枚数が多いものを選び、枚数も同じ場合は先に見つかったものを選びます。まとまりごとの目のボタンで、そのまとまりの画像を表示または非表示にできます。チェックボックスはそのまとまりの画像を保存対象に含めるかどうかを切り替え、表示状態には影響しません。

「すべて選択」「選択を解除」は非表示の画像も含む収集結果全体に作用します。画像の初期順序は、通常は解析終了時のページ内の表示位置を基準に、上から下、同じ高さでは左から右へ並べます。同じ位置ではページ内の要素の順を使います。表示位置を取得できない画像候補は、表示画像の後に検出順で加えます。ファイル名の数字からページ番号を推測することはありません。画像左上の番号は、収集した画像全体での並び順です。

円形矢印のボタンは解析直後の順番と保存対象の選択に戻します。表示状態は保ちます。「クリア」で収集結果、選択状態、表示状態を消せます。

保存に成功したときと「クリア」を押したときは、入力したURLも空になります。保存に失敗したときは再試行のためURLを残します。

#### 解析中の更新と失敗時の扱い

解析は画像候補を重複排除しながら集め、ページ全体の調査を小分けにして実行します。解析中に追加される画像や画像URLの変更を短時間監視します（変化が止まって250ミリ秒、監視は最大800ミリ秒）。画像URLが差し替わった場合、その画像だけから検出した古いURLは候補から外します。スクロールやクリックによって初めて追加される画像は、その操作を行ってから解析してください。

Xのブックマークでは、Xが受信した一覧の投稿IDとメディア情報をページ内のメモリに保持し、画面外になった投稿も解析します。受信した一覧順に並べ、画面だけから取得した候補を補います。同じ一覧の解析で取得できた投稿もページ内に保持し、スクロール後の再解析で先頭や後方の取得済み画像が消えないようにします。解析すると、X自身の続き取得処理を順番に呼び、まだ読み込んでいないページも取得します。スクロール位置は変えません。「停止」は実行中の1回の取得が終わるか時間切れになるまで待ち、取得済みの分を表示します。通信失敗や取得が進まない場合も部分取得として表示します。解析時には、現在の画面に結び付いた一覧とX内部の投稿情報からも補完します。受信監視が始まる前から開いているページでも、この対応を確認できればXの再読み込みは不要です。対応を確認できない場合は、取得済みの結果を残して案内を表示します。

再解析に失敗した場合は、それまでの収集結果、選択、順序を保持します。新しい解析が正常に完了した時点で結果を置き換えます。読み込みが完了しないページや、解析中に閉じられた・移動したタブはエラーとして扱い、再度解析できます。

#### 画面表示とビュアー

選択・表示の切り替えや画像の並べ替えは、短い滑らかな動きでつながります。端末で動きを減らす設定を有効にした場合は、アニメーションを省きます。

操作欄の明暗はブラウザーまたはシステムの設定に自動で従い、設定を変更すると開いているパネルにも反映されます。操作画面と「ライセンスとソース」の表示言語はChromeの表示言語に従い、日本語なら日本語、それ以外は英語で表示します。操作項目、読み上げ用の説明、既知のエラーは選択された言語で表示し、未知のエラーには翻訳済みの一般的な説明を使います。言語設定の変更後は必要に応じてChromeを再起動してパネルを開き直してください。画像、ページの名前、ファイル名、PDFの色は変更しません。出典ページの見出しは「Source」です。独自の言語切り替えボタンはありません。

操作欄はモノクロですが、画像と保存したPDFは元の色を保ちます。解析後はビュアーではなく画像一覧を初期表示します。URL入力・解析・クリア・収集は上部に、保存形式と保存・出典ページの設定・ビュアー切り替え・画像グループの操作は画像の右側に並びます。「ビュアーモード」で保存対象の画像を確認し、「画像一覧に戻る」で一覧へ切り替えられます。ビュアーではサムネイルや前後ボタンで画像を選び、ホイールまたは拡大縮小ボタンで拡大・縮小できます。

拡大中は画像をドラッグして表示位置を動かせます。グループ名には枚数、各画像には収集結果全体での順番を表示します。保存ボタンには選択件数、保存中には進捗、失敗時には再試行の操作、保存完了時には保存件数を表示します。保存中に同じボタンをもう一度押すと、進捗表示を保ったまま保存を中止できます。通信と変換の終了後に準備済みの画像を破棄し、通常の保存可能状態へ戻ります。不完全なPDF・ZIPは保存せず、同じ対象を再度保存できます。

全画像の目とチェックボックスで、収集結果全体の表示・保存対象を切り替えます。各グループの目とチェックボックスでは、そのグループだけを切り替えられます。斜線の付いた目は非表示を示します。グループが多いときはグループ名の領域だけをスクロールでき、保存設定や全体の表示・選択ボタンは固定されます。狭幅で高さが低い場合は操作欄を圧縮して、末尾のグループも操作できる領域を確保します。

保存名にはページタイトルを使います。ファイル名に使えない記号と制御文字を置き換え、先頭・末尾のドットと空白を取り除きます。長いタイトルは絵文字を途中で切らずに短くし、名前が空になる場合は既定の画像名を使います。直接保存するPDFはページ名、ZIP内のPDFは連番の項目名を使い、PDF出典ページと一覧・ビューアーの出典プレビューにもその実際のPDF名を表示します。複数MP4の連番は維持します。

#### PDFの出典ページ

「末尾に出典ページを追加」は静止画像をPDFへまとめる場合に使える機能で、recommendedの保存形式がPDFとなる場合も対象です。オンにすると、画像ページの後に「Source」の見出し、保存したPDFのファイル名、画像を見つけた元ページのURLを1ページに載せます。日本語や絵文字を含む文字も表示でき、選択・コピーできます。オンの場合は画像一覧とビュアーのサムネイルにもSourceページを末尾に表示し、ビュアーで内容を確認できます。実際の保存形式がPDF以外になるとこの設定は隠れ、出典ページは追加しません。recommendedを含めてPDFへ戻ると、保存していた設定とプレビューが再び表示されます。この出典ページ設定はブラウザー内に保存され、次回パネルを開いても維持されます。画像・動画の保存形式は、パネルを開くたびに両方ともrecommendedで始まります。ページURLや画像の収集結果は設定として保存しません。

#### PDFの画質と再試行

PDFは画像の元の大きさに合わせて1枚ずつページを作成します。常に最高画質で保存します。対応するJPEGは構造と読み取り結果を確認したうえで元データをそのまま埋め込み、それ以外はブラウザーで読み取った画素を劣化しない圧縮で保存します。透明部分は白背景に合成します。画像やページの縦横サイズは変えず、拡大による細部の補完は行いません。元画像の圧縮で失われた細部や、ブラウザーの画像読み取り時の色変換までは復元できません。

最高画質ではPDFの容量と作成時のメモリ使用量が増える場合があります。画像は最大3件を並行して取得し、画素への展開と変換は1件ずつ行います。画像の取得は応答本文を含めて1件あたり20秒で時間切れになります。大きな画像の画素処理は小分けにし、PDF作成を中止した場合は画像の圧縮も中断します。変換後または中止後に画像と描画用のメモリを解放します。画像を取得できなかった場合は保存せず、該当画像の番号、名前、失敗理由を表示します。

「再試行」を押すと失敗した画像だけを取得し直し、すべて揃ってからPDFを保存します。選択や順序を変えると、次の保存では選択画像を最初から準備します。Chromeの内部ページや、Chromeで開けないページは対象外です。

#### GIF・動画の保存

動画のサムネイルには、変換前のファイルサイズを表示します。配信元からサイズ情報を取得できない場合は「サイズ不明」と表示します。再解析が成功したときは、同じ動画URLでもサイズ情報を取得し直します。変換後の動画やZIPのサイズとは異なります。

静止画像にはPDF・JPG・PNG・JXL、動画にはMP4を選べます。動く画像は画像側の形式で扱い、PDF・JPG・PNG・JXLではGIFとして保持します。recommendedは静止画像のシリーズをPDFにする条件に合う場合を除き、動く画像も原本を保持します。GIFはURL末尾の `.gif` または `format=gif`・`fmt=gif`・`fm=gif` から判定し、パラメーター名・値の大文字と小文字を区別しません。形式指定がある場合は拡張子より優先し、保存時には実際のデータ形式も検査します。MP4を選ぶと選択した動画を個別のMP4ファイルとして保存します。1件ならページ名、複数ならページ名に連番を付けます。GIFは1枚ならGIFファイルを直接保存し、複数枚なら連番ファイルを1つのZIPへまとめます。

動画のみのrecommended/MP4はChromeのダウンロード管理機能で1件ずつ保存し、全件の完了を確認してから「保存しました」と表示します。保存先の選択やChromeの確認が必要な場合は完了するまで待ちます。拒否・失敗・中止があった場合は成功扱いにせず、未保存分だけを元の連番で再試行できます。完了済みのファイルは取り消しません。同名の既存ファイルは上書きせず、Chromeが重複を避ける名前に変更します。

元がMP4またはGIFなら再変換せず、元のバイト列を保ちます。動画のrecommended/MP4ではWebMをブラウザー内でMP4へ変換し、originalではWebMの原本を保持します。Xで「GIF」と表示されるものも、実体がMP4ならMP4として保存し、GIFへ変換しません。動画がない場合は動画の形式欄を隠し、画像がない場合は画像の形式欄を隠します。隠した側の選択形式は維持します。

形式を指定しても選択中の項目を種類で除外せず、保存ボタンには選択元の項目数を表示します。動画一覧には取得できたサムネイル、なければ動画を示す印を表示します。

動画はページの動画要素からMP4・WebMのURLを、ページ内の再生情報やXの投稿表示に使われている情報からMP4のURLを取得します。WebMを含む場合も保存形式はMP4で、保存前に変換することを表示します。WebMは映像をH.264、音声をAACに変換し、解像度・フレーム間隔・音声のチャンネル数とサンプルレートを維持します。再圧縮による画質・音質の変化や容量の増減はあり得ます。変換できない映像・音声がある場合は、勝手に取り除かず理由を表示して保存を止めます。

Xは取得できるMP4候補の中から最も高いビットレートを選びます。Xの投稿は初期ロード完了後も投稿・動画の表示を待って解析し直し、動画の拡大表示にある再生情報も読み取ります。投稿URLを指定した場合はその投稿IDと一致する本文・画像・動画だけを対象とし、引用・返信・おすすめの投稿は含めません。拡大表示も指定投稿との対応を確認できる場合だけ読み取ります。プロフィール画像は保存対象から除外します。Xの表示制限、投稿の読み込み未完了、動画ページからMP4のURLを読み取れない場合や、取得したデータをMP4として保存できない場合は理由を表示し、プロフィール画像だけを解析の成功結果にしません。

履歴画面のブックマーク欄（`/i/history`）と従来のブックマーク画面（`/i/bookmarks`）でも投稿の表示を待って解析し直し、プロフィール画像を除外します。ページに表示された投稿に付随するデータから、画像要素になっていない写真や複数の動画も補います。同じ写真のURL形式・表示サイズの違いで補完分が重複しないようにします。Xの投稿写真は、一覧の縮小表示用URLから配信元のオリジナルサイズ（`name=orig`）を指定する保存用URLへ統一します。取得できない場合に縮小版へ黙って切り替えることはありません。一覧では引用と再投稿のメディアも対象です。動画のサムネイルと動画本体を区別し、同じ動画の画質違いは1件にまとめます。画面にあるメディアと取得結果を投稿ごとに照合し、不足がある投稿だけを1回読み直します。画面上の画像・動画URLを先に収集し、投稿データから補完します。補完が終わらない場合も取得できた画像・動画を表示し、一部を取得できていないことを案内します。何も取得できなかった場合やページが移動した場合は前の解析結果を残します。解析直後は取得したすべての種類のグループを表示します。ブックマークの解析ではX自身の続き取得処理で追加通信し、未読み込みの投稿も順番に取得します。読み取ったURLは従来どおりサイドパネル内だけで保持し、閉じると破棄します。

ページが再生情報を公開していない場合や、分割配信・ライブ配信だけの場合は保存できません。動画・既知GIF・画像のoriginalを含む選択では1件ずつ取得し、1ファイル64 MiBを上限にします。既知GIF・動画・originalの取得は120秒、静止・未分類画像の取得は20秒です。WebMの変換も1件ずつ行い、変換後64 MiB、変換120秒を上限とします。取得できないファイルがある場合はダウンロードを開始せず、失敗分の再試行または中止ができます。取得済みファイルと変換結果はパネルと変換用Workerのメモリだけに保持し、保存完了・準備中の中止・パネル終了で破棄します。MP4の保存開始後に失敗・中止した場合は再試行のために準備済みデータと完了済み番号をメモリに保持し、保存完了、解析結果・選択・形式の変更、クリア、パネル終了で破棄します。

変換完了・失敗・中止・時間切れのいずれでもWorkerを終了します。変換用の外部送信や永続保存は行いません。

#### original・recommendedの保存

画像欄の上側に`original（拡張子）`と`recommended（拡張子）`、その下にPDF・JPG・PNG・JXLを表示します。狭いパネルではoriginalとrecommendedを縦に並べ、文字と推奨の印を収めます。動画欄には独立したoriginal・recommended・MP4を表示します。括弧内は選択中の項目に合わせて更新します。元の拡張子は取得済みのデータ形式を優先し、未取得ならURLから分かる範囲の目安を使います。判別できない場合は「不明」、複数形式なら「混在」と表示し、ポインターを重ねると形式一覧を確認できます。保存時は取得したデータの種類を検証して拡張子を決めます。

画像と動画の形式は別々に選び、保存ボタンで全選択項目を処理します。★は用途に合う候補を示します。画像のoriginalは「各ファイルをそのまま残す」ための推奨です。選択中の静止画像が2枚以上あり、一覧と同じURLのパターン・形式の判定で一つのシリーズまたはセットに属する場合は、「シリーズを一冊にまとめて読む」ためにPDFも推奨します。静止画像が単枚、複数グループ、表紙・その他・アップロード画像の場合はPDFを自動で推奨しません。判定には保存対象の選択を使い、目のボタンによる表示・非表示は影響しません。

画像のrecommendedでは、上記のシリーズ条件に合えばPDF、それ以外はoriginalとして保存します。original相当の場合は動くWebP・APNGを含めて元データを保持します。動画のrecommendedはMP4で保存します。動画のoriginalとMP4には、それぞれ「各ファイルをそのまま残す」「再生用に使う」という用途付きの★を表示します。★が複数あっても、保存するのは選択した形式だけで、原本とPDFなどを重複して作りません。推奨は用途に応じた候補で、どの項目でも最高画質や最小容量になるという意味ではありません。

PDFは選択順に静止画像だけを一つのPDFにまとめ、出典ページを有効にした場合はその末尾へ追加します。GIFや動画が混在すると、そのPDFと個別GIF/動画を一つのZIPへ格納します。全項目の準備が成功するまでダウンロードを始めません。ZIPの連番は元の選択順を使い、集約PDFには最初の静止画像の番号を使うため番号が飛ぶ場合があります。PDF内の静止画像の順序は維持します。一つの出力だけなら直接保存し、動画のみのrecommended/MP4は従来どおり順次個別保存して完了を確認します。選択・順序・両形式・recommendedから決めた実際の画像形式・出典設定を保存開始時に固定し、同じ条件の再試行では成功した準備を再利用します。取得によって画像の情報が増えても、再試行と完了表示は開始時に決めた形式を維持します。設定変更・中止・パネル終了・クリア・再解析後には古い成功表示を使いません。

サイドパネルを開くたびに、画像・動画ともrecommendedで始まります。変更した形式は同じパネル内のメモリに保持し、再解析や、種類が隠れる・未選択になる操作では変えません。形式をブラウザー内へ新たに記録せず、既存の`harvest.exportFormat`・`harvest.imageExportFormat`・`harvest.videoExportFormat`は参照・削除・上書きしません。出典ページ設定だけを従来どおり`harvest.includeSourcePage`へ保存し、その記録に失敗した場合は画面で通知します。

`original`は選択した項目を変換せず保存します。画像のPDF・JPG・PNG・JXL、およびrecommendedがPDFとなる場合は、アニメWebP・APNG・対応デコーダーのあるアニメAVIFをローカルWorkerでGIFへ変換し、合成済みの全フレーム・順序・繰り返し回数を保持します。アニメ全体に透明画素（alphaが128未満）がなければ最大256色の元のRGBを保持します。その透明画素を含むアニメは全フレームで透明indexを予約し、不透明フレームも255色＋透明が上限になります。上限を超える色は適応的なmedian-cut減色を行います。透過判定の事前走査とGIF変換をそれぞれ1フレームずつ行い、全フレームの画素配列は保持しません。2値の透過（alphaが128未満なら透明）を使い、実際のGIF再生で10msが100msへ補正されることを避けるため、各フレームの最低表示時間を20msにした後、その累積終端を10ms刻みで丸めます。短いフレームは遅くなる場合があります。例えば17ms×3は20/20/20msとなり、1周51msが60msになります。増えた時間を後の長いフレームから差し引きません。丸めによる累積誤差は下限適用後の時間に対して最大5msであり、元の短いフレームを含む時間全体には適用できません。プレーヤーによって実際の表示時間は変わります。10ms未満のフレーム、GIFで表せない時間・ループ、破損、未対応デコーダー、制限超過では静止化せず保存を止めます。変換上限は出力64 MiB・120秒・10,000フレーム・累積展開6,400万画素で、1フレームずつ処理します。originalは原本保持です。実際の画像形式がPDF・JPG・PNG・JXLの場合は取得済みレスポンスのMIMEとGIF構造を検証し、拡張子などのURLヒントがないGIFも元バイト列を保持します。保存ファイル名・ZIP項目・originalとrecommendedのラベルには確認できた形式を反映します。確認した原本の拡張子はパネル内メモリだけに保持し、再解析・結果の消去・パネル終了で破棄します。混在時も全選択項目を保存します。出力が1ファイルなら直接保存し、複数ファイルならZIPにまとめます。ただし`recommended`で動画だけを選んだ場合は、従来のMP4と同じく個別に保存し、完了を確認します。変換や取得に失敗した項目は再試行でき、失敗が残る間は保存を開始しません。

出典ページ設定だけをブラウザー内に記録します。選択した形式や利用者データは永続化せず、外部送信先も追加しません。

#### JPG・PNG・JXLの保存

JPG・PNG・JXLは静止画像に適用し、動く画像は個別のGIF、動画は動画欄の指定形式で保存します。出力が一つならページ名のファイルとして直接保存し、複数の出力は現在の選択順で `001.jpg` のような連番にし、1つのZIPへまとめて保存します。JPGは再利用できるJPEGを再圧縮せず、その他は最高品質で変換し、透明部分を白くします。PNGは元のPNGを再利用し、それ以外は透明部分を保って可逆保存します。JXLは画素から追加の画質劣化を加えない可逆形式で作成します。変換とZIP作成はブラウザー内で行います。選択した画像だけを最大3件並行して取得し、変換は1件ずつ行います。

成功した画像は失敗分の再試行までメモリに保持します。保存全体では、連番の名前や管理情報を含めてZIP形式の上限（約4 GiB、最大65,535画像）以内になるよう、準備済み画像の合計サイズを確認します。上限を超えると分かった時点で残る通信を止め、準備結果を破棄して理由を表示します。画像数を減らして保存し直してください。進行中の通信やZIP作成は保存ボタンを再度押すかパネルを閉じると中止し、不完全なZIPは保存しません。

PDFの出典ページの設定だけを保存し、保存形式と画像データは永続化しません。

### アクセスとデータ

導入時に、すべての通常のWebサイト（HTTP/HTTPS）へのアクセスを許可する必要があります。解析ボタンを押したときに、現在のページの名前とURL、画像・動画のURL、選択したファイルの作成に必要なデータを読み取るためです。URLを入力した場合は、そのURLのページを読み取ります。`sidePanel`権限は、アイコンを押したときに現在のページの横へHarvestを表示するために使います。JXL作成用のWebAssemblyコードは拡張機能に同梱し、外部から取得しません。

`downloads`権限はMP4の個別保存と完了・中断の確認に使用します。Chromeにはダウンロードを管理する権限として表示されます。Harvest自身が開始したダウンロードIDだけを照会・中止し、他のダウンロードや履歴全体は取得しません。IDと完了状態はパネル内のメモリで扱い、履歴やファイル内容を外部へ送りません。保存ファイルとChromeのダウンロード履歴はChrome・利用者が管理し、Harvestが既存の履歴や保存ファイルを削除することはありません。既存の拡張機能を更新すると権限の再承認を求められる場合があります。

収集、画像変換、PDF・ZIP作成はブラウザー内で行い、外部の収集サーバーへは送信しません。JXLエンコーダーは拡張機能に同梱します。URLを直接入力した場合、最小化した解析用ウィンドウでそのページを開き、読み取り後に閉じます。閲覧中のウィンドウにタブを追加せず、解析用ウィンドウにはフォーカスを移しません。画像の取得時には、画像が置かれたサイトへブラウザーから通常のリクエストを送ります。収集結果と準備した画像は保存せず、サイドパネルを閉じると破棄します。出典ページの設定だけをブラウザー内に保存します。PDF・画像・動画・ZIPは利用者が保存したファイルだけが残ります。

画像取得では、元ページと別の場所にあるローカルホストやプライベートIPをURLの段階で拒否します。公開ホスト名の画像はChromeにも公開ネットワーク向けの取得として指定し、名前解決や転送後にローカル宛てになる接続を制限します。元ページとURLの方式・ホスト名・ポートがすべて同じ画像にだけログイン情報を使う方針は維持します。この接続先制限は対応するChromeの機能に依存し、指定を認識しない古いChromeでは名前解決後の制限を保証しません。

### 開発環境

- Node.js 22〜26
- pnpm 12.5.1
- Chrome（Manifest V3対応）

pnpmの版は`package.json`と`pnpm-lock.yaml`に固定し、通常設定は`pnpm-workspace.yaml`で管理します。

```sh
pnpm install --frozen-lockfile
pnpm setup:hooks
pnpm verify:full
```

`pnpm build`で`dist/extension/`を作成し、Chromeの拡張機能管理画面から「パッケージ化されていない拡張機能を読み込む」で読み込みます。配布用ZIPは`pnpm package:extension`で作成します。Windowsでは`配布ZIPを作成.bat`、macOSでは`配布ZIPを作成.command`を開いても作成できます。これらは同じ作成処理を呼び出します。この処理は固定版のNode.jsとpnpmを確認してビルドし、ZIPの整合性と最上位の`manifest.json`を確認してから、`dist/Harvest-extension-<version>.zip`へ保存します。`dist/extension/`はソースと同期してGitにも登録します。ZIPを含むそれ以外の`dist/`生成物は登録しません。

#### ソースの構成

Chrome APIに依存しない画像の選択・順序、ZIPの組み立てとPDFの組み立ては `src/core/`、画面操作とブラウザーへの接続・画像形式の変換は `src/extension/` に置きます。

画像・動画の通信と時間制限は `response-fetch.ts`、取得内容の検査は `image-fetch.ts` と `media-fetch.ts`、PDF向けの画素処理は `image-decode.ts` と `pdf-image.ts`、画像形式への変換と再試行は `image-format.ts` と `mixed-export-preparation.ts`・`mixed-export-controller.ts` が担当します。JXLエンコーダーとApache-2.0のライセンスを配布物に同梱します。既存のPDF作成関数と画像準備関数の呼び出し方は維持します。担当の境界は [共通処理](src/core/README.md) と [画面・ブラウザー接続](src/extension/README.md) を参照してください。

ビルドはコンパイル済みモジュールをまとめて配置し、`check:build` で各モジュールの参照先が配布物内に存在することを確認します。

#### 開発・提出の案内

作業規約はAGENTS.md、参加手順はCONTRIBUTING.md、GitHubの運用設定はdocs/repository-setup.mdを参照してください。

Chrome ウェブストアへの提出には[提出手順](store/submit.md)と[掲載文](store/listing-ja.md)を使います。利用者データの取扱いは[プライバシーポリシー](docs/privacy-policy.md)に記載しています。

### ライセンス

GNU Affero General Public License version 3 only（AGPL-3.0-only）。詳細はLICENSEを参照してください。

ストアへ提出するZIPには、ライセンス全文、同じ版をビルドするためのソースコードと手順を含めます。拡張機能の「ライセンスとソース」から案内を開けます。

初期画面の中央には、`assets/brand/harvest-geometric-logo.svg`を表示します。ビルド時にこのロゴを拡張機能の`brand/`と同梱ソースへコピーします。
