import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
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
  group_link: string;
  landing_link: string;
  out_of_hours_message: string;
  handoff_keywords: string;
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
  group_link: "",
  landing_link: "",
  out_of_hours_message: "",
  handoff_keywords: "humano, atendente, pessoa, falar com alguém",
  bh_enabled: false,
  bh_start: 8,
  bh_end: 21,
};

function BotSettingsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listBotConfigs);
  const upsert = useServerFn(upsertBotConfig);
  const fetchProviders = useServerFn(getAIProviders);

  const { data, isLoading } = useQuery({ queryKey: ["bot-configs"], queryFn: () => list() });
  const { data: providers } = useQuery({ queryKey: ["ai-providers"], queryFn: () => fetchProviders() });

  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(DEFAULT_FORM);

  useEffect(() => {
    if (!data?.length) return;
    if (!selected) setSelected(data[0].instance.id);
  }, [data, selected]);

  useEffect(() => {
    if (!selected || !data) return;
    const entry = data.find((d) => d.instance.id === selected);
    if (!entry) return;
    const c = entry.config;
    if (!c) {
      setForm(DEFAULT_FORM);
      return;
    }
    const bh = (c.business_hours ?? {}) as { enabled?: boolean; start_hour?: number; end_hour?: number };
    setForm({
      enabled: c.enabled,
      persona: c.persona,
      goal: c.goal,
      tone: c.tone,
      language: c.language,
      model_provider: (c.model_provider as ProviderId) ?? "lovable",
      model_name: c.model_name ?? "google/gemini-3-flash-preview",
      temperature: Number(c.temperature ?? 0.4),
      max_tokens: c.max_tokens ?? 1024,
      system_extra: c.system_extra ?? "",
      group_link: c.group_link ?? "",
      landing_link: c.landing_link ?? "",
      out_of_hours_message: c.out_of_hours_message ?? "",
      handoff_keywords: (c.handoff_keywords ?? []).join(", "),
      bh_enabled: Boolean(bh.enabled),
      bh_start: bh.start_hour ?? 8,
      bh_end: bh.end_hour ?? 21,
    });
  }, [selected, data]);

  const save = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          instance_id: selected!,
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
          group_link: form.group_link || null,
          landing_link: form.landing_link || null,
          out_of_hours_message: form.out_of_hours_message || null,
          handoff_keywords: form.handoff_keywords.split(",").map((s) => s.trim()).filter(Boolean),
          business_hours: { enabled: form.bh_enabled, start_hour: form.bh_start, end_hour: form.bh_end },
        },
      }),
    onSuccess: () => {
      toast.success("Configuração do bot salva");
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

                <Card className="space-y-4 p-5">
                  <h2 className="text-base font-semibold">Personalidade</h2>
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
                    <Label>Palavras-chave que pausam o bot (separadas por vírgula)</Label>
                    <Input value={form.handoff_keywords} onChange={(e) => setForm({ ...form, handoff_keywords: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mensagem fora do horário</Label>
                    <Textarea rows={2} value={form.out_of_hours_message} onChange={(e) => setForm({ ...form, out_of_hours_message: e.target.value })} placeholder="Estamos fora do horário de atendimento…" />
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