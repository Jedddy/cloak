import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { NavLinkList, NavLinks } from "@/components/nav-links";
import { classifyLocality } from "@/lib/ai/locality";
import { readEffectiveSettings } from "@/lib/server/settings";
import { cn, hostnameOf, localityLabel } from "@/lib/utils";

/** A sheet with one line of text and one solid redaction bar. */
function BrandMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0">
      <rect
        x="2.5"
        y="1.5"
        width="11"
        height="13"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <rect x="5" y="5" width="6" height="1.25" rx="0.5" fill="currentColor" opacity="0.55" />
      <rect x="5" y="8.25" width="6" height="2.5" rx="0.4" className="fill-primary" />
    </svg>
  );
}

async function ModelIndicator() {
  await connection();

  const settings = await readEffectiveSettings();
  const locality = classifyLocality({ settings });
  const host = hostnameOf(settings.baseUrl);
  const model = settings.textModel ?? settings.visionModel;

  return (
    <Link
      href="/settings"
      title={`Model server: ${settings.baseUrl}`}
      className={cn(
        "flex h-7 min-w-0 items-center gap-2 rounded-md px-2.5 text-xs transition-colors duration-150 hover:bg-accent",
        locality === "remote" && "bg-warning-muted text-warning hover:bg-warning-muted/80",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          locality === "remote" ? "bg-warning" : "bg-primary",
          locality === "lan" && "bg-foreground/60",
        )}
      />
      <span className="font-medium whitespace-nowrap">
        {localityLabel(locality)}
        <span className="hidden sm:inline"> model</span>
      </span>
      {locality !== "local" && locality !== "mock" && host && (
        <span className="hidden truncate opacity-80 sm:inline">{host}</span>
      )}
      {model && (
        <span className="hidden max-w-48 truncate font-mono text-muted-foreground md:inline">
          {model}
        </span>
      )}
    </Link>
  );
}

export function AppNav() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-4 sm:gap-4">
      <Link
        href="/"
        aria-label="SentinelDesk"
        className="flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight"
      >
        <BrandMark />
        <span className="hidden sm:inline">SentinelDesk</span>
      </Link>
      <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
      <Suspense fallback={<NavLinkList pathname="" />}>
        <NavLinks />
      </Suspense>
      <div className="ml-auto flex min-w-0 items-center">
        <Suspense fallback={<span className="h-7 w-32" />}>
          <ModelIndicator />
        </Suspense>
      </div>
    </header>
  );
}
