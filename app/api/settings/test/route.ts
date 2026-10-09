import type { ConnectionTestResult } from "@/lib/contract/schemas";
import { respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { readEffectiveSettings } from "@/lib/server/settings";

/** Tests the saved settings: models, JSON test, latency, locality, and the mode a scan would use. */
export async function POST() {
  return respond(async () => {
    const settings = await readEffectiveSettings();

    const [result, preview] = await Promise.all([
      layers.ai.testConnection({ settings }),
      layers.ai.resolveMode({ settings }),
    ]);

    const response: ConnectionTestResult = { ...result, mode: preview.mode, locality: preview.locality };

    return Response.json(response);
  });
}
