"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
import type { Package, Recipient } from "@/lib/contract/schemas";
import { cn, formatDateTime, openFindingsOf, plural, sentenceCase } from "@/lib/utils";
import { FolderOpen, Plus, Search, Trash2 } from "lucide-react";
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Package | null>(null);

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

        const details = await Promise.all(packages.map((pkg) => getPackage(pkg.id)));

        if (stale) {
          return;
        }

        setRows(
          details.map((detail) => {
            const recipient = byRecipient.get(detail.package.recipientId);

            const profile = profiles.find((candidate) => candidate.id === recipient?.profileId);

            return {
              pkg: detail.package,
              recipientName: recipient ? recipient.name : "Unknown recipient",
              profileName: profile ? profile.name : "No profile",
              openFindings: openFindingsOf(detail.findings),
            };
          }),
        );
      } catch (loadError) {
        if (stale) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Could not load.");
      }
    }

    load();

    return () => {
      stale = true;
    };
  }, []);

  const search = query.trim().toLocaleLowerCase();

  const visibleRows =
    rows?.filter((row) => {
      if (filter === "open" && row.openFindings === 0) return false;

      if (filter === "exported" && row.pkg.status !== "exported") return false;

      return `${row.pkg.name} ${row.recipientName} ${row.profileName}`
        .toLocaleLowerCase()
        .includes(search);
    }) ?? [];

  async function onDelete() {
    if (!pendingDelete) {
      return;
    }

    const { id } = pendingDelete;

    setDeleting(true);

    try {
      await deletePackage(id);
      setRows((current) => (current ? current.filter((row) => row.pkg.id !== id) : current));
      toast.success("Package deleted.");
      setPendingDelete(null);
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Packages</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Each package is the set of files for one recipient. Scan it, decide on each finding,
            then export reviewed copies.
          </p>
        </div>
        {rows?.length !== 0 && (
          <Link href="/packages/new" className={buttonVariants()}>
            <Plus data-icon="inline-start" />
            New package
          </Link>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load packages</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {rows === null && !error && (
        <div className="flex flex-col gap-px overflow-hidden rounded-lg border">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center gap-6 bg-card px-4 py-3.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <Empty className="border bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>No packages yet</EmptyTitle>
            <EmptyDescription>
              Add the files you plan to send and pick who receives them. Cloak shows what the files
              reveal to that recipient.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link href="/packages/new" className={buttonVariants()}>
              <Plus data-icon="inline-start" />
              New package
            </Link>
          </EmptyContent>
        </Empty>
      )}

      {rows !== null && rows.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Your packages">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <InputGroup className="sm:max-w-xs">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search packages"
                placeholder="Search packages or recipients…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
            <ToggleGroup
              value={[filter]}
              onValueChange={(value: string[]) => {
                if (value[0]) setFilter(value[0]);
              }}
              spacing={0}
              size="sm"
              aria-label="Filter packages"
              className="w-fit max-w-full rounded-md bg-muted p-0.5"
            >
              {[
                { value: "all", label: "All packages" },
                { value: "open", label: "Open findings" },
                { value: "exported", label: "Exported" },
              ].map((item) => (
                <ToggleGroupItem
                  key={item.value}
                  value={item.value}
                  className="rounded-md text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground"
                >
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p role="status" className="text-xs text-muted-foreground tabular-nums">
            {visibleRows.length} of {plural(rows.length, "package")}
          </p>
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table className="table-fixed sm:table-auto">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 pl-4 text-xs text-muted-foreground">Package</TableHead>
                  <TableHead className="hidden h-9 text-xs text-muted-foreground sm:table-cell">
                    Recipient
                  </TableHead>
                  <TableHead className="h-9 w-28 text-xs text-muted-foreground sm:w-auto">
                    Status
                  </TableHead>
                  <TableHead className="hidden h-9 text-right text-xs text-muted-foreground sm:table-cell">
                    Open findings
                  </TableHead>
                  <TableHead className="hidden h-9 text-right text-xs text-muted-foreground md:table-cell">
                    Created
                  </TableHead>
                  <TableHead className="h-9 w-12 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => {
                  const scanned = row.pkg.lastScan !== null;

                  const busy = row.pkg.status === "scanning" || row.pkg.status === "exporting";

                  return (
                    <TableRow key={row.pkg.id} className="group relative">
                      <TableCell className="py-3 pl-4">
                        <Link
                          href={`/packages/${row.pkg.id}`}
                          className="block font-medium break-words whitespace-normal outline-none sm:truncate after:absolute after:inset-0 focus-visible:underline"
                        >
                          {row.pkg.name}
                        </Link>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {plural(row.pkg.files.length, "file")}
                        </p>
                        <p className="truncate text-xs text-muted-foreground sm:hidden">
                          For {row.recipientName}
                        </p>
                      </TableCell>
                      <TableCell className="hidden py-3 sm:table-cell">
                        <p>{row.recipientName}</p>
                        <p className="text-xs text-muted-foreground">{row.profileName}</p>
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="inline-flex items-center gap-2">
                          {busy ? (
                            <Spinner className="size-3 text-muted-foreground" />
                          ) : (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "size-1.5 rounded-full bg-muted-foreground/50",
                                scanned && row.openFindings > 0 && "bg-warning",
                                row.pkg.status === "exported" &&
                                  row.openFindings === 0 &&
                                  "bg-primary",
                              )}
                            />
                          )}
                          {sentenceCase(row.pkg.status)}
                        </span>
                        <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                          {scanned ? `${row.openFindings} open findings` : "Not scanned"}
                        </p>
                      </TableCell>
                      <TableCell className="hidden py-3 text-right tabular-nums sm:table-cell">
                        {!scanned && <span className="text-muted-foreground">Not scanned</span>}
                        {scanned && row.openFindings === 0 && (
                          <span className="text-muted-foreground">None</span>
                        )}
                        {scanned && row.openFindings > 0 && (
                          <span className="font-medium">{row.openFindings}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden py-3 text-right text-muted-foreground tabular-nums md:table-cell">
                        {formatDateTime(row.pkg.createdAt)}
                      </TableCell>
                      <TableCell className="py-3 pr-4 text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="relative z-10 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
                          aria-label={`Delete package ${row.pkg.name}`}
                          onClick={() => setPendingDelete(row.pkg)}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {visibleRows.length === 0 && (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyTitle>No matching packages</EmptyTitle>
                  <EmptyDescription>
                    Try another name or clear the search and filter.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </div>
        </section>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open: boolean) => {
          if (!open && !deleting) {
            setPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the package, its uploaded originals, its decisions, and any reviewed
              copies. Files on your disk outside Cloak are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={onDelete}>
              {deleting && <Spinner data-icon="inline-start" />}
              Delete package
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
