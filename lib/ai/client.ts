import { createHash } from "node:crypto";
import { z } from "zod";
import type { EffectiveSettings } from "@/lib/contract/interfaces";
import { PROMPT_VERSION } from "./prompts";

type ImagePart = { type: "image_url"; image_url: { url: string } };

type TextPart = { type: "text"; text: string };

export type Message = {
  role: "system" | "user" | "assistant";
  content: string | (ImagePart | TextPart)[];
};

const envelope = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

const inventory = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

const apiError = z.object({
  error: z.object({ param: z.string().nullish(), message: z.string().optional() }),
});

const formats = new Map<string, boolean>();

const cache = new Map<string, string>();

const metrics = { jsonFailures: 0, requests: 0 };

let queue: Promise<void> = Promise.resolve();

/** Count-only diagnostics for evaluation. No model output, content or credentials. */
export function readAiMetrics() {
  return { ...metrics };
}

async function queued<T>(action: () => Promise<T>): Promise<T> {
  const pending = queue.then(action);
  queue = pending.then(
    () => undefined,
    () => undefined,
  );

  return pending;
}

type RequestInput = {
  settings: EffectiveSettings;
  path: "models" | "chat/completions";
  body: string | null;
};

// Read and parse the body within the timeout. Model errors are intentionally
// replaced with count/status-only errors: servers can echo private content.
async function request(input: RequestInput) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Model request timed out."));
    }, input.settings.timeoutMs);
  });

  try {
    return await Promise.race([
      queued(async () => {
        // An expired caller must never send a request after its queue turn arrives.
        if (controller.signal.aborted) throw new Error("Model request timed out.");
        const headers = new Headers({ "Content-Type": "application/json" });

        if (input.settings.apiKey !== null)
          headers.set("Authorization", `Bearer ${input.settings.apiKey}`);
        metrics.requests++;

        const response = await fetch(
          `${input.settings.baseUrl.replace(/\/+$/, "")}/${input.path}`,
          {
            method: input.body === null ? "GET" : "POST",
            headers,
            body: input.body,
            signal: controller.signal,
            redirect: "error",
            cache: "no-store",
          },
        );

        const data = await response.json().catch(() => null);

        if (controller.signal.aborted) throw new Error("Model request timed out.");

        return { ok: response.ok, status: response.status, data };
      }),
      deadline,
    ]);
  } catch {
    throw new Error("Model request failed or timed out.");
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels(settings: EffectiveSettings): Promise<string[]> {
  const response = await request({ settings, path: "models", body: null });
  const parsed = inventory.safeParse(response.data);

  if (!response.ok || !parsed.success)
    throw new Error("Model request failed: inventory unavailable.");

  return [...new Set(parsed.data.data.map((model) => model.id))];
}

type CompletionInput<T> = {
  settings: EffectiveSettings;
  model: string;
  messages: Message[];
  schema: z.ZodType<T>;
  /** Content hash plus prompt/recipient fingerprint prevents stale-context reuse. */
  contentHash: string | null;
};

export async function validatedCompletion<T>(input: CompletionInput<T>): Promise<T | null> {
  const schema = z.toJSONSchema(input.schema);

  const fingerprint = createHash("sha256")
    .update(JSON.stringify([input.settings.baseUrl, input.settings.apiKey, input.messages, schema]))
    .digest("hex");

  const key = `${input.contentHash}:${input.model}:${PROMPT_VERSION}:${fingerprint}`;
  const cached = cache.get(key);

  if (input.contentHash !== null && cached !== undefined)
    return input.schema.parse(JSON.parse(cached));

  const formatKey = `${input.settings.baseUrl}:${input.model}`;
  const messages = [...input.messages];

  for (let attempt = 0; attempt < 2; attempt++) {
    let useSchema = formats.get(formatKey) !== false;
    let response;

    // Format negotiation is separate from the one JSON repair retry.
    for (;;) {
      const body = {
        model: input.model,
        messages,
        temperature: 0.1,
        stream: false,
        max_tokens: 4096,
      };

      const formatted = {
        ...body,
        response_format: {
          type: "json_schema",
          json_schema: { name: "sentinel_result", strict: true, schema },
        },
      };

      response = await request({
        settings: input.settings,
        path: "chat/completions",
        body: JSON.stringify(useSchema ? formatted : body),
      });
      const error = apiError.safeParse(response.data);

      const formatRejected =
        error.success &&
        (error.data.error.param === "response_format" ||
          /response_format|json_schema/i.test(error.data.error.message ?? ""));

      if (useSchema && (response.status === 400 || response.status === 422) && formatRejected) {
        formats.set(formatKey, false);
        useSchema = false;
        continue;
      }

      break;
    }

    if (!response.ok) throw new Error(`Model request failed (HTTP ${response.status}).`);
    const outer = envelope.safeParse(response.data);
    let content = "";

    if (outer.success) content = outer.data.choices[0].message.content;

    let parsed = input.schema.safeParse(null);

    try {
      parsed = input.schema.safeParse(JSON.parse(content));
    } catch {
      /* One schema repair below. */
    }

    if (parsed.success) {
      if (input.contentHash !== null) {
        if (cache.size >= 128) cache.delete(cache.keys().next().value ?? "");
        cache.set(key, JSON.stringify(parsed.data));
      }

      return parsed.data;
    }

    metrics.jsonFailures++;
    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content: `Return valid JSON only matching this schema, based on the original input data: ${JSON.stringify(schema)}`,
      },
    );
  }

  return null;
}
