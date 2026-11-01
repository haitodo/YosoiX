/**
 * ユーザープロフィール URL 解析・/all 誘導モジュール
 *
 * X の仕様変更により、ユーザープロフィール初期画面 (/{username}) では
 * リポスト（RT）が表示されず通常投稿のみになったため、
 * リポストを含む全ツイートが表示される /{username}/all への遷移を支援する。
 */

export const RESERVED_PROFILE_PATHS: ReadonlySet<string> = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "settings",
  "search",
  "jobs",
  "logout",
  "login",
  "signup",
  "account",
  "compose",
  "i",
  "intent",
  "share",
  "tos",
  "privacy",
  "about",
  "help",
  "creators",
  "communities",
  "download",
  "hashtag",
  "x",
  "twitter",
]);

/** 1〜25文字の英数字およびアンダースコアの単一階層パス */
const USER_PROFILE_PATH_REGEX = /^\/([A-Za-z0-9_]{1,25})\/?$/;

/**
 * 与えられた pathname がユーザープロフィールのルート（例: /elonmusk）であるかを判定し、
 * 該当する場合は screenName を返す。予約語やサブパス付き（/elonmusk/media等）は null を返す。
 */
export function extractUsernameFromProfilePath(pathname: string): string | null {
  if (!pathname || pathname === "/") return null;
  const cleanPath = pathname.split("?")[0]?.split("#")[0] ?? "";
  const match = USER_PROFILE_PATH_REGEX.exec(cleanPath);
  if (!match) return null;

  const username = match[1];
  if (!username) return null;

  if (RESERVED_PROFILE_PATHS.has(username.toLowerCase())) {
    return null;
  }

  return username;
}

/**
 * リンクの href（相対または絶対URL）がユーザープロフィールのルートであるかを判定し、
 * /{username}/all のパス文字列を返す。対象外の場合は null を返す。
 */
export function toUserProfileAllPath(rawHref: string): string | null {
  if (!rawHref) return null;

  try {
    const parsed = new URL(rawHref, "https://x.com");
    const host = parsed.hostname.toLowerCase();
    const isXHost =
      host === "x.com" ||
      host === "www.x.com" ||
      host === "twitter.com" ||
      host === "www.twitter.com";

    if (!isXHost) return null;

    const username = extractUsernameFromProfilePath(parsed.pathname);
    if (!username) return null;

    // クエリパラメータやハッシュがあれば引き継ぐ
    const searchAndHash = `${parsed.search}${parsed.hash}`;
    return `/${username}/all${searchAndHash}`;
  } catch {
    return null;
  }
}
