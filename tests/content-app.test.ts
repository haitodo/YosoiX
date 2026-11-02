// @vitest-environment-options {"url":"https://x.com/home"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentApp } from "../src/content/app";
import { MediaCache } from "../src/core/media-cache";
import { BRIDGE_NAMESPACE, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, type ExtensionSettings } from "../src/core/types";
import { mockFrames, setVisibility, settle, tweetMarkup } from "./runtime-helpers";

describe("ContentApp の休止・復帰と機能別停止", () => {
  let app: ContentApp;
  let clock: ReturnType<typeof mockFrames>;
  let settings: ExtensionSettings;
  let change: (changes: Record<string, { newValue: ExtensionSettings }>, area: string) => void;
  beforeEach(() => {
    setVisibility("visible");
    window.history.replaceState(null, "", "/home");
    document.body.innerHTML = `<div id="react-root"><header role="banner"><nav role="navigation"></nav><a data-testid="SideNav_NewTweet_Button" href="/compose/post">Post</a></header><main role="main">${tweetMarkup()}</main></div><div id="layers"></div>`;
    settings = { ...DEFAULT_SETTINGS, hiddenNavItems: [], redirectToUserProfileAll: false };
    clock = mockFrames();
    vi.stubGlobal("chrome", { storage: {
      local: { get: vi.fn(async () => ({ [SETTINGS_STORAGE_KEY]: settings })) },
      onChanged: { addListener: vi.fn((listener) => { change = listener; }), removeListener: vi.fn() },
    }, runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    vi.spyOn(window, "postMessage").mockImplementation(() => {});
    app = new ContentApp();
  });
  afterEach(() => { app.destroy(); vi.unstubAllGlobals(); });
  function update(partial: Partial<ExtensionSettings>) {
    settings = { ...settings, ...partial };
    change({ [SETTINGS_STORAGE_KEY]: { newValue: settings } }, "local");
  }
  function captured() {
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin,
      data: { [BRIDGE_NAMESPACE]: true, type: "MEDIA_CAPTURED", entries: [
        { tweetId: "123", quoteCount: 42, retweetCount: 9, media: [], capturedAt: Date.now() },
      ] } }));
  }

  it("非表示中は監視・DOM更新・キャッシュ更新を止め、復帰すると新しい投稿にも反映する", async () => {
    await app.init(); clock.flush(); await settle();
    setVisibility("hidden");
    const cache = vi.spyOn(MediaCache.prototype, "upsertMany");
    const query = vi.spyOn(document, "querySelectorAll");
    document.querySelector("main")!.innerHTML = tweetMarkup("456");
    captured(); await settle();
    expect(cache).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(clock.frames.size).toBe(0);
    expect(document.querySelector('[data-yosoix-action="quotes"]')).toBeNull();
    setVisibility("visible"); clock.flush();
    expect(document.querySelector('[data-yosoix-action="quotes"]')?.getAttribute("data-yosoix-tweet-id")).toBe("456");
  });

  it("API更新は全投稿を検索せず、同じ投稿への複数通知を1フレームにまとめる", async () => {
    await app.init(); clock.flush(); await settle();
    const query = vi.spyOn(document, "querySelectorAll");
    for (let i = 0; i < 10; i++) captured();
    expect(query).not.toHaveBeenCalled();
    expect(clock.frames.size).toBe(1);
    clock.flush();
    expect(document.querySelector(".yosoix-quote-btn .yosoix-btn-label")?.textContent).toBe("引用 42");
    await settle();
    expect(clock.frames.size).toBe(0);
  });

  it("全機能無効時はDOM監視とクリック等のリスナーを登録せず、APIも無効にする", async () => {
    settings = { ...settings, showQuoteListButton: false, showRetweetListButton: false, enableMediaDownload: false };
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const listen = vi.spyOn(document, "addEventListener");
    await app.init();
    expect(observe).not.toHaveBeenCalled();
    expect(listen.mock.calls.some(([event]) => ["click", "keydown", "mouseover"].includes(event))).toBe(false);
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({ captureEnabled: false, trackNavigation: false }), window.location.origin);
    expect(clock.frames.size).toBe(0);
  });

  it("マスターOFFではボタンを除去して受信も停止し、ONで復元する", async () => {
    await app.init(); clock.flush();
    update({ enabled: false });
    const cache = vi.spyOn(MediaCache.prototype, "upsertMany");
    captured();
    expect(cache).not.toHaveBeenCalled();
    expect(document.querySelector(".yosoix-action-slot")).toBeNull();
    expect(clock.frames.size).toBe(0);
    update({ enabled: true }); clock.flush();
    expect(document.querySelector(".yosoix-action-slot")).not.toBeNull();
  });

  it("投稿ボタンは初期表示を維持し、設定で非表示・復元できる", async () => {
    await app.init(); clock.flush();
    const button = document.querySelector('[data-testid="SideNav_NewTweet_Button"]')!;
    expect(button.hasAttribute("data-yosoix-nav-hidden")).toBe(false);
    update({ hiddenNavItems: ["post"] }); clock.flush();
    expect(button.getAttribute("data-yosoix-nav-hidden")).toBe("post");
    update({ hiddenNavItems: [] }); clock.flush();
    expect(button.hasAttribute("data-yosoix-nav-hidden")).toBe(false);
  });

  it("投稿機能が無効でも履歴変更通知によるプロフィールの/all誘導は働く", async () => {
    settings = { ...settings, showQuoteListButton: false, showRetweetListButton: false, enableMediaDownload: false, redirectToUserProfileAll: true };
    await app.init();
    window.history.pushState(null, "", "/alice");
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin,
      data: { [BRIDGE_NAMESPACE]: true, type: "ROUTE_CHANGED" } }));
    expect(window.location.pathname).toBe("/alice/all");
    expect(clock.frames.size).toBe(0);
  });
});
