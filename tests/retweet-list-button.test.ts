import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatRetweetButtonLabel,
  handleRetweetButtonClick,
  removeAllRetweetListButtons,
  removeRetweetListButtonFromBar,
  upsertRetweetListButton,
} from "../src/content/retweet-list-button";
import { upsertQuoteListButton } from "../src/content/quote-list-button";
import type { TweetDomIdentity } from "../src/content/tweet-dom";

describe("retweet-list-button: formatRetweetButtonLabel", () => {
  it("件数が取得できた場合はフォーマット済み件数を表示する", () => {
    expect(formatRetweetButtonLabel(12)).toBe("リポスト 12");
    expect(formatRetweetButtonLabel(0)).toBe("リポスト 0");
    expect(formatRetweetButtonLabel(1500)).toBe("リポスト 1,500");
  });

  it("件数が未取得（undefined や負数）の場合は固定ラベル 'リポスト一覧' を表示する", () => {
    expect(formatRetweetButtonLabel(undefined)).toBe("リポスト一覧");
    expect(formatRetweetButtonLabel(-1)).toBe("リポスト一覧");
  });
});

describe("retweet-list-button: DOM 操作・スロット配置・冪等性", () => {
  let actionBar: HTMLElement;
  const identityA: TweetDomIdentity = {
    tweetId: "1000000001",
    screenName: "alice",
    quotesPath: "/alice/status/1000000001/quotes",
    retweetsPath: "/alice/status/1000000001/retweets",
  };
  const identityB: TweetDomIdentity = {
    tweetId: "2000000002",
    screenName: "bob",
    quotesPath: "/bob/status/2000000002/quotes",
    retweetsPath: "/bob/status/2000000002/retweets",
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div role="group" id="action-bar">
          <button data-testid="reply"></button>
          <button data-testid="retweet"></button>
          <button data-testid="like"></button>
        </div>
      </article>
    `;
    actionBar = document.getElementById("action-bar")!;
  });

  it("引用ボタンの右隣にリポスト一覧ボタンが挿入され、複数回実行しても二重追加されない（完全冪等）", () => {
    // 1. 引用ボタンを先に挿入
    upsertQuoteListButton(actionBar, identityA, 5);
    // 2. リポストボタンを挿入
    upsertRetweetListButton(actionBar, identityA, 20);
    upsertRetweetListButton(actionBar, identityA, 20);

    const slots = actionBar.querySelectorAll(".yosoix-action-slot");
    expect(slots).toHaveLength(2);
    expect(slots[0]?.getAttribute("data-yosoix-slot")).toBe("quotes");
    expect(slots[1]?.getAttribute("data-yosoix-slot")).toBe("retweets");

    const anchor = actionBar.querySelector<HTMLAnchorElement>('a[data-yosoix-action="retweets"]');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/alice/status/1000000001/retweets");
    expect(anchor?.querySelector(".yosoix-btn-label")?.textContent).toBe("リポスト 20");
  });

  it("すでに download スロットがある場合でも、download の手前（引用の右隣）に正しく挿入される", () => {
    upsertQuoteListButton(actionBar, identityA, 5);

    // download スロットを仮挿入
    const dlSlot = document.createElement("div");
    dlSlot.className = "yosoix-action-slot";
    dlSlot.setAttribute("data-yosoix-slot", "download");
    actionBar.appendChild(dlSlot);

    // リポストボタンを挿入
    upsertRetweetListButton(actionBar, identityA, 8);

    const slotElements = actionBar.querySelectorAll(".yosoix-action-slot");
    expect(slotElements).toHaveLength(3);
    expect(slotElements[0]?.getAttribute("data-yosoix-slot")).toBe("quotes");
    expect(slotElements[1]?.getAttribute("data-yosoix-slot")).toBe("retweets");
    expect(slotElements[2]?.getAttribute("data-yosoix-slot")).toBe("download");
  });

  it("仮想スクロールでアクションバーが再利用された場合、新しい tweetId と retweetsPath に更新される", () => {
    upsertRetweetListButton(actionBar, identityA, 10);
    let anchor = actionBar.querySelector<HTMLAnchorElement>('a[data-yosoix-action="retweets"]')!;
    expect(anchor.getAttribute("href")).toBe("/alice/status/1000000001/retweets");
    expect(anchor.querySelector(".yosoix-btn-label")?.textContent).toBe("リポスト 10");

    // 別の投稿 B のデータで再描画
    upsertRetweetListButton(actionBar, identityB, undefined);
    anchor = actionBar.querySelector<HTMLAnchorElement>('a[data-yosoix-action="retweets"]')!;
    expect(anchor.getAttribute("href")).toBe("/bob/status/2000000002/retweets");
    expect(anchor.getAttribute("data-yosoix-tweet-id")).toBe("2000000002");
    expect(anchor.querySelector(".yosoix-btn-label")?.textContent).toBe("リポスト一覧");
  });

  it("removeRetweetListButtonFromBar でアクションバーからリポストボタンが削除される", () => {
    upsertRetweetListButton(actionBar, identityA, 3);
    expect(actionBar.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="retweets"]')).toHaveLength(1);

    removeRetweetListButtonFromBar(actionBar);
    expect(actionBar.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="retweets"]')).toHaveLength(0);
  });

  it("removeAllRetweetListButtons で画面全体のリポストボタンがすべて削除される", () => {
    upsertRetweetListButton(actionBar, identityA, 3);
    expect(document.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="retweets"]')).toHaveLength(1);

    removeAllRetweetListButtons();
    expect(document.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="retweets"]')).toHaveLength(0);
  });
});

describe("retweet-list-button: handleRetweetButtonClick", () => {
  let anchor: HTMLAnchorElement;

  beforeEach(() => {
    anchor = document.createElement("a");
    anchor.setAttribute("href", "/jack/status/20/retweets");
    anchor.setAttribute("data-yosoix-action", "retweets");
  });

  it("通常の左クリック時は SPA ナビゲーション（pushState + popstate）を行い、伝播を停止する", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const event = new MouseEvent("click", {
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    handleRetweetButtonClick(event, anchor);

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/jack/status/20/retweets");
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it("Ctrl または Meta キー押下時は preventDefault() を呼ばず、標準動作を維持する", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");

    const ctrlEvent = new MouseEvent("click", {
      button: 0,
      ctrlKey: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(ctrlEvent, "preventDefault");
    const stopPropagationSpy = vi.spyOn(ctrlEvent, "stopPropagation");

    handleRetweetButtonClick(ctrlEvent, anchor);

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });
});
