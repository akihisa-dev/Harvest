# Source code / ソースコード

このZIPの `source/` には、同梱の拡張機能と同じ版をビルドするためのソースコード、画像原画、設定、ビルド用スクリプトが入っています。`LICENSE` は GNU Affero General Public License version 3 の全文です。`source/` を取り出し、Node.js 22〜26 と pnpm 12.5.1 を用意して、次のコマンドを実行できます。

```sh
pnpm install --frozen-lockfile
pnpm build
```

The `source/` directory in this ZIP contains the corresponding source, original artwork, configuration, and build scripts for the packaged extension. `LICENSE` contains the full GNU Affero General Public License version 3. Extract `source/`, use Node.js 22–26 and pnpm 12.5.1, then run the commands above.

配布ソースにはWindowsのZIP作成に必要な `scripts/windows-zip.ps1` も含まれます。`pnpm package:extension` は各OSのローカル機能でZIPを生成します。
