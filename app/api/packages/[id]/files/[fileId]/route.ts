import { connection, type NextRequest } from "next/server";

import { FileUpdateBodySchema } from "@/lib/contract/schemas";
import { fileResponse, readJson, respond } from "@/lib/server/http";
import { findFile } from "@/lib/server/packages";
import { originalPath, readPackage, updatePackage } from "@/lib/server/store";

type Context = RouteContext<"/api/packages/[id]/files/[fileId]">;

/** Streams the original file for the viewer. */
export async function GET(_request: NextRequest, context: Context) {
  await connection();

  return respond(async () => {
    const { id, fileId } = await context.params;
    const file = findFile(await readPackage(id), fileId);

    return fileResponse(originalPath(id, file), file.mime);
  });
}

/** Excludes a file from export, or includes it again. */
export async function PATCH(request: Request, context: Context) {
  return respond(async () => {
    const { id, fileId } = await context.params;
    const body = await readJson(request, FileUpdateBodySchema);

    const pkg = await updatePackage(id, (current) => {
      findFile(current, fileId);

      return {
        ...current,
        files: current.files.map((file) => (file.id === fileId ? { ...file, excluded: body.excluded } : file)),
      };
    });

    return Response.json(findFile(pkg, fileId));
  });
}
