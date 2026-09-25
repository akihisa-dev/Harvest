# GitHubリポジトリの運用設定

Harvestの公開リポジトリは [akihisa-dev/Harvest](https://github.com/akihisa-dev/Harvest) です。管理者は次の設定を確認します。

## 保護とレビュー

- mainのRulesetで直接push、force push、削除を禁止し、Pull Request経由を必須にする。
- 会話の解決、線形履歴、署名済みcommitを必須にする。
- 複数のレビュー担当者がいる場合は1件以上の承認を必須にする。
- 管理者の例外を常用せず、緊急例外は理由を記録する。

## セキュリティ

- Private vulnerability reporting、Dependabot alertsとsecurity updates、Secret scanningとpush protectionを有効にする。
- GitHub Actionsは使わない。公開先の設定でActionsも無効にする。
- 公開前に脆弱性報告の連絡経路と対応担当を確定する。

自動CI、CodeQL、Dependency Reviewはありません。push前の確認は`pnpm setup:hooks`で設定するリポジトリ専用Gitフックを使います。ユーザーのglobal Git設定は変更しません。
