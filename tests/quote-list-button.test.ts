import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatQuoteButtonLabel,
  handleQuoteButtonClick,
  removeAllQuoteListButtons,
  removeQuoteListButtonFromBar,
  upsertQuoteListButton,
} from "../src/content/quote-list-button";
import type { TweetDomIdentity } from "../src/content/tweet-dom";

describe("quote-list-button: formatQuoteButtonLabel", () => {
  it("件数が取得できた場合はフォーマット済み件数を表示する", () => {
    expect(formatQuoteButtonLabel(12)).toBe("引用 12");
    expect(formatQuoteButtonLabel(0)).toBe("引用 0");
    expect(formatQuoteButtonLabel(1500)).toBe("引用 1,500");
  });

  it("件数が未取得（undefined や負数）の場合は固定ラベル '引用一覧' を表示する", () => {
    expect(formatQuoteButtonLabel(undefined)).toBe("引用一覧");
    expect(formatQuoteButtonLabel(-1)).toBe("引用一覧");
  });
});

describe("quote-list-button: DOM 操作と冪等性", () => {
  let actionBar: HTMLElement;
  const identityA: TweetDomIdentity = {
    tweetId: "1000000001",
    screenName: "alice",
    quotesPath: "/alice/status/1000000001/quotes",
  };
  const identityB: TweetDomIdentity = {
    tweetId: "2000000002",
    screenName: "bob",
    quotesPath: "/bob/status/2000000002/quotes",
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

  it("upsertQuoteListButton を複数回実行してもボタンが二重追加されない（完全冪等）", () => {
    upsertQuoteListButton(actionBar, identityA, 5);
    upsertQuoteListButton(actionBar, identityA, 5);
    upsertQuoteListButton(actionBar, identityA, 5);

    const slots = actionBar.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="quotes"]');
    expect(slots).toHaveLength(1);

    const anchor = actionBar.querySelector<HTMLAnchorElement>('a[data-yosoix-action="quotes"]');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/alice/status/1000000001/quotes");
    expect(anchor?.querySelector(".yosoix-btn-label")?.textContent).toBe("引用 5");
  });

  it("仮想スクロールでアクションバーが再利用された場合、新しい tweetId と quotesPath に更新される", () => {
    upsertQuoteListButton(actionBar, identityA, 10);
    let anchor = actionBar.querySelector<HTMLAnchorElement>('a[data-yosoix-action="quotes"]')!;
    expect(anchor.getAttribute("href")).toBe("/alice/status/1000000001/quotes");
    expect(anchor.querySelector(".yosoix-btn-label")?.textContent).toBe("引用 10");

    // 別の投稿 B のデータで再描画
    upsertQuoteListButton(actionBar, identityB, undefined);
    anchor = actionBar.querySelector<HTMLAnchorElement>('a[data-yosoix-action="quotes"]')!;
    expect(anchor.getAttribute("href")).toBe("/bob/status/2000000002/quotes");
    expect(anchor.getAttribute("data-yosoix-tweet-id")).toBe("2000000002");
    expect(anchor.querySelector(".yosoix-btn-label")?.textContent).toBe("引用一覧");
  });

  it("removeQuoteListButtonFromBar でアクションバーから引用ボタンが削除される", () => {
    upsertQuoteListButton(actionBar, identityA, 3);
    expect(actionBar.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="quotes"]')).toHaveLength(1);

    removeQuoteListButtonFromBar(actionBar);
    expect(actionBar.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="quotes"]')).toHaveLength(0);
  });

  it("removeAllQuoteListButtons で画面全体の引用ボタンがすべて削除される", () => {
    upsertQuoteListButton(actionBar, identityA, 3);
    expect(document.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="quotes"]')).toHaveLength(1);

    removeAllQuoteListButtons();
    expect(document.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="quotes"]')).toHaveLength(0);
  });
});

describe("quote-list-button: handleQuoteButtonClick", () => {
  let anchor: HTMLAnchorElement;

  beforeEach(() => {
    anchor = document.createElement("a");
    anchor.setAttribute("href", "/jack/status/20/quotes");
    anchor.setAttribute("data-yosoix-action", "quotes");
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

    handleQuoteButtonClick(event, anchor);

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/jack/status/20/quotes");
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it("Ctrl または Meta キー押下時（別タブで開く操作）は preventDefault() を呼ばず、標準動作を維持する", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");

    const ctrlEvent = new MouseEvent("click", {
      button: 0,
      ctrlKey: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(ctrlEvent, "preventDefault");
    const stopPropagationSpy = vi.spyOn(ctrlEvent, "stopPropagation");

    handleQuoteButtonClick(ctrlEvent, anchor);

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });
});
