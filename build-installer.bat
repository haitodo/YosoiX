@echo off
setlocal
chcp 65001 > nul
title YosoiX 拡張機能 展開データ作成ツール

echo ============================================================
echo   YosoiX (Microsoft Edge 拡張機能) 展開データ作成
echo ============================================================
echo.

cd /d "%~dp0"

:: 1. Node.js の確認
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [エラー] Node.js が見つかりません。Node.js をインストールしてください。
    echo.
    pause
    exit /b 1
)

:: 2. pnpm の確認
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [エラー] pnpm が見つかりません。
    echo 本プロジェクトでは pnpm が必須です (npm / yarn / bun は使用禁止)。
    echo コマンドプロンプト等で corepack enable または npm i -g pnpm を実行してください。
    echo.
    pause
    exit /b 1
)

:: 3. node_modules が存在しない場合は pnpm install を実行
if not exist "node_modules\" (
    echo [情報] 依存パッケージをインストールしています (pnpm install)...
    call pnpm install
    if %ERRORLEVEL% neq 0 (
        echo [エラー] パッケージのインストールに失敗しました。
        echo.
        pause
        exit /b 1
    )
    echo.
)

:: 4. ビルド＆展開用パッケージ作成を実行
echo [情報] 拡張機能をビルドしてインストール用展開データを作成しています...
echo.
call pnpm run package
if %ERRORLEVEL% neq 0 (
    echo.
    echo [エラー] 展開データの作成に失敗しました。
    echo.
    pause
    exit /b 1
)

echo.
set /p OPEN_EXPLORER="生成されたフォルダー (dist) をエクスプローラーで開きますか？ [Y/N] (既定: Y): "
if /i "%OPEN_EXPLORER%"=="" set OPEN_EXPLORER=Y
if /i "%OPEN_EXPLORER%"=="Y" (
    start "" explorer "%~dp0dist"
)

echo.
echo 処理が完了しました。何かキーを押すとこの画面を閉じます。
pause > nul
