"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { FormSection } from "@/components/form-section";
import { LocalityBadge } from "@/components/locality-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { getSettings, saveSettings, testSettings } from "@/lib/client/client";
import type { ConnectionTestResult, SettingsResponse } from "@/lib/contract/schemas";
import { hostnameOf, modeLabel } from "@/lib/utils";
import { CircleCheck, CircleX } from "lucide-react";
import { toast } from "sonner";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4 px-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [textModel, setTextModel] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("60000");
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    getSettings()
      .then((next) => {
        if (stale) {
          return;
        }

        setSettings(next);
        setBaseUrl(next.baseUrl);
        setTextModel(next.textModel ?? "");
        setVisionModel(next.visionModel ?? "");
        setTimeoutMs(String(next.timeoutMs));
        setLoading(false);
      })
      .catch((loadError: Error) => {
        if (stale) {
          return;
        }

        setError(loadError.message);
        setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, []);

  const dirty =
    settings !== null &&
    (baseUrl.trim() !== settings.baseUrl ||
      textModel.trim() !== (settings.textModel ?? "") ||
      visionModel.trim() !== (settings.visionModel ?? "") ||
      timeoutMs.trim() !== String(settings.timeoutMs));

  async function onSave() {
    setSaving(true);
    setError(null);

    try {
      const timeout = Number(timeoutMs);

      const next = await saveSettings({
        baseUrl: baseUrl.trim(),
        textModel: textModel.trim() === "" ? null : textModel.trim(),
        visionModel: visionModel.trim() === "" ? null : visionModel.trim(),
        timeoutMs: timeout,
      });

      setSettings(next);
      setBaseUrl(next.baseUrl);
      setTextModel(next.textModel ?? "");
      setVisionModel(next.visionModel ?? "");
      setTimeoutMs(String(next.timeoutMs));
      setTest(null);
      router.refresh();
      toast.success("Settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setError(null);

    try {
      setTest(await testSettings());
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Test failed.");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
    );
  }

  if (error && settings === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <Alert variant="destructive">
          <AlertTitle>Could not load settings</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Where the model runs. Files go only to the model server you set here.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
      >
        <fieldset disabled={saving || testing} className="flex min-w-0 flex-col">
          <FormSection
            title="Model server"
            description="Any OpenAI-compatible server on this machine or the local network, for example Ollama or LM Studio."
          >
            <Field>
              <FieldLabel htmlFor="base-url">Base URL</FieldLabel>
              <Input
                id="base-url"
                type="url"
                required
                aria-describedby="server-help"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:11434/v1"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-[0.8125rem]"
              />
              <FieldDescription id="server-help">
                A server that is not on this machine or the local network counts as remote. Each
                package then asks for your confirmation before it sends files.
              </FieldDescription>
            </Field>
          </FormSection>

          <FormSection
            title="Models"
            description="The model names as the server lists them. Test the connection to see the list."
          >
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="text-model">Text model</FieldLabel>
                <Input
                  id="text-model"
                  aria-describedby="text-model-help"
                  value={textModel}
                  onChange={(event) => setTextModel(event.target.value)}
                  placeholder="gemma4:e4b"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-[0.8125rem]"
                />
                <FieldDescription id="text-model-help">
                  Analyzes text and extracted screenshot text.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="vision-model">Vision model</FieldLabel>
                <Input
                  id="vision-model"
                  aria-describedby="vision-model-help"
                  value={visionModel}
                  onChange={(event) => setVisionModel(event.target.value)}
                  placeholder="gemma4:e4b"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-[0.8125rem]"
                />
                <FieldDescription id="vision-model-help">
                  Analyzes image regions. Leave blank if unavailable.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FormSection>

          <FormSection
            title="Requests"
            description="How long Cloak waits for one answer from the model server."
          >
            <Field className="max-w-60">
              <FieldLabel htmlFor="timeout">Request timeout</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="timeout"
                  type="number"
                  min={1}
                  step={1}
                  required
                  aria-describedby="timeout-help"
                  value={timeoutMs}
                  onChange={(event) => setTimeoutMs(event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  className="tabular-nums"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>ms</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription id="timeout-help">60,000 ms = 1 minute.</FieldDescription>
            </Field>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">API key</p>
              <p className="text-sm text-muted-foreground">
                {settings?.apiKeySet
                  ? "Set in the environment (LLM_API_KEY). It is never shown here."
                  : "Not set. Local servers usually do not need one. Set LLM_API_KEY in the environment if yours does."}
              </p>
            </div>
          </FormSection>

          <div className="flex flex-wrap items-center gap-2 border-t pt-6 md:pl-[calc(15rem+2.5rem)]">
            <Button type="submit" disabled={saving || testing || !dirty}>
              {saving && <Spinner data-icon="inline-start" />}
              Save settings
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onTest}
              disabled={saving || testing || dirty}
            >
              {testing && <Spinner data-icon="inline-start" />}
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (!settings) return;
                  setBaseUrl(settings.baseUrl);
                  setTextModel(settings.textModel ?? "");
                  setVisionModel(settings.visionModel ?? "");
                  setTimeoutMs(String(settings.timeoutMs));
                  setError(null);
                }}
              >
                Discard changes
              </Button>
            )}
            <p role="status" className="w-full text-xs text-muted-foreground">
              {dirty
                ? "Unsaved changes. Save before testing the connection."
                : "Settings saved. Test the connection to check model availability."}
            </p>
          </div>
        </fieldset>
      </form>

      {test && !dirty && (
        <section
          aria-labelledby="test-title"
          className="flex flex-col gap-3 md:pl-[calc(15rem+2.5rem)]"
        >
          <div className="flex items-center gap-2">
            {test.ok ? (
              <CircleCheck className="size-4 text-primary" />
            ) : (
              <CircleX className="size-4 text-destructive" />
            )}
            <h2 id="test-title" className="text-sm font-medium">
              {test.ok ? "The server answered." : "The server did not answer."}
            </h2>
          </div>
          <dl className="divide-y overflow-hidden rounded-lg border bg-card">
            <Row label="Location">
              <LocalityBadge locality={test.locality} host={hostnameOf(baseUrl)} />
            </Row>
            <Row label="Scan mode">{modeLabel(test.mode)}</Row>
            <Row label="Latency">
              <span className="font-mono tabular-nums">
                {test.latencyMs === null ? "—" : `${Math.round(test.latencyMs)} ms`}
              </span>
            </Row>
            <Row label="JSON test">
              {test.jsonTest.ok ? (
                "Valid JSON"
              ) : (
                <span className="text-destructive">Invalid JSON</span>
              )}
              {test.jsonTest.error && (
                <span className="mt-0.5 block text-muted-foreground">{test.jsonTest.error}</span>
              )}
            </Row>
            <Row label={`Models (${test.models.length})`}>
              {test.models.length === 0 ? (
                <span className="text-muted-foreground">No models listed.</span>
              ) : (
                <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                  {test.models.map((model) => (
                    <li key={model} className="shrink-0 truncate font-mono text-[0.8125rem]">
                      {model}
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            {test.error && (
              <Row label="Error">
                <span className="text-destructive">{test.error}</span>
              </Row>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}
