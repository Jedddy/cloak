import JSZip from "jszip";
import { connection } from "next/server";

// Stub (KTD3): replaced in U12.

export async function GET() {
  await connection();

  const zip = new JSZip();

  zip.file("spec.md", "# Spec\n\nFixture reviewed copy.\n");

  const bytes = await zip.generateAsync({ type: "arraybuffer" });

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="reviewed.zip"',
    },
  });
}
