import { describe, expect, it } from "vitest";
import {
  extractUsernameFromProfilePath,
  toUserProfileAllPath,
} from "../src/core/user-profile";

describe("user-profile: extractUsernameFromProfilePath", () => {
  it("通常のユーザープロフィールパスからスクリーンネームを抽出する", () => {
    expect(extractUsernameFromProfilePath("/elonmusk")).toBe("elonmusk");
    expect(extractUsernameFromProfilePath("/jack")).toBe("jack");
    expect(extractUsernameFromProfilePath("/Artist_User_01")).toBe("Artist_User_01");
    expect(extractUsernameFromProfilePath("/elonmusk/")).toBe("elonmusk");
    expect(extractUsernameFromProfilePath("/elonmusk?s=20")).toBe("elonmusk");
    expect(extractUsernameFromProfilePath("/elonmusk#header")).toBe("elonmusk");
  });

  it("X の予約語や内部パスは除外して null を返す", () => {
    expect(extractUsernameFromProfilePath("/home")).toBeNull();
    expect(extractUsernameFromProfilePath("/explore")).toBeNull();
    expect(extractUsernameFromProfilePath("/notifications")).toBeNull();
    expect(extractUsernameFromProfilePath("/messages")).toBeNull();
    expect(extractUsernameFromProfilePath("/settings")).toBeNull();
    expect(extractUsernameFromProfilePath("/search")).toBeNull();
    expect(extractUsernameFromProfilePath("/jobs")).toBeNull();
    expect(extractUsernameFromProfilePath("/i")).toBeNull();
    expect(extractUsernameFromProfilePath("/communities")).toBeNull();
  });

  it("すでにサブパス（タブや投稿詳細）が付いているURLは null を返す", () => {
    expect(extractUsernameFromProfilePath("/elonmusk/all")).toBeNull();
    expect(extractUsernameFromProfilePath("/elonmusk/media")).toBeNull();
    expect(extractUsernameFromProfilePath("/elonmusk/with_replies")).toBeNull();
    expect(extractUsernameFromProfilePath("/elonmusk/highlights")).toBeNull();
    expect(extractUsernameFromProfilePath("/elonmusk/status/1234567890")).toBeNull();
    expect(extractUsernameFromProfilePath("/elonmusk/header_photo")).toBeNull();
  });

  it("ルートパスや不正な値は null を返す", () => {
    expect(extractUsernameFromProfilePath("/")).toBeNull();
    expect(extractUsernameFromProfilePath("")).toBeNull();
    expect(extractUsernameFromProfilePath("invalid-no-slash")).toBeNull();
  });
});

describe("user-profile: toUserProfileAllPath", () => {
  it("相対パスを /{username}/all に変換する", () => {
    expect(toUserProfileAllPath("/elonmusk")).toBe("/elonmusk/all");
    expect(toUserProfileAllPath("/jack/")).toBe("/jack/all");
    expect(toUserProfileAllPath("/test_user?s=09")).toBe("/test_user/all?s=09");
  });

  it("x.com および twitter.com の絶対URLを /{username}/all に変換する", () => {
    expect(toUserProfileAllPath("https://x.com/elonmusk")).toBe("/elonmusk/all");
    expect(toUserProfileAllPath("https://www.x.com/elonmusk")).toBe("/elonmusk/all");
    expect(toUserProfileAllPath("https://twitter.com/elonmusk")).toBe("/elonmusk/all");
  });

  it("外部ドメインや無効な URL は null を返す", () => {
    expect(toUserProfileAllPath("https://google.com/elonmusk")).toBeNull();
    expect(toUserProfileAllPath("https://evil.x.com.attacker.com/elonmusk")).toBeNull();
    expect(toUserProfileAllPath("")).toBeNull();
  });

  it("予約パスやサブパス付き URL は null を返す", () => {
    expect(toUserProfileAllPath("/home")).toBeNull();
    expect(toUserProfileAllPath("https://x.com/explore")).toBeNull();
    expect(toUserProfileAllPath("/elonmusk/all")).toBeNull();
    expect(toUserProfileAllPath("/elonmusk/media")).toBeNull();
    expect(toUserProfileAllPath("/i/bookmarks")).toBeNull();
  });
});
