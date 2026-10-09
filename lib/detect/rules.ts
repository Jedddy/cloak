import type { TextInput } from "@/lib/contract/interfaces";
import type { Category, FindingCandidate } from "@/lib/contract/schemas";

import { candidateForHits, ocrWordOffsets } from "./evidence";
import { findInjectionRanges, findZeroWidthRanges } from "./structure";

// Rules layer (overview section 11 layer 2, plan R9-R12). Regex plus
// validation. Each rule carries its id, category, title, and reason, and
// has positive and negative tests in rules.test.ts.

export type RuleValidator = (match: string) => boolean;

export type Rule = {
  id: string;
  category: Category;
  title: string;
  reason: string;
  /** Source without flags; scanned case-sensitively unless insensitive is set. */
  source: string;
  insensitive: boolean;
  multiline?: boolean;
  validate: RuleValidator;
};

function always(): RuleValidator {
  return () => true;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;

    if (double) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

function ibanValid(match: string): boolean {
  const compact = match.replaceAll(" ", "");

  if (compact.length < 15 || compact.length > 32) {
    return false;
  }

  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;

  for (const char of rearranged) {
    const code = char.charCodeAt(0);

    if (code >= 48 && code <= 57) {
      remainder = (remainder * 10 + (code - 48)) % 97;
    } else if (code >= 65 && code <= 90) {
      const value = code - 55;
      remainder = (remainder * 100 + value) % 97;
    } else {
      return false;
    }
  }

  return remainder === 1;
}

function privateIpv4Valid(match: string): boolean {
  const parts = match.split(".");

  if (parts.length !== 4) {
    return false;
  }

  const first = Number(parts[0]);

  const restValid = parts.slice(1).every((part) => {
    if (part.length === 0 || part.length > 3) {
      return false;
    }

    let digitsOnly = true;

    for (const char of part) {
      if (char < "0" || char > "9") {
        digitsOnly = false;
      }
    }

    if (digitsOnly === false) {
      return false;
    }

    const value = Number(part);

    return value >= 0 && value <= 255;
  });

  if (restValid === false) {
    return false;
  }

  if (first === 10 || first === 192) {
    return true;
  }

  if (first === 172) {
    const second = Number(parts[1]);

    return second >= 16 && second <= 31;
  }

  return false;
}

const infraKeywords: ReadonlySet<string> = new Set(["internal", "staging", "dev", "corp", "local", "localhost"]);

function internalHostnameValid(match: string): boolean {
  const lower = match.toLowerCase();

  return lower
    .split(".")
    .flatMap((label) => label.split("-"))
    .some((part) => infraKeywords.has(part));
}

function phoneValid(match: string): boolean {
  let digits = 0;

  for (const char of match) {
    if (char >= "0" && char <= "9") {
      digits += 1;
    }
  }

  return digits >= 7 && digits <= 15;
}

function connectionStringValid(match: string): boolean {
  const schemeEnd = match.indexOf("://");

  if (schemeEnd === -1) {
    return false;
  }

  const after = match.slice(schemeEnd + 3);
  const atSign = after.indexOf("@");

  if (atSign === -1) {
    return false;
  }

  return after.slice(0, atSign).includes(":");
}

/** Shannon entropy per character of a value. */
export function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();

  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let entropy = 0;

  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

function dotenvEntropyValid(match: string): boolean {
  const equals = match.indexOf("=");

  if (equals === -1) {
    return false;
  }

  const value = match.slice(equals + 1).replaceAll('"', "").replaceAll("'", "").trim();

  if (value.length < 20) {
    return false;
  }

  return shannonEntropy(value) >= 4.0;
}

export const RULES: readonly Rule[] = [
  {
    id: "private-key",
    category: "secret",
    title: "Private key",
    reason: "This private key gives full access to whatever it protects.",
    source: "-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----",
    insensitive: false,
    validate: always(),
  },
  {
    id: "aws-access-key",
    category: "secret",
    title: "AWS access key",
    reason: "This AWS key can give access to cloud resources and data.",
    source: "AKIA[0-9A-Z]{16}",
    insensitive: false,
    validate: always(),
  },
  {
    id: "github-token",
    category: "secret",
    title: "GitHub token",
    reason: "This token can give access to source code repositories.",
    source: "(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})",
    insensitive: false,
    validate: always(),
  },
  {
    id: "slack-token",
    category: "secret",
    title: "Slack token",
    reason: "This token can give access to chat history and workspaces.",
    source: "xox[bpas]-[A-Za-z0-9-]{10,}",
    insensitive: false,
    validate: always(),
  },
  {
    id: "stripe-key",
    category: "secret",
    title: "Stripe key",
    reason: "This key can move money and read customer payment data.",
    source: "(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
    insensitive: false,
    validate: always(),
  },
  {
    id: "google-api-key",
    category: "secret",
    title: "Google API key",
    reason: "This key can be used to call Google services on your behalf.",
    source: "AIza[0-9A-Za-z\\-_]{35}",
    insensitive: false,
    validate: always(),
  },
  {
    id: "openai-style-key",
    category: "secret",
    title: "Possible access token",
    reason: "This can give access to an account.",
    source: "sk-[A-Za-z0-9-]{20,}",
    insensitive: false,
    validate: always(),
  },
  {
    id: "jwt",
    category: "secret",
    title: "JSON web token",
    reason: "This token can give access to an account or session.",
    source: "eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
    insensitive: false,
    validate: always(),
  },
  {
    id: "credential-assignment",
    category: "secret",
    title: "Hardcoded credential",
    reason: "A password, secret, or token is written directly in the file.",
    source: "(?:password|passwd|pwd|secret|token|api[_-]?key)\\s*[:=]\\s*[\"']?[^\\s\"'\\n;]{4,}",
    insensitive: true,
    validate: always(),
  },
  {
    id: "connection-string",
    category: "secret",
    title: "Connection string with credentials",
    reason: "This connection string contains a username and password.",
    source: "(?:postgres|postgresql|mysql|mongodb|redis|amqp)://[^\\s\"'\\n]+",
    insensitive: true,
    validate: connectionStringValid,
  },
  {
    id: "dotenv-high-entropy",
    category: "secret",
    title: "High-entropy secret value",
    reason: "This configured value looks randomly generated, like a secret.",
    source: "^[A-Z][A-Z0-9_]{2,}=[^\\n]{8,}$",
    insensitive: false,
    multiline: true,
    validate: dotenvEntropyValid,
  },
  {
    id: "private-ipv4",
    category: "internal-infra",
    title: "Private IP address",
    reason: "This address reveals internal network layout.",
    source: "\\b(?:10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3})\\b",
    insensitive: false,
    validate: privateIpv4Valid,
  },
  {
    id: "internal-hostname",
    category: "internal-infra",
    title: "Internal hostname",
    reason: "This hostname reveals internal infrastructure.",
    source: "\\b[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\b",
    insensitive: true,
    validate: internalHostnameValid,
  },
  {
    id: "email",
    category: "personal-contact",
    title: "Email address",
    reason: "This email address identifies a person.",
    source: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b",
    insensitive: false,
    validate: always(),
  },
  {
    id: "phone",
    category: "personal-contact",
    title: "Phone number",
    reason: "This phone number identifies a person.",
    source: "\\+[0-9][0-9\\s().-]{7,}[0-9]",
    insensitive: false,
    validate: phoneValid,
  },
  {
    id: "credit-card",
    category: "personal-id",
    title: "Card number",
    reason: "This looks like a payment card number.",
    source: "\\b(?:\\d[ -]?){13,19}\\b",
    insensitive: false,
    validate: (match: string) => {
      const digits = match.replaceAll(" ", "").replaceAll("-", "");

      if (digits.length < 13 || digits.length > 19) {
        return false;
      }

      return luhnValid(digits);
    },
  },
  {
    id: "iban",
    category: "personal-id",
    title: "Bank account number",
    reason: "This looks like an international bank account number.",
    source: "\\b[A-Z]{2}[0-9]{2}[A-Z0-9 ]{11,28}\\b",
    insensitive: false,
    validate: ibanValid,
  },
];

export type TextHit = {
  ruleId: string;
  start: number;
  end: number;
  quote: string;
};

export function scanRule(rule: Rule, text: string): TextHit[] {
  let flags = "gu";

  if (rule.insensitive) {
    flags += "i";
  }

  if (rule.multiline === true) {
    flags += "m";
  }

  const pattern = new RegExp(rule.source, flags);
  const hits: TextHit[] = [];
  let match = pattern.exec(text);

  while (match !== null) {
    const quote = match[0];
    const start = match.index;

    if (rule.validate(quote)) {
      hits.push({ ruleId: rule.id, start, end: start + quote.length, quote });

      if (hits.length >= 50) {
        return hits;
      }
    }

    if (quote.length === 0) {
      pattern.lastIndex += 1;
    }

    match = pattern.exec(text);
  }

  return hits;
}

export function rules(input: TextInput): Promise<FindingCandidate[]> {
  const candidates: FindingCandidate[] = [];
  const method = input.ocrWords === null ? "rule" : "ocr-rule";
  const offsets = input.ocrWords === null ? [] : ocrWordOffsets(input.ocrWords);

  const pushTextHits = (rule: Rule, hits: TextHit[]): void => {
    const found = candidateForHits({
      fileId: input.fileId,
      text: input.text,
      offsets,
      method,
      ruleId: rule.id,
      category: rule.category,
      title: rule.title,
      reason: rule.reason,
      relatedGroupId: null,
      hits,
    });

    if (found !== null) {
      candidates.push(found);
    }
  };

  for (const rule of RULES) {
    pushTextHits(rule, scanRule(rule, input.text));
  }

  // Zero-width and instruction-like text in OCR text is reported here with
  // the ocr-rule method; for text files the structure layer reports it and
  // merge joins the two detections (plan R7, R8).
  const hiddenRule: Rule = {
    id: "zero-width-chars",
    category: "hidden-data",
    title: "Hidden characters in text",
    reason: "The text contains invisible characters that can hide content.",
    source: "",
    insensitive: false,
    validate: always(),
  };

  pushTextHits(
    hiddenRule,
    findZeroWidthRanges(input.text).map((range) => ({
      ruleId: hiddenRule.id,
      start: range.start,
      end: range.end,
      quote: input.text.slice(range.start, range.end),
    })),
  );

  const injectionRule: Rule = {
    id: "prompt-injection",
    category: "prompt-injection",
    title: "Possible prompt injection",
    reason: "The text tries to instruct an AI. It is reported and never followed.",
    source: "",
    insensitive: false,
    validate: always(),
  };

  pushTextHits(
    injectionRule,
    findInjectionRanges(input.text).map((range) => ({
      ruleId: injectionRule.id,
      start: range.start,
      end: range.end,
      quote: input.text.slice(range.start, range.end),
    })),
  );

  return Promise.resolve(candidates);
}
