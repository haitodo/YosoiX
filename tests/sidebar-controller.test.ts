import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SidebarController } from "../src/content/sidebar-controller";

describe("中央レイアウトを維持した右サイドバー非表示", () => {
  let controller: SidebarController;
  let style: HTMLStyleElement;
  beforeEach(() => {
    document.documentElement.setAttribute("data-yosoix-enabled", "true");
    style = document.createElement("style");
    style.textContent = readFileSync("src/styles/content.css", "utf8");
    document.head.append(style);
    document.body.innerHTML = `<main role="main"><div style="display:flex;justify-content:space-between">
      <div data-testid="primaryColumn" style="width:600px;max-width:600px;flex-grow:0"><article>Timeline</article></div>
      <div data-testid="sidebarColumn" style="width:350px"><a href="/explore">Trends</a></div>
    </div></main><div id="layers"><div role="dialog"><div data-testid="sidebarColumn">Modal</div></div></div>`;
    controller = new SidebarController();
  });
  afterEach(() => {
    controller.updateConfig(false, false);
    document.documentElement.removeAttribute("data-yosoix-enabled");
    style.remove();
  });

  it("右カラムの占有幅と中央カラムのCSSを維持し、OFFで表示を戻す", () => {
    const primary = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]')!;
    const sidebar = document.querySelector<HTMLElement>('main [data-testid="sidebarColumn"]')!;
    const before = getComputedStyle(primary);
    controller.updateConfig(true, true);
    const hidden = getComputedStyle(sidebar);
    expect(hidden.visibility).toBe("hidden");
    expect(hidden.display).not.toBe("none");
    expect(hidden.width).toBe("350px");
    const after = getComputedStyle(primary);
    expect([after.width, after.maxWidth, after.flexGrow]).toEqual([before.width, before.maxWidth, before.flexGrow]);
    expect(getComputedStyle(primary.parentElement!).justifyContent).toBe("space-between");
    expect(getComputedStyle(document.querySelector('#layers [data-testid="sidebarColumn"]')!).visibility).toBe("visible");
    controller.updateConfig(true, false);
    expect(getComputedStyle(sidebar).visibility).toBe("visible");
    expect(sidebar.hasAttribute("data-yosoix-right-sidebar")).toBe(false);
  });

  it("補助asideの再生成にも対応し、投稿内・ダイアログ内のasideは対象外にする", () => {
    const main = document.querySelector("main")!;
    main.innerHTML = `<div data-testid="primaryColumn"><aside role="complementary">Tweet</aside></div>
      <div role="dialog"><aside role="complementary">Modal</aside></div><aside role="complementary" id="sidebar">Trends</aside>`;
    controller.updateConfig(true, true);
    const oldSidebar = document.getElementById("sidebar")!;
    expect(document.querySelectorAll("[data-yosoix-right-sidebar]")).toHaveLength(1);
    expect(getComputedStyle(oldSidebar).visibility).toBe("hidden");
    oldSidebar.outerHTML = '<aside role="complementary" id="new-sidebar">New</aside>';
    controller.reconcileLayout();
    expect(oldSidebar.hasAttribute("data-yosoix-right-sidebar")).toBe(false);
    expect(getComputedStyle(document.getElementById("new-sidebar")!).visibility).toBe("hidden");
    main.innerHTML = '<div data-testid="primaryColumn">Settings</div>';
    controller.reconcileLayout();
    expect(document.querySelector("[data-yosoix-right-sidebar]")).toBeNull();
  });
});
