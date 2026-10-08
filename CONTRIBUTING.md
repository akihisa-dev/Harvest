# 開発への参加

1. 変更の目的と利用者への影響を書き、独立した目的ごとに作業とcommitを分けます。作業はmainで行い、新しいブランチは作成しません。別作業との重複回避を理由にブランチへ分離することも禁止します。
2. 変更・必要な文書・生成物を揃え、commit前に変更リスクに応じて`pnpm verify`または`pnpm verify:full`のどちらか一つを実行します。成功した同一HEAD・同一条件の検証結果は再利用し、両方を続けて実行しません。
3. 通常の実装・修正・Issue対応ではversionを更新しません。明示されたバージョン更新時に、未反映のコミットを古い順に読み、各区分を順次加算して専用コミットにまとめます。正式版1.0.0を起点とする判断・同期規則は[AGENTS.mdのバージョン管理](AGENTS.md#バージョン管理)を参照してください。`pnpm version:next -- patch minor patch`などで次の候補を表示できます（ファイルは自動変更しません）。
4. バージョン更新時は`package.json`、`manifest.template.json`、生成済み`dist/extension/manifest.json`の同じversionを専用コミットに含めます。ソース変更で生成物が変わる場合は`dist/extension/`を`pnpm build`で更新し、同じcommitに含めます。`dist/extension/`以外の`dist/`生成物はcommitしません。
5. stageするpathを明示し、`git add .`と`git add -A`は使いません。秘密情報、無関係な変更を含めません。
6. レビューの指摘を解決してから取り込みます。

## 開発環境と依存関係

pnpmは`package.json`の`packageManager`と`pnpm-lock.yaml`で12.5.1に固定します。通常設定は`pnpm-workspace.yaml`に置き、`.npmrc`はregistry/authentication設定が必要な場合だけ使います。pnpmの版を変えるときは、`package.json`、lockfile、`scripts/check-runtime.mjs`を同じ変更で揃えます。依存導入では`pnpm install --frozen-lockfile`を使います。

## コミットとタグ

通常のcommit件名は`<type>[!]: <日本語の説明>`とし、番号・採番区分・将来の更新予定を記載しません。バージョン更新専用コミットは`chore: <更新後のversion> <日本語の説明>`とし、本文に加算前の版、反映範囲の開始・終了コミットID、各区分を記録します。更新済みの範囲と専用コミット自身を次回に再加算しません。typeは`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`から選びます。複数ファイル、version更新、運用変更を含むcommitの本文には`scope:`、`目的:`、`内容:`、`確認:`、`影響:`を記載します。

通常のcommitではGit tagを作りません。tagまたはreleaseは明示依頼がある場合だけ行い、実施前に`pnpm verify:release`を通します。tagはpackage versionと一致する未使用の`v<version>`を対象commitへ注釈付きで作成します。commit後はcommit IDと残存差分を確認します。

## Gitフック

Git hookは`pre-commit`でstage済み差分の空白エラーと3つのversion一致と、番号更新時の同一commit登録を確認し、`pre-push`で`pnpm verify:full`を実行します。新しいcloneでhookを有効にするには`pnpm setup:hooks`を実行してください。`pnpm verify`などの通常確認も、hook未設定または別の場所を指している場合は`pnpm setup:hooks`の実行方法を案内して停止します。GitHub Actionsは使いません。release前は`pnpm verify:release`を実行します。

## ビルド処理の構成

`src/extension/`は実行場所と責務ごとのサブディレクトリを持ち、配布物の`app/`にも同じ階層を保ちます。パネルとバックグラウンドの入口は従来どおり`app/index.js`と`background.js`です。同梱ライブラリは`app/vendor/`へ配置し、コーデックからの参照をビルド時に解決します。`check:build`はimportだけでなく`new URL(..., import.meta.url)`によるWorker等の参照先も確認します。

`pnpm check:architecture`は依存方向・実行時循環・ページ注入関数の実行時import・coreとWorkerの型環境を検査します。通常の`verify`に含まれるため、新しいモジュールも同じ境界を守る必要があります。動的importの参照先も文字列リテラルで指定し、変数経由で依存検査をすり抜けないようにします。詳細は[src/extension/README.md](src/extension/README.md)を参照してください。Nodeで生成済みJavaScriptを検証する際の形式推測をなくすため、packageのモジュール形式は`type: module`で明示しています。

[scripts/build.mjs](scripts/build.mjs) はコマンドの入口です。[build/pipeline.mjs](scripts/build/pipeline.mjs) がコンパイルから配布までの順序を、[build/runtime.mjs](scripts/build/runtime.mjs) が実行コード・ページ注入用スクリプト・同梱ライブラリの配置を担当します。これらのモジュールを読み込むだけではビルドを開始しません。

[build/artifact-plan.mjs](scripts/build/artifact-plan.mjs) は画面・画像と対応ソースの配置先を定義し、生成と `check:build` が同じ定義を参照します。`scripts/` と `tests/` の下に追加する補助モジュールも階層を保って収録し、検査では正本との内容一致を確認します。ソースと生成コードの依存検査は [lib/module-references.mjs](scripts/lib/module-references.mjs) の構文解析を共用し、WorkerへのURL参照と実行時importを区別します。

アプリアイコンは`assets/brand/harvest-geometric-logo.svg`を正本とし、`pnpm icons:generate`で濃いグレーの角丸背景と白いロゴを組み合わせます。Chromeと既存の開発用Playwrightを使い、`assets/icons/`の16/32/48/128pxと`assets/brand/harvest-logo-master.png`の1024px画像を生成します。更新後は通常のビルドで配布物へ反映します。紹介画像のアイコンも更新する場合は、macOSで`swift store/generate-screenshots.swift --promo-only`を実行します。

[build/output-transaction.mjs](scripts/build/output-transaction.mjs) は一意の一時フォルダー、既存配布物の退避、完成した配布物への置換と失敗時の復元を管理します。準備が失敗した場合は既存配布物を保持し、置換が失敗した場合は元へ戻します。復元も失敗した場合は退避先を残してエラーに表示します。失敗時の復元は一時フォルダーを使った自動テストで確認します。

## 同梱ライブラリ

JXL出力には`@jsquash/jxl` 1.3.0を使用し、同梱される`wasm-feature-detect` 1.9.0とともにApache-2.0で配布します。ビルドは単一スレッド用のエンコーダーとWebAssemblyだけを拡張機能へ含め、画面操作と分けたワーカー内で明示的に初期化します。実行時に外部からコードを取得しません。JXLの追加分は非圧縮で約1.4 MBです。両ライブラリのライセンスは拡張機能内の「ライセンスとソース」画面から確認できます。

WebMからMP4への変換には`mediabunny` 1.61.0（MPL-2.0）を完全固定で使用します。ブラウザー標準のWebCodecsで映像・音声を変換し、コンテナー解析とMP4組み立てを同ライブラリが担当します。実行時の追加依存や外部コード取得はなく、単一のブラウザー用バンドル（約676 KiB）とライセンスを同梱します。型定義用の推移依存はlockfileに固定し、配布実行コードには含めません。Mediabunnyのグローバル型とTypeScriptのDOM型の競合を避けるため、`vendor-modules.d.ts`に使用するAPIだけの境界を置き、型検査全体は省略しません。

`scripts/mediabunny-build.mjs`は固定版bundleの映像変換iteratorだけを補正します。1.61.0はWebMの表示時間が不明なフレームを長さ0で返し、Conversionがそのフレームを除外するためです。`src/core/video-sample-timing.ts`は既知の長さと表示時刻を維持し、長さ0だけを次のフレームの表示時刻、末尾ではコンテナーの終端から補います。FPSを仮定せず、音声の変換経路は変更しません。終端が確認できない場合は欠落した動画を成功扱いせず、変換失敗として返します。先読みは1フレームに限り、完了・中止・失敗で解放します。

上流bundleの補正対象が一意に見つからない場合はビルドを停止します。依存を更新する際はこの補正の必要性と位置を再確認してください。MediabunnyのMPL-2.0ライセンスは維持し、補正の定義とヘルパーを配布ソースへ含めます。`tests/webm-tail.browser.mjs`でDefaultDurationの有無、VFR、Opus音声を含む小さいfixtureを実拡張機能のMP4・recommend保存で確認します。

## 権限と利用者情報

Chrome権限や対象サイトを広げる場合は必要な操作を説明してください。利用者情報を扱う場合は取得内容、保存先、保持期間、削除方法を文書化します。依存追加前に必要性、保守状況、脆弱性、ライセンスを確認し、版を固定してlockfileを更新します。

## push前のローカル検証

変更はpush前に開発者の環境で必要な検証を完了し、失敗を解消してから共有します。通常は`pnpm verify:full`を実行します。commit前に変更リスクに応じて`pnpm verify`を選んだ場合も、push前には画面の確認を含む`pnpm verify:full`を通します。設定済みの`pre-push`フックでも同じ確認を実行します。

GitHub Actionsを導入していないのは意図的な開発方針です。検証失敗をpush後に通知して修正するのではなく、push前に解消し、GitHub側で同じ検証を重複実行する運用は現時点では採用しません。GitHub Actionsが必要になる運用上の理由が生じた場合は、その時点で再検討します。

`pnpm verify:ci`は`pnpm verify:full`に加えて、生成物がcommit済みの内容と一致することを確認するコマンドです。名称はGitHub Actionsの利用を意味せず、commit後にローカルで実行できます。

## 画面の自動確認

`pnpm verify:full` は通常の検証に続けて、`pnpm test:ui` で実際のChrome上の表示と操作を確認します。Chromeが必要です。ブラウザーを起動できない場合は検証失敗として扱い、画面の確認を省略して成功とはしません。利用中のChromeのプロファイルや開いているタブには接続せず、一時的なテスト専用環境を使用します。

画面検証には開発用のPlaywright 1.62.1（Apache-2.0）を完全な版で固定して使用します。導入目的は、CSSの文字列チェックでは検出できない重なり・見切れ・スクロール位置の誤りを実際の表示寸法と操作で検出することです。配布する拡張機能の実行コードには含めません。

拡張機能のHTML・CSS・JavaScriptを読み込み、Chromeから取得するページ情報だけをテスト用の値に置き換えます。外部サイトの読み込みや実際の利用者データは使用しません。

画面テストのブラウザー、一時プロファイル、ローカルサーバーは [tests/support/browser.mjs](tests/support/browser.mjs) の関数へテストのコンテキスト `t` を渡して作成します。[resources.mjs](tests/support/resources.mjs) が取得の逆順で解放するため、準備途中の失敗でも後片付けが実行され、解放の一つが失敗しても残りを処理します。テストごとの画面操作と期待値は各テストに置きます。

配布物をHTTPで読み込むテストは [extension-files.mjs](tests/support/extension-files.mjs) で配布フォルダー内のファイルを配信します。`pnpm test` と `pnpm test:ui` はビルド済みの内容を検証するため、ソースを変更した後は先に `pnpm build` を実行します。`pnpm verify:full` はこの順序を含めて実行します。

画面の変更では、空の結果、大量の画像グループ、長い状態文、日本語・英語と複数の画面寸法を確認します。320/400px幅と300/400px高さの組合せ、360×800px、700/768×300pxでも、明暗・PDF/recommend・出典設定を切り替え、上下の領域の大きさ、操作ボタンの表示範囲、グループ領域だけのスクロールと最後のボタンへの到達を守ります。失敗した場合は一時フォルダーに画像を保存します。失敗を消すために期待値を緩めず、表示の不具合を修正してください。

状態文が長い場合は上部の表示を最大2行（低い画面では1行）に収め、ボタンが押し出されないようにします。メッセージの全文はDOMと読み上げ向けの通知に保持し、マウスポインターを重ねても確認できます。
