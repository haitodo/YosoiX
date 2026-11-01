import type { TweetDomIdentity } from "./tweet-dom";

/**
 * リポスト（リツイート）一覧ボタン
 *
 * - 各ツイートのアクションバーに独立した <a> リンクとして追加する。
 * - 引用一覧ボタンの右隣に配置する。
 * - 仮想スクロールによる DOM 再利用時も tweetId・href・リポスト件数を冪等に同期する。
 * - 左クリック時は X の SPA ルーター（history.pushState + popstate）を優先し、
 *   Ctrl/Cmd/中クリック時はブラウザー標準の別タブ遷移をそのまま動作させる。
 */

export const RETWEET_BUTTON_ACTION = "retweets";

const RETWEET_SVG_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" class="yosoix-icon">
  <path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.895 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.895-2-2-2z"></path>
</svg>
`.trim();

export function formatRetweetButtonLabel(retweetCount: number | undefined): string {
  if (typeof retweetCount === "number" && Number.isFinite(retweetCount) && retweetCount >= 0) {
    return `リポスト ${retweetCount.toLocaleString("ja-JP")}`;
  }
  return "リポスト一覧";
}

function formatRetweetButtonTitle(retweetCount: number | undefined): string {
  if (typeof retweetCount === "number" && Number.isFinite(retweetCount) && retweetCount >= 0) {
    return `リポスト（リツイート）一覧を開く（${retweetCount.toLocaleString("ja-JP")}件）`;
  }
  return "リポスト（リツイート）一覧を開く";
}

/**
 * アクションバーにリポスト一覧ボタンを挿入または更新する（完全冪等）。
 * 「引用」ボタンの右隣に位置するよう、スロット data-yosoix-slot="retweets" として挿入する。
 */
export function upsertRetweetListButton(
  actionBar: HTMLElement,
  identity: TweetDomIdentity,
  retweetCount: number | undefined,
): void {
  let wrapper = actionBar.querySelector<HTMLElement>(
    '.yosoix-action-slot[data-yosoix-slot="retweets"]',
  );
  let anchor = wrapper?.querySelector<HTMLAnchorElement>(
    `a[data-yosoix-action="${RETWEET_BUTTON_ACTION}"]`,
  );

  if (!wrapper || !anchor) {
    wrapper = document.createElement("div");
    wrapper.className = "yosoix-action-slot";
    wrapper.setAttribute("data-yosoix-slot", "retweets");

    anchor = document.createElement("a");
    anchor.className = "yosoix-action-btn yosoix-retweet-btn";
    anchor.setAttribute("data-yosoix-action", RETWEET_BUTTON_ACTION);
    anchor.innerHTML = `${RETWEET_SVG_ICON}<span class="yosoix-btn-label"></span>`;

    wrapper.appendChild(anchor);

    // 挿入位置の制御:
    // 1. すでに download スロットがあればその手前に挿入
    // 2. なければ末尾（引用ボタンの後ろ）に挿入
    const downloadSlot = actionBar.querySelector('.yosoix-action-slot[data-yosoix-slot="download"]');
    if (downloadSlot) {
      actionBar.insertBefore(wrapper, downloadSlot);
    } else {
      actionBar.appendChild(wrapper);
    }
  }

  if (anchor.getAttribute("href") !== identity.retweetsPath) {
    anchor.setAttribute("href", identity.retweetsPath);
  }
  if (anchor.getAttribute("data-yosoix-tweet-id") !== identity.tweetId) {
    anchor.setAttribute("data-yosoix-tweet-id", identity.tweetId);
  }

  const labelText = formatRetweetButtonLabel(retweetCount);
  const titleText = formatRetweetButtonTitle(retweetCount);

  const labelSpan = anchor.querySelector<HTMLElement>(".yosoix-btn-label");
  if (labelSpan && labelSpan.textContent !== labelText) {
    labelSpan.textContent = labelText;
  }
  if (anchor.getAttribute("aria-label") !== titleText) {
    anchor.setAttribute("aria-label", titleText);
  }
  if (anchor.getAttribute("title") !== titleText) {
    anchor.setAttribute("title", titleText);
  }
}

export function removeRetweetListButtonFromBar(actionBar: HTMLElement): void {
  actionBar.querySelector('.yosoix-action-slot[data-yosoix-slot="retweets"]')?.remove();
}

export function removeAllRetweetListButtons(root: ParentNode = document): void {
  const slots = root.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="retweets"]');
  for (const slot of slots) {
    slot.remove();
  }
}

/**
 * リポスト一覧リンクのクリック処理。
 * - Ctrl / Meta / Shift / Alt 押下時や中クリック時は伝播のみ止め、標準の別タブ遷移に任せる。
 * - 通常の左クリック時は同一タブ内で X の SPA ルーター遷移を行う。
 */
export function handleRetweetButtonClick(event: MouseEvent, anchor: HTMLAnchorElement): void {
  event.stopPropagation();

  const isPlainPrimaryClick =
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey;

  if (!isPlainPrimaryClick) {
    return;
  }

  const rawHref = anchor.getAttribute("href");
  if (!rawHref || !rawHref.startsWith("/")) {
    return;
  }

  event.preventDefault();
  if (window.location.pathname === rawHref) {
    return;
  }

  try {
    window.history.pushState(null, "", rawHref);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.location.assign(rawHref);
  }
}
