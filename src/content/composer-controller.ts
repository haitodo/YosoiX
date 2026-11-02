import { X_SELECTORS } from "./tweet-dom";

const COMPOSER_MARK = "data-yosoix-home-composer";
// 投稿欄を包む要素だけを隠し、タブ・タイムライン・ダイアログまで巻き込まない。
const CONTENT_BOUNDARY = [
  "header", "nav", '[role="heading"]', '[role="tablist"]', X_SELECTORS.tweetArticle,
  X_SELECTORS.dialogContainer, X_SELECTORS.layersRoot,
].join(", ");
const CONTENT_CONTAINER = 'section, [role="region"], [data-testid="cellInnerDiv"]';
const COMPOSER_SEED = `${X_SELECTORS.homeComposerEditor}, ${X_SELECTORS.inlinePostButton}`;

function containsOtherContent(element: Element, seed: Element): boolean {
  if (element.matches(CONTENT_BOUNDARY) || element.querySelector(CONTENT_BOUNDARY)) return true;
  // 投稿欄自体もcellInnerDivやsectionで包まれる。別のタイムラインの枠が現れた所で止める。
  return [...element.querySelectorAll(CONTENT_CONTAINER)].some((container) =>
    !container.contains(seed) && !container.querySelector(COMPOSER_SEED),
  );
}

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
      const main = document.querySelector<HTMLElement>(X_SELECTORS.mainRoot);
      const primary = main?.querySelector<HTMLElement>(X_SELECTORS.primaryColumn) ?? main;
      if (primary && !primary.closest(X_SELECTORS.dialogContainer)) {
        for (const seed of primary.querySelectorAll<HTMLElement>(COMPOSER_SEED)) {
          if (seed.closest(`${X_SELECTORS.dialogContainer}, ${X_SELECTORS.layersRoot}, ${X_SELECTORS.tweetArticle}`)) continue;
          let composer: HTMLElement | null = null;
          for (let cursor = seed.parentElement; cursor && cursor !== primary; cursor = cursor.parentElement) {
            if (containsOtherContent(cursor, seed)) break;
            composer = cursor;
          }
          if (composer) next.add(composer);
        }
      }
    }

    // 入力欄と投稿ボタンから同じ投稿エリアを検出した場合、外側の枠だけを残す。
    for (const element of next) {
      if ([...next].some((other) => other !== element && other.contains(element))) next.delete(element);
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
