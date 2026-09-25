# Chrome ウェブストア提出手順

公式資料: [提出手順](https://developer.chrome.com/docs/webstore/publish/)、[画像要件](https://developer.chrome.com/docs/webstore/images)、[プライバシー欄](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

1. 開発者アカウントを登録し、登録料の支払い、2段階認証、Trader/Non-Trader申告を完了する。申告に必要な本人情報は開発者自身が入力する。[登録案内](https://developer.chrome.com/docs/webstore/register)、[申告案内](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq)
2. `pnpm verify:full` と `pnpm package:extension` を実行する。`dist/Harvest-extension-<version>.zip` を提出する。ZIPの最上位に`manifest.json`があることを確認する。
3. [開発者ダッシュボード](https://chrome.google.com/webstore/devconsole)の「新しいアイテムを追加」からZIPをアップロードする。
4. 「ストアの掲載情報」に[掲載文](listing-ja.md)の詳細説明、カテゴリ、言語を入力し、`assets/icons/icon-128.png`、`store/assets/promo-small.png`、`store/assets/screenshot-01.png`をアップロードする。スクリーンショットは1280×800または640×400、最低1枚が必要。マルキー画像と動画は必要に応じて追加する。
5. 「プライバシー」に単一目的、各権限の理由、遠隔コード不使用、利用者データの取扱い、データ利用制限への同意を入力する。[プライバシーポリシー](../docs/privacy-policy.md)を公開して、そのURLを指定する。フォームの選択肢は提出時の実装に照らして再確認する。
6. 「配布」で公開範囲と地域を指定する。ログイン不要の操作手順を審査担当者向けの欄に記載し、審査へ提出する。審査後に自動公開するか、公開日を自分で決めるかを選ぶ。

## 提出前に開発者が確定する項目

- 誰でも読めるプライバシーポリシーURLと問い合わせ先。現在のGitHubリポジトリは非公開のため、そのままではURLに使えない。
- アカウント名義、Trader/Non-Trader、公開地域、公開タイミング。これらは開発者の判断とアカウント操作が必要。
- `store/assets/screenshot-01.png`は現在のサイドパネルを模した画面イメージ。架空のギャラリーと自作図形を使用している。提出前に実機の表示・操作と見比べ、相違があれば差し替える。

提出用画像の出所: `assets/brand/harvest-logo-master.png` はこの製品用に生成した原画。拡張機能のアイコンと紹介画像はこの原画から制作した。掲載スクリーンショットはサンプル画像とサイドパネルの再現画像を合成した。ストア用画像はZIPに含めず、掲載情報へ個別にアップロードする。
