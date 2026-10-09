import { fixtureProfiles } from "@/lib/contract/fixtures";
import type { RecipientProfile } from "@/lib/contract/schemas";

// The three profile presets from overview section 22 (plan R19), exported
// as seed data. The table lives in the contract fixtures so Stream 1 and
// Stream 2 share one source.

export const profilePresets: RecipientProfile[] = fixtureProfiles;
