import { expect, test } from "bun:test";

import { columnName, columnNumber, normalizeText } from "./utils";

test("column names and numbers round-trip", () => {
  expect(columnName(1)).toBe("A");
  expect(columnName(26)).toBe("Z");
  expect(columnName(27)).toBe("AA");
  expect(columnName(702)).toBe("ZZ");
  expect(columnName(703)).toBe("AAA");
  expect(columnNumber("A")).toBe(1);
  expect(columnNumber("AA")).toBe(27);

  for (const n of [1, 25, 26, 27, 52, 53, 702, 703, 16384]) {
    expect(columnNumber(columnName(n))).toBe(n);
  }
});

test("normalizeText trims, collapses whitespace and lowercases", () => {
  expect(normalizeText("  Foo \n\t BAR ")).toBe("foo bar");
});
