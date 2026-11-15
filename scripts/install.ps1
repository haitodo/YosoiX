# ============================================================
# YosoiX Microsoft Edge 拡張機能 インストール準備スクリプト
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $projectRoot

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  YosoiX (Microsoft Edge 拡張機能) インストール展開データ作成" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Node.js の確認
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[エラー] Node.js が見つかりません。Node.js (v20以上) をインストールしてください。" -ForegroundColor Red
    exit 1
}

# 2. 動作する pnpm の探索 (Node.js 25+ の Corepack 廃止による古いシム残存にも対応)
function Find-WorkingPnpm {
    $candidates = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $addCandidate = {
        param([string]$Path)
        if (-not [string]::IsNullOrWhiteSpace($Path) -and (Test-Path -LiteralPath $Path -PathType Leaf)) {
            if ($seen.Add($Path)) {
                $candidates.Add($Path)
            }
        }
    }

    foreach ($cmd in (Get-Command pnpm -All -ErrorAction SilentlyContinue | Sort-Object {
        if ($_.Source -like "*.exe") { 0 } elseif ($_.Source -like "*.cmd") { 1 } elseif ($_.Source -like "*.ps1") { 2 } else { 3 }
    })) {
        & $addCandidate $cmd.Source
    }

    if ($env:PNPM_HOME) {
        & $addCandidate (Join-Path $env:PNPM_HOME "pnpm.exe")
        & $addCandidate (Join-Path $env:PNPM_HOME "bin\pnpm.exe")
        & $addCandidate (Join-Path $env:PNPM_HOME "pnpm.cmd")
    }
    if ($env:LOCALAPPDATA) {
        & $addCandidate (Join-Path $env:LOCALAPPDATA "pnpm\pnpm.exe")
        & $addCandidate (Join-Path $env:LOCALAPPDATA "pnpm\bin\pnpm.exe")
    }
    if ($env:APPDATA) {
        & $addCandidate (Join-Path $env:APPDATA "npm\pnpm.cmd")
    }

    $hadBroken = $false
    foreach ($candidate in $candidates) {
        $ext = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
        if ($ext -notin @(".exe", ".cmd", ".bat", ".ps1")) {
            continue
        }
        try {
            & $candidate --version *> $null
            if ($LASTEXITCODE -eq 0) {
                return [PSCustomObject]@{ Path = $candidate; HadBroken = $hadBroken }
            }
            $hadBroken = $true
        } catch {
            $hadBroken = $true
        }
    }

    return [PSCustomObject]@{ Path = $null; HadBroken = $hadBroken }
}

$pnpmResult = Find-WorkingPnpm
$pnpmBin = $pnpmResult.Path
if (-not $pnpmBin) {
    if ($pnpmResult.HadBroken) {
        Write-Host "[エラー] pnpm の起動に失敗しました (古い Node.js の Corepack シムが残っている可能性があります)。" -ForegroundColor Red
        Write-Host "Node.js 25 以降では Corepack が同梱されないため、スタンドアロン版 pnpm を導入し、" -ForegroundColor Yellow
        Write-Host "古いシム (例: C:\Program Files\nodejs\pnpm*) を削除または PATH の順序を見直してください。" -ForegroundColor Yellow
    } else {
        Write-Host "[エラー] pnpm が見つかりません。" -ForegroundColor Red
    }
    Write-Host "本プロジェクトでは pnpm が必須です (npm / yarn / bun は使用禁止)。" -ForegroundColor Yellow
    Write-Host "PowerShell で以下を実行してスタンドアロン版 pnpm をインストールしてください:" -ForegroundColor Yellow
    Write-Host "  irm https://get.pnpm.io/install.ps1 | iex  (または winget install pnpm.pnpm)" -ForegroundColor Yellow
    exit 1
}

$env:PATH = "$(Split-Path -Parent $pnpmBin);$env:PATH"

# 3. node_modules の確認
$nodeModules = Join-Path $projectRoot "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[1/3] 依存パッケージをインストールしています (pnpm install)..." -ForegroundColor Green
    & $pnpmBin install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[エラー] pnpm install に失敗しました。" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[1/3] 依存パッケージ: 確認完了" -ForegroundColor Green
}

# 4. ビルドと展開データの作成
Write-Host "[2/3] 拡張機能をビルドして展開データ (dist) を生成しています..." -ForegroundColor Green
& $pnpmBin run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[エラー] 拡張機能のビルドに失敗しました。" -ForegroundColor Red
    exit 1
}

$distPath = Join-Path $projectRoot "dist"
if (-not (Test-Path $distPath)) {
    Write-Host "[エラー] dist フォルダーが見つかりません。" -ForegroundColor Red
    exit 1
}

# 5. クリップボードへのパスコピー
try {
    Set-Clipboard -Value $distPath
    $copiedToClipboard = $true
} catch {
    $copiedToClipboard = $false
}

# 6. 配慮: ビルド完了後に展開フォルダーを自動でエクスプローラー表示
Write-Host "[3/3] 展開フォルダーを開いています..." -ForegroundColor Green
Start-Process explorer.exe -ArgumentList "`"$distPath`""

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ★ ビルドが正常に完了しました！" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "展開先フォルダー: $distPath" -ForegroundColor White

if ($copiedToClipboard) {
    Write-Host "※ 展開先フォルダーのパスをクリップボードにコピーしました (Ctrl+V で貼付可能)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "【Microsoft Edge への登録手順】" -ForegroundColor White
Write-Host "1. Microsoft Edge でアドレスバーに以下を入力して開きます:" -ForegroundColor Gray
Write-Host "   edge://extensions" -ForegroundColor Cyan
Write-Host "2. 画面左下の「開発者モード」スイッチを ON にします" -ForegroundColor Gray
Write-Host "3. 上部に表示される「展開して読み込み」ボタンをクリックします" -ForegroundColor Gray
Write-Host "4. 先ほど自動で開いたフォルダー (dist) を選択します" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 7. Edge 拡張機能ページの起動オプション
if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    try {
        $openEdge = Read-Host "今すぐ Microsoft Edge の拡張機能ページ (edge://extensions) を開きますか？ [Y/N] (既定: Y)"
        if ([string]::IsNullOrWhiteSpace($openEdge) -or $openEdge.Trim().ToUpper() -eq "Y") {
            Start-Process "msedge.exe" "edge://extensions"
        }
    } catch {
        # 無視
    }

    Write-Host ""
    Write-Host "完了しました。何かキーを押すとこの画面を閉じます..."
    try {
        [void][System.Console]::ReadKey($true)
    } catch {
        # 無視
    }
} else {
    Write-Host "完了しました。"
}
