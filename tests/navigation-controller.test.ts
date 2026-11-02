import { beforeEach, describe, expect, it } from "vitest";
import { matchNavItemLink, NAV_ITEM_DEFINITIONS, PROTECTED_NAV_TEST_IDS } from "../src/core/nav-items";
import { DEFAULT_HIDDEN_NAV_ITEMS, DEFAULT_SETTINGS } from "../src/core/types";
import { normalizeSettings } from "../src/core/validators";
import { NavigationController } from "../src/content/navigation-controller";

describe("nav-items: matchNavItemLink", () => {
  function createAnchor(href: string, testId?: string): HTMLAnchorElement {
    const a = document.createElement("a");
    a.setAttribute("href", href);
    if (testId) a.setAttribute("data-testid", testId);
    return a;
  }

  it("定義された項目がそれぞれのURL/ホスト/testidで正しくマッチする", () => {
    expect(matchNavItemLink(createAnchor("/compose/post", "SideNav_NewTweet_Button"))).toBe("post");
    expect(matchNavItemLink(createAnchor("/compose/tweet"))).toBe("post");
    // 0. premium
    expect(matchNavItemLink(createAnchor("/i/premium_sign_up"))).toBe("premium");
    expect(matchNavItemLink(createAnchor("/i/premium_tier_switch"))).toBe("premium");
    expect(matchNavItemLink(createAnchor("/other", "AppTabBar_Premium_Link"))).toBe("premium");

    // 1. explore
    expect(matchNavItemLink(createAnchor("/explore"))).toBe("explore");
    expect(matchNavItemLink(createAnchor("/explore/tabs/for-you"))).toBe("explore");
    expect(matchNavItemLink(createAnchor("/other", "AppTabBar_Explore_Link"))).toBe("explore");

    // 2. follow
    expect(matchNavItemLink(createAnchor("/i/connect_people"))).toBe("follow");
    expect(matchNavItemLink(createAnchor("/i/follow_people"))).toBe("follow");

    // 3. chat
    expect(matchNavItemLink(createAnchor("/i/chat"))).toBe("chat");

    // 4. calls
    expect(matchNavItemLink(createAnchor("/i/calls"))).toBe("calls");

    // 5. history
    expect(matchNavItemLink(createAnchor("/i/history"))).toBe("history");

    // 6. creator_studio
    expect(matchNavItemLink(createAnchor("/creators/studio"))).toBe("creator_studio");

    // 7. grok
    expect(matchNavItemLink(createAnchor("/i/grok"))).toBe("grok");

    // 8. jobs
    expect(matchNavItemLink(createAnchor("/jobs"))).toBe("jobs");

    // 9. lists
    expect(matchNavItemLink(createAnchor("/i/lists"))).toBe("lists");
    expect(matchNavItemLink(createAnchor("/elonmusk/lists"))).toBe("lists");

    // 10. communities
    expect(matchNavItemLink(createAnchor("/i/communities"))).toBe("communities");
    expect(matchNavItemLink(createAnchor("/developer/communities"))).toBe("communities");

    // 11. business
    expect(matchNavItemLink(createAnchor("/i/premium-business"))).toBe("business");
    expect(matchNavItemLink(createAnchor("/i/verified-orgs-signup"))).toBe("business");

    // 12. ads
    expect(matchNavItemLink(createAnchor("https://ads.x.com/overview"))).toBe("ads");
    expect(matchNavItemLink(createAnchor("https://ads.twitter.com"))).toBe("ads");

    // 13. spaces
    expect(matchNavItemLink(createAnchor("/i/spaces/start"))).toBe("spaces");
  });

  it("保護対象の主要UI（ホーム・通知・プロフィール等）は絶対にマッチしない", () => {
    for (const testId of PROTECTED_NAV_TEST_IDS) {
      const anchor = createAnchor("/home", testId);
      expect(matchNavItemLink(anchor)).toBeNull();
    }
  });

  it("無関係なリンク（ツイート詳細や通常ユーザープロフ等）は null を返す", () => {
    expect(matchNavItemLink(createAnchor("/elonmusk"))).toBeNull();
    expect(matchNavItemLink(createAnchor("/jack/status/20"))).toBeNull();
    expect(matchNavItemLink(createAnchor("/settings"))).toBeNull();
  });
});

describe("navigation-controller: NavigationController", () => {
  let controller: NavigationController;

  beforeEach(() => {
    document.documentElement.removeAttribute("data-yosoix-hide-nav");
    document.body.innerHTML = `
      <header role="banner">
        <nav role="navigation">
          <a href="/home" data-testid="AppTabBar_Home_Link"><span>Home</span></a>
          <a href="/i/premium_sign_up"><span>Premium</span></a>
          <a href="/explore"><span>Explore</span></a>
          <a href="/i/grok"><span>Grok</span></a>
          <a href="/i/lists"><span>Lists</span></a>
        </nav>
      </header>
      <div id="layers">
        <div data-testid="Dropdown">
          <a href="/jobs"><span>Jobs</span></a>
          <a href="/creators/studio"><span>Studio</span></a>
        </div>
      </div>
    `;
    controller = new NavigationController();
  });

  it("選択した項目のみに data-yosoix-nav-hidden が付与され、未選択や保護項目は付与されない", () => {
    controller.updateConfig(true, ["premium", "explore", "jobs"]);

    const premiumLink = document.querySelector('a[href="/i/premium_sign_up"]');
    const exploreLink = document.querySelector('a[href="/explore"]');
    const jobsLink = document.querySelector('a[href="/jobs"]');
    const homeLink = document.querySelector('a[href="/home"]');
    const grokLink = document.querySelector('a[href="/i/grok"]');

    expect(premiumLink?.getAttribute("data-yosoix-nav-hidden")).toBe("premium");
    expect(exploreLink?.getAttribute("data-yosoix-nav-hidden")).toBe("explore");
    expect(jobsLink?.getAttribute("data-yosoix-nav-hidden")).toBe("jobs");

    expect(homeLink?.hasAttribute("data-yosoix-nav-hidden")).toBe(false);
    expect(grokLink?.hasAttribute("data-yosoix-nav-hidden")).toBe(false);

    expect(document.documentElement.getAttribute("data-yosoix-hide-nav")).toContain("premium");
    expect(document.documentElement.getAttribute("data-yosoix-hide-nav")).toContain("explore");
    expect(document.documentElement.getAttribute("data-yosoix-hide-nav")).toContain("jobs");
  });

  it("enabled が false または hiddenNavItems が空になると、付与された属性がすべて除去される", () => {
    controller.updateConfig(true, ["explore", "jobs"]);
    expect(document.querySelectorAll("[data-yosoix-nav-hidden]")).toHaveLength(2);

    controller.updateConfig(false, ["explore", "jobs"]);
    expect(document.querySelectorAll("[data-yosoix-nav-hidden]")).toHaveLength(0);
    expect(document.documentElement.hasAttribute("data-yosoix-hide-nav")).toBe(false);
  });

  it("restoreAll() で即座にすべての非表示状態が解除される", () => {
    controller.updateConfig(true, ["grok", "lists"]);
    expect(document.querySelectorAll("[data-yosoix-nav-hidden]")).toHaveLength(2);

    controller.restoreAll();
    expect(document.querySelectorAll("[data-yosoix-nav-hidden]")).toHaveLength(0);
    expect(document.documentElement.hasAttribute("data-yosoix-hide-nav")).toBe(false);
  });

  it("nav外の投稿ボタンだけを隠し、アカウント切替や投稿フォームには触れない", () => {
    const header = document.querySelector("header")!;
    header.insertAdjacentHTML("beforeend", `<div id="post-controls"><button data-testid="SideNav_NewTweet_Button">Post</button><button data-testid="SideNav_AccountSwitcher_Button">Account</button></div>`);
    document.body.insertAdjacentHTML("beforeend", '<form><button data-testid="tweetButtonInline">投稿</button></form>');
    controller.updateConfig(true, ["post"]);
    expect(header.querySelector('[data-testid="SideNav_NewTweet_Button"]')?.getAttribute("data-yosoix-nav-hidden")).toBe("post");
    expect(document.querySelectorAll("[data-yosoix-nav-hidden]")).toHaveLength(1);
    expect(document.getElementById("post-controls")?.hasAttribute("data-yosoix-nav-hidden")).toBe(false);
    controller.updateConfig(true, []);
    expect(document.querySelectorAll("[data-yosoix-nav-hidden]")).toHaveLength(0);
  });
});

describe("default nav item settings", () => {
  it("Explore・History・投稿ボタンはデフォルト表示し、それ以外を非表示にする", () => {
    const hiddenSet = new Set(DEFAULT_HIDDEN_NAV_ITEMS);

    expect(hiddenSet.has("explore")).toBe(false);
    expect(hiddenSet.has("history")).toBe(false);
    expect(hiddenSet.has("post")).toBe(false);

    const expectedIncluded = NAV_ITEM_DEFINITIONS
      .map((d) => d.id)
      .filter((id) => id !== "explore" && id !== "history" && id !== "post");

    expect(DEFAULT_HIDDEN_NAV_ITEMS).toHaveLength(expectedIncluded.length);
    for (const id of expectedIncluded) {
      expect(hiddenSet.has(id)).toBe(true);
    }

    expect(DEFAULT_SETTINGS.hiddenNavItems).toEqual(DEFAULT_HIDDEN_NAV_ITEMS);
  });

  it("normalizeSettings は未定義時にデフォルトで Explore・History 以外非表示の設定を補完する", () => {
    const normalizedDefault = normalizeSettings({});
    expect(normalizedDefault.hiddenNavItems).toEqual(DEFAULT_HIDDEN_NAV_ITEMS);

    const normalizedExplicitEmpty = normalizeSettings({ hiddenNavItems: [] });
    expect(normalizedExplicitEmpty.hiddenNavItems).toEqual([]);
  });
});
