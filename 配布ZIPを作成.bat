@echo off
setlocal EnableExtensions
chcp 65001 >nul

cd /d "%~dp0"
if errorlevel 1 goto :project_root_failed

where node >nul 2>&1
if errorlevel 1 goto :node_missing

node scripts/package-extension.mjs
set "exit_code=%ERRORLEVEL%"
if "%exit_code%"=="0" goto :package_succeeded
echo.
echo 配布ZIPの作成に失敗しました（終了コード: %exit_code%）。
goto :finish

:package_succeeded
echo.
echo 配布用フォルダーとZIPを作成しました。
goto :finish

:project_root_failed
echo プロジェクトフォルダーへ移動できませんでした。
set "exit_code=1"
goto :finish

:node_missing
echo Node.jsが見つかりません。Node.jsをインストールしてから、もう一度実行してください。
set "exit_code=1"
goto :finish

:finish
echo.
pause
exit /b %exit_code%
