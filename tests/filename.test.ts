import { describe, expect, it } from "vitest";
import {
  buildMediaFilename,
  resolveImageExtension,
  sanitizeScreenNameForFilename,
} from "../src/core/filename";
import { isSafeRelativeDownloadFilename } from "../src/core/validators";

describe("filename: buildMediaFilename", () => {
  it("spec.md 2.8 準拠の標準形式でファイル名を生成する", () => {
    const filename = buildMediaFilename({
      screenName: "elonmusk",
      tweetId: "1850000000000000000",
      mediaIndex: 1,
      extension: "jpg",
    });
    expect(filename).toBe("XMedia/elonmusk_1850000000000000000_01.jpg");
  });

  it("連番が2桁にゼロパディングされる（01, 02, ... 12）", () => {
    const fn1 = buildMediaFilename({
      screenName: "artist",
      tweetId: "1000",
      mediaIndex: 3,
      extension: "png",
    });
    expect(fn1).toBe("XMedia/artist_1000_03.png");

    const fn12 = buildMediaFilename({
      screenName: "artist",
      tweetId: "1000",
      mediaIndex: 12,
      extension: "mp4",
    });
    expect(fn12).toBe("XMedia/artist_1000_12.mp4");
  });

  it("不正な tweetId は '0' にフォールバックする", () => {
    const fn = buildMediaFilename({
      screenName: "user",
      tweetId: "invalid_id_with_letters",
      mediaIndex: 1,
      extension: "jpg",
    });
    expect(fn).toBe("XMedia/user_0_01.jpg");
  });
});

describe("filename: sanitizeScreenNameForFilename", () => {
  it("ファイル名禁止文字や空白が置換・除去される", () => {
    expect(sanitizeScreenNameForFilename('bad/name:with"symbols?*')).toBe("bad_name_with_symbols");
    expect(sanitizeScreenNameForFilename("user name")).toBe("user_name");
    expect(sanitizeScreenNameForFilename("user\x00ctrl")).toBe("user_ctrl");
  });

  it("Windows 予約語の場合は安全な 'x_user' にフォールバックする", () => {
    expect(sanitizeScreenNameForFilename("con")).toBe("x_user");
    expect(sanitizeScreenNameForFilename("PRN")).toBe("x_user");
    expect(sanitizeScreenNameForFilename("aux")).toBe("x_user");
    expect(sanitizeScreenNameForFilename("NUL")).toBe("x_user");
    expect(sanitizeScreenNameForFilename("com1")).toBe("x_user");
    expect(sanitizeScreenNameForFilename("lpt9")).toBe("x_user");
  });

  it("undefined や空文字、記号のみの場合は 'x_user' にフォールバックする", () => {
    expect(sanitizeScreenNameForFilename(undefined)).toBe("x_user");
    expect(sanitizeScreenNameForFilename("")).toBe("x_user");
    expect(sanitizeScreenNameForFilename("///:::***")).toBe("x_user");
  });
});

describe("filename: resolveImageExtension", () => {
  it("format クエリパラメータから拡張子を正しく抽出する", () => {
    expect(resolveImageExtension("https://pbs.twimg.com/media/XYZ?format=png&name=orig")).toBe("png");
    expect(resolveImageExtension("https://pbs.twimg.com/media/XYZ?format=webp")).toBe("webp");
    expect(resolveImageExtension("https://pbs.twimg.com/media/XYZ?format=jpeg")).toBe("jpg");
  });

  it("URL パスから拡張子を抽出する", () => {
    expect(resolveImageExtension("https://pbs.twimg.com/media/pic.jpg")).toBe("jpg");
    expect(resolveImageExtension("https://pbs.twimg.com/media/pic.png:orig")).toBe("png");
    expect(resolveImageExtension("https://pbs.twimg.com/media/pic.gif")).toBe("gif");
  });

  it("未知または無効な場合は jpg にフォールバックする", () => {
    expect(resolveImageExtension("https://pbs.twimg.com/media/noext")).toBe("jpg");
    expect(resolveImageExtension("not-a-valid-url")).toBe("jpg");
  });
});

describe("filename: isSafeRelativeDownloadFilename", () => {
  it("正常な相対ファイル名を承認する", () => {
    expect(isSafeRelativeDownloadFilename("XMedia/valid_user_1234567890_01.jpg")).toBe(true);
    expect(isSafeRelativeDownloadFilename("XMedia/user-name_99999_02.png")).toBe(true);
    expect(isSafeRelativeDownloadFilename("XMedia/video_creator_123_01.mp4")).toBe(true);
  });

  it("パストラバーサルや絶対パス、バックスラッシュを拒否する", () => {
    expect(isSafeRelativeDownloadFilename("../evil.jpg")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia/../../system32/cmd.exe")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia\\user_123_01.jpg")).toBe(false);
    expect(isSafeRelativeDownloadFilename("/etc/passwd")).toBe(false);
    expect(isSafeRelativeDownloadFilename("C:\\XMedia\\test.jpg")).toBe(false);
  });

  it("未許可の拡張子（exe, sh, js 等）を拒否する", () => {
    expect(isSafeRelativeDownloadFilename("XMedia/user_123_01.exe")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia/user_123_01.sh")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia/user_123_01.bat")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia/user_123_01.js")).toBe(false);
  });

  it("Windows 予約名を含むパスを拒否する", () => {
    expect(isSafeRelativeDownloadFilename("XMedia/CON_123456_01.jpg")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia/NUL_123456_01.jpg")).toBe(false);
    expect(isSafeRelativeDownloadFilename("XMedia/aux_123456_01.png")).toBe(false);
  });
});
