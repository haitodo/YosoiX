import type { ExtensionSettings } from "../core/types";
import { TWEET_ACTION_SELECTORS } from "./tweet-dom";

const BAR_MARK = "data-yosoix-tweet-action-bar";
const ACTION_MARK = "data-yosoix-tweet-action";
const CONTAINER_MARK = "data-yosoix-tweet-action-container";
const HIDE_ANALYTICS_ATTR = "data-yosoix-hide-tweet-analytics";
const HIDE_SHARE_ATTR = "data-yosoix-hide-tweet-share";

function mark(element: Element, attribute: string, value: string): void {
  if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
}

export function applyTweetActionSettings(settings: ExtensionSettings): void {
  for (const [attribute, hidden] of [
    [HIDE_ANALYTICS_ATTR, settings.hideTweetAnalytics],
    [HIDE_SHARE_ATTR, settings.hideTweetShare],
  ] as const) {
    if (settings.enabled && hidden) mark(document.documentElement, attribute, "true");
    else document.documentElement.removeAttribute(attribute);
  }
}

/** ReactのDOM順・イベント処理は維持し、表示順と非表示用のCSSフックだけを付与する。 */
export function syncTweetActionBar(actionBar: HTMLElement): void {
  const nextActions = new Map<Element, string>();
  const nextContainers = new Set<Element>();
  const classify = (element: Element): void => {
    if (element.hasAttribute("data-yosoix-slot")) return;
    const actions = Object.entries(TWEET_ACTION_SELECTORS).filter(([, selector]) =>
      element.matches(selector) || element.querySelector(selector),
    );
    if (actions.length === 1) {
      nextActions.set(element, actions[0]![0]);
    } else if (actions.length > 1) {
      // ブックマークと共有などが同じラッパー内にある場合は、CSS上だけグループを開く。
      nextContainers.add(element);
      for (const child of element.children) classify(child);
    }
  };
  for (const child of actionBar.children) classify(child);

  for (const old of actionBar.querySelectorAll(`[${ACTION_MARK}]`)) {
    if (!nextActions.has(old)) old.removeAttribute(ACTION_MARK);
  }
  for (const old of actionBar.querySelectorAll(`[${CONTAINER_MARK}]`)) {
    if (!nextContainers.has(old)) old.removeAttribute(CONTAINER_MARK);
  }
  mark(actionBar, BAR_MARK, "true");
  for (const [element, action] of nextActions) mark(element, ACTION_MARK, action);
  for (const element of nextContainers) mark(element, CONTAINER_MARK, "true");
}
