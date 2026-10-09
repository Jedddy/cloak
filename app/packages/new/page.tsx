"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  createPackage,
  listProfiles,
  listRecipients,
  saveProfile,
  saveRecipient,
  uploadFile,
} from "@/lib/client/client";
import {
  UPLOAD_LIMITS,
  type Category,
  type RecipientProfile,
} from "@/lib/contract/schemas";
import { formatBytes } from "@/lib/utils";
import { X } from "lucide-react";
import { toast } from "sonner";

const allCategories: Category[] = [
  "secret",
  "personal-contact",
  "personal-id",
  "other-client",
  "protected-term",
  "internal-pricing",
  "internal-infra",
  "unreleased-work",
  "metadata",
  "hidden-data",
  "prompt-injection",
  "other",
];

function CategoryList({
  title,
  items,
}: {
  title: string;
  items: Category[];
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {items.map((category) => (
            <li key={category}>
              <Badge variant="outline">{category}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NewPackagePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<RecipientProfile[] | null>(null);
  const [recipients, setRecipients] = useState<
    { id: string; name: string; profileId: string }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [recipientMode, setRecipientMode] = useState<"select" | "create">(
    "select",
  );
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [newRecipientName, setNewRecipientName] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [termInput, setTermInput] = useState("");
  const [terms, setTerms] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<RecipientProfile | null>(null);
  const [editAllowed, setEditAllowed] = useState<Category[]>([]);
  const [editNeedsDecision, setEditNeedsDecision] = useState<Category[]>([]);
  const [editRemove, setEditRemove] = useState<Category[]>([]);
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

  const activeProfile: RecipientProfile | null =
    profiles?.find((profile) => profile.id === profileId) ?? null;

  function addTerm() {
    const term = termInput.trim();
    if (term === "" || terms.includes(term)) {
      setTermInput("");
      return;
    }
    setTerms((current) => [...current, term]);
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
    setFiles((current) =>
      [...current, ...accepted].slice(0, UPLOAD_LIMITS.maxFilesPerPackage),
    );
  }

  function openProfileEditor(profile: RecipientProfile) {
    setEditingProfile(profile);
    setEditAllowed([...profile.allowed]);
    setEditNeedsDecision([...profile.needsDecision]);
    setEditRemove([...profile.remove]);
  }

  function toggleBucket(
    list: Category[],
    setList: (next: Category[]) => void,
    category: Category,
  ) {
    setList(
      list.includes(category)
        ? list.filter((item) => item !== category)
        : [...list, category],
    );
  }

  async function onSaveProfile() {
    if (!editingProfile) {
      return;
    }
    setSavingProfile(true);
    try {
      const next = await saveProfile({
        id: editingProfile.id,
        name: editingProfile.name,
        description: editingProfile.description,
        allowed: editAllowed,
        needsDecision: editNeedsDecision,
        remove: editRemove,
      });
      setProfiles((current) =>
        current
          ? current.map((profile) =>
              profile.id === next.id ? next : profile,
            )
          : current,
      );
      setEditingProfile(null);
      toast.success("Profile updated.");
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Could not save.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function onCreate() {
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
        protectedTerms: terms,
      });
      for (const [index, file] of files.entries()) {
        setProgress(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        await uploadFile(pkg.id, file);
      }
      setProgress(null);
      toast.success("Package created.");
      router.push(`/packages/${pkg.id}`);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Create failed.",
      );
      setProgress(null);
      setCreating(false);
    }
  }

  if (profiles === null || recipients === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {error ?? "Loading…"}
      </p>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New package</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Name it, pick who receives it, and drop the files.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not create the package</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Package</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="package-name">Name</Label>
            <Input
              id="package-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Contractor handoff"
              autoComplete="off"
            />
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <Label>Recipient</Label>
            {recipients.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant={recipientMode === "select" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRecipientMode("select")}
                >
                  Saved recipient
                </Button>
                <Button
                  variant={recipientMode === "create" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRecipientMode("create")}
                >
                  New recipient
                </Button>
              </div>
            )}
            {recipientMode === "select" && recipients.length > 0 ? (
              <Select
                value={recipientId ?? ""}
                onValueChange={(value: string | null) => setRecipientId(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a recipient" />
                </SelectTrigger>
                <SelectContent>
                  {recipients.map((recipient) => (
                    <SelectItem key={recipient.id} value={recipient.id}>
                      {recipient.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="recipient-name">Recipient name</Label>
                  <Input
                    id="recipient-name"
                    value={newRecipientName}
                    onChange={(event) =>
                      setNewRecipientName(event.target.value)
                    }
                    placeholder="Northwind Studio"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Profile</Label>
                  <Select
                    value={profileId ?? ""}
                    onValueChange={(value: string | null) => setProfileId(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {activeProfile && recipientMode === "create" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>{activeProfile.name}</CardTitle>
                    <CardDescription>
                      {activeProfile.description}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openProfileEditor(activeProfile)}
                  >
                    Edit profile
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <CategoryList title="Allowed" items={activeProfile.allowed} />
                <CategoryList
                  title="Needs decision"
                  items={activeProfile.needsDecision}
                />
                <CategoryList title="Remove" items={activeProfile.remove} />
              </CardContent>
            </Card>
          )}

          <Separator />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="protected-term">Protected terms</Label>
            <div className="flex gap-2">
              <Input
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
              <Button variant="outline" onClick={addTerm}>
                Add
              </Button>
            </div>
            {terms.length > 0 && (
              <ul className="flex flex-wrap gap-1">
                {terms.map((term) => (
                  <li key={term}>
                    <Badge variant="secondary">
                      {term}
                      <button
                        type="button"
                        aria-label={`Remove term ${term}`}
                        className="ml-1 rounded-sm hover:text-foreground"
                        onClick={() =>
                          setTerms((current) =>
                            current.filter((item) => item !== term),
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label htmlFor="file-drop">Files</Label>
            <label
              htmlFor="file-drop"
              className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-input px-4 py-8 text-center transition-colors hover:bg-muted"
            >
              <span className="text-sm font-medium">
                Drop files here or click to browse
              </span>
              <span className="text-xs text-muted-foreground">
                PNG, JPEG, and text files · up to 25 MB each · up to 50 files
              </span>
            </label>
            <Input
              id="file-drop"
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {files.length > 0 && (
              <ul className="flex flex-col gap-1">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[0.8125rem]">
                        {file.name}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {file.type === "" ? "unknown type" : file.type} ·{" "}
                        {formatBytes(file.size)}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, other) => other !== index),
                        )
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onCreate} disabled={creating}>
              {creating
                ? (progress ?? "Creating…")
                : "Create package and upload"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={editingProfile !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setEditingProfile(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProfile ? `Edit ${editingProfile.name}` : "Edit profile"}
            </DialogTitle>
            <DialogDescription>
              Buckets set the suggested action for each finding category.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-4 overflow-y-auto">
            {(
              [
                ["Allowed", editAllowed, setEditAllowed],
                ["Needs decision", editNeedsDecision, setEditNeedsDecision],
                ["Remove", editRemove, setEditRemove],
              ] as const
            ).map(([title, list, setList]) => (
              <div key={title}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {title}
                </p>
                <ul className="grid grid-cols-2 gap-1.5">
                  {allCategories.map((category) => (
                    <li key={category}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm">
                        <Checkbox
                          checked={list.includes(category)}
                          onCheckedChange={() =>
                            toggleBucket(list, setList, category)
                          }
                        />
                        <span className="font-mono text-xs">{category}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingProfile(null)}
              disabled={savingProfile}
            >
              Cancel
            </Button>
            <Button onClick={onSaveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
