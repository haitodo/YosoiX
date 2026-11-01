import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { deriveExtensionId } from "../scripts/key-utils.mjs";

describe("Extension Key & ID Utils", () => {
  it("32文字かつ 'a'-'p' の英小文字のみで構成される拡張機能 ID を生成する", () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const id = deriveExtensionId(publicKey);

    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[a-p]{32}$/);
  });

  it("同一の公開鍵からは常に同一の ID が再現される（決定性）", () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const id1 = deriveExtensionId(publicKey);
    const id2 = deriveExtensionId(publicKey.toString("base64"));

    expect(id1).toBe(id2);
  });

  it("既知のハッシュ値に対する ID 変換ロジックが Chromium 仕様と完全一致する", () => {
    // 0x00 -> "aa", 0x0f -> "ap", 0xf0 -> "pa", 0xff -> "pp"
    // 16バイトの固定テストデータ
    const dummyDer = Buffer.from("test-public-key-der-payload");
    const hash = crypto.createHash("sha256").update(dummyDer).digest();
    const id = deriveExtensionId(dummyDer);

    expect(id).toHaveLength(32);

    for (let i = 0; i < 16; i++) {
      const byte = hash[i];
      const highChar = id[i * 2];
      const lowChar = id[i * 2 + 1];

      expect(byte).toBeDefined();
      expect(highChar).toBeDefined();
      expect(lowChar).toBeDefined();

      if (byte !== undefined && highChar !== undefined && lowChar !== undefined) {
        expect(highChar.charCodeAt(0) - 97).toBe((byte >> 4) & 0x0f);
        expect(lowChar.charCodeAt(0) - 97).toBe(byte & 0x0f);
      }
    }
  });
});
