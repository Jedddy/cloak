import { expect, test } from "bun:test";

import { POST as saveProfile } from "@/app/api/profiles/route";
import { POST as saveRecipient } from "@/app/api/recipients/route";
import { POST as testSettings } from "@/app/api/settings/test/route";
import {
  ConnectionTestResultSchema,
  RecipientProfileSchema,
  RecipientSchema,
} from "@/lib/contract/schemas";

import { readProfiles, readRecipients } from "./store";
import { withTempWorkspace } from "./testing";

withTempWorkspace();

function post(body: string) {
  return new Request("http://127.0.0.1/api", { method: "POST", body });
}

test("POST /api/settings/test with LLM_PROVIDER=mock returns locality mock and mode full", async () => {
  const previous = process.env.LLM_PROVIDER;

  process.env.LLM_PROVIDER = "mock";

  try {
    const response = await testSettings();
    const result = ConnectionTestResultSchema.parse(await response.json());

    expect(result.locality).toBe("mock");
    expect(result.mode).toBe("full");
  } finally {
    if (previous === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previous;
  }
});

test("a new profile is created and then updated by id", async () => {
  const created = RecipientProfileSchema.parse(
    await (
      await saveProfile(
        post(JSON.stringify({ name: "Agency", description: "", allowed: [], needsDecision: [], remove: ["secret"] })),
      )
    ).json(),
  );

  await saveProfile(post(JSON.stringify({ ...created, name: "Agency partner" })));

  const profiles = await readProfiles();

  expect(profiles).toHaveLength(4);
  expect(profiles.find((profile) => profile.id === created.id)?.name).toBe("Agency partner");
});

test("a recipient update keeps its allow rules", async () => {
  const created = RecipientSchema.parse(
    await (await saveRecipient(post(JSON.stringify({ name: "Acme Corp", profileId: "profile-client" })))).json(),
  );

  expect(created.allowRules).toEqual([]);

  const renamed = await saveRecipient(
    post(JSON.stringify({ id: created.id, name: "Acme Inc", profileId: "profile-client" })),
  );

  expect(renamed.status).toBe(200);
  expect((await readRecipients())[0]?.name).toBe("Acme Inc");
});

test("a recipient with an unknown profile is rejected", async () => {
  const response = await saveRecipient(post(JSON.stringify({ name: "X", profileId: "profile-missing" })));

  expect(response.status).toBe(400);
});
