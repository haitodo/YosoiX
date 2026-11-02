import { X_SELECTORS } from "./tweet-dom";

const COMPOSER_MARK = "data-yosoix-home-composer";
// 投稿欄を包む要素だけを隠し、タブ・タイムライン・ダイアログまで巻き込まない。
const FRAME_BOUNDARY = [
  "header", "nav", '[role="tablist"]', X_SELECTORS.tweetArticle,
  X_SELECTORS.dialogContainer, X_SELECTORS.layersRoot,
].join(", ");
const CONTENT_BOUNDARY = `${FRAME_BOUNDARY}, [role="heading"]`;
const CONTENT_CONTAINER = 'section, [role="region"], [data-testid="cellInnerDiv"]';
const COMPOSER_SEED = `${X_SELECTORS.homeComposerEditor}, ${X_SELECTORS.inlinePostButton}`;
const PAGE_CONTENT = `header, nav, [role="tablist"], section[role="region"], ${X_SELECTORS.tweetArticle}`;

function isComposerFrame(element: HTMLElement): boolean {
  if (element.matches(FRAME_BOUNDARY) || element.querySelector(FRAME_BOUNDARY)) return false;
  // primaryColumn直下に投稿欄がある別構造では、その内部のdivを外枠と誤認しない。
  const siblings = element.parentElement?.children ?? [];
  if (![...siblings].some((sibling) => sibling !== element &&
    (sibling.matches(PAGE_CONTENT) || sibling.querySelector(PAGE_CONTENT)))) return false;
  // 枠内の見出し・メディア・余白は投稿エリアの一部。別のタイムライン領域は含めない。
  return ![...element.querySelectorAll('[role="region"], [data-testid="primaryColumn"]')]
    .some((region) => !region.querySelector(COMPOSER_SEED));
}

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
        // Control Panel for TwitterのTweetBox検出を参考に、primaryColumn > div > divの
        // 投稿入力欄を含む枝を優先する。入力欄の祖先走査だけでは外枠や区切り線が残る。
        const frames = primary.matches(X_SELECTORS.primaryColumn)
          ? [...primary.querySelectorAll<HTMLElement>(X_SELECTORS.homeComposerFrame)] : [];
        for (const seed of primary.querySelectorAll<HTMLElement>(COMPOSER_SEED)) {
          if (seed.closest(`${X_SELECTORS.dialogContainer}, ${X_SELECTORS.layersRoot}, ${X_SELECTORS.tweetArticle}`)) continue;
          const frame = frames.find((candidate) => candidate.contains(seed) && isComposerFrame(candidate));
          if (frame) {
            next.add(frame);
            continue;
          }
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
