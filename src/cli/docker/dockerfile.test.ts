import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DOCKERFILE,
  DEV_DOCKERFILE,
  resolveDockerfile,
  computeDockerfileHash,
} from "./dockerfile.js";
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

  describe("DEV_DOCKERFILE", () => {
    it("should use oven/bun base image", () => {
      expect(DEV_DOCKERFILE).toContain("FROM oven/bun:1-debian");
    });

    it("should NOT install llmist from npm", () => {
      expect(DEV_DOCKERFILE).not.toContain("bun add -g llmist");
    });

    it("should have bun run entrypoint for mounted source", () => {
      expect(DEV_DOCKERFILE).toContain('ENTRYPOINT ["bun", "run"');
      expect(DEV_DOCKERFILE).toContain("/llmist-src/src/cli.ts");
    });

    it("should set WORKDIR to /workspace", () => {
      expect(DEV_DOCKERFILE).toContain("WORKDIR /workspace");
    });

    it("should install essential tools (ripgrep, git, curl)", () => {
      expect(DEV_DOCKERFILE).toContain("ripgrep");
      expect(DEV_DOCKERFILE).toContain("git");
      expect(DEV_DOCKERFILE).toContain("curl");
    });
  });

  describe("resolveDockerfile", () => {
    it("should return DEFAULT_DOCKERFILE when no custom dockerfile and not dev mode", () => {
      const config: DockerConfig = {};
      const result = resolveDockerfile(config, false);
      expect(result).toBe(DEFAULT_DOCKERFILE);
    });

    it("should return DEFAULT_DOCKERFILE when devMode is not specified", () => {
      const config: DockerConfig = {};
      const result = resolveDockerfile(config);
      expect(result).toBe(DEFAULT_DOCKERFILE);
    });

    it("should return DEV_DOCKERFILE when dev mode is enabled", () => {
      const config: DockerConfig = {};
      const result = resolveDockerfile(config, true);
      expect(result).toBe(DEV_DOCKERFILE);
    });

    it("should return custom dockerfile when provided (production mode)", () => {
      const customDockerfile = "FROM alpine\nRUN echo hello";
      const config: DockerConfig = { dockerfile: customDockerfile };
      const result = resolveDockerfile(config, false);
      expect(result).toBe(customDockerfile);
    });

    it("should return custom dockerfile when provided (dev mode)", () => {
      const customDockerfile = "FROM alpine\nRUN echo hello";
      const config: DockerConfig = { dockerfile: customDockerfile };
      const result = resolveDockerfile(config, true);
      expect(result).toBe(customDockerfile);
    });

    it("should prioritize custom dockerfile over dev mode", () => {
      const customDockerfile = "FROM custom:image";
      const config: DockerConfig = { dockerfile: customDockerfile };
      const result = resolveDockerfile(config, true);
      expect(result).toBe(customDockerfile);
      expect(result).not.toBe(DEV_DOCKERFILE);
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

    it("should produce different hashes for DEFAULT and DEV dockerfiles", () => {
      const defaultHash = computeDockerfileHash(DEFAULT_DOCKERFILE);
      const devHash = computeDockerfileHash(DEV_DOCKERFILE);
      expect(defaultHash).not.toBe(devHash);
    });
  });
});
