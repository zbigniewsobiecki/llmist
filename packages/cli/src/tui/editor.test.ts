import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock node modules before importing the module under test
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { openEditorSync } from "./editor.js";

const mockSpawnSync = vi.mocked(spawnSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

describe("openEditorSync", () => {
  let savedVisual: string | undefined;
  let savedEditor: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Save env vars
    savedVisual = process.env.VISUAL;
    savedEditor = process.env.EDITOR;

    // Default mock: successful spawn, exit 0, returns content
    mockSpawnSync.mockReturnValue({ status: 0, error: undefined } as ReturnType<typeof spawnSync>);
    mockReadFileSync.mockReturnValue("edited content" as unknown as Buffer);
  });

  afterEach(() => {
    // Restore env vars
    if (savedVisual !== undefined) {
      process.env.VISUAL = savedVisual;
    } else {
      delete process.env.VISUAL;
    }
    if (savedEditor !== undefined) {
      process.env.EDITOR = savedEditor;
    } else {
      delete process.env.EDITOR;
    }
  });

  describe("happy path", () => {
    test("returns edited content when editor exits with status 0", () => {
      mockReadFileSync.mockReturnValue("hello world" as unknown as Buffer);
      const result = openEditorSync();
      expect(result).toBe("hello world");
    });

    test("returns trimmed content (strips surrounding whitespace)", () => {
      mockReadFileSync.mockReturnValue("  hello  \n" as unknown as Buffer);
      const result = openEditorSync();
      expect(result).toBe("hello");
    });

    test("writes initial content to temp file before spawning editor", () => {
      const initialContent = "starter text";
      openEditorSync(initialContent);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("llmist-input-"),
        initialContent,
        "utf-8",
      );
    });

    test("cleans up temp file after successful edit", () => {
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);
      openEditorSync();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    test("uses an empty string as default initial content", () => {
      openEditorSync();
      expect(mockWriteFileSync).toHaveBeenCalledWith(expect.any(String), "", "utf-8");
    });
  });

  describe("cancel / empty content", () => {
    test("returns null when editor exits with non-zero status", () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        error: undefined,
      } as ReturnType<typeof spawnSync>);
      expect(openEditorSync()).toBeNull();
    });

    test("returns null when edited content is empty after trim", () => {
      mockReadFileSync.mockReturnValue("   \n  " as unknown as Buffer);
      expect(openEditorSync()).toBeNull();
    });

    test("returns null when edited content is just whitespace", () => {
      mockReadFileSync.mockReturnValue("\t\n\r" as unknown as Buffer);
      expect(openEditorSync()).toBeNull();
    });

    test("cleans up temp file when editor cancels (non-zero exit)", () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        error: undefined,
      } as ReturnType<typeof spawnSync>);
      openEditorSync();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });
  });

  describe("spawn error handling", () => {
    test("returns null when spawnSync returns an error", () => {
      mockSpawnSync.mockReturnValue({
        status: null,
        error: new Error("spawn ENOENT"),
      } as ReturnType<typeof spawnSync>);
      expect(openEditorSync()).toBeNull();
    });

    test("cleans up temp file when spawn fails", () => {
      mockSpawnSync.mockReturnValue({
        status: null,
        error: new Error("spawn ENOENT"),
      } as ReturnType<typeof spawnSync>);
      openEditorSync();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    test("returns null when readFileSync throws (exception path)", () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT: file not found");
      });
      expect(openEditorSync()).toBeNull();
    });

    test("still tries to clean up temp file on exception", () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT: file not found");
      });
      openEditorSync();
      // unlinkSync should be attempted (inside the catch block's try)
      expect(mockUnlinkSync).toHaveBeenCalled();
    });
  });

  describe("editor precedence ($VISUAL / $EDITOR / vi)", () => {
    test("uses $VISUAL when set", () => {
      process.env.VISUAL = "emacs";
      delete process.env.EDITOR;
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);

      openEditorSync();

      expect(mockSpawnSync).toHaveBeenCalledWith("emacs", expect.any(Array), expect.any(Object));
    });

    test("uses $EDITOR when $VISUAL is not set", () => {
      delete process.env.VISUAL;
      process.env.EDITOR = "nano";
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);

      openEditorSync();

      expect(mockSpawnSync).toHaveBeenCalledWith("nano", expect.any(Array), expect.any(Object));
    });

    test("falls back to vi when neither $VISUAL nor $EDITOR is set", () => {
      delete process.env.VISUAL;
      delete process.env.EDITOR;
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);

      openEditorSync();

      expect(mockSpawnSync).toHaveBeenCalledWith("vi", expect.any(Array), expect.any(Object));
    });

    test("prefers $VISUAL over $EDITOR when both are set", () => {
      process.env.VISUAL = "emacs";
      process.env.EDITOR = "nano";
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);

      openEditorSync();

      expect(mockSpawnSync).toHaveBeenCalledWith("emacs", expect.any(Array), expect.any(Object));
    });
  });

  describe("command splitting (handles 'code --wait' style commands)", () => {
    test("splits editor command on whitespace and passes args separately", () => {
      process.env.VISUAL = "code --wait";
      delete process.env.EDITOR;
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);

      openEditorSync();

      const [cmd, args] = mockSpawnSync.mock.calls[0];
      expect(cmd).toBe("code");
      expect(args).toContain("--wait");
    });

    test("appends temp file path as last argument", () => {
      process.env.VISUAL = "code --wait";
      delete process.env.EDITOR;
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);

      openEditorSync();

      const [, args] = mockSpawnSync.mock.calls[0];
      const lastArg = (args as string[])[(args as string[]).length - 1];
      expect(lastArg).toContain("llmist-input-");
    });

    test("passes shell: false to spawnSync", () => {
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);

      openEditorSync();

      const [, , options] = mockSpawnSync.mock.calls[0];
      expect((options as { shell: boolean }).shell).toBe(false);
    });

    test("passes stdio: inherit to spawnSync", () => {
      mockReadFileSync.mockReturnValue("content" as unknown as Buffer);

      openEditorSync();

      const [, , options] = mockSpawnSync.mock.calls[0];
      expect((options as { stdio: string }).stdio).toBe("inherit");
    });
  });
});
