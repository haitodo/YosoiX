// @vitest-environment-options {"url":"https://x.com/home"}
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComposerController } from "../src/content/composer-controller";
import { normalizeSettings } from "../src/core/validators";
import { composerMarkup, tweetMarkup } from "./runtime-helpers";

describe("ホーム上部の投稿エリア", () => {
  let controller: ComposerController;
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = readFileSync("src/styles/content.css", "utf8");
    document.head.append(style);
    document.documentElement.setAttribute("data-yosoix-enabled", "true");
    window.history.replaceState(null, "", "/home");
    document.body.innerHTML = `<main role="main"><div data-testid="primaryColumn"><div>
      <div role="tablist">For you / Following</div>${composerMarkup()}
      <section role="region">${tweetMarkup()}</section>
    </div></div></main><div id="layers"></div>`;
    controller = new ComposerController();
  });
  afterEach(() => {
    controller.restoreAll();
    style.remove();
    document.documentElement.removeAttribute("data-yosoix-enabled");
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
    expect(document.getElementById("composer")?.hasAttribute("data-yosoix-home-composer")).toBe(true);
  });

  it("cellInnerDiv・sectionで囲まれた投稿欄とtweetButtonにも対応する", () => {
    document.querySelector('[data-testid="primaryColumn"]')!.innerHTML = `<div>
      <nav role="tablist">ホーム</nav>
      <section id="composer" role="region" data-testid="cellInnerDiv">
        <div><a href="/alice">Avatar</a><div><div contenteditable="true" role="textbox">いまどうしてる？</div></div></div>
        <div><button data-testid="tweetButton">ポストする</button></div>
      </section>
      <section id="timeline" role="region"><div data-testid="cellInnerDiv">${tweetMarkup()}</div></section>
    </div>`;
    controller.updateConfig(true, true);
    expect(document.querySelectorAll("[data-yosoix-home-composer]")).toHaveLength(1);
    expect(document.getElementById("composer")?.hasAttribute("data-yosoix-home-composer")).toBe(true);
    expect(document.getElementById("timeline")?.closest("[data-yosoix-home-composer]")).toBeNull();
    expect(getComputedStyle(document.getElementById("composer")!).display).toBe("none");
    expect(getComputedStyle(document.getElementById("timeline")!).display).not.toBe("none");
    controller.updateConfig(true, false);
    expect(document.querySelector("[data-yosoix-home-composer]")).toBeNull();
    expect(getComputedStyle(document.getElementById("composer")!).display).not.toBe("none");
  });

  it("入力欄の初期化前でも投稿ボタンから折り畳まれた投稿エリアを検出する", () => {
    document.querySelector('[data-testid="primaryColumn"]')!.innerHTML = `<div role="tablist">Home</div>
      <div data-testid="cellInnerDiv" id="composer"><div>いまどうしてる？</div><div><button data-testid="tweetButton">ポストする</button></div></div>
      <section role="region">Timeline</section>`;
    controller.updateConfig(true, true);
    expect(document.querySelectorAll("[data-yosoix-home-composer]")).toHaveLength(1);
    expect(document.getElementById("composer")?.hasAttribute("data-yosoix-home-composer")).toBe(true);
  });

  it("primaryColumnがなくてもmain内の投稿欄を検出し、ダイアログの投稿欄を除外する", () => {
    document.querySelector('[data-testid="primaryColumn"]')!.removeAttribute("data-testid");
    document.querySelector("main")!.insertAdjacentHTML("beforeend", `<div role="dialog">${composerMarkup()}</div>`);
    controller.updateConfig(true, true);
    expect(document.querySelectorAll("[data-yosoix-home-composer]")).toHaveLength(1);
    expect(document.getElementById("composer")?.hasAttribute("data-yosoix-home-composer")).toBe(true);
  });

  it("タイムライン直下の投稿エリアを、入力欄の外にある枠・見出し・余白ごと隠す", () => {
    document.querySelector('[data-testid="primaryColumn"]')!.innerHTML = `<div>
      <div role="tablist">ホーム</div>
      <div id="composer-frame" class="css-g5y9jx r-kemksi r-184en5c" style="border:1px solid gray;padding:16px;min-height:180px">
        <div role="heading">ポストする</div>
        <div id="inner-composer"><div data-testid="tweetTextarea_7RichTextInputContainer">いまどうしてる？</div></div>
        <div class="toolbar">投稿ツールバー</div>
      </div>
      <section role="region" id="timeline">${tweetMarkup()}</section>
      <div id="unrelated" class="css-g5y9jx r-kemksi r-184en5c">同じクラスの別の要素</div>
    </div>`;
    controller.updateConfig(true, true);
    const frame = document.getElementById("composer-frame")!;
    expect(document.querySelectorAll("[data-yosoix-home-composer]")).toHaveLength(1);
    expect(frame.getAttribute("data-yosoix-home-composer")).toBe("true");
    expect(getComputedStyle(frame).display).toBe("none");
    expect(document.getElementById("inner-composer")!.hasAttribute("data-yosoix-home-composer")).toBe(false);
    expect(document.getElementById("timeline")!.closest("[data-yosoix-home-composer]")).toBeNull();
    expect(getComputedStyle(document.getElementById("unrelated")!).display).not.toBe("none");
    controller.updateConfig(true, false);
    expect(getComputedStyle(frame).display).not.toBe("none");
    expect(frame.style.padding).toBe("16px");
  });
});
