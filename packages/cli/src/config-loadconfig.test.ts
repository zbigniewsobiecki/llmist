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
import { ConfigError, getConfigPath, loadConfig } from "./config.js";

describe("loadConfig", () => {
  function loadText(text: string) {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(text);
    return loadConfig();
  }

  it("loads comments and an empty configuration", () => {
    expect(loadText("# A comment-only configuration\n")).toEqual({});
  });

  it("preserves omitted optional settings", () => {
    const config = loadText('[agent]\nmodel = "openai:gpt-4o"\n');
    expect(config.agent?.model).toBe("openai:gpt-4o");
    expect(config.agent).not.toHaveProperty("temperature");
  });

  it.each([
    ["literal", "'Hello 世界 \\n'", "Hello 世界 \\n"],
    ["basic", '"Hello 世界 \\nnext"', "Hello 世界 \nnext"],
  ])("parses literal and escaped basic strings (%s)", (_kind, source, expected) => {
    expect(loadText(`[agent]\nsystem = ${source}\n`).agent?.system).toBe(expected);
  });

  it("preserves multiline content and line continuation", () => {
    const source = '[agent]\nsystem = """\nHello\\\n    世界\nnext"""\n';
    expect(loadText(source).agent?.system).toBe("Hello世界\nnext");
  });

  it("parses arrays and nested command settings", () => {
    const config = loadText(`[agent]
gadgets = ["Calculator", "ReadFile"]
[agent.retry]
enabled = true
retries = 3
min-timeout = 100
`);
    expect(config.agent?.gadgets).toEqual(["Calculator", "ReadFile"]);
    expect(config.agent?.retry).toEqual({ enabled: true, retries: 3, "min-timeout": 100 });
  });

  it("resolves inherited TOML settings with child overrides", () => {
    const config = loadText(`[agent]
model = "openai:gpt-4o"
temperature = 0.3
[my-command]
type = "agent"
inherits = "agent"
temperature = 0.7
`);
    expect(config["my-command"]).toMatchObject({ model: "openai:gpt-4o", temperature: 0.7 });
    expect(config.agent?.temperature).toBe(0.3);
  });

  it("resolves prompt includes after TOML inheritance", () => {
    const config = loadText(`[prompts]
greeting = "Hello 世界"
[agent]
system = '<%~ include("@greeting") %>'
[my-command]
type = "agent"
inherits = "agent"
`);
    expect(config["my-command"]).toMatchObject({ system: "Hello 世界" });
  });

  it("reports malformed TOML with its config path", () => {
    expect(() => loadText('[agent]\nsystem = "unterminated\n')).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow("Invalid TOML syntax");
    expect(() => loadConfig()).toThrow(getConfigPath());
  });

  it("validates parsed TOML before resolving it", () => {
    expect(() => loadText('[complete]\nunknown-field = "bad"\n')).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow("unknown-field");
    expect(() => loadConfig()).toThrow(getConfigPath());
  });

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
