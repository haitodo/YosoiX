import { execSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureExtensionKey, findChromiumBinary } from "./key-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const releaseDir = path.join(rootDir, "release");

async function main() {
  console.log("============================================================");
  console.log("  [YosoiX] 拡張機能パッケージ化処理を開始します");
  console.log("============================================================\n");

  // 1. 秘密鍵の確認・取得（存在しない場合は自動生成し、IDを確定）
  const keyInfo = await ensureExtensionKey(rootDir);
  console.log(`[1/4] 拡張機能 ID (固定 32 桁):`);
  console.log(`      ${keyInfo.extensionId}`);
  if (keyInfo.isNewKey) {
    console.log(`      ※ 新しい署名用秘密鍵 (key.pem) をプロジェクトルートに生成しました。`);
    console.log(`      ※ この秘密鍵は ID を固定するための最重要ファイルです (Git非公開)。`);
  } else {
    console.log(`      ※ 既存の秘密鍵 (key.pem) を使用して ID を維持します。`);
  }

  // 2. 最新の dist/ をビルド（manifest.json に公開鍵 key を埋め込み）
  console.log(`\n[2/4] 最新コードをビルドしています...`);
  const buildScript = path.join(rootDir, "scripts/build.mjs");
  execSync(`node "${buildScript}"`, { stdio: "inherit", cwd: rootDir });

  // package.json からバージョン取得
  const pkgJsonRaw = await readFile(path.join(rootDir, "package.json"), "utf8");
  const pkg = JSON.parse(pkgJsonRaw);
  const version = pkg.version || "0.1.0";

  await mkdir(releaseDir, { recursive: true });

  // 3. 署名済み CRX パッケージの作成 (Edge / Chrome CLI を使用)
  console.log(`\n[3/4] 署名済み CRX パッケージ (.crx) の生成を試行中...`);
  const chromiumBin = findChromiumBinary();
  const crxName = `yosoix-v${version}.crx`;
  const finalCrxPath = path.join(releaseDir, crxName);
  let crxCreated = false;

  if (chromiumBin) {
    try {
      console.log(`      ブラウザ実行ファイルを検出: ${path.basename(chromiumBin)}`);
      // Chromium の --pack-extension は、対象フォルダーの親ディレクトリに <フォルダー名>.crx を出力する
      const tempCrxOutput = path.join(rootDir, "dist.crx");
      if (existsSync(tempCrxOutput)) {
        await rm(tempCrxOutput, { force: true });
      }

      const packCmd = `"${chromiumBin}" --pack-extension="${distDir}" --pack-extension-key="${keyInfo.keyPath}" --no-message-box`;
      execSync(packCmd, { stdio: "ignore" });

      // Chromium は非同期でプロセスが完了する場合があるため少し待機確認
      let waitCount = 0;
      while (!existsSync(tempCrxOutput) && waitCount < 10) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        waitCount++;
      }

      if (existsSync(tempCrxOutput)) {
        if (existsSync(finalCrxPath)) {
          await rm(finalCrxPath, { force: true });
        }
        await cp(tempCrxOutput, finalCrxPath);
        await rm(tempCrxOutput, { force: true });
        crxCreated = true;
        console.log(`      -> 署名済み CRX 作成完了: release/${crxName}`);
      } else {
        console.warn(`      [警告] CRX の生成ファイルが検出されませんでした。`);
      }
    } catch (crxErr) {
      console.warn(`      [警告] CLI による CRX 自動生成をスキップしました:`, crxErr.message);
    }
  } else {
    console.log(`      [情報] Edge / Chrome の実行バイナリが見つかりませんでした (CRX 自動署名をスキップ)。`);
  }

  // 4. 配布用 ZIP アーカイブ作成
  console.log(`\n[4/4] 配布用 ZIP アーカイブの生成中...`);

  // 4-A. 展開して読み込み用 ZIP (key 埋め込み済み。誰がどこで解凍して読み込んでも同じ ID になる)
  const unpackedZipName = `yosoix-v${version}-unpacked.zip`;
  const unpackedZipPath = path.join(releaseDir, unpackedZipName);
  if (existsSync(unpackedZipPath)) {
    await rm(unpackedZipPath, { force: true });
  }

  // Windows PowerShell Compress-Archive を利用
  const psZipCmd = `Compress-Archive -Path "${path.join(distDir, "*")}" -DestinationPath "${unpackedZipPath}" -Force`;
  execSync(`powershell -NoProfile -Command "${psZipCmd}"`, { stdio: "inherit", cwd: rootDir });
  console.log(`      -> 展開読み込み用 ZIP 作成完了: release/${unpackedZipName}`);

  // 4-B. Chrome Web Store / Edge Add-ons 提出用 ZIP (提出用に "key" プロパティを除外した標準パッケージ)
  const storeZipName = `yosoix-v${version}-store.zip`;
  const storeZipPath = path.join(releaseDir, storeZipName);
  const tempStoreDir = path.join(releaseDir, ".tmp-store-pkg");

  try {
    if (existsSync(tempStoreDir)) {
      await rm(tempStoreDir, { recursive: true, force: true });
    }
    await cp(distDir, tempStoreDir, { recursive: true });

    // store 用 manifest から "key" を削除
    const storeManifestPath = path.join(tempStoreDir, "manifest.json");
    if (existsSync(storeManifestPath)) {
      const manifestObj = JSON.parse(await readFile(storeManifestPath, "utf8"));
      delete manifestObj.key;
      await writeFile(storeManifestPath, JSON.stringify(manifestObj, null, 2) + "\n", "utf8");
    }

    if (existsSync(storeZipPath)) {
      await rm(storeZipPath, { force: true });
    }
    const psStoreZipCmd = `Compress-Archive -Path "${path.join(tempStoreDir, "*")}" -DestinationPath "${storeZipPath}" -Force`;
    execSync(`powershell -NoProfile -Command "${psStoreZipCmd}"`, { stdio: "inherit", cwd: rootDir });
    console.log(`      -> ストア提出用 ZIP 作成完了: release/${storeZipName}`);
  } finally {
    if (existsSync(tempStoreDir)) {
      await rm(tempStoreDir, { recursive: true, force: true });
    }
  }

  // 完了サマリー表示
  console.log("\n============================================================");
  console.log("  【YosoiX パッケージ化 完了サマリー】");
  console.log("============================================================");
  console.log(`■ 拡張機能 ID (永続・固定 32 桁):`);
  console.log(`   ${keyInfo.extensionId}`);
  console.log(`   拡張機能 URL: chrome-extension://${keyInfo.extensionId}/options.html`);
  console.log("");
  console.log(`■ 秘密鍵 (署名鍵):`);
  console.log(`   ${keyInfo.keyPath}`);
  console.log(`   ※ このファイルがある限り、何度修正・ビルドしても 32 桁 ID は維持されます。`);
  console.log(`   ※ Git にはコミットされないよう .gitignore されています。安全に保管してください。`);
  console.log("");
  console.log(`■ 生成された成果物 (release/):`);
  if (crxCreated) {
    console.log(`   1. 署名済み CRX パッケージ:`);
    console.log(`      ${finalCrxPath}`);
    console.log(`      (Edge / Chrome の edge://extensions にドラッグ＆ドロップして即座にインストール可能)`);
  }
  console.log(`   2. 展開読み込み用 ZIP (固定 ID 保持):`);
  console.log(`      ${unpackedZipPath}`);
  console.log(`      (解凍して「展開して読み込み」すれば、他 PC でも同一の 32 桁 ID で動作)`);
  console.log(`   3. ストア提出用 ZIP:`);
  console.log(`      ${storeZipPath}`);
  console.log(`      (Microsoft Edge Add-ons または Chrome Web Store のダッシュボードへアップロード可能)`);
  console.log("");
  console.log(`■ 開発中の直接読み込み用フォルダー:`);
  console.log(`   ${distDir}`);
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("[YosoiX] パッケージ作成に失敗しました:", err);
  process.exit(1);
});
