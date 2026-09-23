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

Git hookは`pre-commit`でstage済み差分の空白エラーと3つのversion一致・同一commit登録を確認し、`pre-push`で`pnpm verify:full`を実行します。新しいcloneでhookを有効にするには`pnpm setup:hooks`を実行してください。GitHub Actionsは使いません。release前は`pnpm verify:release`を実行します。

Chrome権限や対象サイトを広げる場合は必要な操作を説明してください。利用者情報を扱う場合は取得内容、保存先、保持期間、削除方法を文書化します。依存追加前に必要性、保守状況、脆弱性、ライセンスを確認し、版を固定してlockfileを更新します。
