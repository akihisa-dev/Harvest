# Chrome ウェブストア提出手順

公式資料: [提出手順](https://developer.chrome.com/docs/webstore/publish/)、[画像要件](https://developer.chrome.com/docs/webstore/images)、[プライバシー欄](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

1. 開発者アカウントを登録し、登録料の支払い、2段階認証、Trader/Non-Trader申告を完了する。申告に必要な本人情報は開発者自身が入力する。[登録案内](https://developer.chrome.com/docs/webstore/register)、[申告案内](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq)
2. `pnpm verify:full` と `pnpm package:extension` を実行する。`dist/Harvest-extension-<version>.zip` を提出する。ZIPの最上位に`manifest.json`、`LICENSE`、`SOURCE.md`、`source/`があり、`source/package.json`の版が提出する版と一致することを確認する。
3. [開発者ダッシュボード](https://chrome.google.com/webstore/devconsole)の「新しいアイテムを追加」からZIPをアップロードする。
4. 「ストアの掲載情報」に[掲載文](listing-ja.md)の詳細説明、カテゴリ、言語を入力し、`assets/icons/icon-128.png`と`store/assets/promo-small.png`をアップロードする。日本語の「ローカライズ版スクリーンショット」には`store/assets/screenshot-ja.png`、「全言語向けスクリーンショット」には`store/assets/screenshot-global.png`を指定する。どちらも1280×800。動画とマルキー画像は任意。
5. 「プライバシー」に単一目的、各権限の理由、遠隔コード不使用、利用者データの取扱い、データ利用制限への同意を入力する。プライバシーポリシーURLには `https://github.com/akihisa-dev/Harvest/blob/main/docs/privacy-policy.md` を指定する。フォームの選択肢は提出時の実装に照らして再確認する。利用者は拡張機能内の「ライセンスとソース」からAGPL全文と、同じZIP内の対応ソースの場所を確認できる。
6. 「配布」で公開範囲と地域を指定する。ログイン不要の操作手順を審査担当者向けの欄に記載し、審査へ提出する。審査後に自動公開するか、公開日を自分で決めるかを選ぶ。

## 提出前に開発者が確定する項目

- プライバシーポリシーURLと問い合わせ先が、ログインせず閲覧できること。問い合わせ先には `https://github.com/akihisa-dev/Harvest/issues` を使える。
- アカウント名義、Trader/Non-Trader、公開地域、公開タイミング。これらは開発者の判断とアカウント操作が必要。
- `store/assets/screenshot-ja.png`と`store/assets/screenshot-global.png`は掲載用の画面イメージ。架空のギャラリーと固定した解析結果を使い、日本語・英語の現行操作を表す。生成元は`store/generate-screenshots.swift`。提出前にChromeのサイドパネルで現行の表示・操作と照合する。

提出用画像の出所: `assets/brand/harvest-logo-master.png` は現行画面の白・黒・グレーの配色に合わせて再制作したアイコン原画。拡張機能の各サイズのアイコンと紹介画像はこの原画をもとに制作した。掲載用の画面イメージは自作の風景図形と固定データで構成している。ストア用画像はZIPに含めず、掲載情報へ個別にアップロードする。
