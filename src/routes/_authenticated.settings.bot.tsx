import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Save, Sparkles, MessageSquare, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { listBotConfigs, upsertBotConfig } from "@/lib/ai-bot.functions";
import { getAIProviders } from "@/lib/ai-providers.functions";

export const Route = createFileRoute("/_authenticated/settings/bot")({
  head: () => ({ meta: [{ title: "Bot Júlia — Lívia CRM" }] }),
  component: BotSettingsPage,
});

type ProviderId = "lovable" | "openai" | "anthropic" | "google";

type Form = {
  enabled: boolean;
  persona: string;
  goal: string;
  tone: string;
  language: string;
  model_provider: ProviderId;
  model_name: string;
  temperature: number;
  max_tokens: number;
  system_extra: string;
  system_prompt_md: string;
  group_link: string;
  landing_link: string;
  out_of_hours_message: string;
  handoff_keywords: string;
  handoff_phone: string;
  typing_indicator: boolean;
  bh_enabled: boolean;
  bh_start: number;
  bh_end: number;
};

const DEFAULT_FORM: Form = {
  enabled: false,
  persona: "Você é Júlia, assistente de vendas amigável e direta da Russomano Educação. Responde rápido, sem jargão.",
  goal: "Qualificar o lead, tirar dúvidas com base na Base de Conhecimento e enviar o link certo para conversão.",
  tone: "amigável, breve, sem jargão",
  language: "pt-BR",
  model_provider: "lovable",
  model_name: "google/gemini-3-flash-preview",
  temperature: 0.4,
  max_tokens: 1024,
  system_extra: "",
  system_prompt_md: "",
  group_link: "",
  landing_link: "",
  out_of_hours_message: "",
  handoff_keywords: "humano, atendente, pessoa, falar com alguém",
  handoff_phone: "",
  typing_indicator: true,
  bh_enabled: false,
  bh_start: 8,
  bh_end: 21,
};

type BotConfigRow = Partial<{
  enabled: boolean;
  persona: string;
  goal: string;
  tone: string;
  language: string;
  model_provider: string;
  model_name: string;
  temperature: number | string;
  max_tokens: number;
  system_extra: string | null;
  system_prompt_md: string | null;
  group_link: string | null;
  landing_link: string | null;
  out_of_hours_message: string | null;
  handoff_keywords: string[];
  handoff_phone: string | null;
  typing_indicator: boolean;
  business_hours: { enabled?: boolean; start_hour?: number; end_hour?: number } | null;
}>;

function formFromConfig(c: BotConfigRow | null | undefined): Form {
  if (!c) return DEFAULT_FORM;
  const bh = c.business_hours ?? {};
  return {
    enabled: c.enabled ?? DEFAULT_FORM.enabled,
    persona: c.persona ?? DEFAULT_FORM.persona,
    goal: c.goal ?? DEFAULT_FORM.goal,
    tone: c.tone ?? DEFAULT_FORM.tone,
    language: c.language ?? DEFAULT_FORM.language,
    model_provider: (c.model_provider as ProviderId) ?? DEFAULT_FORM.model_provider,
    model_name: c.model_name ?? DEFAULT_FORM.model_name,
    temperature: Number(c.temperature ?? DEFAULT_FORM.temperature),
    max_tokens: c.max_tokens ?? DEFAULT_FORM.max_tokens,
    system_extra: c.system_extra ?? "",
    system_prompt_md: c.system_prompt_md ?? "",
    group_link: c.group_link ?? "",
    landing_link: c.landing_link ?? "",
    out_of_hours_message: c.out_of_hours_message ?? "",
    handoff_keywords: (c.handoff_keywords ?? []).join(", "),
    handoff_phone: c.handoff_phone ?? "",
    typing_indicator: c.typing_indicator ?? DEFAULT_FORM.typing_indicator,
    bh_enabled: Boolean(bh.enabled),
    bh_start: bh.start_hour ?? DEFAULT_FORM.bh_start,
    bh_end: bh.end_hour ?? DEFAULT_FORM.bh_end,
  };
}

function BotSettingsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listBotConfigs);
  const upsert = useServerFn(upsertBotConfig);
  const fetchProviders = useServerFn(getAIProviders);

  const { data, isLoading } = useQuery({ queryKey: ["bot-configs"], queryFn: () => list() });
  const { data: providers } = useQuery({ queryKey: ["ai-providers"], queryFn: () => fetchProviders() });

  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data?.length) return;
    if (!selected) setSelected(data[0].instance.id);
  }, [data, selected]);

  useEffect(() => {
    if (!selected || !data) return;
    // Only hydrate the form when the selected instance changes. Avoid
    // overwriting in-progress edits when the query refetches in background
    // (window focus, invalidation, etc).
    if (loadedForRef.current === selected) return;
    const entry = data.find((d) => d.instance.id === selected);
    if (!entry) return;
    setForm(formFromConfig(entry.config as BotConfigRow | null));
    loadedForRef.current = selected;
  }, [selected, data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione uma instância antes de salvar.");
      return upsert({
        data: {
          instance_id: selected,
          enabled: form.enabled,
          persona: form.persona,
          goal: form.goal,
          tone: form.tone,
          language: form.language,
          model_provider: form.model_provider,
          model_name: form.model_name,
          temperature: form.temperature,
          max_tokens: form.max_tokens,
          system_extra: form.system_extra || null,
          system_prompt_md: form.system_prompt_md || null,
          group_link: form.group_link || null,
          landing_link: form.landing_link || null,
          out_of_hours_message: form.out_of_hours_message || null,
          handoff_keywords: form.handoff_keywords.split(",").map((s) => s.trim()).filter(Boolean),
          handoff_phone: form.handoff_phone || null,
          typing_indicator: form.typing_indicator,
          business_hours: { enabled: form.bh_enabled, start_hour: form.bh_start, end_hour: form.bh_end },
        },
      });
    },
    onSuccess: (result) => {
      const saved = (result as { config?: BotConfigRow })?.config;
      if (saved) setForm(formFromConfig(saved));
      toast.success("Configuração do bot salva");
      loadedForRef.current = selected;
      qc.invalidateQueries({ queryKey: ["bot-configs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const availableProviders: ProviderId[] = useMemo(() => {
    if (!providers) return ["lovable", "openai", "anthropic", "google"];
    return (Object.entries(providers.providers) as [ProviderId, { enabled: boolean }][])
      .filter(([, p]) => p.enabled)
      .map(([id]) => id);
  }, [providers]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bot className="h-6 w-6" /> Bot Júlia
          </h1>
          <p className="text-sm text-muted-foreground">
            Personalize persona, modelo e regras para cada instância conectada.
          </p>
        </div>

        {!data?.length ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Nenhuma instância encontrada. Crie uma em <strong>Conexões</strong> primeiro.
          </Card>
        ) : (
          <>
            <Card className="p-4">
              <Label className="mb-1.5 block text-xs">Instância</Label>
              <Select value={selected ?? undefined} onValueChange={setSelected}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {data.map((d) => (
                    <SelectItem key={d.instance.id} value={d.instance.id}>
                      {d.instance.name} ({d.instance.evolution_instance_name})
                      {d.config?.enabled ? " · bot ON" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Card>

            {selected && (
              <>
                <Card className="space-y-4 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold">Ativação</h2>
                      <p className="text-xs text-muted-foreground">Quando ligado, o bot assume novas conversas automaticamente.</p>
                    </div>
                    <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  </div>
                </Card>

                <Card className="space-y-4 p-5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    <h2 className="text-base font-semibold">Modelo de IA</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Provedor</Label>
                      <Select value={form.model_provider} onValueChange={(v) => setForm({ ...form, model_provider: v as ProviderId })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(["lovable", "anthropic", "openai", "google"] as ProviderId[]).map((id) => (
                            <SelectItem key={id} value={id} disabled={!availableProviders.includes(id)}>
                              {id === "lovable" ? "Lovable AI Gateway" : id === "anthropic" ? "Anthropic Claude" : id === "openai" ? "OpenAI" : "Google AI Studio"}
                              {!availableProviders.includes(id) ? " (desativado)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Modelo</Label>
                      <Input value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Criatividade (temperature: {form.temperature.toFixed(2)})</Label>
                      <Slider value={[form.temperature]} min={0} max={1.5} step={0.05} onValueChange={([v]) => setForm({ ...form, temperature: v })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Máx. tokens</Label>
                      <Input type="number" min={64} max={8000} value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} />
                    </div>
                  </div>
                </Card>

                <Card className="space-y-3 p-5">
                  <div>
                    <h2 className="text-base font-semibold">System Prompt (Markdown)</h2>
                    <p className="text-xs text-muted-foreground">
                      Escreva aqui todo o direcional do bot em Markdown (persona, objetivo, regras, exemplos, FAQs).
                      Quando preenchido, este texto <strong>substitui</strong> os campos Persona/Objetivo/Tom/Idioma abaixo
                      como instrução principal. Os links, base de conhecimento e regras de segurança continuam sendo anexados automaticamente.
                    </p>
                  </div>
                  <Textarea
                    rows={16}
                    className="font-mono text-xs"
                    value={form.system_prompt_md}
                    onChange={(e) => setForm({ ...form, system_prompt_md: e.target.value })}
                    placeholder={`# Persona\nVocê é a Júlia, consultora de vendas da Russomano Educação...\n\n# Objetivo\n- Qualificar o lead\n- Apresentar o curso ideal\n- Enviar o link de inscrição\n\n# Tom de voz\n- Amigável, breve, sem jargão\n- Usa "você", nunca "senhor(a)"\n\n# Regras\n1. Nunca prometa desconto sem confirmar\n2. Se o lead perguntar sobre OAB, ofereça o link do grupo\n3. ...\n\n# FAQs\n**Quanto custa?** R$ ...\n**Tem material?** Sim, ...`}
                  />
                  <div className="text-[11px] text-muted-foreground">
                    {form.system_prompt_md.length.toLocaleString("pt-BR")} caracteres
                    {form.system_prompt_md.trim() ? " · usando este prompt como direcional principal" : " · usando Persona/Objetivo/Tom abaixo"}
                  </div>
                </Card>

                <Card className="space-y-4 p-5">
                  <h2 className="text-base font-semibold">Personalidade (fallback)</h2>
                  <p className="text-xs text-muted-foreground">
                    Usado apenas quando o System Prompt acima estiver vazio.
                  </p>
                  <div className="space-y-1.5">
                    <Label>Persona (quem é o bot?)</Label>
                    <Textarea rows={3} value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Objetivo</Label>
                    <Textarea rows={2} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Tom</Label>
                      <Input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Idioma</Label>
                      <Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Instruções extras (opcional)</Label>
                    <Textarea rows={3} value={form.system_extra} onChange={(e) => setForm({ ...form, system_extra: e.target.value })} placeholder="Regras adicionais, FAQs curtas, restrições…" />
                  </div>
                </Card>

                <Card className="space-y-4 p-5">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    <h2 className="text-base font-semibold">Links de conversão</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Link do grupo</Label>
                      <Input value={form.group_link} onChange={(e) => setForm({ ...form, group_link: e.target.value })} placeholder="https://chat.whatsapp.com/…" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Landing page</Label>
                      <Input value={form.landing_link} onChange={(e) => setForm({ ...form, landing_link: e.target.value })} placeholder="https://…" />
                    </div>
                  </div>
                </Card>

                <Card className="space-y-4 p-5">
                  <h2 className="text-base font-semibold">Handoff humano</h2>
                  <div className="space-y-1.5">
                    <Label>WhatsApp do humano (notificação de transferência)</Label>
                    <Input
                      value={form.handoff_phone}
                      onChange={(e) => setForm({ ...form, handoff_phone: e.target.value })}
                      placeholder="Ex.: 5511999999999 (com DDI + DDD)"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Quando o bot transferir o atendimento, este número receberá uma mensagem com o nome, telefone e motivo do handoff.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Palavras-chave que pausam o bot (separadas por vírgula)</Label>
                    <Input value={form.handoff_keywords} onChange={(e) => setForm({ ...form, handoff_keywords: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mensagem fora do horário</Label>
                    <Textarea rows={2} value={form.out_of_hours_message} onChange={(e) => setForm({ ...form, out_of_hours_message: e.target.value })} placeholder="Estamos fora do horário de atendimento…" />
                  </div>
                </Card>

                <Card className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold">Indicador de "digitando"</h2>
                      <p className="text-xs text-muted-foreground">
                        Mostra o status "digitando…" no WhatsApp antes do bot enviar cada mensagem, tornando a conversa mais natural.
                      </p>
                    </div>
                    <Switch
                      checked={form.typing_indicator}
                      onCheckedChange={(v) => setForm({ ...form, typing_indicator: v })}
                    />
                  </div>
                </Card>

                <Card className="space-y-4 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <h2 className="text-base font-semibold">Horário comercial</h2>
                    </div>
                    <Switch checked={form.bh_enabled} onCheckedChange={(v) => setForm({ ...form, bh_enabled: v })} />
                  </div>
                  {form.bh_enabled && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Início (hora)</Label>
                        <Input type="number" min={0} max={23} value={form.bh_start} onChange={(e) => setForm({ ...form, bh_start: Number(e.target.value) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Fim (hora)</Label>
                        <Input type="number" min={0} max={23} value={form.bh_end} onChange={(e) => setForm({ ...form, bh_end: Number(e.target.value) })} />
                      </div>
                    </div>
                  )}
                </Card>

                <Separator />
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    {form.enabled ? <Badge>bot ativo</Badge> : <Badge variant="outline">bot inativo</Badge>}
                  </div>
                  <Button onClick={() => save.mutate()} disabled={save.isPending}>
                    <Save className="mr-2 h-4 w-4" /> {save.isPending ? "Salvando…" : "Salvar"}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}