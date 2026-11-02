import { X_SELECTORS } from "./tweet-dom";

const COMPOSER_MARK = "data-yosoix-home-composer";
// 投稿欄を包む要素だけを隠し、タブ・タイムライン・ダイアログまで巻き込まない。
const CONTENT_BOUNDARY = [
  "header", "nav", "section", '[role="heading"]', '[role="tablist"]', '[role="region"]',
  '[data-testid="cellInnerDiv"]', X_SELECTORS.tweetArticle,
  X_SELECTORS.dialogContainer, X_SELECTORS.layersRoot,
].join(", ");

/** ホーム上部の投稿欄を、アバター・ツールバーを含むコンテナごと非表示にする。 */
export class ComposerController {
  private active = false;
  private readonly marked = new Set<HTMLElement>();

  updateConfig(enabled: boolean, hideHomeComposer: boolean, reconcile = true): void {
    this.active = enabled && hideHomeComposer;
    if (!this.active) this.restoreAll();
    else if (reconcile) this.reconcileLayout();
  }

  reconcileLayout(): void {
    if (!this.active) return;
    const next = new Set<HTMLElement>();
    if (window.location.pathname === "/home" || window.location.pathname === "/") {
      const primary = document.querySelector<HTMLElement>(
        `${X_SELECTORS.mainRoot} ${X_SELECTORS.primaryColumn}`,
      );
      if (primary && !primary.closest(X_SELECTORS.dialogContainer)) {
        for (const editor of primary.querySelectorAll<HTMLElement>(X_SELECTORS.homeComposerEditor)) {
          if (editor.closest(`${X_SELECTORS.dialogContainer}, ${X_SELECTORS.layersRoot}, ${X_SELECTORS.tweetArticle}`)) continue;
          let composer: HTMLElement | null = null;
          for (let cursor = editor.parentElement; cursor && cursor !== primary; cursor = cursor.parentElement) {
            if (cursor.matches(CONTENT_BOUNDARY) || cursor.querySelector(CONTENT_BOUNDARY)) break;
            if (cursor.querySelector(X_SELECTORS.inlinePostButton)) composer = cursor;
          }
          if (composer) next.add(composer);
        }
      }
    }

    for (const element of this.marked) {
      if (!next.has(element)) element.removeAttribute(COMPOSER_MARK);
    }
    for (const element of next) {
      if (element.getAttribute(COMPOSER_MARK) !== "true") element.setAttribute(COMPOSER_MARK, "true");
    }
    this.marked.clear();
    for (const element of next) this.marked.add(element);
  }

  restoreAll(): void {
    for (const element of this.marked) element.removeAttribute(COMPOSER_MARK);
    this.marked.clear();
  }
}
