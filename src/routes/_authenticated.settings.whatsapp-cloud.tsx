import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Cloud, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Loader2, Copy, Send, Trash2, Star } from "lucide-react";

type Account = {
  id: string; waba_id: string; business_name: string | null; phone_number_id: string;
  display_phone_number: string | null; verified_name: string | null; is_default: boolean;
  webhook_subscribed: boolean; created_at: string;
};
type State = {
  meta: { appId: string; configId: string; verifyToken: string; webhookUrl: string };
  accounts: Account[];
};

async function api<T>(method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada.");
  const res = await fetch("/api/whatsapp-cloud-settings", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erro");
  return json as T;
}

export const Route = createFileRoute("/_authenticated/settings/whatsapp-cloud")({
  head: () => ({ meta: [{ title: "WhatsApp Cloud — Lívia CRM" }] }),
  component: WhatsappCloudPage,
});

const STEPS = [
  { n: 1, label: "App Meta" },
  { n: 2, label: "Conectar conta" },
  { n: 3, label: "Número & Webhook" },
  { n: 4, label: "Testes" },
  { n: 5, label: "Resumo" },
] as const;

function WhatsappCloudPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["wa-cloud"], queryFn: () => api<State>("GET") });
  const currentHost = typeof window !== "undefined" ? window.location.hostname : "";
  const domainCheck = useQuery({
    queryKey: ["wa-cloud-domain", currentHost],
    queryFn: () => api<{ ok: boolean; allowed: boolean; host: string; domains: string[]; error?: string }>("POST", { action: "check-domain", host: currentHost }),
    enabled: !!currentHost,
    staleTime: 60_000,
  });
  const [step, setStep] = useState(1);
  const accounts = data?.accounts ?? [];
  const defaultAcc = accounts.find((a) => a.is_default) ?? accounts[0];

  // Embedded Signup state
  const [accessToken, setAccessToken] = useState("");
  const [businesses, setBusinesses] = useState<Array<{ businessId: string; businessName: string; wabas: Array<{ id: string; name: string }> }>>([]);
  const [selectedWaba, setSelectedWaba] = useState<{ id: string; name?: string } | null>(null);
  const [phones, setPhones] = useState<Array<{ id: string; display_phone_number: string; verified_name: string }>>([]);
  const [selectedPhone, setSelectedPhone] = useState<string>("");
  const [sdkStatus, setSdkStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const isPreviewHost = typeof window !== "undefined" && /lovableproject\.com|lovable\.app/.test(window.location.hostname);

  useEffect(() => { if (defaultAcc && step === 1 && !accessToken) setStep(5); }, [defaultAcc, step, accessToken]);

  const exchangeMut = useMutation({
    mutationFn: (code: string) => api<{ accessToken: string; expiresIn: number | null }>("POST", { action: "exchange-code", code }),
    onSuccess: async (r) => {
      setAccessToken(r.accessToken);
      toast.success("Code trocado por token!");
      const b = await api<{ businesses: typeof businesses }>("POST", { action: "list-wabas", accessToken: r.accessToken });
      setBusinesses(b.businesses);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const listPhonesMut = useMutation({
    mutationFn: (wabaId: string) => api<{ phones: typeof phones }>("POST", { action: "list-phones", wabaId, accessToken }),
    onSuccess: (r) => setPhones(r.phones),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const p = phones.find((x) => x.id === selectedPhone);
      if (!selectedWaba || !p) throw new Error("Selecione WABA e número.");
      const biz = businesses.find((b) => b.wabas.some((w) => w.id === selectedWaba.id));
      return api<{ account: Account }>("POST", {
        action: "save-account", wabaId: selectedWaba.id, businessName: biz?.businessName,
        phoneNumberId: p.id, displayPhoneNumber: p.display_phone_number, verifiedName: p.verified_name,
        accessToken, setDefault: true,
      });
    },
    onSuccess: () => { toast.success("Conta salva!"); qc.invalidateQueries({ queryKey: ["wa-cloud"] }); setStep(3); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const subscribeMut = useMutation({
    mutationFn: (id: string) => api("POST", { action: "subscribe-webhook", accountId: id }),
    onSuccess: () => { toast.success("Webhook inscrito!"); qc.invalidateQueries({ queryKey: ["wa-cloud"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const syncMut = useMutation({
    mutationFn: (id: string) => api<{ count: number }>("POST", { action: "sync-templates", accountId: id }),
    onSuccess: (r) => toast.success(`${r.count} templates sincronizados.`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const setDefaultMut = useMutation({
    mutationFn: (id: string) => api("POST", { action: "set-default", accountId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-cloud"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api("POST", { action: "delete-account", accountId: id }),
    onSuccess: () => { toast.success("Removida."); qc.invalidateQueries({ queryKey: ["wa-cloud"] }); },
  });

  // Facebook SDK
  useEffect(() => {
    if (!data?.meta.appId) return;
    if (document.getElementById("fb-sdk")) { setSdkStatus("ready"); return; }
    setSdkStatus("loading");
    const s = document.createElement("script");
    s.id = "fb-sdk"; s.async = true; s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.onload = () => {
      const w = window as unknown as { FB?: { init: (o: Record<string, unknown>) => void } };
      if (!w.FB) { setSdkStatus("error"); return; }
      try {
        w.FB.init({ appId: data.meta.appId, cookie: true, xfbml: false, version: "v21.0" });
        setSdkStatus("ready");
      } catch (err) {
        console.error("[wa-cloud] FB.init falhou", err);
        setSdkStatus("error");
      }
    };
    s.onerror = (err) => {
      console.error("[wa-cloud] Falha ao carregar SDK do Facebook (bloqueado por extensão ou rede?)", err);
      setSdkStatus("error");
    };
    document.body.appendChild(s);
  }, [data?.meta.appId]);

  function launchEmbeddedSignup() {
    const w = window as unknown as { FB?: { login: (cb: (r: { authResponse?: { code?: string }; status?: string }) => void, o: Record<string, unknown>) => void } };
    if (!data?.meta.appId) return toast.error("META_APP_ID não está configurado nas secrets.");
    if (!data?.meta.configId) return toast.error("META_LOGIN_CONFIG_ID não está configurado nas secrets.");
    if (!w.FB) {
      toast.error("SDK do Facebook não carregou. Use o modo manual abaixo.");
      return;
    }
    try {
      w.FB.login((r) => {
        console.log("[wa-cloud] FB.login response", r);
        const code = r?.authResponse?.code;
        if (!code) {
          toast.error(`Login não retornou code (status: ${r?.status ?? "desconhecido"}). Verifique se o domínio está na allowlist do app Meta ou use o modo manual.`);
          return;
        }
        exchangeMut.mutate(code);
      }, { config_id: data.meta.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } });
    } catch (err) {
      console.error("[wa-cloud] FB.login lançou exceção", err);
      toast.error("Falha ao abrir o Embedded Signup. Use o modo manual abaixo.");
    }
  }

  // Fallback manual: o admin cola um token + IDs vindos do Meta Business Manager
  const manualSaveMut = useMutation({
    mutationFn: (input: { token: string; wabaId: string; phoneNumberId: string; displayPhoneNumber?: string; businessName?: string }) =>
      api<{ account: Account }>("POST", {
        action: "save-account",
        wabaId: input.wabaId,
        businessName: input.businessName,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber,
        accessToken: input.token,
        setDefault: true,
      }),
    onSuccess: () => { toast.success("Conta salva!"); qc.invalidateQueries({ queryKey: ["wa-cloud"] }); setStep(3); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold"><Cloud className="h-6 w-6" /> WhatsApp Cloud API</h1>
            <p className="text-sm text-muted-foreground">Conecte uma conta oficial da Meta para enviar mensagens via Graph API.</p>
          </div>
          {defaultAcc && <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Conta padrão: {defaultAcc.display_phone_number ?? defaultAcc.phone_number_id}</Badge>}
        </header>

        <Stepper step={step} onStep={setStep} />

        {isLoading ? <Card className="p-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Card> : (
          <>
            {step === 1 && <Step1 meta={data!.meta} />}
            {step === 2 && (
              <Step2
                meta={data!.meta}
                sdkStatus={sdkStatus}
                isPreviewHost={isPreviewHost}
                domainCheck={domainCheck.data}
                domainCheckLoading={domainCheck.isLoading}
                onRecheckDomain={() => domainCheck.refetch()}
                accessToken={accessToken}
                businesses={businesses}
                onLogin={launchEmbeddedSignup}
                loggingIn={exchangeMut.isPending}
                onChooseWaba={(w) => { setSelectedWaba(w); listPhonesMut.mutate(w.id); }}
                selectedWaba={selectedWaba}
                phones={phones}
                selectedPhone={selectedPhone}
                onChoosePhone={setSelectedPhone}
                onSave={() => saveMut.mutate()}
                saving={saveMut.isPending}
                onManualSave={(v) => manualSaveMut.mutate(v)}
                manualSaving={manualSaveMut.isPending}
              />
            )}
            {step === 3 && (
              <Step3
                accounts={accounts}
                onSubscribe={(id) => subscribeMut.mutate(id)}
                subscribing={subscribeMut.isPending}
                onDefault={(id) => setDefaultMut.mutate(id)}
                onDelete={(id) => deleteMut.mutate(id)}
              />
            )}
            {step === 4 && <Step4 accounts={accounts} onSync={(id) => syncMut.mutate(id)} syncing={syncMut.isPending} />}
            {step === 5 && <Step5 accounts={accounts} />}
          </>
        )}

        <div className="flex justify-between">
          <Button variant="ghost" disabled={step <= 1} onClick={() => setStep((s) => Math.max(1, s - 1))}><ChevronLeft className="mr-1 h-4 w-4" /> Voltar</Button>
          <Button variant="default" disabled={step >= STEPS.length} onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-2">
      {STEPS.map((s, i) => {
        const active = step === s.n; const done = step > s.n;
        return (
          <button key={s.n} onClick={() => onStep(s.n)} className={`flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-xs transition ${active ? "bg-primary text-primary-foreground" : done ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"}`}>
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${active || done ? "bg-background/30" : "bg-muted"}`}>{s.n}</span>
            <span className="hidden sm:inline">{s.label}</span>
            {i < STEPS.length - 1 && <ChevronRight className="hidden h-3 w-3 opacity-50 md:inline" />}
          </button>
        );
      })}
    </div>
  );
}

function DomainCheckBanner({ check, loading, onRecheck }: { check?: { ok: boolean; allowed: boolean; host: string; domains: string[]; error?: string }; loading: boolean; onRecheck: () => void }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando se este domínio está autorizado no app Meta…
      </div>
    );
  }
  if (!check) return null;
  if (!check.ok) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <div className="flex-1">
          Não consegui consultar o app Meta para verificar domínios autorizados ({check.error ?? "erro desconhecido"}). Confirme as secrets <code>META_APP_ID</code> e <code>META_APP_SECRET</code>.
        </div>
        <Button size="sm" variant="ghost" onClick={onRecheck}>Tentar de novo</Button>
      </div>
    );
  }
  if (check.allowed) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <span>Domínio <strong>{check.host}</strong> autorizado no app Meta. ✅</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs">
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1 space-y-1">
        <div>
          O domínio <strong>{check.host}</strong> <strong>não está</strong> na lista de <em>App Domains</em> do seu app Meta. O Embedded Signup vai falhar silenciosamente (popup retorna sem code).
        </div>
        <div className="text-muted-foreground">
          Domínios atuais: {check.domains.length ? check.domains.map((d) => <code key={d} className="mr-1">{d}</code>) : <em>nenhum configurado</em>}
        </div>
        <div className="text-muted-foreground">
          Acesse <em>developers.facebook.com → seu App → Settings → Basic → App Domains</em>, adicione <code>{check.host}</code>, e em <em>Facebook Login for Business → Valid OAuth Redirect URIs</em> inclua <code>https://{check.host}/</code>.
        </div>
        <Button size="sm" variant="outline" onClick={onRecheck} className="mt-1">Verificar de novo</Button>
      </div>
    </div>
  );
}

function CopyableField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input value={value || "(não configurado)"} readOnly className="font-mono text-xs" />
        <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(value); toast.success("Copiado!"); }}><Copy className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function Step1({ meta }: { meta: State["meta"] }) {
  const missing = !meta.appId || !meta.configId || !meta.verifyToken;
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">1. App Meta</h2>
      <p className="text-sm text-muted-foreground">As credenciais ficam em <strong>secrets</strong> do projeto. Para alterar, peça no chat.</p>
      {missing && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Faltam secrets: configure <code>META_APP_ID</code>, <code>META_LOGIN_CONFIG_ID</code> e <code>META_WEBHOOK_VERIFY_TOKEN</code>.
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <CopyableField label="App ID" value={meta.appId} />
        <CopyableField label="Login Configuration ID" value={meta.configId} />
        <CopyableField label="Verify Token (Webhook)" value={meta.verifyToken} />
        <CopyableField label="Webhook URL (cole no Meta App Dashboard)" value={meta.webhookUrl} />
      </div>
      <p className="text-xs text-muted-foreground">
        No painel Meta → seu App → WhatsApp → Configuration: defina <strong>Callback URL</strong> como o webhook acima e <strong>Verify Token</strong> idêntico ao secret. Marque os fields <code>messages</code> e <code>message_template_status_update</code>.
      </p>
    </Card>
  );
}

function Step2(props: {
  meta: State["meta"]; accessToken: string;
  sdkStatus: "idle" | "loading" | "ready" | "error";
  isPreviewHost: boolean;
  domainCheck?: { ok: boolean; allowed: boolean; host: string; domains: string[]; error?: string };
  domainCheckLoading: boolean;
  onRecheckDomain: () => void;
  businesses: Array<{ businessId: string; businessName: string; wabas: Array<{ id: string; name: string }> }>;
  onLogin: () => void; loggingIn: boolean;
  onChooseWaba: (w: { id: string; name?: string }) => void;
  selectedWaba: { id: string; name?: string } | null;
  phones: Array<{ id: string; display_phone_number: string; verified_name: string }>;
  selectedPhone: string; onChoosePhone: (id: string) => void;
  onSave: () => void; saving: boolean;
  onManualSave: (v: { token: string; wabaId: string; phoneNumberId: string; displayPhoneNumber?: string; businessName?: string }) => void;
  manualSaving: boolean;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [mToken, setMToken] = useState("");
  const [mWaba, setMWaba] = useState("");
  const [mPhoneId, setMPhoneId] = useState("");
  const [mPhoneNum, setMPhoneNum] = useState("");
  const [mBiz, setMBiz] = useState("");
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">2. Embedded Signup</h2>
      <p className="text-sm text-muted-foreground">Clique para abrir o login da Meta e escolher seu negócio + número WhatsApp.</p>
      <DomainCheckBanner check={props.domainCheck} loading={props.domainCheckLoading} onRecheck={props.onRecheckDomain} />
      {props.isPreviewHost && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <div>
            Você está no domínio de preview do Lovable. A Meta normalmente bloqueia o Embedded Signup em domínios não cadastrados — o popup pode não retornar nada. Publique o app e abra pelo domínio publicado, <strong>ou</strong> use o modo manual abaixo.
          </div>
        </div>
      )}
      {props.sdkStatus === "error" && (
        <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <div>SDK do Facebook não carregou (bloqueado por extensão, ad-blocker ou rede). Use o modo manual.</div>
        </div>
      )}
      <Button onClick={props.onLogin} disabled={props.loggingIn || !props.meta.appId} className="gap-2">
        {props.loggingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
        Conectar com a Meta {props.sdkStatus === "loading" && "(carregando SDK…)"}
      </Button>

      {props.accessToken && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>WhatsApp Business Account</Label>
            {props.businesses.flatMap((b) => b.wabas.map((w) => (
              <button key={w.id} onClick={() => props.onChooseWaba({ id: w.id, name: w.name })}
                className={`flex w-full items-center justify-between rounded-md border p-3 text-left transition hover:bg-accent ${props.selectedWaba?.id === w.id ? "border-primary bg-accent" : ""}`}>
                <div><div className="font-medium">{w.name}</div><div className="text-xs text-muted-foreground">{b.businessName} · {w.id}</div></div>
                {props.selectedWaba?.id === w.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
              </button>
            )))}
            {!props.businesses.length && <p className="text-sm text-muted-foreground">Nenhum negócio encontrado.</p>}
          </div>

          {props.phones.length > 0 && (
            <div className="space-y-2">
              <Label>Número</Label>
              {props.phones.map((p) => (
                <button key={p.id} onClick={() => props.onChoosePhone(p.id)}
                  className={`flex w-full items-center justify-between rounded-md border p-3 text-left transition hover:bg-accent ${props.selectedPhone === p.id ? "border-primary bg-accent" : ""}`}>
                  <div><div className="font-medium">{p.display_phone_number}</div><div className="text-xs text-muted-foreground">{p.verified_name}</div></div>
                  {props.selectedPhone === p.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          )}

          <Button onClick={props.onSave} disabled={!props.selectedPhone || !props.selectedWaba || props.saving} className="w-full">
            {props.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar conta como padrão
          </Button>
        </>
      )}

      <Separator />
      <div>
        <button type="button" onClick={() => setManualOpen((v) => !v)} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
          {manualOpen ? "Ocultar" : "Conectar manualmente (token + IDs do Business Manager)"}
        </button>
        {manualOpen && (
          <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground">
              Use isto se o Embedded Signup não funcionar (preview, bloqueio de popup, etc.). Gere um <strong>System User Access Token</strong> permanente em <em>Meta Business Suite → Configurações → Usuários do Sistema</em> com permissão <code>whatsapp_business_management</code> e <code>whatsapp_business_messaging</code>. Copie o WABA ID e o Phone Number ID em <em>WhatsApp Manager → API Setup</em>.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>Access Token</Label><Input value={mToken} onChange={(e) => setMToken(e.target.value)} placeholder="EAAB..." className="font-mono text-xs" /></div>
              <div><Label>WABA ID</Label><Input value={mWaba} onChange={(e) => setMWaba(e.target.value)} placeholder="123456789012345" /></div>
              <div><Label>Phone Number ID</Label><Input value={mPhoneId} onChange={(e) => setMPhoneId(e.target.value)} placeholder="987654321098765" /></div>
              <div><Label>Telefone exibido (opcional)</Label><Input value={mPhoneNum} onChange={(e) => setMPhoneNum(e.target.value)} placeholder="+55 11 99999-9999" /></div>
              <div className="md:col-span-2"><Label>Nome do negócio (opcional)</Label><Input value={mBiz} onChange={(e) => setMBiz(e.target.value)} placeholder="Minha Empresa LTDA" /></div>
            </div>
            <Button
              disabled={!mToken || !mWaba || !mPhoneId || props.manualSaving}
              onClick={() => props.onManualSave({ token: mToken.trim(), wabaId: mWaba.trim(), phoneNumberId: mPhoneId.trim(), displayPhoneNumber: mPhoneNum.trim() || undefined, businessName: mBiz.trim() || undefined })}
            >
              {props.manualSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar conta manual
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Step3(props: { accounts: Account[]; onSubscribe: (id: string) => void; subscribing: boolean; onDefault: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">3. Webhook & contas</h2>
      {!props.accounts.length && <p className="text-sm text-muted-foreground">Nenhuma conta conectada. Volte ao passo anterior.</p>}
      {props.accounts.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-md border p-3">
          <div>
            <div className="flex items-center gap-2 font-medium">
              {a.display_phone_number ?? a.phone_number_id}
              {a.is_default && <Badge>Padrão</Badge>}
              {a.webhook_subscribed ? <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" />Webhook OK</Badge> : <Badge variant="outline">Sem webhook</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">{a.business_name} · WABA {a.waba_id}</div>
          </div>
          <div className="flex gap-2">
            {!a.is_default && <Button size="sm" variant="outline" onClick={() => props.onDefault(a.id)}><Star className="mr-1 h-3 w-3" />Tornar padrão</Button>}
            <Button size="sm" onClick={() => props.onSubscribe(a.id)} disabled={props.subscribing}>Inscrever webhook</Button>
            <Button size="sm" variant="ghost" onClick={() => props.onDelete(a.id)}><Trash2 className="h-3 w-3" /></Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function Step4({ accounts, onSync, syncing }: { accounts: Account[]; onSync: (id: string) => void; syncing: boolean }) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("Teste do Lívia CRM");
  const [tplName, setTplName] = useState("");
  const [accId, setAccId] = useState(accounts.find((a) => a.is_default)?.id ?? accounts[0]?.id ?? "");
  const sendMut = useMutation({
    mutationFn: () => api("POST", { action: "send-test", accountId: accId, toPhone: to, ...(tplName ? { templateName: tplName, templateLanguage: "pt_BR" } : { text }) }),
    onSuccess: () => toast.success("Mensagem enviada!"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  if (!accounts.length) return <Card className="p-6 text-sm text-muted-foreground">Conecte uma conta primeiro.</Card>;
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">4. Testes</h2>
      <div className="flex gap-2">
        <Button onClick={() => onSync(accId)} disabled={syncing} variant="outline">{syncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sincronizar templates da Meta</Button>
      </div>
      <Separator />
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label>Telefone (E.164)</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+5511999999999" /></div>
        <div><Label>Template (opcional — deixe vazio para texto livre)</Label><Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="ex.: hello_world" /></div>
        {!tplName && <div className="md:col-span-2"><Label>Mensagem</Label><Input value={text} onChange={(e) => setText(e.target.value)} /></div>}
      </div>
      <Button onClick={() => sendMut.mutate()} disabled={!to || sendMut.isPending} className="gap-2">
        {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar teste
      </Button>
      <p className="text-xs text-muted-foreground">Texto livre só funciona se o número destino tiver enviado mensagem nas últimas 24h. Caso contrário use um template aprovado.</p>
    </Card>
  );
}

function Step5({ accounts }: { accounts: Account[] }) {
  const def = accounts.find((a) => a.is_default);
  return (
    <Card className="space-y-3 p-6">
      <h2 className="text-lg font-semibold">5. Resumo</h2>
      {!def ? <p className="text-sm text-muted-foreground">Nenhuma conta padrão configurada.</p> : (
        <div className="space-y-1 text-sm">
          <div><strong>Negócio:</strong> {def.business_name ?? "-"}</div>
          <div><strong>Número:</strong> {def.display_phone_number ?? def.phone_number_id}</div>
          <div><strong>Webhook inscrito:</strong> {def.webhook_subscribed ? "sim" : "não"}</div>
          <div><strong>WABA ID:</strong> <code className="text-xs">{def.waba_id}</code></div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Para ativar este provedor em todo o sistema, vá em <strong>Configurações → WhatsApp</strong> e selecione <em>WhatsApp Cloud API</em>.</p>
    </Card>
  );
}

function useStateOnce<T>(v: T) { return useMemo(() => v, [v]); }
void useStateOnce;