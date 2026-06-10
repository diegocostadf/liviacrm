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
  accountSid: string;
  authToken: string;
  hasAuthToken: boolean;
  apiKeySid: string;
  apiKeySecret: string;
  hasApiKeySecret: boolean;
  fromNumber: string;
  messagingServiceSid: string;
  whatsappFrom: string;
  contentSid: string;
  contentVariableKey: string;
  webhookUrl: string;
  webhookToken: string;
  hasWebhookToken: boolean;
  updatedAt: string | null;
};

type TestResult =
  | { ok: true; latencyMs: number; friendlyName: string | null; status: string | null; accountSid: string }
  | { ok: false; error: string };

async function callApi<T>(method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");
  const res = await fetch("/api/twilio-settings", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Erro");
  return payload as T;
}

export const Route = createFileRoute("/_authenticated/settings/twilio")({
  head: () => ({ meta: [{ title: "Configurações Twilio — Lívia CRM" }] }),
  component: TwilioSettingsPage,
});

function TwilioSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "twilio"],
    queryFn: () => callApi<{ settings: Settings }>("GET"),
  });

  const [form, setForm] = useState<Settings | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => { if (data?.settings) setForm(data.settings); }, [data?.settings]);

  const save = useMutation({
    mutationFn: () =>
      callApi<{ settings: Settings }>("POST", {
        action: "update",
        accountSid: form?.accountSid ?? "",
        authToken: form?.authToken ?? "",
        apiKeySid: form?.apiKeySid ?? "",
        apiKeySecret: form?.apiKeySecret ?? "",
        fromNumber: form?.fromNumber ?? "",
        messagingServiceSid: form?.messagingServiceSid ?? "",
        whatsappFrom: form?.whatsappFrom ?? "",
        contentSid: form?.contentSid ?? "",
        contentVariableKey: form?.contentVariableKey ?? "",
        webhookUrl: form?.webhookUrl ?? "",
        webhookToken: form?.webhookToken ?? "",
      }),
    onSuccess: () => {
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["settings", "twilio"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const test = useMutation({
    mutationFn: () => callApi<TestResult>("POST", { action: "test" }),
    onSuccess: (r) => {
      setTestResult(r);
      if (r.ok) toast.success(`Twilio OK em ${r.latencyMs}ms`);
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

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configurações · Twilio</h1>
          <p className="text-sm text-muted-foreground">
            Integração alternativa ao Evolution para disparo de mensagens via SMS e WhatsApp Business.
            Acesso restrito a administradores.
          </p>
          {form.updatedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Última atualização: {new Date(form.updatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Credenciais da conta</h2>
            <p className="text-xs text-muted-foreground">
              Encontre em <span className="font-mono">console.twilio.com</span> → Account → API keys & tokens.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountSid">Account SID</Label>
            <Input
              id="accountSid"
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={form.accountSid}
              onChange={(e) => setForm({ ...form, accountSid: e.target.value.trim() })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="authToken">Auth Token</Label>
            <Input
              id="authToken"
              type="password"
              placeholder={form.hasAuthToken ? "Deixe em branco para manter o atual" : "Auth token da conta principal"}
              value={form.authToken === "••••••••" ? "" : form.authToken}
              onChange={(e) => setForm({ ...form, authToken: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Opcional se você preencher um par API Key SID/Secret abaixo (recomendado para produção).
            </p>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">API Key (recomendado)</h2>
            <p className="text-xs text-muted-foreground">
              Crie uma API Key restrita em Twilio → Account → API keys para evitar usar o Auth Token raiz.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="apiKeySid">API Key SID</Label>
              <Input
                id="apiKeySid"
                placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={form.apiKeySid}
                onChange={(e) => setForm({ ...form, apiKeySid: e.target.value.trim() })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKeySecret">API Key Secret</Label>
              <Input
                id="apiKeySecret"
                type="password"
                placeholder={form.hasApiKeySecret ? "Deixe em branco para manter o atual" : "Secret da API Key"}
                value={form.apiKeySecret === "••••••••" ? "" : form.apiKeySecret}
                onChange={(e) => setForm({ ...form, apiKeySecret: e.target.value })}
              />
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Remetente padrão</h2>
            <p className="text-xs text-muted-foreground">
              Use o número Twilio para SMS ou o sender do WhatsApp Business. Você pode preencher ambos.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fromNumber">Número SMS (E.164)</Label>
            <Input
              id="fromNumber"
              placeholder="+15558675310"
              value={form.fromNumber}
              onChange={(e) => setForm({ ...form, fromNumber: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="messagingServiceSid">Messaging Service SID (opcional)</Label>
            <Input
              id="messagingServiceSid"
              placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={form.messagingServiceSid}
              onChange={(e) => setForm({ ...form, messagingServiceSid: e.target.value.trim() })}
            />
            <p className="text-xs text-muted-foreground">Se preenchido, o sistema usa o serviço no lugar do número direto.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="whatsappFrom">Remetente WhatsApp</Label>
            <Input
              id="whatsappFrom"
              placeholder="whatsapp:+14155238886"
              value={form.whatsappFrom}
              onChange={(e) => setForm({ ...form, whatsappFrom: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Use o prefixo <span className="font-mono">whatsapp:</span> seguido do número aprovado.</p>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Template aprovado (Content API)</h2>
            <p className="text-xs text-muted-foreground">
              Necessário para iniciar conversas no WhatsApp fora da janela de 24h. Crie o template em
              Twilio → Content Editor e copie o <span className="font-mono">Content SID</span> (começa com <span className="font-mono">HX…</span>).
              Se preenchido, o texto da campanha é injetado na variável definida abaixo.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <Label htmlFor="contentSid">Content SID padrão</Label>
              <Input
                id="contentSid"
                placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={form.contentSid}
                onChange={(e) => setForm({ ...form, contentSid: e.target.value.trim() })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contentVariableKey">Variável p/ texto</Label>
              <Input
                id="contentVariableKey"
                placeholder="1"
                value={form.contentVariableKey}
                onChange={(e) => setForm({ ...form, contentVariableKey: e.target.value.trim() })}
              />
              <p className="text-xs text-muted-foreground">Padrão: <span className="font-mono">1</span></p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Equivalente ao SDK: <span className="font-mono">{`contentSid: 'HX…', contentVariables: '{"1":"<texto>"}'`}</span>.
            Deixe em branco para enviar como mensagem livre (<span className="font-mono">Body</span>).
          </p>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Webhook de entrada</h2>
            <p className="text-xs text-muted-foreground">
              Configure no Twilio para receber respostas e status de entrega. Use o token para validar a assinatura.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">URL do Webhook</Label>
            <Input
              id="webhookUrl"
              placeholder="https://liviacrm.lovable.app/api/public/webhooks/twilio"
              value={form.webhookUrl}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhookToken">Token / Assinatura</Label>
            <Input
              id="webhookToken"
              type="password"
              placeholder={form.hasWebhookToken ? "Deixe em branco para manter o atual" : "Token compartilhado"}
              value={form.webhookToken === "••••••••" ? "" : form.webhookToken}
              onChange={(e) => setForm({ ...form, webhookToken: e.target.value })}
            />
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
                    <div className="font-medium">Twilio acessível</div>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <div>Conta: <span className="font-mono">{testResult.accountSid}</span></div>
                      {testResult.friendlyName && <div>Nome: {testResult.friendlyName}</div>}
                      {testResult.status && <div>Status: {testResult.status}</div>}
                      <div>Latência: {testResult.latencyMs}ms</div>
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
          <Button onClick={() => save.mutate()} disabled={save.isPending || !form.accountSid}>
            <Save className="mr-2 h-4 w-4" /> {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}