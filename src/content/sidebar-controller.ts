import { X_SELECTORS } from "./tweet-dom";

/**
 * 中央カラムの配置を維持する右サイドバー非表示コントローラー（FR-020）
 *
 * 設計方針（spec.md 2.4.2 準拠）:
 * - X のレイアウト変更に備え、「右サイドバー要素の検出・属性付与（本クラス）」と
 *   「非表示の CSS（content.css）」を明確に分離する。
 * - ダイアログ・モーダル内の aside を誤って消さないよう、
 *   main[role="main"] のページ本体レイアウトにスコープを限定する。
 */

const ROOT_SIDEBAR_ATTR = "data-yosoix-hide-right-sidebar";
const RIGHT_SIDEBAR_MARK = "data-yosoix-right-sidebar";

function mark(element: Element, attribute: string): void {
  if (element.getAttribute(attribute) !== "true") element.setAttribute(attribute, "true");
}

export class SidebarController {
  private active = false;
  private sidebar: HTMLElement | null = null;

  updateConfig(enabled: boolean, hideRightSidebar: boolean, reconcile = true): void {
    const shouldHide = enabled && hideRightSidebar;
    this.active = shouldHide;

    if (!shouldHide) {
      this.restoreAll();
      return;
    }

    mark(document.documentElement, ROOT_SIDEBAR_ATTR);
    if (reconcile) this.reconcileLayout();
  }

  /**
   * SPA 画面遷移や main 再描画時に右サイドバーを特定し、CSS フックを付与する。
   * 右サイドバーが存在しない画面（DM・設定画面など）では何もしない。
   */
  reconcileLayout(): void {
    if (!this.active) {
      return;
    }

    const main = document.querySelector<HTMLElement>(X_SELECTORS.mainRoot);
    const primaryColumn = main?.querySelector<HTMLElement>(X_SELECTORS.primaryColumn) ?? null;
    const rightSidebar = main && !main.closest(X_SELECTORS.dialogContainer)
      ? this.detectRightSidebarElement(main, primaryColumn) : null;
    if (this.sidebar !== rightSidebar) this.sidebar?.removeAttribute(RIGHT_SIDEBAR_MARK);
    this.sidebar = rightSidebar;
    if (rightSidebar) mark(rightSidebar, RIGHT_SIDEBAR_MARK);
  }

  restoreAll(): void {
    document.documentElement.removeAttribute(ROOT_SIDEBAR_ATTR);
    this.sidebar?.removeAttribute(RIGHT_SIDEBAR_MARK);
    this.sidebar = null;
  }

  private detectRightSidebarElement(
    main: HTMLElement,
    primaryColumn: HTMLElement | null,
  ): HTMLElement | null {
    // 第1候補: [data-testid="sidebarColumn"]
    const sidebarCol = main.querySelector<HTMLElement>(X_SELECTORS.sidebarColumn);
    if (sidebarCol && !sidebarCol.closest(X_SELECTORS.dialogContainer) && !primaryColumn?.contains(sidebarCol)) {
      return sidebarCol;
    }

    // 第2候補（補助）: main 内の aside[role="complementary"] のうち primaryColumn や dialog の外にあるカラム
    const asides = main.querySelectorAll<HTMLElement>(X_SELECTORS.complementaryAside);
    for (const aside of asides) {
      if (aside.closest(X_SELECTORS.dialogContainer)) continue;
      if (primaryColumn?.contains(aside)) continue;
      return aside;
    }

    return null;
  }
}
