# Harvest リポジトリ指示

## 製品の範囲

- 製品機能、画面、対象サイト、保存情報、外部送信、権限、公開先、配布方法は、明示依頼がない限り追加しません。

## Chrome拡張機能と安全性

- Manifest V3を使います。Chrome APIに依存しない処理はsrc/core/、Chrome APIとブラウザー境界はsrc/extension/へ分けます。
- manifestの正本はmanifest.template.jsonです。生成物dist/extension/を直接編集しません。
- 必要な機能が決まるまでpermissions、optional_permissions、host_permissionsを追加しません。追加時は対象、取得・変更する情報、利用者への影響を説明して確認します。
- 理由のない通信、解析、広告、リモートコード、依存パッケージ、保存情報を追加しません。依存は完全な版で固定し、導入理由とライセンスを確認します。
- pnpmは`package.json`とlockfileに完全な版で固定します。通常設定は`pnpm-workspace.yaml`へ置き、`.npmrc`はregistry/authentication設定に限ります。
- 利用者データを扱う変更では保存場所、保持期間、削除、移行、外部送信、失敗時の挙動を明確にし、既存データを黙って削除・上書きしません。
- 文字列をHTMLとして実行せず、安全なDOM APIを使います。拡張機能ページへ外部スクリプトを読み込みません。

## 検証とGit

- 作業はmainで行い、新しいブランチを作成しません。別作業との重複回避を理由にブランチへ分離することも禁止します。
- 基本確認は`pnpm verify:full`です。実際のChromeによる画面テストを含みます。検証コマンドの使い分けとGitフックの設定は[CONTRIBUTING.md](CONTRIBUTING.md)に定めます。
- セキュリティ、権限、データ処理、ビルド、GitHub運用を変える場合、関連文書も更新します。
- push前の検証は`pnpm verify:full`、タグ・リリース前の検証は`pnpm verify:release`です。GitHub Actionsによるpush後の同一検証の重複実行は採用していません。理由はCONTRIBUTING.mdに定めます。

## バージョン管理

- Harvestは1.0.0を正式版の起点とし、`MAJOR.MINOR.PATCH`の3つの数値で管理します。versionの正本はrootの`package.json`です。
- バージョン更新時は`package.json`、編集用の`manifest.template.json`、生成済み`dist/extension/manifest.json`の同じversionを専用コミットへ含めます。ソースや同梱文書の変更で生成物が変わる場合は、buildで`dist/extension/`を更新して同じcommitに含めます。
- stage済みのversion一致と、番号更新時の同一commitへの登録は`pnpm version:check-staged`で確認します。更新候補は`pnpm version:next -- patch minor patch`などで表示できます。
