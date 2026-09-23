# Harvest

Harvestは、開いているWebページの画像を集め、選んだ画像を1つのPDFに保存するChrome拡張機能です。画像のまとまりごとの選択、個別選択、順序の変更に対応します。画像一覧につながるリンクが見つかった場合は、その先のページも調べます。

## 使い方

1. Chromeで画像のあるページを開き、Harvestのボタンから「画像を集める」を押します。
2. 対象のタブを選び、「画像を探す」を押します。
3. 必要な画像を選び、矢印で順番を整え、「選択した画像をPDFにする」を押します。

PDFは画像の元の大きさに合わせて1枚ずつページを作成します。取得できなかった画像はPDFに含めず、保存後にその枚数を表示します。Chromeの内部ページなど、拡張機能が読み取れないページは対象外です。

## アクセスとデータ

導入時に、すべての通常のWebサイト（HTTP/HTTPS）へのアクセスを許可する必要があります。開いているタブの名前とURLを選択画面に表示し、収集を開始したページの画像URLと、PDF作成に必要な画像データを読み取るためです。画像一覧につながるリンクは同じサイト内で探します。

収集とPDF作成はブラウザー内で行い、外部の収集サーバーへは送信しません。画像の取得時には、画像が置かれたサイトへブラウザーから通常のリクエストを送ります。収集結果や設定は保存せず、画面を閉じると破棄します。PDFは利用者が保存したファイルだけが残ります。

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

`pnpm build`で`dist/extension/`を作成し、Chromeの拡張機能管理画面から「パッケージ化されていない拡張機能を読み込む」で読み込みます。配布用ZIPは`pnpm package:extension`で作成します。Windowsでは`配布ZIPを作成.bat`、macOSでは`配布ZIPを作成.command`を開いても作成できます。これらは同じ作成処理を呼び出します。この処理は固定版のNode.jsとpnpmを確認してビルドし、ZIPの整合性と最上位の`manifest.json`を確認してから、`dist/Harvest-extension-<version>.zip`へ保存します。`dist/extension/`はソースと同期してGitにも登録します。ZIPを含むそれ以外の`dist/`生成物は登録しません。

Chrome APIに依存しない処理はsrc/core/、Chrome固有処理はsrc/extension/に置きます。作業規約はAGENTS.md、参加手順はCONTRIBUTING.md、GitHub公開前の設定はdocs/repository-setup.mdを参照してください。

## ライセンス

GNU Affero General Public License version 3 only（AGPL-3.0-only）。詳細はLICENSEを参照してください。
