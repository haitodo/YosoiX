/**
 * ダウンロードファイル名生成モジュール（FR-060: spec.md 2.8）
 *
 * 標準形式: XMedia/{screen_name}_{tweet_id}_{連番}.{拡張子}
 * 例: XMedia/username_1234567890123456789_01.jpg
 */

export type SafeMediaExtension = "jpg" | "png" | "webp" | "gif" | "mp4";

const SAFE_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
]);

const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * ユーザー名（screen_name）からファイル名に使用できない文字・危険な文字列を除去する。
 */
export function sanitizeScreenNameForFilename(rawScreenName: string | undefined): string {
  if (!rawScreenName) {
    return "x_user";
  }

  // X の screen_name は本来 [A-Za-z0-9_] だが、念のため制御文字・禁止文字・空白等を除去
  const cleaned = rawScreenName
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*\s]+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 30);

  if (!cleaned || WINDOWS_RESERVED_NAMES.test(cleaned)) {
    return "x_user";
  }

  return cleaned;
}

/**
 * 画像URL（?format=png や /media/xxx.jpg）から安全な拡張子を判定する。
 * jpeg は一般的な .jpg に正規化する。不明な場合は "jpg" にフォールバックする。
 */
export function resolveImageExtension(rawUrl: string): SafeMediaExtension {
  try {
    const parsed = new URL(rawUrl);
    const formatParam = parsed.searchParams.get("format")?.toLowerCase().trim();
    if (formatParam && SAFE_IMAGE_EXTENSIONS.has(formatParam)) {
      return formatParam === "jpeg" ? "jpg" : (formatParam as SafeMediaExtension);
    }

    // パス末尾の :orig 等を除去してから拡張子を抽出
    const cleanPath = parsed.pathname.replace(/:[a-zA-Z0-9_]+$/, "");
    const extMatch = /\.([a-zA-Z0-9]+)$/.exec(cleanPath);
    const pathExt = extMatch?.[1]?.toLowerCase();
    if (pathExt && SAFE_IMAGE_EXTENSIONS.has(pathExt)) {
      return pathExt === "jpeg" ? "jpg" : (pathExt as SafeMediaExtension);
    }
  } catch {
    // URL パース失敗時はデフォルトへ
  }

  return "jpg";
}

export interface BuildMediaFilenameParams {
  screenName: string | undefined;
  tweetId: string;
  /** 1始まりのメディア連番 */
  mediaIndex: number;
  extension: SafeMediaExtension;
}

/**
 * spec.md 2.8 に準拠した相対保存パスを生成する。
 */
export function buildMediaFilename(params: BuildMediaFilenameParams): string {
  const safeUser = sanitizeScreenNameForFilename(params.screenName);
  const safeTweetId = /^\d{1,25}$/.test(params.tweetId) ? params.tweetId : "0";
  const clampedIndex = Math.max(1, Math.min(99, Math.floor(params.mediaIndex)));
  const paddedIndex = String(clampedIndex).padStart(2, "0");

  return `XMedia/${safeUser}_${safeTweetId}_${paddedIndex}.${params.extension}`;
}
