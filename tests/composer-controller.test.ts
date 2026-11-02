// @vitest-environment-options {"url":"https://x.com/home"}
import { beforeEach, describe, expect, it } from "vitest";
import { ComposerController } from "../src/content/composer-controller";
import { normalizeSettings } from "../src/core/validators";
import { composerMarkup, tweetMarkup } from "./runtime-helpers";

describe("ホーム上部の投稿エリア", () => {
  let controller: ComposerController;
  beforeEach(() => {
    window.history.replaceState(null, "", "/home");
    document.body.innerHTML = `<main role="main"><div data-testid="primaryColumn"><div>
      <div role="tablist">For you / Following</div>${composerMarkup()}
      <section role="region">${tweetMarkup()}</section>
    </div></div></main><div id="layers"></div>`;
    controller = new ComposerController();
  });

  it("既存設定で未指定・不正値なら初期値の非表示を補完し、明示的なOFFを維持する", () => {
    for (const raw of [undefined, {}, { hideHomeComposer: "false" }]) {
      expect(normalizeSettings(raw).hideHomeComposer).toBe(true);
    }
    expect(normalizeSettings({ hideHomeComposer: false }).hideHomeComposer).toBe(false);
  });

  it("アバターとツールバーを含む投稿エリアだけを隠し、設定OFF・マスターOFFで戻す", () => {
    controller.updateConfig(true, true);
    expect(document.querySelectorAll('[data-yosoix-home-composer="true"]')).toHaveLength(1);
    expect(document.getElementById("composer")?.getAttribute("data-yosoix-home-composer")).toBe("true");
    expect(document.querySelector('[role="tablist"]')?.closest("[data-yosoix-home-composer]")).toBeNull();
    expect(document.querySelector("article")?.closest("[data-yosoix-home-composer]")).toBeNull();
    controller.updateConfig(true, false);
    expect(document.querySelector("[data-yosoix-home-composer]")).toBeNull();
    controller.updateConfig(true, true);
    controller.updateConfig(false, true);
    expect(document.querySelector("[data-yosoix-home-composer]")).toBeNull();
  });

  it("投稿ダイアログ・タイムライン内の返信欄とホーム以外の入力欄には適用しない", () => {
    document.querySelector("article")!.insertAdjacentHTML("beforeend", composerMarkup());
    document.querySelector('[data-testid="primaryColumn"]')!.insertAdjacentHTML("beforeend",
      `<div aria-modal="true">${composerMarkup()}</div>`);
    document.getElementById("layers")!.innerHTML = `<div role="dialog">${composerMarkup()}</div>`;
    controller.updateConfig(true, true);
    expect(document.querySelectorAll("[data-yosoix-home-composer]")).toHaveLength(1);
    window.history.replaceState(null, "", "/alice/status/123");
    controller.reconcileLayout();
    expect(document.querySelector("[data-yosoix-home-composer]")).toBeNull();
    window.history.replaceState(null, "", "/home");
    controller.reconcileLayout();
    expect(document.querySelectorAll("[data-yosoix-home-composer]")).toHaveLength(1);
  });

  it("空のタイムラインや描画途中でも中央カラム全体を隠さない", () => {
    document.querySelector("section")!.innerHTML = "";
    controller.updateConfig(true, true);
    expect(document.querySelector('[data-testid="primaryColumn"]')?.hasAttribute("data-yosoix-home-composer")).toBe(false);
    expect(document.getElementById("composer")?.hasAttribute("data-yosoix-home-composer")).toBe(true);
    document.querySelector('[data-testid="tweetButtonInline"]')!.remove();
    controller.reconcileLayout();
    expect(document.querySelector("[data-yosoix-home-composer]")).toBeNull();
  });
});
