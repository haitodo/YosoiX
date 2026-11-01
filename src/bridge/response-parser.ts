import { parseApiResponseForTweets } from "../core/media-parser";
import type { TweetMediaCacheEntry } from "../core/types";

/**
 * Page Bridge 用 API エンドポイント判定・レスポンス抽出アダプター（spec.md 2.6.2, 4.2, 5.1）
 *
 * 無関係な通信（テレメトリー・画像・設定・DMタイピング等）を解析しないよう、
 * URL パターンで事前フィルタリングしてから最小メタデータへ変換する。
 */

const MAX_RESPONSE_TEXT_CHARS = 15 * 1024 * 1024; // 15MB 上限ガード

const ALLOWED_API_HOSTS: ReadonlySet<string> = new Set([
  "x.com",
  "www.x.com",
  "api.x.com",
  "twitter.com",
  "www.twitter.com",
  "api.twitter.com",
]);

const KNOWN_TWEET_OPERATIONS: ReadonlySet<string> = new Set([
  "TweetDetail",
  "TweetResultByRestId",
  "TweetResultsByRestIds",
  "HomeTimeline",
  "HomeLatestTimeline",
  "UserTweets",
  "UserTweetsAndReplies",
  "UserHighlightsTweets",
  "UserMedia",
  "Likes",
  "Bookmarks",
  "BookmarkFolderTimeline",
  "SearchTimeline",
  "ListLatestTweetsTimeline",
  "CommunityTweetsTimeline",
  "CommunitiesMainPageTimeline",
  "Quotes",
]);

const IGNORED_OPERATIONS: ReadonlySet<string> = new Set([
  "DataSaverMode",
  "Viewer",
  "BadgeCount",
  "useStoryTopicQuery",
  "SidebarUserRecommendations",
  "ConnectTabTimeline",
  "ExploreSidebar",
  "ExplorePage",
  "GenericTimelineById",
]);

/** X 側の軽微な Operation 名変更に備えるヒューリスティック（spec.md 2.6.2, 8） */
const TWEET_OPERATION_HEURISTIC = /(?:Tweet|Timeline|UserMedia|Bookmarks|Likes|Quotes)/i;

const GRAPHQL_PATH_REGEX = /^\/(?:i\/api\/)?graphql\/[^/]+\/([A-Za-z0-9_]+)$/;
const REST_TIMELINE_PATH_REGEX =
  /^\/i\/api\/(?:1\.1|2)\/(?:timeline|statuses|search|favorites|bookmarks)\//;

/**
 * 通信 URL がツイート情報を含む対象 API エンドポイントか判定する。
 */
export function isTargetApiUrl(rawUrl: string, baseOrigin: string = "https://x.com"): boolean {
  if (!rawUrl) return false;

  try {
    const parsed = new URL(rawUrl, baseOrigin);
    if (parsed.protocol !== "https:") return false;
    if (!ALLOWED_API_HOSTS.has(parsed.hostname.toLowerCase())) return false;

    const gqlMatch = GRAPHQL_PATH_REGEX.exec(parsed.pathname);
    if (gqlMatch) {
      const operationName = gqlMatch[1];
      if (!operationName || IGNORED_OPERATIONS.has(operationName)) {
        return false;
      }
      return (
        KNOWN_TWEET_OPERATIONS.has(operationName) ||
        TWEET_OPERATION_HEURISTIC.test(operationName)
      );
    }

    return REST_TIMELINE_PATH_REGEX.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * テキストまたはパース済み JSON からキャッシュ用エントリを安全に抽出する。
 * 例外はすべて内部で握り潰し、ページ側の通信処理を一切妨害しない。
 */
export function extractEntriesFromResponseText(rawText: string): TweetMediaCacheEntry[] {
  if (!rawText || rawText.length > MAX_RESPONSE_TEXT_CHARS) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(rawText);
    return parseApiResponseForTweets(parsed);
  } catch {
    return [];
  }
}

export function extractEntriesFromResponseJson(parsedJson: unknown): TweetMediaCacheEntry[] {
  try {
    return parseApiResponseForTweets(parsedJson);
  } catch {
    return [];
  }
}
