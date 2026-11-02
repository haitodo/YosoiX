import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/core/media-cache";

describe("MediaCache の期限と参照順序", () => {
  it("LRUで参照順序が変わっても、期限切れの未参照データを一括削除する", () => {
    let time = 0;
    const cache = new MediaCache({ now: () => time, ttlMs: 100, maxEntries: 3 });
    cache.upsert({ tweetId: "1", media: [], capturedAt: 0 });
    time = 50;
    cache.upsert({ tweetId: "2", media: [], capturedAt: 0 });
    cache.get("1");
    time = 120;
    cache.upsert({ tweetId: "3", media: [], capturedAt: 0 });
    expect(cache.size).toBe(2);
    expect(cache.get("1")).toBeUndefined();
    expect(cache.get("2")).toBeDefined();
  });

  it("期限切れURLを部分更新で復活させず、上限とclear後の再利用を守る", () => {
    let time = 0;
    const cache = new MediaCache({ now: () => time, ttlMs: 100, maxEntries: 2 });
    cache.upsert({ tweetId: "1", media: [{ tweetId: "1", screenName: "alice", mediaIndex: 1, type: "image", originalUrl: "https://pbs.twimg.com/media/old.jpg" }], capturedAt: 0 });
    time = 101;
    cache.upsert({ tweetId: "1", quoteCount: 2, media: [], capturedAt: 0 });
    expect(cache.get("1")?.media).toEqual([]);
    cache.upsertMany(["2", "3"].map((tweetId) => ({ tweetId, media: [], capturedAt: 0 })));
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    cache.upsert({ tweetId: "4", media: [], capturedAt: 0 });
    expect(cache.get("4")).toBeDefined();
  });
});
