import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { PlugZap, Save, AlertTriangle, CheckCircle2 } from "lucide-react";

type Settings = {
  apiUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  webhookUrl: string;
  webhookToken: string;
  hasWebhookToken: boolean;
  webhookEvents: string[];
  updatedAt: string | null;
};

type TestResult =
  | { ok: true; baseUrl: string; latencyMs: number; version: string | null; message: string | null }
  | { ok: false; error: string };

const DEFAULT_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "CONTACTS_UPSERT",
];

async function callApi<T>(method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");
  const res = await fetch("/api/settings", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Erro");
  return payload as T;
}

export const Route = createFileRoute("/_authenticated/settings/evolution")({
  head: () => ({ meta: [{ title: "Configurações Evolution — Lívia CRM" }] }),
  component: EvolutionSettingsPage,
});

function EvolutionSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "evolution"],
    queryFn: () => callApi<{ settings: Settings }>("GET"),
  });

  const [form, setForm] = useState<Settings | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data?.settings]);

  const save = useMutation({
    mutationFn: () =>
      callApi<{ settings: Settings }>("POST", {
        action: "update",
        apiUrl: form?.apiUrl ?? "",
        apiKey: form?.apiKey ?? "",
        webhookUrl: form?.webhookUrl || undefined,
        webhookToken: form?.webhookToken ?? "",
        webhookEvents: form?.webhookEvents?.length ? form.webhookEvents : DEFAULT_EVENTS,
      }),
    onSuccess: () => {
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["settings", "evolution"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const test = useMutation({
    mutationFn: () => callApi<TestResult>("POST", { action: "test" }),
    onSuccess: (r) => {
      setTestResult(r);
      if (r.ok) toast.success(`Evolution OK em ${r.latencyMs}ms`);
      else toast.error(r.error);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro";
      setTestResult({ ok: false, error: msg });
      toast.error(msg);
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive/40 p-4 text-sm">
          <AlertTriangle className="mb-2 h-5 w-5 text-destructive" />
          {error instanceof Error ? error.message : "Erro ao carregar configurações."}
        </Card>
      </div>
    );
  }
  if (!form) return null;

  const eventsText = (form.webhookEvents?.length ? form.webhookEvents : DEFAULT_EVENTS).join(", ");

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configurações · Evolution API</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie credenciais e webhook diretamente pelo painel. Acesso restrito a administradores.
          </p>
          {form.updatedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Última atualização: {new Date(form.updatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Credenciais</h2>
            <p className="text-xs text-muted-foreground">URL base e API Key da sua instância Evolution.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiUrl">URL da API</Label>
            <Input
              id="apiUrl"
              placeholder="https://evolution.seudominio.com"
              value={form.apiUrl}
              onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder={form.hasApiKey ? "Deixe em branco para manter a atual" : "Sua API key"}
              value={form.apiKey === "••••••••" ? "" : form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
            {form.hasApiKey && <p className="text-xs text-muted-foreground">Uma chave já está configurada. Preencha para substituir.</p>}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Webhook global</h2>
            <p className="text-xs text-muted-foreground">
              Usado por padrão ao criar instâncias. Se vazio, o sistema usa o endpoint interno automaticamente.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">URL do Webhook (opcional)</Label>
            <Input
              id="webhookUrl"
              placeholder="https://liviacrm.lovable.app/api/public/webhooks/evolution"
              value={form.webhookUrl}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhookToken">Token do Webhook</Label>
            <Input
              id="webhookToken"
              type="password"
              placeholder={form.hasWebhookToken ? "Deixe em branco para manter o atual" : "Token de validação"}
              value={form.webhookToken === "••••••••" ? "" : form.webhookToken}
              onChange={(e) => setForm({ ...form, webhookToken: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="events">Eventos (separados por vírgula)</Label>
            <Input
              id="events"
              value={eventsText}
              onChange={(e) =>
                setForm({
                  ...form,
                  webhookEvents: e.target.value
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean),
                })
              }
            />
            <p className="text-xs text-muted-foreground">Padrão: {DEFAULT_EVENTS.join(", ")}</p>
          </div>
        </Card>

        {testResult && (
          <Card className={`p-4 ${testResult.ok ? "border-success/40" : "border-destructive/40"}`}>
            <div className="flex items-start gap-3">
              {testResult.ok
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />}
              <div className="flex-1 text-sm">
                {testResult.ok ? (
                  <>
                    <div className="font-medium">Evolution acessível</div>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <div>URL: <span className="font-mono">{testResult.baseUrl}</span></div>
                      <div>Latência: {testResult.latencyMs}ms</div>
                      {testResult.version && <div>Versão: {testResult.version}</div>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium text-destructive">Falha na conexão</div>
                    <div className="mt-1 break-words font-mono text-xs text-muted-foreground">{testResult.error}</div>
                  </>
                )}
              </div>
            </div>
          </Card>
        )}

        <Separator />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
            <PlugZap className="mr-2 h-4 w-4" /> {test.isPending ? "Testando…" : "Testar conexão"}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !form.apiUrl}>
            <Save className="mr-2 h-4 w-4" /> {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}