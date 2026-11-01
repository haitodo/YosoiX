import { beforeEach, describe, expect, it } from "vitest";
import {
  extractOuterTweetIdentity,
  findOuterActionBar,
  hasOuterDomMedia,
  isInsideLinkCard,
  X_SELECTORS,
} from "../src/content/tweet-dom";
import { upsertMediaDownloadButton } from "../src/content/media-download-button";
import { parseApiResponseForTweets } from "../src/core/media-parser";
import { MediaCache } from "../src/core/media-cache";
import { buildDownloadPlan } from "../src/core/download-manager";

describe("リポスト・引用ツイートのダウンロードボタンおよびメディア抽出テスト", () => {
  let actionBar: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="socialContext">
          <a href="/retweeter"><span>Retweeterさんがリポストしました</span></a>
        </div>
        <div>
          <div data-testid="User-Name">
            <a href="/original_author"><span>Original Author</span></a>
            <a href="/original_author/status/2000000001"><time datetime="2026-11-01T10:00:00.000Z">1h</time></a>
          </div>
          <div data-testid="tweetText">リポストされた元ツイートの本文</div>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/TestMedia.jpg" />
          </div>
          <div role="group" id="action-bar">
            <button data-testid="reply"></button>
            <button data-testid="retweet"></button>
            <button data-testid="like"></button>
          </div>
        </div>
      </article>
    `;
    actionBar = document.getElementById("action-bar")!;
  });

  it("通常のリポスト（Native Retweet）で画像がある場合、DOM 解析とダウンロードボタン挿入が正常に行われる", () => {
    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]')!;
    const identity = extractOuterTweetIdentity(article);
    expect(identity).not.toBeNull();
    expect(identity?.tweetId).toBe("2000000001");
    expect(identity?.screenName).toBe("original_author");

    expect(hasOuterDomMedia(article)).toBe(true);

    // ダウンロードボタン挿入
    upsertMediaDownloadButton(actionBar, identity!, { state: "idle", updatedAt: Date.now() }, 1);
    const dlButton = actionBar.querySelector<HTMLButtonElement>('button[data-yosoix-action="download"]');
    expect(dlButton).not.toBeNull();
    expect(dlButton?.getAttribute("data-yosoix-tweet-id")).toBe("2000000001");
  });

  it("引用リポスト（Quote Tweet）で引用先に画像がある場合、親投稿のアクションバーにダウンロードボタンが表示されダウンロード可能", () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/quoting_user"><span>Quoting User</span></a>
          <a href="/quoting_user/status/3000000001"><time datetime="2026-11-01T12:00:00.000Z">30m</time></a>
        </div>
        <div data-testid="tweetText">引用コメント</div>
        <div data-testid="quoteTweet" role="link" tabindex="0">
          <div data-testid="User-Name">
            <a href="/quoted_artist"><span>Quoted Artist</span></a>
            <a href="/quoted_artist/status/4000000001"><time datetime="2026-11-01T09:00:00.000Z">3h</time></a>
          </div>
          <div data-testid="tweetText">素敵なイラスト</div>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/Artwork.png" />
          </div>
        </div>
        <div role="group" id="quote-action-bar">
          <button data-testid="reply"></button>
          <button data-testid="retweet"></button>
          <button data-testid="like"></button>
        </div>
      </article>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]')!;
    const identity = extractOuterTweetIdentity(article);
    expect(identity?.tweetId).toBe("3000000001");

    // 引用先の画像も DOM 上で検出される
    expect(hasOuterDomMedia(article)).toBe(true);

    // API レスポンス解析
    const payload = {
      tweet: {
        rest_id: "3000000001",
        core: { user_results: { result: { core: { screen_name: "quoting_user" } } } },
        quoted_status_result: {
          result: {
            __typename: "Tweet",
            rest_id: "4000000001",
            core: { user_results: { result: { core: { screen_name: "quoted_artist" } } } },
            legacy: {
              extended_entities: {
                media: [
                  { type: "photo", media_url_https: "https://pbs.twimg.com/media/Artwork.png" },
                ],
              },
            },
          },
        },
        legacy: { full_text: "引用コメント" },
      },
    };

    const entries = parseApiResponseForTweets(payload);
    const parentEntry = entries.find((e) => e.tweetId === "3000000001");
    expect(parentEntry).toBeDefined();
    expect(parentEntry?.media).toHaveLength(1);

    // ダウンロードプランの構築: 引用先作者名・投稿IDで保存ファイル名が生成される
    const plan = buildDownloadPlan("3000000001", "quoting_user", parentEntry!.media);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]?.filename).toBe("XMedia/quoted_artist_4000000001_01.png");
  });

  it("リンクカード（card.wrapper / OGPプレビュー等）のサムネイルは除外され誤ってダウンロードボタンが表示されない", () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/news_user"><span>News User</span></a>
          <a href="/news_user/status/5000000001"><time datetime="2026-11-01T14:00:00.000Z">10m</time></a>
        </div>
        <div data-testid="tweetText">ニュースリンクです</div>
        <div data-testid="card.wrapper">
          <img src="https://pbs.twimg.com/card_img/thumb.jpg" />
        </div>
        <div role="group">
          <button data-testid="reply"></button>
          <button data-testid="retweet"></button>
          <button data-testid="like"></button>
        </div>
      </article>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]')!;
    expect(hasOuterDomMedia(article)).toBe(false);
  });
});
