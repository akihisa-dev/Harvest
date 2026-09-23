#!/bin/zsh

project_root="$(cd -- "$(dirname -- "$0")" && pwd)"
cd -- "$project_root" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.jsが見つかりません。Node.jsをインストールしてから、もう一度このファイルを開いてください。"
  echo
  read -r "?Enterキーで閉じます。"
  exit 1
fi

node scripts/package-extension.mjs
exit_code=$?

echo
if [[ $exit_code -eq 0 ]]; then
  echo "配布用フォルダーとZIPを作成しました。"
else
  echo "配布ZIPの作成に失敗しました（終了コード: $exit_code）。"
fi
read -r "?Enterキーで閉じます。"
exit $exit_code
