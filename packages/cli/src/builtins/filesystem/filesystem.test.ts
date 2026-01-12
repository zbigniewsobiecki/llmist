import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs module
vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    lstatSync: vi.fn(),
    statSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    realpathSync: vi.fn(),
  },
}));

import { listDirectory } from "./list-directory.js";
import { readFile } from "./read-file.js";
// Import after mocking
import { PathSandboxException, validatePathIsWithinCwd } from "./utils.js";
import { writeFile } from "./write-file.js";

describe("filesystem utils", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.cwd() to return a consistent path
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validatePathIsWithinCwd", () => {
    it("should accept paths within CWD", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => String(p));

      const result = validatePathIsWithinCwd("src/index.ts");
      expect(result).toBe("/home/user/project/src/index.ts");
    });

    it("should accept CWD itself", () => {
      vi.mocked(fs.realpathSync).mockImplementation(() => "/home/user/project");

      const result = validatePathIsWithinCwd(".");
      expect(result).toBe("/home/user/project");
    });

    it("should reject paths outside CWD", () => {
      vi.mocked(fs.realpathSync).mockImplementation(() => "/home/user/other");

      expect(() => validatePathIsWithinCwd("../other")).toThrow(PathSandboxException);
      expect(() => validatePathIsWithinCwd("../other")).toThrow("Path is outside");
    });

    it("should reject directory traversal attempts", () => {
      vi.mocked(fs.realpathSync).mockImplementation(() => "/home/user");

      expect(() => validatePathIsWithinCwd("../")).toThrow(PathSandboxException);
    });

    it("should handle non-existent paths", () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      vi.mocked(fs.realpathSync).mockImplementation(() => {
        throw error;
      });

      // Should use resolved path for validation when file doesn't exist
      const result = validatePathIsWithinCwd("new-file.txt");
      expect(result).toBe("/home/user/project/new-file.txt");
    });

    it("should re-throw permission errors", () => {
      const error = new Error("EACCES") as NodeJS.ErrnoException;
      error.code = "EACCES";
      vi.mocked(fs.realpathSync).mockImplementation(() => {
        throw error;
      });

      expect(() => validatePathIsWithinCwd("restricted")).toThrow("EACCES");
    });

    it("should handle symlinks that point outside CWD", () => {
      // Symlink resolves to path outside CWD
      vi.mocked(fs.realpathSync).mockImplementation(() => "/etc/passwd");

      expect(() => validatePathIsWithinCwd("dangerous-link")).toThrow(PathSandboxException);
    });
  });

  describe("PathSandboxException", () => {
    it("should have correct name and message", () => {
      const error = new PathSandboxException("../etc/passwd", "Path is outside the CWD");

      expect(error.name).toBe("PathSandboxException");
      expect(error.message).toContain("../etc/passwd");
      expect(error.message).toContain("Path is outside the CWD");
    });
  });
});

describe("ReadFile gadget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");
    vi.mocked(fs.realpathSync).mockImplementation((p) => String(p));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should read file content successfully", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("file content here");

    const result = readFile.execute({ filePath: "test.txt" });

    expect(result).toBe("path=test.txt\n\nfile content here");
    expect(fs.readFileSync).toHaveBeenCalledWith("/home/user/project/test.txt", "utf-8");
  });

  it("should read nested file paths", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("nested content");

    const result = readFile.execute({ filePath: "src/components/Button.tsx" });

    expect(result).toContain("path=src/components/Button.tsx");
    expect(result).toContain("nested content");
  });

  it("should throw for paths outside CWD", () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => "/etc/passwd");

    expect(() => readFile.execute({ filePath: "../../../etc/passwd" })).toThrow(
      PathSandboxException,
    );
  });

  it("should handle empty files", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("");

    const result = readFile.execute({ filePath: "empty.txt" });

    expect(result).toBe("path=empty.txt\n\n");
  });

  it("should have correct gadget metadata", () => {
    expect(readFile.name).toBe("ReadFile");
    expect(readFile.description).toContain("Read the entire content");
    expect(readFile.examples).toBeDefined();
    expect(readFile.examples!.length).toBeGreaterThan(0);
  });
});

describe("WriteFile gadget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");
    vi.mocked(fs.realpathSync).mockImplementation((p) => String(p));
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should write content to file", () => {
    const result = writeFile.execute({
      filePath: "output.txt",
      content: "Hello, World!",
    });

    expect(result).toBe("path=output.txt\n\nWrote 13 bytes");
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/home/user/project/output.txt",
      "Hello, World!",
      "utf-8",
    );
  });

  it("should create parent directories if needed", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = writeFile.execute({
      filePath: "new/nested/dir/file.txt",
      content: "content",
    });

    expect(result).toContain("Wrote 7 bytes");
    expect(result).toContain("created directory");
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it("should not mention directory creation for existing parents", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = writeFile.execute({
      filePath: "existing/file.txt",
      content: "data",
    });

    expect(result).toBe("path=existing/file.txt\n\nWrote 4 bytes");
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it("should throw for paths outside CWD", () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => "/tmp/malicious");

    expect(() =>
      writeFile.execute({
        filePath: "../../../tmp/malicious",
        content: "bad",
      }),
    ).toThrow(PathSandboxException);
  });

  it("should handle UTF-8 content correctly", () => {
    const unicodeContent = "Hello 世界 🌍";

    const result = writeFile.execute({
      filePath: "unicode.txt",
      content: unicodeContent,
    });

    // Buffer.byteLength counts UTF-8 bytes correctly
    // "Hello " = 6, "世界" = 6 (3 each), " " = 1, "🌍" = 4 → Total = 17 bytes
    expect(result).toContain("Wrote 17 bytes");
  });

  it("should have correct gadget metadata", () => {
    expect(writeFile.name).toBe("WriteFile");
    expect(writeFile.description).toContain("Write content to a file");
    expect(writeFile.examples).toBeDefined();
  });
});

describe("ListDirectory gadget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");
    vi.mocked(fs.realpathSync).mockImplementation((p) => String(p));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should list directory contents", () => {
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.mocked(fs.readdirSync).mockReturnValue(["file.txt", "src"] as unknown as fs.Dirent[]);
    vi.mocked(fs.lstatSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.endsWith("src")) {
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
          size: 0,
          mtime: new Date(),
        } as fs.Stats;
      }
      return {
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 1024,
        mtime: new Date(),
      } as fs.Stats;
    });

    const result = listDirectory.execute({ directoryPath: ".", maxDepth: 1 });

    expect(result).toContain("path=.");
    expect(result).toContain("maxDepth=1");
    expect(result).toContain("#T|N|S|A"); // Header
    expect(result).toContain("D|src"); // Directory
    expect(result).toContain("F|file.txt"); // File
  });

  it("should return #empty for empty directories", () => {
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    const result = listDirectory.execute({ directoryPath: "empty-dir", maxDepth: 1 });

    expect(result).toContain("#empty");
  });

  it("should identify symlinks", () => {
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.mocked(fs.readdirSync).mockReturnValue(["link"] as unknown as fs.Dirent[]);
    vi.mocked(fs.lstatSync).mockReturnValue({
      isDirectory: () => false,
      isSymbolicLink: () => true,
      size: 0,
      mtime: new Date(),
    } as fs.Stats);

    const result = listDirectory.execute({ directoryPath: ".", maxDepth: 1 });

    expect(result).toContain("L|link"); // Symlink type code
  });

  it("should recurse into subdirectories with maxDepth > 1", () => {
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);

    // First call lists root, second call lists subdir
    vi.mocked(fs.readdirSync)
      .mockReturnValueOnce(["subdir"] as unknown as fs.Dirent[])
      .mockReturnValueOnce(["nested.txt"] as unknown as fs.Dirent[]);

    vi.mocked(fs.lstatSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.endsWith("subdir")) {
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
          size: 0,
          mtime: new Date(),
        } as fs.Stats;
      }
      return {
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 100,
        mtime: new Date(),
      } as fs.Stats;
    });

    const result = listDirectory.execute({ directoryPath: ".", maxDepth: 2 });

    expect(result).toContain("maxDepth=2");
    expect(result).toContain("D|subdir");
    expect(result).toContain("F|subdir/nested.txt"); // Nested file with relative path
  });

  it("should throw for non-directory paths", () => {
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as fs.Stats);

    expect(() => listDirectory.execute({ directoryPath: "file.txt", maxDepth: 1 })).toThrow(
      "Path is not a directory",
    );
  });

  it("should throw for paths outside CWD", () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => "/etc");

    expect(() => listDirectory.execute({ directoryPath: "../../../etc", maxDepth: 1 })).toThrow(
      PathSandboxException,
    );
  });

  it("should handle inaccessible entries gracefully", () => {
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "accessible",
      "restricted",
    ] as unknown as fs.Dirent[]);

    let callCount = 0;
    vi.mocked(fs.lstatSync).mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        throw new Error("EACCES: permission denied");
      }
      return {
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 50,
        mtime: new Date(),
      } as fs.Stats;
    });

    const result = listDirectory.execute({ directoryPath: ".", maxDepth: 1 });

    // Should include accessible file, skip restricted
    expect(result).toContain("F|accessible");
    expect(result).not.toContain("restricted");
  });

  it("should sort entries: directories first, then files, then symlinks", () => {
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "file.txt",
      "link",
      "dir",
    ] as unknown as fs.Dirent[]);

    vi.mocked(fs.lstatSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.endsWith("dir")) {
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
          size: 0,
          mtime: new Date(),
        } as fs.Stats;
      }
      if (pathStr.endsWith("link")) {
        return {
          isDirectory: () => false,
          isSymbolicLink: () => true,
          size: 0,
          mtime: new Date(),
        } as fs.Stats;
      }
      return {
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 100,
        mtime: new Date(),
      } as fs.Stats;
    });

    const result = listDirectory.execute({ directoryPath: ".", maxDepth: 1 });
    const lines = result.split("\n");

    // Find data lines (after header)
    const dataLines = lines.filter((l) => l.match(/^[DFL]\|/));

    // Directory should come first
    expect(dataLines[0]).toMatch(/^D\|/);
    // File second
    expect(dataLines[1]).toMatch(/^F\|/);
    // Symlink last
    expect(dataLines[2]).toMatch(/^L\|/);
  });

  it("should encode special characters in names", () => {
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.mocked(fs.readdirSync).mockReturnValue(["file|with|pipes"] as unknown as fs.Dirent[]);
    vi.mocked(fs.lstatSync).mockReturnValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 10,
      mtime: new Date(),
    } as fs.Stats);

    const result = listDirectory.execute({ directoryPath: ".", maxDepth: 1 });

    // Pipes should be URL-encoded
    expect(result).toContain("file%7Cwith%7Cpipes");
  });

  it("should have correct gadget metadata", () => {
    expect(listDirectory.name).toBe("ListDirectory");
    expect(listDirectory.description).toContain("List files and directories");
    expect(listDirectory.examples).toBeDefined();
    expect(listDirectory.examples!.length).toBeGreaterThan(0);
  });
});
