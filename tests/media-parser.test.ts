import { describe, expect, it } from "vitest";
import {
  parseApiResponseForTweets,
  selectBestMp4Variant,
  toOriginalImageUrl,
} from "../src/core/media-parser";
import type { VideoVariant } from "../src/core/types";

describe("media-parser: toOriginalImageUrl", () => {
  it("pbs.twimg.com のクエリ形式 URL を name=orig に変換し format を維持する", () => {
    const res = toOriginalImageUrl("https://pbs.twimg.com/media/GABCD123?format=jpg&name=medium");
    expect(res).toEqual({
      url: "https://pbs.twimg.com/media/GABCD123?format=jpg&name=orig",
      extension: "jpg",
    });

    const webpRes = toOriginalImageUrl("https://pbs.twimg.com/media/GABCD123?format=webp&name=900x900");
    expect(webpRes).toEqual({
      url: "https://pbs.twimg.com/media/GABCD123?format=webp&name=orig",
      extension: "webp",
    });

    const pngRes = toOriginalImageUrl("https://pbs.twimg.com/media/GABCD123?format=png");
    expect(pngRes).toEqual({
      url: "https://pbs.twimg.com/media/GABCD123?format=png&name=orig",
      extension: "png",
    });
  });

  it("旧形式のパスベース URL (:large コロンサフィックス等) を name=orig に正規化する", () => {
    const res = toOriginalImageUrl("https://pbs.twimg.com/media/photo1.jpg:large");
    expect(res).toEqual({
      url: "https://pbs.twimg.com/media/photo1.jpg?name=orig",
      extension: "jpg",
    });

    const origSuffix = toOriginalImageUrl("https://pbs.twimg.com/media/photo2.png:orig");
    expect(origSuffix).toEqual({
      url: "https://pbs.twimg.com/media/photo2.png?name=orig",
      extension: "png",
    });
  });

  it("jpeg 形式は拡張子 jpg に正規化される", () => {
    const res = toOriginalImageUrl("https://pbs.twimg.com/media/photo.jpeg?name=small");
    expect(res).toEqual({
      url: "https://pbs.twimg.com/media/photo.jpeg?name=orig",
      extension: "jpg",
    });
  });

  it("twimg 以外の未許可ドメインや無効な URL は null を返す", () => {
    expect(toOriginalImageUrl("https://evil.com/img.jpg")).toBeNull();
    expect(toOriginalImageUrl("ftp://pbs.twimg.com/media/img.jpg")).toBeNull();
    expect(toOriginalImageUrl("invalid-url")).toBeNull();
  });
});

describe("media-parser: selectBestMp4Variant", () => {
  it("複数の video/mp4 バリアントからビットレート最大の候補を選択する", () => {
    const variants: VideoVariant[] = [
      {
        url: "https://video.twimg.com/amplify_video/1/vid/avc1/480x270/low.mp4",
        contentType: "video/mp4",
        bitrate: 288000,
      },
      {
        url: "https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/high.mp4",
        contentType: "video/mp4",
        bitrate: 2176000,
      },
      {
        url: "https://video.twimg.com/amplify_video/1/vid/avc1/640x360/mid.mp4",
        contentType: "video/mp4",
        bitrate: 832000,
      },
    ];

    const result = selectBestMp4Variant(variants);
    expect(result).toEqual({
      ok: true,
      url: "https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/high.mp4",
      bitrate: 2176000,
    });
  });

  it("GIF（animated_gif）等で bitrate が 0 または undefined の MP4 を正常に選択する", () => {
    const variants: VideoVariant[] = [
      {
        url: "https://video.twimg.com/tweet_video/sample_gif.mp4",
        contentType: "video/mp4",
        bitrate: 0,
      },
    ];

    const result = selectBestMp4Variant(variants);
    expect(result).toEqual({
      ok: true,
      url: "https://video.twimg.com/tweet_video/sample_gif.mp4",
      bitrate: 0,
    });
  });

  it("HLS（.m3u8）しか存在しない場合は HLS_ONLY を返す", () => {
    const variants: VideoVariant[] = [
      {
        url: "https://video.twimg.com/ext_tw_video/1/pu/pl/master.m3u8?tag=12",
        contentType: "application/x-mpegURL",
      },
    ];

    const result = selectBestMp4Variant(variants);
    expect(result).toEqual({
      ok: false,
      reason: "HLS_ONLY",
    });
  });

  it("バリアントが空または有効な候補がない場合は NO_VALID_MP4 を返す", () => {
    expect(selectBestMp4Variant([])).toEqual({ ok: false, reason: "NO_VALID_MP4" });
    expect(selectBestMp4Variant(undefined)).toEqual({ ok: false, reason: "NO_VALID_MP4" });
  });
});

describe("media-parser: parseApiResponseForTweets", () => {
  it("画像4枚の投稿から連番インデックス付きの4件のメディアを正しく抽出する", () => {
    const payload = {
      data: {
        tweetResult: {
          result: {
            __typename: "Tweet",
            rest_id: "1234567890123456789",
            core: {
              user_results: {
                result: {
                  core: { screen_name: "test_photographer" },
                },
              },
            },
            legacy: {
              created_at: "Sun Nov 01 08:00:00 +0000 2026",
              quote_count: 5,
              retweet_count: 42,
              extended_entities: {
                media: [
                  { type: "photo", media_url_https: "https://pbs.twimg.com/media/Img1.jpg" },
                  { type: "photo", media_url_https: "https://pbs.twimg.com/media/Img2.jpg" },
                  { type: "photo", media_url_https: "https://pbs.twimg.com/media/Img3.jpg" },
                  { type: "photo", media_url_https: "https://pbs.twimg.com/media/Img4.jpg" },
                ],
              },
            },
          },
        },
      },
    };

    const entries = parseApiResponseForTweets(payload);
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(entry.tweetId).toBe("1234567890123456789");
    expect(entry.screenName).toBe("test_photographer");
    expect(entry.quoteCount).toBe(5);
    expect(entry.retweetCount).toBe(42);
    expect(entry.media).toHaveLength(4);

    expect(entry.media[0]).toMatchObject({
      tweetId: "1234567890123456789",
      screenName: "test_photographer",
      mediaIndex: 1,
      type: "image",
      originalUrl: "https://pbs.twimg.com/media/Img1.jpg",
    });
    expect(entry.media[3]?.mediaIndex).toBe(4);
  });

  it("画像と動画が混在する投稿をそれぞれの type で抽出する", () => {
    const payload = {
      tweet: {
        rest_id: "9876543210",
        core: {
          user_results: {
            result: {
              legacy: { screen_name: "multimedia_creator" },
            },
          },
        },
        legacy: {
          extended_entities: {
            media: [
              {
                type: "photo",
                media_url_https: "https://pbs.twimg.com/media/PhotoA.png",
              },
              {
                type: "video",
                video_info: {
                  variants: [
                    {
                      bitrate: 1000000,
                      content_type: "video/mp4",
                      url: "https://video.twimg.com/video1.mp4",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };

    const entries = parseApiResponseForTweets(payload);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.media).toHaveLength(2);
    expect(entries[0]?.media[0]?.type).toBe("image");
    expect(entries[0]?.media[1]?.type).toBe("video");
    expect(entries[0]?.media[1]?.variants?.[0]?.url).toBe("https://video.twimg.com/video1.mp4");
  });

  it("UserWithVisibilityResults ラッパー内の screen_name を抽出する", () => {
    const payload = {
      tweet: {
        rest_id: "5555555555",
        core: {
          user_results: {
            result: {
              __typename: "UserWithVisibilityResults",
              user: {
                legacy: { screen_name: "wrapped_user" },
              },
            },
          },
        },
        legacy: {
          extended_entities: {
            media: [
              { type: "photo", media_url_https: "https://pbs.twimg.com/media/Img.jpg" },
            ],
          },
        },
      },
    };

    const entries = parseApiResponseForTweets(payload);
    expect(entries[0]?.screenName).toBe("wrapped_user");
  });

  it("リポスト（retweeted_status_result）では元ツイートおよびラッパー投稿の双方にメディアを紐づけて抽出する", () => {
    const payload = {
      tweet: {
        rest_id: "8888888888", // リポストラッパー投稿のID
        core: {
          user_results: {
            result: { core: { screen_name: "retweeter" } },
          },
        },
        retweeted_status_result: {
          result: {
            __typename: "Tweet",
            rest_id: "7777777777", // 元ツイートのID
            core: {
              user_results: {
                result: { core: { screen_name: "original_author" } },
              },
            },
            legacy: {
              extended_entities: {
                media: [
                  { type: "photo", media_url_https: "https://pbs.twimg.com/media/Original.jpg" },
                ],
              },
            },
          },
        },
        legacy: {
          retweeted_status_result: {},
        },
      },
    };

    const entries = parseApiResponseForTweets(payload);
    // 元ツイート(7777777777)とラッパー投稿(8888888888)の双方が登録され、双方でメディアが取得可能
    expect(entries).toHaveLength(2);
    const orig = entries.find((e) => e.tweetId === "7777777777");
    const wrapper = entries.find((e) => e.tweetId === "8888888888");
    expect(orig).toBeDefined();
    expect(orig?.screenName).toBe("original_author");
    expect(orig?.media).toHaveLength(1);
    expect(wrapper).toBeDefined();
    expect(wrapper?.media).toHaveLength(1);
  });

  it("引用リポスト（quoted_status_result）では親投稿のDL対象に引用先メディアを統合しつつ引用先単体も抽出する", () => {
    const payload = {
      tweet: {
        rest_id: "1111111111", // 親ツイート（引用する側）
        core: {
          user_results: {
            result: { core: { screen_name: "quoting_user" } },
          },
        },
        quoted_status_result: {
          result: {
            __typename: "Tweet",
            rest_id: "2222222222", // 引用された側の元ツイート
            core: {
              user_results: {
                result: { core: { screen_name: "quoted_artist" } },
              },
            },
            legacy: {
              extended_entities: {
                media: [
                  { type: "photo", media_url_https: "https://pbs.twimg.com/media/QuotedArt.jpg" },
                ],
              },
            },
          },
        },
        legacy: {
          full_text: "見てこれすごい！",
        },
      },
    };

    const entries = parseApiResponseForTweets(payload);
    expect(entries).toHaveLength(2);

    const parent = entries.find((e) => e.tweetId === "1111111111");
    const quoted = entries.find((e) => e.tweetId === "2222222222");

    expect(parent).toBeDefined();
    expect(parent?.media).toHaveLength(1);
    expect(parent?.media[0]?.originalUrl).toBe("https://pbs.twimg.com/media/QuotedArt.jpg");
    // ファイル名用メタデータは引用元の作者名と投稿IDを維持
    expect(parent?.media[0]?.screenName).toBe("quoted_artist");
    expect(parent?.media[0]?.tweetId).toBe("2222222222");

    expect(quoted).toBeDefined();
    expect(quoted?.screenName).toBe("quoted_artist");
    expect(quoted?.media).toHaveLength(1);
  });

  it("削除済み・非公開メディア（ext_media_availability 不許可）は除外する", () => {
    const payload = {
      tweet: {
        rest_id: "4444444444",
        core: {
          user_results: {
            result: { core: { screen_name: "user_a" } },
          },
        },
        legacy: {
          extended_entities: {
            media: [
              {
                type: "photo",
                media_url_https: "https://pbs.twimg.com/media/Deleted.jpg",
                ext_media_availability: { status: "Unavailable" },
              },
              {
                type: "photo",
                media_url_https: "https://pbs.twimg.com/media/Normal.jpg",
                ext_media_availability: { status: "Available" },
              },
            ],
          },
        },
      },
    };

    const entries = parseApiResponseForTweets(payload);
    expect(entries[0]?.media).toHaveLength(1);
    expect(entries[0]?.media[0]?.originalUrl).toBe("https://pbs.twimg.com/media/Normal.jpg");
  });

  it("リンクカード（card）のサムネイルはメディアとして抽出しない", () => {
    const payload = {
      tweet: {
        rest_id: "3333333333",
        core: {
          user_results: {
            result: { core: { screen_name: "card_tweeter" } },
          },
        },
        card: {
          name: "summary_large_image",
          legacy: {
            binding_values: [
              {
                key: "thumbnail_image",
                value: { image_value: { url: "https://pbs.twimg.com/card_img/thumb.jpg" } },
              },
            ],
          },
        },
        legacy: {
          // extended_entities なし
        },
      },
    };

    const entries = parseApiResponseForTweets(payload);
    expect(entries[0]?.media).toHaveLength(0);
  });
});
