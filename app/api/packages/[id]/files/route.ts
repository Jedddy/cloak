import { ApiError } from "@/lib/contract/errors";
import { respond } from "@/lib/server/http";
import { addOriginal } from "@/lib/server/store";

/** Stores one uploaded file. The UI sends files one per request (KTD4). */
export async function POST(request: Request, context: RouteContext<"/api/packages/[id]/files">) {
  return respond(async () => {
    const { id } = await context.params;

    let form: FormData;

    try {
      form = await request.formData();
    } catch {
      throw new ApiError("bad-request", "Send the file as multipart/form-data.");
    }

    const values = form.getAll("file");
    const file = values[0];

    if (values.length !== 1 || !(file instanceof File)) {
      throw new ApiError("bad-request", "Send exactly one file per request.");
    }

    const entry = await addOriginal(id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });

    return Response.json(entry);
  });
}
