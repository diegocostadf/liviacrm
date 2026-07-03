import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, BarChart3, CheckCircle2, Send, MessageSquare, XCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/whatsapp-cloud/dashboard")({
  head: () => ({ meta: [{ title: "Painel WhatsApp Cloud — Lívia CRM" }] }),
  component: DashboardPage,
});

type Msg = {
  id: string;
  wa_message_id: string | null;
  direction: "in" | "out";
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  content: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

function DashboardPage() {
  const [days, setDays] = useState(7);
  const since = useMemo(() => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString(), [days]);

  const q = useQuery({
    queryKey: ["wa-cloud-dash", days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id,wa_message_id,direction,status,content,created_at,metadata")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as Msg[];
    },
  });

  const msgs = q.data ?? [];
  const out = msgs.filter((m) => m.direction === "out");
  const kpis = {
    sent: out.length,
    delivered: out.filter((m) => ["delivered", "read"].includes(m.status)).length,
    read: out.filter((m) => m.status === "read").length,
    failed: out.filter((m) => m.status === "failed").length,
    inbound: msgs.filter((m) => m.direction === "in").length,
  };
  const rate = (n: number) => (kpis.sent ? Math.round((n / kpis.sent) * 100) : 0);

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <Link to="/settings/whatsapp-cloud" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-3 w-3" /> Voltar para o wizard
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <BarChart3 className="h-6 w-6" /> Painel WhatsApp Cloud
            </h1>
            <p className="text-sm text-muted-foreground">Funil de envio e status das mensagens.</p>
          </div>
          <div className="flex gap-1 rounded-md border p-1">
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant={days === d ? "default" : "ghost"} onClick={() => setDays(d)}>
                {d}d
              </Button>
            ))}
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi icon={<Send className="h-4 w-4" />} label="Enviadas" value={kpis.sent} />
          <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Entregues" value={kpis.delivered} pct={rate(kpis.delivered)} />
          <Kpi icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="Lidas" value={kpis.read} pct={rate(kpis.read)} />
          <Kpi icon={<XCircle className="h-4 w-4 text-destructive" />} label="Falhas" value={kpis.failed} pct={rate(kpis.failed)} />
          <Kpi icon={<MessageSquare className="h-4 w-4" />} label="Recebidas" value={kpis.inbound} />
        </div>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Funil</h2>
          <div className="space-y-2">
            <Bar label="Enviadas" value={kpis.sent} max={Math.max(kpis.sent, 1)} tone="bg-primary" />
            <Bar label="Entregues" value={kpis.delivered} max={Math.max(kpis.sent, 1)} tone="bg-blue-500" />
            <Bar label="Lidas" value={kpis.read} max={Math.max(kpis.sent, 1)} tone="bg-emerald-500" />
            <Bar label="Falhas" value={kpis.failed} max={Math.max(kpis.sent, 1)} tone="bg-destructive" />
          </div>
        </Card>

        <Card>
          <div className="border-b p-4 text-sm font-semibold">Últimas mensagens</div>
          {q.isLoading ? (
            <div className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          ) : msgs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sem mensagens no período.</div>
          ) : (
            <div className="divide-y">
              {msgs.slice(0, 50).map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-3 text-sm">
                  <Badge variant={m.direction === "out" ? "default" : "outline"} className="w-16 justify-center">
                    {m.direction === "out" ? "OUT" : "IN"}
                  </Badge>
                  <StatusBadge s={m.status} />
                  <span className="flex-1 truncate text-muted-foreground">{m.content ?? "-"}</span>
                  <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, pct }: { icon: React.ReactNode; label: string; value: number; pct?: number }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">{icon}{label}</span>
        {pct !== undefined && <span>{pct}%</span>}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="text-muted-foreground">{value}</span></div>
      <div className="h-2 overflow-hidden rounded bg-muted"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function StatusBadge({ s }: { s: Msg["status"] }) {
  const map: Record<Msg["status"], { v: "default" | "outline" | "destructive" | "secondary"; l: string }> = {
    pending: { v: "outline", l: "pending" },
    sent: { v: "secondary", l: "sent" },
    delivered: { v: "default", l: "delivered" },
    read: { v: "default", l: "read" },
    failed: { v: "destructive", l: "failed" },
  };
  const m = map[s];
  return <Badge variant={m.v} className="w-20 justify-center">{m.l}</Badge>;
}