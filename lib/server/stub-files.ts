import { fixtureFiles } from "@/lib/contract/fixtures";

// Throwaway helper for the U4 stub file routes; deleted when U8 and U12
// replace them.

/** A 1x1 transparent PNG. */
const pixelPng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

export function stubFileResponse(fileId: string): Response {
  const file = fixtureFiles.find((entry) => entry.id === fileId);

  if (file?.kind === "image") {
    return new Response(pixelPng, { headers: { "Content-Type": "image/png" } });
  }

  return new Response(`Fixture content of ${file?.originalName ?? "unknown file"}.\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
