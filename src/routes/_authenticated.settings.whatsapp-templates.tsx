import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listCloudTemplates } from "@/lib/whatsapp-templates.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2, Pencil, FileText, Loader2, X } from "lucide-react";
import { TemplatePreview } from "@/components/whatsapp/template-preview";

type Tpl = {
  id: string; account_id: string; name: string; language: string; category: string; status: string;
  rejection_reason: string | null; variables_count: number; components: unknown; last_synced_at: string | null; meta_template_id: string | null;
};
type Account = { id: string; waba_id: string; display_phone_number: string | null; is_default: boolean };

async function api<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada.");
  const res = await fetch(path, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erro");
  return json as T;
}

export const Route = createFileRoute("/_authenticated/settings/whatsapp-templates")({
  head: () => ({ meta: [{ title: "Templates WhatsApp — Lívia CRM" }] }),
  component: TemplatesPage,
});

type TplButton = { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string; phone_number?: string };
type TplComponent = { type: string; format?: string; text?: string; buttons?: TplButton[]; example?: { body_text?: string[][] } };

function parseComponents(components: unknown) {
  const list = Array.isArray(components) ? (components as TplComponent[]) : [];
  const header = list.find((c) => c.type === "HEADER");
  const bodyC = list.find((c) => c.type === "BODY");
  const footer = list.find((c) => c.type === "FOOTER");
  const buttons = list.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  return {
    headerText: header?.text ?? "",
    body: bodyC?.text ?? "",
    footer: footer?.text ?? "",
    buttons: buttons as TplButton[],
    examples: bodyC?.example?.body_text?.[0] ?? [],
  };
}

function statusBadge(s: string, rejectionReason?: string | null) {
  const lower = s.toLowerCase();
  if (lower.includes("approved")) return <Badge className="bg-emerald-600">APPROVED</Badge>;
  if (lower.includes("rejected")) {
    const badge = <Badge variant="destructive">REJECTED</Badge>;
    if (!rejectionReason) return badge;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild><span className="cursor-help">{badge}</span></TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-wrap text-xs">{rejectionReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  if (lower.includes("paused") || lower.includes("disabled")) return <Badge variant="outline">{s}</Badge>;
  return <Badge variant="secondary">{s}</Badge>;
}

function TemplatesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCloudTemplates);
  const accountsQ = useQuery({ queryKey: ["wa-cloud-accounts"], queryFn: () => api<{ accounts: Account[] }>("/api/whatsapp-cloud-settings", "GET") });
  const accounts = accountsQ.data?.accounts ?? [];
  const [accountId, setAccountId] = useState<string>("");
  const effectiveId = accountId || accounts.find((a) => a.is_default)?.id || accounts[0]?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["wa-templates", effectiveId],
    // Sincroniza automaticamente com a Meta quando os dados locais estão vazios ou antigos.
    queryFn: () => listFn({ data: { accountId: effectiveId } }) as Promise<{ templates: Tpl[] }>,
    enabled: !!effectiveId,
    refetchInterval: 60_000,
  });

  const syncMut = useMutation({
    mutationFn: () => listFn({ data: { accountId: effectiveId, forceSync: true } }),
    onSuccess: () => { toast.success("Sincronizado."); qc.invalidateQueries({ queryKey: ["wa-templates"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api("/api/whatsapp-cloud-templates", "POST", { action: "delete", templateId: id }),
    onSuccess: () => { toast.success("Removido."); qc.invalidateQueries({ queryKey: ["wa-templates"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold"><FileText className="h-6 w-6" /> Templates WhatsApp</h1>
            <p className="text-sm text-muted-foreground">Crie, sincronize e acompanhe a aprovação dos templates da Meta.</p>
          </div>
          <div className="flex gap-2">
            {accounts.length > 1 && (
              <Select value={effectiveId} onValueChange={setAccountId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Conta" /></SelectTrigger>
                <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.display_phone_number ?? a.waba_id}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Button onClick={() => syncMut.mutate()} disabled={!effectiveId || syncMut.isPending} variant="outline">
              {syncMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Sincronizar
            </Button>
            <CreateDialog accountId={effectiveId} onDone={() => qc.invalidateQueries({ queryKey: ["wa-templates"] })} />
          </div>
        </header>

        {!accounts.length && <Card className="p-8 text-center text-sm text-muted-foreground">Conecte uma conta WhatsApp Cloud em <strong>Configurações → WhatsApp Cloud</strong> primeiro.</Card>}

        {effectiveId && (
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Nome</TableHead><TableHead>Idioma</TableHead><TableHead>Categoria</TableHead>
                <TableHead>Status</TableHead><TableHead>Variáveis</TableHead><TableHead>Atualizado</TableHead><TableHead>Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={7} className="text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></TableCell></TableRow>}
                {data?.templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.name}</TableCell>
                    <TableCell>{t.language}</TableCell>
                    <TableCell><Badge variant="outline">{t.category}</Badge></TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {statusBadge(t.status, t.rejection_reason)}
                        {t.rejection_reason && <div className="max-w-[220px] truncate text-[10px] text-destructive" title={t.rejection_reason}>{t.rejection_reason}</div>}
                      </div>
                    </TableCell>
                    <TableCell>{t.variables_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.last_synced_at ? new Date(t.last_synced_at).toLocaleString() : "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <EditDialog tpl={t} onDone={() => qc.invalidateQueries({ queryKey: ["wa-templates"] })} />
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir template "${t.name}"?`)) delMut.mutate(t.id); }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && !data?.templates.length && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">Nenhum template. Clique em <strong>Sincronizar</strong> ou crie um novo.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}

function CreateDialog({ accountId, onDone }: { accountId?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("MARKETING");
  const [headerText, setHeaderText] = useState("");
  const [body, setBody] = useState("Olá {{1}}, ");
  const [footer, setFooter] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const [buttons, setButtons] = useState<Array<{ type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string; phone_number?: string }>>([]);
  const varCount = (body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;

  const createMut = useMutation({
    mutationFn: () => api("/api/whatsapp-cloud-templates", "POST", {
      action: "create", accountId, name, language, category,
      headerText: headerText || undefined, body, footer: footer || undefined,
      buttons: buttons.length ? buttons : undefined,
      bodyExamples: examples.length === varCount && varCount > 0 ? examples : undefined,
    }),
    onSuccess: () => {
      toast.success("Template enviado!", { description: "A Meta pode levar até 24h para aprovar." });
      onDone();
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button disabled={!accountId}><Plus className="mr-1 h-4 w-4" /> Novo template</Button></DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Novo template</DialogTitle></DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="ex.: boas_vindas" /></div>
            <div><Label>Idioma</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt_BR">Português (BR)</SelectItem>
                  <SelectItem value="en_US">English (US)</SelectItem>
                  <SelectItem value="es_ES">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Categoria</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MARKETING">Marketing</SelectItem>
                  <SelectItem value="UTILITY">Utility</SelectItem>
                  <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Header (texto, opcional)</Label><Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} /></div>
          <div>
            <Label>Body (use {`{{1}}`}, {`{{2}}`}…)</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={1024} />
            <p className="mt-1 text-xs text-muted-foreground">{varCount} variável(is) detectada(s)</p>
          </div>
          {varCount > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <Label className="text-xs">Exemplos das variáveis (obrigatório para Meta aprovar)</Label>
              {Array.from({ length: varCount }).map((_, i) => (
                <Input key={i} placeholder={`Exemplo de {{${i + 1}}}`} value={examples[i] ?? ""} onChange={(e) => { const c = [...examples]; c[i] = e.target.value; setExamples(c); }} />
              ))}
            </div>
          )}
          <div><Label>Footer (opcional)</Label><Input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} /></div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between"><Label>Botões (até 3)</Label>
              <Button size="sm" variant="outline" disabled={buttons.length >= 3} onClick={() => setButtons([...buttons, { type: "QUICK_REPLY", text: "" }])}>+ Botão</Button>
            </div>
            {buttons.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={b.type} onValueChange={(v) => { const c = [...buttons]; c[i] = { ...c[i], type: v as typeof b.type }; setButtons(c); }}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="QUICK_REPLY">Resposta rápida</SelectItem>
                    <SelectItem value="URL">URL</SelectItem>
                    <SelectItem value="PHONE_NUMBER">Telefone</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Texto" value={b.text} maxLength={25} onChange={(e) => { const c = [...buttons]; c[i] = { ...c[i], text: e.target.value }; setButtons(c); }} />
                {b.type === "URL" && <Input placeholder="https://..." value={b.url ?? ""} onChange={(e) => { const c = [...buttons]; c[i] = { ...c[i], url: e.target.value }; setButtons(c); }} />}
                {b.type === "PHONE_NUMBER" && <Input placeholder="+5511..." value={b.phone_number ?? ""} onChange={(e) => { const c = [...buttons]; c[i] = { ...c[i], phone_number: e.target.value }; setButtons(c); }} />}
                <Button size="icon" variant="ghost" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
        </div>
          <aside className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Preview</Label>
            <div className="sticky top-2">
              <TemplatePreview headerText={headerText} body={body} footer={footer} buttons={buttons} examples={examples} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                As variáveis em amarelo são substituídas em cada envio. Templates aprovados são obrigatórios fora da janela de 24h.
              </p>
            </div>
          </aside>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => createMut.mutate()} disabled={!name || !body || createMut.isPending}>
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enviar para aprovação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ tpl, onDone }: { tpl: Tpl; onDone: () => void }) {
  const parsed = parseComponents(tpl.components);
  const [open, setOpen] = useState(false);
  const [headerText, setHeaderText] = useState(parsed.headerText);
  const [body, setBody] = useState(parsed.body);
  const [footer, setFooter] = useState(parsed.footer);
  const [examples, setExamples] = useState<string[]>(parsed.examples);
  const [buttons, setButtons] = useState<TplButton[]>(parsed.buttons);
  const varCount = (body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;

  function reset() {
    const p = parseComponents(tpl.components);
    setHeaderText(p.headerText); setBody(p.body); setFooter(p.footer);
    setExamples(p.examples); setButtons(p.buttons);
  }

  const updateMut = useMutation({
    mutationFn: () => api("/api/whatsapp-cloud-templates", "POST", {
      action: "update", templateId: tpl.id,
      headerText: headerText || undefined, body, footer: footer || undefined,
      buttons: buttons.length ? buttons : undefined,
      bodyExamples: examples.length === varCount && varCount > 0 ? examples : undefined,
    }),
    onSuccess: () => {
      toast.success("Template atualizado!", { description: "A Meta pode levar até 24h para reaprovar." });
      onDone();
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Editar template"><Pencil className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar {tpl.name}</DialogTitle></DialogHeader>
        {!tpl.meta_template_id && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            Este template ainda não está sincronizado com a Meta — sincronize antes de editar.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Nome, idioma e categoria não podem ser alterados pela Meta após a criação.</p>
            <div><Label>Header (texto, opcional)</Label><Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} /></div>
            <div>
              <Label>Body</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={1024} />
              <p className="mt-1 text-xs text-muted-foreground">{varCount} variável(is) detectada(s)</p>
            </div>
            {varCount > 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <Label className="text-xs">Exemplos das variáveis</Label>
                {Array.from({ length: varCount }).map((_, i) => (
                  <Input key={i} placeholder={`Exemplo de {{${i + 1}}}`} value={examples[i] ?? ""} onChange={(e) => { const c = [...examples]; c[i] = e.target.value; setExamples(c); }} />
                ))}
              </div>
            )}
            <div><Label>Footer (opcional)</Label><Input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} /></div>
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between"><Label>Botões (até 3)</Label>
                <Button size="sm" variant="outline" disabled={buttons.length >= 3} onClick={() => setButtons([...buttons, { type: "QUICK_REPLY", text: "" }])}>+ Botão</Button>
              </div>
              {buttons.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={b.type} onValueChange={(v) => { const c = [...buttons]; c[i] = { ...c[i], type: v as TplButton["type"] }; setButtons(c); }}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QUICK_REPLY">Resposta rápida</SelectItem>
                      <SelectItem value="URL">URL</SelectItem>
                      <SelectItem value="PHONE_NUMBER">Telefone</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input placeholder="Texto" value={b.text} maxLength={25} onChange={(e) => { const c = [...buttons]; c[i] = { ...c[i], text: e.target.value }; setButtons(c); }} />
                  {b.type === "URL" && <Input placeholder="https://..." value={b.url ?? ""} onChange={(e) => { const c = [...buttons]; c[i] = { ...c[i], url: e.target.value }; setButtons(c); }} />}
                  {b.type === "PHONE_NUMBER" && <Input placeholder="+5511..." value={b.phone_number ?? ""} onChange={(e) => { const c = [...buttons]; c[i] = { ...c[i], phone_number: e.target.value }; setButtons(c); }} />}
                  <Button size="icon" variant="ghost" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          </div>
          <aside className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Preview</Label>
            <div className="sticky top-2">
              <TemplatePreview headerText={headerText} body={body} footer={footer} buttons={buttons} examples={examples} />
            </div>
          </aside>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => updateMut.mutate()} disabled={!body || updateMut.isPending || !tpl.meta_template_id}>
            {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}