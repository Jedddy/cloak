import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { workspacePaths } from "./paths";
import { readEffectiveSettings, readSettingsResponse, saveSettings } from "./settings";
import { withTempWorkspace } from "./testing";

const envKeys = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_TEXT_MODEL", "LLM_VISION_MODEL", "LLM_PROVIDER"];

withTempWorkspace();

beforeEach(() => {
  for (const key of envKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    delete process.env[key];
  }
});

test("the settings response says a key is set but never contains it", async () => {
  process.env.LLM_API_KEY = "test-key-value-123";

  const response = await readSettingsResponse();

  expect(response.apiKeySet).toBe(true);
  expect(JSON.stringify(response)).not.toContain("test-key-value-123");
});

test("config.json never contains the key after a save", async () => {
  process.env.LLM_API_KEY = "test-key-value-123";

  await saveSettings({
    baseUrl: "http://127.0.0.1:1234/v1",
    textModel: "qwen3:4b",
    visionModel: null,
    timeoutMs: 30_000,
  });

  const saved = await readFile(workspacePaths.config(), "utf8");

  expect(saved).not.toContain("test-key-value-123");
  expect(JSON.parse(saved).baseUrl).toBe("http://127.0.0.1:1234/v1");
});

test("a saved baseUrl wins over LLM_BASE_URL", async () => {
  process.env.LLM_BASE_URL = "http://10.0.0.5:11434/v1";

  expect((await readEffectiveSettings()).baseUrl).toBe("http://10.0.0.5:11434/v1");

  await saveSettings({
    baseUrl: "http://127.0.0.1:1234/v1",
    textModel: null,
    visionModel: null,
    timeoutMs: 30_000,
  });

  expect((await readEffectiveSettings()).baseUrl).toBe("http://127.0.0.1:1234/v1");
});

test("env values and defaults fill what is not saved", async () => {
  process.env.LLM_TEXT_MODEL = "gemma4:e4b";
  process.env.LLM_PROVIDER = "mock";

  const settings = await readEffectiveSettings();

  expect(settings.textModel).toBe("gemma4:e4b");
  expect(settings.visionModel).toBeNull();
  expect(settings.provider).toBe("mock");
  expect(settings.apiKey).toBeNull();
  expect(settings.timeoutMs).toBeGreaterThan(0);
});
