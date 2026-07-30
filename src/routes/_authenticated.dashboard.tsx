import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { Card } from "@/components/ui/card";
import { formatCompactNumber, formatFullNumber } from "@/lib/format";
import { Users, MessageSquare, BellDot, Smartphone, TrendingUp } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Lívia CRM" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const fetchStats = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 30_000,
  });

  const kpis = [
    { label: "Leads (total)", value: data?.totalLeads ?? 0, icon: Users },
    { label: "Leads hoje", value: data?.todayLeads ?? 0, icon: TrendingUp },
    { label: "Conversas ativas", value: data?.activeConversations ?? 0, icon: MessageSquare },
    { label: "Não lidas", value: data?.unreadConversations ?? 0, icon: BellDot },
    { label: "Instâncias online", value: data?.connectedInstances ?? 0, icon: Smartphone },
  ];

  return (
    <div className="h-screen overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">Visão em tempo real da operação.</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className="min-w-0 p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[11px] leading-tight text-muted-foreground sm:text-xs">{k.label}</span>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div
                className="num mt-2 truncate text-xl font-semibold leading-tight sm:text-2xl"
                title={isLoading ? undefined : formatFullNumber(k.value)}
              >
                {isLoading ? "—" : formatCompactNumber(k.value)}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4 p-3 sm:mt-6 sm:p-4">
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:justify-between">
          <h2 className="text-sm font-semibold">Mensagens — últimos 7 dias</h2>
          <div className="flex shrink-0 gap-3 text-[11px] text-muted-foreground sm:text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Recebidas</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-chart-2" /> Enviadas</span>
          </div>
        </div>
        <div className="h-56 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.messageSeries ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} width={44} tickFormatter={(v) => formatCompactNumber(Number(v))} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="in" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="out" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}