import type {
  DownloadErrorDetail,
  DownloadMediaMessage,
  DownloadResultMessage,
} from "../core/types";
import {
  ALLOWED_PAGE_ORIGINS,
  isAllowedMediaUrl,
  isSafeRelativeDownloadFilename,
  validateDownloadMediaMessage,
} from "../core/validators";

/**
 * Background Service Worker（spec.md 2.6.5, 4.6, 5.3）
 *
 * - Content Script から DOWNLOAD_MEDIA メッセージを受信し、厳格な境界検証を行った上で
 *   chrome.downloads.download() を順次実行する。
 * - 一部ファイルの開始に失敗しても、残りのファイルのダウンロード処理を継続する。
 * - ツールバーアイコンクリック時に設定画面（Options Page）を開く。
 * - コンソールに投稿本文・認証情報・生URLトークンを出力しない。
 */

function isTrustedContentSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) {
    return false;
  }
  const rawSenderUrl = sender.url ?? sender.tab?.url;
  if (!rawSenderUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawSenderUrl);
    return ALLOWED_PAGE_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

function startSingleBrowserDownload(url: string, filename: string): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: "uniquify",
        saveAs: false,
      },
      (downloadId) => {
        const lastError = chrome.runtime.lastError;
        if (lastError || typeof downloadId !== "number") {
          reject(new Error(lastError?.message ?? "DOWNLOAD_FAILED"));
          return;
        }
        resolve(downloadId);
      },
    );
  });
}

async function handleDownloadMediaRequest(
  request: DownloadMediaMessage,
): Promise<DownloadResultMessage> {
  let startedCount = 0;
  let failedCount = 0;
  const errors: DownloadErrorDetail[] = [];

  for (const item of request.items) {
    if (!isAllowedMediaUrl(item.url)) {
      failedCount += 1;
      errors.push({
        mediaIndex: item.mediaIndex,
        code: "INVALID_URL",
        message: `許可されていないメディアURLが拒否されました（#${item.mediaIndex}）`,
      });
      continue;
    }

    if (!isSafeRelativeDownloadFilename(item.filename)) {
      failedCount += 1;
      errors.push({
        mediaIndex: item.mediaIndex,
        code: "INVALID_FILENAME",
        message: `不正なファイル名が拒否されました（#${item.mediaIndex}）`,
      });
      continue;
    }

    try {
      await startSingleBrowserDownload(item.url, item.filename);
      startedCount += 1;
    } catch {
      failedCount += 1;
      errors.push({
        mediaIndex: item.mediaIndex,
        code: "DOWNLOAD_API_ERROR",
        message: `メディア #${item.mediaIndex} のダウンロード開始に失敗しました`,
      });
    }
  }

  return {
    type: "DOWNLOAD_RESULT",
    tweetId: request.tweetId,
    startedCount,
    failedCount,
    errors,
  };
}

// ツールバーアイコンクリックで設定画面を開く
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: DownloadResultMessage) => void,
  ): boolean => {
    if (!isTrustedContentSender(sender)) {
      return false;
    }

    const validated = validateDownloadMediaMessage(rawMessage);
    if (!validated) {
      if (
        typeof rawMessage === "object" &&
        rawMessage !== null &&
        (rawMessage as { type?: unknown }).type === "DOWNLOAD_MEDIA"
      ) {
        const fallbackTweetId =
          typeof (rawMessage as { tweetId?: unknown }).tweetId === "string"
            ? ((rawMessage as { tweetId: string }).tweetId.slice(0, 25))
            : "0";
        sendResponse({
          type: "DOWNLOAD_RESULT",
          tweetId: fallbackTweetId,
          startedCount: 0,
          failedCount: 1,
          errors: [
            {
              code: "INVALID_URL",
              message: "ダウンロード要求の検証に失敗しました。",
            },
          ],
        });
      }
      return false;
    }

    void handleDownloadMediaRequest(validated).then(sendResponse);
    // 非同期で sendResponse を返すため true を返し、MV3 Service Worker の早期終了を防ぐ
    return true;
  },
);
