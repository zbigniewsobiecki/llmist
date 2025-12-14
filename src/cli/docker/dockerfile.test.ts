import { describe, expect, it } from "bun:test";
import { computeDockerfileHash, DEFAULT_DOCKERFILE, resolveDockerfile } from "./dockerfile.js";
import type { DockerConfig } from "./types.js";

describe("dockerfile", () => {
  describe("DEFAULT_DOCKERFILE", () => {
    it("should use oven/bun base image", () => {
      expect(DEFAULT_DOCKERFILE).toContain("FROM oven/bun:1-debian");
    });

    it("should install ripgrep", () => {
      expect(DEFAULT_DOCKERFILE).toContain("ripgrep");
    });

    it("should install git", () => {
      expect(DEFAULT_DOCKERFILE).toContain("git");
    });

    it("should install ast-grep", () => {
      expect(DEFAULT_DOCKERFILE).toContain("ast-grep");
    });

    it("should install llmist globally", () => {
      expect(DEFAULT_DOCKERFILE).toContain("bun add -g llmist");
    });

    it("should set WORKDIR to /workspace", () => {
      expect(DEFAULT_DOCKERFILE).toContain("WORKDIR /workspace");
    });

    it("should have llmist as entrypoint", () => {
      expect(DEFAULT_DOCKERFILE).toContain('ENTRYPOINT ["llmist"]');
    });
  });

  describe("resolveDockerfile", () => {
    it("should return DEFAULT_DOCKERFILE when no custom dockerfile", () => {
      const config: DockerConfig = {};
      const result = resolveDockerfile(config);
      expect(result).toBe(DEFAULT_DOCKERFILE);
    });

    it("should return custom dockerfile when provided", () => {
      const customDockerfile = "FROM alpine\nRUN echo hello";
      const config: DockerConfig = { dockerfile: customDockerfile };
      const result = resolveDockerfile(config);
      expect(result).toBe(customDockerfile);
    });
  });

  describe("computeDockerfileHash", () => {
    it("should return a hex string", () => {
      const hash = computeDockerfileHash("FROM alpine");
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it("should return consistent hash for same content", () => {
      const content = "FROM node:18\nRUN npm install";
      const hash1 = computeDockerfileHash(content);
      const hash2 = computeDockerfileHash(content);
      expect(hash1).toBe(hash2);
    });

    it("should return different hash for different content", () => {
      const hash1 = computeDockerfileHash("FROM alpine");
      const hash2 = computeDockerfileHash("FROM debian");
      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", () => {
      const hash = computeDockerfileHash("");
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });

    it("should handle unicode content", () => {
      const hash = computeDockerfileHash("FROM alpine\n# Comment with émoji 🐳");
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it("should handle multiline content", () => {
      const content = `FROM alpine
RUN apk add --no-cache git
WORKDIR /app
COPY . .
CMD ["./app"]`;
      const hash = computeDockerfileHash(content);
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });

    it("should be sensitive to whitespace changes", () => {
      const hash1 = computeDockerfileHash("FROM alpine");
      const hash2 = computeDockerfileHash("FROM alpine ");
      expect(hash1).not.toBe(hash2);
    });

    it("should produce hash for DEFAULT_DOCKERFILE", () => {
      const hash = computeDockerfileHash(DEFAULT_DOCKERFILE);
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });
  });
});
