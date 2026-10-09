"use client";

import { useState } from "react";

import { DocumentLoadState, DocumentViewer } from "@/components/document-viewer";
import { FileList } from "@/components/file-list";
import { TextViewer } from "@/components/text-viewer";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useDocumentModel, type DocumentModelState } from "@/components/use-document-model";
import {
  filePageUrl,
  getFileDocument,
  getReviewedDocument,
  originalFileUrl,
  reviewedFileUrl,
  reviewedPageUrl,
} from "@/lib/client/client";
import type { FileEntry, PackageDetail } from "@/lib/contract/schemas";

function Pane({
  title,
  description,
  file,
  url,
  detail,
  showFindings,
  available,
  document,
  pageUrl,
}: {
  title: string;
  description: string;
  file: FileEntry;
  url: string;
  detail: PackageDetail;
  showFindings: boolean;
  available: boolean;
  document: DocumentModelState;
  pageUrl: (page: number) => string;
}) {
  const documentModel = document.model;

  // PDF pages show no marks here, Office documents and text do.
  const marked = file.kind === "text" || (documentModel !== null && documentModel.format !== "pdf");

  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-col bg-sheet">
      <header className="flex h-10 shrink-0 items-baseline gap-2 border-b px-4 pt-2.5">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="truncate text-xs text-muted-foreground">
          {description}
          {showFindings && marked && ", with findings marked"}
        </span>
      </header>
      <div className="min-h-[20rem] flex-1 overflow-auto lg:min-h-0">
        {!available && (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyTitle>No reviewed copy yet</EmptyTitle>
              <EmptyDescription>
                Export the package to rebuild this file with the approved redactions. The copy
                appears here after export.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {available && file.kind === "image" && (
          <div className="p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${title}: ${file.originalName}`}
              className="mx-auto block h-auto max-w-full ring-1 ring-border"
            />
          </div>
        )}
        {available && file.kind === "text" && (
          <TextViewer
            key={url}
            fileUrl={url}
            fileName={file.originalName}
            findings={
              showFindings ? detail.findings.filter((finding) => finding.fileId === file.id) : []
            }
            selectedFindingId={null}
            onSelectFinding={() => undefined}
          />
        )}
        {available && file.kind === "document" && <DocumentLoadState state={document} />}
        {available && documentModel?.format === "pdf" && (
          <div className="flex flex-col gap-4 p-4">
            {documentModel.pages.map((pageSize, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={index}
                src={pageUrl(index + 1)}
                alt={`${title}: ${file.originalName}, page ${index + 1}`}
                loading="lazy"
                decoding="async"
                style={{
                  width: pageSize.width,
                  aspectRatio: `${pageSize.width} / ${pageSize.height}`,
                }}
                className="mx-auto block h-auto max-w-full ring-1 ring-border"
              />
            ))}
          </div>
        )}
        {available && documentModel && documentModel.format !== "pdf" && (
          <DocumentViewer
            key={url}
            model={documentModel}
            findings={
              showFindings ? detail.findings.filter((finding) => finding.fileId === file.id) : []
            }
            selectedFindingId={null}
            onSelectFinding={() => undefined}
          />
        )}
        {available && file.kind === "unsupported" && (
          <p className="p-4 text-sm text-muted-foreground">Not supported: no preview.</p>
        )}
      </div>
    </section>
  );
}

export function PreviewPanel({ packageId, detail }: { packageId: string; detail: PackageDetail }) {
  const files = detail.package.files;
  const [fileId, setFileId] = useState(files[0]?.id ?? "");
  const file = files.find((item) => item.id === fileId) ?? files[0];

  const hasReviewed = detail.package.status === "exported" || detail.verification !== null;

  // The reviewed model changes with each export; the original's with each scan.
  const fileKey = file?.kind === "document" ? file.id : null;

  const original = useDocumentModel(
    fileKey && `${fileKey}:${detail.package.status}`,
    () => getFileDocument(packageId, fileKey ?? ""),
  );

  const reviewed = useDocumentModel(
    hasReviewed && fileKey ? `${fileKey}:${detail.verification?.checkedAt}` : null,
    () => getReviewedDocument(packageId, fileKey ?? ""),
  );

  if (!file) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 lg:h-full lg:grid-cols-[16rem_minmax(0,1fr)]">
      <section
        aria-label="Files"
        className="flex min-h-0 flex-col border-b bg-sidebar lg:border-r lg:border-b-0"
      >
        <header className="flex h-10 shrink-0 items-center justify-between border-b px-4">
          <h2 className="text-sm font-medium">Files</h2>
          <span className="text-xs text-muted-foreground tabular-nums">{files.length}</span>
        </header>
        <div className="max-h-72 min-h-0 flex-1 overflow-y-auto lg:max-h-none">
          <FileList
            files={files}
            findings={detail.findings}
            selectedId={file.id}
            onSelect={setFileId}
          />
        </div>
      </section>

      {file.excluded ? (
        <Empty className="bg-sheet">
          <EmptyHeader>
            <EmptyTitle>Excluded from export</EmptyTitle>
            <EmptyDescription>
              This file is not part of the reviewed copies. The recipient does not receive it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid min-h-0 grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
          <Pane
            title="Original"
            description="Read-only"
            file={file}
            url={originalFileUrl(packageId, file.id)}
            detail={detail}
            showFindings
            available
            document={original}
            pageUrl={(page) => filePageUrl(packageId, file.id, page)}
          />
          <Pane
            title="Reviewed copy"
            description="What the recipient receives"
            file={file}
            url={reviewedFileUrl(packageId, file.id)}
            detail={detail}
            showFindings={false}
            available={hasReviewed}
            document={reviewed}
            pageUrl={(page) => reviewedPageUrl(packageId, file.id, page)}
          />
        </div>
      )}
    </div>
  );
}
