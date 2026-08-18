import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Cloud, CheckCircle2, AlertTriangle, Loader2, Copy, Send, Trash2, Star, ShieldCheck,
  KeyRound, Smartphone, Phone, ExternalLink, Bot, Megaphone, FileText, Check, RotateCcw, ChevronRight,
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type FieldCheck = { ok: boolean; message: string; detail?: string };
type CredentialsCheck = {
  appId: FieldCheck; appSecret: FieldCheck; configId: FieldCheck; verifyToken: FieldCheck; overall: boolean;
};

type Account = {
  id: string; waba_id: string; business_name: string | null; phone_number_id: string;
  display_phone_number: string | null; verified_name: string | null; is_default: boolean;
  webhook_subscribed: boolean; created_at: string;
};
type State = {
  meta: { appId: string; configId: string; verifyToken: string; hasAppSecret: boolean; webhookUrl: string };
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

/** Ativa o provedor de mensagens "cloud" após conectar uma conta. */
async function activateCloudProvider(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const res = await fetch("/api/messaging-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ provider: "cloud" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function announceProviderActivation() {
  const ok = await activateCloudProvider();
  if (ok) toast.success("Provedor de mensagens ativado: WhatsApp Cloud.");
  else toast.warning("Conta conectada! Ative o provedor em Configurações → WhatsApp Cloud API.");
}

export const Route = createFileRoute("/_authenticated/settings/whatsapp-cloud")({
  head: () => ({ meta: [{ title: "WhatsApp Cloud — Lívia CRM" }] }),
  component: WhatsappCloudPage,
});

const WIZARD_STEPS = [
  { n: 1, label: "Conectar Meta" },
  { n: 2, label: "Selecionar número" },
  { n: 3, label: "Ativar número" },
  { n: 4, label: "Conectado" },
] as const;

function WhatsappCloudPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["wa-cloud"], queryFn: () => api<State>("GET") });
  const profileFn = useServerFn(getMyProfile);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const isAdmin = (me?.roles ?? []).includes("admin");

  const currentHost = typeof window !== "undefined" ? window.location.hostname : "";
  const domainCheck = useQuery({
    queryKey: ["wa-cloud-domain", currentHost],
    queryFn: () => api<{ ok: boolean; allowed: boolean; host: string; domains: string[]; error?: string }>("POST", { action: "check-domain", host: currentHost }),
    enabled: !!currentHost,
    staleTime: 60_000,
  });

  const accounts = data?.accounts ?? [];
  const defaultAcc = accounts.find((a) => a.is_default) ?? accounts[0];

  // Embedded Signup state
  const [accessToken, setAccessToken] = useState("");
  const [sdkStatus, setSdkStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [signupIds, setSignupIds] = useState<{ wabaId: string; phoneNumberId: string } | null>(null);
  const [signupOptions, setSignupOptions] = useState<Array<{ wabaId: string; phoneNumberId: string; displayPhone: string | null; verifiedName: string | null }>>([]);
  const [pickedOption, setPickedOption] = useState<string | null>(null);
  const [manualWabaId, setManualWabaId] = useState("");
  const [manualPhoneNumberId, setManualPhoneNumberId] = useState("");
  const isPreviewHost = typeof window !== "undefined" && /lovableproject\.com|lovable\.app/.test(window.location.hostname);

  /** Passo detectado a partir do estado do banco. */
  const detectedStep: number = !accounts.length
    ? 1
    : !defaultAcc?.phone_number_id
      ? 2
      : !defaultAcc?.webhook_subscribed
        ? 3
        : 4;

  const [manualStep, setManualStep] = useState<number | null>(null);
  const step = manualStep ?? detectedStep;
  // Ao mudar de estado no banco, volta a seguir a detecção automática.
  useEffect(() => { setManualStep(null); }, [detectedStep]);

  const exchangeMut = useMutation({
    mutationFn: (code: string) => api<{ accessToken: string; expiresIn: number | null }>("POST", { action: "exchange-code", code }),
    onSuccess: async (r) => {
      setAccessToken(r.accessToken);
      setSignupOptions([]);
      try {
        const res = await api<{ accounts: Array<{ wabaId: string; phoneNumberId: string; displayPhone: string | null; verifiedName: string | null }> }>("POST", {
          action: "list-signup-accounts",
          accessToken: r.accessToken,
        });
        if (res.accounts.length === 1) {
          saveFromSignupMut.mutate({ wabaId: res.accounts[0].wabaId, phoneNumberId: res.accounts[0].phoneNumberId, accessToken: r.accessToken });
        } else if (res.accounts.length > 1) {
          setSignupOptions(res.accounts);
          setManualStep(2);
          toast.info("Encontramos mais de um número. Escolha qual conectar.");
        } else {
          setManualStep(2);
          toast.warning("Não encontramos WABAs associados a este token. Preencha manualmente.");
        }
      } catch {
        setManualStep(2);
        toast.warning("Não foi possível listar contas automaticamente. Preencha manualmente abaixo.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const saveFromSignupMut = useMutation({
    mutationFn: (v: { wabaId: string; phoneNumberId: string; accessToken: string }) =>
      api<{ account: Account; subscribed: boolean; subscribeError: string | null }>("POST", { action: "save-from-signup", ...v }),
    onSuccess: async (r) => {
      await qc.refetchQueries({ queryKey: ["wa-cloud"], type: "all" });
      await announceProviderActivation();
      if (r.subscribed) toast.success("Conta conectada e webhook inscrito automaticamente!");
      else toast.warning(`Conta conectada, mas falhou ao inscrever o webhook: ${r.subscribeError ?? "erro desconhecido"}.`);
      setAccessToken("");
      setSignupIds(null);
      setSignupOptions([]);
      setPickedOption(null);
      setManualWabaId("");
      setManualPhoneNumberId("");
      setManualStep(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  // Fallback: usa os IDs vindos do postMessage se o auto-save ainda não rodou.
  useEffect(() => {
    if (!signupIds || !accessToken || saveFromSignupMut.isPending || saveFromSignupMut.isSuccess) return;
    saveFromSignupMut.mutate({ ...signupIds, accessToken });
    setSignupIds(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signupIds, accessToken]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== "https://www.facebook.com" && ev.origin !== "https://web.facebook.com") return;
      let payload: unknown = ev.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      const p = payload as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } };
      if (p?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (p.event === "FINISH" && p.data?.waba_id && p.data?.phone_number_id) {
        setSignupIds({ wabaId: p.data.waba_id, phoneNumberId: p.data.phone_number_id });
        toast.success("Conta e número recebidos da Meta — salvando…");
      } else if (p.event === "CANCEL") {
        toast.warning("Signup cancelado pelo usuário.");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const saveMetaMut = useMutation({
    mutationFn: (v: { appId?: string; appSecret?: string; configId?: string; verifyToken?: string }) =>
      api<{ ok: boolean; meta: State["meta"] }>("POST", { action: "save-meta-config", ...v }),
    onSuccess: () => { toast.success("Credenciais salvas!"); qc.invalidateQueries({ queryKey: ["wa-cloud"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const appWebhookMut = useMutation({
    mutationFn: () => api<{ ok: boolean; error?: string }>("POST", { action: "configure-app-webhook" }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Subscription do App registrada na Meta!");
      else toast.error(`Falhou: ${r.error ?? "erro"}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const subscribeMut = useMutation({
    mutationFn: (id: string) => api("POST", { action: "subscribe-webhook", accountId: id }),
    onSuccess: () => { toast.success("Webhook inscrito!"); qc.invalidateQueries({ queryKey: ["wa-cloud"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const syncMut = useMutation({
    mutationFn: (id: string) => api<{ count: number }>("POST", { action: "sync-templates", accountId: id }),
    onSuccess: (r) => toast.success(`Sincronizado — ${r.count} templates encontrados.`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const setDefaultMut = useMutation({
    mutationFn: (id: string) => api("POST", { action: "set-default", accountId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-cloud"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api("POST", { action: "delete-account", accountId: id }),
    onSuccess: () => { toast.success("Conta removida."); qc.invalidateQueries({ queryKey: ["wa-cloud"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
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
      console.error("[wa-cloud] Falha ao carregar SDK do Facebook", err);
      setSdkStatus("error");
    };
    document.body.appendChild(s);
  }, [data?.meta.appId]);

  function launchEmbeddedSignup() {
    const w = window as unknown as { FB?: { login: (cb: (r: { authResponse?: { code?: string }; status?: string }) => void, o: Record<string, unknown>) => void } };
    if (!data?.meta.appId) return toast.error("Configure o App ID nas credenciais avançadas.");
    if (!data?.meta.configId) return toast.error("Configure o Login Configuration ID nas credenciais avançadas.");
    if (!w.FB) return toast.error("SDK do Facebook não carregou. Verifique adblockers ou rede.");
    try {
      w.FB.login((r) => {
        const code = r?.authResponse?.code;
        if (!code) {
          toast.error(`Login não retornou code (status: ${r?.status ?? "desconhecido"}). Verifique se o domínio está autorizado no app Meta.`);
          return;
        }
        exchangeMut.mutate(code);
      }, { config_id: data.meta.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } });
    } catch (err) {
      console.error("[wa-cloud] FB.login lançou exceção", err);
      toast.error("Falha ao abrir o Embedded Signup.");
    }
  }

  return (
    <div className="h-screen overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold"><Cloud className="h-6 w-6" /> WhatsApp Cloud API</h1>
            <p className="text-sm text-muted-foreground">Conecte uma conta oficial da Meta para enviar e receber mensagens.</p>
          </div>
          {step === 4 && (
            <Badge className="gap-1 bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Conectado
            </Badge>
          )}
        </header>

        <ProgressStepper current={step} detected={detectedStep} onPick={(n) => setManualStep(n)} />

        {isLoading ? (
          <Card className="p-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Card>
        ) : (
          <>
            {step === 1 && (
              <StepConnect
                meta={data!.meta}
                sdkStatus={sdkStatus}
                isPreviewHost={isPreviewHost}
                domainCheck={domainCheck.data}
                domainCheckLoading={domainCheck.isLoading}
                onRecheckDomain={() => domainCheck.refetch()}
                onLogin={launchEmbeddedSignup}
                busy={exchangeMut.isPending || saveFromSignupMut.isPending}
                error={exchangeMut.error instanceof Error ? exchangeMut.error.message : null}
                onSaveMeta={(v) => saveMetaMut.mutate(v)}
                savingMeta={saveMetaMut.isPending}
                onConfigureAppWebhook={() => appWebhookMut.mutate()}
                configuringWebhook={appWebhookMut.isPending}
              />
            )}

            {step === 2 && (
              <StepPickNumber
                accounts={accounts}
                options={signupOptions}
                picked={pickedOption}
                onPick={setPickedOption}
                saving={saveFromSignupMut.isPending}
                error={saveFromSignupMut.error instanceof Error ? saveFromSignupMut.error.message : null}
                onContinue={() => {
                  const o = signupOptions.find((x) => `${x.wabaId}-${x.phoneNumberId}` === pickedOption);
                  if (!o || !accessToken) { toast.error("Selecione um número."); return; }
                  saveFromSignupMut.mutate({ wabaId: o.wabaId, phoneNumberId: o.phoneNumberId, accessToken });
                }}
                canManual={!!accessToken}
                manualWabaId={manualWabaId}
                manualPhoneNumberId={manualPhoneNumberId}
                onManualWabaIdChange={setManualWabaId}
                onManualPhoneNumberIdChange={setManualPhoneNumberId}
                onManualSave={() => {
                  if (!accessToken) { toast.error("Conecte-se à Meta primeiro (passo 1)."); return; }
                  if (!manualWabaId.trim() || !manualPhoneNumberId.trim()) { toast.error("Preencha WABA ID e Phone Number ID."); return; }
                  saveFromSignupMut.mutate({ wabaId: manualWabaId.trim(), phoneNumberId: manualPhoneNumberId.trim(), accessToken });
                }}
                onSetDefault={(id) => setDefaultMut.mutate(id)}
                settingDefault={setDefaultMut.isPending}
                onBack={() => setManualStep(1)}
              />
            )}

            {step === 3 && (
              <StepActivate
                accounts={accounts}
                qc={qc}
                onSubscribe={(id) => subscribeMut.mutate(id)}
                subscribing={subscribeMut.isPending}
                subscribeError={subscribeMut.error instanceof Error ? subscribeMut.error.message : null}
              />
            )}

            {step === 4 && defaultAcc && (
              <StepConnected
                account={defaultAcc}
                accounts={accounts}
                isAdmin={isAdmin}
                onSync={() => syncMut.mutate(defaultAcc.id)}
                syncing={syncMut.isPending}
                onReset={() => accounts.forEach((a) => deleteMut.mutate(a.id))}
                resetting={deleteMut.isPending}
                onSetDefault={(id) => setDefaultMut.mutate(id)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProgressStepper({ current, detected, onPick }: { current: number; detected: number; onPick: (n: number) => void }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start">
        {WIZARD_STEPS.map((s, i) => {
          const done = detected > s.n;
          const active = current === s.n;
          return (
            <div key={s.n} className="flex flex-1 items-start">
              <button
                type="button"
                onClick={() => onPick(s.n)}
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold transition ${
                    done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : s.n}
                </span>
                <span className={`truncate text-[11px] sm:text-xs ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </button>
              {i < WIZARD_STEPS.length - 1 && (
                <div className={`mt-4 h-0.5 w-full flex-1 ${detected > s.n ? "bg-emerald-500" : "bg-border"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="text-xs">{message}</AlertDescription>
    </Alert>
  );
}

function DomainCheckBanner({ check, loading, onRecheck }: { check?: { ok: boolean; allowed: boolean; host: string; domains: string[]; error?: string }; loading: boolean; onRecheck: () => void }) {
  const addDomainMut = useMutation({
    mutationFn: (host: string) => api<{ ok: boolean; error?: string }>("POST", { action: "add-domain", host }),
    onSuccess: (r) => {
      if (r.ok) { toast.success("Domínio adicionado no app Meta."); onRecheck(); }
      else toast.error(r.error ?? "Falha ao adicionar domínio.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
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
          Não consegui consultar o app Meta para verificar domínios autorizados ({check.error ?? "erro desconhecido"}).
        </div>
        <Button size="sm" variant="ghost" onClick={onRecheck}>Tentar de novo</Button>
      </div>
    );
  }
  if (check.allowed) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <span>Domínio <strong>{check.host}</strong> autorizado no app Meta.</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs">
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1 space-y-1">
        <div>
          O domínio <strong>{check.host}</strong> <strong>não está</strong> na lista de <em>App Domains</em> do seu app Meta — o Embedded Signup vai falhar silenciosamente.
        </div>
        <div className="text-muted-foreground">
          Domínios atuais: {check.domains.length ? check.domains.map((d) => <code key={d} className="mr-1">{d}</code>) : <em>nenhum configurado</em>}
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => addDomainMut.mutate(check.host)} disabled={addDomainMut.isPending}>
            {addDomainMut.isPending ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Aguarde…</> : `Autorizar ${check.host}`}
          </Button>
          <Button size="sm" variant="outline" onClick={onRecheck}>Verificar de novo</Button>
        </div>
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

/* ------------------------------- PASSO 1 -------------------------------- */

function StepConnect(props: {
  meta: State["meta"];
  sdkStatus: "idle" | "loading" | "ready" | "error";
  isPreviewHost: boolean;
  domainCheck?: { ok: boolean; allowed: boolean; host: string; domains: string[]; error?: string };
  domainCheckLoading: boolean;
  onRecheckDomain: () => void;
  onLogin: () => void;
  busy: boolean;
  error: string | null;
  onSaveMeta: (v: { appId?: string; appSecret?: string; configId?: string; verifyToken?: string }) => void;
  savingMeta: boolean;
  onConfigureAppWebhook: () => void;
  configuringWebhook: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">Conecte sua conta Meta Business</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Você precisa de uma conta Meta Business ativa e um número de telefone que possa receber
            WhatsApp. Ao clicar abaixo, a Meta abre o Embedded Signup para autorizar o Lívia CRM.
          </p>
        </div>

        <DomainCheckBanner check={props.domainCheck} loading={props.domainCheckLoading} onRecheck={props.onRecheckDomain} />

        {props.isPreviewHost && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <div>Você está no domínio de preview. A Meta costuma bloquear o Embedded Signup em domínios não cadastrados — publique e abra pelo domínio final.</div>
          </div>
        )}
        {props.sdkStatus === "error" && (
          <InlineError message="SDK do Facebook não carregou (bloqueado por extensão, ad-blocker ou rede)." />
        )}
        <InlineError message={props.error} />

        <Button size="lg" onClick={props.onLogin} disabled={props.busy || !props.meta.appId} className="w-full gap-2 sm:w-auto">
          {props.busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Aguarde…</> : <><Cloud className="h-4 w-4" /> Conectar com Meta</>}
          {props.sdkStatus === "loading" && !props.busy && " (carregando SDK…)"}
        </Button>
      </Card>

      <Card className="flex items-start gap-3 p-5">
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-sm">
          <div className="font-medium">Ainda não tem uma conta Meta Business?</div>
          <p className="text-xs text-muted-foreground">
            Crie o Business Manager, adicione o número de WhatsApp e finalize a verificação do negócio antes de conectar aqui.
          </p>
          <a
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            href="https://business.facebook.com/overview"
            target="_blank"
            rel="noreferrer"
          >
            Como criar uma conta Meta Business <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </Card>

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium">Inserir credenciais manualmente (avançado)</summary>
        <div className="border-t p-5">
          <MetaCredentialsForm
            meta={props.meta}
            onSave={props.onSaveMeta}
            saving={props.savingMeta}
            onConfigureAppWebhook={props.onConfigureAppWebhook}
            configuringWebhook={props.configuringWebhook}
          />
        </div>
      </details>
    </div>
  );
}

function MetaCredentialsForm(props: {
  meta: State["meta"];
  onSave: (v: { appId?: string; appSecret?: string; configId?: string; verifyToken?: string }) => void;
  saving: boolean;
  onConfigureAppWebhook: () => void;
  configuringWebhook: boolean;
}) {
  const [appId, setAppId] = useState(props.meta.appId);
  const [appSecret, setAppSecret] = useState("");
  const [configId, setConfigId] = useState(props.meta.configId);
  const [verify, setVerify] = useState(props.meta.verifyToken);
  useEffect(() => {
    setAppId(props.meta.appId);
    setConfigId(props.meta.configId);
    setVerify(props.meta.verifyToken);
  }, [props.meta.appId, props.meta.configId, props.meta.verifyToken]);

  const validateMut = useMutation({
    mutationFn: (v: { appId?: string; appSecret?: string; configId?: string; verifyToken?: string }) =>
      api<{ ok: boolean; check: CredentialsCheck }>("POST", { action: "validate-credentials", ...v }),
    onSuccess: (r) => {
      if (r.check.overall) toast.success("Todas as credenciais são válidas!");
      else toast.error("Uma ou mais credenciais estão inválidas — veja detalhes abaixo.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const check = validateMut.data?.check;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>App ID</Label>
          <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="1234567890" />
        </div>
        <div className="space-y-1">
          <Label>App Secret {props.meta.hasAppSecret && <span className="text-xs text-emerald-500">(salvo)</span>}</Label>
          <Input value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder={props.meta.hasAppSecret ? "•••••••• (deixe vazio p/ manter)" : "abcdef..."} type="password" />
        </div>
        <div className="space-y-1">
          <Label>Login Configuration ID</Label>
          <Input value={configId} onChange={(e) => setConfigId(e.target.value)} placeholder="9876543210" />
        </div>
        <div className="space-y-1">
          <Label>Verify Token do Webhook <span className="text-xs text-muted-foreground">(opcional)</span></Label>
          <Input value={verify} onChange={(e) => setVerify(e.target.value)} placeholder="deixe vazio p/ gerar" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => props.onSave({
            appId: appId.trim(),
            ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
            configId: configId.trim(),
            verifyToken: verify.trim(),
          })}
          disabled={props.saving || !appId.trim() || !configId.trim() || (!props.meta.hasAppSecret && !appSecret.trim())}
        >
          {props.saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : "Salvar credenciais"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => validateMut.mutate({
            appId: appId.trim() || undefined,
            ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
            configId: configId.trim() || undefined,
            verifyToken: verify.trim() || undefined,
          })}
          disabled={validateMut.isPending || (!appId.trim() && !props.meta.appId)}
        >
          {validateMut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Validar na Meta</>}
        </Button>
        <Button
          variant="outline"
          onClick={props.onConfigureAppWebhook}
          disabled={props.configuringWebhook || !props.meta.appId || !props.meta.hasAppSecret || !props.meta.verifyToken}
          title={!props.meta.hasAppSecret ? "Salve o App Secret primeiro" : ""}
        >
          {props.configuringWebhook ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Registrar webhook na Meta</>}
        </Button>
      </div>
      {check && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="text-xs font-medium uppercase text-muted-foreground">
            Resultado da validação {check.overall && <span className="text-emerald-500">— tudo OK</span>}
          </div>
          <CredentialCheckRow label="App ID" c={check.appId} />
          <CredentialCheckRow label="App Secret" c={check.appSecret} />
          <CredentialCheckRow label="Login Configuration ID" c={check.configId} />
          <CredentialCheckRow label="Verify Token" c={check.verifyToken} />
        </div>
      )}
      <Separator />
      <div className="grid gap-3 md:grid-cols-2">
        <CopyableField label="Verify Token (Webhook)" value={props.meta.verifyToken} />
        <CopyableField label="Webhook URL" value={props.meta.webhookUrl} />
      </div>
    </div>
  );
}

function CredentialCheckRow({ label, c }: { label: string; c: FieldCheck }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {c.ok
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
      <div className="flex-1">
        <div className={c.ok ? "" : "font-medium text-destructive"}>
          <span className="font-medium">{label}:</span> {c.message}
        </div>
        {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
      </div>
    </div>
  );
}

/* ------------------------------- PASSO 2 -------------------------------- */

function StepPickNumber(props: {
  accounts: Account[];
  options: Array<{ wabaId: string; phoneNumberId: string; displayPhone: string | null; verifiedName: string | null }>;
  picked: string | null;
  onPick: (v: string) => void;
  saving: boolean;
  error: string | null;
  onContinue: () => void;
  canManual: boolean;
  manualWabaId: string;
  manualPhoneNumberId: string;
  onManualWabaIdChange: (v: string) => void;
  onManualPhoneNumberIdChange: (v: string) => void;
  onManualSave: () => void;
  onSetDefault: (id: string) => void;
  settingDefault: boolean;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">Selecione seu número de WhatsApp</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha qual conta do WhatsApp Business (WABA) e número o Lívia CRM vai usar para enviar mensagens.
          </p>
        </div>

        <InlineError message={props.error} />

        {props.options.length > 0 ? (
          <div className="space-y-2">
            {props.options.map((o) => {
              const key = `${o.wabaId}-${o.phoneNumberId}`;
              const active = props.picked === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => props.onPick(key)}
                  className={`flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition ${active ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                >
                  <span>
                    <span className="font-medium">{o.displayPhone ?? o.phoneNumberId}</span>
                    {o.verifiedName && <span className="text-muted-foreground"> · {o.verifiedName}</span>}
                    <span className="block font-mono text-xs text-muted-foreground">WABA {o.wabaId}</span>
                  </span>
                  {active && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={props.onBack}>Voltar</Button>
              <Button onClick={props.onContinue} disabled={!props.picked || props.saving}>
                {props.saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : <>Continuar <ChevronRight className="ml-1 h-4 w-4" /></>}
              </Button>
            </div>
          </div>
        ) : props.accounts.length ? (
          <div className="space-y-2">
            {props.accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <div>
                  <div className="font-medium">{a.display_phone_number ?? a.phone_number_id} {a.is_default && <Badge className="ml-1">Padrão</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{a.business_name ?? "—"} · WABA {a.waba_id}</div>
                </div>
                {!a.is_default && (
                  <Button size="sm" variant="outline" onClick={() => props.onSetDefault(a.id)} disabled={props.settingDefault}>
                    {props.settingDefault ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Star className="mr-1 h-3 w-3" />}
                    Usar este
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center">
            <Smartphone className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <div className="text-sm font-medium">Nenhum número disponível ainda</div>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Volte ao passo 1 e conclua o login com a Meta para listarmos suas contas e números.
            </p>
            <Button className="mt-3" variant="outline" onClick={props.onBack}>Voltar ao passo 1</Button>
          </div>
        )}
      </Card>

      {props.canManual && (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold">Informar IDs manualmente</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>WABA ID</Label>
              <Input value={props.manualWabaId} onChange={(e) => props.onManualWabaIdChange(e.target.value.trim())} placeholder="123456789012345" className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Phone Number ID</Label>
              <Input value={props.manualPhoneNumberId} onChange={(e) => props.onManualPhoneNumberIdChange(e.target.value.trim())} placeholder="987654321098765" className="font-mono" />
            </div>
          </div>
          <Button onClick={props.onManualSave} disabled={!props.manualWabaId.trim() || !props.manualPhoneNumberId.trim() || props.saving}>
            {props.saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Salvar conta</>}
          </Button>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------- PASSO 3 -------------------------------- */

function StepActivate(props: {
  accounts: Account[];
  qc: ReturnType<typeof useQueryClient>;
  onSubscribe: (id: string) => void;
  subscribing: boolean;
  subscribeError: string | null;
}) {
  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold">Ative seu número</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Este passo é necessário para enviar e receber mensagens. A Meta envia um código de 6 dígitos
          por SMS ou ligação para confirmar que o número pertence a você.
        </p>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Status <strong>&quot;Em análise&quot;</strong> é normal para contas novas e pode levar até 48h.
          Se o status <strong>&quot;Pendente&quot;</strong> persistir, conclua o registro via PIN abaixo.
        </AlertDescription>
      </Alert>

      <InlineError message={props.subscribeError} />

      {props.accounts.map((a) => (
        <div key={a.id} className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-medium">
              {a.display_phone_number ?? a.phone_number_id}
              {a.is_default && <Badge>Padrão</Badge>}
              {a.webhook_subscribed
                ? <Badge className="gap-1 bg-emerald-500/15 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Ativo</Badge>
                : <Badge className="gap-1 bg-amber-500/15 text-amber-600"><AlertTriangle className="h-3 w-3" />Pendente</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">{a.business_name ?? "—"} · WABA {a.waba_id}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <RegisterPhoneDialog account={a} qc={props.qc} />
            <Button size="sm" variant="outline" onClick={() => props.onSubscribe(a.id)} disabled={props.subscribing}>
              {props.subscribing ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Aguarde…</> : "Inscrever webhook"}
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function RegisterPhoneDialog({ account, qc }: { account: Account; qc: ReturnType<typeof useQueryClient> }) {
  const [open, setOpen] = useState(false);
  const [dialogStep, setDialogStep] = useState<1 | 2>(1);
  const [codeMethod, setCodeMethod] = useState<"SMS" | "VOICE">("SMS");
  const [pin, setPin] = useState("");

  const requestCodeMut = useMutation({
    mutationFn: () => api("POST", { action: "request-code", accountId: account.id, codeMethod }),
    onSuccess: () => {
      toast.success(`Código enviado por ${codeMethod === "SMS" ? "SMS" : "ligação"}.`);
      setDialogStep(2);
    },
    onError: (e) => {
      console.error("[RegisterPhoneDialog] request-code error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao solicitar código.");
    },
  });

  const registerMut = useMutation({
    mutationFn: () => api("POST", { action: "register-phone", accountId: account.id, pin: pin.trim() }),
    onSuccess: () => {
      toast.success("Número ativado com sucesso!");
      qc.invalidateQueries({ queryKey: ["wa-cloud"] });
      setOpen(false);
    },
    onError: (e) => {
      console.error("[RegisterPhoneDialog] register-phone error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao ativar número.");
    },
  });

  const statusMut = useMutation({
    mutationFn: () => api<{ ok: boolean; status: { id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; status?: string; code_verification_status?: string } }>("POST", { action: "check-phone-status", accountId: account.id }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao verificar status."),
  });

  function reset() {
    setDialogStep(1);
    setCodeMethod("SMS");
    setPin("");
    requestCodeMut.reset();
    registerMut.reset();
    statusMut.reset();
  }

  const pending = !account.webhook_subscribed;
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant={pending ? "default" : "outline"} className="gap-1">
          {pending ? <AlertTriangle className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
          Enviar código de verificação
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Ativar número do WhatsApp</DialogTitle>
          <DialogDescription>
            {dialogStep === 1
              ? `Solicite um código de 6 dígitos para ${account.display_phone_number ?? account.phone_number_id}.`
              : `Digite o código de 6 dígitos que a Meta enviou para ${account.display_phone_number ?? account.phone_number_id}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${dialogStep === 1 ? "bg-primary text-primary-foreground" : "bg-emerald-500 text-white"}`}>1</span>
          <span className={dialogStep === 1 ? "font-medium text-foreground" : ""}>Solicitar código</span>
          <span>→</span>
          <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${dialogStep === 2 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>2</span>
          <span className={dialogStep === 2 ? "font-medium text-foreground" : ""}>Inserir PIN</span>
        </div>

        {dialogStep === 1 ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Como deseja receber o código?</Label>
              <RadioGroup value={codeMethod} onValueChange={(v) => setCodeMethod(v as "SMS" | "VOICE")} className="grid grid-cols-2 gap-3">
                <label className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-accent ${codeMethod === "SMS" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="SMS" id={`sms-${account.id}`} />
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  <div className="text-sm"><div className="font-medium">SMS</div><div className="text-xs text-muted-foreground">Por mensagem</div></div>
                </label>
                <label className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-accent ${codeMethod === "VOICE" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="VOICE" id={`voice-${account.id}`} />
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div className="text-sm"><div className="font-medium">Ligação</div><div className="text-xs text-muted-foreground">Por chamada</div></div>
                </label>
              </RadioGroup>
            </div>
            <InlineError message={requestCodeMut.isError ? (requestCodeMut.error instanceof Error ? requestCodeMut.error.message : "Erro ao solicitar código.") : null} />
            {statusMut.data && (
              <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-medium text-foreground">Status na Meta:</div>
                <div>Status: <span className="font-mono">{statusMut.data.status?.status ?? "—"}</span></div>
                <div>Verificação: <span className="font-mono">{statusMut.data.status?.code_verification_status ?? "—"}</span></div>
                <div>Qualidade: <span className="font-mono">{statusMut.data.status?.quality_rating ?? "—"}</span></div>
                {statusMut.data.status?.code_verification_status === "VERIFIED" && (
                  <p className="mt-1 font-medium text-emerald-600">Número já verificado — clique em &quot;Número já ativo&quot;.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <InlineError message={registerMut.isError ? (registerMut.error instanceof Error ? registerMut.error.message : "Erro ao ativar número.") : null} />
            <div className="space-y-1">
              <Label htmlFor={`pin-${account.id}`}>PIN de 6 dígitos</Label>
              <Input
                id={`pin-${account.id}`}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                inputMode="numeric"
                className="text-center font-mono text-lg tracking-widest"
                autoFocus
              />
            </div>
            <button type="button" onClick={() => setDialogStep(1)} className="text-xs text-primary underline-offset-2 hover:underline">
              Reenviar código
            </button>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancelar</Button>
          {dialogStep === 1 ? (
            <>
              <Button variant="outline" onClick={() => statusMut.mutate()} disabled={statusMut.isPending}>
                {statusMut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : "Verificar status"}
              </Button>
              {statusMut.data?.status?.code_verification_status === "VERIFIED" && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await api("POST", { action: "subscribe-webhook", accountId: account.id }).catch(() => null);
                    qc.invalidateQueries({ queryKey: ["wa-cloud"] });
                    toast.success("Número marcado como ativo.");
                    setOpen(false);
                    reset();
                  }}
                >
                  Número já ativo — concluir
                </Button>
              )}
              <Button onClick={() => { requestCodeMut.reset(); requestCodeMut.mutate(); }} disabled={requestCodeMut.isPending}>
                {requestCodeMut.isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</>
                  : requestCodeMut.isError
                    ? <><AlertTriangle className="mr-2 h-4 w-4" />Tentar novamente</>
                    : "Enviar código"}
              </Button>
            </>
          ) : (
            <Button onClick={() => registerMut.mutate()} disabled={pin.length !== 6 || registerMut.isPending}>
              {registerMut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : <><ShieldCheck className="mr-2 h-4 w-4" />Ativar número</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- PASSO 4 -------------------------------- */

function StepConnected(props: {
  account: Account;
  accounts: Account[];
  isAdmin: boolean;
  onSync: () => void;
  syncing: boolean;
  onReset: () => void;
  resetting: boolean;
  onSetDefault: (id: string) => void;
}) {
  const { account } = props;
  const statusQuery = useQuery({
    queryKey: ["wa-cloud-phone-status", account.id],
    queryFn: () => api<{ ok: boolean; status: { quality_rating?: string; status?: string; verified_name?: string; code_verification_status?: string } }>("POST", { action: "check-phone-status", accountId: account.id }),
    staleTime: 60_000,
    retry: false,
  });
  const quality = statusQuery.data?.status?.quality_rating ?? "—";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div>
          <div className="font-semibold text-emerald-700 dark:text-emerald-400">WhatsApp Cloud API integrado com sucesso</div>
          <p className="text-sm text-muted-foreground">Seu CRM já pode enviar e receber mensagens por este número.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Número conectado</div>
          <div className="mt-1 text-lg font-semibold">{account.display_phone_number ?? account.phone_number_id}</div>
          <div className="text-xs text-muted-foreground">{account.verified_name ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Conta (WABA)</div>
          <div className="mt-1 truncate text-lg font-semibold">{account.business_name ?? "—"}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{account.waba_id}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Qualidade do número</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-semibold">
            {statusQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <span className={
                quality === "GREEN" ? "text-emerald-600"
                  : quality === "YELLOW" ? "text-amber-600"
                    : quality === "RED" ? "text-rose-600" : ""
              }>{quality}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">Status: {statusQuery.data?.status?.status ?? "—"}</div>
        </Card>
      </div>

      <Card className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">Próximos passos</h3>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link to="/settings/whatsapp-templates"><FileText className="mr-2 h-4 w-4" />Ir para Templates</Link></Button>
          <Button asChild variant="outline"><Link to="/campaigns"><Megaphone className="mr-2 h-4 w-4" />Ir para Campanhas</Link></Button>
          <Button asChild variant="outline"><Link to="/settings/bot"><Bot className="mr-2 h-4 w-4" />Configurar Bot</Link></Button>
          <Button asChild variant="ghost"><Link to="/settings/whatsapp-cloud/dashboard">Painel de mensagens</Link></Button>
        </div>
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={props.onSync} disabled={props.syncing}>
            {props.syncing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : "Sincronizar templates da Meta"}
          </Button>
          <TestSendCard accountId={account.id} />
        </div>
      </Card>

      {props.accounts.length > 1 && (
        <Card className="space-y-2 p-5">
          <h3 className="text-sm font-semibold">Outras contas conectadas</h3>
          {props.accounts.filter((a) => a.id !== account.id).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">{a.display_phone_number ?? a.phone_number_id}</div>
                <div className="text-xs text-muted-foreground">WABA {a.waba_id}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => props.onSetDefault(a.id)}><Star className="mr-1 h-3 w-3" />Tornar padrão</Button>
            </div>
          ))}
        </Card>
      )}

      {props.isAdmin && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="text-sm font-semibold">Redefinir integração</div>
            <p className="text-xs text-muted-foreground">Remove todas as contas conectadas e reinicia o wizard do zero.</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={props.resetting}>
                {props.resetting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : <><RotateCcw className="mr-2 h-4 w-4" />Redefinir integração</>}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Redefinir a integração?</AlertDialogTitle>
                <AlertDialogDescription>
                  Todas as contas do WhatsApp Cloud conectadas serão removidas do CRM. Você precisará refazer o wizard para voltar a enviar mensagens.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={props.onReset}>Sim, redefinir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      )}
    </div>
  );
}

function TestSendCard({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [text, setText] = useState("Teste do Lívia CRM");
  const [tplName, setTplName] = useState("");
  const sendMut = useMutation({
    mutationFn: () => api("POST", { action: "send-test", accountId, toPhone: to, ...(tplName ? { templateName: tplName, templateLanguage: "pt_BR" } : { text }) }),
    onSuccess: () => toast.success("Mensagem enviada!"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) sendMut.reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline"><Send className="mr-2 h-4 w-4" />Enviar mensagem de teste</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Teste de envio</DialogTitle>
          <DialogDescription>Texto livre só funciona se o destino tiver falado com você nas últimas 24h. Caso contrário use um template aprovado.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Telefone (E.164)</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+5511999999999" /></div>
          <div className="space-y-1"><Label>Template (opcional)</Label><Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="ex.: hello_world" /></div>
          {!tplName && <div className="space-y-1"><Label>Mensagem</Label><Input value={text} onChange={(e) => setText(e.target.value)} /></div>}
          <InlineError message={sendMut.isError ? (sendMut.error instanceof Error ? sendMut.error.message : "Erro no envio.") : null} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Fechar</Button>
          <Button onClick={() => sendMut.mutate()} disabled={!to || sendMut.isPending}>
            {sendMut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : <><Send className="mr-2 h-4 w-4" />Enviar teste</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { Trash2 as _unusedTrash };
