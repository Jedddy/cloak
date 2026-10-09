"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";

import { LocalityBadge } from "@/components/locality-badge";
import { ExportPanel } from "@/components/export-panel";
import { PreviewPanel } from "@/components/preview-panel";
import { ReviewPanel } from "@/components/review-panel";
import { ScanPanel } from "@/components/scan-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getJob, getPackage, getSettings, listProfiles, listRecipients } from "@/lib/client/client";
import type { Job, PackageDetail, SettingsResponse } from "@/lib/contract/schemas";
import { cn, hostnameOf, modeLabel, openFindingsOf, plural, sentenceCase } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

export function PackageWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [recipient, setRecipient] = useState<{ name: string; profile: string } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("scan");

  const refresh = useCallback(async () => {
    const next = await getPackage(id);
    setDetail(next);
  }, [id]);

  useEffect(() => {
    let stale = false;
    Promise.all([getPackage(id), getSettings(), listRecipients(), listProfiles()])
      .then(([nextDetail, nextSettings, recipients, profiles]) => {
        if (stale) {
          return;
        }

        const match = recipients.find(
          (candidate) => candidate.id === nextDetail.package.recipientId,
        );

        setDetail(nextDetail);
        setSettings(nextSettings);
        setRecipient(
          match
            ? {
                name: match.name,
                profile:
                  profiles.find((profile) => profile.id === match.profileId)?.name ?? "No profile",
              }
            : null,
        );

        if (nextDetail.package.lastScan !== null) {
          setTab(nextDetail.package.status === "exported" ? "export" : "review");
        }
      })
      .catch((loadError: Error) => {
        if (stale) {
          return;
        }

        setError(loadError.message);
      });

    return () => {
      stale = true;
    };
  }, [id]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") {
      return;
    }

    let stale = false;

    const timer = window.setInterval(() => {
      getJob(id, job.id)
        .then((next) => {
          if (stale) {
            return;
          }

          setJob(next);

          if (next.status === "done" || next.status === "failed") {
            refresh().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 1000);

    return () => {
      stale = true;
      window.clearInterval(timer);
    };
  }, [id, job, refresh]);

  if (error && detail === null) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <Alert variant="destructive">
          <AlertTitle>Could not load the package</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="flex flex-col gap-3 border-b px-6 py-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-3 w-56" />
      </div>
    );
  }

  const coverage = detail.coverage;
  const openCount = openFindingsOf(detail.findings);

  const remoteHost =
    settings && coverage?.locality === "remote" ? hostnameOf(settings.baseUrl) : null;

  const wide = tab === "review" || tab === "preview";

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className={cn("gap-0", wide ? "lg:h-full" : "min-h-full")}
    >
      <div className="shrink-0 border-b bg-background px-6 pt-4">
        <nav
          aria-label="Breadcrumb"
          className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground"
        >
          <Link href="/" className="rounded-sm hover:text-foreground">
            Packages
          </Link>
          <ChevronRight className="size-3" aria-hidden="true" />
          <span className="truncate">{detail.package.name}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{detail.package.name}</h1>
          {coverage && (
            <div className="flex items-center gap-1.5">
              <Badge variant="outline">Mode: {modeLabel(coverage.mode)}</Badge>
              <LocalityBadge locality={coverage.locality} host={remoteHost} />
            </div>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {recipient ? (
            <>
              For <span className="text-foreground">{recipient.name}</span>
              {" · "}
              {recipient.profile}
            </>
          ) : (
            "Unknown recipient"
          )}
          {" · "}
          {plural(detail.package.files.length, "file")}
          {" · "}
          {sentenceCase(detail.package.status)}
        </p>
        <TabsList variant="line" className="mt-3 -mb-px h-10 gap-4 p-0">
          {[
            { value: "scan", label: "Scan" },
            { value: "review", label: "Review", count: openCount },
            { value: "preview", label: "Preview" },
            { value: "export", label: "Export" },
          ].map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="flex-none rounded-none px-0.5 after:bottom-0! after:bg-primary"
            >
              {item.label}
              {item.count !== undefined && item.count > 0 && (
                <span className="rounded-sm bg-foreground/[0.07] px-1.5 text-xs leading-5 tabular-nums">
                  {item.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {detail.interrupted && (
        <div className="shrink-0 border-b bg-warning-muted px-6 py-2 text-sm text-warning">
          <span className="font-medium">Last run was interrupted.</span> The server stopped during
          the last scan or export. Start a new scan to continue.
        </div>
      )}

      <TabsContent value="scan">
        <ScanPanel
          packageId={id}
          detail={detail}
          job={job && job.kind === "scan" ? job : null}
          remoteHost={settings ? hostnameOf(settings.baseUrl) : null}
          onJob={setJob}
          onRefresh={refresh}
          onReview={() => setTab("review")}
        />
      </TabsContent>
      <TabsContent value="review" className="min-h-0">
        <ReviewPanel packageId={id} detail={detail} onRefresh={refresh} />
      </TabsContent>
      <TabsContent value="preview" className="min-h-0">
        <PreviewPanel packageId={id} detail={detail} />
      </TabsContent>
      <TabsContent value="export">
        <ExportPanel
          packageId={id}
          detail={detail}
          job={job && job.kind === "export" ? job : null}
          onJob={setJob}
          onRefresh={refresh}
          onReview={() => setTab("review")}
        />
      </TabsContent>
    </Tabs>
  );
}
