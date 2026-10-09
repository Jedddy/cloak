import { describe, expect, test } from "bun:test";

import { redactText } from "./text";

describe("redactText", () => {
  test("replaces spans with the placeholder", () => {
    expect(redactText({ fileName: "notes.md", content: "hello secret world", spans: [{ start: 6, end: 12, category: "secret" }] })).toBe(
      "hello [REDACTED] world",
    );
  });

  test("keeps the key and replaces only the value in env files", () => {
    expect(
      redactText({ fileName: ".env.example", content: "API_KEY=sk-123\nDEBUG=true", spans: [{ start: 8, end: 14, category: "secret" }] }),
    ).toBe("API_KEY=[REDACTED]\nDEBUG=true");
  });

  test("merges overlapping spans into one placeholder", () => {
    expect(
      redactText({
        fileName: "notes.md",
        content: "abcdefgh",
        spans: [
          { start: 1, end: 4, category: "secret" },
          { start: 3, end: 6, category: "secret" },
        ],
      }),
    ).toBe("a[REDACTED]gh");
  });

  test("keeps line endings and skips empty or out-of-range spans", () => {
    expect(
      redactText({
        fileName: "notes.md",
        content: "a\r\nb",
        spans: [
          { start: 0, end: 1, category: "secret" },
          { start: 2, end: 2, category: "secret" },
          { start: 90, end: 100, category: "secret" },
        ],
      }),
    ).toBe("[REDACTED]\r\nb");
  });

  test("keeps carriage returns when redacting env values", () => {
    expect(
      redactText({ fileName: ".env", content: "API_KEY=sk-123\r\nDEBUG=true", spans: [{ start: 8, end: 14, category: "secret" }] }),
    ).toBe("API_KEY=[REDACTED]\r\nDEBUG=true");
  });

  test("leaves non-assignment env lines to span replacement", () => {
    expect(redactText({ fileName: ".env", content: "# just a comment", spans: [{ start: 2, end: 6, category: "other" }] })).toBe(
      "# [REDACTED] a comment",
    );
  });
});
