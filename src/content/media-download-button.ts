import type { DownloadButtonState, TweetDownloadStatus } from "../core/types";
import type { TweetDomIdentity } from "./tweet-dom";

/**
 * メディア一括ダウンロードボタン（FR-040, FR-042: spec.md 2.6, 3.2）
 *
 * - 画像・動画を含むツイートのアクションバーにのみ挿入する。
 * - 待機（idle）・処理中（loading）・成功（success）・失敗（error）の 4 状態を表現する。
 * - ツイートの仮想スクロール再描画時も DownloadManager が保持する状態を復元する。
 */

export const DOWNLOAD_BUTTON_ACTION = "download";

const STATE_ICONS: Readonly<Record<DownloadButtonState, string>> = {
  idle: `<svg viewBox="0 0 24 24" aria-hidden="true" class="yosoix-icon"><path d="M12 3.75a.75.75 0 0 1 .75.75v8.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75ZM4.75 16.5a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h11.5a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 17.75 21H6.25A2.25 2.25 0 0 1 4 18.75v-1.5a.75.75 0 0 1 .75-.75Z"></path></svg>`,
  loading: `<svg viewBox="0 0 24 24" aria-hidden="true" class="yosoix-icon yosoix-spin"><path d="M12 3.25a8.75 8.75 0 1 0 8.75 8.75.75.75 0 0 1 1.5 0A10.25 10.25 0 1 1 12 1.75a.75.75 0 0 1 0 1.5Z"></path></svg>`,
  success: `<svg viewBox="0 0 24 24" aria-hidden="true" class="yosoix-icon"><path d="M19.78 6.97a.75.75 0 0 1 0 1.06l-9.25 9.25a.75.75 0 0 1-1.06 0l-4.25-4.25a.75.75 0 1 1 1.06-1.06L10 15.69l8.72-8.72a.75.75 0 0 1 1.06 0Z"></path></svg>`,
  error: `<svg viewBox="0 0 24 24" aria-hidden="true" class="yosoix-icon"><path d="M12 3.25a8.75 8.75 0 1 0 0 17.5 8.75 8.75 0 0 0 0-17.5ZM1.75 12C1.75 6.34 6.34 1.75 12 1.75S22.25 6.34 22.25 12 17.66 22.25 12 22.25 1.75 17.66 1.75 12ZM12 7.25a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75Zm0 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>`,
};

function defaultStateTitle(state: DownloadButtonState, mediaCount?: number): string {
  switch (state) {
    case "loading":
      return "メディアをダウンロード中…";
    case "success":
      return "メディアのダウンロードが完了しました";
    case "error":
      return "ダウンロードに失敗しました（クリックして再試行）";
    case "idle":
    default:
      return mediaCount && mediaCount > 1
        ? `この投稿のメディアを一括保存（${mediaCount}件）`
        : "この投稿のメディアを保存";
  }
}

function applyStatusToButton(
  button: HTMLButtonElement,
  status: TweetDownloadStatus,
  mediaCount?: number,
): void {
  const prevState = button.getAttribute("data-yosoix-dl-state");
  if (prevState !== status.state) {
    button.setAttribute("data-yosoix-dl-state", status.state);
    const iconHolder = button.querySelector<HTMLElement>(".yosoix-icon-wrap");
    if (iconHolder) {
      iconHolder.innerHTML = STATE_ICONS[status.state];
    }
  }

  const busy = status.state === "loading";
  if (button.disabled !== busy) button.disabled = busy;
  const ariaBusy = busy ? "true" : "false";
  if (button.getAttribute("aria-busy") !== ariaBusy) button.setAttribute("aria-busy", ariaBusy);

  const tooltip = status.message ?? defaultStateTitle(status.state, mediaCount);
  if (button.getAttribute("title") !== tooltip) {
    button.setAttribute("title", tooltip);
  }
  if (button.getAttribute("aria-label") !== tooltip) {
    button.setAttribute("aria-label", tooltip);
  }
}

/**
 * アクションバーにダウンロードボタンを挿入または更新する（完全冪等）。
 */
export function upsertMediaDownloadButton(
  actionBar: HTMLElement,
  identity: TweetDomIdentity,
  status: TweetDownloadStatus,
  mediaCount?: number,
): void {
  let wrapper = actionBar.querySelector<HTMLElement>(
    '.yosoix-action-slot[data-yosoix-slot="download"]',
  );
  let button = wrapper?.querySelector<HTMLButtonElement>(
    `button[data-yosoix-action="${DOWNLOAD_BUTTON_ACTION}"]`,
  );

  if (!wrapper || !button) {
    wrapper = document.createElement("div");
    wrapper.className = "yosoix-action-slot";
    wrapper.setAttribute("data-yosoix-slot", "download");

    button = document.createElement("button");
    button.type = "button";
    button.className = "yosoix-action-btn yosoix-download-btn";
    button.setAttribute("data-yosoix-action", DOWNLOAD_BUTTON_ACTION);
    button.innerHTML = `<span class="yosoix-icon-wrap">${STATE_ICONS.idle}</span>`;

    wrapper.appendChild(button);
    actionBar.appendChild(wrapper);
  }

  if (button.getAttribute("data-yosoix-tweet-id") !== identity.tweetId) {
    button.setAttribute("data-yosoix-tweet-id", identity.tweetId);
  }
  if (identity.screenName) {
    if (button.getAttribute("data-yosoix-screen-name") !== identity.screenName) {
      button.setAttribute("data-yosoix-screen-name", identity.screenName);
    }
  } else {
    button.removeAttribute("data-yosoix-screen-name");
  }

  applyStatusToButton(button, status, mediaCount);
}

export function removeMediaDownloadButtonFromBar(actionBar: HTMLElement): void {
  actionBar.querySelector('.yosoix-action-slot[data-yosoix-slot="download"]')?.remove();
}

export function removeAllMediaDownloadButtons(root: ParentNode = document): void {
  const slots = root.querySelectorAll('.yosoix-action-slot[data-yosoix-slot="download"]');
  for (const slot of slots) {
    slot.remove();
  }
}

/**
 * 状態変更時、現在画面上にマウントされている該当 tweetId のボタン表示だけをピンポイント更新する。
 */
export function syncDownloadButtonStateInDom(
  tweetId: string,
  status: TweetDownloadStatus,
  root: ParentNode = document,
): void {
  if (!/^\d{1,25}$/.test(tweetId)) return;
  const buttons = root.querySelectorAll<HTMLButtonElement>(
    `button[data-yosoix-action="${DOWNLOAD_BUTTON_ACTION}"][data-yosoix-tweet-id="${tweetId}"]`,
  );
  for (const button of buttons) {
    applyStatusToButton(button, status);
  }
}
