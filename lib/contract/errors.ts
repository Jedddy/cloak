import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "bad-request",
  "not-found",
  "conflict",
  "too-large",
  "limit-reached",
  "remote-not-confirmed",
  "warnings-not-confirmed",
  "unredactable-findings",
  "original-changed",
  "internal",
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Every non-2xx JSON response from /api uses this body. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    details: z.array(z.string()),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

const statusByCode: Record<ApiErrorCode, number> = {
  "bad-request": 400,
  "not-found": 404,
  conflict: 409,
  "too-large": 413,
  "limit-reached": 409,
  "remote-not-confirmed": 409,
  "warnings-not-confirmed": 409,
  "unredactable-findings": 409,
  "original-changed": 500,
  internal: 500,
};

/** Thrown by server code; route handlers turn it into an ApiErrorBody response. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: string[];

  constructor(code: ApiErrorCode, message: string, details: string[] = []) {
    super(message);

    this.name = "ApiError";
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}
