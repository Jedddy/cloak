"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { LocalityBadge } from "@/components/locality-badge";
import { ExportPanel } from "@/components/export-panel";
import { PreviewPanel } from "@/components/preview-panel";
import { ReviewPanel } from "@/components/review-panel";
import { ScanPanel } from "@/components/scan-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getJob,
  getPackage,
  getSettings,
} from "@/lib/client/client";
import type {
  Job,
  PackageDetail,
  SettingsResponse,
} from "@/lib/contract/schemas";
import { hostnameOf, modeLabel } from "@/lib/utils";

export function PackageWorkspace() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("scan");

  const refresh = useCallback(async () => {
    const next = await getPackage(id);
    setDetail(next);
  }, [id]);

  useEffect(() => {
    let stale = false;
    Promise.all([getPackage(id), getSettings()])
      .then(([nextDetail, nextSettings]) => {
        if (stale) {
          return;
        }

        setDetail(nextDetail);
        setSettings(nextSettings);
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
      <Alert variant="destructive">
        <AlertTitle>Could not load the package</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (detail === null) {
    return <p className="text-sm text-muted-foreground">Loading package…</p>;
  }

  const coverage = detail.coverage;

  const remoteHost =
    settings && coverage?.locality === "remote"
      ? hostnameOf(settings.baseUrl)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {detail.package.name}
        </h1>
        <Badge variant="secondary">{detail.package.status}</Badge>
        {coverage && (
          <>
            <Badge variant="outline">
              Mode: {modeLabel(coverage.mode)}
            </Badge>
            <LocalityBadge
              locality={coverage.locality}
              host={remoteHost}
            />
          </>
        )}
      </div>

      {detail.interrupted && (
        <Alert>
          <AlertTitle>Last run was interrupted</AlertTitle>
          <AlertDescription>
            The server stopped during the last scan or export. Start a new
            scan to continue.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="scan">Scan</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>
        <TabsContent value="scan">
          <ScanPanel
            packageId={id}
            detail={detail}
            job={job && job.kind === "scan" ? job : null}
            remoteHost={
              settings ? hostnameOf(settings.baseUrl) : null
            }
            onJob={setJob}
            onRefresh={refresh}
            onReview={() => setTab("review")}
          />
        </TabsContent>
        <TabsContent value="review">
          <ReviewPanel packageId={id} detail={detail} onRefresh={refresh} />
        </TabsContent>
        <TabsContent value="preview">
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
    </div>
  );
}
