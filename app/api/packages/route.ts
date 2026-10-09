import { connection } from "next/server";

import { fixturePackage } from "@/lib/contract/fixtures";
import { PackageCreateBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U8.

export async function GET() {
  await connection();

  return Response.json([fixturePackage]);
}

export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson(request, PackageCreateBodySchema);

    return Response.json({
      ...fixturePackage,
      ...body,
      files: [],
      status: "draft",
      lastScan: null,
    });
  });
}
