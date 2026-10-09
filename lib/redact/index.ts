import type { RedactLayer } from "@/lib/contract/interfaces";

import { redactImage } from "./image";
import { redactText } from "./text";

// The Stream 2 redaction layer behind the contract interface (KTD2).
// lib/server/layers.ts picks this bundle; nothing else imports lib/redact.

export const redactLayer: RedactLayer = {
  image: redactImage,
  text: (input) => redactText(input),
};
