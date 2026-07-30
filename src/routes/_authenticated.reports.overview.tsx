import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getReportsOverview, getCampaignPerformance } from "@/lib/reports.functions";
import { Card } from "@/components/ui/card";
import { formatCompactNumber, formatFullNumber } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

export const Route = createFileRoute("/_authenticated/reports/overview")({
  component: OverviewPage,
});

function OverviewPage() {
  const [days, setDays] = useState(30);
  const fetchOverview = useServerFn(getReportsOverview);
  const fetchPerf = useServerFn(getCampaignPerformance);
  const { data, isLoading } = useQuery({
    queryKey: ["reports-overview", days],
    queryFn: () => fetchOverview({ data: { days } }),
    refetchInterval: 60_000,
  });
  const { data: perf } = useQuery({
    queryKey: ["reports-perf"],
    queryFn: () => fetchPerf({ data: {} }),
  });

  const kpis = [
    { label: "Mensagens enviadas", value: data?.totals.messages_out ?? 0 },
    { label: "Mensagens recebidas", value: data?.totals.messages_in ?? 0 },
    { label: "Falhas de envio", value: data?.totals.messages_failed ?? 0 },
    { label: "Leads cadastrados", value: data?.totals.leads ?? 0 },
    { label: "Opt-outs", value: data?.totals.opted_out ?? 0 },
  ];

  const funnel = Object.entries(data?.funnel ?? {}).map(([k, v]) => ({ stage: k, count: v }));
  const temp = Object.entries(data?.temperature ?? {}).map(([k, v]) => ({ name: k, count: v }));

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:justify-between">
        <p className="truncate text-xs text-muted-foreground">{isLoading ? "Carregando..." : `Últimos ${days} dias`}</p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-28 shrink-0 sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 dias</SelectItem>
            <SelectItem value="14">14 dias</SelectItem>
            <SelectItem value="30">30 dias</SelectItem>
            <SelectItem value="60">60 dias</SelectItem>
            <SelectItem value="90">90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label} className="min-w-0 p-3 sm:p-4">
            <div className="text-[11px] leading-tight text-muted-foreground sm:text-xs">{k.label}</div>
            <div className="num mt-2 truncate text-xl font-semibold leading-tight sm:text-2xl" title={formatFullNumber(k.value)}>
              {formatCompactNumber(k.value)}
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-3 sm:p-4">
        <h2 className="mb-3 text-sm font-semibold">Volume de mensagens</h2>
        <div className="h-56 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.series ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={44} tickFormatter={(v) => formatCompactNumber(Number(v))} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="sent" name="Enviadas" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="received" name="Recebidas" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="failed" name="Falhas" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <Card className="p-3 sm:p-4">
          <h2 className="mb-3 text-sm font-semibold">Funil de leads</h2>
          <div className="h-52 sm:h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="stage" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={44} tickFormatter={(v) => formatCompactNumber(Number(v))} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-3 sm:p-4">
          <h2 className="mb-3 text-sm font-semibold">Temperatura</h2>
          <div className="h-52 sm:h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={temp} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={44} tickFormatter={(v) => formatCompactNumber(Number(v))} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-3 sm:p-4">
        <h2 className="mb-3 text-sm font-semibold">Campanhas — status agregado (período)</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
          {Object.entries(data?.campaigns ?? {}).map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-md border border-border p-3">
              <div className="truncate text-[11px] capitalize text-muted-foreground sm:text-xs">{k}</div>
              <div className="num truncate text-lg font-semibold sm:text-xl" title={formatFullNumber(v as number)}>
                {formatCompactNumber(v as number)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-3 sm:p-4">
        <h2 className="mb-3 text-sm font-semibold">Campanhas — últimas 50</h2>
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Nome</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Enviadas</th><th className="text-right">Falhas</th><th className="text-right">Respostas</th>
              </tr>
            </thead>
            <tbody>
              {(perf?.campaigns ?? []).map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="max-w-[180px] truncate py-2">{c.name}</td>
                  <td className="text-xs text-muted-foreground">{c.status}</td>
                  <td className="num text-right">{formatCompactNumber(c.total_count)}</td>
                  <td className="num text-right">{formatCompactNumber(c.sent_count)}</td>
                  <td className="num text-right">{formatCompactNumber(c.failed_count)}</td>
                  <td className="num text-right">{formatCompactNumber(c.replied_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-3 sm:p-4">
        <h2 className="mb-3 text-sm font-semibold">Produtividade da equipe</h2>
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr><th className="py-2">Atendente</th><th className="text-right">Mensagens enviadas</th><th className="text-right">Conversas ativas</th></tr>
            </thead>
            <tbody>
              {(data?.agents ?? []).map((a) => (
                <tr key={a.agent_id} className="border-t border-border">
                  <td className="max-w-[180px] truncate py-2">{a.name}</td>
                  <td className="num text-right">{formatCompactNumber(a.sent)}</td>
                  <td className="num text-right">{formatCompactNumber(a.conversations)}</td>
                </tr>
              ))}
              {!data?.agents.length && (
                <tr><td colSpan={3} className="py-4 text-center text-xs text-muted-foreground">Sem atividade no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}