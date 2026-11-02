import type { NavItemId } from "./types";

/**
 * 左ナビゲーション／「もっと見る」メニュー項目の定義テーブル（spec.md 2.3.2）
 *
 * 新しい項目の追加や X 側の URL 変更時は、この定義テーブルのみを更新すれば
 * Content Script（ナビゲーション制御）と Options UI（チェックボックス一覧）の両方に反映される。
 */
export interface NavItemDefinition {
  readonly id: NavItemId;
  /** 設定画面に表示する日本語ラベル */
  readonly label: string;
  /** 設定画面の補足説明 */
  readonly description: string;
  /** 完全一致する pathname（末尾スラッシュ除去後） */
  readonly exactPaths?: readonly string[];
  /** 前方一致する pathname プレフィックス */
  readonly pathPrefixes?: readonly string[];
  /** 動的ユーザー名パス等に対する正規表現（pathname に対して判定） */
  readonly pathRegexes?: readonly RegExp[];
  /** 外部サブドメイン等のホスト名一致（ads.x.com 等） */
  readonly hosts?: readonly string[];
  /** 補助的な data-testid 一致 */
  readonly testIds?: readonly string[];
}

export const NAV_ITEM_DEFINITIONS: readonly NavItemDefinition[] = [
  {
    id: "post",
    label: "ポストする（投稿ボタン）",
    description: "左サイドバーの投稿ボタンを非表示にする",
    exactPaths: ["/compose/post", "/compose/tweet"],
    testIds: ["SideNav_NewTweet_Button"],
  },
  {
    id: "premium",
    label: "Premium（プレミアム）",
    description: "/i/premium_sign_up 等へのリンク",
    exactPaths: ["/i/premium_sign_up", "/i/premium_tier_switch", "/i/premium"],
    pathPrefixes: ["/i/premium_sign_up", "/i/premium_tier_switch"],
    testIds: ["AppTabBar_Premium_Link"],
  },
  {
    id: "explore",
    label: "Explore（話題を検索）",
    description: "/explore へのナビゲーションリンク",
    exactPaths: ["/explore"],
    pathPrefixes: ["/explore/"],
    testIds: ["AppTabBar_Explore_Link"],
  },
  {
    id: "follow",
    label: "Follow（フォローする人を探す）",
    description: "/i/connect_people・/i/follow_people へのリンク",
    exactPaths: ["/i/connect_people", "/i/follow_people"],
    testIds: ["AppTabBar_Follow_Link"],
  },
  {
    id: "chat",
    label: "Chat（チャット）",
    description: "/i/chat へのリンク",
    exactPaths: ["/i/chat"],
    pathPrefixes: ["/i/chat/"],
  },
  {
    id: "calls",
    label: "Calls（通話）",
    description: "/i/calls へのリンク",
    exactPaths: ["/i/calls"],
    pathPrefixes: ["/i/calls/"],
  },
  {
    id: "history",
    label: "History（履歴）",
    description: "Xの閲覧履歴画面に対応するリンク",
    exactPaths: ["/i/history", "/i/jf/stories/history"],
    pathRegexes: [/^\/i\/history(?:\/|$)/i],
  },
  {
    id: "creator_studio",
    label: "Creator Studio（クリエイタースタジオ）",
    description: "/creators/studio 等へのリンク",
    exactPaths: ["/creators/studio", "/i/jf/creators/studio"],
    pathPrefixes: ["/creators/studio/"],
  },
  {
    id: "grok",
    label: "Grok",
    description: "/i/grok へのリンク",
    exactPaths: ["/i/grok"],
    pathPrefixes: ["/i/grok/"],
  },
  {
    id: "jobs",
    label: "Jobs（求人）",
    description: "/jobs へのリンク",
    exactPaths: ["/jobs"],
    pathPrefixes: ["/jobs/"],
  },
  {
    id: "lists",
    label: "Lists（リスト）",
    description: "/{ユーザー名}/lists または /i/lists へのリンク",
    exactPaths: ["/i/lists"],
    pathRegexes: [/^\/[A-Za-z0-9_]{1,20}\/lists$/],
  },
  {
    id: "communities",
    label: "Communities（コミュニティ）",
    description: "/{ユーザー名}/communities または /i/communities へのリンク",
    exactPaths: ["/i/communities"],
    pathRegexes: [/^\/[A-Za-z0-9_]{1,20}\/communities$/],
  },
  {
    id: "business",
    label: "Business（認証済み組織・ビジネス）",
    description: "/i/premium-business・/i/verified-orgs-signup 等へのリンク",
    exactPaths: [
      "/i/premium-business",
      "/i/verified-orgs-signup",
      "/i/verified-organizations",
    ],
    pathPrefixes: ["/i/premium-business/"],
  },
  {
    id: "ads",
    label: "Ads（広告）",
    description: "ads.x.com / ads.twitter.com へのリンク",
    hosts: ["ads.x.com", "ads.twitter.com"],
    exactPaths: ["/i/ads"],
  },
  {
    id: "spaces",
    label: "Create your Space（スペースを作成）",
    description: "/i/spaces/start へのリンク",
    exactPaths: ["/i/spaces/start"],
  },
] as const;

export const ALL_NAV_ITEM_IDS: ReadonlySet<NavItemId> = new Set(
  NAV_ITEM_DEFINITIONS.map((item) => item.id),
);

/**
 * 絶対に非表示にしてはならない主要UIの testid（誤消去防止ガード: spec.md 2.3.1, 6.1）
 */
export const PROTECTED_NAV_TEST_IDS: ReadonlySet<string> = new Set([
  "AppTabBar_Home_Link",
  "AppTabBar_Notifications_Link",
  "AppTabBar_DirectMessage_Link",
  "AppTabBar_Profile_Link",
  "AppTabBar_More_Menu",
  "SideNav_AccountSwitcher_Button",
]);

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }
  return pathname;
}

/**
 * リンク要素（<a>）がどの NavItemId に該当するかを意味属性（href / data-testid）から判定する。
 * 難読化クラス名（r-xxxxx）や DOM 位置（nth-child）には一切依存しない。
 */
export function matchNavItemLink(anchor: Element): NavItemId | null {
  const testId = anchor.getAttribute("data-testid");
  if (testId && PROTECTED_NAV_TEST_IDS.has(testId)) {
    return null;
  }

  const rawHref = anchor.getAttribute("href");
  let parsedUrl: URL | null = null;
  if (rawHref) {
    try {
      parsedUrl = new URL(rawHref, "https://x.com");
    } catch {
      parsedUrl = null;
    }
  }

  const host = parsedUrl?.hostname.toLowerCase() ?? "";
  const isXHost =
    host === "x.com" ||
    host === "www.x.com" ||
    host === "twitter.com" ||
    host === "www.twitter.com";
  const pathname = parsedUrl ? normalizePathname(parsedUrl.pathname) : "";

  for (const def of NAV_ITEM_DEFINITIONS) {
    if (testId && def.testIds?.includes(testId)) {
      return def.id;
    }

    if (parsedUrl && def.hosts?.includes(host)) {
      return def.id;
    }

    if (!parsedUrl || !isXHost) {
      continue;
    }

    if (def.exactPaths?.includes(pathname)) {
      return def.id;
    }

    if (def.pathPrefixes?.some((prefix) => parsedUrl.pathname.startsWith(prefix))) {
      return def.id;
    }

    if (def.pathRegexes?.some((re) => re.test(pathname))) {
      return def.id;
    }
  }

  return null;
}
