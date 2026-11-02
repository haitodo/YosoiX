// @vitest-environment-options {"url":"https://x.com/home"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPageBridge } from "../src/bridge/page-bridge";
import { MAX_RESPONSE_BYTES } from "../src/bridge/response-parser";
import { BRIDGE_NAMESPACE, type TweetMediaCacheEntry } from "../src/core/types";
import { mockFrames, setVisibility, settle } from "./runtime-helpers";

const api = "https://x.com/i/api/graphql/hash/HomeTimeline";
const payload = (id = "123") => JSON.stringify({ rest_id: id, legacy: {
  quote_count: 7, retweet_count: 9,
  extended_entities: { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/test.jpg" }] },
} });

function response(text: string, contentLength?: number) {
  const bytes = new TextEncoder().encode(text);
  return {
    ok: true,
    headers: new Headers({ "content-type": "application/json", ...(contentLength ? { "content-length": String(contentLength) } : {}) }),
    clone: vi.fn(() => ({ body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) })),
  } as unknown as Response;
}

function configure(captureEnabled = true, includeMedia = true, trackNavigation = false) {
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin,
    data: { [BRIDGE_NAMESPACE]: true, type: "BRIDGE_READY", captureEnabled, includeMedia, trackNavigation } }));
}

describe("Page Bridge の負荷制御", () => {
  let cleanup: () => void;
  let clock: ReturnType<typeof mockFrames>;
  let send: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setVisibility("visible");
    clock = mockFrames();
    send = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  });
  afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });
  const messages = () => send.mock.calls.map(([data]) => data as { type: string; entries: TweetMediaCacheEntry[] });
  const entries = () => messages().filter((data) => data.type === "MEDIA_CAPTURED").flatMap((data) => data.entries);

  it("元のPromiseを返し、OFF時と無関係な通信ではレスポンスを複製しない", async () => {
    const res = response(payload());
    const promise = Promise.resolve(res);
    const original = vi.fn(() => promise);
    vi.stubGlobal("fetch", original);
    cleanup = installPageBridge();
    configure(false);
    expect(window.fetch(api)).toBe(promise);
    await settle();
    expect(res.clone).not.toHaveBeenCalled();
    configure();
    await window.fetch("https://x.com/i/api/graphql/hash/Viewer");
    await settle();
    expect(res.clone).not.toHaveBeenCalled();
    await window.fetch(api);
    await settle();
    expect(entries()[0]!.quoteCount).toBe(7);
  });

  it("初期設定到着前はJSON解析せず、設定取得後に初期レスポンスを復元する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(payload())));
    cleanup = installPageBridge();
    const parse = vi.spyOn(JSON, "parse");
    await window.fetch(api); await settle();
    expect(parse).not.toHaveBeenCalled();
    expect(entries()).toHaveLength(0);
    configure(); clock.flush();
    expect(entries()[0]!.tweetId).toBe("123");
  });

  it("非表示ではJSON解析・転送を止め、復帰時は直近4レスポンスだけ再生する", async () => {
    const original = vi.fn();
    vi.stubGlobal("fetch", original);
    cleanup = installPageBridge(); configure();
    setVisibility("hidden");
    const parse = vi.spyOn(JSON, "parse");
    for (let i = 1; i <= 7; i++) {
      original.mockResolvedValue(response(payload(String(i))));
      await window.fetch(api); await settle();
    }
    expect(parse).not.toHaveBeenCalled();
    expect(clock.frames.size).toBe(0);
    expect(entries()).toHaveLength(0);
    setVisibility("visible");
    for (let i = 0; i < 5; i++) clock.flush();
    expect(entries().map((entry) => entry.tweetId)).toEqual(["4", "5", "6", "7"]);
    expect(clock.frames.size).toBe(0);
  });

  it("非表示中にOFFにするとバッファを破棄し、復帰後にも解析しない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(payload())));
    cleanup = installPageBridge(); configure(); setVisibility("hidden");
    await window.fetch(api); await settle();
    configure(false); setVisibility("visible"); clock.flush();
    expect(entries()).toHaveLength(0);
    configure(); clock.flush();
    expect(entries()).toHaveLength(0);
  });

  it("DL無効時はメディアを抽出せず、再有効化時は保持データから復元する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(payload())));
    cleanup = installPageBridge(); configure(true, false);
    await window.fetch(api); await settle();
    expect(entries()[0]!.media).toHaveLength(0);
    configure(true, true); clock.flush();
    expect(entries().at(-1)!.media).toHaveLength(1);
    expect(clock.frames.size).toBe(0);
  });

  it("巨大レスポンスはヘッダーで除外し、長さ不明でもストリーム読み込み上限で中断する", async () => {
    const large = response("{}", MAX_RESPONSE_BYTES + 1);
    const original = vi.fn().mockResolvedValue(large);
    vi.stubGlobal("fetch", original);
    cleanup = installPageBridge(); configure();
    await window.fetch(api); await settle();
    expect(large.clone).not.toHaveBeenCalled();
    const cancel = vi.fn();
    original.mockResolvedValue({ ok: true, headers: new Headers({ "content-type": "application/json" }),
      clone: () => ({ body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); }, cancel }) }) });
    await window.fetch(api); await settle();
    expect(cancel).toHaveBeenCalled();
    expect(entries()).toHaveLength(0);
  });

  it("読み込み途中のOFFで解析を中止し、元レスポンスには触れない", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      clone: () => ({ body: new ReadableStream({ start(c) { stream = c; }, cancel }) }) }));
    cleanup = installPageBridge(); configure();
    await window.fetch(api); await settle();
    expect(stream).toBeDefined();
    configure(false); await settle();
    expect(cancel).toHaveBeenCalled();
    expect(entries()).toHaveLength(0);
  });

  it("履歴通知は有効な場合だけ送り、URLが変わらない更新は無視する", () => {
    cleanup = installPageBridge(); configure(false, false, true);
    window.history.pushState(null, "", "/alice");
    window.history.replaceState(null, "", "/alice");
    expect(messages().filter((data) => data.type === "ROUTE_CHANGED")).toHaveLength(1);
    configure(false, false, false);
    window.history.pushState(null, "", "/home");
    expect(messages().filter((data) => data.type === "ROUTE_CHANGED")).toHaveLength(1);
  });

  it("復帰直後の新しいレスポンスを、古いバッファの後に反映する", async () => {
    const original = vi.fn().mockResolvedValue(response(payload("1")));
    vi.stubGlobal("fetch", original);
    cleanup = installPageBridge(); configure(); setVisibility("hidden");
    await window.fetch(api); await settle();
    setVisibility("visible");
    original.mockResolvedValue(response(payload("2")));
    await window.fetch(api); await settle();
    clock.flush(); clock.flush();
    expect(entries().map((entry) => entry.tweetId)).toEqual(["1", "2"]);
    expect(clock.frames.size).toBe(0);
  });

  it("非表示バッファは件数だけでなく合計サイズでも古いレスポンスを破棄する", async () => {
    const original = vi.fn(); vi.stubGlobal("fetch", original);
    cleanup = installPageBridge(); configure(); setVisibility("hidden");
    for (let i = 1; i <= 3; i++) {
      original.mockResolvedValue(response(JSON.stringify({ tweet: JSON.parse(payload(String(i))), padding: "x".repeat(750_000) })));
      await window.fetch(api); await settle();
    }
    setVisibility("visible"); clock.flush(); clock.flush(); clock.flush();
    expect(entries().map((entry) => entry.tweetId)).toEqual(["2", "3"]);
  });

  it("ページ離脱中は処理を止め、BFCache復帰後は通信捕捉を再開する", async () => {
    const res = response(payload()); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    cleanup = installPageBridge(); configure();
    window.dispatchEvent(new Event("pagehide"));
    await window.fetch(api); await settle();
    expect(res.clone).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pageshow"));
    await window.fetch(api); await settle();
    expect(entries()).toHaveLength(1);
  });

  it("XHRの再利用でリスナーを重複させず、OFF後は解析しない", () => {
    class FakeXHR extends EventTarget {
      status = 200;
      responseType = "text";
      responseText = payload();
      open(_method: string, _url: string) {}
      send() {}
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    cleanup = installPageBridge(); configure();
    const xhr = new FakeXHR();
    xhr.open("GET", api); xhr.send(); xhr.dispatchEvent(new Event("loadend"));
    xhr.open("GET", api); xhr.send(); xhr.dispatchEvent(new Event("loadend"));
    expect(entries()).toHaveLength(2);
    xhr.open("GET", api); xhr.send(); configure(false); xhr.dispatchEvent(new Event("loadend"));
    expect(entries()).toHaveLength(2);
  });
});
