import { ALL_NAV_ITEM_IDS } from "./nav-items";
import {
  BRIDGE_NAMESPACE,
  DEFAULT_SETTINGS,
  type BridgeMediaCapturedEnvelope,
  type DownloadFileSpec,
  type DownloadMediaMessage,
  type ExtensionSettings,
  type NavItemId,
  type TweetMediaCacheEntry,
  type TweetMediaItem,
  type VideoVariant,
} from "./types";

/**
 * 信頼境界バリデーター群（spec.md 4.6, 4.7, 5.3）
 *
 * 1. MAIN world → ISOLATED world (window.postMessage)
 * 2. Content Script → Background Service Worker (chrome.runtime.sendMessage)
 * 3. chrome.storage.local → アプリ内設定オブジェクト
 *
 * すべての境界で型・必須項目・配列長・URLスキーム・許可ホスト・ファイル名を厳格に検証する。
 */

export const ALLOWED_PAGE_ORIGINS: ReadonlySet<string> = new Set([
  "https://x.com",
  "https://twitter.com",
]);

/** X の公式メディア配信 CDN ホストのみを許可する（spec.md 4.6, 5.3） */
export const ALLOWED_MEDIA_CDN_HOSTS: ReadonlySet<string> = new Set([
  "pbs.twimg.com",
  "video.twimg.com",
  "ton.twimg.com",
]);

const TWEET_ID_REGEX = /^\d{1,25}$/;
const SAFE_SCREEN_NAME_REGEX = /^[A-Za-z0-9_]{1,30}$/;
const SAFE_DOWNLOAD_FILENAME_REGEX =
  /^XMedia\/([A-Za-z0-9_-]{1,40})_\d{1,25}_\d{2,3}\.(jpg|jpeg|png|webp|gif|mp4)$/;
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

const MAX_BRIDGE_ENTRIES_PER_BATCH = 200;
const MAX_MEDIA_ITEMS_PER_TWEET = 12;
const MAX_VARIANTS_PER_VIDEO = 16;
const MAX_DOWNLOAD_FILES_PER_REQUEST = 12;
const MAX_URL_LENGTH = 2048;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidTweetId(value: unknown): value is string {
  return typeof value === "string" && TWEET_ID_REGEX.test(value);
}

export function isAllowedPageOrigin(origin: unknown): origin is string {
  return typeof valueOrEmpty(origin) === "string" && ALLOWED_PAGE_ORIGINS.has(origin as string);
}

function valueOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * ダウンロード・キャッシュを許可するメディアURLか検証する。
 * - https: のみ許可
 * - 認証情報（username/password）を含まないこと
 * - 許可された X メディア CDN ホストであること
 */
export function isAllowedMediaUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username !== "" || parsed.password !== "") return false;
    return ALLOWED_MEDIA_CDN_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Background Service Worker で chrome.downloads.download に渡す直前の最終ファイル名検査。
 * パストラバーサル（..）、絶対パス、バックスラッシュ、Windows予約語、未許可拡張子をすべて拒否する。
 */
export function isSafeRelativeDownloadFilename(filename: unknown): filename is string {
  if (typeof filename !== "string" || filename.length > 180) {
    return false;
  }
  if (filename.includes("..") || filename.includes("\\")) {
    return false;
  }
  const match = SAFE_DOWNLOAD_FILENAME_REGEX.exec(filename);
  if (!match) {
    return false;
  }
  const userPart = match[1];
  if (!userPart || WINDOWS_RESERVED_NAMES.test(userPart)) {
    return false;
  }
  return true;
}

function sanitizeBridgeVariant(raw: unknown): VideoVariant | null {
  if (!isPlainObject(raw)) return null;
  if (!isAllowedMediaUrl(raw.url)) return null;
  if (typeof raw.contentType !== "string" || raw.contentType.length > 64) return null;

  const variant: VideoVariant = {
    url: raw.url,
    contentType: raw.contentType,
  };
  if (typeof raw.bitrate === "number" && Number.isFinite(raw.bitrate) && raw.bitrate >= 0) {
    variant.bitrate = Math.floor(raw.bitrate);
  }
  return variant;
}

function sanitizeBridgeMediaItem(raw: unknown, expectedTweetId: string): TweetMediaItem | null {
  if (!isPlainObject(raw)) return null;
  if (!isValidTweetId(raw.tweetId) || raw.tweetId !== expectedTweetId) return null;
  if (raw.type !== "image" && raw.type !== "video") return null;
  if (
    typeof raw.mediaIndex !== "number" ||
    !Number.isInteger(raw.mediaIndex) ||
    raw.mediaIndex < 1 ||
    raw.mediaIndex > MAX_MEDIA_ITEMS_PER_TWEET
  ) {
    return null;
  }

  const rawScreenName = typeof raw.screenName === "string" ? raw.screenName : "";
  const screenName = SAFE_SCREEN_NAME_REGEX.test(rawScreenName) ? rawScreenName : "x_user";

  const item: TweetMediaItem = {
    tweetId: raw.tweetId,
    screenName,
    mediaIndex: raw.mediaIndex,
    type: raw.type,
  };

  if (typeof raw.createdAt === "string" && raw.createdAt.length <= 64) {
    item.createdAt = raw.createdAt;
  }

  if (raw.type === "image") {
    if (!isAllowedMediaUrl(raw.originalUrl)) return null;
    item.originalUrl = raw.originalUrl;
    return item;
  }

  // video
  if (!Array.isArray(raw.variants) || raw.variants.length === 0) return null;
  const variants: VideoVariant[] = [];
  for (const v of raw.variants.slice(0, MAX_VARIANTS_PER_VIDEO)) {
    const clean = sanitizeBridgeVariant(v);
    if (clean) variants.push(clean);
  }
  if (variants.length === 0) return null;
  item.variants = variants;
  return item;
}

function sanitizeBridgeEntry(raw: unknown): TweetMediaCacheEntry | null {
  if (!isPlainObject(raw)) return null;
  if (!isValidTweetId(raw.tweetId)) return null;
  if (!Array.isArray(raw.media)) return null;

  const media: TweetMediaItem[] = [];
  for (const m of raw.media.slice(0, MAX_MEDIA_ITEMS_PER_TWEET)) {
    const clean = sanitizeBridgeMediaItem(m, raw.tweetId);
    if (clean) media.push(clean);
  }

  const entry: TweetMediaCacheEntry = {
    tweetId: raw.tweetId,
    media,
    capturedAt: Date.now(),
  };

  if (typeof raw.screenName === "string" && SAFE_SCREEN_NAME_REGEX.test(raw.screenName)) {
    entry.screenName = raw.screenName;
  }

  if (
    typeof raw.quoteCount === "number" &&
    Number.isFinite(raw.quoteCount) &&
    raw.quoteCount >= 0
  ) {
    entry.quoteCount = Math.floor(raw.quoteCount);
  }

  return entry;
}

/**
 * MAIN world から postMessage されたデータを検証・無害化する。
 * 不正な形式の場合は null を返し、正常なエントリのみを通過させる。
 */
export function validateBridgeEnvelope(data: unknown): BridgeMediaCapturedEnvelope | null {
  if (!isPlainObject(data)) return null;
  if (data[BRIDGE_NAMESPACE] !== true) return null;
  if (data.type !== "MEDIA_CAPTURED") return null;
  if (!Array.isArray(data.entries) || data.entries.length === 0) return null;

  const cleanEntries: TweetMediaCacheEntry[] = [];
  for (const rawEntry of data.entries.slice(0, MAX_BRIDGE_ENTRIES_PER_BATCH)) {
    const clean = sanitizeBridgeEntry(rawEntry);
    if (clean) cleanEntries.push(clean);
  }

  if (cleanEntries.length === 0) return null;

  return {
    [BRIDGE_NAMESPACE]: true,
    type: "MEDIA_CAPTURED",
    entries: cleanEntries,
  };
}

/**
 * Background Service Worker が受信する DOWNLOAD_MEDIA メッセージの検証。
 */
export function validateDownloadMediaMessage(raw: unknown): DownloadMediaMessage | null {
  if (!isPlainObject(raw) || raw.type !== "DOWNLOAD_MEDIA") return null;
  if (!isValidTweetId(raw.tweetId)) return null;
  if (
    !Array.isArray(raw.items) ||
    raw.items.length === 0 ||
    raw.items.length > MAX_DOWNLOAD_FILES_PER_REQUEST
  ) {
    return null;
  }

  const validItems: DownloadFileSpec[] = [];
  for (const item of raw.items) {
    if (!isPlainObject(item)) return null;
    if (
      typeof item.mediaIndex !== "number" ||
      !Number.isInteger(item.mediaIndex) ||
      item.mediaIndex < 1 ||
      item.mediaIndex > 99
    ) {
      return null;
    }
    if (!isAllowedMediaUrl(item.url)) return null;
    if (!isSafeRelativeDownloadFilename(item.filename)) return null;

    validItems.push({
      mediaIndex: item.mediaIndex,
      url: item.url,
      filename: item.filename,
    });
  }

  return {
    type: "DOWNLOAD_MEDIA",
    tweetId: raw.tweetId,
    items: validItems,
  };
}

/**
 * ストレージまたはメッセージから読み取った設定値を正規化し、未定義・不正値をデフォルト値で補完する（spec.md 2.7）。
 */
export function normalizeSettings(raw: unknown): ExtensionSettings {
  if (!isPlainObject(raw)) {
    return {
      ...DEFAULT_SETTINGS,
      hiddenNavItems: [...DEFAULT_SETTINGS.hiddenNavItems],
    };
  }

  const hiddenNavItems: NavItemId[] = [];
  if (Array.isArray(raw.hiddenNavItems)) {
    const seen = new Set<NavItemId>();
    for (const item of raw.hiddenNavItems) {
      if (typeof item === "string" && ALL_NAV_ITEM_IDS.has(item as NavItemId)) {
        const navId = item as NavItemId;
        if (!seen.has(navId)) {
          seen.add(navId);
          hiddenNavItems.push(navId);
        }
      }
    }
  }

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
    hiddenNavItems,
    hideRightSidebar:
      typeof raw.hideRightSidebar === "boolean"
        ? raw.hideRightSidebar
        : DEFAULT_SETTINGS.hideRightSidebar,
    showQuoteListButton:
      typeof raw.showQuoteListButton === "boolean"
        ? raw.showQuoteListButton
        : DEFAULT_SETTINGS.showQuoteListButton,
    enableMediaDownload:
      typeof raw.enableMediaDownload === "boolean"
        ? raw.enableMediaDownload
        : DEFAULT_SETTINGS.enableMediaDownload,
  };
}
