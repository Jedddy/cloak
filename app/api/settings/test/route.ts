import { fixtureConnectionTest } from "@/lib/contract/fixtures";

// Stub (KTD3): replaced in U7.

export async function POST() {
  return Response.json(fixtureConnectionTest);
}
