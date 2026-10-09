import { respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { readEffectiveSettings } from "@/lib/server/settings";

/** Tests the saved settings: models, JSON test, latency, locality, and the mode a scan would use. */
export async function POST() {
  return respond(async () => {
    const settings = await readEffectiveSettings();

    // testConnection already resolves the mode; a parallel resolveMode would
    // share the AI layer's serial queue and make the probes time out.
    return Response.json(await layers.ai.testConnection({ settings }));
  });
}
