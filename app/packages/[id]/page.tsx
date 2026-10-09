import { Suspense } from "react";

import { PackageWorkspace } from "@/components/package-workspace";

export default function PackagePage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-muted-foreground">Loading package…</p>
      }
    >
      <PackageWorkspace />
    </Suspense>
  );
}
