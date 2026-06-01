import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import {
  listInstances,
  createInstance,
  connectInstance,
  fetchInstanceStatus,
  disconnectInstance,
  deleteInstance,
  testConnection,
} from "@/lib/evolution.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, QrCode, Power, RefreshCw, PlugZap, CheckCircle2, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/connections")({
  head: () => ({ meta: [{ title: "Conexões — Lívia CRM" }] }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listInstances);
  const createFn = useServerFn(createInstance);
  const connectFn = useServerFn(connectInstance);
  const statusFn = useServerFn(fetchInstanceStatus);
  const disconnectFn = useServerFn(disconnectInstance);
  const deleteFn = useServerFn(deleteInstance);
  const testFn = useServerFn(testConnection);

  const { data: instances } = useQuery({
    queryKey: ["instances"],
    queryFn: () => listFn(),
    refetchInterval: 10_000,
  });

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [qr, setQr] = useState<{ name: string; base64: string | null; code: string | null } | null>(null);
  const [testResult, setTestResult] = useState<
    | { ok: true; baseUrl: string; latencyMs: number; version: string | null; message: string | null }
    | { ok: false; error: string }
    | null
  >(null);

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => {
      setTestResult(r);
      if (r.ok) toast.success(`Evolution OK em ${r.latencyMs}ms`);
      else toast.error(r.error);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      setTestResult({ ok: false, error: msg });
      toast.error(msg);
    },
  });

  const create = useMutation({
    mutationFn: (name: string) => createFn({ data: { name } }),
    onSuccess: () => {
      toast.success("Instância criada");
      setShowNew(false);
      setNewName("");
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  async function handleConnect(name: string) {
    try {
      const r = await connectFn({ data: { name } });
      setQr({ name, base64: r.qrBase64, code: r.pairingCode });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  // Poll status while QR is open
  useEffect(() => {
    if (!qr) return;
    const id = setInterval(async () => {
      try {
        const r = await statusFn({ data: { name: qr.name } });
        if (r.status === "connected") {
          toast.success("Conectado!");
          setQr(null);
          qc.invalidateQueries({ queryKey: ["instances"] });
        }
      } catch { /* noop */ }
    }, 3000);
    return () => clearInterval(id);
  }, [qr, statusFn, qc]);

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conexões WhatsApp</h1>
          <p className="text-sm text-muted-foreground">Gerencie as instâncias da Evolution API.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
            <PlugZap className="mr-2 h-4 w-4" /> {test.isPending ? "Testando…" : "Testar conexão"}
          </Button>
          <Button onClick={() => setShowNew(true)}><Plus className="mr-2 h-4 w-4" /> Nova instância</Button>
        </div>
      </div>

      {testResult && (
        <Card className={`mb-4 p-4 ${testResult.ok ? "border-success/40" : "border-destructive/40"}`}>
          <div className="flex items-start gap-3">
            {testResult.ok ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
            )}
            <div className="flex-1 text-sm">
              {testResult.ok ? (
                <>
                  <div className="font-medium">Evolution acessível</div>
                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    <div>URL: <span className="font-mono">{testResult.baseUrl}</span></div>
                    <div>Latência: {testResult.latencyMs}ms</div>
                    {testResult.version && <div>Versão: {testResult.version}</div>}
                    {testResult.message && <div>{testResult.message}</div>}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-medium text-destructive">Falha na conexão</div>
                  <div className="mt-1 break-words font-mono text-xs text-muted-foreground">{testResult.error}</div>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(instances ?? []).map((inst) => (
          <Card key={inst.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{inst.name}</div>
                <div className="text-xs text-muted-foreground">{inst.evolution_instance_name}</div>
              </div>
              <StatusBadge status={inst.status} />
            </div>
            {inst.phone_number && (
              <div className="mt-3 text-sm">{inst.profile_name} · {inst.phone_number}</div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {inst.status !== "connected" ? (
                <Button size="sm" variant="default" onClick={() => handleConnect(inst.evolution_instance_name)}>
                  <QrCode className="mr-1.5 h-3.5 w-3.5" /> Conectar
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={async () => { await disconnectFn({ data: { name: inst.evolution_instance_name } }); qc.invalidateQueries({ queryKey: ["instances"] }); }}>
                  <Power className="mr-1.5 h-3.5 w-3.5" /> Desconectar
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => statusFn({ data: { name: inst.evolution_instance_name } }).then(() => qc.invalidateQueries({ queryKey: ["instances"] }))}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Excluir instância?")) { await deleteFn({ data: { name: inst.evolution_instance_name } }); qc.invalidateQueries({ queryKey: ["instances"] }); } }}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </Card>
        ))}
        {(!instances || instances.length === 0) && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            Nenhuma instância criada ainda.
          </Card>
        )}
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova instância</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="iname">Nome (apenas letras, números, _ e -)</Label>
            <Input id="iname" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="vendas-01" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={() => create.mutate(newName)} disabled={!newName || create.isPending}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Conecte seu WhatsApp</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {qr?.base64 ? (
              <img src={qr.base64.startsWith("data:") ? qr.base64 : `data:image/png;base64,${qr.base64}`} alt="QR Code" className="h-64 w-64 rounded-lg border border-border" />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">Gerando QR…</div>
            )}
            {qr?.code && <div className="text-xs text-muted-foreground">Código: <span className="font-mono">{qr.code}</span></div>}
            <p className="text-center text-xs text-muted-foreground">Abra WhatsApp → Aparelhos conectados → Conectar aparelho</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    connected: { label: "Conectado", variant: "default" },
    connecting: { label: "Conectando", variant: "secondary" },
    disconnected: { label: "Desconectado", variant: "outline" },
  };
  const cfg = map[status] ?? map.disconnected;
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}