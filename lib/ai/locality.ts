import { isIP } from "node:net";
import type { ConnectionInput } from "@/lib/contract/interfaces";
import type { Locality } from "@/lib/contract/schemas";

export function classifyLocality({ settings }: ConnectionInput): Locality {
  if (settings.provider === "mock") return "mock";

  // Settings accept any nonempty string; unusable endpoints cannot imply locality.
  if (!URL.canParse(settings.baseUrl)) return "remote";

  const host = new URL(settings.baseUrl).hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");

  if (host === "localhost" || host === "::1") return "local";

  if (host.endsWith(".local")) return "lan";

  if (isIP(host) === 4) {
    const [first, second] = host.split(".").map(Number);

    if (first === 127) return "local";

    if (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    )
      return "lan";
  }

  if (isIP(host) === 6 && /^(fc|fd)[0-9a-f]{2}:/.test(host)) return "lan";

  return "remote";
}
