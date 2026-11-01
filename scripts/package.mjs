import { execSync } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const releaseDir = path.join(rootDir, "release");

async function main() {
  console.log("[YosoiX] インストール用展開データの作成を開始します...");

  // 1. 最新の dist/ をビルド
  const buildScript = path.join(rootDir, "scripts/build.mjs");
  execSync(`node "${buildScript}"`, { stdio: "inherit", cwd: rootDir });

  // 2. package.json からバージョン取得
  const pkgJsonRaw = await readFile(path.join(rootDir, "package.json"), "utf8");
  const pkg = JSON.parse(pkgJsonRaw);
  const version = pkg.version || "0.1.0";

  await mkdir(releaseDir, { recursive: true });

  // 3. 配布用 ZIP アーカイブ作成（Edge / Chrome の「展開して読み込み」用）
  const zipName = `yosoix-v${version}-unpacked.zip`;
  const zipPath = path.join(releaseDir, zipName);

  if (existsSync(zipPath)) {
    await rm(zipPath, { force: true });
  }

  console.log(`[YosoiX] 配布用 ZIP アーカイブを生成中: release/${zipName}`);
  
  // Windows PowerShell Compress-Archive を利用
  const psCmd = `Compress-Archive -Path "${path.join(distDir, "*")}" -DestinationPath "${zipPath}" -Force`;
  execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: "inherit", cwd: rootDir });

  console.log("\n============================================================");
  console.log("  【YosoiX インストール用 展開データ 作成完了】");
  console.log("============================================================");
  console.log(`1. 展開済みフォルダー（直接読み込み用）:`);
  console.log(`   ${distDir}`);
  console.log(`2. 配布用 ZIP アーカイブ:`);
  console.log(`   ${zipPath}`);
  console.log("\n[Microsoft Edge へのインストール手順]");
  console.log("1. Edge のアドレスバーに edge://extensions を入力して開く");
  console.log("2. 画面左下の「開発者モード」スイッチを ON にする");
  console.log("3. 上部に表示される「展開して読み込み」ボタンをクリックする");
  console.log(`4. 上記のフォルダー（${distDir}）を選択する`);
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("[YosoiX] パッケージ作成に失敗しました:", err);
  process.exit(1);
});
