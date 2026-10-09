import { afterEach, beforeEach, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError, type ApiErrorCode } from "@/lib/contract/errors";

// Test helpers for lib/server tests. Not imported by production code.

/** Points the workspace at a new temp folder for each test in the file. */
export function withTempWorkspace(): void {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sentinel-test-"));
    process.env.SENTINEL_WORKSPACE_DIR = root;
  });

  afterEach(async () => {
    delete process.env.SENTINEL_WORKSPACE_DIR;
    await rm(root, { recursive: true, force: true });
  });
}

export async function expectApiError<Value>(run: Promise<Value>, code: ApiErrorCode): Promise<void> {
  const error = await run.then(
    () => null,
    (failure: Error) => failure,
  );

  expect(error).toBeInstanceOf(ApiError);
  expect(error instanceof ApiError ? error.code : null).toBe(code);
}
