import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  PlugZap, Save, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
  Search, Send, Database, Sparkles, Loader2,
} from "lucide-react";

type Settings = {
  accountSid: string;
  authToken: string; hasAuthToken: boolean;
  apiKeySid: string;
  apiKeySecret: string; hasApiKeySecret: boolean;
  fromNumber: string;
  messagingServiceSid: string;
  whatsappFrom: string;
  contentSid: string;
  contentVariableKey: string;
  webhookUrl: string;
  webhookToken: string; hasWebhookToken: boolean;
  updatedAt: string | null;
};

type DiscoverResult = {
  ok: true;
  latencyMs: number;
  account: { sid: string; friendlyName: string | null; status: string | null; type: string | null };
  numbers: Array<{ sid: string; phoneNumber: string; friendlyName: string; capabilities: Record<string, boolean> }>;
  whatsappSenders: Array<{ sid: string; phoneNumber: string; status: string; profileName: string }>;
  services: Array<{ sid: string; friendlyName: string }>;
  contents: Array<{ sid: string; friendlyName: string; language: string; variables: Record<string, string> }>;
  warnings: string[];
};

type SendTestResult = { ok: true; sid: string | null; status: string | null; latencyMs: number } | { ok: false; error: string; latencyMs: number };
type CrmTestResult = { ok: boolean; latencyMs: number; checks: Array<{ name: string; ok: boolean; detail?: string }> };
type PingResult = { ok: true; latencyMs: number; friendlyName: string | null; status: string | null; accountSid: string } | { ok: false; error: string };

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
  component: TwilioWizardPage,
});

const STEPS = [
  { n: 1, label: "Credenciais", icon: PlugZap },
  { n: 2, label: "Descobrir conta", icon: Search },
  { n: 3, label: "Remetente", icon: Send },
  { n: 4, label: "Template & Webhook", icon: Sparkles },
  { n: 5, label: "Testes", icon: CheckCircle2 },
] as const;

function TwilioWizardPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "twilio"],
    queryFn: () => callApi<{ settings: Settings }>("GET"),
  });

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Settings | null>(null);
  const [discovery, setDiscovery] = useState<DiscoverResult | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendText, setSendText] = useState("Olá! Teste do Lívia CRM via Twilio.");
  const [useTemplate, setUseTemplate] = useState(false);
  const [sendResult, setSendResult] = useState<SendTestResult | null>(null);
  const [crmResult, setCrmResult] = useState<CrmTestResult | null>(null);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);

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
    onSuccess: (r) => {
      toast.success("Configurações salvas");
      if (r?.settings) setForm(r.settings);
      qc.invalidateQueries({ queryKey: ["settings", "twilio"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const ping = useMutation({
    mutationFn: () => callApi<PingResult>("POST", { action: "test" }),
    onSuccess: (r) => { setPingResult(r); r.ok ? toast.success(`Twilio OK em ${r.latencyMs}ms`) : toast.error(r.error); },
    onError: (e) => { const msg = e instanceof Error ? e.message : "Erro"; setPingResult({ ok: false, error: msg }); toast.error(msg); },
  });

  const discover = useMutation({
    mutationFn: () => callApi<DiscoverResult>("POST", {
      action: "discover",
      accountSid: form?.accountSid ?? "",
      authToken: form?.authToken ?? "",
      apiKeySid: form?.apiKeySid ?? "",
      apiKeySecret: form?.apiKeySecret ?? "",
    }),
    onSuccess: (r) => { setDiscovery(r); toast.success(`Conta autenticada em ${r.latencyMs}ms`); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao autenticar"),
  });

  const sendTest = useMutation({
    mutationFn: () => callApi<SendTestResult>("POST", {
      action: "send-test", toPhone: sendTo, text: sendText, useTemplate,
    }),
    onSuccess: (r) => { setSendResult(r); r.ok ? toast.success(`Mensagem enviada (${r.sid ?? "sem SID"})`) : toast.error(r.error); },
    onError: (e) => { const msg = e instanceof Error ? e.message : "Erro"; setSendResult({ ok: false, error: msg, latencyMs: 0 }); toast.error(msg); },
  });

  const crmTest = useMutation({
    mutationFn: () => callApi<CrmTestResult>("POST", { action: "crm-test" }),
    onSuccess: (r) => { setCrmResult(r); r.ok ? toast.success(`CRM saudável (${r.latencyMs}ms)`) : toast.error("Alguma verificação do CRM falhou"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const canAdvance = useMemo(() => {
    if (!form) return false;
    if (step === 1) return form.accountSid.startsWith("AC") && (form.hasAuthToken || form.authToken || (form.apiKeySid && (form.hasApiKeySecret || form.apiKeySecret)));
    if (step === 2) return Boolean(discovery?.account.sid);
    if (step === 3) return Boolean(form.whatsappFrom || form.fromNumber || form.messagingServiceSid);
    return true;
  }, [form, step, discovery]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (error) return (
    <div className="p-6"><Card className="border-destructive/40 p-4 text-sm">
      <AlertTriangle className="mb-2 h-5 w-5 text-destructive" />
      {error instanceof Error ? error.message : "Erro ao carregar."}
    </Card></div>
  );
  if (!form) return null;

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configurações · Twilio</h1>
          <p className="text-sm text-muted-foreground">Assistente passo a passo para conectar, descobrir números e templates, e validar envio.</p>
          {form.updatedAt && <p className="mt-1 text-xs text-muted-foreground">Última atualização: {new Date(form.updatedAt).toLocaleString()}</p>}
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 overflow-x-auto">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.n; const done = step > s.n;
            return (
              <div key={s.n} className="flex items-center gap-2">
                <button
                  onClick={() => setStep(s.n)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition ${
                    active ? "border-primary bg-primary/10 text-foreground" :
                    done ? "border-success/40 bg-success/5 text-foreground" :
                    "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> <span className="font-mono">{s.n}.</span> {s.label}
                </button>
                {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-base font-semibold">1 · Credenciais</h2>
              <p className="text-xs text-muted-foreground">Encontre em console.twilio.com → Account → API keys & tokens. Use API Key (recomendado) ou Auth Token raiz.</p>
            </div>
            <div className="space-y-2">
              <Label>Account SID</Label>
              <Input placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={form.accountSid}
                onChange={(e) => setForm({ ...form, accountSid: e.target.value.trim() })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Auth Token <span className="text-muted-foreground">(opcional)</span></Label>
                <Input type="password" placeholder={form.hasAuthToken ? "Mantém o atual" : "Auth token raiz"}
                  value={form.authToken === "••••••••" ? "" : form.authToken}
                  onChange={(e) => setForm({ ...form, authToken: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>API Key SID <span className="text-muted-foreground">(recomendado)</span></Label>
                <Input placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={form.apiKeySid}
                  onChange={(e) => setForm({ ...form, apiKeySid: e.target.value.trim() })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>API Key Secret</Label>
                <Input type="password" placeholder={form.hasApiKeySecret ? "Mantém o atual" : "Secret da API Key"}
                  value={form.apiKeySecret === "••••••••" ? "" : form.apiKeySecret}
                  onChange={(e) => setForm({ ...form, apiKeySecret: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => ping.mutate()} disabled={ping.isPending || !form.accountSid}>
                {ping.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Testar conexão
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending || !form.accountSid}>
                {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salvar
              </Button>
            </div>
            {pingResult && <PingBlock r={pingResult} />}
          </Card>
        )}

        {step === 2 && (
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-base font-semibold">2 · Autenticar & descobrir</h2>
              <p className="text-xs text-muted-foreground">Conectamos no Twilio com suas credenciais e listamos automaticamente seus números, Messaging Services e templates aprovados.</p>
            </div>
            <Button onClick={() => discover.mutate()} disabled={discover.isPending}>
              {discover.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Autenticar e descobrir
            </Button>
            {discovery && (
              <div className="space-y-3 text-sm">
                <div className="rounded-md border bg-card/40 p-3">
                  <div className="font-medium">{discovery.account.friendlyName ?? discovery.account.sid}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{discovery.account.status ?? "—"}</Badge>
                    <Badge variant="outline">{discovery.account.type ?? "—"}</Badge>
                    <span>{discovery.latencyMs}ms</span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="Números" value={discovery.numbers.length} />
                  <Stat label="Messaging Services" value={discovery.services.length} />
                  <Stat label="Templates (Content)" value={discovery.contents.length} />
                </div>
                {discovery.warnings.length > 0 && (
                  <Card className="border-warning/40 p-3 text-xs">
                    {discovery.warnings.map((w, i) => <div key={i} className="text-muted-foreground">⚠ {w}</div>)}
                  </Card>
                )}
              </div>
            )}
          </Card>
        )}

        {step === 3 && (
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-base font-semibold">3 · Remetente</h2>
              <p className="text-xs text-muted-foreground">Escolha um dos números/serviços descobertos. Pode preencher mais de um para usar SMS + WhatsApp.</p>
            </div>

            <div className="space-y-2">
              <Label>WhatsApp From</Label>
              {discovery && discovery.numbers.length > 0 && (
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={form.whatsappFrom}
                  onChange={(e) => setForm({ ...form, whatsappFrom: e.target.value })}>
                  <option value="">— escolha um número —</option>
                  {discovery.numbers.map((n) => (
                    <option key={n.sid} value={`whatsapp:${n.phoneNumber}`}>{n.phoneNumber} · {n.friendlyName}</option>
                  ))}
                </select>
              )}
              <Input placeholder="whatsapp:+14155238886" value={form.whatsappFrom}
                onChange={(e) => setForm({ ...form, whatsappFrom: e.target.value })} />
              <p className="text-xs text-muted-foreground">Use prefixo <span className="font-mono">whatsapp:</span> + número aprovado.</p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Número SMS (E.164)</Label>
              {discovery && discovery.numbers.length > 0 && (
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={form.fromNumber}
                  onChange={(e) => setForm({ ...form, fromNumber: e.target.value })}>
                  <option value="">— escolha um número —</option>
                  {discovery.numbers.filter(n => n.capabilities.sms).map((n) => (
                    <option key={n.sid} value={n.phoneNumber}>{n.phoneNumber} · {n.friendlyName}</option>
                  ))}
                </select>
              )}
              <Input placeholder="+15558675310" value={form.fromNumber}
                onChange={(e) => setForm({ ...form, fromNumber: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Messaging Service SID</Label>
              {discovery && discovery.services.length > 0 && (
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={form.messagingServiceSid}
                  onChange={(e) => setForm({ ...form, messagingServiceSid: e.target.value })}>
                  <option value="">— escolha um serviço —</option>
                  {discovery.services.map((s) => (
                    <option key={s.sid} value={s.sid}>{s.friendlyName} · {s.sid}</option>
                  ))}
                </select>
              )}
              <Input placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={form.messagingServiceSid}
                onChange={(e) => setForm({ ...form, messagingServiceSid: e.target.value.trim() })} />
              <p className="text-xs text-muted-foreground">Se preenchido, tem prioridade sobre o número direto.</p>
            </div>
          </Card>
        )}

        {step === 4 && (
          <>
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="text-base font-semibold">4 · Template aprovado (Content API)</h2>
                <p className="text-xs text-muted-foreground">Para iniciar conversas no WhatsApp fora da janela de 24h.</p>
              </div>
              {discovery && discovery.contents.length > 0 ? (
                <div className="space-y-2">
                  <Label>Templates disponíveis</Label>
                  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={form.contentSid}
                    onChange={(e) => setForm({ ...form, contentSid: e.target.value })}>
                    <option value="">— sem template (mensagem livre) —</option>
                    {discovery.contents.map((c) => (
                      <option key={c.sid} value={c.sid}>{c.friendlyName} · {c.language} · {c.sid}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Content SID</Label>
                  <Input placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={form.contentSid}
                    onChange={(e) => setForm({ ...form, contentSid: e.target.value.trim() })} />
                </div>
              )}
              <div className="space-y-2">
                <Label>Variável p/ texto (padrão: 1)</Label>
                <Input placeholder="1" value={form.contentVariableKey}
                  onChange={(e) => setForm({ ...form, contentVariableKey: e.target.value.trim() })} />
              </div>
            </Card>

            <Card className="space-y-4 p-5">
              <div>
                <h2 className="text-base font-semibold">Webhook de entrada</h2>
                <p className="text-xs text-muted-foreground">Configure no Twilio para receber respostas e status de entrega.</p>
              </div>
              <div className="space-y-2">
                <Label>URL do Webhook</Label>
                <Input placeholder="https://liviacrm.lovable.app/api/public/webhooks/twilio"
                  value={form.webhookUrl}
                  onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Token / Assinatura</Label>
                <Input type="password" placeholder={form.hasWebhookToken ? "Mantém o atual" : "Token compartilhado"}
                  value={form.webhookToken === "••••••••" ? "" : form.webhookToken}
                  onChange={(e) => setForm({ ...form, webhookToken: e.target.value })} />
              </div>
            </Card>
          </>
        )}

        {step === 5 && (
          <>
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="text-base font-semibold">5 · Testar envio Twilio</h2>
                <p className="text-xs text-muted-foreground">Envia uma mensagem real usando as configurações salvas. Salve antes de testar.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Telefone destino (E.164)</Label>
                  <Input placeholder="+5561912345678" value={sendTo} onChange={(e) => setSendTo(e.target.value)} />
                </div>
                <div className="space-y-2 flex flex-col">
                  <Label>Usar template configurado?</Label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={useTemplate} disabled={!form.contentSid}
                      onChange={(e) => setUseTemplate(e.target.checked)} />
                    {form.contentSid ? `Sim — ${form.contentSid}` : "Sem ContentSid configurado"}
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Texto</Label>
                <Input value={sendText} onChange={(e) => setSendText(e.target.value)} />
              </div>
              <Button onClick={() => sendTest.mutate()} disabled={sendTest.isPending || !sendTo || !sendText}>
                {sendTest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Enviar teste
              </Button>
              {sendResult && (
                <Card className={`p-3 text-sm ${sendResult.ok ? "border-success/40" : "border-destructive/40"}`}>
                  {sendResult.ok ? (
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                      <div>
                        <div className="font-medium">Mensagem aceita pelo Twilio</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          SID: <span className="font-mono">{sendResult.sid ?? "—"}</span> · status: {sendResult.status ?? "—"} · {sendResult.latencyMs}ms
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                      <div className="font-mono text-xs">{sendResult.error}</div>
                    </div>
                  )}
                </Card>
              )}
            </Card>

            <Card className="space-y-4 p-5">
              <div>
                <h2 className="text-base font-semibold">Health check do CRM</h2>
                <p className="text-xs text-muted-foreground">Verifica conectividade do banco, tabelas principais e provedor de mensageria ativo.</p>
              </div>
              <Button variant="outline" onClick={() => crmTest.mutate()} disabled={crmTest.isPending}>
                {crmTest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                Rodar health check
              </Button>
              {crmResult && (
                <div className="space-y-1.5">
                  {crmResult.checks.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                      {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />}
                      <div className="flex-1">
                        <div className="font-medium">{c.name}</div>
                        {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                      </div>
                    </div>
                  ))}
                  <div className="text-xs text-muted-foreground">Executado em {crmResult.latencyMs}ms</div>
                </div>
              )}
            </Card>
          </>
        )}

        <Separator />
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending || !form.accountSid}>
              <Save className="mr-2 h-4 w-4" /> {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
            <Button onClick={() => setStep(Math.min(STEPS.length, step + 1))} disabled={step === STEPS.length || !canAdvance}>
              Próximo <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function PingBlock({ r }: { r: PingResult }) {
  return (
    <Card className={`p-3 text-sm ${r.ok ? "border-success/40" : "border-destructive/40"}`}>
      {r.ok ? (
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
          <div className="text-xs text-muted-foreground">
            Conta <span className="font-mono">{r.accountSid}</span> · {r.friendlyName ?? "—"} · {r.status ?? "—"} · {r.latencyMs}ms
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
          <div className="font-mono text-xs">{r.error}</div>
        </div>
      )}
    </Card>
  );
}