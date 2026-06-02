import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Send, Users, Clock, Bell, Play, Plus, Pencil, Trash2, ShieldAlert,
  CheckCircle2, PauseCircle, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listSteps, createStep, updateStep, deleteStep, setStepStatus,
  materializeStepFn, tickStepFn, updateCampaignOptOut,
} from "@/lib/campaign-steps.functions";

type Step = {
  id: string;
  ord: number;
  label: string | null;
  name: string;
  scheduled_at: string | null;
  template: string;
  audience: "all" | "not_responded_step" | "responded_step" | "not_subscribed" | "subscribed" | "tag_any";
  audience_step_id: string | null;
  audience_tags: string[] | null;
  status: "draft" | "scheduled" | "sending" | "completed" | "paused" | "failed";
  total_count: number;
  sent_count: number;
  failed_count: number;
  allowed_weekdays?: number[] | null;
  max_per_hour?: number | null;
  max_per_day?: number | null;
  pause_on_reply?: boolean | null;
  dedupe_skip_days?: number | null;
  retry_max_attempts?: number | null;
  retry_backoff_seconds?: number | null;
};

const AUDIENCE_LABEL: Record<Step["audience"], string> = {
  all: "Todos da campanha",
  not_responded_step: "Não respondeu disparo",
  responded_step: "Respondeu disparo",
  not_subscribed: "Não inscritos",
  subscribed: "Inscritos no grupo",
  tag_any: "Com tag(s)",
};

const STATUS_BADGE: Record<Step["status"], { label: string; tone: string }> = {
  draft: { label: "Rascunho", tone: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendado", tone: "bg-blue-500/15 text-blue-600" },
  sending: { label: "Enviando", tone: "bg-emerald-500/15 text-emerald-600" },
  completed: { label: "Concluído", tone: "bg-violet-500/15 text-violet-600" },
  paused: { label: "Pausado", tone: "bg-amber-500/15 text-amber-600" },
  failed: { label: "Falha", tone: "bg-rose-500/15 text-rose-600" },
};

function StepIcon({ ord }: { ord: number }) {
  const icons = [Send, Users, Clock, Bell, Play];
  const Icon = icons[(ord - 1) % icons.length] ?? Send;
  return <Icon className="h-4 w-4" />;
}

function audienceBadge(s: Step, allSteps: Step[]) {
  if (s.audience === "all") return null;
  const ref = allSteps.find((x) => x.id === s.audience_step_id);
  const refLabel = ref?.label || ref?.name || "—";
  const label =
    s.audience === "not_responded_step" ? `Não respondeu ${refLabel}` :
    s.audience === "responded_step" ? `Respondeu ${refLabel}` :
    s.audience === "tag_any" ? `Tag: ${(s.audience_tags ?? []).join(", ")}` :
    AUDIENCE_LABEL[s.audience];
  const tone =
    s.audience === "subscribed" ? "bg-emerald-500/15 text-emerald-600" :
    s.audience === "not_subscribed" ? "bg-amber-500/15 text-amber-600" :
    "bg-blue-500/15 text-blue-600";
  return <Badge className={`${tone} text-[10px]`}>{label}</Badge>;
}

function formatScheduled(iso: string | null, eventDate: string | null): string {
  if (!iso) return "Sem data";
  const d = new Date(iso);
  const base = format(d, "dd/MMM 'às' HH'h'mm", { locale: ptBR });
  if (!eventDate) return base;
  const ev = new Date(eventDate);
  const diff = Math.round((ev.getTime() - d.getTime()) / (24 * 3600 * 1000));
  return `D-${Math.max(0, diff)} · ${base}`;
}

type CampaignBasics = {
  id: string;
  event_date: string | null;
  opt_out_keywords: string[] | null;
  opt_out_reply: string | null;
};

export function CampaignSequence({ campaign }: { campaign: CampaignBasics }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSteps);
  const createFn = useServerFn(createStep);
  const updateFn = useServerFn(updateStep);
  const deleteFn = useServerFn(deleteStep);
  const statusFn = useServerFn(setStepStatus);
  const matFn = useServerFn(materializeStepFn);
  const tickFn = useServerFn(tickStepFn);
  const optOutFn = useServerFn(updateCampaignOptOut);

  const { data, isLoading } = useQuery({
    queryKey: ["campaign-steps", campaign.id],
    queryFn: () => listFn({ data: { campaignId: campaign.id } }),
    refetchInterval: 5000,
  });
  const steps = (data?.steps ?? []) as Step[];

  const [editing, setEditing] = useState<Step | null>(null);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  async function runStep(s: Step) {
    setRunning(s.id);
    try {
      if (s.status === "draft") {
        await statusFn({ data: { id: s.id, status: "scheduled" } });
      }
      await matFn({ data: { id: s.id } });
      const r = await tickFn({ data: { id: s.id, batch: 5 } });
      toast.success(`Disparo executado: ${r.sent} enviado(s), ${r.failed} falha(s) — ${r.reason}`);
      qc.invalidateQueries({ queryKey: ["campaign-steps", campaign.id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  async function pauseStep(s: Step) {
    await statusFn({ data: { id: s.id, status: "paused" } });
    qc.invalidateQueries({ queryKey: ["campaign-steps", campaign.id] });
  }

  async function removeStep(s: Step) {
    if (!confirm(`Excluir disparo "${s.name}"?`)) return;
    await deleteFn({ data: { id: s.id } });
    qc.invalidateQueries({ queryKey: ["campaign-steps", campaign.id] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Sequência de disparos</h2>
          <p className="text-xs text-muted-foreground">
            Cada disparo tem data/hora, mensagem própria e filtro de público.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" /> Novo disparo
        </Button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}

      <div className="space-y-2">
        {steps.map((s) => {
          const sb = STATUS_BADGE[s.status];
          const pct = s.total_count ? Math.round((s.sent_count / s.total_count) * 100) : 0;
          return (
            <Card key={s.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <StepIcon ord={s.ord} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-muted-foreground">
                      {(s.label ? `${s.label} · ` : "") + formatScheduled(s.scheduled_at, campaign.event_date)}
                    </div>
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Badge className={sb.tone}>{sb.label}</Badge>
                      {audienceBadge(s, steps)}
                      {s.total_count > 0 && (
                        <span>{s.sent_count}/{s.total_count} enviados</span>
                      )}
                      {s.failed_count > 0 && (
                        <span className="text-rose-600">· {s.failed_count} falha(s)</span>
                      )}
                    </div>
                    {s.total_count > 0 && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {s.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : s.status === "sending" ? (
                      <Button variant="outline" size="sm" onClick={() => pauseStep(s)}>
                        <PauseCircle className="mr-1 h-3.5 w-3.5" /> Pausar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => runStep(s)}
                        disabled={running === s.id}
                      >
                        {running === s.id
                          ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          : <Play className="mr-1 h-3.5 w-3.5" />}
                        Disparar
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setEditing(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => removeStep(s)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {!isLoading && steps.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Nenhum disparo ainda. Crie o primeiro com "Novo disparo".
            </CardContent>
          </Card>
        )}
      </div>

      <OptOutCard campaign={campaign} onSave={async (patch) => {
        await optOutFn({ data: { id: campaign.id, ...patch } });
        toast.success("Opt-out atualizado");
        qc.invalidateQueries({ queryKey: ["campaign", campaign.id] });
      }} />

      {(creating || editing) && (
        <StepDialog
          campaignId={campaign.id}
          eventDate={campaign.event_date}
          steps={steps}
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={async (payload) => {
            if (editing) await updateFn({ data: { id: editing.id, ...payload } });
            else await createFn({ data: { campaign_id: campaign.id, ...payload } });
            qc.invalidateQueries({ queryKey: ["campaign-steps", campaign.id] });
          }}
        />
      )}
    </div>
  );
}

function OptOutCard({
  campaign,
  onSave,
}: {
  campaign: CampaignBasics;
  onSave: (patch: { opt_out_keywords: string[]; opt_out_reply: string | null; event_date: string | null }) => Promise<void>;
}) {
  const [keywords, setKeywords] = useState((campaign.opt_out_keywords ?? []).join(", "));
  const [reply, setReply] = useState(campaign.opt_out_reply ?? "");
  const [eventDate, setEventDate] = useState(
    campaign.event_date ? campaign.event_date.slice(0, 16) : "",
  );
  const [saving, setSaving] = useState(false);

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="h-4 w-4 text-amber-600" /> Opt-out obrigatório (LGPD)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Quando o contato responder com uma das palavras-chave, o sistema marca como opt-out,
          cancela disparos pendentes e envia a resposta automática abaixo.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Data/hora do evento (para D-X)</Label>
            <Input
              type="datetime-local"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Palavras-chave (separadas por vírgula)</Label>
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="sair, parar, não, remover, cancelar"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Resposta automática</Label>
          <Textarea
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Tudo bem, [NOME]. Você não receberá mais mensagens deste número."
          />
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  opt_out_keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
                  opt_out_reply: reply.trim() || null,
                  event_date: eventDate ? new Date(eventDate).toISOString() : null,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            Salvar opt-out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StepDialog({
  campaignId, eventDate, steps, initial, onClose, onSave,
}: {
  campaignId: string;
  eventDate: string | null;
  steps: Step[];
  initial: Step | null;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    label: string | null;
    scheduled_at: string | null;
    template: string;
    audience: Step["audience"];
    audience_step_id: string | null;
    audience_tags: string[];
    ord: number;
    allowed_weekdays?: number[] | null;
    max_per_hour?: number | null;
    max_per_day?: number | null;
    pause_on_reply?: boolean | null;
    dedupe_skip_days?: number | null;
    retry_max_attempts?: number | null;
    retry_backoff_seconds?: number | null;
  }) => Promise<void>;
}) {
  const nextOrd = (steps[steps.length - 1]?.ord ?? 0) + 1;
  const [name, setName] = useState(initial?.name ?? `Disparo ${nextOrd}`);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduled_at ? initial.scheduled_at.slice(0, 16) : "",
  );
  const [template, setTemplate] = useState(initial?.template ?? "");
  const [audience, setAudience] = useState<Step["audience"]>(initial?.audience ?? "all");
  const [audienceStepId, setAudienceStepId] = useState<string>(initial?.audience_step_id ?? "");
  const [audienceTags, setAudienceTags] = useState((initial?.audience_tags ?? []).join(", "));
  const [ord, setOrd] = useState(initial?.ord ?? nextOrd);
  const [saving, setSaving] = useState(false);

  // Overrides (null = herda da campanha)
  const [overrideOpen, setOverrideOpen] = useState(
    !!(initial && (
      initial.allowed_weekdays || initial.max_per_hour != null || initial.max_per_day != null ||
      initial.pause_on_reply != null || initial.dedupe_skip_days != null ||
      initial.retry_max_attempts != null || initial.retry_backoff_seconds != null
    )),
  );
  const [ovMaxHour, setOvMaxHour] = useState<string>(
    initial?.max_per_hour != null ? String(initial.max_per_hour) : "",
  );
  const [ovMaxDay, setOvMaxDay] = useState<string>(
    initial?.max_per_day != null ? String(initial.max_per_day) : "",
  );
  const [ovDedupe, setOvDedupe] = useState<string>(
    initial?.dedupe_skip_days != null ? String(initial.dedupe_skip_days) : "",
  );
  const [ovPauseReply, setOvPauseReply] = useState<"" | "yes" | "no">(
    initial?.pause_on_reply == null ? "" : initial.pause_on_reply ? "yes" : "no",
  );
  const [ovRetryMax, setOvRetryMax] = useState<string>(
    initial?.retry_max_attempts != null ? String(initial.retry_max_attempts) : "",
  );
  const [ovBackoff, setOvBackoff] = useState<string>(
    initial?.retry_backoff_seconds != null ? String(initial.retry_backoff_seconds) : "",
  );
  const [ovWeekdays, setOvWeekdays] = useState<number[] | null>(
    initial?.allowed_weekdays ?? null,
  );

  function toggleOvWeekday(v: number) {
    setOvWeekdays((cur) => {
      const base = cur ?? [];
      const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v].sort();
      return next.length === 0 ? null : next;
    });
  }

  // Auto-suggest label (D-X) from event_date + scheduledAt
  const computedLabel = (() => {
    if (!eventDate || !scheduledAt) return null;
    const diff = Math.round(
      (new Date(eventDate).getTime() - new Date(scheduledAt).getTime()) / (24 * 3600 * 1000),
    );
    return `D-${Math.max(0, diff)}`;
  })();

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar disparo" : "Novo disparo"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nome do disparo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Convite inicial" />
            </div>
            <div>
              <Label className="text-xs">Ordem</Label>
              <Input
                type="number" min={1}
                value={ord} onChange={(e) => setOrd(Number(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data/hora do envio</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">
                Rótulo {computedLabel && !label && (
                  <span className="text-muted-foreground">(sugestão: {computedLabel})</span>
                )}
              </Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={computedLabel ?? "D-10"}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Filtro de público</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as Step["audience"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos da campanha</SelectItem>
                <SelectItem value="not_responded_step">Não respondeu disparo anterior</SelectItem>
                <SelectItem value="responded_step">Respondeu disparo anterior</SelectItem>
                <SelectItem value="not_subscribed">Não inscritos</SelectItem>
                <SelectItem value="subscribed">Inscritos no grupo</SelectItem>
                <SelectItem value="tag_any">Com tag(s) específica(s)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(audience === "not_responded_step" || audience === "responded_step") && (
            <div>
              <Label className="text-xs">Disparo de referência</Label>
              <Select value={audienceStepId} onValueChange={setAudienceStepId}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {steps.filter((s) => s.id !== initial?.id).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label ? `${s.label} · ` : ""}{s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {audience === "tag_any" && (
            <div>
              <Label className="text-xs">Tags (separadas por vírgula)</Label>
              <Input
                value={audienceTags}
                onChange={(e) => setAudienceTags(e.target.value)}
                placeholder="lead-quente, oab, federal"
              />
            </div>
          )}

          <div>
            <Label className="text-xs">Mensagem (suporta {`{{name}}`}, {`{{phone}}`} e colunas do CSV)</Label>
            <Textarea
              rows={6}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={`Oi, {{name}}! Quero te contar uma novidade…`}
            />
          </div>

          <details
            className="rounded-md border border-border bg-muted/20"
            open={overrideOpen}
            onToggle={(e) => setOverrideOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
              Sobrescrever regras desta etapa (opcional — vazio = herda da campanha)
            </summary>
            <div className="space-y-3 p-3">
              <div>
                <Label className="text-xs">Dias da semana (vazio = herda)</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {[
                    { v: 0, l: "Dom" }, { v: 1, l: "Seg" }, { v: 2, l: "Ter" },
                    { v: 3, l: "Qua" }, { v: 4, l: "Qui" }, { v: 5, l: "Sex" }, { v: 6, l: "Sáb" },
                  ].map((d) => {
                    const active = (ovWeekdays ?? []).includes(d.v);
                    return (
                      <button
                        type="button"
                        key={d.v}
                        onClick={() => toggleOvWeekday(d.v)}
                        className={`rounded-md border px-2.5 py-1 text-[11px] ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground"
                        }`}
                      >
                        {d.l}
                      </button>
                    );
                  })}
                  {ovWeekdays && (
                    <button
                      type="button"
                      onClick={() => setOvWeekdays(null)}
                      className="text-[10px] text-muted-foreground underline"
                    >
                      limpar (herda)
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <Label className="text-xs">Máx/hora</Label>
                  <Input type="number" min={1} value={ovMaxHour} onChange={(e) => setOvMaxHour(e.target.value)} placeholder="herda" />
                </div>
                <div>
                  <Label className="text-xs">Máx/dia</Label>
                  <Input type="number" min={1} value={ovMaxDay} onChange={(e) => setOvMaxDay(e.target.value)} placeholder="herda" />
                </div>
                <div>
                  <Label className="text-xs">Pular já contatado (dias)</Label>
                  <Input type="number" min={0} value={ovDedupe} onChange={(e) => setOvDedupe(e.target.value)} placeholder="herda" />
                </div>
                <div>
                  <Label className="text-xs">Pausar se respondeu</Label>
                  <Select value={ovPauseReply} onValueChange={(v) => setOvPauseReply(v as "" | "yes" | "no")}>
                    <SelectTrigger><SelectValue placeholder="herda" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Herdar</SelectItem>
                      <SelectItem value="yes">Sim</SelectItem>
                      <SelectItem value="no">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Retry máx</Label>
                  <Input type="number" min={1} max={10} value={ovRetryMax} onChange={(e) => setOvRetryMax(e.target.value)} placeholder="herda" />
                </div>
                <div>
                  <Label className="text-xs">Backoff base (s)</Label>
                  <Input type="number" min={10} max={3600} value={ovBackoff} onChange={(e) => setOvBackoff(e.target.value)} placeholder="herda" />
                </div>
              </div>
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={saving || !name.trim() || !template.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  name: name.trim(),
                  label: label.trim() || computedLabel || null,
                  scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
                  template,
                  audience,
                  audience_step_id:
                    audience === "not_responded_step" || audience === "responded_step"
                      ? (audienceStepId || null)
                      : null,
                  audience_tags:
                    audience === "tag_any"
                      ? audienceTags.split(",").map((t) => t.trim()).filter(Boolean)
                      : [],
                  ord,
                  allowed_weekdays: ovWeekdays,
                  max_per_hour: ovMaxHour.trim() ? Number(ovMaxHour) : null,
                  max_per_day: ovMaxDay.trim() ? Number(ovMaxDay) : null,
                  dedupe_skip_days: ovDedupe.trim() ? Number(ovDedupe) : null,
                  pause_on_reply: ovPauseReply === "" ? null : ovPauseReply === "yes",
                  retry_max_attempts: ovRetryMax.trim() ? Number(ovRetryMax) : null,
                  retry_backoff_seconds: ovBackoff.trim() ? Number(ovBackoff) : null,
                });
                onClose();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {initial ? "Salvar" : "Criar disparo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  void campaignId;
}