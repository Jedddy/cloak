import { connection } from "next/server";

import { PackageCreateBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { createPackage, listPackages } from "@/lib/server/store";

export async function GET() {
  await connection();

  return respond(async () => Response.json(await listPackages()));
}

export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson(request, PackageCreateBodySchema);

    return Response.json(await createPackage(body));
  });
}
