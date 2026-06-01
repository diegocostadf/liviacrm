import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Save, PlugZap, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getAIProviders, updateAIProviders, testAIProvider } from "@/lib/ai-providers.functions";

export const Route = createFileRoute("/_authenticated/settings/ai-providers")({
  head: () => ({ meta: [{ title: "Provedores de IA — Lívia CRM" }] }),
  component: AIProvidersPage,
});

type ProviderId = "lovable" | "openai" | "anthropic" | "google";

const PROVIDER_META: Record<ProviderId, { label: string; desc: string; docsUrl: string; suggested: string[]; needsKey: boolean }> = {
  lovable: {
    label: "Lovable AI Gateway",
    desc: "Gateway integrado (sem precisar de chave). Modelos Google/OpenAI já incluídos.",
    docsUrl: "https://docs.lovable.dev/features/ai",
    suggested: ["google/gemini-3-flash-preview", "google/gemini-2.5-pro", "openai/gpt-5-mini", "openai/gpt-5"],
    needsKey: false,
  },
  anthropic: {
    label: "Anthropic Claude",
    desc: "API direta da Anthropic. Use sua chave (sk-ant-...).",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    suggested: ["claude-opus-4-1-20250805", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"],
    needsKey: true,
  },
  openai: {
    label: "OpenAI (direto)",
    desc: "API direta da OpenAI. Use sua chave (sk-...).",
    docsUrl: "https://platform.openai.com/docs/models",
    suggested: ["gpt-5", "gpt-5-mini", "gpt-5.4-mini"],
    needsKey: true,
  },
  google: {
    label: "Google AI Studio",
    desc: "API do Gemini via Google AI Studio (endpoint OpenAI-compatível).",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    suggested: ["gemini-2.5-flash", "gemini-2.5-pro"],
    needsKey: true,
  },
};

type ProviderForm = { enabled: boolean; defaultModel: string; apiKey: string; hasKey: boolean; keyPreview: string };

function AIProvidersPage() {
  const qc = useQueryClient();
  const fetchCfg = useServerFn(getAIProviders);
  const update = useServerFn(updateAIProviders);
  const test = useServerFn(testAIProvider);

  const { data, isLoading, error } = useQuery({ queryKey: ["ai-providers"], queryFn: () => fetchCfg() });

  const [form, setForm] = useState<{ default: { provider: ProviderId; model: string }; providers: Record<ProviderId, ProviderForm> } | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      default: data.default,
      providers: Object.fromEntries(
        (Object.entries(data.providers) as [ProviderId, typeof data.providers[ProviderId]][]).map(([id, p]) => [
          id,
          { enabled: p.enabled, defaultModel: p.defaultModel, apiKey: "", hasKey: p.hasKey, keyPreview: p.keyPreview },
        ]),
      ) as Record<ProviderId, ProviderForm>,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      update({
        data: {
          default: form!.default,
          providers: Object.fromEntries(
            (Object.entries(form!.providers) as [ProviderId, ProviderForm][]).map(([id, p]) => [
              id,
              { enabled: p.enabled, defaultModel: p.defaultModel, apiKey: p.apiKey || undefined },
            ]),
          ) as Record<ProviderId, { enabled: boolean; defaultModel: string; apiKey?: string }>,
        },
      }),
    onSuccess: () => {
      toast.success("Provedores salvos");
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const testMut = useMutation({
    mutationFn: (v: { provider: ProviderId; model: string }) => test({ data: v }),
    onSuccess: (r, v) => {
      if (r.ok) toast.success(`${v.provider} OK em ${r.latencyMs}ms`);
      else toast.error(`${v.provider}: ${r.error}`);
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{error instanceof Error ? error.message : "Erro"}</div>;
  if (!form) return null;

  const enabledProviders = (Object.entries(form.providers) as [ProviderId, ProviderForm][]).filter(([, p]) => p.enabled);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-6 w-6" /> Provedores de IA
          </h1>
          <p className="text-sm text-muted-foreground">
            Habilite e configure os provedores. O bot escolhe o provedor + modelo por instância em "Bot Júlia".
          </p>
        </div>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Padrão do sistema</h2>
            <p className="text-xs text-muted-foreground">Usado quando uma instância não definir um próprio.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Provedor padrão</Label>
              <Select value={form.default.provider} onValueChange={(v) => setForm({ ...form, default: { ...form.default, provider: v as ProviderId } })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROVIDER_META) as ProviderId[]).map((id) => (
                    <SelectItem key={id} value={id}>{PROVIDER_META[id].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Modelo padrão</Label>
              <Input value={form.default.model} onChange={(e) => setForm({ ...form, default: { ...form.default, model: e.target.value } })} />
            </div>
          </div>
        </Card>

        {(Object.keys(PROVIDER_META) as ProviderId[]).map((id) => {
          const meta = PROVIDER_META[id];
          const p = form.providers[id];
          return (
            <Card key={id} className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">{meta.label}</h3>
                    {p.enabled ? <Badge variant="default">ativo</Badge> : <Badge variant="outline">desativado</Badge>}
                    {meta.needsKey && p.hasKey && <Badge variant="secondary">chave salva</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{meta.desc}</p>
                  <a href={meta.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">documentação</a>
                </div>
                <Switch checked={p.enabled} onCheckedChange={(v) => setForm({ ...form, providers: { ...form.providers, [id]: { ...p, enabled: v } } })} />
              </div>

              <Separator />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Modelo padrão</Label>
                  <Input
                    value={p.defaultModel}
                    onChange={(e) => setForm({ ...form, providers: { ...form.providers, [id]: { ...p, defaultModel: e.target.value } } })}
                    placeholder={meta.suggested[0]}
                  />
                  <div className="flex flex-wrap gap-1 pt-1">
                    {meta.suggested.map((m) => (
                      <button
                        key={m}
                        onClick={() => setForm({ ...form, providers: { ...form.providers, [id]: { ...p, defaultModel: m } } })}
                        className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] hover:bg-accent"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {meta.needsKey && (
                  <div className="space-y-1.5">
                    <Label>API Key</Label>
                    <Input
                      type="password"
                      value={p.apiKey}
                      onChange={(e) => setForm({ ...form, providers: { ...form.providers, [id]: { ...p, apiKey: e.target.value } } })}
                      placeholder={p.hasKey ? `Atual: ${p.keyPreview} (deixe em branco para manter)` : "Cole sua chave aqui"}
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!p.enabled || testMut.isPending}
                  onClick={() => testMut.mutate({ provider: id, model: p.defaultModel || meta.suggested[0] })}
                >
                  {testMut.isPending && testMut.variables?.provider === id ? (
                    <>Testando…</>
                  ) : testMut.data?.ok && testMut.variables?.provider === id ? (
                    <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-success" /> Testar conexão</>
                  ) : testMut.data && !testMut.data.ok && testMut.variables?.provider === id ? (
                    <><AlertTriangle className="mr-1.5 h-3.5 w-3.5 text-destructive" /> Testar conexão</>
                  ) : (
                    <><PlugZap className="mr-1.5 h-3.5 w-3.5" /> Testar conexão</>
                  )}
                </Button>
              </div>
            </Card>
          );
        })}

        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <span>{enabledProviders.length} provedor(es) ativo(s).</span>
          <span>As chaves são armazenadas com acesso restrito (admins/gestores).</span>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="mr-2 h-4 w-4" /> {save.isPending ? "Salvando…" : "Salvar tudo"}
          </Button>
        </div>
      </div>
    </div>
  );
}