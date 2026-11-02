/**
 * X (Twitter) DOM 構造解析・セレクター集約モジュール（spec.md 2.5.2, 2.6.1, 5.4）
 *
 * 難読化クラス名（r-xxxxx 等）やインデックス順序への依存を避け、
 * data-testid / role / セマンティック要素（article, nav, main, time, a[href]）に集約する。
 */

export const X_SELECTORS = {
  reactRoot: "#react-root",
  layersRoot: "#layers",
  bannerHeader: 'header[role="banner"]',
  primaryNav: 'header[role="banner"] nav[role="navigation"]',
  dropdownMenu: '[data-testid="Dropdown"], [role="menu"]',
  mainRoot: 'main[role="main"]',
  primaryColumn: '[data-testid="primaryColumn"]',
  sidebarColumn: '[data-testid="sidebarColumn"]',
  complementaryAside: 'aside[role="complementary"]',
  dialogContainer: '[role="dialog"], [aria-modal="true"]',
  homeComposerEditor: '[data-testid^="tweetTextarea"], [contenteditable="true"][role="textbox"], textarea[role="textbox"]',
  homeComposerFrame: ':scope > div > div',
  inlinePostButton: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',

  tweetArticle: 'article[data-testid="tweet"]',
  userNameBlock: '[data-testid="User-Name"]',
  actionBarGroup: '[role="group"]',
  standardTweetAction:
    '[data-testid="reply"], [data-testid="retweet"], [data-testid="unretweet"], [data-testid="like"], [data-testid="unlike"], [data-testid="bookmark"], [data-testid="removeBookmark"]',
  outerMediaCandidate:
    '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], video',
  cardWrapper: '[data-testid="card.wrapper"]',
  quoteTweetContainer: '[data-testid="quoteTweet"]',
} as const;

/** ツイート下部の標準アクション。共有はtestidがないXの表示にも対応する。 */
export const TWEET_ACTION_SELECTORS = {
  reply: '[data-testid="reply"]',
  repost: '[data-testid="retweet"], [data-testid="unretweet"]',
  analytics: 'a[href*="/status/"][href*="/analytics"], [data-testid="analytics"]',
  share: '[data-testid="share"], :is(button, [role="button"]):is([aria-label="Share" i], [aria-label="Share post" i], [aria-label="Share Tweet" i], [aria-label="共有"], [aria-label="ポストを共有"], [aria-label="ポストを共有する"], [aria-label="ツイートを共有"], [aria-label="ツイートを共有する"])',
  bookmark: '[data-testid="bookmark"], [data-testid="removeBookmark"]',
  like: '[data-testid="like"], [data-testid="unlike"]',
} as const;

const STATUS_PATH_REGEX = /^\/([A-Za-z0-9_]{1,20})\/status\/(\d{1,25})(?:\/|$|\?)/;
const GENERIC_WEB_STATUS_PATH_REGEX = /^\/i\/(?:web\/)?status\/(\d{1,25})(?:\/|$|\?)/;

export interface TweetDomIdentity {
  tweetId: string;
  screenName?: string;
  /** 引用一覧ページのパス（例: /username/status/1234567890/quotes） */
  quotesPath: string;
  /** リポスト（リツイート）一覧ページのパス（例: /username/status/1234567890/retweets） */
  retweetsPath: string;
}

/**
 * 入れ子になった <article data-testid="tweet"> かどうか判定する。
 * 原則として最上位の投稿 <article> のみを処理対象とする（spec.md 2.5.2）。
 */
export function isNestedTweetArticle(article: HTMLElement): boolean {
  return Boolean(article.parentElement?.closest(X_SELECTORS.tweetArticle));
}

/**
 * 指定要素が、親ツイート内に埋め込まれた「引用ツイート枠」または「リンクカード」の内部にあるか判定する。
 *
 * X の引用ツイートは <article> ではなく、2つ目の [data-testid="User-Name"] を内包する
 * div[role="link"] / div[tabindex="0"] / [data-testid="quoteTweet"] として描画される。
 * この境界判定により、引用先の <time> や引用先の画像を親投稿のものと誤認するバグを防ぐ。
 */
export function isInsideEmbeddedQuoteOrCard(element: Element, article: HTMLElement): boolean {
  const cardAncestor = element.closest(
    `${X_SELECTORS.cardWrapper}, ${X_SELECTORS.quoteTweetContainer}`,
  );
  if (cardAncestor && article.contains(cardAncestor)) {
    return true;
  }

  const primaryUserName = article.querySelector(X_SELECTORS.userNameBlock);
  if (!primaryUserName) {
    return false;
  }

  let cursor: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement;
  while (cursor && cursor !== article) {
    const isInteractiveQuoteBox =
      cursor.tagName === "DIV" &&
      (cursor.getAttribute("role") === "link" || cursor.hasAttribute("tabindex"));

    if (isInteractiveQuoteBox && !cursor.contains(primaryUserName)) {
      const innerUserName = cursor.querySelector(X_SELECTORS.userNameBlock);
      if (innerUserName && innerUserName !== primaryUserName) {
        return true;
      }
    }
    cursor = cursor.parentElement;
  }

  return false;
}

function parseStatusPathname(pathname: string): { screenName?: string; tweetId: string } | null {
  const userMatch = STATUS_PATH_REGEX.exec(pathname);
  if (userMatch) {
    const screenName = userMatch[1];
    const tweetId = userMatch[2];
    if (tweetId && screenName && screenName.toLowerCase() !== "i") {
      return { screenName, tweetId };
    }
    if (tweetId) {
      return { tweetId };
    }
  }

  const webMatch = GENERIC_WEB_STATUS_PATH_REGEX.exec(pathname);
  if (webMatch?.[1]) {
    return { tweetId: webMatch[1] };
  }

  return null;
}

function toTweetDomIdentity(parsed: { screenName?: string; tweetId: string }): TweetDomIdentity {
  const quotesPath = parsed.screenName
    ? `/${parsed.screenName}/status/${parsed.tweetId}/quotes`
    : `/i/status/${parsed.tweetId}/quotes`;
  const retweetsPath = parsed.screenName
    ? `/${parsed.screenName}/status/${parsed.tweetId}/retweets`
    : `/i/status/${parsed.tweetId}/retweets`;
  return {
    tweetId: parsed.tweetId,
    screenName: parsed.screenName,
    quotesPath,
    retweetsPath,
  };
}

/**
 * 親ツイート自身の正規パーマリンクから tweetId と screenName を抽出する（spec.md 2.5.2）。
 *
 * - タイムライン通常投稿・リポスト表示・ツイート詳細画面（Focal Tweet）のすべてに対応する。
 * - 引用ツイート内の <time> リンクは除外する。
 * - 広告投稿などで投稿IDを取得できない場合は null を返す。
 */
export function extractOuterTweetIdentity(article: HTMLElement): TweetDomIdentity | null {
  if (isNestedTweetArticle(article)) {
    return null;
  }

  const anchors = article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]');
  let fallbackWithoutHandle: { tweetId: string } | null = null;

  // 第1優先: 引用枠外にあり、<time> 要素を含む正規投稿パーマリンク
  for (const anchor of anchors) {
    if (!anchor.querySelector("time")) continue;
    if (isInsideEmbeddedQuoteOrCard(anchor, article)) continue;

    try {
      const url = new URL(anchor.getAttribute("href") ?? "", window.location.origin);
      const parsed = parseStatusPathname(url.pathname);
      if (!parsed) continue;
      if (parsed.screenName) {
        return toTweetDomIdentity(parsed);
      }
      fallbackWithoutHandle ??= parsed;
    } catch {
      continue;
    }
  }

  if (fallbackWithoutHandle) {
    return toTweetDomIdentity(fallbackWithoutHandle);
  }

  // 第2優先: 引用枠外のアクションバー内アナリティクスリンク (/{user}/status/{id}/analytics)
  for (const anchor of anchors) {
    const rawHref = anchor.getAttribute("href") ?? "";
    if (!rawHref.includes("/analytics")) continue;
    if (isInsideEmbeddedQuoteOrCard(anchor, article)) continue;

    try {
      const url = new URL(rawHref, window.location.origin);
      const parsed = parseStatusPathname(url.pathname);
      if (parsed) {
        return toTweetDomIdentity(parsed);
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * 親ツイートのアクションバー（返信・リポスト・いいね等の並び）を取得する。
 * ポール（投票）やメディアUIの role="group" と区別するため、標準アクション要素の存在を確認する。
 */
export function findOuterActionBar(article: HTMLElement): HTMLElement | null {
  const groups = article.querySelectorAll<HTMLElement>(X_SELECTORS.actionBarGroup);
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i]!;
    if (isInsideEmbeddedQuoteOrCard(group, article)) {
      continue;
    }
    if (group.querySelector(X_SELECTORS.standardTweetAction)) {
      return group;
    }
  }
  return null;
}

/**
 * 指定要素が、リンクカード（Webサイト記事プレビュー・OGP等）の内部にあるか判定する。
 */
export function isInsideLinkCard(element: Element, article: HTMLElement): boolean {
  const cardAncestor = element.closest(X_SELECTORS.cardWrapper);
  return Boolean(cardAncestor && article.contains(cardAncestor));
}

/**
 * API キャッシュ未到着時の補助判定として、投稿自身またはリポスト・引用ツイートに画像・動画 DOM が存在するかを調べる。
 * リンクカード（card.wrapper）のサムネイルは除外し、投稿メディアや引用ツイートのメディアを検出する。
 */
export function hasOuterDomMedia(article: HTMLElement): boolean {
  const candidates = article.querySelectorAll(X_SELECTORS.outerMediaCandidate);
  for (const el of candidates) {
    if (!isInsideLinkCard(el, article)) {
      return true;
    }
  }
  return false;
}
