import { connection } from "next/server";

import { fixturePackageDetail } from "@/lib/contract/fixtures";

// Stub (KTD3): replaced in U8.

export async function GET() {
  await connection();

  return Response.json(fixturePackageDetail);
}

export async function DELETE() {
  return Response.json({ ok: true });
}
