import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { exportCampaignSends, exportMessages, exportIntentEvents, getCampaignPerformance } from "@/lib/reports.functions";

export const Route = createFileRoute("/_authenticated/reports/exports")({
  component: ExportsPage,
});

function downloadBase64(filename: string, mime: string, b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const SEND_STATUSES = ["pending", "sent", "failed", "skipped", "replied", "skipped_dedupe", "skipped_replied"] as const;
type SendStatus = (typeof SEND_STATUSES)[number];

function ExportsPage() {
  const fetchPerf = useServerFn(getCampaignPerformance);
  const exportSends = useServerFn(exportCampaignSends);
  const exportMsgs = useServerFn(exportMessages);
  const exportIntents = useServerFn(exportIntentEvents);

  const perf = useQuery({ queryKey: ["reports-perf-export"], queryFn: () => fetchPerf({ data: {} }) });

  const [campaignId, setCampaignId] = useState<string>("");
  const [statuses, setStatuses] = useState<SendStatus[]>([]);
  const [sendDays, setSendDays] = useState(30);

  const [msgDays, setMsgDays] = useState(30);
  const [intentDays, setIntentDays] = useState(90);

  const sendsMut = useMutation({
    mutationFn: (format: "csv" | "xlsx") => exportSends({ data: {
      campaign_id: campaignId || undefined,
      status: statuses.length ? statuses : undefined,
      format, days: sendDays,
    } }),
    onSuccess: (r) => { downloadBase64(r.filename, r.mime, r.data); toast.success(`${r.count} envios exportados`); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao exportar"),
  });

  const msgsMut = useMutation({
    mutationFn: (format: "csv" | "xlsx") => exportMsgs({ data: { days: msgDays, format } }),
    onSuccess: (r) => { downloadBase64(r.filename, r.mime, r.data); toast.success(`${r.count} mensagens exportadas`); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao exportar"),
  });

  const intentsMut = useMutation({
    mutationFn: (format: "csv" | "xlsx") => exportIntents({ data: { days: intentDays, format } }),
    onSuccess: (r) => { downloadBase64(r.filename, r.mime, r.data); toast.success(`${r.count} eventos exportados`); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao exportar"),
  });

  function toggleStatus(s: SendStatus) {
    setStatuses((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Envios de campanha</h2>
          <p className="text-xs text-muted-foreground">Enviados, pendentes, com erro, respondidos — por campanha e status.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Campanha</Label>
          <Select value={campaignId || "all"} onValueChange={(v) => setCampaignId(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as campanhas</SelectItem>
              {(perf.data?.campaigns ?? []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status (vazio = todos)</Label>
          <div className="flex flex-wrap gap-1">
            {SEND_STATUSES.map((s) => {
              const on = statuses.includes(s);
              return <Badge key={s} variant={on ? "default" : "outline"} className="cursor-pointer" onClick={() => toggleStatus(s)}>{s}</Badge>;
            })}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Período</Label>
          <Select value={String(sendDays)} onValueChange={(v) => setSendDays(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[7, 14, 30, 60, 90, 180, 365].map((d) => <SelectItem key={d} value={String(d)}>{d} dias</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={() => sendsMut.mutate("csv")} disabled={sendsMut.isPending}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
          <Button onClick={() => sendsMut.mutate("xlsx")} disabled={sendsMut.isPending}><Download className="h-3.5 w-3.5 mr-1" />Excel</Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Mensagens / conversas</h2>
          <p className="text-xs text-muted-foreground">Histórico de mensagens enviadas e recebidas.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Período</Label>
          <Select value={String(msgDays)} onValueChange={(v) => setMsgDays(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[7, 14, 30, 60, 90, 180].map((d) => <SelectItem key={d} value={String(d)}>{d} dias</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={() => msgsMut.mutate("csv")} disabled={msgsMut.isPending}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
          <Button onClick={() => msgsMut.mutate("xlsx")} disabled={msgsMut.isPending}><Download className="h-3.5 w-3.5 mr-1" />Excel</Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3 lg:col-span-2">
        <div>
          <h2 className="text-sm font-semibold">Eventos de intenção (scoring)</h2>
          <p className="text-xs text-muted-foreground">Histórico do classificador da Júlia: temperatura, score e próximas ações sugeridas.</p>
        </div>
        <div className="space-y-1 max-w-xs">
          <Label className="text-xs">Período</Label>
          <Select value={String(intentDays)} onValueChange={(v) => setIntentDays(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[7, 30, 90, 180, 365].map((d) => <SelectItem key={d} value={String(d)}>{d} dias</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={() => intentsMut.mutate("csv")} disabled={intentsMut.isPending}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
          <Button onClick={() => intentsMut.mutate("xlsx")} disabled={intentsMut.isPending}><Download className="h-3.5 w-3.5 mr-1" />Excel</Button>
        </div>
      </Card>
    </div>
  );
}