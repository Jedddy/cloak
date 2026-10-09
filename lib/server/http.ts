import { openAsBlob } from "node:fs";

import type { z } from "zod";

import { ApiError } from "@/lib/contract/errors";
import { documentFormat, type FileEntry } from "@/lib/contract/schemas";

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

/**
 * Streams a stored file. The type comes from the stored mime, never from
 * the upload name; nosniff keeps the browser from guessing another type.
 */
export async function fileResponse(path: string, mime: string): Promise<Response> {
  let type = mime;

  if (mime.startsWith("text/") || mime.endsWith("/json") || mime.endsWith("/yaml")) {
    type = `${mime}; charset=utf-8`;
  }

  const blob = await openAsBlob(path, { type });

  return new Response(blob, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(blob.size),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

/** The 1-based page number of a PDF file's page route; anything else is a missing page. */
export function pdfPageParam(file: FileEntry, pageParam: string): number {
  const page = Number(pageParam);

  if (documentFormat(file.mime) !== "pdf" || !Number.isInteger(page) || page < 1) {
    throw new ApiError("not-found", "No such page.");
  }

  return page;
}

/** A page render as a PNG response. */
export function pngResponse(bytes: Uint8Array): Response {
  return new Response(bytes.slice(), { headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
