import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { listCampaigns, createCampaign, deleteCampaign } from "@/lib/campaigns.functions";
import { listInstances } from "@/lib/evolution.functions";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/campaigns/")({
  component: CampaignsPage,
});

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  draft: { label: "Rascunho", tone: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendada", tone: "bg-blue-500/15 text-blue-600" },
  running: { label: "Enviando", tone: "bg-emerald-500/15 text-emerald-600" },
  paused: { label: "Pausada", tone: "bg-amber-500/15 text-amber-600" },
  completed: { label: "Concluída", tone: "bg-violet-500/15 text-violet-600" },
  failed: { label: "Falha", tone: "bg-rose-500/15 text-rose-600" },
};

function CampaignsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listCampaigns);
  const createFn = useServerFn(createCampaign);
  const delFn = useServerFn(deleteCampaign);
  const instancesFn = useServerFn(listInstances);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listFn(),
  });
  const { data: instances = [] } = useQuery({
    queryKey: ["instances"],
    queryFn: () => instancesFn(),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState<string>("");
  const [template, setTemplate] = useState("Olá {{name}}! Tudo bem? ...");
  const [minS, setMinS] = useState(8);
  const [maxS, setMaxS] = useState(20);
  const [startH, setStartH] = useState(8);
  const [endH, setEndH] = useState(21);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!instanceId) { toast.error("Selecione uma instância"); return; }
    setCreating(true);
    try {
      const { id } = await createFn({ data: {
        name, instance_id: instanceId, template,
        throttle_min_seconds: minS, throttle_max_seconds: Math.max(minS, maxS),
        window_start_hour: startH, window_end_hour: endH,
      }});
      setOpen(false);
      toast.success("Campanha criada");
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      navigate({ to: "/campaigns/$id", params: { id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir esta campanha e todos os destinatários?")) return;
    await delFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["campaigns"] });
    toast.success("Campanha excluída");
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Megaphone className="h-6 w-6" /> Campanhas
          </h1>
          <p className="text-sm text-muted-foreground">
            Envie mensagens em massa para listas importadas, com throttle e janela horária.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Nova campanha</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Nova campanha</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Lançamento turma 2026" />
              </div>
              <div>
                <Label>Instância WhatsApp</Label>
                <Select value={instanceId} onValueChange={setInstanceId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {instances.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} {i.status === "connected" ? "🟢" : "⚪"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Mensagem (use {`{{name}}`}, {`{{phone}}`} ou colunas do CSV)</Label>
                <Textarea rows={5} value={template} onChange={(e) => setTemplate(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Intervalo mín. (s)</Label>
                  <Input type="number" min={2} value={minS} onChange={(e) => setMinS(Number(e.target.value))} />
                </div>
                <div>
                  <Label>Intervalo máx. (s)</Label>
                  <Input type="number" min={2} value={maxS} onChange={(e) => setMaxS(Number(e.target.value))} />
                </div>
                <div>
                  <Label>Janela início (h)</Label>
                  <Input type="number" min={0} max={23} value={startH} onChange={(e) => setStartH(Number(e.target.value))} />
                </div>
                <div>
                  <Label>Janela fim (h)</Label>
                  <Input type="number" min={0} max={23} value={endH} onChange={(e) => setEndH(Number(e.target.value))} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={creating || name.length < 2 || template.length < 2}>
                {creating ? "Criando…" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}
        {!isLoading && campaigns.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma campanha ainda. Crie a primeira para importar uma lista e disparar.
            </CardContent>
          </Card>
        )}
        {campaigns.map((c) => {
          const s = STATUS_LABEL[c.status] ?? STATUS_LABEL.draft;
          const pct = c.total_count ? Math.round((c.sent_count / c.total_count) * 100) : 0;
          return (
            <Card key={c.id} className="transition-colors hover:bg-muted/30">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">
                    <Link to="/campaigns/$id" params={{ id: c.id }} className="hover:underline">
                      {c.name}
                    </Link>
                  </CardTitle>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Criada em {format(new Date(c.created_at), "dd/MM/yyyy HH:mm")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={s.tone}>{s.label}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{c.sent_count} / {c.total_count} enviadas · {c.failed_count} falhas</span>
                  <span>{pct}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}