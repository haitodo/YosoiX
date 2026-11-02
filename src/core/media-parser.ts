import { resolveImageExtension, type SafeMediaExtension } from "./filename";
import type { TweetMediaCacheEntry, TweetMediaItem, VideoVariant } from "./types";
import { isAllowedMediaUrl, isPlainObject, isValidTweetId } from "./validators";

/**
 * X GraphQL / API レスポンスからのメディア・引用件数パーサー（spec.md 2.6.2〜2.6.4, 4.4）
 *
 * 設計上の重要な不変条件:
 * 1. エンドポイント判定と JSON 構造走査を完全に分離する（本モジュールは純粋関数のみ）。
 * 2. TweetWithVisibilityResults ラッパーの透過展開に対応する。
 * 3. X の 2024-2026 スキーマ移行（core.user_results.result.core.screen_name）と旧 legacy の両方に対応する。
 * 4. 引用ツイート（quoted_status_result）およびリポスト（retweeted_status_result）のメディアを親投稿のDL対象に統合しつつ、
 *    引用先・元ツイート単体としても独立した tweetId エントリとして抽出する。
 * 5. リンクカード（card）内のサムネイルは対象にしない（extended_entities / entities のみ参照）。
 * 6. 巨大レスポンスや循環参照でメインスレッドを止めないよう、反復スタック＋訪問上限を設ける。
 */

const MAX_VISITED_OBJECTS = 35_000;

export interface ResolvedImageMedia {
  url: string;
  extension: SafeMediaExtension;
}

/**
 * pbs.twimg.com の画像 URL を原寸（name=orig）へ変換し、フォーマットを維持する（spec.md 2.6.3）。
 */
export function toOriginalImageUrl(rawUrl: string): ResolvedImageMedia | null {
  if (!isAllowedMediaUrl(rawUrl)) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    const extension = resolveImageExtension(rawUrl);

    if (url.hostname.toLowerCase() === "pbs.twimg.com") {
      // 旧形式 /media/XXXX.jpg:large などのコロンサフィックスを除去
      url.pathname = url.pathname.replace(/:[a-zA-Z0-9_]+$/, "");

      // パスに拡張子がなく format クエリもない場合は拡張子を補完
      const hasPathExtension = /\.(jpg|jpeg|png|webp|gif)$/i.test(url.pathname);
      if (!hasPathExtension && !url.searchParams.has("format")) {
        url.searchParams.set("format", extension);
      }

      url.searchParams.set("name", "orig");
    }

    return {
      url: url.toString(),
      extension,
    };
  } catch {
    return null;
  }
}

export type VideoVariantSelection =
  | { ok: true; url: string; bitrate?: number }
  | { ok: false; reason: "HLS_ONLY" | "NO_VALID_MP4" };

/**
 * 動画・GIF の variants から最高ビットレートの video/mp4 を選択する（spec.md 2.6.4）。
 * HLS（.m3u8）しか存在しない場合は明示的に HLS_ONLY を返し、呼び出し側で未対応案内を出す。
 */
export function selectBestMp4Variant(
  variants: readonly VideoVariant[] | undefined,
): VideoVariantSelection {
  if (!variants || variants.length === 0) {
    return { ok: false, reason: "NO_VALID_MP4" };
  }

  const mp4Candidates: VideoVariant[] = [];
  let hasHlsVariant = false;

  for (const v of variants) {
    if (!isAllowedMediaUrl(v.url)) continue;
    const normalizedType = v.contentType.toLowerCase().split(";")[0]?.trim() ?? "";

    if (normalizedType === "video/mp4") {
      mp4Candidates.push(v);
    } else if (
      normalizedType === "application/x-mpegurl" ||
      normalizedType === "application/vnd.apple.mpegurl" ||
      v.url.includes(".m3u8")
    ) {
      hasHlsVariant = true;
    }
  }

  if (mp4Candidates.length === 0) {
    return { ok: false, reason: hasHlsVariant ? "HLS_ONLY" : "NO_VALID_MP4" };
  }

  // GIF 等で bitrate が 0 / undefined の候補も許容しつつ、最大ビットレートを優先する
  mp4Candidates.sort((a, b) => (b.bitrate ?? -1) - (a.bitrate ?? -1));
  const best = mp4Candidates[0]!;
  return {
    ok: true,
    url: best.url,
    bitrate: best.bitrate,
  };
}

/**
 * Tweet オブジェクトの user_results から screen_name を新旧スキーマ横断で取得する。
 */
function extractScreenName(tweetObj: Record<string, unknown>): string {
  const core = isPlainObject(tweetObj.core) ? tweetObj.core : null;
  const userResults = core && isPlainObject(core.user_results) ? core.user_results : null;
  let result = userResults && isPlainObject(userResults.result) ? userResults.result : null;

  // UserWithVisibilityResults ラッパーの透過展開
  if (result && result.__typename === "UserWithVisibilityResults" && isPlainObject(result.user)) {
    result = result.user;
  }

  if (result) {
    // 2024-2026 新スキーマ: result.core.screen_name
    if (isPlainObject(result.core) && typeof result.core.screen_name === "string" && result.core.screen_name) {
      return result.core.screen_name;
    }
    // 従来スキーマ: result.legacy.screen_name
    if (
      isPlainObject(result.legacy) &&
      typeof result.legacy.screen_name === "string" &&
      result.legacy.screen_name
    ) {
      return result.legacy.screen_name;
    }
  }

  return "x_user";
}

/**
 * メディアオブジェクトが削除済み・DMCA・非公開で利用不能になっていないか確認する（spec.md 4.4）。
 */
function isMediaEntityAvailable(mediaEntity: Record<string, unknown>): boolean {
  if (isPlainObject(mediaEntity.ext_media_availability)) {
    const status = mediaEntity.ext_media_availability.status;
    if (typeof status === "string" && status.toLowerCase() !== "available") {
      return false;
    }
  }
  if (isPlainObject(mediaEntity.media_availability)) {
    const status = mediaEntity.media_availability.status;
    if (typeof status === "string" && status.toLowerCase() !== "available") {
      return false;
    }
  }
  return true;
}

/**
 * 単一の生メディアエンティティを TweetMediaItem へ変換する。
 */
function parseRawMediaEntity(
  rawMedia: Record<string, unknown>,
  tweetId: string,
  screenName: string,
  createdAt: string | undefined,
  mediaIndex: number,
): TweetMediaItem | null {
  if (!isMediaEntityAvailable(rawMedia)) {
    return null;
  }

  const rawType = typeof rawMedia.type === "string" ? rawMedia.type : "";

  if (rawType === "photo") {
    const rawUrl =
      typeof rawMedia.media_url_https === "string"
        ? rawMedia.media_url_https
        : typeof rawMedia.media_url === "string"
          ? rawMedia.media_url
          : "";
    if (!isAllowedMediaUrl(rawUrl)) {
      return null;
    }
    return {
      tweetId,
      screenName,
      createdAt,
      mediaIndex,
      type: "image",
      originalUrl: rawUrl,
    };
  }

  if (rawType === "video" || rawType === "animated_gif") {
    const videoInfo = isPlainObject(rawMedia.video_info) ? rawMedia.video_info : null;
    const rawVariants = videoInfo && Array.isArray(videoInfo.variants) ? videoInfo.variants : null;
    if (!rawVariants || rawVariants.length === 0) {
      return null;
    }

    const variants: VideoVariant[] = [];
    for (const v of rawVariants) {
      if (!isPlainObject(v)) continue;
      if (!isAllowedMediaUrl(v.url)) continue;
      const contentType =
        typeof v.content_type === "string"
          ? v.content_type
          : typeof v.contentType === "string"
            ? v.contentType
            : "";
      if (!contentType) continue;

      const variant: VideoVariant = {
        url: v.url,
        contentType,
      };
      if (typeof v.bitrate === "number" && Number.isFinite(v.bitrate) && v.bitrate >= 0) {
        variant.bitrate = Math.floor(v.bitrate);
      }
      variants.push(variant);
    }

    if (variants.length === 0) {
      return null;
    }

    return {
      tweetId,
      screenName,
      createdAt,
      mediaIndex,
      type: "video",
      variants,
    };
  }

  return null;
}

/**
 * TweetWithVisibilityResults や { result: ... } を透過的にアンラップする。
 */
function unwrapTweetNode(node: unknown): Record<string, unknown> | null {
  if (!isPlainObject(node)) return null;
  const typename = node.__typename;
  if (typename === "TweetTombstone" || typename === "TweetUnavailable") {
    return null;
  }
  if (typename === "TweetWithVisibilityResults" && isPlainObject(node.tweet)) {
    return unwrapTweetNode(node.tweet);
  }
  if (isPlainObject(node.result)) {
    return unwrapTweetNode(node.result);
  }
  return node;
}

/**
 * legacy オブジェクトからメディアアイテム一覧を抽出する。
 */
function extractRawMediaFromLegacy(
  legacy: Record<string, unknown>,
  tweetId: string,
  screenName: string,
  startIndex: number = 1,
): TweetMediaItem[] {
  const createdAt = typeof legacy.created_at === "string" ? legacy.created_at : undefined;
  const extendedEntities = isPlainObject(legacy.extended_entities) ? legacy.extended_entities : null;
  const fallbackEntities = isPlainObject(legacy.entities) ? legacy.entities : null;

  const rawMediaList = Array.isArray(extendedEntities?.media)
    ? extendedEntities.media
    : Array.isArray(fallbackEntities?.media)
      ? fallbackEntities.media
      : [];

  const media: TweetMediaItem[] = [];
  let nextIndex = startIndex;
  for (const rawItem of rawMediaList) {
    if (!isPlainObject(rawItem)) continue;

    const parsed = parseRawMediaEntity(rawItem, tweetId, screenName, createdAt, nextIndex);
    if (parsed) {
      media.push(parsed);
      nextIndex += 1;
    }
  }

  return media;
}

/**
 * 単一の Tweet ノード（TweetWithVisibilityResults 展開後）から
 * 自身および内包するリポスト・引用ツイートのメタデータとメディアを抽出する。
 */
function extractTweetEntries(
  candidateTweet: Record<string, unknown>,
  now: number,
  includeMedia: boolean,
): TweetMediaCacheEntry[] {
  const restId = candidateTweet.rest_id;
  if (!isValidTweetId(restId)) {
    return [];
  }

  const legacy = isPlainObject(candidateTweet.legacy) ? candidateTweet.legacy : null;
  if (!legacy) {
    return [];
  }

  const results: TweetMediaCacheEntry[] = [];
  const screenName = extractScreenName(candidateTweet);
  const quoteCount =
    typeof legacy.quote_count === "number" && Number.isFinite(legacy.quote_count) && legacy.quote_count >= 0
      ? Math.floor(legacy.quote_count)
      : undefined;
  const retweetCount =
    typeof legacy.retweet_count === "number" && Number.isFinite(legacy.retweet_count) && legacy.retweet_count >= 0
      ? Math.floor(legacy.retweet_count)
      : undefined;

  // 1. 純粋なリポスト（Native Retweet）の判定
  let rawRetweeted = candidateTweet.retweeted_status_result ?? legacy.retweeted_status_result;
  let retweetedNode = unwrapTweetNode(rawRetweeted);
  if (!retweetedNode || !isValidTweetId(retweetedNode.rest_id)) {
    rawRetweeted = legacy.retweeted_status_result ?? candidateTweet.retweeted_status_result;
    retweetedNode = unwrapTweetNode(rawRetweeted);
  }

  if (retweetedNode && isValidTweetId(retweetedNode.rest_id) && isPlainObject(retweetedNode.legacy)) {
    const origId = retweetedNode.rest_id;
    const origScreenName = extractScreenName(retweetedNode);
    const origLegacy = retweetedNode.legacy as Record<string, unknown>;
    const origQuoteCount =
      typeof origLegacy.quote_count === "number" && Number.isFinite(origLegacy.quote_count) && origLegacy.quote_count >= 0
        ? Math.floor(origLegacy.quote_count)
        : quoteCount;
    const origRetweetCount =
      typeof origLegacy.retweet_count === "number" && Number.isFinite(origLegacy.retweet_count) && origLegacy.retweet_count >= 0
        ? Math.floor(origLegacy.retweet_count)
        : retweetCount;

    // 元ツイート自身のメディア
    let origMedia = includeMedia ? extractRawMediaFromLegacy(origLegacy, origId, origScreenName, 1) : [];

    // 元ツイート自身がさらに引用ツイートを持っている場合もケア
    const origQuotedNode = unwrapTweetNode(
      retweetedNode.quoted_status_result ?? origLegacy.quoted_status_result
    );
    if (includeMedia && origQuotedNode && isValidTweetId(origQuotedNode.rest_id) && isPlainObject(origQuotedNode.legacy)) {
      const qId = origQuotedNode.rest_id;
      const qScreenName = extractScreenName(origQuotedNode);
      const qMedia = extractRawMediaFromLegacy(
        origQuotedNode.legacy as Record<string, unknown>,
        qId,
        qScreenName,
        origMedia.length + 1,
      );
      if (qMedia.length > 0) {
        origMedia = [...origMedia, ...qMedia];
      }
    }

    // 元ツイートのエントリ（元ツイートID）
    const origEntry: TweetMediaCacheEntry = {
      tweetId: origId,
      screenName: origScreenName,
      quoteCount: origQuoteCount,
      retweetCount: origRetweetCount,
      media: origMedia,
      capturedAt: now,
    };
    results.push(origEntry);

    // リポストラッパー投稿のエントリ（DOM がラッパーIDを見ていても元ツイートIDを見ていてもどちらでもヒットするようにする）
    const wrapperEntry: TweetMediaCacheEntry = {
      tweetId: restId,
      screenName: origScreenName,
      quoteCount: origQuoteCount,
      retweetCount: origRetweetCount,
      media: origMedia,
      capturedAt: now,
    };
    results.push(wrapperEntry);

    return results;
  }

  // 2. 通常ツイートまたは引用ツイート（Quote Tweet）
  let media = includeMedia ? extractRawMediaFromLegacy(legacy, restId, screenName, 1) : [];

  // 引用ツイート（quoted_status_result）の確認
  let rawQuoted = candidateTweet.quoted_status_result ?? legacy.quoted_status_result;
  let quotedNode = unwrapTweetNode(rawQuoted);
  if (!quotedNode || !isValidTweetId(quotedNode.rest_id)) {
    rawQuoted = legacy.quoted_status_result ?? candidateTweet.quoted_status_result;
    quotedNode = unwrapTweetNode(rawQuoted);
  }

  if (quotedNode && isValidTweetId(quotedNode.rest_id) && isPlainObject(quotedNode.legacy)) {
    const quotedId = quotedNode.rest_id;
    const quotedScreenName = extractScreenName(quotedNode);
    const quotedLegacy = quotedNode.legacy as Record<string, unknown>;

    // 引用先自身のメディア
    const quotedMedia = includeMedia ? extractRawMediaFromLegacy(quotedLegacy, quotedId, quotedScreenName, 1) : [];

    // 引用先自身のエントリも独立して登録
    const quotedEntry: TweetMediaCacheEntry = {
      tweetId: quotedId,
      screenName: quotedScreenName,
      quoteCount:
        typeof quotedLegacy.quote_count === "number" && Number.isFinite(quotedLegacy.quote_count) && quotedLegacy.quote_count >= 0
          ? Math.floor(quotedLegacy.quote_count)
          : undefined,
      retweetCount:
        typeof quotedLegacy.retweet_count === "number" && Number.isFinite(quotedLegacy.retweet_count) && quotedLegacy.retweet_count >= 0
          ? Math.floor(quotedLegacy.retweet_count)
          : undefined,
      media: quotedMedia,
      capturedAt: now,
    };
    results.push(quotedEntry);

    // 親ツイートのメディアリストにも引用先メディアを統合（リポスト/引用されたツイートのメディアもDL可能に）
    if (quotedMedia.length > 0) {
      const reindexedQuotedMedia = extractRawMediaFromLegacy(
        quotedLegacy,
        quotedId,
        quotedScreenName,
        media.length + 1,
      );
      media = [...media, ...reindexedQuotedMedia];
    }
  }

  const selfEntry: TweetMediaCacheEntry = {
    tweetId: restId,
    screenName,
    quoteCount,
    retweetCount,
    media,
    capturedAt: now,
  };
  results.push(selfEntry);

  return results;
}

/**
 * X API の JSON ペイロード全体を反復走査し、投稿ごとの最小キャッシュエントリ配列を抽出する。
 */
export function parseApiResponseForTweets(
  rootPayload: unknown,
  now: number = Date.now(),
  includeMedia = true,
): TweetMediaCacheEntry[] {
  if (!isPlainObject(rootPayload) && !Array.isArray(rootPayload)) {
    return [];
  }

  const entriesById = new Map<string, TweetMediaCacheEntry>();
  const visited = new WeakSet<object>();
  const stack: unknown[] = [rootPayload];
  let visitedCount = 0;

  while (stack.length > 0 && visitedCount < MAX_VISITED_OBJECTS) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null) {
      continue;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    visitedCount += 1;

    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i -= 1) {
        stack.push(current[i]);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    const typename = record.__typename;

    // Tombstone / Unavailable はスキップ
    if (typename === "TweetTombstone" || typename === "TweetUnavailable") {
      continue;
    }

    // TweetWithVisibilityResults は内側の .tweet に本体が入っている
    const candidateTweet =
      typename === "TweetWithVisibilityResults" && isPlainObject(record.tweet)
        ? record.tweet
        : record;

    if (isValidTweetId(candidateTweet.rest_id) && isPlainObject(candidateTweet.legacy)) {
      const extractedList = extractTweetEntries(candidateTweet, now, includeMedia);
      for (const extracted of extractedList) {
        const existing = entriesById.get(extracted.tweetId);
        if (!existing) {
          entriesById.set(extracted.tweetId, extracted);
        } else {
          // 同一レスポンス内で部分オブジェクトと完全オブジェクトが両方出現した場合は情報を統合
          entriesById.set(extracted.tweetId, {
            tweetId: extracted.tweetId,
            screenName:
              extracted.screenName && extracted.screenName !== "x_user"
                ? extracted.screenName
                : existing.screenName,
            quoteCount: extracted.quoteCount ?? existing.quoteCount,
            retweetCount: extracted.retweetCount ?? existing.retweetCount,
            media: extracted.media.length > 0 ? extracted.media : existing.media,
            capturedAt: now,
          });
        }
      }
    }

    // 子プロパティを走査（quoted_status_result や retweeted_status_result も個別の Tweet として訪問される）
    const values = Object.values(record);
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const val = values[i];
      if (!includeMedia && (val === record.entities || val === record.extended_entities || val === record.card)) continue;
      if (typeof val === "object" && val !== null) {
        stack.push(val);
      }
    }
  }

  return Array.from(entriesById.values());
}
