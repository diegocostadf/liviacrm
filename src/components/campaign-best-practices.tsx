import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Shield, Info, Loader2, AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { updateCampaign } from "@/lib/campaigns.functions";

/**
 * Regras de boas práticas de disparo em massa. Persistidas nas colunas reais da
 * campanha (janela horária, limite diário, cadência e palavras de opt-out).
 */
export type CampaignRules = {
  send_window_start_hour?: number;
  send_window_end_hour?: number;
  daily_limit?: number;
  min_delay_seconds?: number;
  max_delay_seconds?: number;
  auto_optout_keywords?: string[];
};

export function CampaignBestPracticesCard({
  campaignId,
  initial,
}: {
  campaignId: string;
  initial: CampaignRules;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateCampaign);
  const [rules, setRules] = useState<CampaignRules>(initial);

  useEffect(() => { setRules(initial); }, [
    initial.send_window_start_hour, initial.send_window_end_hour, initial.daily_limit,
    initial.min_delay_seconds, initial.max_delay_seconds,
    (initial.auto_optout_keywords ?? []).join(","),
  ]);

  const saveMut = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          id: campaignId,
          window_start_hour: rules.send_window_start_hour ?? 8,
          window_end_hour: rules.send_window_end_hour ?? 21,
          max_per_day: rules.daily_limit ?? 500,
          throttle_min_seconds: rules.min_delay_seconds ?? 8,
          throttle_max_seconds: Math.max(rules.min_delay_seconds ?? 8, rules.max_delay_seconds ?? 20),
          opt_out_keywords: (rules.auto_optout_keywords ?? []).filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Boas práticas salvas.");
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const set = <K extends keyof CampaignRules>(k: K, v: CampaignRules[K]) =>
    setRules((r) => ({ ...r, [k]: v }));

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <Shield className="h-4 w-4" /> Boas práticas de envio
        </h3>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Manter boa qualidade do número evita banimentos e garante entrega. A Meta monitora taxa de
            bloqueios, reclamações e volume de envio.
          </AlertDescription>
        </Alert>

        <div className="space-y-1.5">
          <Label>Janela de envio (horário local)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number" min={0} max={23} placeholder="8" className="w-20"
              value={rules.send_window_start_hour ?? 8}
              onChange={(e) => set("send_window_start_hour", Number(e.target.value))}
            />
            <span className="text-muted-foreground">às</span>
            <Input
              type="number" min={0} max={23} placeholder="21" className="w-20"
              value={rules.send_window_end_hour ?? 21}
              onChange={(e) => set("send_window_end_hour", Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground">horas (recomendado: 8h–21h)</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Limite diário de mensagens</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number" min={10} max={10000} className="w-28"
              value={rules.daily_limit ?? 500}
              onChange={(e) => set("daily_limit", Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground">
              msg/dia — recomendado: começar com 200–500 para números novos
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Intervalo entre mensagens</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number" min={3} max={120} className="w-20"
              value={rules.min_delay_seconds ?? 8}
              onChange={(e) => set("min_delay_seconds", Number(e.target.value))}
            />
            <span>a</span>
            <Input
              type="number" min={3} max={120} className="w-20"
              value={rules.max_delay_seconds ?? 20}
              onChange={(e) => set("max_delay_seconds", Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground">segundos (recomendado: 8–20s)</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Opt-out automático</Label>
          <Input
            placeholder="SAIR, PARAR, STOP"
            value={(rules.auto_optout_keywords ?? []).join(", ")}
            onChange={(e) =>
              set("auto_optout_keywords", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
            }
          />
          <p className="text-xs text-muted-foreground">
            Palavras separadas por vírgula. Se o contato responder qualquer uma delas, ele é removido dos envios.
          </p>
        </div>

        {saveMut.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {saveMut.error instanceof Error ? saveMut.error.message : "Erro ao salvar boas práticas."}
            </AlertDescription>
          </Alert>
        )}

        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aguarde…</> : <><Save className="mr-2 h-4 w-4" />Salvar boas práticas</>}
        </Button>
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">Recomendações por maturidade do número</h3>
        <div className="grid gap-3 text-xs sm:grid-cols-3">
          <div className="space-y-1 rounded border p-3">
            <div className="font-medium text-amber-600">Número novo (&lt;30 dias)</div>
            <div>Limite: até 250/dia</div>
            <div>Intervalo: 15–30s</div>
            <div>Horário: 9h–18h</div>
          </div>
          <div className="space-y-1 rounded border p-3">
            <div className="font-medium text-blue-600">Em crescimento (1–6 meses)</div>
            <div>Limite: 250–1000/dia</div>
            <div>Intervalo: 8–20s</div>
            <div>Horário: 8h–20h</div>
          </div>
          <div className="space-y-1 rounded border p-3">
            <div className="font-medium text-emerald-600">Estabelecido (&gt;6 meses)</div>
            <div>Limite: até 5000/dia</div>
            <div>Intervalo: 5–15s</div>
            <div>Horário: 8h–21h</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
