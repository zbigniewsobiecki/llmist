import { describe, expect, it } from "vitest";
import { format, formatBytes, formatDate, formatDuration, truncate } from "./format.js";

describe("truncate", () => {
  it("returns text unchanged if shorter than maxLength", () => {
    expect(truncate("Hello", 10)).toBe("Hello");
    expect(truncate("Short", 100)).toBe("Short");
  });

  it("returns text unchanged if exactly maxLength", () => {
    expect(truncate("Hello", 5)).toBe("Hello");
  });

  it("truncates text longer than maxLength", () => {
    expect(truncate("Hello, World!", 10)).toBe("Hello, ...");
    // "Long text here" (14 chars) -> maxLength 8 - suffix 3 = 5 chars + "..." = "Long ..."
    expect(truncate("Long text here", 8)).toBe("Long ...");
  });

  it("uses custom suffix", () => {
    expect(truncate("Hello, World!", 10, "…")).toBe("Hello, Wo…");
    // "Custom test" (11 chars) -> maxLength 6 - suffix 2 = 4 chars + ">>" = "Cust>>"
    expect(truncate("Custom test", 6, ">>")).toBe("Cust>>");
  });

  it("handles edge case when maxLength equals suffix length", () => {
    expect(truncate("Hello", 3)).toBe("...");
  });

  it("handles edge case when maxLength is less than suffix length", () => {
    expect(truncate("Hello", 2)).toBe("..");
    expect(truncate("Hello", 1)).toBe(".");
  });

  it("handles empty string", () => {
    expect(truncate("", 10)).toBe("");
  });
});

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2048)).toBe("2 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1 GB");
    expect(formatBytes(1610612736)).toBe("1.5 GB");
  });

  it("formats terabytes", () => {
    expect(formatBytes(1099511627776)).toBe("1 TB");
  });

  it("uses custom decimal places", () => {
    expect(formatBytes(1536, 2)).toBe("1.50 KB");
    expect(formatBytes(1536, 0)).toBe("2 KB");
  });

  it("omits decimals for whole numbers", () => {
    expect(formatBytes(1024, 2)).toBe("1 KB");
    expect(formatBytes(2048, 2)).toBe("2 KB");
  });
});

describe("formatDate", () => {
  it("formats ISO date string with default options", () => {
    const result = formatDate("2024-01-15T10:30:00Z");
    // Result varies by locale, but should contain year, month, day
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/Jan|1/); // Month varies by locale
    expect(result).toMatch(/15/);
  });

  it("uses custom format options", () => {
    const result = formatDate("2024-06-20T14:00:00Z", {
      year: "numeric",
      month: "long",
    });
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/June|Jun/);
  });

  it("returns 'Invalid Date' for invalid date strings", () => {
    // Note: new Date("invalid").toLocaleString() returns "Invalid Date"
    // The try-catch only catches exceptions, not invalid Date objects
    expect(formatDate("invalid")).toBe("Invalid Date");
    expect(formatDate("not-a-date")).toBe("Invalid Date");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(1)).toBe("1ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(2000)).toBe("2s");
    expect(formatDuration(5500)).toBe("5.5s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(120000)).toBe("2m");
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
    expect(formatDuration(3725000)).toBe("1h 2m 5s");
    expect(formatDuration(7200000)).toBe("2h 0m");
  });

  it("supports compact mode for hours", () => {
    expect(formatDuration(3725000, { compact: true })).toBe("1h 2m");
    expect(formatDuration(7325000, { compact: true })).toBe("2h 2m");
  });

  it("rounds milliseconds", () => {
    expect(formatDuration(1.5)).toBe("2ms");
    expect(formatDuration(999.9)).toBe("1000ms");
  });
});

describe("format namespace", () => {
  it("exports all formatting functions", () => {
    expect(format.truncate).toBe(truncate);
    expect(format.bytes).toBe(formatBytes);
    expect(format.date).toBe(formatDate);
    expect(format.duration).toBe(formatDuration);
  });

  it("can be used as a namespace", () => {
    expect(format.truncate("Test", 3)).toBe("...");
    expect(format.bytes(1024)).toBe("1 KB");
    expect(format.duration(5000)).toBe("5s");
  });
});
