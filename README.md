# Harvest

[English](#english) | [日本語](#日本語)

## English

Harvest is a Chrome extension that collects images, GIFs, and videos from a page and saves selected items as PDF, JPG, PNG, JXL, MP4, or GIF. Videos and single images are downloaded directly; multiple images are packaged in a ZIP. You can analyze the current page or enter a URL, browse groups, select individual items, and change their order. Collection is limited to the page you specify.

### How to use

1. Open a page containing images in Chrome and click the Harvest icon to open the side panel.
2. Analyze the current page, or enter a URL and click **Analyze**. You can drop a URL anywhere in the side panel, even when another URL or analysis results are already present. A full-panel drop guide appears while dragging a URL. An entered or dropped URL takes precedence over the current page.
3. After analysis, the image list appears with an initial group selected for saving. Loaded image and GIF thumbnails show their resolution above the filename. Click an image to toggle selection; drag it or use the keyboard to reorder it. Videos, GIFs, and still images are grouped by format, preserving groupings such as image series. Each group's eye button controls visibility, and its checkbox controls selection for saving. Choose a format and click **Save**. PDF produces one document; videos are saved as individual MP4 files. A single image or GIF is saved directly, while multiple images or GIFs become numbered files in a ZIP.

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

Drag a zoomed image to pan. Group labels show counts, and image labels show positions in the full collection. Save controls show the selected format, progress while saving, and a retry action after failure; completion shows the saved count. Click the save button again during saving to cancel while retaining the progress display. Once requests and conversion stop, prepared images are discarded and saving becomes available again. Incomplete PDFs and ZIPs are not saved; the same selection can be saved again.

The all-images eye and checkbox control visibility and save selection for the whole collection; group controls affect only their own group. A crossed-out eye indicates hidden images. When there are many controls, the right column scrolls independently of the image list or viewer.

Saved filenames use the page title. Unsupported filename symbols and control characters are replaced, and leading or trailing dots and whitespace are removed. Long titles are shortened without splitting an emoji; an empty result uses the default image name. The same name appears in the save label and PDF source page. Multiple MP4 files keep their sequence numbers.

#### PDF source page

**Add a source page at the end** applies only to PDF. When enabled, it appends one page containing the **Source** heading, saved PDF filename, and source page URL. Text, including Japanese and emoji, can be displayed, selected, and copied. The source page also appears at the end of the image list and viewer thumbnails and can be previewed in the viewer. Other formats hide this setting and omit the source page. Returning to PDF restores the saved setting. This setting and the export format are stored in the browser and retained the next time the panel opens. Page URLs and collected results are not stored as preferences.

#### PDF quality and retries

Each image becomes a PDF page matching its original dimensions, always at the highest available quality. Supported JPEGs are embedded unchanged after structural and decoding checks; other images use lossless compression of browser-decoded pixels. Transparency is composited over white. Image and page dimensions are preserved, without upscaling or invented detail. Detail already lost through source compression, or color changes introduced by browser decoding, cannot be restored.

This quality can increase PDF size and memory use. Up to three images are fetched concurrently, while decoding and conversion run one at a time. Each fetch, including its response body, times out after 20 seconds. Large pixel operations run in smaller chunks, and cancelling PDF creation also stops image compression. Image and drawing memory is released after conversion or cancellation. If an image cannot be fetched, saving stops and its number, filename, and failure reason are shown.

Retry fetches only failed images and saves the PDF once all are ready. Changing selection or order makes the next save prepare the selection again from the beginning. Chrome internal pages and pages Chrome cannot open are unsupported.

#### Saving GIFs and videos

Video thumbnails show the file size before conversion, or **Size unknown** when the server does not provide it. Successful reanalysis refreshes size information even for an unchanged video URL. This is not the size of the converted video or ZIP.

Alongside PDF, JPG, PNG, and JXL for still images, MP4 and GIF are offered when the analysis finds them. GIF detection recognizes a `.gif` URL suffix or `format=gif`, `fmt=gif`, or `fm=gif`, ignoring case in parameter names and values. Format parameters take precedence over the extension, and actual data is also checked when saving. MP4 saves each selected video separately, using the page title for one file and the title plus sequence numbers for multiple files. A single GIF is saved directly; multiple GIFs become numbered files in one ZIP.

MP4 files are saved one at a time through Chrome's download manager. Success is shown only after every download completes, including any destination selection or Chrome confirmation. Refusal, failure, and cancellation are not treated as success. Only unsaved files are retried, retaining their original sequence numbers. Completed files are not undone. Existing files are not overwritten: Chrome chooses a non-conflicting filename.

Original MP4 and GIF data is preserved without conversion. WebM is converted to MP4 inside the browser. An item labeled “GIF” on X is saved as MP4 when its actual data is MP4; it is not converted to GIF. MP4 and GIF choices appear when their media types are found. Without still images, PDF, JPG, PNG, and JXL are hidden. Incompatible selected items are excluded from saving, with their count displayed.

For mixed collections, only the selected format's media type is saved, and the number of excluded selected items is shown. Video rows use the retrieved thumbnail or, if none is available, a video indicator.

Harvest reads MP4 and WebM URLs from video elements, and MP4 URLs from playback information in the page or data used to display X posts. WebM is still saved as MP4, with a conversion notice before saving. Conversion uses H.264 video and AAC audio while preserving resolution, frame timing, channel count, and sample rate. Recompression may change quality and file size. Unsupported video or audio stops saving with an explanation; tracks are not silently removed.

For X, Harvest chooses the highest bitrate among available MP4 candidates. After the initial page load, it waits for posts and video content and reads again, including playback information in expanded video views. A specified post URL limits collection to the matching post's body, images, and videos, excluding quotes, replies, and recommendations. Expanded views are read only when they can be matched to that post. Profile images are excluded. Display restrictions, incomplete loading, missing downloadable MP4 URLs, or data that cannot be saved as MP4 produce an explanation; profile images alone do not count as a successful analysis.

The bookmarks area of history (`/i/history`) and the older bookmarks page (`/i/bookmarks`) also wait for posts and retry reading, excluding profile images. Data attached to displayed posts supplements photos without image elements and multiple videos, without duplicating photos whose URL formats or display sizes differ. List views include quoted and reposted media. Video thumbnails are distinguished from videos, and quality variants of a video are merged. Harvest compares visible media with results per post and rereads incomplete posts once. Remaining gaps or scan limits produce an explanation and preserve previous results. All collected media groups are initially visible. Harvest does not automatically scroll or call additional APIs to fetch unloaded posts. URLs remain only in side-panel memory and are discarded when it closes.

Media cannot be saved if the page exposes no playback information or provides only segmented or live streams. No additional requests are made to private APIs. Videos and GIFs are fetched one at a time, with a 64 MiB file limit and 120-second fetch timeout. WebM conversion also runs one at a time, with a 64 MiB output limit and 120-second timeout. Downloads do not start if any file cannot be prepared; failed items can be retried or saving cancelled. Fetched and converted data exists only in panel and worker memory and is discarded on completion, cancellation during preparation, or panel closure. If MP4 saving fails or is cancelled after downloads begin, prepared data and completed item numbers remain in memory for retrying. They are discarded on completion, changes to results/selection/format, Clear, or panel closure.

Conversion workers terminate on success, failure, cancellation, or timeout. Conversion does not send data externally or persist it.

#### Saving JPG, PNG, and JXL

A single selected image is saved directly using the page title. Multiple images are numbered in their current order, such as `001.jpg`, and saved in one ZIP. JPG reuses suitable JPEGs without recompression; other images are converted at maximum quality, with transparency rendered white. PNG reuses original PNG data or converts losslessly while preserving transparency. JXL uses lossless encoding of decoded pixels, without further quality loss. Conversion and ZIP creation run in the browser. Only selected images are fetched, up to three concurrently, and converted one at a time.

Successfully prepared images remain in memory for retrying failed items. The total prepared size, including numbered filenames and metadata, is checked against ZIP limits: approximately 4 GiB and at most 65,535 images. Exceeding the limit stops remaining requests, discards prepared results, and displays the reason. Reduce the image count and save again. Clicking save again or closing the panel cancels active requests and ZIP creation; incomplete ZIPs are not saved.

Only the export format and PDF source-page preference persist; image data does not.

### Access and data

Installation requires access to ordinary HTTP/HTTPS websites. When you analyze a page, Harvest reads its title, URL, image/media URLs, and the data needed to create the selected files. An entered URL targets that page. The `sidePanel` permission displays Harvest beside the current page when its icon is clicked. JXL WebAssembly code is bundled, never fetched externally.

The `downloads` permission saves individual MP4 files and checks completion or interruption. Chrome presents this as permission to manage downloads. Harvest queries or cancels only download IDs it created, without reading other downloads or the full history. IDs and completion state stay in panel memory; history and file contents are not sent externally. Chrome and the user manage saved files and download history. Harvest does not delete existing history or saved files. Updating an existing installation may require permission approval again.

Collection, conversion, PDF creation, and ZIP creation run inside the browser, without an external collection server. The JXL encoder is bundled. Entered URLs open in a minimized analysis window that closes after reading, without adding a tab to your browsing window or moving focus to the analysis window. Fetching media sends ordinary browser requests to the hosting sites. Collected results and prepared images are not persisted and are discarded when the side panel closes. Only the source-page preference and export format are stored in the browser. Only files you save remain on disk.

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

Harvestは、Chromeで開いているページの画像・GIF・動画を集め、選択した項目をPDF、JPG、PNG、JXL、MP4、GIFで保存するChrome拡張機能です。動画と1枚だけの画像は直接ダウンロードし、複数画像はZIPにまとめます。現在のページの解析とURLの直接入力に対応し、画像のまとまりごとの表示、個別選択、順序の変更ができます。画像の収集対象は指定したページだけです。

### 使い方

1. Chromeで画像のあるページを開き、Harvestのアイコンを押してサイドパネルを開きます。
2. 表示中のページを解析するか、URLを入力して「解析」を押します。URLは入力済みのURLや解析結果があってもサイドパネル全体へドロップできます。URLをドラッグすると画面全体にドロップの案内が表示されます。URLを入力・ドロップした場合は、そのURLを解析します。
3. 解析後は画像一覧が表示され、初期選択したまとまりの画像が保存対象になります。サムネイルでは読み込めた画像・GIFの解像度をファイル名の上へ表示します。画像をクリックして選択を切り替え、ドラッグまたはキーボード操作で順番を変更します。動画・GIF・静止画像は形式ごとの別グループに分け、静止画像のシリーズなどのまとまりも保持します。まとまりごとの目のボタンで表示を、チェックボックスで保存対象を切り替えます。保存形式を選び、「保存」を押します。PDFは1つのPDF、動画は1件ずつMP4として保存します。画像・GIFは1枚なら直接保存し、複数枚なら連番ファイルを含むZIPとして保存します。

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

Xのブックマークでは、Xが受信した一覧の投稿IDとメディア情報をページ内のメモリに保持し、画面外になった投稿も解析します。受信した一覧順に並べ、画面だけから取得した候補を補います。未読み込みのページは自動取得しません。解析時には、現在の画面に結び付いた一覧とX内部の投稿情報からも補完します。受信監視が始まる前から開いているページでも、この対応を確認できればXの再読み込みは不要です。対応を確認できない場合は、取得済みの結果を残して案内を表示します。

再解析に失敗した場合は、それまでの収集結果、選択、順序を保持します。新しい解析が正常に完了した時点で結果を置き換えます。読み込みが完了しないページや、解析中に閉じられた・移動したタブはエラーとして扱い、再度解析できます。

#### 画面表示とビュアー

選択・表示の切り替えや画像の並べ替えは、短い滑らかな動きでつながります。端末で動きを減らす設定を有効にした場合は、アニメーションを省きます。

操作欄の明暗はブラウザーまたはシステムの設定に自動で従い、設定を変更すると開いているパネルにも反映されます。操作画面と「ライセンスとソース」の表示言語はChromeの表示言語に従い、日本語なら日本語、それ以外は英語で表示します。操作項目、読み上げ用の説明、既知のエラーは選択された言語で表示し、未知のエラーには翻訳済みの一般的な説明を使います。言語設定の変更後は必要に応じてChromeを再起動してパネルを開き直してください。画像、ページの名前、ファイル名、PDFの色は変更しません。出典ページの見出しは「Source」です。独自の言語切り替えボタンはありません。

操作欄はモノクロですが、画像と保存したPDFは元の色を保ちます。解析後はビュアーではなく画像一覧を初期表示します。URL入力・解析・クリア・収集は上部に、保存形式と保存・出典ページの設定・ビュアー切り替え・画像グループの操作は画像の右側に並びます。「ビュアーモード」で保存対象の画像を確認し、「画像一覧に戻る」で一覧へ切り替えられます。ビュアーではサムネイルや前後ボタンで画像を選び、ホイールまたは拡大縮小ボタンで拡大・縮小できます。

拡大中は画像をドラッグして表示位置を動かせます。グループ名には枚数、各画像には収集結果全体での順番を表示します。保存ボタンには選択した形式、保存中には進捗、失敗時には再試行の操作、保存完了時には保存件数を表示します。保存中に同じボタンをもう一度押すと、進捗表示を保ったまま保存を中止できます。通信と変換の終了後に準備済みの画像を破棄し、通常の保存可能状態へ戻ります。不完全なPDF・ZIPは保存せず、同じ対象を再度保存できます。

全画像の目とチェックボックスで、収集結果全体の表示・保存対象を切り替えます。各グループの目とチェックボックスでは、そのグループだけを切り替えられます。斜線の付いた目は非表示を示します。操作項目が多いときは右側の操作欄をスクロールでき、画像一覧やビュアーとは別に動かせます。

保存名にはページタイトルを使います。ファイル名に使えない記号と制御文字を置き換え、先頭・末尾のドットと空白を取り除きます。長いタイトルは絵文字を途中で切らずに短くし、名前が空になる場合は既定の画像名を使います。保存欄とPDF出典ページにも同じ名前を表示します。複数MP4の連番は維持します。

#### PDFの出典ページ

「末尾に出典ページを追加」はPDFだけの機能です。PDF選択時にオンにすると、画像ページの後に「Source」の見出し、保存したPDFのファイル名、画像を見つけた元ページのURLを1ページに載せます。日本語や絵文字を含む文字も表示でき、選択・コピーできます。オンの場合は画像一覧とビュアーのサムネイルにもSourceページを末尾に表示し、ビュアーで内容を確認できます。PDF以外を選ぶとこの設定は隠れ、出典ページは追加しません。PDFへ戻すと、保存していた設定が再び表示されます。この設定と保存形式はブラウザー内に保存され、次回パネルを開いても維持されます。ページURLや画像の収集結果は設定として保存しません。

#### PDFの画質と再試行

PDFは画像の元の大きさに合わせて1枚ずつページを作成します。常に最高画質で保存します。対応するJPEGは構造と読み取り結果を確認したうえで元データをそのまま埋め込み、それ以外はブラウザーで読み取った画素を劣化しない圧縮で保存します。透明部分は白背景に合成します。画像やページの縦横サイズは変えず、拡大による細部の補完は行いません。元画像の圧縮で失われた細部や、ブラウザーの画像読み取り時の色変換までは復元できません。

最高画質ではPDFの容量と作成時のメモリ使用量が増える場合があります。画像は最大3件を並行して取得し、画素への展開と変換は1件ずつ行います。画像の取得は応答本文を含めて1件あたり20秒で時間切れになります。大きな画像の画素処理は小分けにし、PDF作成を中止した場合は画像の圧縮も中断します。変換後または中止後に画像と描画用のメモリを解放します。画像を取得できなかった場合は保存せず、該当画像の番号、名前、失敗理由を表示します。

「再試行」を押すと失敗した画像だけを取得し直し、すべて揃ってからPDFを保存します。選択や順序を変えると、次の保存では選択画像を最初から準備します。Chromeの内部ページや、Chromeで開けないページは対象外です。

#### GIF・動画の保存

動画のサムネイルには、変換前のファイルサイズを表示します。配信元からサイズ情報を取得できない場合は「サイズ不明」と表示します。再解析が成功したときは、同じ動画URLでもサイズ情報を取得し直します。変換後の動画やZIPのサイズとは異なります。

保存形式は静止画像向けのPDF・JPG・PNG・JXLに加えて、解析結果に応じてMP4・GIFを選べます。GIFはURL末尾の `.gif` または `format=gif`・`fmt=gif`・`fm=gif` から判定し、パラメーター名・値の大文字と小文字を区別しません。形式指定がある場合は拡張子より優先し、保存時には実際のデータ形式も検査します。MP4を選ぶと選択した動画を個別のMP4ファイルとして保存します。1件ならページ名、複数ならページ名に連番を付けます。GIFは1枚ならGIFファイルを直接保存し、複数枚なら連番ファイルを1つのZIPへまとめます。

MP4はChromeのダウンロード管理機能で1件ずつ保存し、全件の完了を確認してから「保存しました」と表示します。保存先の選択やChromeの確認が必要な場合は完了するまで待ちます。拒否・失敗・中止があった場合は成功扱いにせず、未保存分だけを元の連番で再試行できます。完了済みのファイルは取り消しません。同名の既存ファイルは上書きせず、Chromeが重複を避ける名前に変更します。

元がMP4またはGIFなら再変換せず、元のバイト列を保ちます。WebM動画はブラウザー内でMP4へ変換します。Xで「GIF」と表示されるものも、実体がMP4ならMP4として保存し、GIFへ変換しません。GIFまたは動画が見つかった解析結果では、該当するMP4・GIFの形式を選択肢に表示します。静止画像がない場合はPDF・JPG・PNG・JXLを表示せず、異なる種類のファイルは保存対象から除き、その件数を表示します。

静止画像とGIF・動画が混在する場合も、選択形式の種類だけを保存し、対象外となる選択中の項目数を表示します。動画一覧には取得できたサムネイル、なければ動画を示す印を表示します。

動画はページの動画要素からMP4・WebMのURLを、ページ内の再生情報やXの投稿表示に使われている情報からMP4のURLを取得します。WebMを含む場合も保存形式はMP4で、保存前に変換することを表示します。WebMは映像をH.264、音声をAACに変換し、解像度・フレーム間隔・音声のチャンネル数とサンプルレートを維持します。再圧縮による画質・音質の変化や容量の増減はあり得ます。変換できない映像・音声がある場合は、勝手に取り除かず理由を表示して保存を止めます。

Xは取得できるMP4候補の中から最も高いビットレートを選びます。Xの投稿は初期ロード完了後も投稿・動画の表示を待って解析し直し、動画の拡大表示にある再生情報も読み取ります。投稿URLを指定した場合はその投稿IDと一致する本文・画像・動画だけを対象とし、引用・返信・おすすめの投稿は含めません。拡大表示も指定投稿との対応を確認できる場合だけ読み取ります。プロフィール画像は保存対象から除外します。Xの表示制限、投稿の読み込み未完了、動画ページからMP4のURLを読み取れない場合や、取得したデータをMP4として保存できない場合は理由を表示し、プロフィール画像だけを解析の成功結果にしません。

履歴画面のブックマーク欄（`/i/history`）と従来のブックマーク画面（`/i/bookmarks`）でも投稿の表示を待って解析し直し、プロフィール画像を除外します。ページに表示された投稿に付随するデータから、画像要素になっていない写真や複数の動画も補います。同じ写真のURL形式・表示サイズの違いで補完分が重複しないようにします。Xの投稿写真は、一覧の縮小表示用URLから配信元のオリジナルサイズ（`name=orig`）を指定する保存用URLへ統一します。取得できない場合に縮小版へ黙って切り替えることはありません。一覧では引用と再投稿のメディアも対象です。動画のサムネイルと動画本体を区別し、同じ動画の画質違いは1件にまとめます。画面にあるメディアと取得結果を投稿ごとに照合し、不足がある投稿だけを1回読み直します。画面上の画像・動画URLを先に収集し、投稿データから補完します。補完が終わらない場合も取得できた画像・動画を表示し、一部を取得できていないことを案内します。何も取得できなかった場合やページが移動した場合は前の解析結果を残します。解析直後は取得したすべての種類のグループを表示します。未読み込みの投稿を取得するための自動スクロールや追加API通信は行いません。読み取ったURLは従来どおりサイドパネル内だけで保持し、閉じると破棄します。

ページが再生情報を公開していない場合や、分割配信・ライブ配信だけの場合は保存できません。非公開のAPIへの追加通信は行いません。動画・GIFの取得は1件ずつ行い、1ファイル64 MiB、取得120秒を上限にします。WebMの変換も1件ずつ行い、変換後64 MiB、変換120秒を上限とします。取得できないファイルがある場合はダウンロードを開始せず、失敗分の再試行または中止ができます。取得済みファイルと変換結果はパネルと変換用Workerのメモリだけに保持し、保存完了・準備中の中止・パネル終了で破棄します。MP4の保存開始後に失敗・中止した場合は再試行のために準備済みデータと完了済み番号をメモリに保持し、保存完了、解析結果・選択・形式の変更、クリア、パネル終了で破棄します。

変換完了・失敗・中止・時間切れのいずれでもWorkerを終了します。変換用の外部送信や永続保存は行いません。

#### JPG・PNG・JXLの保存

JPG・PNG・JXLを選ぶと、保存対象が1枚の場合はページ名を使った画像ファイルとして直接保存します。複数枚の場合は現在の並び順で `001.jpg` のような連番にし、1つのZIPへまとめて保存します。JPGは再利用できるJPEGを再圧縮せず、その他は最高品質で変換し、透明部分を白くします。PNGは元のPNGを再利用し、それ以外は透明部分を保って可逆保存します。JXLは画素から追加の画質劣化を加えない可逆形式で作成します。変換とZIP作成はブラウザー内で行います。選択した画像だけを最大3件並行して取得し、変換は1件ずつ行います。

成功した画像は失敗分の再試行までメモリに保持します。保存全体では、連番の名前や管理情報を含めてZIP形式の上限（約4 GiB、最大65,535画像）以内になるよう、準備済み画像の合計サイズを確認します。上限を超えると分かった時点で残る通信を止め、準備結果を破棄して理由を表示します。画像数を減らして保存し直してください。進行中の通信やZIP作成は保存ボタンを再度押すかパネルを閉じると中止し、不完全なZIPは保存しません。

保存形式とPDFの出典ページの設定だけを保存し、画像データは永続化しません。

### アクセスとデータ

導入時に、すべての通常のWebサイト（HTTP/HTTPS）へのアクセスを許可する必要があります。解析ボタンを押したときに、現在のページの名前とURL、画像・動画のURL、選択したファイルの作成に必要なデータを読み取るためです。URLを入力した場合は、そのURLのページを読み取ります。`sidePanel`権限は、アイコンを押したときに現在のページの横へHarvestを表示するために使います。JXL作成用のWebAssemblyコードは拡張機能に同梱し、外部から取得しません。

`downloads`権限はMP4の個別保存と完了・中断の確認に使用します。Chromeにはダウンロードを管理する権限として表示されます。Harvest自身が開始したダウンロードIDだけを照会・中止し、他のダウンロードや履歴全体は取得しません。IDと完了状態はパネル内のメモリで扱い、履歴やファイル内容を外部へ送りません。保存ファイルとChromeのダウンロード履歴はChrome・利用者が管理し、Harvestが既存の履歴や保存ファイルを削除することはありません。既存の拡張機能を更新すると権限の再承認を求められる場合があります。

収集、画像変換、PDF・ZIP作成はブラウザー内で行い、外部の収集サーバーへは送信しません。JXLエンコーダーは拡張機能に同梱します。URLを直接入力した場合、最小化した解析用ウィンドウでそのページを開き、読み取り後に閉じます。閲覧中のウィンドウにタブを追加せず、解析用ウィンドウにはフォーカスを移しません。画像の取得時には、画像が置かれたサイトへブラウザーから通常のリクエストを送ります。収集結果と準備した画像は保存せず、サイドパネルを閉じると破棄します。出典ページの設定と保存形式だけをブラウザー内に保存します。PDF・画像・動画・ZIPは利用者が保存したファイルだけが残ります。

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

画像・動画の通信と時間制限は `response-fetch.ts`、取得内容の検査は `image-fetch.ts` と `media-fetch.ts`、PDF向けの画素処理は `image-decode.ts` と `pdf-image.ts`、画像形式への変換と再試行は `image-format.ts` と `image-export-controller.ts` が担当します。JXLエンコーダーとApache-2.0のライセンスを配布物に同梱します。既存のPDF作成関数と画像準備関数の呼び出し方は維持します。担当の境界は [共通処理](src/core/README.md) と [画面・ブラウザー接続](src/extension/README.md) を参照してください。

ビルドはコンパイル済みモジュールをまとめて配置し、`check:build` で各モジュールの参照先が配布物内に存在することを確認します。

#### 開発・提出の案内

作業規約はAGENTS.md、参加手順はCONTRIBUTING.md、GitHubの運用設定はdocs/repository-setup.mdを参照してください。

Chrome ウェブストアへの提出には[提出手順](store/submit.md)と[掲載文](store/listing-ja.md)を使います。利用者データの取扱いは[プライバシーポリシー](docs/privacy-policy.md)に記載しています。

### ライセンス

GNU Affero General Public License version 3 only（AGPL-3.0-only）。詳細はLICENSEを参照してください。

ストアへ提出するZIPには、ライセンス全文、同じ版をビルドするためのソースコードと手順を含めます。拡張機能の「ライセンスとソース」から案内を開けます。

初期画面の中央には、`assets/brand/harvest-geometric-logo.svg`を表示します。ビルド時にこのロゴを拡張機能の`brand/`と同梱ソースへコピーします。
