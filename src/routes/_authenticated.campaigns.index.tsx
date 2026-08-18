import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Megaphone, Plus, Trash2, MegaphoneOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listCampaigns, createCampaign, deleteCampaign } from "@/lib/campaigns.functions";
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

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listFn(),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleCreate() {
    if (name.trim().length < 2) {
      toast.error("Digite um nome com pelo menos 2 caracteres");
      return;
    }
    setCreating(true);
    try {
      const { id } = await createFn({
        data: { name: name.trim(), instance_id: null, template: "" },
      });
      setOpen(false);
      setName("");
      toast.success("Campanha criada");
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      navigate({ to: "/campaigns/$id", params: { id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!campaignToDelete) return;
    setDeleting(true);
    try {
      await delFn({ data: { id: campaignToDelete } });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campanha excluída");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
      setCampaignToDelete(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6 pb-16">
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
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Nova campanha</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="campaign-name">Nome da campanha</Label>
                <Input
                  id="campaign-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Lançamento turma 2026"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Depois de criar, configure a mensagem, destinatários e regras na página da campanha.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={creating || name.trim().length < 2}>
                {creating ? "Criando…" : "Criar e configurar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}
        {!isLoading && campaigns.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 rounded-full bg-muted p-4">
                <MegaphoneOff className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mb-1 text-base font-medium">Nenhuma campanha ainda</h3>
              <p className="mb-4 max-w-sm text-sm text-muted-foreground">
                Crie a primeira campanha para importar uma lista e começar a enviar mensagens.
              </p>
              <Button onClick={() => setOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Criar primeira campanha
              </Button>
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
                  <Button variant="ghost" size="icon" onClick={() => setCampaignToDelete(c.id)}>
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

      <AlertDialog open={!!campaignToDelete} onOpenChange={(v) => !v && setCampaignToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. Todos os destinatários e histórico desta campanha serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCampaignToDelete(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
