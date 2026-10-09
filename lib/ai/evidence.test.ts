import { expect, test } from "bun:test";
import type { EffectiveSettings } from "@/lib/contract/interfaces";
import type { Locality, OcrWord } from "@/lib/contract/schemas";
import { classifyLocality } from "./locality";
import { matchQuote } from "./quotes";

const settings: EffectiveSettings = {
  baseUrl: "http://localhost/v1",
  provider: "openai-compatible",
  apiKey: null,
  textModel: null,
  visionModel: null,
  timeoutMs: 1000,
};

test("locality covers loopback, private, Tailscale, IPv6 and public boundaries", () => {
  const hosts = new Map<string, Locality>([
    ["localhost", "local"],
    ["127.42.0.1", "local"],
    ["[::1]", "local"],
    ["10.0.0.1", "lan"],
    ["172.16.0.1", "lan"],
    ["172.31.255.255", "lan"],
    ["192.168.1.1", "lan"],
    ["100.64.0.1", "lan"],
    ["100.101.1.5", "lan"],
    ["100.127.255.255", "lan"],
    ["[fc00::1]", "lan"],
    ["[fdff::1]", "lan"],
    ["gpu.local", "lan"],
    ["172.15.0.1", "remote"],
    ["172.32.0.1", "remote"],
    ["100.63.255.255", "remote"],
    ["100.128.0.1", "remote"],
    ["[fe80::1]", "remote"],
    ["example.com", "remote"],
    ["localhost.example.com", "remote"],
  ]);

  for (const [host, locality] of hosts) {
    expect(classifyLocality({ settings: { ...settings, baseUrl: `http://${host}/v1` } })).toBe(
      locality,
    );
  }

  expect(classifyLocality({ settings: { ...settings, provider: "mock" } })).toBe("mock");
});

test("exact quotes retain all source spans and zero-based line numbers", () => {
  expect(matchQuote("Project Juniper", "Hi\r\nProject Juniper\nProject Juniper", null)).toEqual([
    { type: "text-span", start: 4, end: 19, line: 1, quote: "Project Juniper" },
    { type: "text-span", start: 20, end: 35, line: 2, quote: "Project Juniper" },
  ]);
});

test("normalized quotes preserve exact offsets, case and source whitespace (AE1)", () => {
  expect(matchQuote("project  juniper", "x Project\tJuniper y", null)).toEqual([
    { type: "text-span", start: 2, end: 17, line: 0, quote: "Project\tJuniper" },
  ]);
  expect(matchQuote("imagined phrase", "Project Juniper", null)).toEqual([]);
  expect(matchQuote("   ", "Project Juniper", null)).toEqual([]);
});

test("OCR sequence matching unions boxes per line and returns every occurrence", () => {
  const words: OcrWord[] = [
    { text: "Project", line: 0, confidence: 95, box: { x: 10, y: 5, w: 30, h: 10 } },
    { text: "Juniper", line: 1, confidence: 95, box: { x: 3, y: 20, w: 35, h: 12 } },
    { text: "Project", line: 2, confidence: 95, box: { x: 10, y: 40, w: 30, h: 10 } },
    { text: "Juniper", line: 2, confidence: 95, box: { x: 45, y: 40, w: 35, h: 12 } },
  ];

  expect(matchQuote("project  juniper", "", words)).toEqual([
    { type: "image-region", box: { x: 10, y: 5, w: 30, h: 10 }, quote: "Project" },
    { type: "image-region", box: { x: 3, y: 20, w: 35, h: 12 }, quote: "Juniper" },
    { type: "image-region", box: { x: 10, y: 40, w: 70, h: 12 }, quote: "Project Juniper" },
  ]);
  expect(matchQuote("missing", "missing", words)).toEqual([]);
});
