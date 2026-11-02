import { BRIDGE_NAMESPACE, type BridgeMediaCapturedEnvelope, type TweetMediaCacheEntry } from "../core/types";
import { extractEntriesFromResponseJson, extractEntriesFromResponseText, isTargetApiUrl, MAX_RESPONSE_BYTES } from "./response-parser";

const MAX_BUFFERED_RESPONSES = 4;
const MAX_CONCURRENT_READS = 2;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const INSTALLED_GUARD = Symbol.for("yosoix.bridge.installed.v1");

/** 元の通信を変更しない。OFF時はURL判定もせず、非表示時は上限付きの生データだけ保持する。 */
export function installPageBridge(): () => void {
  const guarded = window as unknown as Record<symbol, boolean>;
  if (guarded[INSTALLED_GUARD]) return () => {};
  guarded[INSTALLED_GUARD] = true;
  let configured = false;
  let captureEnabled = true;
  let includeMedia = true;
  let trackNavigation = false;
  let generation = 0;
  let bufferBytes = 0;
  let lastPath = window.location.pathname;
  const buffer: { text: string; bytes: number; pending: boolean }[] = [];
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const originalFetch = window.fetch;
  const proto = window.XMLHttpRequest?.prototype;
  const originalOpen = proto?.open;
  const originalSend = proto?.send;
  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;
  const tracked = new WeakMap<XMLHttpRequest, boolean>();
  const xhrListeners = new WeakMap<XMLHttpRequest, EventListener>();
  let stopped = false;
  let suspended = false;

  const allowed = (): boolean => !stopped && !suspended && captureEnabled;
  const canParse = (): boolean => configured && allowed() && document.visibilityState !== "hidden";
  const cancelReaders = (): void => {
    for (const reader of readers) void reader.cancel().catch(() => {});
    readers.clear();
  };
  const clearBuffer = (): void => { buffer.length = 0; bufferBytes = 0; };
  const post = (entries: TweetMediaCacheEntry[]): void => {
    if (!canParse()) return;
    // 受信側の検証上限に合わせて分割し、200件超のレスポンスも欠落させない。
    for (let offset = 0; offset < entries.length; offset += 200) {
      const message: BridgeMediaCapturedEnvelope = {
        [BRIDGE_NAMESPACE]: true, type: "MEDIA_CAPTURED", entries: entries.slice(offset, offset + 200),
      };
      window.postMessage(message, window.location.origin);
    }
  };
  const captureText = (text: string, replayed = false): void => {
    if (!allowed() || !text || text.length > MAX_RESPONSE_BYTES) return;
    const defer = !canParse() || (!replayed && buffer.some((item) => item.pending));
    if (!defer) {
      post(extractEntriesFromResponseText(text, includeMedia));
    }
    // 件数表示だけの場合も直近の生データを残し、DLをONにした際に再取得せず復元する。
    if (defer || !includeMedia) {
      const bytes = text.length * 2;
      if (bytes > MAX_BUFFER_BYTES) return;
      while (buffer.length && (buffer.length >= MAX_BUFFERED_RESPONSES || bufferBytes + bytes > MAX_BUFFER_BYTES)) {
        bufferBytes -= buffer.shift()!.bytes;
      }
      buffer.push({ text, bytes, pending: defer });
      bufferBytes += bytes;
      if (defer) replay();
    }
  };
  let replayFrame: number | null = null;
  const replay = (): void => {
    if (!canParse() || !buffer.some((item) => item.pending) || replayFrame !== null) return;
    // 復帰時も一度に全レスポンスを解析しない。
    replayFrame = requestAnimationFrame(() => {
      replayFrame = null;
      if (!canParse()) return;
      const index = buffer.findIndex((item) => item.pending);
      const next = index < 0 ? undefined : buffer.splice(index, 1)[0];
      if (next) { bufferBytes -= next.bytes; captureText(next.text, true); }
      replay();
    });
  };
  const cancelReplay = (): void => {
    if (replayFrame !== null) cancelAnimationFrame(replayFrame);
    replayFrame = null;
  };
  const readResponse = async (response: Response): Promise<void> => {
    if (!allowed() || readers.size >= MAX_CONCURRENT_READS || !response.ok) return;
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) return;
    const length = Number(response.headers.get("content-length"));
    if (length > MAX_RESPONSE_BYTES) return;
    const branchGeneration = generation;
    const reader = response.clone().body?.getReader();
    if (!reader) return;
    readers.add(reader);
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let bytes = 0;
    try {
      while (allowed() && branchGeneration === generation) {
        const chunk = await reader.read();
        if (!allowed() || branchGeneration !== generation) return;
        if (chunk.done) {
          parts.push(decoder.decode());
          captureText(parts.join(""));
          return;
        }
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) return;
        if (parts.length >= 4096) return;
        parts.push(decoder.decode(chunk.value, { stream: true }));
      }
    } finally {
      readers.delete(reader);
      void reader.cancel().catch(() => {});
    }
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    if (data[BRIDGE_NAMESPACE] !== true || data.type !== "BRIDGE_READY" ||
      typeof data.captureEnabled !== "boolean" || typeof data.includeMedia !== "boolean" ||
      typeof data.trackNavigation !== "boolean") return;
    configured = true;
    if (captureEnabled !== data.captureEnabled) {
      generation++;
      cancelReaders();
      clearBuffer();
    }
    if (!includeMedia && data.includeMedia) for (const item of buffer) item.pending = true;
    captureEnabled = data.captureEnabled;
    includeMedia = data.includeMedia;
    trackNavigation = data.trackNavigation;
    if (!captureEnabled) { cancelReplay(); clearBuffer(); }
    else replay();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") cancelReplay();
    else replay();
  };
  const onRoute = (): void => {
    const path = window.location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    if (trackNavigation && document.visibilityState !== "hidden") {
      window.postMessage({ [BRIDGE_NAMESPACE]: true, type: "ROUTE_CHANGED" }, window.location.origin);
    }
  };
  const onPageHide = (): void => { suspended = true; generation++; cancelReaders(); cancelReplay(); clearBuffer(); };
  const onPageShow = (): void => { suspended = false; lastPath = window.location.pathname; };
  const onPopState = (): void => { lastPath = window.location.pathname; };
  window.addEventListener("message", onMessage);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("popstate", onPopState);

  const fetchHook = typeof originalFetch === "function" ? new Proxy(originalFetch, {
    apply(target, thisArg, args: Parameters<typeof fetch>) {
      const promise = Reflect.apply(target, thisArg, args) as Promise<Response>;
      if (!allowed()) return promise;
      try {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (isTargetApiUrl(url, window.location.origin)) {
          void promise.then(readResponse).catch(() => {});
        }
      } catch { /* ページの通信へ例外を伝えない */ }
      return promise;
    },
  }) : originalFetch;
  if (fetchHook) window.fetch = fetchHook;

  const openHook = originalOpen && new Proxy(originalOpen, {
    apply(target, xhr: XMLHttpRequest, args: Parameters<XMLHttpRequest["open"]>) {
      const previous = xhrListeners.get(xhr);
      if (previous) { xhr.removeEventListener("loadend", previous); xhrListeners.delete(xhr); }
      tracked.delete(xhr);
      if (allowed()) {
        try { if (isTargetApiUrl(String(args[1]), window.location.origin)) tracked.set(xhr, true); } catch { /* 隔離 */ }
      }
      return Reflect.apply(target, xhr, args);
    },
  });
  const sendHook = originalSend && new Proxy(originalSend, {
    apply(target, xhr: XMLHttpRequest, args: Parameters<XMLHttpRequest["send"]>) {
      if (allowed() && tracked.get(xhr)) {
        const listener: EventListener = () => {
          xhrListeners.delete(xhr);
          if (!allowed() || xhr.status < 200 || xhr.status >= 300) return;
          try {
            if (xhr.responseType === "" || xhr.responseType === "text") captureText(xhr.responseText);
            else if (xhr.responseType === "json" && xhr.response !== null) {
              if (canParse() && includeMedia && !buffer.some((item) => item.pending)) {
                post(extractEntriesFromResponseJson(xhr.response, includeMedia));
              } else {
                // 既にブラウザーが解析したJSONも、上限を超える走査・文字列化を避けて一時保持する。
                let estimatedBytes = 0;
                const text = JSON.stringify(xhr.response, (key, value: unknown) => {
                  estimatedBytes += key.length * 2 + (typeof value === "string" ? value.length * 2 : 16);
                  if (estimatedBytes > MAX_BUFFER_BYTES) throw new RangeError("Response too large");
                  return value;
                });
                captureText(text);
              }
            }
          } catch { /* 隔離 */ }
        };
        xhrListeners.set(xhr, listener);
        xhr.addEventListener("loadend", listener, { once: true, passive: true });
      }
      try {
        return Reflect.apply(target, xhr, args);
      } catch (error) {
        const listener = xhrListeners.get(xhr);
        if (listener) xhr.removeEventListener("loadend", listener);
        xhrListeners.delete(xhr);
        throw error;
      }
    },
  });
  if (proto && openHook && sendHook) { proto.open = openHook; proto.send = sendHook; }
  const historyHook = <T extends History["pushState"]>(original: T): T => new Proxy(original, {
    apply(target, thisArg, args: Parameters<T>) {
      const result = Reflect.apply(target, thisArg, args);
      if (trackNavigation) onRoute();
      return result;
    },
  });
  const pushHook = historyHook(originalPush);
  const replaceHook = historyHook(originalReplace);
  window.history.pushState = pushHook;
  window.history.replaceState = replaceHook;

  return () => {
    stopped = true;
    onPageHide();
    window.removeEventListener("message", onMessage);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("popstate", onPopState);
    if (window.fetch === fetchHook) window.fetch = originalFetch;
    if (proto?.open === openHook && originalOpen) proto.open = originalOpen;
    if (proto?.send === sendHook && originalSend) proto.send = originalSend;
    if (window.history.pushState === pushHook) window.history.pushState = originalPush;
    if (window.history.replaceState === replaceHook) window.history.replaceState = originalReplace;
    delete guarded[INSTALLED_GUARD];
  };
}
