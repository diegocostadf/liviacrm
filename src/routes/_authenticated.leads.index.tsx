import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { listLeads, getLeadStats, listLeadsMatching } from "@/lib/leads.functions";
import { listCampaigns, addCampaignTargets } from "@/lib/campaigns.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Search, Users, Flame, Snowflake, Sun, MapPin, Mail, Phone, ChevronLeft, ChevronRight, Send, X, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({ meta: [{ title: "Leads — Lívia CRM" }] }),
  component: LeadsListPage,
});

const STATUS_COLORS: Record<string, string> = {
  novo: "bg-blue-500/15 text-blue-500",
  engajado: "bg-amber-500/15 text-amber-500",
  inscrito: "bg-emerald-500/15 text-emerald-500",
  perdido: "bg-muted text-muted-foreground",
};

const TEMP_ICON: Record<string, React.ReactNode> = {
  frio: <Snowflake className="h-3 w-3" />,
  morno: <Sun className="h-3 w-3" />,
  quente: <Flame className="h-3 w-3" />,
};
const TEMP_COLORS: Record<string, string> = {
  frio: "bg-sky-500/15 text-sky-500",
  morno: "bg-amber-500/15 text-amber-500",
  quente: "bg-red-500/15 text-red-500",
};

function LeadsListPage() {
  const list = useServerFn(listLeads);
  const statsFn = useServerFn(getLeadStats);
  const matchingFn = useServerFn(listLeadsMatching);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [tempF, setTempF] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 100;

  // Selection: ids + map id->phone/name para uso em ações em lote
  const [selected, setSelected] = useState<Map<string, { phone: string; name: string | null }>>(new Map());
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [search, statusF, tempF]);

  const { data, isLoading } = useQuery({
    queryKey: ["leads", { search, statusF, tempF, page, pageSize }],
    queryFn: () =>
      list({
        data: {
          search: search || undefined,
          lead_status: statusF !== "all" ? (statusF as any) : undefined,
          temperature: tempF !== "all" ? (tempF as any) : undefined,
          page,
          pageSize,
        },
      }),
  });

  const { data: stats } = useQuery({
    queryKey: ["leads-stats"],
    queryFn: () => statsFn(),
  });
  const s = stats ?? { total: 0, quentes: 0, inscritos: 0, opt_outs: 0 };
  const leads = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pageIds = useMemo(() => leads.map((l) => l.id), [leads]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));

  function toggleOne(id: string, phone: string, name: string | null) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { phone, name });
      return next;
    });
  }
  function togglePage() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allOnPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const l of leads) next.set(l.id, { phone: l.phone, name: l.name ?? null });
      }
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Map());
  }

  async function selectAllMatching() {
    try {
      const res = await matchingFn({
        data: {
          search: search || undefined,
          lead_status: statusF !== "all" ? (statusF as any) : undefined,
          temperature: tempF !== "all" ? (tempF as any) : undefined,
        },
      });
      const next = new Map<string, { phone: string; name: string | null }>();
      for (const r of res.rows) next.set(r.id, { phone: r.phone, name: r.name ?? null });
      setSelected(next);
      toast.success(`${res.rows.length.toLocaleString("pt-BR")} leads selecionados`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contatos / Leads</h1>
          <p className="text-sm text-muted-foreground">Gerencie seus contatos, acompanhe intenções e adicione-os a campanhas.</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={s.total} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Quentes" value={s.quentes} icon={<Flame className="h-4 w-4 text-red-500" />} />
        <StatCard label="Inscritos" value={s.inscritos} icon={<Badge className="h-4">✓</Badge>} />
        <StatCard label="Opt-outs" value={s.opt_outs} icon={<span className="text-xs">🚫</span>} />
      </div>

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, telefone, e-mail, empresa, cidade…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="novo">Novo</SelectItem>
            <SelectItem value="engajado">Engajado</SelectItem>
            <SelectItem value="inscrito">Inscrito</SelectItem>
            <SelectItem value="perdido">Perdido</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tempF} onValueChange={setTempF}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Temperatura" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as temperaturas</SelectItem>
            <SelectItem value="quente">Quente</SelectItem>
            <SelectItem value="morno">Morno</SelectItem>
            <SelectItem value="frio">Frio</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      {selected.size > 0 && (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 p-3">
          <div className="text-sm">
            <strong>{selected.size.toLocaleString("pt-BR")}</strong> selecionado(s)
            {allOnPageSelected && total > selected.size && (
              <Button variant="link" size="sm" className="h-auto px-2 py-0" onClick={selectAllMatching}>
                Selecionar todos os {total.toLocaleString("pt-BR")} que correspondem ao filtro
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="mr-1 h-3.5 w-3.5" /> Limpar
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Send className="mr-1 h-3.5 w-3.5" /> Adicionar à campanha
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false}
                    onCheckedChange={togglePage}
                    aria-label="Selecionar página"
                  />
                </th>
                <th className="px-3 py-2 text-left">Lead</th>
                <th className="px-3 py-2 text-left">Contato</th>
                <th className="px-3 py-2 text-left">Local</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Intenção</th>
                <th className="px-3 py-2 text-left">Tags</th>
                <th className="px-3 py-2 text-left">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!isLoading && leads.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Users className="mb-3 h-10 w-10 text-muted-foreground/60" />
                      <h3 className="text-base font-medium">Nenhum contato encontrado</h3>
                      <p className="mb-3 max-w-sm text-sm text-muted-foreground">
                        Ajuste os filtros ou importe contatos para começar a gerenciar sua base.
                      </p>
                      {(search || statusF !== "all" || tempF !== "all") && (
                        <Button variant="outline" size="sm" onClick={() => { setSearch(""); setStatusF("all"); setTempF("all"); }}>
                          Limpar filtros
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {leads.map((c) => (
                <tr key={c.id} className={`border-t border-border hover:bg-muted/30 ${selected.has(c.id) ? "bg-primary/5" : ""}`}>
                  <td className="px-3 py-2 align-middle">
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggleOne(c.id, c.phone, c.name ?? null)}
                      aria-label={`Selecionar ${c.name ?? c.phone}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link to="/leads/$id" params={{ id: c.id }} className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={c.profile_pic_url ?? undefined} />
                        <AvatarFallback>{(c.name ?? c.phone).slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.name ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.company ?? c.job_title ?? ""}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</div>
                    {c.email && <div className="mt-0.5 flex items-center gap-1 text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {(c.city || c.state) && (
                      <div className="flex items-center gap-1"><MapPin className="h-3 w-3" />{[c.city, c.state].filter(Boolean).join(" / ")}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.lead_status ?? "novo"]}`}>
                      {c.lead_status}
                    </span>
                    {c.opted_out && <div className="mt-0.5 text-[10px] text-destructive">Opt-out</div>}
                  </td>
                  <td className="px-3 py-2">
                    {c.latest_intent ? (
                      <div className="space-y-0.5">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${TEMP_COLORS[c.latest_intent.temperature]}`}>
                          {TEMP_ICON[c.latest_intent.temperature]} {c.latest_intent.temperature}
                        </span>
                        <div className="text-[10px] text-muted-foreground">{c.latest_intent.intent} · {c.latest_intent.score}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags ?? []).slice(0, 3).map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                      ))}
                      {(c.tags ?? []).length > 3 && <span className="text-[10px] text-muted-foreground">+{(c.tags ?? []).length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.updated_at ? formatDistanceToNow(new Date(c.updated_at), { locale: ptBR, addSuffix: true }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>{from}-{to} de {total} leads</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || isLoading}>
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </Button>
            <span>Página {page} de {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || isLoading}>
              Próxima <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      <AddToCampaignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        selected={selected}
        onDone={() => {
          clearSelection();
          qc.invalidateQueries({ queryKey: ["campaigns"] });
        }}
      />
    </div>
  );
}

function AddToCampaignDialog({
  open, onOpenChange, selected, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selected: Map<string, { phone: string; name: string | null }>;
  onDone: () => void;
}) {
  const campaignsFn = useServerFn(listCampaigns);
  const addTargetsFn = useServerFn(addCampaignTargets);
  const [campaignId, setCampaignId] = useState<string>("");
  const [intent, setIntent] = useState<
    "silencio" | "interessado" | "lead_quente" | "inscrito" | "objecao" | "sem_interesse" | "fora_escopo"
  >("silencio");
  const [overwrite, setOverwrite] = useState(false);

  const { data: campaigns } = useQuery({
    queryKey: ["campaigns", "for-add-targets"],
    queryFn: () => campaignsFn(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!campaignId) throw new Error("Selecione uma campanha.");
      const targets = Array.from(selected.values()).map((v) => ({ phone: v.phone, name: v.name }));
      return addTargetsFn({
        data: {
          campaignId,
          targets,
          dedupe: true,
          initial_intent: intent,
          overwrite_intent: overwrite,
        },
      });
    },
    onSuccess: (r) => {
      toast.success(`${r.inserted} destinatário(s) adicionados à campanha`);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar à campanha</DialogTitle>
          <DialogDescription>
            {selected.size.toLocaleString("pt-BR")} lead(s) serão adicionados como destinatários. Duplicados na campanha são ignorados.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Campanha</Label>
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {(campaigns ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} <span className="text-muted-foreground">· {c.status}</span>
                  </SelectItem>
                ))}
                {(campaigns ?? []).length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Nenhuma campanha. Crie uma em Campanhas.</div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Classificação inicial</Label>
            <Select value={intent} onValueChange={(v) => setIntent(v as typeof intent)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="silencio">SILÊNCIO</SelectItem>
                <SelectItem value="interessado">INTERESSADO</SelectItem>
                <SelectItem value="lead_quente">LEAD QUENTE</SelectItem>
                <SelectItem value="inscrito">INSCRITO</SelectItem>
                <SelectItem value="objecao">OBJEÇÃO</SelectItem>
                <SelectItem value="sem_interesse">SEM INTERESSE</SelectItem>
                <SelectItem value="fora_escopo">FORA DE ESCOPO</SelectItem>
              </SelectContent>
            </Select>
            <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Sobrescrever classificação atual dos contatos
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !campaignId}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Adicionar {selected.size.toLocaleString("pt-BR")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="flex items-center justify-between p-4">
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
      <div className="text-muted-foreground">{icon}</div>
    </Card>
  );
}