import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTweetActionSettings, syncTweetActionBar } from "../src/content/tweet-action-controller";
import { DEFAULT_SETTINGS } from "../src/core/types";
import { normalizeSettings } from "../src/core/validators";

describe("ツイート下部のボタンの並び順と非表示", () => {
  let actionBar: HTMLElement;
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = readFileSync("src/styles/content.css", "utf8");
    document.head.append(style);
    document.documentElement.setAttribute("data-yosoix-enabled", "true");
    document.body.innerHTML = `<article data-testid="tweet"><div role="group" id="bar" style="display:flex">
      <div id="reply"><button data-testid="reply"></button></div>
      <div id="repost"><button data-testid="retweet"></button></div>
      <div id="like"><button data-testid="like"></button></div>
      <a id="analytics" href="/alice/status/123/analytics">Views</a>
      <div id="bookmark"><button data-testid="bookmark"></button></div>
      <div id="share"><button aria-label="ポストを共有"></button></div>
      <div id="quotes" data-yosoix-slot="quotes"></div>
      <div id="retweets" data-yosoix-slot="retweets"></div>
      <div id="download" data-yosoix-slot="download"></div>
    </div></article>`;
    actionBar = document.getElementById("bar")!;
  });
  afterEach(() => {
    style.remove();
    document.documentElement.removeAttribute("data-yosoix-enabled");
    applyTweetActionSettings({ ...DEFAULT_SETTINGS, enabled: false });
  });

  function visibleOrder() {
    return [...actionBar.querySelectorAll<HTMLElement>("[id]:not(#group)")]
      .filter((element) => getComputedStyle(element).display !== "none")
      .sort((a, b) => Number(getComputedStyle(a).order) - Number(getComputedStyle(b).order))
      .map((element) => element.id);
  }

  it("標準DOMを移動せず、すべて表示する場合は指定順に並べる", () => {
    const originalChildren = [...actionBar.children];
    applyTweetActionSettings({ ...DEFAULT_SETTINGS, hideTweetAnalytics: false, hideTweetShare: false });
    syncTweetActionBar(actionBar);
    expect(visibleOrder()).toEqual(["reply", "repost", "analytics", "share", "quotes", "retweets", "bookmark", "like", "download"]);
    expect([...actionBar.children]).toEqual(originalChildren);
    const before = actionBar.outerHTML;
    syncTweetActionBar(actionBar);
    expect(actionBar.outerHTML).toBe(before);
  });

  it("既存設定にも非表示の初期値を補完し、アナリティクスと共有を独立して表示に戻せる", () => {
    const settings = normalizeSettings({});
    expect(settings.hideTweetAnalytics).toBe(true);
    expect(settings.hideTweetShare).toBe(true);
    syncTweetActionBar(actionBar);
    applyTweetActionSettings(settings);
    expect(visibleOrder()).toEqual(["reply", "repost", "quotes", "retweets", "bookmark", "like", "download"]);
    applyTweetActionSettings(normalizeSettings({ hideTweetAnalytics: false }));
    expect(visibleOrder()).toContain("analytics");
    expect(visibleOrder()).not.toContain("share");
    applyTweetActionSettings(normalizeSettings({ hideTweetShare: false }));
    expect(visibleOrder()).not.toContain("analytics");
    expect(visibleOrder()).toContain("share");
    expect(normalizeSettings({ hideTweetAnalytics: "false", hideTweetShare: null })).toEqual(settings);
  });

  it("マスターOFFで標準の順番・表示状態に戻す", () => {
    syncTweetActionBar(actionBar);
    applyTweetActionSettings(DEFAULT_SETTINGS);
    document.documentElement.removeAttribute("data-yosoix-enabled");
    applyTweetActionSettings({ ...DEFAULT_SETTINGS, enabled: false });
    expect(getComputedStyle(document.getElementById("share")!).display).not.toBe("none");
    expect(getComputedStyle(document.getElementById("analytics")!).display).not.toBe("none");
    expect(getComputedStyle(document.getElementById("like")!).order).toBe("");
  });

  it("共有とブックマークが同じグループ内にあっても個別に並べ替え・非表示にする", () => {
    const group = document.createElement("div");
    group.id = "group";
    actionBar.append(group);
    group.append(document.getElementById("bookmark")!, document.getElementById("share")!);
    document.querySelector('[data-testid="bookmark"]')!.setAttribute("data-testid", "removeBookmark");
    document.querySelector('[data-testid="like"]')!.setAttribute("data-testid", "unlike");
    document.querySelector('[data-testid="retweet"]')!.setAttribute("data-testid", "unretweet");
    document.querySelector('[aria-label="ポストを共有"]')!.setAttribute("aria-label", "Share post");
    syncTweetActionBar(actionBar);
    applyTweetActionSettings(DEFAULT_SETTINGS);
    expect(getComputedStyle(group).display).toBe("contents");
    expect(getComputedStyle(document.getElementById("share")!).display).toBe("none");
    expect(visibleOrder()).toEqual(["reply", "repost", "quotes", "retweets", "bookmark", "like", "download"]);
    // Xの再描画で同じラッパーの中身が置換された場合、古い分類を残さない。
    document.getElementById("like")!.innerHTML = '<button data-testid="share"></button>';
    syncTweetActionBar(actionBar);
    expect(getComputedStyle(document.getElementById("like")!).display).toBe("none");
  });
});
