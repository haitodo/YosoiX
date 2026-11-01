import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const isWatch = process.argv.includes("--watch");

/**
 * MV3 の各実行コンテキスト（MAIN world / ISOLATED world / Service Worker / Options）は
 * チャンク分割（shared ESM import）を行うと Content Script で構文エラーになるため、
 * エントリーごとに自己完結した単一バンドル（IIFE）として出力する。
 */
const entries = [
  {
    entryPoint: path.join(rootDir, "src/bridge/main-world.ts"),
    outfile: path.join(distDir, "main-world.js"),
  },
  {
    entryPoint: path.join(rootDir, "src/content/index.ts"),
    outfile: path.join(distDir, "content.js"),
  },
  {
    entryPoint: path.join(rootDir, "src/background/service-worker.ts"),
    outfile: path.join(distDir, "service-worker.js"),
  },
  {
    entryPoint: path.join(rootDir, "src/options/options.ts"),
    outfile: path.join(distDir, "options.js"),
  },
];

async function copyStaticAssets() {
  await mkdir(distDir, { recursive: true });
  await cp(path.join(rootDir, "manifest.json"), path.join(distDir, "manifest.json"));
  await cp(path.join(rootDir, "src/styles/content.css"), path.join(distDir, "content.css"));
  await cp(path.join(rootDir, "src/options/index.html"), path.join(distDir, "options.html"));
  await cp(path.join(rootDir, "src/options/options.css"), path.join(distDir, "options.css"));

  const publicDir = path.join(rootDir, "public");
  if (existsSync(publicDir)) {
    await cp(publicDir, distDir, { recursive: true });
  }
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await copyStaticAssets();

  const sharedOptions = {
    bundle: true,
    format: "iife",
    target: ["es2022", "edge120"],
    platform: "browser",
    sourcemap: isWatch ? "inline" : false,
    charset: "utf8",
    logLevel: "info",
  };

  if (isWatch) {
    const contexts = await Promise.all(
      entries.map(({ entryPoint, outfile }) =>
        esbuild.context({
          ...sharedOptions,
          entryPoints: [entryPoint],
          outfile,
        }),
      ),
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("[YosoiX] Watching for changes...");
    return;
  }

  await Promise.all(
    entries.map(({ entryPoint, outfile }) =>
      esbuild.build({
        ...sharedOptions,
        entryPoints: [entryPoint],
        outfile,
      }),
    ),
  );
  console.log("[YosoiX] Build completed -> dist/");
}

main().catch((err) => {
  console.error("[YosoiX] Build failed:", err);
  process.exit(1);
});
