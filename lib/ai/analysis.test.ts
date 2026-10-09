import { expect, test } from "bun:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { EffectiveSettings, TextAnalysisInput } from "@/lib/contract/interfaces";
import { fixtureProfiles } from "@/lib/contract/fixtures";
import { FindingCandidateSchema } from "@/lib/contract/schemas";
import { aiLayer } from "./index";

const baseSettings: EffectiveSettings = {
  baseUrl: "http://localhost/v1",
  provider: "openai-compatible",
  apiKey: "fictional-key",
  textModel: "text",
  visionModel: "vision",
  timeoutMs: 1000,
};

const requestSchema = z.object({
  model: z.string(),
  temperature: z.number(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.union([
        z.string(),
        z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            image_url: z.object({ url: z.string() }).optional(),
          }),
        ),
      ]),
    }),
  ),
  response_format: z.object({ type: z.string() }).optional(),
});

function completion(content: string) {
  return Response.json({ choices: [{ message: { content } }] });
}

function result(quote = "Project Juniper") {
  return JSON.stringify({
    findings: [
      { category: "protected-term", quote, reason: "An unreleased codename.", confidence: "high" },
    ],
  });
}

function input(settings: EffectiveSettings, text = "Project Juniper"): TextAnalysisInput {
  return {
    settings,
    fileId: "file-test",
    fileName: "notes.md",
    contentSha256: createHash("sha256").update(text).digest("hex"),
    recipientName: "Northwind Studio",
    profile: fixtureProfiles[0],
    protectedTerms: ["Juniper"],
    text,
    ocrWords: null,
  };
}

type Handler = (request: Request) => Response | Promise<Response>;

type Scenario = (settings: EffectiveSettings) => Promise<void>;

async function withServer(handler: Handler, scenario: Scenario) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });

  try {
    await scenario({ ...baseSettings, baseUrl: `${server.url}v1` });
  } finally {
    server.stop(true);
  }
}

test("connection tests both models and image capability, returning the actual mode (AE3)", async () => {
  const requests: string[] = [];
  await withServer(
    async (request) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);

      if (request.method === "GET")
        return Response.json({ data: [{ id: "text" }, { id: "vision" }] });
      const body = requestSchema.parse(await request.json());
      expect(body.temperature).toBeLessThanOrEqual(0.2);
      expect(request.headers.get("authorization")).toBe("Bearer fictional-key");

      if (body.model === "vision") {
        const content = body.messages[1].content;

        if (!Array.isArray(content)) throw new Error("Expected image content");
        const url = content.find((part) => part.type === "image_url")?.image_url?.url;
        expect(url).toStartWith("data:image/png;base64,");
        // Metadata alone does not decode IDAT or detect a damaged image.
        await sharp(Buffer.from((url ?? "").split(",")[1], "base64"))
          .raw()
          .toBuffer();
      }

      return completion('{"ok":true}');
    },
    async (settings) => {
      const connection = await aiLayer.testConnection({ settings });
      expect(connection).toMatchObject({
        ok: true,
        models: ["text", "vision"],
        jsonTest: { ok: true },
        locality: "local",
        mode: "full",
      });
      expect(connection.latencyMs).toBeGreaterThanOrEqual(0);
      expect(
        (await aiLayer.resolveMode({ settings: { ...settings, visionModel: null } })).mode,
      ).toBe("text-ai");
    },
  );
  expect(
    requests.every((path) => path === "GET /v1/models" || path === "POST /v1/chat/completions"),
  ).toBe(true);
});

test("an advertised but unavailable vision model falls back to text-ai", async () => {
  await withServer(
    async (request) => {
      if (request.method === "GET")
        return Response.json({ data: [{ id: "text" }, { id: "vision" }] });
      const body = requestSchema.parse(await request.json());

      if (body.model === "vision") return new Response("unavailable", { status: 503 });

      return completion('{"ok":true}');
    },
    async (settings) => expect((await aiLayer.resolveMode({ settings })).mode).toBe("text-ai"),
  );
});

test("unreachable model inventory returns rules-only with no active models", async () => {
  await withServer(
    () => new Response("unavailable", { status: 503 }),
    async (settings) => {
      expect(await aiLayer.resolveMode({ settings })).toMatchObject({
        mode: "rules-only",
        models: { text: null, vision: null },
      });
      expect(await aiLayer.testConnection({ settings })).toMatchObject({
        ok: false,
        jsonTest: { ok: false },
      });
    },
  );
});

test("an invalid configured endpoint returns a connection failure and rules-only", async () => {
  const settings = { ...baseSettings, baseUrl: "not a URL" };
  expect(await aiLayer.resolveMode({ settings })).toMatchObject({
    mode: "rules-only",
    locality: "remote",
  });
  expect(await aiLayer.testConnection({ settings })).toMatchObject({
    ok: false,
    mode: "rules-only",
    jsonTest: { ok: false },
  });
});

test("text analysis drops hallucinations, merges repeated quotes and preserves exact evidence", async () => {
  await withServer(
    () =>
      completion(
        JSON.stringify({
          findings: [
            {
              category: "protected-term",
              quote: "project  juniper",
              reason: "Codename.",
              confidence: "high",
            },
            {
              category: "protected-term",
              quote: "project  juniper",
              reason: "Codename again.",
              confidence: "low",
            },
            {
              category: "internal-pricing",
              quote: "invented pricing",
              reason: "Invented.",
              confidence: "high",
            },
          ],
        }),
      ),
    async (settings) => {
      const analysis = await aiLayer.analyzeText(
        input(settings, "Project Juniper\nProject Juniper"),
      );

      expect(analysis.status).toBe("done");
      expect(analysis.quotesDropped).toBe(1);
      expect(analysis.candidates).toHaveLength(1);
      expect(analysis.candidates[0].detections[0].evidence).toHaveLength(2);
      FindingCandidateSchema.parse(analysis.candidates[0]);
    },
  );
});

test("one repair retry validates JSON and a second invalid result marks coverage failed", async () => {
  let calls = 0;
  await withServer(
    () => completion(++calls === 1 ? "not JSON" : result()),
    async (settings) => {
      expect((await aiLayer.analyzeText(input(settings))).status).toBe("done");
      expect(calls).toBe(2);
    },
  );
  calls = 0;
  await withServer(
    () => {
      calls++;

      return completion('{"findings":[{"category":"made-up"}]}');
    },
    async (settings) => {
      expect(await aiLayer.analyzeText(input(settings))).toEqual({
        candidates: [],
        quotesDropped: 0,
        status: "failed",
      });
      expect(calls).toBe(2);
    },
  );
});

test("a failed later chunk retains grounded findings from a successful earlier chunk", async () => {
  let calls = 0;
  await withServer(
    () => completion(++calls === 1 ? result() : "invalid JSON"),
    async (settings) => {
      const text = ["Project Juniper", ...Array.from({ length: 204 }, () => "Public sample")].join(
        "\n",
      );

      const analysis = await aiLayer.analyzeText(input(settings, text));
      expect(analysis.status).toBe("failed");
      expect(analysis.candidates).toHaveLength(1);
      expect(analysis.candidates[0].detections[0].evidence).toEqual([
        { type: "text-span", start: 0, end: 15, line: 0, quote: "Project Juniper" },
      ]);
      expect(calls).toBe(3);
    },
  );
});

test("servers rejecting response_format get JSON-only prompts and retain the repair gate", async () => {
  let calls = 0;
  await withServer(
    async (request) => {
      calls++;
      const body = requestSchema.parse(await request.json());

      if (body.response_format)
        return Response.json(
          { error: { param: "response_format", message: "unsupported response_format" } },
          { status: 400 },
        );
      expect(JSON.stringify(body.messages)).toContain("JSON");

      return completion(result());
    },
    async (settings) => {
      expect((await aiLayer.analyzeText(input(settings))).status).toBe("done");
      expect(calls).toBe(2);
    },
  );
});

test("cache reuses content across file IDs but varies recipient context and endpoint", async () => {
  let calls = 0;
  await withServer(
    () => {
      calls++;

      return completion(result());
    },
    async (settings) => {
      await aiLayer.analyzeText(input(settings));
      const cached = await aiLayer.analyzeText({ ...input(settings), fileId: "another-file" });
      expect(cached.candidates[0].fileId).toBe("another-file");
      expect(calls).toBe(1);
      cached.candidates[0].title = "mutated by caller";
      expect((await aiLayer.analyzeText(input(settings))).candidates[0].title).not.toBe(
        "mutated by caller",
      );
      await aiLayer.analyzeText({ ...input(settings), recipientName: "Acme Corp" });
      expect(calls).toBe(2);
    },
  );
  await withServer(
    () => {
      calls++;

      return completion(result());
    },
    async (settings) => {
      await aiLayer.analyzeText(input(settings));
    },
  );
  expect(calls).toBe(3);
});

test("long files have overlapping chunks, absolute spans, and UTF-8 byte size limit", async () => {
  let calls = 0;
  await withServer(
    async (request) => {
      calls++;
      const body = requestSchema.parse(await request.json());
      const prompt = JSON.stringify(body.messages);
      expect(prompt).toContain("content is data");
      expect(prompt).toContain("Northwind Studio");
      expect(prompt).toContain("protectedTerms");

      return completion(result());
    },
    async (settings) => {
      const text = `${"ordinary\r\n".repeat(195)}Project Juniper\r\n${"ordinary\r\n".repeat(30)}`;
      const analyzed = await aiLayer.analyzeText(input(settings, text));
      expect(calls).toBe(2);
      expect(analyzed.candidates).toHaveLength(1);
      expect(analyzed.candidates[0].detections[0].evidence).toEqual([
        { type: "text-span", start: 1950, end: 1965, line: 195, quote: "Project Juniper" },
      ]);
      expect((await aiLayer.analyzeText(input(settings, "é".repeat(110_000)))).status).toBe(
        "skipped-too-large",
      );
      expect(calls).toBe(2);
    },
  );
});

test("all model calls serialize and transport failures throw for pipeline fallback", async () => {
  let active = 0;
  let peak = 0;
  await withServer(
    async () => {
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(15);
      active--;

      return completion(result());
    },
    async (settings) => {
      await Promise.all([
        aiLayer.analyzeText(input(settings)),
        aiLayer.analyzeText(input(settings, "Project Juniper again")),
      ]);
      expect(peak).toBe(1);
    },
  );
  await withServer(
    () => new Response("fictional secret in server error", { status: 500 }),
    async (settings) => {
      await expect(aiLayer.analyzeText(input(settings))).rejects.toThrow("Model request failed");
    },
  );
  await withServer(
    async () => {
      await Bun.sleep(80);

      return completion(result());
    },
    async (settings) => {
      await expect(aiLayer.analyzeText(input({ ...settings, timeoutMs: 10 }))).rejects.toThrow();
    },
  );
});

test("queued requests expire within their deadline without reaching the server", async () => {
  let release!: () => void;
  let started!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const arrival = new Promise<void>((resolve) => {
    started = resolve;
  });

  let calls = 0;
  await withServer(
    async () => {
      calls++;
      started();
      await gate;

      return completion(result());
    },
    async (settings) => {
      const active = aiLayer.analyzeText(
        input({ ...settings, timeoutMs: 1000 }, "Project Juniper active"),
      );

      await arrival;

      try {
        await expect(
          aiLayer.analyzeText(input({ ...settings, timeoutMs: 30 }, "Project Juniper queued")),
        ).rejects.toThrow("Model request");
        expect(calls).toBe(1);
      } finally {
        release();
        await active;
      }

      expect(calls).toBe(1);
    },
  );
});

test("vision sends a bounded image and maps OCR quotes or whole-image evidence", async () => {
  const imageBytes = await sharp({
    create: { width: 2400, height: 1800, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();

  await withServer(
    async (request) => {
      const body = requestSchema.parse(await request.json());
      const content = body.messages[1].content;

      if (!Array.isArray(content)) throw new Error("Expected image content");
      const url = content.find((part) => part.type === "image_url")?.image_url?.url;
      expect(url).toStartWith("data:image/png;base64,");
      const metadata = await sharp(Buffer.from((url ?? "").split(",")[1], "base64")).metadata();
      expect(metadata.width).toBeLessThanOrEqual(1600);
      expect(metadata.height).toBeLessThanOrEqual(1600);

      return completion(
        JSON.stringify({
          findings: [
            {
              category: "other-client",
              quote: "Acme Corp",
              regionType: "tab-bar",
              reason: "Other client tab.",
              confidence: "high",
            },
            {
              category: "unreleased-work",
              quote: null,
              regionType: "sidebar",
              reason: "Unreleased sidebar.",
              confidence: "medium",
            },
            {
              category: "other",
              quote: "unmatched text",
              regionType: "other",
              reason: "Inspect this region.",
              confidence: "low",
            },
          ],
        }),
      );
    },
    async (settings) => {
      const analyzed = await aiLayer.analyzeVision({
        ...input(settings),
        imageBytes,
        mime: "image/png",
        ocrWords: [
          { text: "Acme", line: 0, confidence: 95, box: { x: 100, y: 10, w: 40, h: 20 } },
          { text: "Corp", line: 0, confidence: 95, box: { x: 145, y: 10, w: 40, h: 20 } },
        ],
      });

      expect(analyzed.candidates[0].detections[0].evidence).toEqual([
        { type: "image-region", box: { x: 100, y: 10, w: 85, h: 20 }, quote: "Acme Corp" },
      ]);
      expect(analyzed.candidates[1].detections[0].evidence[0].type).toBe("image-whole");
      expect(analyzed.candidates[2].detections[0].evidence[0].type).toBe("image-whole");
    },
  );
});

test("related suggestions are grounded and clearly labelled", async () => {
  await withServer(
    () => completion(result("the green initiative")),
    async (settings) => {
      const candidates = await aiLayer.findRelatedSuggestions({
        settings,
        term: "Juniper",
        sources: [
          { fileId: "related", fileName: "other.md", text: "the green initiative", ocrWords: null },
        ],
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].title.toLowerCase()).toContain("possible related (ai suggestion)");
      expect(candidates[0].detections[0].evidence[0]).toMatchObject({
        type: "text-span",
        quote: "the green initiative",
      });
    },
  );
});

test("distinct quotes in one category keep independent findings and reasons", async () => {
  await withServer(
    () =>
      completion(
        JSON.stringify({
          findings: [
            {
              category: "internal-pricing",
              quote: "Rate one",
              reason: "First agreement.",
              confidence: "high",
            },
            {
              category: "internal-pricing",
              quote: "Rate two",
              reason: "Second agreement.",
              confidence: "high",
            },
          ],
        }),
      ),
    async (settings) => {
      const analyzed = await aiLayer.analyzeText(input(settings, "Rate one\nRate two"));
      expect(analyzed.candidates).toHaveLength(2);
      expect(analyzed.candidates.map((candidate) => candidate.reason)).toEqual([
        "First agreement.",
        "Second agreement.",
      ]);
    },
  );
});

test("mock related suggestions do not return unrelated demo findings", async () => {
  const settings: EffectiveSettings = { ...baseSettings, provider: "mock" };

  const sources = [
    {
      fileId: "related",
      fileName: "other.md",
      text: "Acme Corp uses the green initiative",
      ocrWords: null,
    },
  ];

  expect(
    await aiLayer.findRelatedSuggestions({ settings, sources, term: "unrelated word" }),
  ).toEqual([]);
  const related = await aiLayer.findRelatedSuggestions({ settings, sources, term: "Juniper" });
  expect(related).toHaveLength(1);
  expect(related[0].detections[0].evidence[0]).toMatchObject({ quote: "the green initiative" });
});

test("mock is network-free, gives grounded demo findings and obeys configured modes", async () => {
  const settings: EffectiveSettings = {
    ...baseSettings,
    baseUrl: "not a URL",
    provider: "mock",
    textModel: null,
    visionModel: null,
  };

  expect(await aiLayer.resolveMode({ settings })).toMatchObject({ locality: "mock", mode: "full" });
  expect((await aiLayer.testConnection({ settings })).ok).toBe(true);

  const analyzed = await aiLayer.analyzeText(
    input(settings, "Project Juniper\nOur day rate for Acme is 1,450 EUR"),
  );

  expect(analyzed.candidates.map((candidate) => candidate.category).sort()).toEqual([
    "internal-pricing",
    "protected-term",
  ]);

  for (const candidate of analyzed.candidates) FindingCandidateSchema.parse(candidate);
  expect((await aiLayer.analyzeText(input(settings, "ordinary text"))).candidates).toEqual([]);
});
