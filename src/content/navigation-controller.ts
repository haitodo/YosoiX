import { matchNavItemLink, PROTECTED_NAV_TEST_IDS } from "../core/nav-items";
import type { NavItemId } from "../core/types";
import { X_SELECTORS } from "./tweet-dom";

/**
 * 左ナビゲーションおよび「もっと見る」メニュー個別非表示コントローラー（FR-010: spec.md 2.3）
 *
 * - 常設の左ナビゲーション（header nav）と動的に開く「もっと見る」メニュー（#layers 内 Dropdown / menu）の
 *   双方に同じ設定を適用する。
 * - ナビゲーション全体（nav）、投稿ボタン、アカウント切替UI等を誤って消さない保護ガードを備える。
 * - マスターOFFまたは項目OFF時は即座に data-yosoix-nav-hidden 属性を除去して元の表示へ戻す。
 */

const HIDDEN_ATTR = "data-yosoix-nav-hidden";
const ROOT_HIDE_NAV_ATTR = "data-yosoix-hide-nav";

/**
 * リンク要素または単一項目ラッパーのうち、安全に非表示にできる対象要素を返す。
 * 親の <nav> 全体や複数リンクを含むコンテナは絶対に返さない。
 */
function resolveSafeNavHideTarget(anchor: HTMLAnchorElement, container: Element): HTMLElement {
  const parent = anchor.parentElement;
  if (
    parent &&
    parent !== container &&
    parent.tagName !== "NAV" &&
    parent.tagName !== "HEADER" &&
    parent.getAttribute("role") !== "menu" &&
    parent.getAttribute("data-testid") !== "Dropdown"
  ) {
    const linksInParent = parent.querySelectorAll("a[href]");
    const hasProtectedChild = Array.from(PROTECTED_NAV_TEST_IDS).some((testId) =>
      Boolean(parent.querySelector(`[data-testid="${testId}"]`)),
    );
    if (linksInParent.length === 1 && !hasProtectedChild) {
      return parent;
    }
  }
  return anchor;
}

export class NavigationController {
  private hiddenSet = new Set<NavItemId>();
  private enabled = true;

  /**
   * 設定を更新し、現在の DOM に即時反映する。
   */
  updateConfig(enabled: boolean, hiddenNavItems: readonly NavItemId[]): void {
    this.enabled = enabled;
    this.hiddenSet = new Set(hiddenNavItems);
    this.syncRootAttribute();

    if (!this.enabled || this.hiddenSet.size === 0) {
      this.restoreAll();
      return;
    }

    this.applyToDocument();
  }

  /**
   * 常設ナビゲーションおよび現在開いているメニューに対して非表示ルールを適用する。
   */
  applyToDocument(root: ParentNode = document): void {
    if (!this.enabled || this.hiddenSet.size === 0) {
      return;
    }

    const containers: Element[] = [];
    const primaryNavs = root.querySelectorAll(X_SELECTORS.primaryNav);
    for (const nav of primaryNavs) containers.push(nav);

    const layers =
      root === document
        ? document.querySelector(X_SELECTORS.layersRoot)
        : root instanceof Element && root.matches(X_SELECTORS.layersRoot)
          ? root
          : root.querySelector(X_SELECTORS.layersRoot);

    if (layers) {
      const menus = layers.querySelectorAll(X_SELECTORS.dropdownMenu);
      for (const menu of menus) containers.push(menu);
    } else if (root instanceof Element && root.matches(X_SELECTORS.dropdownMenu)) {
      containers.push(root);
    }

    for (const container of containers) {
      this.applyToContainer(container);
    }
  }

  /**
   * すべての非表示状態を解除する。
   */
  restoreAll(): void {
    document.documentElement.removeAttribute(ROOT_HIDE_NAV_ATTR);
    const hiddenElements = document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`);
    for (const el of hiddenElements) {
      el.removeAttribute(HIDDEN_ATTR);
    }
  }

  private syncRootAttribute(): void {
    if (!this.enabled || this.hiddenSet.size === 0) {
      document.documentElement.removeAttribute(ROOT_HIDE_NAV_ATTR);
      return;
    }
    document.documentElement.setAttribute(
      ROOT_HIDE_NAV_ATTR,
      Array.from(this.hiddenSet).join(" "),
    );
  }

  private applyToContainer(container: Element): void {
    const anchors = container.querySelectorAll<HTMLAnchorElement>("a[href], a[data-testid]");
    for (const anchor of anchors) {
      const matchedId = matchNavItemLink(anchor);
      const target = resolveSafeNavHideTarget(anchor, container);

      if (matchedId && this.hiddenSet.has(matchedId)) {
        target.setAttribute(HIDDEN_ATTR, matchedId);
      } else if (target.hasAttribute(HIDDEN_ATTR)) {
        target.removeAttribute(HIDDEN_ATTR);
      }
    }
  }
}
