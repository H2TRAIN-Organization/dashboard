import { describe, expect, it } from "vitest";
import { createBcryptPasswordVerifier } from "@/server/infrastructure/auth/bcrypt-password-verifier";
import { FakeBcrypt, VALID_BCRYPT_HASH } from "./doubles";

describe("bcrypt password verifier", () => {
  it("verifies the observed $2b$ cost-10 hash without rehashing", async () => {
    const bcrypt = new FakeBcrypt();
    const verifier = createBcryptPasswordVerifier(bcrypt);
    const result = await verifier.verify("correct", VALID_BCRYPT_HASH);
    expect(result).toEqual({ ok: true, cost: 10, reason: "ok" });
    expect(bcrypt.comparisons).toEqual([
      { data: "correct", hash: VALID_BCRYPT_HASH },
    ]);
    expect(bcrypt.hashCalls).toBe(0);
  });

  it("reports a mismatch but preserves the stored cost", async () => {
    const bcrypt = new FakeBcrypt();
    bcrypt.compareResult = false;
    const verifier = createBcryptPasswordVerifier(bcrypt);
    await expect(verifier.verify("wrong", VALID_BCRYPT_HASH)).resolves.toEqual({
      ok: false,
      cost: 10,
      reason: "mismatch",
    });
    expect(bcrypt.hashCalls).toBe(0);
  });

  it("fails closed for the 64-character non-bcrypt legacy values", async () => {
    const bcrypt = new FakeBcrypt();
    const verifier = createBcryptPasswordVerifier(bcrypt);
    const result = await verifier.verify("x", "a".repeat(64));
    expect(result).toEqual({ ok: false, cost: null, reason: "malformed" });
    expect(bcrypt.comparisons).toHaveLength(0);
  });

  it("rejects malformed and excessive-cost bcrypt values before comparing", async () => {
    const bcrypt = new FakeBcrypt();
    const verifier = createBcryptPasswordVerifier(bcrypt, { maxCost: 12 });
    const expensive = VALID_BCRYPT_HASH.replace("$2b$10$", "$2b$15$");

    await expect(verifier.verify("x", "")).resolves.toMatchObject({
      ok: false,
      reason: "missing",
    });
    await expect(verifier.verify("x", "$2b$10$too-short")).resolves.toMatchObject({
      ok: false,
      reason: "malformed",
    });
    await expect(verifier.verify("x", expensive)).resolves.toEqual({
      ok: false,
      cost: 15,
      reason: "unsupported_cost",
    });
    expect(bcrypt.comparisons).toHaveLength(0);
  });

  it("runs a dummy comparison with a cached dummy hash", async () => {
    const bcrypt = new FakeBcrypt();
    const verifier = createBcryptPasswordVerifier(bcrypt);
    await verifier.verifyDummy("one");
    await verifier.verifyDummy("two");
    expect(bcrypt.hashCalls).toBe(1);
    expect(bcrypt.comparisons).toHaveLength(2);
  });

  it("accepts $2y$ hashes used by some legacy PHP systems", async () => {
    const bcrypt = new FakeBcrypt();
    const verifier = createBcryptPasswordVerifier(bcrypt);
    const legacy = VALID_BCRYPT_HASH.replace("$2b$", "$2y$");
    await expect(verifier.verify("correct", legacy)).resolves.toMatchObject({
      ok: true,
      cost: 10,
    });
  });
});
