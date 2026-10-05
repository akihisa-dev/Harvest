# Harvest リポジトリ指示

ユーザーの明示依頼を優先し、製品仕様を推測で追加しません。

## 判断と範囲

- 結果を左右する未指定事項は推測で埋めず、その判断に依存する部分だけユーザーへ質問します。独立して進められる作業は続けます。
- 製品機能、画面、対象サイト、保存情報、外部送信、権限、公開先、配布方法は、明示依頼がない限り追加しません。
- 共通の開発、commit、release運用はHako-extensionを参照し、version管理は[Triadichromeの規則](https://github.com/akihisa-dev/Triadichrome/blob/main/AGENTS.md#versioncommitrelease)に揃えます。参照元固有の機能、製品仕様、画像、コード、履歴は複製しません。
- GitHubへの新規リポジトリ作成、remote設定、公開、push、release、tag、ブランチ保護設定は明示依頼がある場合だけ行います。

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

- 振る舞いを変える場合は仕様を確認できる自動テストを追加し、影響に応じた検証を行います。基本確認はpnpm verify:fullです。
- セキュリティ、権限、データ処理、ビルド、GitHub運用を変える場合、関連文書も更新します。
- 作業前にgit status --short --branchと対象差分を確認し、他の変更を戻しません。
- stageは対象pathを列挙し、git add .とgit add -Aは使いません。
- 明示された変更依頼は、対象変更と必要な文書・検証を完了した後の通常のローカルcommitまでを含みます。質問・相談だけの依頼、またはcommitしない指定がある場合はcommitしません。
- 検証に失敗した状態ではcommitしません。commit後はcommit IDと残存差分を確認します。
- versionの判断と同期は、下記の「バージョン管理」に従います。
- commit件名は`<type>[!]: <version> <日本語の説明>`とします。複数ファイル、version更新、運用変更を含む本文には`scope:`、`目的:`、`内容:`、`確認:`、`影響:`を記載します。
- 通常のcommitではtagを作りません。tag作成、release、push、GitHub上の設定変更は、それぞれ明示依頼がある場合だけ行います。
- push前に通常はpnpm verify:fullで必要な確認をローカルで完了し、失敗を解消してから共有します。GitHub Actionsによるpush後の同一検証の重複実行は現時点では採用しません。運用上の必要が生じた場合は再検討します。方針の理由と検証コマンドの使い分けはCONTRIBUTING.mdを参照してください。

## バージョン管理

- Harvestは1.0.0を正式版の起点とし、`MAJOR.MINOR.PATCH`の3つの数値で管理します。versionの正本はrootの`package.json`です。
- version区分はcommit typeではなく、公開済み機能との互換性と利用者に見える変更で決めます。
  - MAJOR: 公開機能、保存データ、設定形式などに後方互換性のない変更
  - MINOR: 後方互換性を保った機能追加、または廃止予定の告知
  - PATCH: 後方互換性を保った不具合修正、公開機能を変えない文書・test・build・保守変更
- 変更を実行する担当者は、変更内容と互換性から上記の区分を判断し、MAJORを含め必要なversion更新を通常の作業に含めます。区分が明確なら、version更新だけの追加承認は求めません。
- MAJORを上げる場合はMINORとPATCHを0に、MINORを上げる場合はPATCHを0に戻します。commit typeとversion区分は独立して選びます。
- 独立した目的ごとにcommitを分け、commitごとにversionを順次更新します。文書やtestだけの変更もPATCHを上げ、versionだけのcommitは作りません。
- `package.json`、編集用の`manifest.template.json`、生成済み`dist/extension/manifest.json`の同じversionを同一commitへ含めます。ソースや同梱文書の変更で生成物が変わる場合は、buildで`dist/extension/`を更新して同じcommitに含めます。
- stage済みのversion一致と同一commitへの登録は`pnpm version:check-staged`で確認します。更新候補は`pnpm version:next -- <patch|minor|major>`で表示できます。
