import { X_SELECTORS } from "./tweet-dom";

/**
 * 右サイドバー非表示＆メインカラム拡張コントローラー（FR-020: spec.md 2.4）
 *
 * 設計方針（spec.md 2.4.2 準拠）:
 * - X のレイアウト変更に備え、「右サイドバー要素の検出・属性付与（本クラス）」と
 *   「幅拡張・非表示のレイアウト CSS（content.css）」を明確に分離する。
 * - ダイアログ・モーダル（#layers, [role="dialog"]）内の aside を誤って消さないよう、
 *   main[role="main"] のページ本体レイアウトにスコープを限定する。
 */

const ROOT_SIDEBAR_ATTR = "data-yosoix-hide-right-sidebar";
const RIGHT_SIDEBAR_MARK = "data-yosoix-right-sidebar";
const MAIN_COLUMN_MARK = "data-yosoix-main-column";
const LAYOUT_ROW_MARK = "data-yosoix-layout-row";

function mark(element: Element, attribute: string): void {
  if (element.getAttribute(attribute) !== "true") element.setAttribute(attribute, "true");
}

export class SidebarController {
  private active = false;

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
   * SPA 画面遷移や main 再描画時に右サイドバーとメインカラムのペアを特定し、
   * CSS フック用の data 属性を付与する。
   * 右サイドバーが存在しない画面（DM・設定画面など）では何もしない。
   */
  reconcileLayout(): void {
    if (!this.active) {
      return;
    }

    const main = document.querySelector<HTMLElement>(X_SELECTORS.mainRoot);
    if (!main) {
      return;
    }

    const primaryColumn = main.querySelector<HTMLElement>(X_SELECTORS.primaryColumn);
    const rightSidebar = this.detectRightSidebarElement(main, primaryColumn);

    if (!rightSidebar) {
      // 右サイドバーが存在しない2ペイン画面（Messages / Settings 等）ではレイアウト変更しない
      this.clearLayoutMarks();
      return;
    }

    mark(rightSidebar, RIGHT_SIDEBAR_MARK);

    if (primaryColumn && !primaryColumn.closest(X_SELECTORS.dialogContainer)) {
      mark(primaryColumn, MAIN_COLUMN_MARK);
      const layoutRow = this.findSharedRowContainer(primaryColumn, rightSidebar, main);
      if (layoutRow) {
        mark(layoutRow, LAYOUT_ROW_MARK);
      }
    }
  }

  restoreAll(): void {
    document.documentElement.removeAttribute(ROOT_SIDEBAR_ATTR);
    this.clearLayoutMarks();
  }

  private clearLayoutMarks(): void {
    for (const attr of [RIGHT_SIDEBAR_MARK, MAIN_COLUMN_MARK, LAYOUT_ROW_MARK]) {
      const marked = document.querySelectorAll(`[${attr}]`);
      for (const el of marked) {
        el.removeAttribute(attr);
      }
    }
  }

  private detectRightSidebarElement(
    main: HTMLElement,
    primaryColumn: HTMLElement | null,
  ): HTMLElement | null {
    // 第1候補: [data-testid="sidebarColumn"]
    const sidebarCol = main.querySelector<HTMLElement>(X_SELECTORS.sidebarColumn);
    if (sidebarCol && !sidebarCol.closest(X_SELECTORS.dialogContainer)) {
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

  private findSharedRowContainer(
    primaryColumn: HTMLElement,
    rightSidebar: HTMLElement,
    main: HTMLElement,
  ): HTMLElement | null {
    let cursor: HTMLElement | null = primaryColumn.parentElement;
    while (cursor && cursor !== main) {
      if (cursor.contains(rightSidebar)) {
        return cursor;
      }
      cursor = cursor.parentElement;
    }
    return null;
  }
}
