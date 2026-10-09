"use client";

import { TextViewer } from "@/components/text-viewer";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  originalFileUrl,
  reviewedFileUrl,
} from "@/lib/client/client";
import type { PackageDetail } from "@/lib/contract/schemas";

export function PreviewPanel({
  packageId,
  detail,
}: {
  packageId: string;
  detail: PackageDetail;
}) {
  const hasReviewed =
    detail.package.status === "exported" || detail.verification !== null;

  return (
    <div className="flex flex-col gap-3">
      {!hasReviewed && (
        <p className="text-sm text-muted-foreground">
          Reviewed copies appear here after the first export. The left side
          always shows the original.
        </p>
      )}
      {detail.package.files.map((file) => (
        <Card key={file.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-mono text-sm font-medium">
                {file.originalName}
              </CardTitle>
              {file.excluded && <Badge variant="outline">excluded</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {file.excluded ? (
              <p className="text-sm text-muted-foreground">
                Excluded from export. It will not be part of the reviewed
                copies.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Original
                  </p>
                  {file.kind === "image" ? (
                    <div className="overflow-auto rounded-lg border border-border bg-sheet">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={originalFileUrl(packageId, file.id)}
                        alt={`Original ${file.originalName}`}
                        className="block max-h-[50vh] w-auto max-w-full"
                      />
                    </div>
                  ) : file.kind === "text" ? (
                    <div className="rounded-lg border border-border bg-sheet p-3">
                      <TextViewer
                        fileUrl={originalFileUrl(packageId, file.id)}
                        fileName={file.originalName}
                        findings={detail.findings.filter(
                          (finding) => finding.fileId === file.id,
                        )}
                        selectedFindingId={null}
                        onSelectFinding={() => undefined}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Not supported: no preview.
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Reviewed copy
                  </p>
                  {!hasReviewed ? (
                    <p className="text-sm text-muted-foreground">
                      Not exported yet.
                    </p>
                  ) : file.kind === "image" ? (
                    <div className="overflow-auto rounded-lg border border-border bg-sheet">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={reviewedFileUrl(packageId, file.id)}
                        alt={`Reviewed ${file.originalName}`}
                        className="block max-h-[50vh] w-auto max-w-full"
                      />
                    </div>
                  ) : file.kind === "text" ? (
                    <div className="rounded-lg border border-border bg-sheet p-3">
                      <TextViewer
                        fileUrl={reviewedFileUrl(packageId, file.id)}
                        fileName={file.originalName}
                        findings={[]}
                        selectedFindingId={null}
                        onSelectFinding={() => undefined}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Not supported: no preview.
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
