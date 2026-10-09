"use client";

import { useEffect, useState } from "react";

import { LocalityBadge } from "@/components/locality-badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  getSettings,
  saveSettings,
  testSettings,
} from "@/lib/client/client";
import type {
  ConnectionTestResult,
  SettingsResponse,
} from "@/lib/contract/schemas";
import { hostnameOf, modeLabel } from "@/lib/utils";
import { toast } from "sonner";

export default function SettingsPage() {
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

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const timeout = Number.parseInt(timeoutMs, 10);
      const next = await saveSettings({
        baseUrl: baseUrl.trim(),
        textModel: textModel.trim() === "" ? null : textModel.trim(),
        visionModel: visionModel.trim() === "" ? null : visionModel.trim(),
        timeoutMs: Number.isNaN(timeout) ? 60_000 : timeout,
      });
      setSettings(next);
      toast.success("Settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save.",
      );
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
      setError(
        testError instanceof Error ? testError.message : "Test failed.",
      );
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }

  if (error && settings === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load settings</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where the model runs. The API key is set from the environment only
          and never shown here.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Model server</CardTitle>
          <CardDescription>
            Any OpenAI-compatible server on this machine or the local network.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="base-url">Base URL</Label>
            <Input
              id="base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://127.0.0.1:11434/v1"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="text-model">Text model</Label>
              <Input
                id="text-model"
                value={textModel}
                onChange={(event) => setTextModel(event.target.value)}
                placeholder="gemma4:e4b"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vision-model">Vision model</Label>
              <Input
                id="vision-model"
                value={visionModel}
                onChange={(event) => setVisionModel(event.target.value)}
                placeholder="gemma4:e4b"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timeout">Request timeout (ms)</Label>
            <Input
              id="timeout"
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">API key:</span>
            {settings?.apiKeySet ? (
              <Badge variant="secondary">Set in environment</Badge>
            ) : (
              <Badge variant="outline">Not set</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Button variant="outline" onClick={onTest} disabled={testing}>
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {test && (
              <LocalityBadge
                locality={test.locality}
                host={hostnameOf(baseUrl)}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {test && (
        <Card>
          <CardHeader>
            <CardTitle>Connection test</CardTitle>
            <CardDescription>
              {test.ok ? "The server answered." : "The server did not answer."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Mode:</span>
              <Badge variant="secondary">{modeLabel(test.mode)}</Badge>
              <span className="text-muted-foreground">Latency:</span>
              <span className="font-mono tabular-nums">
                {test.latencyMs === null ? "—" : `${test.latencyMs} ms`}
              </span>
            </div>
            <Separator />
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Models ({test.models.length})
              </p>
              {test.models.length === 0 ? (
                <p className="text-muted-foreground">No models listed.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {test.models.map((model) => (
                    <li key={model} className="font-mono text-[0.8125rem]">
                      {model}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Separator />
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                JSON test
              </p>
              <p>
                {test.jsonTest.ok ? (
                  <Badge variant="secondary">Valid JSON</Badge>
                ) : (
                  <Badge variant="destructive">Invalid JSON</Badge>
                )}
              </p>
              {test.jsonTest.error && (
                <p className="mt-1 text-muted-foreground">
                  {test.jsonTest.error}
                </p>
              )}
            </div>
            {test.error && (
              <>
                <Separator />
                <p className="text-destructive">{test.error}</p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
