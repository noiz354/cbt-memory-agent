import { isSessionExpired } from "./authStore";
import { describe, expect, it } from "vitest";

describe("isSessionExpired", () => {
  it("returns false for a null (signed-out) expiry", () => {
    expect(isSessionExpired(null, 1_000)).toBe(false);
  });

  it("returns false while the session is still valid", () => {
    expect(isSessionExpired(2_000, 1_000)).toBe(false);
  });

  it("returns true once the expiry has passed", () => {
    expect(isSessionExpired(1_000, 2_000)).toBe(true);
  });

  it("returns false exactly at the expiry boundary", () => {
    expect(isSessionExpired(1_000, 1_000)).toBe(false);
  });
});
