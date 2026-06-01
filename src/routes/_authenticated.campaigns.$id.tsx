import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Play, Pause, Upload, Trash2, Eye, RefreshCcw, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getCampaign, addCampaignTargets, removeCampaignTarget,
  setCampaignStatus, tickCampaignFn, previewCampaignMessage, updateCampaign,
} from "@/lib/campaigns.functions";

export const Route = createFileRoute("/_authenticated/campaigns/$id")({
  component: CampaignDetailPage,
});

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  draft: { label: "Rascunho", tone: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendada", tone: "bg-blue-500/15 text-blue-600" },
  running: { label: "Enviando", tone: "bg-emerald-500/15 text-emerald-600" },
  paused: { label: "Pausada", tone: "bg-amber-500/15 text-amber-600" },
  completed: { label: "Concluída", tone: "bg-violet-500/15 text-violet-600" },
  failed: { label: "Falha", tone: "bg-rose-500/15 text-rose-600" },
};

/**
 * CSV parser que respeita aspas duplas, escapes ("") e quebras de linha dentro de campos.
 * Detecta delimitador entre vírgula, ponto-e-vírgula ou tab.
 */
function parseCsv(input: string): Array<Record<string, string>> {
  let text = input.replace(/^\uFEFF/, ""); // BOM
  if (!text.trim()) return [];

  // Sniff delimiter pela primeira linha (fora de aspas)
  const firstLineEnd = (() => {
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') inQ = !inQ;
      else if ((c === "\n" || c === "\r") && !inQ) return i;
    }
    return text.length;
  })();
  const header = text.slice(0, firstLineEnd);
  const counts = {
    ",": (header.match(/,/g) ?? []).length,
    ";": (header.match(/;/g) ?? []).length,
    "\t": (header.match(/\t/g) ?? []).length,
  };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",") as string;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field.length || row.length) { row.push(field); rows.push(row); }
        row = []; field = "";
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
      return obj;
    });
}

function CampaignDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getCampaign);
  const addFn = useServerFn(addCampaignTargets);
  const rmFn = useServerFn(removeCampaignTarget);
  const statusFn = useServerFn(setCampaignStatus);
  const tickFn = useServerFn(tickCampaignFn);
  const previewFn = useServerFn(previewCampaignMessage);
  const updateFn = useServerFn(updateCampaign);

  const { data, isLoading } = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => getFn({ data: { id } }),
    refetchInterval: 3000,
  });

  const campaign = data?.campaign;
  const targets = data?.targets ?? [];

  const [csv, setCsv] = useState("phone,name\n5511999999999,Maria\n");
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [template, setTemplate] = useState("");
  const [savedTemplate, setSavedTemplate] = useState("");
  const tickTimer = useRef<number | null>(null);

  useEffect(() => {
    if (campaign?.template && campaign.template !== savedTemplate) {
      setTemplate(campaign.template);
      setSavedTemplate(campaign.template);
    }
  }, [campaign?.template]);

  // Client-side loop: while running, hit tick every (min..max) seconds
  useEffect(() => {
    if (!campaign) return;
    if (campaign.status !== "running") {
      if (tickTimer.current) { window.clearTimeout(tickTimer.current); tickTimer.current = null; }
      return;
    }
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      try {
        const r = await tickFn({ data: { id, batch: 1 } });
        if (r.reason === "no_pending") {
          qc.invalidateQueries({ queryKey: ["campaign", id] });
          return;
        }
      } catch (e) {
        console.error(e);
      }
      const min = campaign.throttle_min_seconds ?? 8;
      const max = Math.max(min, campaign.throttle_max_seconds ?? 20);
      const wait = (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
      tickTimer.current = window.setTimeout(loop, wait);
    };
    loop();
    return () => {
      cancelled = true;
      if (tickTimer.current) { window.clearTimeout(tickTimer.current); tickTimer.current = null; }
    };
  }, [campaign?.status, id]);

  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const hasPhoneColumn = parsed.length > 0 && Object.prototype.hasOwnProperty.call(parsed[0], "phone");
  const detectedColumns = parsed.length > 0 ? Object.keys(parsed[0]) : [];

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    const okType = /\.csv$|\.txt$/i.test(file.name) || file.type.includes("csv") || file.type.includes("text");
    if (!okType) { toast.error("Envie um arquivo .csv"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Arquivo muito grande (máx 5MB)"); return; }
    try {
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
      toast.success(`${file.name} carregado`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function downloadTemplate() {
    const sample = "phone,name,curso\n5511999999999,Maria,OAB\n5511888888888,João,Federal\n";
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modelo-campanha.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    if (!parsed.length) { toast.error("CSV vazio ou sem cabeçalho"); return; }
    if (!hasPhoneColumn) { toast.error("O CSV precisa ter a coluna 'phone'"); return; }
    setImporting(true);
    try {
      const items = parsed.map((r) => {
        const { phone, name, ...rest } = r;
        return { phone, name: name || undefined, custom_fields: rest };
      });
      const { inserted } = await addFn({ data: { campaignId: id, targets: items, dedupe: true } });
      toast.success(`${inserted} contatos importados`);
      setCsv("phone,name\n");
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["campaign", id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function changeStatus(s: "running" | "paused" | "draft" | "completed") {
    await statusFn({ data: { id, status: s } });
    qc.invalidateQueries({ queryKey: ["campaign", id] });
    qc.invalidateQueries({ queryKey: ["campaigns"] });
  }

  async function saveTemplate() {
    await updateFn({ data: { id, template } });
    setSavedTemplate(template);
    toast.success("Mensagem atualizada");
    qc.invalidateQueries({ queryKey: ["campaign", id] });
  }

  async function doPreview() {
    const sample = targets[0] ?? { name: "Maria", phone: "5511999999999", custom_fields: {} };
    const fields = { ...(sample.custom_fields as Record<string, string> ?? {}), name: sample.name ?? "", phone: sample.phone };
    const { preview } = await previewFn({ data: { template, fields } });
    setPreviewText(preview);
  }

  if (isLoading || !campaign) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;
  }

  const s = STATUS_LABEL[campaign.status] ?? STATUS_LABEL.draft;
  const pct = campaign.total_count ? Math.round((campaign.sent_count / campaign.total_count) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/campaigns"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{campaign.name}</h1>
            <div className="text-xs text-muted-foreground">
              Throttle {campaign.throttle_min_seconds}-{campaign.throttle_max_seconds}s · Janela {campaign.window_start_hour}h–{campaign.window_end_hour}h
            </div>
          </div>
          <Badge className={s.tone}>{s.label}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status !== "running" && (
            <Button onClick={() => changeStatus("running")} disabled={campaign.total_count === 0}>
              <Play className="mr-2 h-4 w-4" /> Iniciar envio
            </Button>
          )}
          {campaign.status === "running" && (
            <Button variant="outline" onClick={() => changeStatus("paused")}>
              <Pause className="mr-2 h-4 w-4" /> Pausar
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total</div><div className="text-2xl font-semibold">{campaign.total_count}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Enviadas</div><div className="text-2xl font-semibold text-emerald-600">{campaign.sent_count}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Pendentes</div><div className="text-2xl font-semibold">{data?.pendingCount ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Falhas</div><div className="text-2xl font-semibold text-rose-600">{campaign.failed_count}</div></CardContent></Card>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <Tabs defaultValue="targets">
        <TabsList>
          <TabsTrigger value="targets">Destinatários ({targets.length})</TabsTrigger>
          <TabsTrigger value="import">Importar CSV</TabsTrigger>
          <TabsTrigger value="message">Mensagem</TabsTrigger>
        </TabsList>

        <TabsContent value="targets">
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Telefone</th>
                      <th className="px-3 py-2 text-left">Nome</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Tentativas</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((t) => (
                      <tr key={t.id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{t.phone}</td>
                        <td className="px-3 py-2">{t.name ?? "—"}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {t.status}
                          </Badge>
                          {t.error && <div className="mt-0.5 text-[10px] text-rose-600">{t.error}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs">{t.attempts}</td>
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="icon" onClick={async () => {
                            await rmFn({ data: { id: t.id, campaignId: id } });
                            qc.invalidateQueries({ queryKey: ["campaign", id] });
                          }}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {targets.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">Nenhum destinatário ainda. Importe um CSV na próxima aba.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import">
          <Card>
            <CardHeader><CardTitle className="text-base">Importar CSV</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Envie um arquivo <code>.csv</code> ou cole o conteúdo abaixo. Cabeçalho obrigatório com a coluna <code>phone</code>. Opcional: <code>name</code> — qualquer outra coluna vira <code>{`{{coluna}}`}</code> no template. Aceita separador <code>,</code>, <code>;</code> ou tab, e campos entre aspas.
              </p>

              <div
                className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center transition hover:bg-muted/50"
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
              >
                <FileUp className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <div className="text-sm">Arraste um CSV aqui ou</div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    Escolher arquivo
                  </Button>
                  <Button variant="ghost" size="sm" onClick={downloadTemplate}>
                    Baixar modelo
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                {fileName && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Arquivo: <span className="font-mono">{fileName}</span>
                  </div>
                )}
              </div>

              <details className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
                  Ou cole/edite o conteúdo manualmente
                </summary>
                <div className="p-3">
                  <Textarea
                    rows={10}
                    value={csv}
                    onChange={(e) => { setCsv(e.target.value); setFileName(null); }}
                    className="font-mono text-xs"
                    placeholder="phone,name,curso&#10;5511999999999,Maria,OAB&#10;5511888888888,João,Federal"
                  />
                </div>
              </details>

              {parsed.length > 0 && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">{parsed.length} linhas</Badge>
                    {detectedColumns.map((c) => (
                      <Badge key={c} variant={c === "phone" ? "default" : "outline"} className="text-[10px]">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  {!hasPhoneColumn && (
                    <div className="text-xs text-rose-600">
                      ⚠ Falta a coluna obrigatória <code>phone</code>.
                    </div>
                  )}
                  <div className="max-h-48 overflow-auto rounded border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          {detectedColumns.map((c) => (
                            <th key={c} className="px-2 py-1 text-left font-medium">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.slice(0, 5).map((r, i) => (
                          <tr key={i} className="border-t border-border">
                            {detectedColumns.map((c) => (
                              <td key={c} className="px-2 py-1 font-mono">{r[c]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsed.length > 5 && (
                      <div className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
                        + {parsed.length - 5} linha(s) não mostradas no preview
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end">
                <Button onClick={handleImport} disabled={importing || !parsed.length || !hasPhoneColumn}>
                  <Upload className="mr-2 h-4 w-4" />
                  {importing ? "Importando…" : `Importar ${parsed.length} contatos`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="message">
          <Card>
            <CardHeader><CardTitle className="text-base">Modelo da mensagem</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={6} value={template} onChange={(e) => setTemplate(e.target.value)} />
              <div className="flex items-center gap-2">
                <Button onClick={saveTemplate} disabled={template === savedTemplate}>
                  <RefreshCcw className="mr-2 h-4 w-4" /> Salvar
                </Button>
                <Button variant="outline" onClick={doPreview}>
                  <Eye className="mr-2 h-4 w-4" /> Pré-visualizar
                </Button>
              </div>
              {previewText && (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                  {previewText}
                </div>
              )}
              <Label className="text-xs text-muted-foreground">
                Variáveis: {`{{name}}`}, {`{{phone}}`} e qualquer coluna do CSV.
              </Label>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}