import { afterEach, describe, expect, it, vi } from "vitest";

// Mock node:fs at module level (hoisted before imports) so named imports are intercepted
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Named imports — these resolve to the vi.fn() instances created above
import { existsSync, readFileSync } from "node:fs";

// Import after mocking so config.ts picks up the mocked version
import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty config when config file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = loadConfig();
    expect(result).toEqual({});
  });

  it("throws ConfigError when file exists but cannot be read", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("Permission denied");
    });

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow("Failed to read config file");
  });

  it("includes the original error message in the ConfigError when read fails", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    try {
      loadConfig();
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain("EACCES: permission denied");
    }
  });

  it("throws ConfigError with 'Invalid TOML syntax' for malformed TOML", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("not valid toml {{{{" as unknown as Buffer);

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow("Invalid TOML syntax");
  });

  it("returns parsed config for valid TOML", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '[agent]\nmodel = "anthropic:claude-3-haiku-20240307"\n' as unknown as Buffer,
    );

    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.agent?.model).toBe("anthropic:claude-3-haiku-20240307");
  });

  it("resolves inheritance from valid TOML pipeline", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      `[agent]\nmodel = "openai:gpt-4o"\n\n[my-command]\ntype = "agent"\ninherits = "agent"\n` as unknown as Buffer,
    );

    const config = loadConfig();
    expect(config).toBeDefined();
    // After inheritance resolution, my-command should have agent's model
    const cmd = config["my-command"] as Record<string, unknown>;
    expect(cmd?.model).toBe("openai:gpt-4o");
  });

  it("throws ConfigError for valid TOML with unknown config fields", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '[complete]\nunknown-field = "bad"\n' as unknown as Buffer,
    );

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow("unknown-field");
  });
});
