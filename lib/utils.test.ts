import { expect, test } from "bun:test";

import { columnName, columnNumber, containsWord, decodeXmlEntities, normalizeText } from "./utils";

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

test("containsWord needs a word boundary on the sides where the needle has a letter or digit", () => {
  expect(containsWord("the annual plan", "annual")).toBe(true);
  expect(containsWord("planning", "ann")).toBe(false);
  expect(containsWord("/type /page", "page")).toBe(true);
  expect(containsWord("pages", "page")).toBe(false);
  expect(containsWord("xplanning ann.", "ann")).toBe(true);
  expect(containsWord("call x+1 555", "+1 555")).toBe(true);
  expect(containsWord("ab", "")).toBe(false);
});

test("decodeXmlEntities decodes named and numeric entities", () => {
  expect(decodeXmlEntities("Tom &amp; Jerry &lt;b&gt; &quot;x&quot; &apos;y&apos; &#65;&#x42;")).toBe("Tom & Jerry <b> \"x\" 'y' AB");
  expect(decodeXmlEntities("&AMP;")).toBe("&");
});
