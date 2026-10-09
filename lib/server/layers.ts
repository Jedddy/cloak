import { aiLayer } from "@/lib/ai";
import type { Layers } from "@/lib/contract/interfaces";
import { detectLayer } from "@/lib/detect";
import { documentLayer } from "@/lib/document";
import { redactLayer } from "@/lib/redact";

// The one wiring point for the layer implementations (KTD2). This is the
// only file that may import lib/detect, lib/ai, lib/redact, or lib/document. All three
// streams are merged, so every layer here is the real implementation.
//
// Mock model behavior belongs to the AI layer (LLM_PROVIDER=mock), not here.

export const layers: Layers = {
  detect: detectLayer,
  ai: aiLayer,
  redact: redactLayer,
  document: documentLayer,
};
