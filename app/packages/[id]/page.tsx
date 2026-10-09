import { Suspense } from "react";

import { PackageWorkspace } from "@/components/package-workspace";

export default function PackagePage({ params }: PageProps<"/packages/[id]">) {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-muted-foreground">Loading package…</p>
      }
    >
      <PackageWorkspace params={params} />
    </Suspense>
  );
}
