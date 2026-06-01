import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PlugZap, Save, AlertTriangle, CheckCircle2, QrCode, Power, RefreshCw, Webhook } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Settings = {
  apiUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  webhookUrl: string;
  webhookToken: string;
  hasWebhookToken: boolean;
  webhookEvents: string[];
  defaultInstance: string;
  updatedAt: string | null;
};
type WhatsappInstance = Tables<"whatsapp_instances">;

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

async function callConnections<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");
  const res = await fetch("/api/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
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
        defaultInstance: form?.defaultInstance || "",
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

        <DefaultInstanceCard
          value={form.defaultInstance}
          onChange={(v) => setForm({ ...form, defaultInstance: v })}
        />

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

function DefaultInstanceCard({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["instances"],
    queryFn: () => callConnections<{ instances: WhatsappInstance[]; syncError: string | null }>({ action: "sync" }),
    refetchInterval: 8000,
  });
  const instances = data?.instances ?? [];
  const selected = instances.find((i) => i.evolution_instance_name === value) ?? null;

  const [qr, setQr] = useState<{ base64: string | null; code: string | null } | null>(null);

  const connect = useMutation({
    mutationFn: (name: string) =>
      callConnections<{ qrBase64: string | null; pairingCode: string | null }>({ action: "connect", name }),
    onSuccess: (r) => setQr({ base64: r.qrBase64, code: r.pairingCode }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const disconnect = useMutation({
    mutationFn: (name: string) => callConnections<{ ok: boolean }>({ action: "disconnect", name }),
    onSuccess: () => { toast.success("Desconectado"); qc.invalidateQueries({ queryKey: ["instances"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const refresh = useMutation({
    mutationFn: (name: string) => callConnections<{ status: string }>({ action: "status", name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instances"] }),
  });
  const setWebhook = useMutation({
    mutationFn: (name: string) => callConnections<{ ok: boolean; url: string }>({ action: "setWebhook", name }),
    onSuccess: (r) => toast.success(`Webhook aplicado: ${r.url}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  // Poll status while QR open
  useEffect(() => {
    if (!qr || !value) return;
    const id = setInterval(async () => {
      try {
        const r = await callConnections<{ status: string }>({ action: "status", name: value });
        if (r.status === "connected") {
          toast.success("Conectado!");
          setQr(null);
          qc.invalidateQueries({ queryKey: ["instances"] });
        }
      } catch { /* noop */ }
    }, 3000);
    return () => clearInterval(id);
  }, [qr, value, qc]);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">Instância padrão do sistema</h2>
        <p className="text-xs text-muted-foreground">
          Escolha qual instância da Evolution o sistema usará por padrão (ex.: <span className="font-mono">livia</span>).
        </p>
      </div>

      <div className="space-y-2">
        <Label>Instância</Label>
        <div className="flex items-center gap-2">
          <Select value={value || undefined} onValueChange={onChange} disabled={isLoading}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={isLoading ? "Carregando…" : "Selecione uma instância"} />
            </SelectTrigger>
            <SelectContent>
              {instances.map((i) => (
                <SelectItem key={i.id} value={i.evolution_instance_name}>
                  {i.evolution_instance_name} {i.phone_number ? `· ${i.phone_number}` : ""}
                </SelectItem>
              ))}
              {instances.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  Nenhuma instância encontrada. Crie uma em <span className="font-medium">Conexões</span>.
                </div>
              )}
            </SelectContent>
          </Select>
          {selected && <StatusBadge status={selected.status} />}
        </div>
        {data?.syncError && (
          <p className="text-xs text-destructive">Falha ao sincronizar: {data.syncError}</p>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {selected.status !== "connected" ? (
            <Button size="sm" onClick={() => connect.mutate(selected.evolution_instance_name)} disabled={connect.isPending}>
              <QrCode className="mr-1.5 h-3.5 w-3.5" />
              {connect.isPending ? "Gerando QR…" : "Conectar (mostrar QR)"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => disconnect.mutate(selected.evolution_instance_name)} disabled={disconnect.isPending}>
              <Power className="mr-1.5 h-3.5 w-3.5" /> Desconectar
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => refresh.mutate(selected.evolution_instance_name)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar status
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWebhook.mutate(selected.evolution_instance_name)} disabled={setWebhook.isPending}>
            <Webhook className="mr-1.5 h-3.5 w-3.5" /> {setWebhook.isPending ? "Aplicando…" : "Aplicar webhook"}
          </Button>
          {selected.profile_name && (
            <span className="text-xs text-muted-foreground">{selected.profile_name}</span>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Não esqueça de clicar em <span className="font-medium">Salvar</span> ao alterar a instância padrão.
      </p>

      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Conecte seu WhatsApp</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {qr?.base64 ? (
              <img
                src={qr.base64.startsWith("data:") ? qr.base64 : `data:image/png;base64,${qr.base64}`}
                alt="QR Code"
                className="h-64 w-64 rounded-lg border border-border"
              />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                Gerando QR…
              </div>
            )}
            {qr?.code && <div className="text-xs text-muted-foreground">Código: <span className="font-mono">{qr.code}</span></div>}
            <p className="text-center text-xs text-muted-foreground">
              Abra WhatsApp → Aparelhos conectados → Conectar aparelho
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    connected: { label: "Conectado", variant: "default" },
    connecting: { label: "Conectando", variant: "secondary" },
    disconnected: { label: "Desconectado", variant: "outline" },
    error: { label: "Erro", variant: "destructive" },
  };
  const cfg = map[status] ?? map.disconnected;
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}