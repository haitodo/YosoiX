/**
 * YosoiX コア型定義・メッセージ契約
 *
 * MAIN world / ISOLATED world / Background Service Worker / Options UI の
 * 全境界で共有する単一の情報源（Single Source of Truth）。
 * 別のAIが UI やテストを実装する際も、このファイルの型契約を変更せずに準拠すること。
 */

/** 左ナビゲーション個別非表示の対象識別子（FR-010） */
export type NavItemId =
  | "post"
  | "premium"
  | "explore"
  | "follow"
  | "chat"
  | "calls"
  | "history"
  | "creator_studio"
  | "grok"
  | "jobs"
  | "lists"
  | "communities"
  | "business"
  | "ads"
  | "spaces";

/** 拡張機能の設定スキーマ（FR-001, FR-050） */
export interface ExtensionSettings {
  /** マスターON/OFF */
  enabled: boolean;
  /** 非表示にする左ナビゲーション項目IDの配列 */
  hiddenNavItems: NavItemId[];
  /** 右サイドバー全体を非表示にして中央領域を拡張するか */
  hideRightSidebar: boolean;
  /** 各ツイートに引用リポスト一覧ボタンを表示するか */
  showQuoteListButton: boolean;
  /** 各ツイートにリツイート（リポスト）一覧ボタンを表示するか */
  showRetweetListButton: boolean;
  /** ユーザープロフィール遷移時にリポストを含む全ツイート (/all) を初期表示するか */
  redirectToUserProfileAll: boolean;
  /** 画像・動画ダウンロード機能を有効にするか */
  enableMediaDownload: boolean;
}

/** 初期設定で非表示にする項目（Explore・History以外） */
export const DEFAULT_HIDDEN_NAV_ITEMS: readonly NavItemId[] = Object.freeze([
  "post",
  "premium",
  "follow",
  "chat",
  "calls",
  "creator_studio",
  "grok",
  "jobs",
  "lists",
  "communities",
  "business",
  "ads",
  "spaces",
]);

/** 初期設定値（spec.md 2.7 準拠） */
export const DEFAULT_SETTINGS: Readonly<ExtensionSettings> = Object.freeze({
  enabled: true,
  hiddenNavItems: [...DEFAULT_HIDDEN_NAV_ITEMS],
  hideRightSidebar: false,
  showQuoteListButton: true,
  showRetweetListButton: true,
  redirectToUserProfileAll: true,
  enableMediaDownload: true,
});

/** chrome.storage.local 保存キー */
export const SETTINGS_STORAGE_KEY = "yosoix_settings_v1";

/** 動画バリアント情報（spec.md 4.4） */
export interface VideoVariant {
  url: string;
  contentType: string;
  bitrate?: number;
}

/** 投稿内の個別メディア情報（spec.md 4.4） */
export interface TweetMediaItem {
  tweetId: string;
  screenName: string;
  createdAt?: string;
  /** 同一投稿内の連番（1始まり） */
  mediaIndex: number;
  type: "image" | "video";
  /** 画像の場合の元URL（pbs.twimg.com 等） */
  originalUrl?: string;
  /** 動画・GIFの場合のバリアント一覧 */
  variants?: VideoVariant[];
}

/** 投稿単位のキャッシュエントリ（spec.md 4.4） */
export interface TweetMediaCacheEntry {
  tweetId: string;
  screenName?: string;
  quoteCount?: number;
  retweetCount?: number;
  media: TweetMediaItem[];
  capturedAt: number;
}

/**
 * MAIN world → ISOLATED world 間の window.postMessage エンベロープ
 * MAIN world は信頼境界外として扱い、受信側で必ずスキーマ・URL検証を行う。
 */
export const BRIDGE_NAMESPACE = "__yosoix_bridge_v1__" as const;

export interface BridgeMediaCapturedEnvelope {
  readonly [BRIDGE_NAMESPACE]: true;
  readonly type: "MEDIA_CAPTURED";
  readonly entries: TweetMediaCacheEntry[];
}

export interface BridgeReadyEnvelope {
  readonly [BRIDGE_NAMESPACE]: true;
  readonly type: "BRIDGE_READY";
  readonly captureEnabled: boolean;
  readonly includeMedia: boolean;
  readonly trackNavigation: boolean;
}

/** Background Service Worker へ渡す個別ファイルダウンロード指示 */
export interface DownloadFileSpec {
  mediaIndex: number;
  url: string;
  /** 例: XMedia/username_1234567890123456789_01.jpg */
  filename: string;
}

/** ダウンロード失敗理由コード */
export type DownloadErrorCode =
  | "CACHE_MISS"
  | "NO_MEDIA"
  | "HLS_UNSUPPORTED"
  | "INVALID_URL"
  | "INVALID_FILENAME"
  | "DOWNLOAD_API_ERROR"
  | "RUNTIME_ERROR";

export interface DownloadErrorDetail {
  mediaIndex?: number;
  code: DownloadErrorCode;
  message: string;
}

/** Content Script → Background Service Worker ダウンロード要求（spec.md 4.7） */
export interface DownloadMediaMessage {
  type: "DOWNLOAD_MEDIA";
  tweetId: string;
  items: DownloadFileSpec[];
}

/** Options UI → Content Script 設定変更通知（storage.onChanged の補助） */
export interface SettingsChangedMessage {
  type: "SETTINGS_CHANGED";
  settings: ExtensionSettings;
}

export type RuntimeMessage = DownloadMediaMessage | SettingsChangedMessage;

/** Background Service Worker → Content Script ダウンロード結果（spec.md 4.7） */
export interface DownloadResultMessage {
  type: "DOWNLOAD_RESULT";
  tweetId: string;
  startedCount: number;
  failedCount: number;
  errors: DownloadErrorDetail[];
}

/** ダウンロードボタンのUI状態（spec.md 2.6.5） */
export type DownloadButtonState = "idle" | "loading" | "success" | "error";

export interface TweetDownloadStatus {
  state: DownloadButtonState;
  message?: string;
  updatedAt: number;
}
