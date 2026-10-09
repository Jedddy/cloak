import { Badge } from "@/components/ui/badge";
import type { Locality } from "@/lib/contract/schemas";
import { localityLabel } from "@/lib/utils";
import { cn } from "@/lib/utils";

function badgeClass(locality: Locality): string {
  if (locality === "local" || locality === "mock") {
    return "bg-primary/10 text-primary";
  }

  if (locality === "lan") {
    return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }

  return "bg-warning-muted text-warning";
}

export function LocalityBadge({
  locality,
  host,
  className,
}: {
  locality: Locality;
  host?: string | null;
  className?: string;
}) {
  const label =
    host && (locality === "lan" || locality === "remote")
      ? `${localityLabel(locality)} · ${host}`
      : localityLabel(locality);

  return (
    <Badge variant="outline" className={cn(badgeClass(locality), className)}>
      {label}
    </Badge>
  );
}
