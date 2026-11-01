import type { TweetDomIdentity } from "./tweet-dom";

/**
 * 引用リポスト一覧ボタン（FR-030: spec.md 2.5）
 *
 * - 各ツイートのアクションバーに独立した <a> リンクとして追加する。
 * - 仮想スクロールによる DOM 再利用時も tweetId・href・引用件数を冪等に同期する。
 * - 左クリック時は X の SPA ルーター（history.pushState + popstate）を優先し、
 *   Ctrl/Cmd/中クリック時はブラウザー標準の別タブ遷移をそのまま動作させる。
 */

export const QUOTE_BUTTON_ACTION = "quotes";

const QUOTE_SVG_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" class="yosoix-icon">
  <path d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v6.5a2.25 2.25 0 0 1-2.25 2.25H11.6l-3.85 3.35a.75.75 0 0 1-1.25-.56v-2.79H6.75a2.25 2.25 0 0 1-2.25-2.25v-6.5Zm2.25-.75a.75.75 0 0 0-.75.75v6.5c0 .414.336.75.75.75h1.5a.75.75 0 0 1 .75.75v1.88l2.76-2.4a.75.75 0 0 1 .49-.18h5a.75.75 0 0 0 .75-.75v-6.5a.75.75 0 0 0-.75-.75H6.75Zm2.5 2.75h5.5v1.5h-5.5v-1.5Zm0 2.75h3.5v1.5h-3.5v-1.5Z"></path>
</svg>
`.trim();

export function formatQuoteButtonLabel(quoteCount: number | undefined): string {
  if (typeof quoteCount === "number" && Number.isFinite(quoteCount) && quoteCount >= 0) {
    return `引用 ${quoteCount.toLocaleString("ja-JP")}`;
  }
  return "引用一覧";
}

function formatQuoteButtonTitle(quoteCount: number | undefined): string {
  if (typeof quoteCount === "number" && Number.isFinite(quoteCount) && quoteCount >= 0) {
    return `引用リポスト一覧を開く（${quoteCount.toLocaleString("ja-JP")}件）`;
  }
  return "引用リポスト一覧を開く";
}

/**
 * アクションバーに引用一覧ボタンを挿入または更新する（完全冪等）。
 */
export function upsertQuoteListButton(
  actionBar: HTMLElement,
  identity: TweetDomIdentity,
  quoteCount: number | undefined,
): void {
  let wrapper = actionBar.querySelector<HTMLElement>(
    '.yosoix-action-slot[data-yosoix-slot="quotes"]',
  );
  let anchor = wrapper?.querySelector<HTMLAnchorElement>(
    `a[data-yosoix-action="${QUOTE_BUTTON_ACTION}"]`,
  );

  if (!wrapper || !anchor) {
    wrapper = document.createElement("div");
    wrapper.className = "yosoix-action-slot";
    wrapper.setAttribute("data-yosoix-slot", "quotes");

    anchor = document.createElement("a");
    anchor.className = "yosoix-action-btn yosoix-quote-btn";
    anchor.setAttribute("data-yosoix-action", QUOTE_BUTTON_ACTION);
    anchor.innerHTML = `${QUOTE_SVG_ICON}<span class="yosoix-btn-label"></span>`;

    wrapper.appendChild(anchor);
    actionBar.appendChild(wrapper);
  }

  if (anchor.getAttribute("href") !== identity.quotesPath) {
    anchor.setAttribute("href", identity.quotesPath);
  }
  if (anchor.getAttribute("data-yosoix-tweet-id") !== identity.tweetId) {
    anchor.setAttribute("data-yosoix-tweet-id", identity.tweetId);
  }

  const labelText = formatQuoteButtonLabel(quoteCount);
  const titleText = formatQuoteButtonTitle(quoteCount);

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

export function removeQuoteListButtonFromBar(actionBar: HTMLElement): void {
  actionBar.querySelector('.yosoix-action-slot[data-yosoix-slot="quotes"]')?.remove();
}

export function removeAllQuoteListButtons(root: ParentNode = document): void {
  const slots = root.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="quotes"]');
  for (const slot of slots) {
    slot.remove();
  }
}

/**
 * 引用一覧リンクのクリック処理。
 * - Ctrl / Meta / Shift / Alt 押下時や中クリック時は伝播のみ止め、標準の別タブ遷移に任せる。
 * - 通常の左クリック（および Enter キー操作）時は同一タブ内で X の SPA ルーター遷移を行う。
 */
export function handleQuoteButtonClick(event: MouseEvent, anchor: HTMLAnchorElement): void {
  // 親 <article> のツイート詳細遷移ハンドラーへの伝播を確実に遮断
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
