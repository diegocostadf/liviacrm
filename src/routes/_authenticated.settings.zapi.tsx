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
import { PlugZap, Save, AlertTriangle, CheckCircle2, Send, Zap } from "lucide-react";

type Settings = {
  instanceId: string;
  instanceToken: string;
  hasInstanceToken: boolean;
  clientToken: string;
  hasClientToken: boolean;
  webhookUrl: string;
  updatedAt: string | null;
};

type PingResult =
  | { ok: true; latencyMs: number; connected: boolean; session: string | null; smartphoneConnected: boolean }
  | { ok: false; error: string };

type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

async function callApi<T>(method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");
  const res = await fetch("/api/zapi-settings", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Erro");
  return payload as T;
}

export const Route = createFileRoute("/_authenticated/settings/zapi")({
  head: () => ({ meta: [{ title: "Configurações Z-API — Lívia CRM" }] }),
  component: ZapiSettingsPage,
});

function ZapiSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "zapi"],
    queryFn: () => callApi<{ settings: Settings }>("GET"),
  });

  const [form, setForm] = useState<Settings | null>(null);
  const [ping, setPing] = useState<PingResult | null>(null);
  const [toPhone, setToPhone] = useState("");
  const [text, setText] = useState("Olá! Teste da Lívia CRM via Z-API.");
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data?.settings]);

  const save = useMutation({
    mutationFn: () =>
      callApi<{ settings: Settings }>("POST", {
        action: "update",
        instanceId: form?.instanceId ?? "",
        instanceToken: form?.instanceToken ?? "",
        clientToken: form?.clientToken ?? "",
        webhookUrl: form?.webhookUrl || undefined,
      }),
    onSuccess: () => {
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["settings", "zapi"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const test = useMutation({
    mutationFn: () => callApi<PingResult>("POST", { action: "test" }),
    onSuccess: (r) => {
      setPing(r);
      if (r.ok) toast.success(`Z-API ${r.connected ? "conectada" : "acessível"} em ${r.latencyMs}ms`);
      else toast.error(r.error);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro";
      setPing({ ok: false, error: msg });
      toast.error(msg);
    },
  });

  const send = useMutation({
    mutationFn: () => callApi<SendResult>("POST", { action: "send-test", toPhone, text }),
    onSuccess: (r) => {
      setSendResult(r);
      if (r.ok) toast.success(`Enviado (${r.id ?? "sem id"})`);
      else toast.error(r.error);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
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

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/public/webhooks/zapi`
    : "/api/public/webhooks/zapi";

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Configurações · Z-API</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Conecte seu WhatsApp via <span className="font-mono">z-api.io</span>. Credenciais ficam em <span className="font-mono">app.z-api.io</span> → sua instância.
          </p>
          {form.updatedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Última atualização: {new Date(form.updatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Credenciais da instância</h2>
            <p className="text-xs text-muted-foreground">
              Copie os valores em <span className="font-mono">app.z-api.io</span> → Instâncias → sua instância.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="instanceId">Instance ID</Label>
            <Input
              id="instanceId"
              placeholder="Ex.: 3B12345ABCDE6789F0"
              value={form.instanceId}
              onChange={(e) => setForm({ ...form, instanceId: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instanceToken">Instance Token</Label>
            <Input
              id="instanceToken"
              type="password"
              placeholder={form.hasInstanceToken ? "Deixe em branco para manter o atual" : "Token da instância"}
              value={form.instanceToken === "••••••••" ? "" : form.instanceToken}
              onChange={(e) => setForm({ ...form, instanceToken: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clientToken">Client-Token (Account Security Token)</Label>
            <Input
              id="clientToken"
              type="password"
              placeholder={form.hasClientToken ? "Deixe em branco para manter o atual" : "Token de segurança da conta"}
              value={form.clientToken === "••••••••" ? "" : form.clientToken}
              onChange={(e) => setForm({ ...form, clientToken: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatório quando a instância tem "Account Security Token" habilitado.
            </p>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Webhook de recebimento</h2>
            <p className="text-xs text-muted-foreground">
              Configure esta URL no painel Z-API em <span className="font-mono">Webhook → Ao receber</span>.
            </p>
          </div>
          <div className="space-y-2">
            <Label>URL do webhook interno</Label>
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">URL alternativa (opcional)</Label>
            <Input
              id="webhookUrl"
              placeholder="https://…"
              value={form.webhookUrl}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
            />
          </div>
        </Card>

        {ping && (
          <Card className={`p-4 ${ping.ok ? "border-success/40" : "border-destructive/40"}`}>
            <div className="flex items-start gap-3">
              {ping.ok
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />}
              <div className="flex-1 text-sm">
                {ping.ok ? (
                  <>
                    <div className="font-medium">Z-API acessível ({ping.latencyMs}ms)</div>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <div>Sessão: {ping.session ?? "—"}</div>
                      <div>Conectada: {ping.connected ? "sim" : "não"}</div>
                      <div>Smartphone conectado: {ping.smartphoneConnected ? "sim" : "não"}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium text-destructive">Falha na conexão</div>
                    <div className="mt-1 break-words font-mono text-xs text-muted-foreground">{ping.error}</div>
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
          <Button onClick={() => save.mutate()} disabled={save.isPending || !form.instanceId}>
            <Save className="mr-2 h-4 w-4" /> {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Enviar mensagem de teste</h2>
            <p className="text-xs text-muted-foreground">Salve as credenciais antes de testar o envio.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="toPhone">Telefone destino (com DDI)</Label>
              <Input id="toPhone" placeholder="5511999998888" value={toPhone} onChange={(e) => setToPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="text">Mensagem</Label>
              <Input id="text" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => send.mutate()} disabled={send.isPending || !toPhone || !text}>
              <Send className="mr-2 h-4 w-4" /> {send.isPending ? "Enviando…" : "Enviar teste"}
            </Button>
          </div>
          {sendResult && (
            <div className={`text-xs ${sendResult.ok ? "text-success" : "text-destructive"}`}>
              {sendResult.ok ? `Enviado. ID: ${sendResult.id ?? "—"}` : sendResult.error}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}