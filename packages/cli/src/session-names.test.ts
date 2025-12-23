import { describe, expect, it } from "bun:test";
import { generateSessionName } from "./session-names.js";

describe("session-names", () => {
  describe("generateSessionName", () => {
    it("returns name in format adjective-noun-number", () => {
      const name = generateSessionName();
      expect(name).toMatch(/^[a-z]+-[a-z]+-\d{1,2}$/);
    });

    it("generates different names across multiple calls", () => {
      const names = new Set<string>();
      // Generate 50 names and check we get at least 40 unique ones
      for (let i = 0; i < 50; i++) {
        names.add(generateSessionName());
      }
      expect(names.size).toBeGreaterThanOrEqual(40);
    });

    it("generates numbers in range 0-99", () => {
      const numbers = new Set<number>();
      // Generate enough names to sample the number distribution
      for (let i = 0; i < 500; i++) {
        const name = generateSessionName();
        const number = parseInt(name.split("-").pop()!, 10);
        numbers.add(number);
        expect(number).toBeGreaterThanOrEqual(0);
        expect(number).toBeLessThan(100);
      }
      // Should have seen multiple different numbers
      expect(numbers.size).toBeGreaterThan(20);
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
