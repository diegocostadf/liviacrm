import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save, Clock, ShieldCheck, Layers, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { updateCampaign } from "@/lib/campaigns.functions";
import { listInstances } from "@/lib/evolution.functions";
import { getMessagingProvider } from "@/lib/messaging.functions";

export type CampaignRules = {
  id: string;
  allowed_weekdays: number[];
  max_per_hour: number;
  max_per_day: number;
  pause_on_reply: boolean;
  dedupe_skip_days: number;
  allowed_instance_ids: string[];
  retry_max_attempts: number;
  retry_backoff_seconds: number;
  throttle_min_seconds: number;
  throttle_max_seconds: number;
  window_start_hour: number;
  window_end_hour: number;
  instance_id: string | null;
};

const WEEKDAYS = [
  { v: 0, label: "Dom" },
  { v: 1, label: "Seg" },
  { v: 2, label: "Ter" },
  { v: 3, label: "Qua" },
  { v: 4, label: "Qui" },
  { v: 5, label: "Sex" },
  { v: 6, label: "Sáb" },
];

export function CampaignRulesCard({ campaign }: { campaign: CampaignRules }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateCampaign);
  const listInst = useServerFn(listInstances);

  const { data: instData } = useQuery({
    queryKey: ["instances"],
    queryFn: () => listInst(),
  });
  const instances = (instData ?? []) as Array<{ id: string; name: string; status?: string | null }>;

  const providerFn = useServerFn(getMessagingProvider);
  const { data: providerData } = useQuery({
    queryKey: ["messaging-provider"],
    queryFn: () => providerFn(),
  });
  const provider = providerData?.provider ?? "evolution";
  const isTwilio = provider === "twilio";

  const [weekdays, setWeekdays] = useState<number[]>(campaign.allowed_weekdays ?? [1, 2, 3, 4, 5]);
  const [winStart, setWinStart] = useState(campaign.window_start_hour);
  const [winEnd, setWinEnd] = useState(campaign.window_end_hour);
  const [throttleMin, setThrottleMin] = useState(campaign.throttle_min_seconds);
  const [throttleMax, setThrottleMax] = useState(campaign.throttle_max_seconds);
  const [maxHour, setMaxHour] = useState(campaign.max_per_hour);
  const [maxDay, setMaxDay] = useState(campaign.max_per_day);
  const [pauseOnReply, setPauseOnReply] = useState(campaign.pause_on_reply);
  const [dedupeDays, setDedupeDays] = useState(campaign.dedupe_skip_days);
  const [retryMax, setRetryMax] = useState(campaign.retry_max_attempts);
  const [retryBackoff, setRetryBackoff] = useState(campaign.retry_backoff_seconds);
  const [instanceIds, setInstanceIds] = useState<string[]>(
    campaign.allowed_instance_ids?.length
      ? campaign.allowed_instance_ids
      : campaign.instance_id
        ? [campaign.instance_id]
        : [],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWeekdays(campaign.allowed_weekdays ?? [1, 2, 3, 4, 5]);
    setWinStart(campaign.window_start_hour);
    setWinEnd(campaign.window_end_hour);
    setThrottleMin(campaign.throttle_min_seconds);
    setThrottleMax(campaign.throttle_max_seconds);
    setMaxHour(campaign.max_per_hour);
    setMaxDay(campaign.max_per_day);
    setPauseOnReply(campaign.pause_on_reply);
    setDedupeDays(campaign.dedupe_skip_days);
    setRetryMax(campaign.retry_max_attempts);
    setRetryBackoff(campaign.retry_backoff_seconds);
    setInstanceIds(
      campaign.allowed_instance_ids?.length
        ? campaign.allowed_instance_ids
        : campaign.instance_id
          ? [campaign.instance_id]
          : [],
    );
  }, [campaign.id]);

  function toggleWeekday(v: number) {
    setWeekdays((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort()));
  }

  function toggleInstance(id: string) {
    setInstanceIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function save() {
    if (!weekdays.length) {
      toast.error("Selecione pelo menos um dia da semana");
      return;
    }
    if (!isTwilio && !instanceIds.length) {
      toast.error("Selecione pelo menos uma instância");
      return;
    }
    if (winEnd <= winStart) {
      toast.error("Janela: hora fim deve ser maior que início");
      return;
    }
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: campaign.id,
          allowed_weekdays: weekdays,
          window_start_hour: winStart,
          window_end_hour: winEnd,
          throttle_min_seconds: throttleMin,
          throttle_max_seconds: Math.max(throttleMin, throttleMax),
          max_per_hour: maxHour,
          max_per_day: maxDay,
          pause_on_reply: pauseOnReply,
          dedupe_skip_days: dedupeDays,
          retry_max_attempts: retryMax,
          retry_backoff_seconds: retryBackoff,
          allowed_instance_ids: instanceIds,
        },
      });
      toast.success("Regras salvas");
      qc.invalidateQueries({ queryKey: ["campaign", campaign.id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" /> Janela de envio
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Dias da semana permitidos</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const active = weekdays.includes(d.v);
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleWeekday(d.v)}
                    className={`rounded-md border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">Hora início</Label>
              <Input
                type="number" min={0} max={23}
                value={winStart} onChange={(e) => setWinStart(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label className="text-xs">Hora fim</Label>
              <Input
                type="number" min={0} max={23}
                value={winEnd} onChange={(e) => setWinEnd(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label className="text-xs">Intervalo mín (s)</Label>
              <Input
                type="number" min={2} max={600}
                value={throttleMin} onChange={(e) => setThrottleMin(Number(e.target.value) || 2)}
              />
            </div>
            <div>
              <Label className="text-xs">Intervalo máx (s)</Label>
              <Input
                type="number" min={2} max={600}
                value={throttleMax} onChange={(e) => setThrottleMax(Number(e.target.value) || 2)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" /> Limites e proteção do número
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">Máx por hora</Label>
              <Input
                type="number" min={1} max={10000}
                value={maxHour} onChange={(e) => setMaxHour(Number(e.target.value) || 1)}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Aplicado por instância</p>
            </div>
            <div>
              <Label className="text-xs">Máx por dia</Label>
              <Input
                type="number" min={1} max={1000000}
                value={maxDay} onChange={(e) => setMaxDay(Number(e.target.value) || 1)}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Aplicado por instância</p>
            </div>
            <div>
              <Label className="text-xs">Pular se já contatado nos últimos X dias</Label>
              <Input
                type="number" min={0} max={365}
                value={dedupeDays} onChange={(e) => setDedupeDays(Number(e.target.value) || 0)}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">0 = desativado</p>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={pauseOnReply}
                  onChange={(e) => setPauseOnReply(e.target.checked)}
                />
                Pausar contato se já respondeu
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {!isTwilio && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-primary" /> Instâncias para envio (round-robin)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {instances.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma instância encontrada. Cadastre em Configurações → Conexões.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {instances.map((i) => {
              const active = instanceIds.includes(i.id);
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => toggleInstance(i.id)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    i.status === "open" || i.status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/40"
                  }`} />
                  {i.name}
                  {active && <Badge variant="outline" className="ml-1 text-[9px]">selecionada</Badge>}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Os disparos serão distribuídos entre as instâncias selecionadas em rodízio, respeitando os limites de cada uma.
          </p>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Repeat className="h-4 w-4 text-primary" /> Política de retry
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tentativas máximas</Label>
              <Input
                type="number" min={1} max={10}
                value={retryMax} onChange={(e) => setRetryMax(Number(e.target.value) || 1)}
              />
            </div>
            <div>
              <Label className="text-xs">Backoff base (segundos)</Label>
              <Input
                type="number" min={10} max={3600}
                value={retryBackoff} onChange={(e) => setRetryBackoff(Number(e.target.value) || 10)}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Crescimento exponencial: t, 2t, 4t… (máx 1h)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="mr-2 h-4 w-4" /> {saving ? "Salvando…" : "Salvar regras"}
        </Button>
      </div>
    </div>
  );
}
