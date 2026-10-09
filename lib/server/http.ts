import type { z } from "zod";

import { ApiError } from "@/lib/contract/errors";

/** Runs a route body and turns every failure into the shared error body. */
export async function respond(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json(error.toBody(), { status: error.status });
    }

    // Log the error type only: messages can carry file content (R10).
    console.error("[api] internal error", error instanceof Error ? error.name : "non-error");

    const internal = new ApiError("internal", "The server could not complete the request.");

    return Response.json(internal.toBody(), { status: internal.status });
  }
}

/** Parses a JSON body with a contract schema. An empty body parses as `{}`. */
export async function readJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  const text = await request.text();
  let value = {};

  if (text.trim() !== "") {
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApiError("bad-request", "The request body is not valid JSON.");
    }
  }

  const result = schema.safeParse(value);

  if (!result.success) {
    throw new ApiError(
      "bad-request",
      "The request body does not match the contract.",
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  return result.data;
}
