import { describe, expect, it } from "vitest";
import { buildDownloadPlan } from "../src/core/download-manager";
import { MediaCache } from "../src/core/media-cache";
import {
  parseApiResponseForTweets,
  selectBestMp4Variant,
  toOriginalImageUrl,
} from "../src/core/media-parser";
import { BRIDGE_NAMESPACE } from "../src/core/types";
import {
  isSafeRelativeDownloadFilename,
  validateBridgeEnvelope,
} from "../src/core/validators";
import {
  extractOuterTweetIdentity,
  findOuterActionBar,
  hasOuterDomMedia,
} from "../src/content/tweet-dom";

/**
 * コア基盤の不変条件スモークテスト
 * （※個別モジュールの網羅的ユニットテストは DESIGN.md の手順に従い別AIが追加実装する）
 */
describe("Core architecture invariants", () => {
  it("引用先だけに画像がある投稿でも親投稿のDL対象にメディアを統合しつつ引用先単体も抽出する", () => {
    const mockGraphQlResponse = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  {
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            __typename: "TweetWithVisibilityResults",
                            tweet: {
                              rest_id: "2000000000000000002",
                              core: {
                                user_results: {
                                  result: {
                                    core: { screen_name: "outer_author" },
                                  },
                                },
                              },
                              legacy: {
                                quote_count: 14,
                                full_text: "引用コメントのみ",
                              },
                              quoted_status_result: {
                                result: {
                                  __typename: "Tweet",
                                  rest_id: "1000000000000000001",
                                  core: {
                                    user_results: {
                                      result: {
                                        legacy: { screen_name: "quoted_artist" },
                                      },
                                    },
                                  },
                                  legacy: {
                                    quote_count: 3,
                                    extended_entities: {
                                      media: [
                                        {
                                          type: "photo",
                                          media_url_https:
                                            "https://pbs.twimg.com/media/SampleImg01.png",
                                        },
                                      ],
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const entries = parseApiResponseForTweets(mockGraphQlResponse, 1_700_000_000_000);
    const byId = new Map(entries.map((e) => [e.tweetId, e]));

    const outer = byId.get("2000000000000000002");
    expect(outer).toBeDefined();
    expect(outer?.screenName).toBe("outer_author");
    expect(outer?.quoteCount).toBe(14);
    // リポスト・引用ツイートの画像もDL対象として統合される
    expect(outer?.media).toHaveLength(1);
    expect(outer?.media[0]?.originalUrl).toBe("https://pbs.twimg.com/media/SampleImg01.png");
    expect(outer?.media[0]?.screenName).toBe("quoted_artist");

    const quoted = byId.get("1000000000000000001");
    expect(quoted).toBeDefined();
    expect(quoted?.screenName).toBe("quoted_artist");
    expect(quoted?.media).toHaveLength(1);
  });

  it("原寸画像URL変換と最高ビットレートMP4選択・HLS判定が機能する", () => {
    const img = toOriginalImageUrl("https://pbs.twimg.com/media/Abc123XYZ?format=webp&name=small");
    expect(img).toEqual({
      url: "https://pbs.twimg.com/media/Abc123XYZ?format=webp&name=orig",
      extension: "webp",
    });

    const bestMp4 = selectBestMp4Variant([
      { url: "https://video.twimg.com/ext_tw_video/1/pu/pl/master.m3u8", contentType: "application/x-mpegURL" },
      { url: "https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/low.mp4", contentType: "video/mp4", bitrate: 832000 },
      { url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4", contentType: "video/mp4", bitrate: 2176000 },
    ]);
    expect(bestMp4).toEqual({
      ok: true,
      url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4",
      bitrate: 2176000,
    });

    const hlsOnly = selectBestMp4Variant([
      { url: "https://video.twimg.com/ext_tw_video/1/pu/pl/master.m3u8", contentType: "application/x-mpegURL" },
    ]);
    expect(hlsOnly).toEqual({ ok: false, reason: "HLS_ONLY" });
  });

  it("信頼境界バリデーターが不正ホスト・パストラバーサルを拒否する", () => {
    expect(isSafeRelativeDownloadFilename("XMedia/user_1234567890_01.jpg")).toBe(true);
    expect(isSafeRelativeDownloadFilename("../evil_1234567890_01.jpg")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia/CON_1234567890_01.jpg")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia/user_1234567890_01.exe")).toBe(false);

    const poisonedEnvelope = {
      [BRIDGE_NAMESPACE]: true,
      type: "MEDIA_CAPTURED",
      entries: [
        {
          tweetId: "1234567890",
          media: [
            {
              tweetId: "1234567890",
              screenName: "valid_user",
              mediaIndex: 1,
              type: "image",
              originalUrl: "https://evil.example.com/steal.jpg",
            },
          ],
          capturedAt: Date.now(),
        },
      ],
    };
    const validated = validateBridgeEnvelope(poisonedEnvelope);
    // 不正ホストのメディア項目はサニタイズ時に除去される
    expect(validated?.entries[0]?.media).toHaveLength(0);
  });

  it("DOM 解析で引用ツイート枠内の <time> を親投稿と誤認せず、リポスト/引用ツイートのメディアを検出する", () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <span>Outer User</span>
          <a href="/outer_user/status/999999999999999999"><time>1h</time></a>
        </div>
        <div data-testid="tweetText">親ツイート本文（メディアなし）</div>
        <div role="link" tabindex="0">
          <div data-testid="User-Name">
            <span>Quoted User</span>
            <a href="/quoted_user/status/111111111111111111"><time>2d</time></a>
          </div>
          <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/quoted.jpg" /></div>
        </div>
        <div role="group">
          <button data-testid="reply"></button>
          <button data-testid="retweet"></button>
          <button data-testid="like"></button>
        </div>
      </article>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]')!;
    const identity = extractOuterTweetIdentity(article);
    expect(identity).toEqual({
      tweetId: "999999999999999999",
      screenName: "outer_user",
      quotesPath: "/outer_user/status/999999999999999999/quotes",
      retweetsPath: "/outer_user/status/999999999999999999/retweets",
    });
    // リポスト・引用ツイートの画像もDLボタン表示対象として検出される
    expect(hasOuterDomMedia(article)).toBe(true);
    expect(findOuterActionBar(article)).not.toBeNull();

    // MediaCache の TTL/LRU と DownloadPlan の基本確認
    let clock = 1000;
    const cache = new MediaCache({ ttlMs: 5000, maxEntries: 2, now: () => clock });
    cache.upsert({ tweetId: "1", media: [], capturedAt: clock });
    clock = 7000;
    expect(cache.get("1")).toBeUndefined();

    const plan = buildDownloadPlan("999999999999999999", "outer_user", [
      {
        tweetId: "999999999999999999",
        screenName: "outer_user",
        mediaIndex: 1,
        type: "image",
        originalUrl: "https://pbs.twimg.com/media/TestPhoto.jpg",
      },
    ]);
    expect(plan.files[0]?.filename).toBe("XMedia/outer_user_999999999999999999_01.jpg");
  });
});
