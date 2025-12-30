import { describe, expect, it } from "vitest";
import { generateSessionName } from "./session-names.js";

describe("session-names", () => {
  describe("generateSessionName", () => {
    it("returns name in format adjective-noun", () => {
      const name = generateSessionName();
      expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    });

    it("generates different names across multiple calls", () => {
      const names = new Set<string>();
      // Generate 50 names and check we get at least 30 unique ones
      // (with 3584 combinations, 50 samples should yield many unique names)
      for (let i = 0; i < 50; i++) {
        names.add(generateSessionName());
      }
      expect(names.size).toBeGreaterThanOrEqual(30);
    });

    it("uses lowercase letters only for adjective and noun", () => {
      for (let i = 0; i < 20; i++) {
        const name = generateSessionName();
        const [adjective, noun] = name.split("-");
        expect(adjective).toMatch(/^[a-z]+$/);
        expect(noun).toMatch(/^[a-z]+$/);
      }
    });
  });
});
