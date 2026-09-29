# 開発への参加

1. 変更の目的と利用者への影響を書き、独立した目的ごとに作業とcommitを分けます。指定のないbranchは自動で作成しません。
2. 変更・必要な文書・生成物・versionを揃え、commit前に変更リスクに応じて`pnpm verify`または`pnpm verify:full`のどちらか一つを実行します。成功した同一HEAD・同一条件の検証結果は再利用し、両方を続けて実行しません。
3. commitごとにversionをSemVerに従って更新します。`pnpm version:next -- patch`などで次の候補を表示できます（ファイルは自動変更しません）。利用者向けの後方互換性のない変更はMAJOR、互換性を保った機能追加はMINOR、不具合修正や文書・test・build・保守変更はPATCHです。commit typeとversion区分は独立して決めます。
4. `package.json`、`manifest.template.json`、生成済み`dist/extension/manifest.json`の同じversionを同一commitに含めます。ソース変更で生成物が変わる場合は`dist/extension/`を`pnpm build`で更新し、同じcommitに含めます。`dist/extension/`以外の`dist/`生成物はcommitしません。
5. stageするpathを明示し、`git add .`と`git add -A`は使いません。秘密情報、無関係な変更を含めません。
6. レビューの指摘を解決してから取り込みます。

pnpmは`package.json`の`packageManager`と`pnpm-lock.yaml`で12.5.1に固定します。通常設定は`pnpm-workspace.yaml`に置き、`.npmrc`はregistry/authentication設定が必要な場合だけ使います。pnpmの版を変えるときは、`package.json`、lockfile、`scripts/check-runtime.mjs`を同じ変更で揃えます。依存導入では`pnpm install --frozen-lockfile`を使います。

commit件名は`<type>[!]: <version> <日本語の説明>`です。typeは`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`から選びます。複数ファイル、version更新、運用変更を含むcommitの本文には`scope:`、`目的:`、`内容:`、`確認:`、`影響:`を記載します。

通常のcommitではGit tagを作りません。tagまたはreleaseは明示依頼がある場合だけ行い、実施前に`pnpm verify:release`を通します。tagはpackage versionと一致する未使用の`v<version>`を対象commitへ注釈付きで作成します。commit後はcommit IDと残存差分を確認します。

Git hookは`pre-commit`でstage済み差分の空白エラーと3つのversion一致・同一commit登録を確認し、`pre-push`で`pnpm verify:full`を実行します。新しいcloneでhookを有効にするには`pnpm setup:hooks`を実行してください。`pnpm verify`などの通常確認も、hook未設定または別の場所を指している場合は`pnpm setup:hooks`の実行方法を案内して停止します。GitHub Actionsは使いません。release前は`pnpm verify:release`を実行します。

JXL出力には`@jsquash/jxl` 1.3.0を使用し、同梱される`wasm-feature-detect` 1.9.0とともにApache-2.0で配布します。ビルドはエンコーダーとWebAssemblyを拡張機能へ含め、実行時に外部からコードを取得しません。今回の追加分は非圧縮で約6.4 MBです。両ライブラリのライセンスは拡張機能内の「ライセンスとソース」画面から確認できます。

Chrome権限や対象サイトを広げる場合は必要な操作を説明してください。利用者情報を扱う場合は取得内容、保存先、保持期間、削除方法を文書化します。依存追加前に必要性、保守状況、脆弱性、ライセンスを確認し、版を固定してlockfileを更新します。

## push前のローカル検証

変更はpush前に開発者の環境で必要な検証を完了し、失敗を解消してから共有します。通常は`pnpm verify:full`を実行します。commit前に変更リスクに応じて`pnpm verify`を選んだ場合も、push前には画面の確認を含む`pnpm verify:full`を通します。設定済みの`pre-push`フックでも同じ確認を実行します。

GitHub Actionsを導入していないのは意図的な開発方針です。検証失敗をpush後に通知して修正するのではなく、push前に解消し、GitHub側で同じ検証を重複実行する運用は現時点では採用しません。GitHub Actionsが必要になる運用上の理由が生じた場合は、その時点で再検討します。

`pnpm verify:ci`は`pnpm verify:full`に加えて、生成物がcommit済みの内容と一致することを確認するコマンドです。名称はGitHub Actionsの利用を意味せず、commit後にローカルで実行できます。

## 画面の自動確認

`pnpm verify:full` は通常の検証に続けて、`pnpm test:ui` で実際のChrome上の表示と操作を確認します。Chromeが必要です。ブラウザーを起動できない場合は検証失敗として扱い、画面の確認を省略して成功とはしません。利用中のChromeのプロファイルや開いているタブには接続せず、一時的なテスト専用環境を使用します。

画面検証には開発用のPlaywright 1.62.1（Apache-2.0）を完全な版で固定して使用します。導入目的は、CSSの文字列チェックでは検出できない重なり・見切れ・スクロール位置の誤りを実際の表示寸法と操作で検出することです。配布する拡張機能の実行コードには含めません。

拡張機能のHTML・CSS・JavaScriptを読み込み、Chromeから取得するページ情報だけをテスト用の値に置き換えます。外部サイトの読み込みや実際の利用者データは使用しません。

画面の変更では、空の結果、大量の画像グループ、長い状態文、日本語・英語と複数の画面寸法を確認します。上下の領域の大きさ、操作ボタンの表示範囲、グループ領域だけのスクロールと最後のボタンへの到達を守ります。失敗した場合は一時フォルダーに画像を保存します。失敗を消すために期待値を緩めず、表示の不具合を修正してください。

状態文が長い場合は上部の表示を最大2行（低い画面では1行）に収め、ボタンが押し出されないようにします。メッセージの全文はDOMと読み上げ向けの通知に保持し、マウスポインターを重ねても確認できます。
