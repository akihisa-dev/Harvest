# リリースチェックリスト

Git tagは通常のcommitでは作りません。ユーザーからtag作成またはreleaseを明示された場合だけ、以下を確認します。

## Tag作成前

- [ ] release対象commitがcleanなworktreeのHEADである。
- [ ] `package.json`、`manifest.template.json`、`dist/extension/manifest.json`のversionが一致している。
- [ ] `pnpm verify:release`が成功している。
- [ ] package versionと同じ`v<version>`のローカルtagがまだない。
- [ ] tag作成が明示的に依頼されている。

## Tag作成後

- [ ] 注釈付きtagがrelease対象commitを指している。
- [ ] tag名がpackage versionと一致している。
- [ ] branch、tag、Releaseをremoteへ送信していない。

Tag作成の依頼はpushや公開の許可を含みません。remoteへの操作は個別に明示依頼された場合だけ行います。
