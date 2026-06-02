import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listLeads } from "@/lib/leads.functions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Users, Flame, Snowflake, Sun, MapPin, Mail, Phone } from "lucide-react";
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

const TEMP_ICON: Record<string, JSX.Element> = {
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
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [tempF, setTempF] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["leads", { search, statusF, tempF }],
    queryFn: () =>
      list({
        data: {
          search: search || undefined,
          lead_status: statusF !== "all" ? (statusF as any) : undefined,
          temperature: tempF !== "all" ? (tempF as any) : undefined,
        },
      }),
  });

  const stats = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      quentes: rows.filter((r) => r.latest_intent?.temperature === "quente").length,
      inscritos: rows.filter((r) => r.lead_status === "inscrito").length,
      opt_outs: rows.filter((r) => r.opted_out).length,
    };
  }, [data]);

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">Todos os contatos do CRM com histórico, intenção e jornada.</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={stats.total} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Quentes" value={stats.quentes} icon={<Flame className="h-4 w-4 text-red-500" />} />
        <StatCard label="Inscritos" value={stats.inscritos} icon={<Badge className="h-4">✓</Badge>} />
        <StatCard label="Opt-outs" value={stats.opt_outs} icon={<span className="text-xs">🚫</span>} />
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

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
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
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Carregando…</td></tr>
            )}
            {!isLoading && (data ?? []).length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">Nenhum lead encontrado.</td></tr>
            )}
            {(data ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-muted/30">
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
      </Card>
    </div>
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