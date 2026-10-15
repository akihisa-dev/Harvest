# Source code / ソースコード

このZIPの `source/` には、同梱の拡張機能と同じ版をビルドするためのソースコード、画像原画、設定、ビルド用スクリプトが入っています。`LICENSE` は GNU Affero General Public License version 3 の全文です。`source/` を取り出し、Node.js 22〜26 と pnpm 12.5.1 を用意して、次のコマンドを実行できます。

```sh
pnpm install --frozen-lockfile
pnpm build
```

The `source/` directory in this ZIP contains the corresponding source, original artwork, configuration, and build scripts for the packaged extension. `LICENSE` contains the full GNU Affero General Public License version 3. Extract `source/`, use Node.js 22–26 and pnpm 12.5.1, then run the commands above.

配布ソースにはWindowsのZIP作成に必要な `scripts/windows-zip.ps1` も含まれます。`pnpm package:extension` は各OSのローカル機能でZIPを生成します。

## Mediabunny

Mediabunny 1.61.0の対象ソースとその改変部分は **MPL-2.0** で提供します。Harvest全体のAGPL表記によって、この部分のMPLに基づく権利を制限しません。

- 改変したファイルの編集用ソース：`source/vendor/mediabunny/conversion.ts`。同じディレクトリにMPL-2.0の全文を収録しています。
- 未改変部分を含む使用版の全ソース：[固定コミット 0f91fe7](https://github.com/Vanilagy/mediabunny/tree/0f91fe768e7ee42703f15e2b8845551b0f1028b3)。上流ソースはMPL-2.0で取得できます。
- 配布コードの再生成：冒頭のインストール・ビルド手順に従ってください。固定npmパッケージのブラウザー用モジュールから必要な公開APIだけを抽出し、`source/scripts/mediabunny-build.mjs`で映像の表示時間を補正します。実行時の外部コード取得はありません。
- 改変内容：表示時間0のWebMフレームを落とさず、次のフレームまたはコンテナー終端から長さを補います。呼び出す独立したHarvest側ヘルパーは `source/src/core/video-sample-timing.ts` です。

The Mediabunny 1.61.0 source and modifications are available under **MPL-2.0**. The editable modified file and MPL license are in `source/vendor/mediabunny/`. The pinned upstream source link above supplies all unchanged files. Harvest's AGPL notice does not restrict your MPL rights to these files. Follow the install/build instructions above to reproduce the reduced browser bundle and its video timing adaptation; the independent Harvest timing helper is at the path above.

## JXL

`@jsquash/jxl` 1.3.0はApache-2.0です。内部の圧縮処理（libjxl、Brotli、Highway、skcms）と生成ランタイムのライセンス・著作権表示は `app/vendor/jxl/THIRD-PARTY-NOTICES.txt` に収録しています。由来は公開npmパッケージのgitHeadと上流の固定ビルド設定を根拠とし、`source/third_party/jxl/provenance.json` に同梱ファイルのSHA-256を記録しています。元のビルド実行ログはパッケージに含まれていないため、実際のツールチェーン呼び出し全体を証明するものではありません。

The JXL third-party notices cover the codec's internal libraries and generated runtime. Provenance is based on the npm gitHead and pinned upstream build recipe; file hashes bind these notices to the distributed encoder. The original binary build log is not supplied upstream, so this does not attest every toolchain invocation.
