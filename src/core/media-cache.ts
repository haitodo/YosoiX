import type { TweetMediaCacheEntry } from "./types";

/**
 * 投稿メディア情報・引用件数のインメモリ一時キャッシュ（spec.md 4.5）
 *
 * - 生レスポンスや投稿本文は保持しない。
 * - デフォルト TTL: 30分、最大保持件数: 500投稿。
 * - Map の挿入順序を利用した O(1) LRU + TTL 期限切れ削除を行う。
 * - 署名付き URL の期限切れを防ぐため、新しいレスポンス到着時は最新 URL を優先して上書きする（spec.md 8）。
 */

export const DEFAULT_MEDIA_CACHE_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MEDIA_CACHE_MAX_ENTRIES = 500;

export interface MediaCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class MediaCache {
  private readonly store = new Map<string, TweetMediaCacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: MediaCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_MEDIA_CACHE_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MEDIA_CACHE_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.store.size;
  }

  /**
   * 指定した tweetId の有効期限内エントリを取得する。
   * TTL を超過していた場合は即座に破棄して undefined を返す。
   */
  get(tweetId: string): TweetMediaCacheEntry | undefined {
    const entry = this.store.get(tweetId);
    if (!entry) {
      return undefined;
    }

    const currentTime = this.now();
    if (currentTime - entry.capturedAt > this.ttlMs) {
      this.store.delete(tweetId);
      return undefined;
    }

    // LRU 更新: 参照されたエントリを末尾（最新）へ移動
    this.store.delete(tweetId);
    this.store.set(tweetId, entry);
    return entry;
  }

  /**
   * 単一エントリを登録または最新情報でマージ更新する。
   */
  upsert(incoming: TweetMediaCacheEntry): void {
    const currentTime = this.now();
    const existing = this.store.get(incoming.tweetId);

    const merged: TweetMediaCacheEntry = existing
      ? {
          tweetId: incoming.tweetId,
          screenName:
            incoming.screenName && incoming.screenName !== "x_user"
              ? incoming.screenName
              : existing.screenName,
          quoteCount: incoming.quoteCount ?? existing.quoteCount,
          retweetCount: incoming.retweetCount ?? existing.retweetCount,
          // 新しいレスポンスにメディアが含まれていれば署名付きURLを優先更新
          media: incoming.media.length > 0 ? incoming.media : existing.media,
          capturedAt: currentTime,
        }
      : {
          ...incoming,
          capturedAt: currentTime,
        };

    if (existing) {
      this.store.delete(incoming.tweetId);
    }
    this.store.set(incoming.tweetId, merged);

    this.evictIfNeeded(currentTime);
  }

  /**
   * 複数エントリを一括登録し、更新された tweetId の配列を返す。
   */
  upsertMany(entries: readonly TweetMediaCacheEntry[]): string[] {
    if (entries.length === 0) return [];
    const updatedIds: string[] = [];
    for (const entry of entries) {
      this.upsert(entry);
      updatedIds.push(entry.tweetId);
    }
    return updatedIds;
  }

  clear(): void {
    this.store.clear();
  }

  private evictIfNeeded(currentTime: number): void {
    // 1. 先頭（古い順）から TTL 超過エントリを除去
    for (const [key, entry] of this.store) {
      if (currentTime - entry.capturedAt > this.ttlMs) {
        this.store.delete(key);
      } else {
        // capturedAt は単調増加で挿入されるため、最初の有効エントリに達したら打ち切り可能
        break;
      }
    }

    // 2. 最大件数超過時は最も古いエントリから削除
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }
}
