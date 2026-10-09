import type { DetectLayer } from "@/lib/contract/interfaces";

import { merge } from "./merge";
import { ocr } from "./ocr";
import { applyProfile } from "./profile";
import { protectedTerms } from "./protected-terms";
import { findRelatedExact, inconsistentRedactions } from "./related";
import { rules } from "./rules";
import { structure } from "./structure";

// The Stream 2 detection layers behind the contract interfaces (KTD2).
// lib/server/layers.ts picks this bundle; nothing else imports lib/detect.

export const detectLayer: DetectLayer = {
  structure,
  ocr,
  rules,
  protectedTerms,
  applyProfile,
  merge,
  findRelatedExact,
  inconsistentRedactions,
};
