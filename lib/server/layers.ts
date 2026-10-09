import type { Layers } from "@/lib/contract/interfaces";
import { stubLayers } from "@/lib/contract/stubs";

// The one wiring point for the layer implementations (KTD2). This is the
// only file that may import lib/detect, lib/ai, or lib/redact. When a
// stream merges, replace its stub here, one layer at a time, for example:
//
//   import { detectLayer } from "@/lib/detect";
//   detect: detectLayer,
//
// Mock model behavior belongs to the AI layer (LLM_PROVIDER=mock), not here.

export const layers: Layers = {
  detect: stubLayers.detect,
  ai: stubLayers.ai,
  redact: stubLayers.redact,
};
