import { expect, test } from "bun:test";
import { z } from "zod";
import { scoreFindings, type EvaluationLabel } from "./evaluation";
import type { FindingCandidate } from "@/lib/contract/schemas";

test("multiple evidence entries for one prediction do not count as duplicate findings", () => {
  const hit: FindingCandidate = {
    fileId: "notes.md",
    category: "protected-term",
    title: "Codename",
    reason: "Private.",
    relatedGroupId: null,
    detections: [
      {
        method: "llm-text",
        ruleId: null,
        evidence: [
          { type: "text-span", start: 0, end: 7, line: 0, quote: "Juniper" },
          { type: "text-span", start: 8, end: 15, line: 1, quote: "Juniper" },
        ],
      },
    ],
  };

  expect(
    scoreFindings([hit], [{ file: "notes.md", category: "protected-term", quote: "Juniper" }]).find(
      (score) => score.layer === "llm-text",
    ),
  ).toMatchObject({ truePositive: 1, falsePositive: 0, recall: 1 });
});

test("the evaluation CLI runs all modes on fictional fixtures through the pipeline", async () => {
  const child = Bun.spawn(
    [process.execPath, "scripts/eval.ts", "--provider", "mock", "--mode", "all", "--json"],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
  );

  const output = await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(error).toBe("");
  const report = JSON.parse(output);
  expect(report.runs.map((run: { requestedMode: string }) => run.requestedMode)).toEqual([
    "rules-only",
    "text-ai",
    "full",
  ]);
  expect(report.runs[0].files.length).toBeGreaterThanOrEqual(10);
  expect(
    report.runs[2].scores.find((score: { layer: string }) => score.layer === "llm-text").recall,
  ).toBe(1);
  expect(
    report.runs[2].scores.find((score: { layer: string }) => score.layer === "llm-vision").recall,
  ).toBe(1);

  for (const run of report.runs.slice(1)) {
    expect(
      run.scores.find((score: { layer: string }) => score.layer === "llm-text").precision,
    ).toBe(1);
  }

  expect(
    report.runs[2].scores.find((score: { layer: string }) => score.layer === "llm-vision")
      .precision,
  ).toBe(1);
  expect(report.runs[2].quotesDropped).toBe(0);
  expect(report.runs[2].jsonFailures).toBe(0);
});

test("JSON evaluation remains parseable when a model fails after connection", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (request.method === "GET") return Response.json({ data: [{ id: "text" }] });

      const body = z
        .object({ messages: z.array(z.object({ content: z.unknown() })) })
        .parse(await request.json());

      if (body.messages[1].content === "Connection test.")
        return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });

      return new Response("unavailable", { status: 503 });
    },
  });

  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "scripts/eval.ts",
        "--provider",
        "openai-compatible",
        "--mode",
        "text-ai",
        "--base-url",
        `${server.url}v1`,
        "--text-model",
        "text",
        "--json",
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );

    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    expect(await child.exited).toBe(1);
    const report = JSON.parse(output);
    expect(report.runs[0].actualMode).toBe("rules-only");
    expect(error).toContain("model failed, rules-only from here");
  } finally {
    server.stop(true);
  }
});

test("evaluation reports missed labels and duplicate predictions without inflating recall", () => {
  const labels: EvaluationLabel[] = [
    { file: "notes.md", category: "protected-term", quote: "Juniper" },
    { file: "other.md", category: "other-client", quote: "Acme Corp" },
  ];

  const hit: FindingCandidate = {
    fileId: "notes.md",
    category: "protected-term",
    title: "Codename",
    reason: "Private.",
    relatedGroupId: null,
    detections: [
      {
        method: "llm-text",
        ruleId: null,
        evidence: [{ type: "text-span", start: 0, end: 7, line: 0, quote: "Juniper" }],
      },
    ],
  };

  expect(scoreFindings([hit, hit], labels).find((score) => score.layer === "llm-text")).toEqual({
    layer: "llm-text",
    truePositive: 1,
    falsePositive: 1,
    falseNegative: 1,
    precision: 0.5,
    recall: 0.5,
  });
});

test("evaluation scores vision regions by overlap and excludes text-only labels", () => {
  const label: EvaluationLabel = {
    file: "shot.png",
    category: "other-client",
    box: { x: 10, y: 10, w: 100, h: 20 },
  };

  const hit: FindingCandidate = {
    fileId: "shot.png",
    category: "other-client",
    title: "Tab",
    reason: "Private.",
    relatedGroupId: null,
    detections: [
      {
        method: "llm-vision",
        ruleId: null,
        evidence: [{ type: "image-region", quote: null, box: { x: 12, y: 10, w: 100, h: 20 } }],
      },
    ],
  };

  expect(
    scoreFindings([hit], [label, { file: "text.md", category: "other", quote: "private" }]).find(
      (score) => score.layer === "llm-vision",
    ),
  ).toMatchObject({ truePositive: 1, falseNegative: 0, precision: 1, recall: 1 });
});

test("a matching quote cannot override a disjoint labelled image box", () => {
  const hit: FindingCandidate = {
    fileId: "shot.png",
    category: "other-client",
    title: "Tab",
    reason: "Private.",
    relatedGroupId: null,
    detections: [
      {
        method: "llm-vision",
        ruleId: null,
        evidence: [
          { type: "image-region", quote: "Acme Corp", box: { x: 300, y: 300, w: 100, h: 20 } },
        ],
      },
    ],
  };

  const labels: EvaluationLabel[] = [
    {
      file: "shot.png",
      category: "other-client",
      quote: "Acme Corp",
      box: { x: 10, y: 10, w: 100, h: 20 },
    },
  ];

  expect(scoreFindings([hit], labels).find((score) => score.layer === "llm-vision")).toMatchObject({
    truePositive: 0,
    falsePositive: 1,
    falseNegative: 1,
  });
});
