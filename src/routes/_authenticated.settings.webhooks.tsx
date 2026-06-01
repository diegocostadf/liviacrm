import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Webhook, Plus, Trash2, Send, Loader2, Check, X, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  listWebhooks,
  upsertWebhook,
  deleteWebhook,
  testWebhook,
  listDeliveries,
  WEBHOOK_EVENTS,
} from "@/lib/webhooks.functions";

export const Route = createFileRoute("/_authenticated/settings/webhooks")({
  head: () => ({ meta: [{ title: "Webhooks — Lívia CRM" }] }),
  component: WebhooksPage,
});

type EditorState = {
  open: boolean;
  id?: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
};

const empty: EditorState = {
  open: false,
  id: undefined,
  name: "",
  url: "",
  events: [],
  active: true,
  secret: "",
};

function WebhooksPage() {
  const list = useServerFn(listWebhooks);
  const upsert = useServerFn(upsertWebhook);
  const del = useServerFn(deleteWebhook);
  const test = useServerFn(testWebhook);
  const deliveries = useServerFn(listDeliveries);
  const qc = useQueryClient();

  const { data: hooks, isLoading } = useQuery({ queryKey: ["webhooks"], queryFn: () => list() });
  const { data: events } = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: () => deliveries({ data: {} }),
    refetchInterval: 8000,
  });

  const [editor, setEditor] = useState<EditorState>(empty);

  const saveMut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: editor.id,
          name: editor.name.trim(),
          url: editor.url.trim(),
          events: editor.events as (typeof WEBHOOK_EVENTS)[number][],
          active: editor.active,
          secret: editor.secret.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Webhook salvo.");
      setEditor(empty);
      qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar."),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Webhook removido.");
      qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });

  const testMut = useMutation({
    mutationFn: (id: string) => test({ data: { id } }),
    onSuccess: (r) => {
      if (r.ok) toast.success(`OK (${r.status}) em ${r.latencyMs}ms`);
      else toast.error(`Falhou${r.status ? ` (${r.status})` : ""}: ${r.response?.slice(0, 120) ?? ""}`);
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      qc.invalidateQueries({ queryKey: ["webhook-deliveries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro."),
  });

  function toggleEvent(ev: string) {
    setEditor((s) => ({
      ...s,
      events: s.events.includes(ev) ? s.events.filter((e) => e !== ev) : [...s.events, ev],
    }));
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Webhook className="h-6 w-6" /> Webhooks externos
            </h1>
            <p className="text-sm text-muted-foreground">
              Envie eventos do CRM para Zapier, Make, RD, ActiveCampaign e qualquer URL HTTPS.
            </p>
          </div>
          <Button onClick={() => setEditor({ ...empty, open: true })}>
            <Plus className="mr-2 h-4 w-4" /> Novo webhook
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Endpoints configurados</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : !hooks?.length ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Nenhum webhook ainda. Clique em "Novo webhook" para começar.
              </div>
            ) : (
              <div className="space-y-3">
                {hooks.map((w) => (
                  <div key={w.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{w.name}</span>
                          {w.active ? (
                            <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" />ativo</Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1"><X className="h-3 w-3" />pausado</Badge>
                          )}
                          {w.last_status ? (
                            <Badge variant={w.last_status >= 200 && w.last_status < 300 ? "secondary" : "destructive"}>
                              {w.last_status}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{w.url}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {w.events.map((ev) => (
                            <Badge key={ev} variant="outline" className="font-mono text-[10px]">{ev}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="icon" variant="ghost" title="Testar" onClick={() => testMut.mutate(w.id)} disabled={testMut.isPending}>
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Editar"
                          onClick={() =>
                            setEditor({
                              open: true,
                              id: w.id,
                              name: w.name,
                              url: w.url,
                              events: w.events,
                              active: w.active,
                              secret: "",
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Excluir" onClick={() => delMut.mutate(w.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entregas recentes</CardTitle>
          </CardHeader>
          <CardContent>
            {!events?.length ? (
              <div className="text-sm text-muted-foreground">Nenhuma entrega registrada ainda.</div>
            ) : (
              <div className="space-y-2">
                {events.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-sm">
                    {d.succeeded ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <X className="h-4 w-4 text-destructive" />
                    )}
                    <span className="font-mono text-xs">{d.event}</span>
                    {d.response_status ? <Badge variant="outline">{d.response_status}</Badge> : null}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={editor.open} onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor.id ? "Editar webhook" : "Novo webhook"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={editor.name} onChange={(e) => setEditor((s) => ({ ...s, name: e.target.value }))} placeholder="Ex: Zapier — leads quentes" />
            </div>
            <div className="space-y-1.5">
              <Label>URL</Label>
              <Input value={editor.url} onChange={(e) => setEditor((s) => ({ ...s, url: e.target.value }))} placeholder="https://hooks.zapier.com/..." />
            </div>
            <div className="space-y-1.5">
              <Label>Secret (opcional)</Label>
              <Input
                value={editor.secret}
                onChange={(e) => setEditor((s) => ({ ...s, secret: e.target.value }))}
                placeholder={editor.id ? "Deixe vazio para manter o atual" : "Usado para assinar X-Livia-Signature (HMAC-SHA256)"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Eventos</Label>
              <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <label key={ev} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={editor.events.includes(ev)} onCheckedChange={() => toggleEvent(ev)} />
                    <span className="font-mono text-xs">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label>Ativo</Label>
                <p className="text-xs text-muted-foreground">Receber eventos em tempo real.</p>
              </div>
              <Switch checked={editor.active} onCheckedChange={(v) => setEditor((s) => ({ ...s, active: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditor(empty)}>Cancelar</Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !editor.name.trim() || !editor.url.trim() || editor.events.length === 0}
            >
              {saveMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
