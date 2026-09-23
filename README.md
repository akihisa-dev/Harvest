# Harvest

HarvestのChrome拡張機能を開発するリポジトリです。製品機能はまだ定義していないため、Manifest V3、最小のポップアップ、厳格なTypeScript設定、再現可能なビルドとCIを用意しています。

## 開発環境

- Node.js 22〜26
- pnpm 12.5.1
- Chrome（Manifest V3対応）

pnpmの版は`package.json`と`pnpm-lock.yaml`に固定し、通常設定は`pnpm-workspace.yaml`で管理します。

```sh
pnpm install --frozen-lockfile
pnpm setup:hooks
pnpm verify:full
```

`pnpm build`で`dist/extension/`を作成し、Chromeの拡張機能管理画面から「パッケージ化されていない拡張機能を読み込む」で読み込みます。`dist/extension/`はソースと同期してGitにも登録します。それ以外の`dist/`生成物は登録しません。

Chrome APIに依存しない処理はsrc/core/、Chrome固有処理はsrc/extension/に置きます。権限・対象サイトは必要な機能が決まるまで追加しません。作業規約はAGENTS.md、参加手順はCONTRIBUTING.md、GitHub公開前の設定はdocs/repository-setup.mdを参照してください。

## ライセンス

GNU Affero General Public License version 3 only（AGPL-3.0-only）。詳細はLICENSEを参照してください。
