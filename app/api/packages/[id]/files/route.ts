import { ApiError } from "@/lib/contract/errors";
import { fixtureFiles } from "@/lib/contract/fixtures";
import { respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U8.

export async function POST(request: Request) {
  return respond(async () => {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new ApiError("bad-request", "Send one file in the field `file`.");
    }

    return Response.json({
      ...fixtureFiles[2],
      originalName: file.name,
      sizeBytes: file.size,
    });
  });
}
