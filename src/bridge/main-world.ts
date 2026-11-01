import {
  BRIDGE_NAMESPACE,
  type BridgeMediaCapturedEnvelope,
  type TweetMediaCacheEntry,
} from "../core/types";
import {
  extractEntriesFromResponseJson,
  extractEntriesFromResponseText,
  isTargetApiUrl,
} from "./response-parser";

/**
 * Page Bridge: MAIN world レスポンス捕捉スクリプト（spec.md 4.2）
 *
 * document_start で実行され、X Web クライアントが受信する API レスポンスを非侵襲に読み取る。
 *
 * 厳守事項:
 * - リクエストヘッダー、Cookie、CSRF トークン、ボディを一切変更・保存しない。
 * - fetch は Response.clone() を使用し、元の Promise<Response> をそのまま返す。
 * - XMLHttpRequest は WeakMap と passive な load イベントのみを使用し、X 本体のハンドラーに干渉しない。
 * - 生レスポンス全文は転送せず、必要最小限の TweetMediaCacheEntry[] のみを postMessage する。
 */

const INSTALLED_GUARD = Symbol.for("yosoix.bridge.installed.v1");
const MAX_EARLY_BUFFER_ENTRIES = 200;

interface GuardedWindow extends Window {
  [INSTALLED_GUARD]?: boolean;
}

let isConsumerReady = false;
const earlyEntryBuffer: TweetMediaCacheEntry[] = [];

function postMediaCaptured(entries: TweetMediaCacheEntry[]): void {
  if (entries.length === 0) return;

  const origin = window.location.origin;
  if (origin !== "https://x.com" && origin !== "https://twitter.com") {
    return;
  }

  const envelope: BridgeMediaCapturedEnvelope = {
    [BRIDGE_NAMESPACE]: true,
    type: "MEDIA_CAPTURED",
    entries,
  };

  try {
    window.postMessage(envelope, origin);
  } catch {
    // postMessage 失敗時もページ本体へ例外を伝播させない
  }
}

/**
 * document_start 〜 document_end の間に到着した初期 API レスポンスを取りこぼさないよう、
 * Content Script (ISOLATED world) から BRIDGE_READY が届くまではリングバッファに保持し、
 * 準備完了と同時にフラッシュする。
 */
function emitCapturedEntries(entries: TweetMediaCacheEntry[]): void {
  if (entries.length === 0) return;

  if (!isConsumerReady) {
    for (const entry of entries) {
      if (earlyEntryBuffer.length >= MAX_EARLY_BUFFER_ENTRIES) {
        earlyEntryBuffer.shift();
      }
      earlyEntryBuffer.push(entry);
    }
    return;
  }

  postMediaCaptured(entries);
}

function installReadyHandshakeListener(): void {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window) return;
    if (event.origin !== "https://x.com" && event.origin !== "https://twitter.com") return;
    if (typeof event.data !== "object" || event.data === null) return;

    const record = event.data as Record<string, unknown>;
    if (record[BRIDGE_NAMESPACE] === true && record.type === "BRIDGE_READY") {
      isConsumerReady = true;
      if (earlyEntryBuffer.length > 0) {
        const buffered = earlyEntryBuffer.splice(0, earlyEntryBuffer.length);
        postMediaCaptured(buffered);
      }
    }
  });
}

function resolveFetchRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "";
}

function installFetchHook(): void {
  if (typeof window.fetch !== "function") return;

  const originalFetch = window.fetch;
  window.fetch = new Proxy(originalFetch, {
    apply(target, thisArg, argArray: Parameters<typeof fetch>) {
      const responsePromise = Reflect.apply(target, thisArg, argArray) as Promise<Response>;

      try {
        const requestUrl = resolveFetchRequestUrl(argArray[0]);
        if (isTargetApiUrl(requestUrl, window.location.origin)) {
          // ページ側に返す Promise チェーンとは完全に分離した非同期ブランチで解析する
          void responsePromise
            .then((response) => {
              if (!response.ok) return;
              const contentType = response.headers.get("content-type") ?? "";
              if (!contentType.toLowerCase().includes("json")) return;
              return response
                .clone()
                .text()
                .then((text) => {
                  const entries = extractEntriesFromResponseText(text);
                  emitCapturedEntries(entries);
                });
            })
            .catch(() => {
              // 解析失敗は無視し、X 本来の動作を保護
            });
        }
      } catch {
        // URL 判定例外も隔離
      }

      return responsePromise;
    },
  });
}

function installXhrHook(): void {
  if (typeof XMLHttpRequest === "undefined") return;

  const trackedRequests = new WeakMap<XMLHttpRequest, { target: boolean }>();
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = new Proxy(originalOpen, {
    apply(target, thisArg: XMLHttpRequest, argArray: Parameters<XMLHttpRequest["open"]>) {
      try {
        const rawUrl = argArray[1];
        const urlStr = typeof rawUrl === "string" ? rawUrl : rawUrl ? String(rawUrl) : "";
        if (isTargetApiUrl(urlStr, window.location.origin)) {
          trackedRequests.set(thisArg, { target: true });
        } else {
          trackedRequests.delete(thisArg);
        }
      } catch {
        // 隔離
      }
      return Reflect.apply(target, thisArg, argArray);
    },
  });

  proto.send = new Proxy(originalSend, {
    apply(target, thisArg: XMLHttpRequest, argArray: Parameters<XMLHttpRequest["send"]>) {
      try {
        const meta = trackedRequests.get(thisArg);
        if (meta?.target) {
          thisArg.addEventListener(
            "load",
            () => {
              try {
                if (thisArg.status < 200 || thisArg.status >= 300) return;

                const responseType = thisArg.responseType;
                if (responseType === "" || responseType === "text") {
                  const entries = extractEntriesFromResponseText(thisArg.responseText);
                  emitCapturedEntries(entries);
                } else if (responseType === "json" && thisArg.response !== null) {
                  const entries = extractEntriesFromResponseJson(thisArg.response);
                  emitCapturedEntries(entries);
                }
              } catch {
                // XHR 読み取り例外を隔離
              }
            },
            { once: true, passive: true },
          );
        }
      } catch {
        // 隔離
      }
      return Reflect.apply(target, thisArg, argArray);
    },
  });
}

function bootstrapMainWorld(): void {
  const win = window as GuardedWindow;
  if (win[INSTALLED_GUARD]) return;
  win[INSTALLED_GUARD] = true;

  installReadyHandshakeListener();
  installFetchHook();
  installXhrHook();
}

bootstrapMainWorld();
