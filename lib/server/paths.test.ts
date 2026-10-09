import { expect, test } from "bun:test";

import { assertSafeId, sanitizeExportName, storedExtension } from "./paths";

test("export names keep the file name and drop every folder part", () => {
  expect(sanitizeExportName("../../etc/passwd.txt")).toBe("passwd.txt");
  expect(sanitizeExportName("..\\..\\Windows\\win.ini")).toBe("win.ini");
  expect(sanitizeExportName(".env.example")).toBe(".env.example");
});

test("export names have no reserved characters or names", () => {
  expect(sanitizeExportName('a<b>:c"|?*.md')).toBe("a_b__c____.md");
  expect(sanitizeExportName("CON.txt")).toBe("_CON.txt");
  expect(sanitizeExportName("..")).toBe("file");
  expect(sanitizeExportName("notes.md. ")).toBe("notes.md");
});

test("stored extensions are short and alphanumeric", () => {
  expect(storedExtension("../../etc/passwd.txt")).toBe("txt");
  expect(storedExtension("Screenshot.PNG")).toBe("png");
  expect(storedExtension(".env.example")).toBe("env");
  expect(storedExtension("README")).toBe("");
  expect(storedExtension("x.t/../../a")).toBe("");
});

test("ids with path characters are rejected", () => {
  expect(() => assertSafeId("../x", "package")).toThrow();
  expect(() => assertSafeId("pkg-1", "package")).not.toThrow();
});
