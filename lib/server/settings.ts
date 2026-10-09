import type { EffectiveSettings } from "@/lib/contract/interfaces";
import {
  ProviderSchema,
  SettingsResponseSchema,
  type SettingsResponse,
  type SettingsUpdateBody,
} from "@/lib/contract/schemas";

import { readSavedSettings, writeSavedSettings } from "./store";

// Precedence: saved config, then env, then defaults (KTD8). The API key is
// read only from LLM_API_KEY and never written to workspace/ (R10).

const defaults = {
  baseUrl: "http://127.0.0.1:11434/v1",
  timeoutMs: 60_000,
};

function env(name: string): string | null {
  const value = process.env[name]?.trim();

  return value === undefined || value === "" ? null : value;
}

function envTimeout(): number | null {
  const value = Number(env("LLM_TIMEOUT_MS"));

  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Server-side only: the result carries the API key. */
export async function readEffectiveSettings(): Promise<EffectiveSettings> {
  const saved = await readSavedSettings();
  const provider = ProviderSchema.safeParse(env("LLM_PROVIDER"));

  return {
    baseUrl: saved.baseUrl ?? env("LLM_BASE_URL") ?? defaults.baseUrl,
    textModel: saved.textModel !== undefined ? saved.textModel : env("LLM_TEXT_MODEL"),
    visionModel: saved.visionModel !== undefined ? saved.visionModel : env("LLM_VISION_MODEL"),
    timeoutMs: saved.timeoutMs ?? envTimeout() ?? defaults.timeoutMs,
    provider: provider.success ? provider.data : "openai-compatible",
    apiKey: env("LLM_API_KEY"),
  };
}

function toResponse(settings: EffectiveSettings): SettingsResponse {
  // Strict parse: a key field can never reach the browser.
  return SettingsResponseSchema.parse({
    baseUrl: settings.baseUrl,
    textModel: settings.textModel,
    visionModel: settings.visionModel,
    timeoutMs: settings.timeoutMs,
    provider: settings.provider,
    apiKeySet: settings.apiKey !== null,
  });
}

export async function readSettingsResponse(): Promise<SettingsResponse> {
  return toResponse(await readEffectiveSettings());
}

export async function saveSettings(body: SettingsUpdateBody): Promise<SettingsResponse> {
  await writeSavedSettings(body);

  return readSettingsResponse();
}
