# #125 保存経路の整理と検証対応

着手基準はf6a5b407 / 0.43.11、実装基準はa34d19d6 / 0.44.0です。本整理は0.44.1で、開始時の推奨解決形式を再試行・完了表示まで固定する現行仕様を保持します。

## 削除と保持の参照根拠

applicationが生成するのはsplit sessionとmixed controllerだけです。旧pdf/image controller、単一形式session、pdf-image、image-archive-preparation、pdf-image-contractの6モジュールを撤去しました。必要な小さい表示状態型はsplit sessionへ移しました。buildはコンパイルされたextension JS全件を配布するため、ソース撤去後の生成物も同期します。

旧準備だけが呼ぶImageArchivePlan/createImageZipEntries、旧形式選別・復元関数、saveFilesIndividually、旧設定読書き関数、旧presentation分岐も撤去しました。テストだけのために製品へ旧関数を残しません。

mixedで実使用するfetchImage/decodeImage、媒体検証、preparation-workers、export-operation/lifecycle、PDF/ZIP生成、ImageArchiveLimitError、individualFilename、originalItemExtension、isMediaArchiveFormatを保持します。X取得候補統合で使うmergeMediaCandidatesも保持します。

形式は毎回画像/動画ともrecommendで開始し、パネル内の選択は再解析でも保持します。永続化は出典設定だけで、旧形式キーの読込・書込・削除はありません。権限・依存・通信・保存情報は追加しません。

## 旧条件 → 現行経路の対応

| 旧テスト | 保持する条件 | 移行先 |
| --- | --- | --- |
| export-session | 状態参照は再試行を変更しない、選択イベントで破棄 | 同ファイルのcreateSplitExportSession |
| export-session | 同一設定は成功分再利用、PDF↔PNG/JPG/JXLで準備参照解放 | split session + export-lifecycle |
| export-session | 重複開始、開始時選択順の固定、開始controllerが中止所有 | split session |
| export-session | 明示完了だけ成功、空対象、中止/clear/invalidate後の遅い完了拒否 | split session |
| export-ownership | 重複開始、dispose時/後の取得・保存・描画拒否、成功通知順 | createMixedExportController |
| image-export / image-export-budget | 全件準備前に保存しない、成功分保持、失敗のみ再試行、並行窓、容量・中止 | mixed controller + prepareMixedExport |
| managed-download | 順次完了確認、失敗・中止後に未保存だけ再試行 | mixed controller + managed download |
| original-media | 原本バイト、媒体種別・MIME不一致、GIF/MP4破損、誤拡張子防止 | mixed controller + 共通媒体検証 |
| jpeg-validity | 破損JPEGをPDF/画像保存しない、有効なJPEG保持 | mixed controller + fetchImage/decodeImage |
| pdf-image / preparation-contracts | 画像寸法・画素/取得容量・timeout・中止・メモリ解放、先頭遅延の有界取得 | fetchImage/decodeImage + prepareMixedExport |
| image-archive | 保持済み容量、最終ZIP容量・名前・形式照合、失敗再試行と中止 | mixed preparation + core出力検証 |
| svg-limits | SVGの過大寸法拒否 | fetchImage/decodeImage |
| export-structure / app-ui | 毎回両形式recommend、旧キーに読込/書込/削除なし、出典だけ永続化、再解析で形式保持 | split preferences/session + 実UI |

旧経路固有の媒体自動選択・旧形式キーの復元は、現行仕様に反するため復活させません。共通処理の安全性assertは保持します。テストの成功件数だけを削減指標にしません。

## 検証と境界修正

65,536項目の取得前エラーでpending参照が残る差は、0.44.0で共有storedZipEntryLimitとmixed先頭guardへ修正済みです。fetch/downloadが開始されないこと、pending解放、選択縮小後の新規取得はmixed-export-entry-limit、original/recommend条件はmixed-export-count-limitで確認します。

旧PDFの先着デコードという内部順序は現行mixedの入力順デコードへ対応し、未消費取得上限・逐次変換・出力順のassertを保持します。旧媒体自動選別・旧形式復元は現行仕様に反するため復活させません。テスト件数の削減を成功基準にせず、上表の安全条件を現行経路で検証します。

本体mainで `pnpm verify:full` が成功しました（通常472件、Chrome116件、fail/skip 0）。build・typecheck・architecture・manifest・build output・version検査も成功しました。実UIの保存/中止/再試行/設定/選択順と毎回recommend開始の回帰を含みます。

削除6モジュールはdist実行JSと同梱sourceの双方で不在です。src/tests/scripts/実行JSから旧入口・関数参照は消えています。再build前後の全配布ファイルSHA256集合は一致し、`git diff --check`も成功しました。dotのproduction/15テスト差分再レビューで追加指摘なし。commit後の生成物検査とremote/Issue状態は対応コメントに記録します。
