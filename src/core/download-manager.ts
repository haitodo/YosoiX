import { buildMediaFilename } from "./filename";
import type { MediaCache } from "./media-cache";
import { selectBestMp4Variant, toOriginalImageUrl } from "./media-parser";
import type {
  DownloadErrorDetail,
  DownloadFileSpec,
  DownloadMediaMessage,
  DownloadResultMessage,
  TweetDownloadStatus,
  TweetMediaItem,
} from "./types";
import { isPlainObject } from "./validators";

/**
 * メディアダウンロード状態管理＆実行オーケストレーター（spec.md 2.6.5, 2.6.6, 3.2）
 *
 * 難所への対応:
 * 1. X の仮想スクロール（cellInnerDiv のアンマウント／再マウント）でボタン DOM が作り直されても
 *    処理中（loading）・完了（success）・失敗（error）表示が消えないよう、状態を tweetId キーでメモリ保持する。
 * 2. 同一 tweetId の処理中（loading）は連続クリックによる重複ダウンロードを確実にブロックする。
 * 3. 画像＋動画の混在投稿で一部が HLS 未対応等で失敗しても、取得可能な残りメディアはダウンロードを継続する。
 */

const MAX_STATUS_ENTRIES = 300;

export type DownloadStatusListener = (tweetId: string, status: TweetDownloadStatus) => void;

export type SendDownloadMessageFn = (
  message: DownloadMediaMessage,
) => Promise<DownloadResultMessage>;

function defaultSendDownloadMessage(message: DownloadMediaMessage): Promise<DownloadResultMessage> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve({
            type: "DOWNLOAD_RESULT",
            tweetId: message.tweetId,
            startedCount: 0,
            failedCount: message.items.length,
            errors: [
              {
                code: "RUNTIME_ERROR",
                message: "バックグラウンド処理との通信に失敗しました。ページを再読み込みしてください。",
              },
            ],
          });
          return;
        }

        if (isPlainObject(response) && response.type === "DOWNLOAD_RESULT") {
          resolve(response as unknown as DownloadResultMessage);
          return;
        }

        resolve({
          type: "DOWNLOAD_RESULT",
          tweetId: message.tweetId,
          startedCount: 0,
          failedCount: message.items.length,
          errors: [
            {
              code: "RUNTIME_ERROR",
              message: "ダウンロード結果を取得できませんでした。",
            },
          ],
        });
      });
    } catch {
      resolve({
        type: "DOWNLOAD_RESULT",
        tweetId: message.tweetId,
        startedCount: 0,
        failedCount: message.items.length,
        errors: [
          {
            code: "RUNTIME_ERROR",
            message: "拡張機能が更新されました。ページを再読み込みしてから再試行してください。",
          },
        ],
      });
    }
  });
}

export interface ResolvedDownloadPlan {
  files: DownloadFileSpec[];
  skippedErrors: DownloadErrorDetail[];
}

/**
 * TweetMediaItem 一覧からダウンロード可能な URL・ファイル名リストを構築する純粋関数。
 */
export function buildDownloadPlan(
  tweetId: string,
  fallbackScreenName: string | undefined,
  mediaItems: readonly TweetMediaItem[],
): ResolvedDownloadPlan {
  const files: DownloadFileSpec[] = [];
  const skippedErrors: DownloadErrorDetail[] = [];

  for (const item of mediaItems) {
    const screenName = item.screenName || fallbackScreenName || "x_user";

    if (item.type === "image") {
      const resolved = item.originalUrl ? toOriginalImageUrl(item.originalUrl) : null;
      if (!resolved) {
        skippedErrors.push({
          mediaIndex: item.mediaIndex,
          code: "INVALID_URL",
          message: `画像 #${item.mediaIndex} のURLを取得できませんでした。`,
        });
        continue;
      }

      files.push({
        mediaIndex: item.mediaIndex,
        url: resolved.url,
        filename: buildMediaFilename({
          screenName,
          tweetId,
          mediaIndex: item.mediaIndex,
          extension: resolved.extension,
        }),
      });
      continue;
    }

    // video / animated_gif
    const selection = selectBestMp4Variant(item.variants);
    if (!selection.ok) {
      skippedErrors.push({
        mediaIndex: item.mediaIndex,
        code: selection.reason === "HLS_ONLY" ? "HLS_UNSUPPORTED" : "INVALID_URL",
        message:
          selection.reason === "HLS_ONLY"
            ? "HLS形式（.m3u8）のみの動画は現在未対応です。"
            : `動画 #${item.mediaIndex} のMP4 URLを取得できませんでした。`,
      });
      continue;
    }

    files.push({
      mediaIndex: item.mediaIndex,
      url: selection.url,
      filename: buildMediaFilename({
        screenName,
        tweetId,
        mediaIndex: item.mediaIndex,
        extension: "mp4",
      }),
    });
  }

  return { files, skippedErrors };
}

export class DownloadManager {
  private readonly statuses = new Map<string, TweetDownloadStatus>();
  private readonly listeners = new Set<DownloadStatusListener>();
  private readonly mediaCache: MediaCache;
  private readonly sendDownloadMessage: SendDownloadMessageFn;

  constructor(
    mediaCache: MediaCache,
    sendDownloadMessage: SendDownloadMessageFn = defaultSendDownloadMessage,
  ) {
    this.mediaCache = mediaCache;
    this.sendDownloadMessage = sendDownloadMessage;
  }

  getStatus(tweetId: string): TweetDownloadStatus {
    return (
      this.statuses.get(tweetId) ?? {
        state: "idle",
        updatedAt: 0,
      }
    );
  }

  subscribe(listener: DownloadStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 対象ツイートのメディア一括ダウンロードを開始する。
   * すでに loading 中の場合は重複実行せず即座に終了する。
   */
  async downloadTweetMedia(tweetId: string, fallbackScreenName?: string): Promise<void> {
    const current = this.statuses.get(tweetId);
    if (current?.state === "loading") {
      return;
    }

    const entry = this.mediaCache.get(tweetId);
    if (!entry || entry.media.length === 0) {
      this.setStatus(tweetId, {
        state: "error",
        message:
          "メディア情報を取得できませんでした。ページを再読み込みしてから再試行してください。",
        updatedAt: Date.now(),
      });
      return;
    }

    this.setStatus(tweetId, {
      state: "loading",
      message: "メディアをダウンロードしています…",
      updatedAt: Date.now(),
    });

    const plan = buildDownloadPlan(
      tweetId,
      entry.screenName ?? fallbackScreenName,
      entry.media,
    );

    if (plan.files.length === 0) {
      const firstError =
        plan.skippedErrors[0]?.message ?? "ダウンロード可能なメディアが見つかりませんでした。";
      this.setStatus(tweetId, {
        state: "error",
        message: firstError,
        updatedAt: Date.now(),
      });
      return;
    }

    const result = await this.sendDownloadMessage({
      type: "DOWNLOAD_MEDIA",
      tweetId,
      items: plan.files,
    });

    const totalFailed = plan.skippedErrors.length + result.failedCount;
    const allErrors = [...plan.skippedErrors, ...result.errors];

    if (result.startedCount > 0 && totalFailed === 0) {
      this.setStatus(tweetId, {
        state: "success",
        message: `${result.startedCount}件のメディアを保存しました`,
        updatedAt: Date.now(),
      });
      return;
    }

    if (result.startedCount > 0 && totalFailed > 0) {
      const reason = allErrors[0]?.message ?? "一部ファイルの保存に失敗しました";
      this.setStatus(tweetId, {
        state: "error",
        message: `${result.startedCount}件保存 / ${totalFailed}件失敗（${reason}）`,
        updatedAt: Date.now(),
      });
      return;
    }

    const reason =
      allErrors[0]?.message ??
      "ダウンロードに失敗しました。ページを再読み込みしてから再試行してください。";
    this.setStatus(tweetId, {
      state: "error",
      message: reason,
      updatedAt: Date.now(),
    });
  }

  private setStatus(tweetId: string, status: TweetDownloadStatus): void {
    if (this.statuses.has(tweetId)) {
      this.statuses.delete(tweetId);
    }
    this.statuses.set(tweetId, status);

    while (this.statuses.size > MAX_STATUS_ENTRIES) {
      const oldestKey = this.statuses.keys().next().value;
      if (oldestKey === undefined) break;
      // 処理中のエントリは誤って削除しない
      if (this.statuses.get(oldestKey)?.state === "loading") break;
      this.statuses.delete(oldestKey);
    }

    for (const listener of this.listeners) {
      listener(tweetId, status);
    }
  }
}
