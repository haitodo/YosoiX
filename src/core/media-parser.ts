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
 * 4. 引用ツイート（quoted_status_result）のメディアを親ツイートのメディアに混入させない。
 *    （引用先ツイートは独立した自身の tweetId エントリとしてのみ抽出する）
 * 5. リポスト（retweeted_status_result）はラッパー側ではなく元ツイート側の rest_id / 作者名で抽出する。
 * 6. リンクカード（card）内のサムネイルは対象にしない（extended_entities / entities のみ参照）。
 * 7. 巨大レスポンスや循環参照でメインスレッドを止めないよう、反復スタック＋訪問上限を設ける。
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
 * 単一の Tweet ノード（TweetWithVisibilityResults 展開後）自身のメタデータのみを抽出する。
 * 引用ツイート（quoted_status_result）のメディアはここには含めない。
 */
function extractSingleTweetEntry(
  tweetNode: Record<string, unknown>,
  now: number,
): TweetMediaCacheEntry | null {
  const restId = tweetNode.rest_id;
  if (!isValidTweetId(restId)) {
    return null;
  }

  const legacy = isPlainObject(tweetNode.legacy) ? tweetNode.legacy : null;
  if (!legacy) {
    return null;
  }

  // 純粋なリポスト（RT）ラッパーの場合は自身のコピーエンティティを登録せず、
  // 木構造走査で内側の retweeted_status_result.result（元ツイート）側を登録させる。
  if (isPlainObject(legacy.retweeted_status_result) || isPlainObject(tweetNode.retweeted_status_result)) {
    return null;
  }

  const screenName = extractScreenName(tweetNode);
  const createdAt = typeof legacy.created_at === "string" ? legacy.created_at : undefined;
  const quoteCount =
    typeof legacy.quote_count === "number" && Number.isFinite(legacy.quote_count) && legacy.quote_count >= 0
      ? Math.floor(legacy.quote_count)
      : undefined;

  // extended_entities.media を優先し、存在しない場合のみ entities.media を補助参照する（spec.md 4.4）
  const extendedEntities = isPlainObject(legacy.extended_entities) ? legacy.extended_entities : null;
  const fallbackEntities = isPlainObject(legacy.entities) ? legacy.entities : null;

  const rawMediaList = Array.isArray(extendedEntities?.media)
    ? extendedEntities.media
    : Array.isArray(fallbackEntities?.media)
      ? fallbackEntities.media
      : [];

  const media: TweetMediaItem[] = [];
  let nextIndex = 1;
  for (const rawItem of rawMediaList) {
    if (!isPlainObject(rawItem)) continue;

    // 別投稿から埋め込まれた共有メディア（source_status_id_str が別IDを指すケース）の除外ガード
    if (
      typeof rawItem.source_status_id_str === "string" &&
      rawItem.source_status_id_str !== "" &&
      rawItem.source_status_id_str !== restId
    ) {
      continue;
    }

    const parsed = parseRawMediaEntity(rawItem, restId, screenName, createdAt, nextIndex);
    if (parsed) {
      media.push(parsed);
      nextIndex += 1;
    }
  }

  return {
    tweetId: restId,
    screenName,
    quoteCount,
    media,
    capturedAt: now,
  };
}

/**
 * X API の JSON ペイロード全体を反復走査し、投稿ごとの最小キャッシュエントリ配列を抽出する。
 */
export function parseApiResponseForTweets(
  rootPayload: unknown,
  now: number = Date.now(),
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
      const extracted = extractSingleTweetEntry(candidateTweet, now);
      if (extracted) {
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
      if (typeof val === "object" && val !== null) {
        stack.push(val);
      }
    }
  }

  return Array.from(entriesById.values());
}
