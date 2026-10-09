import { describe, expect, test } from "bun:test";

import type { Rule } from "./rules";
import { RULES, rules, scanRule, shannonEntropy } from "./rules";

function byId(id: string): Rule {
  const rule = RULES.find((entry) => entry.id === id);

  if (rule === undefined) {
    throw new Error(`Missing rule ${id}.`);
  }

  return rule;
}

function matches(id: string, text: string): boolean {
  return scanRule(byId(id), text).length > 0;
}

describe("secret rules", () => {
  test("private keys", () => {
    expect(matches("private-key", "-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(matches("private-key", "-----BEGIN CERTIFICATE-----")).toBe(false);
  });

  test("aws access keys", () => {
    expect(matches("aws-access-key", "AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(matches("aws-access-key", "AKIA123")).toBe(false);
  });

  test("github tokens", () => {
    expect(matches("github-token", `ghp_${"a".repeat(36)}`)).toBe(true);
    expect(matches("github-token", "ghp_short")).toBe(false);
  });

  test("slack tokens", () => {
    expect(matches("slack-token", "xoxb-123456789012-abc")).toBe(true);
    expect(matches("slack-token", "xoxz-123")).toBe(false);
  });

  test("stripe keys", () => {
    expect(matches("stripe-key", "sk_live_4eC39HqLyjWDarjtT1zdp7dc")).toBe(true);
    expect(matches("stripe-key", "sk_test_short")).toBe(false);
  });

  test("google api keys", () => {
    expect(matches("google-api-key", `AIza${"A".repeat(35)}`)).toBe(true);
    expect(matches("google-api-key", "AIzaShort")).toBe(false);
  });

  test("openai-style keys", () => {
    expect(matches("openai-style-key", "OPENAI_API_KEY=sk-fixture-0000000000000000000000000000000000000000")).toBe(true);
    expect(matches("openai-style-key", "sk-short")).toBe(false);
  });

  test("jwt", () => {
    expect(matches("jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")).toBe(
      true,
    );
    expect(matches("jwt", "eyJ-invalid")).toBe(false);
  });

  test("credential assignments", () => {
    expect(matches("credential-assignment", 'password="hunter2"')).toBe(true);
    expect(matches("credential-assignment", "the password is hunter2")).toBe(false);
  });

  test("connection strings need credentials", () => {
    expect(matches("connection-string", "postgres://user:pass@localhost/db")).toBe(true);
    expect(matches("connection-string", "postgres://localhost/db")).toBe(false);
  });

  test("dotenv high-entropy values", () => {
    expect(matches("dotenv-high-entropy", "API_SECRET_KEY=aB3xK9mQ2vL8nP4wR6tY7zA")).toBe(true);
    expect(matches("dotenv-high-entropy", "DEBUG=true")).toBe(false);
    expect(matches("dotenv-high-entropy", "WORD=production")).toBe(false);
  });
});

describe("internal-infra rules", () => {
  test("private ipv4 ranges", () => {
    expect(matches("private-ipv4", "connect to 10.0.0.5 please")).toBe(true);
    expect(matches("private-ipv4", "the ip is 192.168.1.1")).toBe(true);
    expect(matches("private-ipv4", "server at 8.8.8.8")).toBe(false);
    expect(matches("private-ipv4", "host 172.32.0.1 here")).toBe(false);
  });

  test("internal hostnames", () => {
    expect(matches("internal-hostname", "deploy to staging.acme.dev")).toBe(true);
    expect(matches("internal-hostname", "db.internal is down")).toBe(true);
    expect(matches("internal-hostname", "see example.com")).toBe(false);
    expect(matches("internal-hostname", "the development process")).toBe(false);
  });
});

describe("pii rules", () => {
  test("email", () => {
    expect(matches("email", "mail jane.doe@example.com today")).toBe(true);
    expect(matches("email", "no email here")).toBe(false);
  });

  test("international phone", () => {
    expect(matches("phone", "call +63 917 123 4567")).toBe(true);
    expect(matches("phone", "room 12345")).toBe(false);
  });

  test("credit card with luhn", () => {
    expect(matches("credit-card", "card 4111 1111 1111 1111")).toBe(true);
    expect(matches("credit-card", "card 4111 1111 1111 1112")).toBe(false);
  });

  test("iban with checksum", () => {
    expect(matches("iban", "IBAN DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(matches("iban", "IBAN DE00 3704 0044 0532 0130 00")).toBe(false);
  });
});

describe("shannonEntropy", () => {
  test("random values score higher than words", () => {
    expect(shannonEntropy("aB3xK9mQ2vL8nP4wR6tY7zA") > shannonEntropy("production")).toBe(true);
  });
});

describe("rules", () => {
  test("uses the rule method for text and ocr-rule for ocr text", async () => {
    const text = await rules({ fileId: "f1", fileName: "notes.md", text: "mail jane.doe@example.com", ocrWords: null });

    expect(text).toHaveLength(1);
    expect(text[0]?.detections[0]?.method).toBe("rule");

    const ocr = await rules({
      fileId: "f2",
      fileName: "shot.png",
      text: "mail jane.doe@example.com",
      ocrWords: [
        { text: "mail", box: { x: 0, y: 0, w: 30, h: 10 }, confidence: 90, line: 0 },
        { text: "jane.doe@example.com", box: { x: 35, y: 0, w: 150, h: 10 }, confidence: 88, line: 0 },
      ],
    });

    expect(ocr).toHaveLength(1);
    expect(ocr[0]?.detections[0]?.method).toBe("ocr-rule");
    expect(ocr[0]?.detections[0]?.evidence[0]?.type).toBe("image-region");
  });

  test("reports text spans with line numbers", async () => {
    const found = await rules({ fileId: "f1", fileName: "notes.md", text: "line one\nAKIAIOSFODNN7EXAMPLE", ocrWords: null });
    const evidence = found[0]?.detections[0]?.evidence[0];

    expect(evidence).toEqual({
      type: "text-span",
      start: 9,
      end: 29,
      line: 1,
      quote: "AKIAIOSFODNN7EXAMPLE",
    });
  });
});
