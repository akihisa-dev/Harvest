# GitHubリポジトリの運用設定

Harvestの公開リポジトリは [akihisa-dev/Harvest](https://github.com/akihisa-dev/Harvest) です。次の設定を2026年10月22日に適用・確認しました。管理者は変更時にも実際の設定との一致を確認します。

## mainへの反映と履歴の保護

- 作業はmainで行い、確認済みの通常コミットを直接pushする。
- 有効なRuleset `Protect main history` を `refs/heads/main` に適用し、削除とforce pushを禁止する。回避を許可する利用者・チーム・アプリは設定しない。
- Pull Request経由、レビュー承認、会話の解決、線形履歴、署名済みcommitは必須にしない。通常pushはローカルの検証とGitフックを通す。

## セキュリティ

- 非公開の脆弱性報告（Private vulnerability reporting）を有効にする。[報告フォーム](https://github.com/akihisa-dev/Harvest/security/advisories/new)を受付窓口とし、所有者 [akihisa-dev](https://github.com/akihisa-dev) が一次対応を担当する。詳細は[SECURITY.md](../SECURITY.md)を参照する。
- 秘密情報の検出（Secret scanning）とpush protectionを有効にする。秘密情報が検出されたpushはGitHub側で拒否される場合がある。
- Dependabotによる依存パッケージの自動更新PRは使わない。定期更新用の設定ファイルを追加しない。
- GitHub Actionsはリポジトリ単位で無効にする。GitHub管理のDependabot Updatesを含め、自動実行されるワークフローを利用しない。

自動CI、CodeQL、Dependency Reviewはありません。push前の確認は`pnpm setup:hooks`で設定するリポジトリ専用Gitフックを使い、`pnpm verify:full`と`pnpm check:generated`を実行します。ユーザーのglobal Git設定は変更しません。運用理由と検証手順は[CONTRIBUTING.md](../CONTRIBUTING.md)に定めます。
