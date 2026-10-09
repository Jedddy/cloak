"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deletePackage,
  getPackage,
  listPackages,
  listProfiles,
  listRecipients,
} from "@/lib/client/client";
import type {
  Package,
  Recipient,
  RecipientProfile,
} from "@/lib/contract/schemas";
import { formatDateTime } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  pkg: Package;
  recipientName: string;
  profileName: string;
  openFindings: number;
};

export default function PackagesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;

    async function load() {
      try {
        const [packages, recipients, profiles] = await Promise.all([
          listPackages(),
          listRecipients(),
          listProfiles(),
        ]);

        if (stale) {
          return;
        }

        const byRecipient = new Map<string, Recipient>(
          recipients.map((recipient) => [recipient.id, recipient]),
        );

        const profileNameOf = (profileId: string): string => {
          const profile: RecipientProfile | undefined = profiles.find(
            (candidate) => candidate.id === profileId,
          );

          return profile ? profile.name : "Unknown profile";
        };

        const details = await Promise.all(
          packages.map((pkg) => getPackage(pkg.id)),
        );

        if (stale) {
          return;
        }

        setRows(
          details.map((detail) => {
            const recipient = byRecipient.get(detail.package.recipientId);

            return {
              pkg: detail.package,
              recipientName: recipient ? recipient.name : "Unknown recipient",
              profileName: recipient
                ? profileNameOf(recipient.profileId)
                : "—",
              openFindings: detail.findings.filter(
                (finding) => finding.decision === "open",
              ).length,
            };
          }),
        );
      } catch (loadError) {
        if (stale) {
          return;
        }

        setError(
          loadError instanceof Error ? loadError.message : "Could not load.",
        );
      }
    }

    load();

    return () => {
      stale = true;
    };
  }, []);

  async function onDelete(id: string, name: string) {
    if (!window.confirm(`Delete package "${name}" and all its files?`)) {
      return;
    }

    setDeleting(id);

    try {
      await deletePackage(id);
      setRows((current) =>
        current ? current.filter((row) => row.pkg.id !== id) : current,
      );
      toast.success("Package deleted.");
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error ? deleteError.message : "Delete failed.",
      );
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Packages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One package per recipient handoff.
          </p>
        </div>
        <Link href="/packages/new" className={buttonVariants()}>
          New package
        </Link>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load packages</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {rows === null && !error && (
        <p className="text-sm text-muted-foreground">Loading packages…</p>
      )}

      {rows !== null && rows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No packages yet</CardTitle>
            <CardDescription>
              Assemble your first sharing package to see what it reveals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/packages/new" className={buttonVariants()}>
              New package
            </Link>
          </CardContent>
        </Card>
      )}

      {rows !== null && rows.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Open findings</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.pkg.id}>
                  <TableCell>
                    <Link
                      href={`/packages/${row.pkg.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.pkg.name}
                    </Link>
                  </TableCell>
                  <TableCell>{row.recipientName}</TableCell>
                  <TableCell>{row.profileName}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDateTime(row.pkg.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.pkg.status}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.openFindings}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete package ${row.pkg.name}`}
                      disabled={deleting === row.pkg.id}
                      onClick={() => onDelete(row.pkg.id, row.pkg.name)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
