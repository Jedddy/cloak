"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FormSection } from "@/components/form-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  createPackage,
  listProfiles,
  listRecipients,
  saveProfile,
  saveRecipient,
  uploadFile,
} from "@/lib/client/client";
import {
  CategorySchema,
  UPLOAD_LIMITS,
  type Category,
  type Recipient,
  type RecipientProfile,
} from "@/lib/contract/schemas";
import { categoryLabel, cn, formatBytes, plural } from "@/lib/utils";
import { Check, FileText, Image as ImageIcon, Upload, X } from "lucide-react";
import { toast } from "sonner";

type Bucket = "allowed" | "needsDecision" | "remove";

const buckets: { value: Bucket; label: string }[] = [
  { value: "allowed", label: "Allowed" },
  { value: "needsDecision", label: "Needs decision" },
  { value: "remove", label: "Remove" },
];

const segmentItemClass =
  "flex-1 rounded-md! text-muted-foreground hover:bg-background/60 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs";

export default function NewPackagePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<RecipientProfile[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const [recipientMode, setRecipientMode] = useState<"select" | "create">("select");

  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [newRecipientName, setNewRecipientName] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [termInput, setTermInput] = useState("");
  const [terms, setTerms] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const [editingProfile, setEditingProfile] = useState<RecipientProfile | null>(null);

  const [editBuckets, setEditBuckets] = useState<Partial<Record<Category, Bucket>>>({});
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    let stale = false;
    Promise.all([listProfiles(), listRecipients()])
      .then(([nextProfiles, nextRecipients]) => {
        if (stale) {
          return;
        }

        setProfiles(nextProfiles);
        setRecipients(nextRecipients);

        if (nextProfiles.length > 0) {
          setProfileId(nextProfiles[0].id);
        }

        if (nextRecipients.length > 0) {
          setRecipientId(nextRecipients[0].id);
        } else {
          setRecipientMode("create");
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
  }, []);

  const selectedRecipient = recipients?.find((recipient) => recipient.id === recipientId) ?? null;

  const activeProfileId = recipientMode === "select" ? selectedRecipient?.profileId : profileId;

  const activeProfile: RecipientProfile | null =
    profiles?.find((profile) => profile.id === activeProfileId) ?? null;

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  function addTerm() {
    const term = termInput.trim();

    if (term !== "" && !terms.includes(term)) {
      setTerms((current) => [...current, term]);
    }

    setTermInput("");
  }

  function addFiles(incoming: FileList | null) {
    if (!incoming) {
      return;
    }

    const accepted: File[] = [];

    for (const file of Array.from(incoming)) {
      if (file.size > UPLOAD_LIMITS.maxFileBytes) {
        toast.error(`"${file.name}" is larger than 25 MB and was skipped.`);
        continue;
      }

      accepted.push(file);
    }

    if (files.length + accepted.length > UPLOAD_LIMITS.maxFilesPerPackage) {
      toast.error(
        `A package holds up to ${UPLOAD_LIMITS.maxFilesPerPackage} files. The rest were skipped.`,
      );
    }

    setFiles((current) => [...current, ...accepted].slice(0, UPLOAD_LIMITS.maxFilesPerPackage));
  }

  function openProfileEditor(profile: RecipientProfile) {
    const next: Partial<Record<Category, Bucket>> = {};

    for (const bucket of buckets) {
      for (const category of profile[bucket.value]) {
        next[category] = bucket.value;
      }
    }

    for (const category of CategorySchema.options) {
      next[category] ??= "needsDecision";
    }

    if (next.secret === "allowed") {
      next.secret = "needsDecision";
    }

    setEditBuckets(next);
    setEditingProfile(profile);
  }

  async function onSaveProfile() {
    if (!editingProfile) {
      return;
    }

    setSavingProfile(true);

    const inBucket = (bucket: Bucket) =>
      CategorySchema.options.filter((category) => editBuckets[category] === bucket);

    try {
      const next = await saveProfile({
        id: editingProfile.id,
        name: editingProfile.name,
        description: editingProfile.description,
        allowed: inBucket("allowed"),
        needsDecision: inBucket("needsDecision"),
        remove: inBucket("remove"),
      });

      setProfiles((current) =>
        current ? current.map((profile) => (profile.id === next.id ? next : profile)) : current,
      );
      setEditingProfile(null);
      toast.success("Profile updated.");
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function onCreate() {
    if (creating) return;

    if (name.trim() === "") {
      setError("Give the package a name.");

      return;
    }

    setCreating(true);
    setError(null);

    try {
      let resolvedRecipientId = recipientId;

      if (recipientMode === "create") {
        if (newRecipientName.trim() === "" || !profileId) {
          setError("Name the recipient and pick a profile.");
          setCreating(false);

          return;
        }

        const created = await saveRecipient({
          name: newRecipientName.trim(),
          profileId,
        });

        resolvedRecipientId = created.id;
      }

      if (!resolvedRecipientId) {
        setError("Pick or create a recipient.");
        setCreating(false);

        return;
      }

      const pkg = await createPackage({
        name: name.trim(),
        recipientId: resolvedRecipientId,
        protectedTerms: [...new Set([...terms, termInput.trim()].filter(Boolean))],
      });

      for (const [index, file] of files.entries()) {
        setProgress(`Uploading ${index + 1} of ${files.length}`);
        await uploadFile(pkg.id, file);
      }

      setProgress(null);
      toast.success("Package created.");
      router.push(`/packages/${pkg.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create failed.");
      setProgress(null);
      setCreating(false);
    }
  }

  if (profiles === null || recipients === null) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load recipients</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </>
        )}
      </div>
    );
  }

  const recipientLabel =
    recipientMode === "select" ? selectedRecipient?.name : newRecipientName.trim();

  return (
    <form
      className="flex min-h-full flex-col"
      aria-label="New package"
      aria-busy={creating}
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate();
      }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">New package</h1>
          <p className="text-sm text-muted-foreground">
            Name it, pick who receives it, and add the files you plan to send.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not create the package</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <fieldset disabled={creating} className="flex min-w-0 flex-col">
          <FormSection
            title="Package"
            description="Name it after the handoff, so that you can find it later."
          >
            <Field>
              <FieldLabel htmlFor="package-name">Name</FieldLabel>
              <Input
                id="package-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Contractor handoff"
                autoComplete="off"
              />
            </Field>
          </FormSection>

          <FormSection
            title="Recipient"
            description="The recipient's profile sets the suggested action for each category of finding."
          >
            {recipients.length > 0 && (
              <ToggleGroup
                value={[recipientMode]}
                onValueChange={(value: string[]) => {
                  if (value[0] === "select" || value[0] === "create") {
                    setRecipientMode(value[0]);
                  }
                }}
                spacing={0}
                size="sm"
                aria-label="Recipient source"
                className="w-full max-w-xs rounded-md bg-muted p-0.5"
              >
                <ToggleGroupItem value="select" className={segmentItemClass}>
                  Saved recipient
                </ToggleGroupItem>
                <ToggleGroupItem value="create" className={segmentItemClass}>
                  New recipient
                </ToggleGroupItem>
              </ToggleGroup>
            )}

            {recipientMode === "select" && recipients.length > 0 ? (
              <Field>
                <FieldLabel htmlFor="recipient">Recipient</FieldLabel>
                <Select
                  items={recipients.map((recipient) => ({
                    value: recipient.id,
                    label: recipient.name,
                  }))}
                  value={recipientId ?? ""}
                  onValueChange={(value: string | null) => setRecipientId(value)}
                >
                  <SelectTrigger id="recipient" className="w-full">
                    <SelectValue placeholder="Pick a recipient" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {recipients.map((recipient) => (
                        <SelectItem key={recipient.id} value={recipient.id}>
                          {recipient.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="recipient-name">Recipient name</FieldLabel>
                  <Input
                    id="recipient-name"
                    required
                    value={newRecipientName}
                    onChange={(event) => setNewRecipientName(event.target.value)}
                    placeholder="Northwind Studio"
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile">Profile</FieldLabel>
                  <Select
                    items={profiles.map((profile) => ({
                      value: profile.id,
                      label: profile.name,
                    }))}
                    value={profileId ?? ""}
                    onValueChange={(value: string | null) => setProfileId(value)}
                  >
                    <SelectTrigger id="profile" className="w-full">
                      <SelectValue placeholder="Pick a profile" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {profiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            )}

            {activeProfile && (
              <div className="rounded-lg border bg-card">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 break-words">
                    <p className="text-sm font-medium">{activeProfile.name}</p>
                    {activeProfile.description && (
                      <p className="text-sm text-muted-foreground">{activeProfile.description}</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openProfileEditor(activeProfile)}
                  >
                    Edit profile
                  </Button>
                </div>
                <dl className="divide-y">
                  {buckets.map((bucket) => (
                    <div
                      key={bucket.value}
                      className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4"
                    >
                      <dt className="text-xs font-medium leading-5 text-muted-foreground">
                        {bucket.label}
                      </dt>
                      <dd className="min-w-0 text-sm leading-5">
                        {activeProfile[bucket.value].length === 0 ? (
                          <span className="text-muted-foreground">None</span>
                        ) : (
                          activeProfile[bucket.value].map(categoryLabel).join(", ")
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </FormSection>

          <FormSection
            title="Files"
            description="PNG, JPEG, and text files such as .txt, .md, .json, .csv, .env, .log, and .yaml. Other types are listed as not supported."
          >
            <label
              htmlFor="file-drop"
              onDragOver={(event) => {
                event.preventDefault();

                if (!creating) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);

                if (!creating) addFiles(event.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center transition-colors duration-150 hover:bg-accent/50 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                dragging && "border-primary bg-selection hover:bg-selection",
              )}
            >
              <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">
                {dragging ? "Drop to add the files" : "Drop files here or click to browse"}
              </span>
              <span className="text-xs text-muted-foreground">
                Up to 25 MB each, up to {UPLOAD_LIMITS.maxFilesPerPackage} files.
              </span>
              <input
                id="file-drop"
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            {files.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{plural(files.length, "file")}</span>
                  <span>{formatBytes(totalBytes)}</span>
                </div>
                <ul className="overflow-hidden rounded-lg border bg-card">
                  {files.map((file, index) => {
                    const Icon = file.type.startsWith("image/") ? ImageIcon : FileText;

                    return (
                      <li
                        key={`${file.name}-${file.size}-${index}`}
                        className="flex items-center gap-3 border-b py-1.5 pr-1.5 pl-3 text-sm last:border-b-0"
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span
                          title={file.name}
                          className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]"
                        >
                          {file.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatBytes(file.size)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setFiles((current) => current.filter((_, other) => other !== index))
                          }
                        >
                          <X />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </FormSection>

          <FormSection
            title="Protected terms (optional)"
            description="Words that are sensitive in this package only, such as a project codename. Every occurrence becomes a finding."
          >
            <Field>
              <FieldLabel htmlFor="protected-term">Term</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="protected-term"
                  value={termInput}
                  onChange={(event) => setTermInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTerm();
                    }
                  }}
                  placeholder="Project Juniper"
                  autoComplete="off"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    variant="secondary"
                    size="xs"
                    onClick={addTerm}
                    disabled={!termInput.trim()}
                  >
                    Add
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            {terms.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Protected terms">
                {terms.map((term) => (
                  <li key={term} className="max-w-full">
                    <Badge
                      variant="secondary"
                      className="h-auto min-h-7 max-w-full gap-1 py-0.5 pr-1 font-mono"
                    >
                      <span className="min-w-0 break-all whitespace-normal">{term}</span>
                      <button
                        type="button"
                        aria-label={`Remove term ${term}`}
                        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          setTerms((current) => current.filter((item) => item !== term))
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </FormSection>
        </fieldset>
      </div>

      <div className="sticky bottom-0 border-t bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-stretch justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium" title={name.trim() || "Untitled package"}>
              {name.trim() || "Untitled package"}
            </p>
            <p
              className="truncate text-xs text-muted-foreground tabular-nums"
              title={recipientLabel || undefined}
            >
              {recipientLabel && `For ${recipientLabel} · `}
              {plural(files.length, "file")}
              {files.length > 0 && ` · ${formatBytes(totalBytes)}`}
              {terms.length > 0 && ` · ${plural(terms.length, "protected term")}`}
            </p>
          </div>
          <span role="status" className="sr-only">
            {creating ? (progress ?? "Creating…") : ""}
          </span>
          <Button type="submit" disabled={creating} className="min-w-36">
            {creating && <Spinner data-icon="inline-start" />}
            {creating ? (progress ?? "Creating…") : "Create package"}
          </Button>
        </div>
      </div>

      <Dialog
        open={editingProfile !== null}
        onOpenChange={(open: boolean) => {
          if (!open && !savingProfile) {
            setEditingProfile(null);
          }
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
          showCloseButton={!savingProfile}
        >
          <DialogHeader>
            <DialogTitle>
              {editingProfile ? `Edit ${editingProfile.name}` : "Edit profile"}
            </DialogTitle>
            <DialogDescription>
              Put each category in one bucket. The bucket sets the suggested action for findings of
              that category. This changes the profile for every recipient that uses it.
            </DialogDescription>
          </DialogHeader>
          <ul className="-mx-1 flex min-h-0 max-h-[55dvh] flex-col overflow-y-auto px-1">
            {CategorySchema.options.map((category) => (
              <li
                key={category}
                className="flex flex-col items-start gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{categoryLabel(category)}</span>
                  {category === "secret" && (
                    <p id="secret-bucket-help" className="mt-1 text-xs text-muted-foreground">
                      Secrets cannot be allowed.
                    </p>
                  )}
                </div>
                <ToggleGroup
                  value={editBuckets[category] ? [editBuckets[category]] : []}
                  onValueChange={(value: string[]) => {
                    const bucket = buckets.find((item) => item.value === value[0]);

                    if (!bucket) return;

                    setEditBuckets((current) => ({
                      ...current,
                      [category]: bucket.value,
                    }));
                  }}
                  disabled={savingProfile}
                  spacing={1}
                  size="sm"
                  aria-label={`Bucket for ${categoryLabel(category)}`}
                  aria-describedby={category === "secret" ? "secret-bucket-help" : undefined}
                  className="grid w-full shrink-0 grid-cols-[1fr_1.5fr_1fr] rounded-lg border bg-muted/50 p-1 sm:w-88"
                >
                  {buckets.map((bucket) => (
                    <ToggleGroupItem
                      key={bucket.value}
                      value={bucket.value}
                      disabled={category === "secret" && bucket.value === "allowed"}
                      className="h-9 min-w-0 gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:bg-background/60 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs sm:h-8"
                    >
                      <Check
                        aria-hidden="true"
                        className="hidden size-3 shrink-0 group-aria-pressed/toggle:block"
                      />
                      {bucket.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingProfile(null)}
              disabled={savingProfile}
            >
              Cancel
            </Button>
            <Button onClick={onSaveProfile} disabled={savingProfile}>
              {savingProfile && <Spinner data-icon="inline-start" />}
              Save profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
