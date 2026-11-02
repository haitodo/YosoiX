import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomObserver } from "../src/content/dom-observer";
import { mockFrames, settle, tweetMarkup } from "./runtime-helpers";

describe("差分DOM監視の負荷とライフサイクル", () => {
  let observer: DomObserver;
  let clock: ReturnType<typeof mockFrames>;
  const tweets = vi.fn();
  const removed = vi.fn();
  const navigation = vi.fn();
  const layout = vi.fn();
  beforeEach(() => {
    document.body.innerHTML = '<div id="react-root"><div id="shell"><header role="banner"></header><div id="route"><main role="main"></main></div></div></div><div id="layers"></div>';
    clock = mockFrames();
    observer = new DomObserver({ onTweetArticlesAdded: tweets, onTweetArticlesRemoved: removed,
      onNavigationMutated: navigation, onLayoutMutated: layout });
  });
  afterEach(() => { observer.stop(); vi.unstubAllGlobals(); });

  it("すべて無効なら監視もフレーム予約もしない", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    observer.start({ tweets: false, navigation: false, layout: false });
    expect(observe).not.toHaveBeenCalled();
    expect(clock.frames.size).toBe(0);
  });

  it("ナビだけならmainを監視せず、タイムライン変更にも処理を予約しない", async () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    observer.start({ tweets: false, navigation: true, layout: false }); clock.flush();
    expect(observe.mock.calls.some(([root]) => root === document.querySelector("main"))).toBe(false);
    document.querySelector("main")!.innerHTML = tweetMarkup();
    await settle();
    expect(clock.frames.size).toBe(0);
    expect(tweets).not.toHaveBeenCalled();
  });

  it("同じ投稿の複数変更をまとめ、自分のボタンの更新は無視する", async () => {
    observer.start(); clock.flush();
    document.querySelector("main")!.innerHTML = tweetMarkup();
    await settle();
    const article = document.querySelector("article")!;
    article.append(document.createElement("div"), document.createElement("span"));
    await settle(); clock.flush();
    expect(tweets).toHaveBeenCalledTimes(1);
    expect([...tweets.mock.calls[0]![0]]).toEqual([article]);
    const slot = document.createElement("div"); slot.className = "yosoix-action-slot";
    article.append(slot); await settle();
    slot.innerHTML = '<span><svg><path></path></svg></span>'; await settle();
    expect(clock.frames.size).toBe(0);
  });

  it("削除された投稿を待ち行列から除去し、DOM索引にも削除を通知する", async () => {
    observer.start(); clock.flush();
    const main = document.querySelector("main")!;
    main.innerHTML = tweetMarkup(); await settle();
    const article = main.querySelector("article")!;
    article.remove(); await settle(); clock.flush();
    expect(tweets).not.toHaveBeenCalled();
    expect([...removed.mock.calls[0]![0]]).toEqual([article]);
  });

  it("深い階層のmain置換後も監視を再接続する", async () => {
    observer.start(); clock.flush();
    document.getElementById("route")!.innerHTML = `<main role="main">${tweetMarkup("456")}</main>`;
    await settle(); clock.flush();
    expect(tweets).toHaveBeenCalledTimes(1);
    document.querySelector("article")!.appendChild(document.createElement("div"));
    await settle(); clock.flush();
    expect(tweets).toHaveBeenCalledTimes(2);
  });

  it("大量の投稿は複数フレームに分け、stop時は予約と参照を破棄する", async () => {
    observer.start(); clock.flush();
    document.querySelector("main")!.innerHTML = Array.from({ length: 60 }, (_, i) => tweetMarkup(String(i))).join("");
    await settle(); clock.flush();
    expect(tweets.mock.calls[0]![0].size).toBe(25);
    clock.flush(); expect(tweets.mock.calls[1]![0].size).toBe(25);
    observer.stop(); expect(clock.frames.size).toBe(0);
    clock.flush(); expect(tweets).toHaveBeenCalledTimes(2);
    observer.start(); clock.flush(); clock.flush(); clock.flush();
    expect(tweets.mock.calls.slice(2).reduce((sum, [batch]) => sum + batch.size, 0)).toBe(60);
  });

  it("layersのツールチップや投稿更新ではナビを走査せず、メニュー出現時だけ同期する", async () => {
    observer.start(); clock.flush(); navigation.mockClear();
    const layers = document.getElementById("layers")!;
    layers.innerHTML = '<div role="tooltip">Tooltip</div>'; await settle(); clock.flush();
    expect(navigation).not.toHaveBeenCalled();
    layers.insertAdjacentHTML("beforeend", tweetMarkup()); await settle(); clock.flush();
    expect(navigation).not.toHaveBeenCalled();
    layers.insertAdjacentHTML("beforeend", '<div role="menu"><a href="/jobs">Jobs</a></div>');
    await settle(); clock.flush();
    expect(navigation).toHaveBeenCalledTimes(1);
  });
});
