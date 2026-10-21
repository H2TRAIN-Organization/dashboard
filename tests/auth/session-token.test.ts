import { describe, expect, it } from "vitest";
import {
  createSessionTokenCodec,
  generateSessionSecret,
  parseSessionSecret,
} from "@/server/infrastructure/auth/session-token";
import { FakeClock } from "./doubles";

const SECRET = Buffer.alloc(32, 7);

function payload(exp: number) {
  return {
    sid: "sid-0123456789abcdef0123456789abcdef",
    uid: "42",
    method: "email" as const,
    iat: 1_000,
    exp,
    supabaseAccessToken: "supabase-access-token-secret-value",
  };
}

describe("session token codec", () => {
  it("round-trips an encrypted payload", () => {
    const codec = createSessionTokenCodec(SECRET);
    const token = codec.seal(payload(2_000));
    const opened = codec.open(token, new Date(1_500_000));
    expect(opened).toMatchObject({
      sid: "sid-0123456789abcdef0123456789abcdef",
      uid: "42",
      method: "email",
      iat: 1_000,
      exp: 2_000,
      supabaseAccessToken: "supabase-access-token-secret-value",
    });
  });

  it("does not expose the Supabase access token in the cookie value", () => {
    const codec = createSessionTokenCodec(SECRET);
    const token = codec.seal(payload(2_000));
    expect(token).not.toContain("supabase-access-token-secret-value");
    expect(token.startsWith("v1.")).toBe(true);
    expect(token).not.toContain("alice");
  });

  it("rejects tampering, wrong secrets and expiry", () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const codec = createSessionTokenCodec(SECRET, { now: () => clock.now() });
    const token = codec.seal(payload(1_800_000_000));

    const last = token.at(-1);
    const tampered = `${token.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    expect(codec.open(tampered)).toBeNull();

    const other = createSessionTokenCodec(Buffer.alloc(32, 9), {
      now: () => clock.now(),
    });
    expect(other.open(token)).toBeNull();

    clock.advance(1_800_000_001_000 - clock.now().getTime());
    expect(codec.open(token)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    const codec = createSessionTokenCodec(SECRET);
    expect(codec.open("")).toBeNull();
    expect(codec.open("v1.")).toBeNull();
    expect(codec.open("v1.not-base64!!!")).toBeNull();
    expect(codec.open("v2.abc")).toBeNull();
  });

  it("parses generated and encoded secrets", () => {
    expect(parseSessionSecret(generateSessionSecret()).length).toBe(32);
    expect(parseSessionSecret("ab".repeat(32)).length).toBe(32);
    expect(parseSessionSecret("a".repeat(32)).length).toBe(32);
    expect(() => parseSessionSecret("short")).toThrow(/32 bytes/);
  });
});
