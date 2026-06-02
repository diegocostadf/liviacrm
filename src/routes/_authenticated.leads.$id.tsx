import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { getLead, updateLead, addLeadNote } from "@/lib/leads.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, MessageSquare, Mail, Phone, MapPin, Building2, Flame, Snowflake, Sun, Save, StickyNote, Activity, Megaphone, Send } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/leads/$id")({
  head: () => ({ meta: [{ title: "Lead — Lívia CRM" }] }),
  component: LeadDetailPage,
});

const TEMP_COLORS: Record<string, string> = {
  frio: "bg-sky-500/15 text-sky-500",
  morno: "bg-amber-500/15 text-amber-500",
  quente: "bg-red-500/15 text-red-500",
};
const TEMP_ICON: Record<string, React.ReactNode> = {
  frio: <Snowflake className="h-3 w-3" />,
  morno: <Sun className="h-3 w-3" />,
  quente: <Flame className="h-3 w-3" />,
};

function LeadDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getLead);
  const upd = useServerFn(updateLead);
  const addNote = useServerFn(addLeadNote);

  const { data, isLoading } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => get({ data: { id } }),
  });

  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (data?.contact) {
      setForm({
        name: data.contact.name ?? "",
        email: data.contact.email ?? "",
        city: data.contact.city ?? "",
        state: data.contact.state ?? "",
        company: data.contact.company ?? "",
        job_title: data.contact.job_title ?? "",
        source: data.contact.source ?? "",
        lead_status: data.contact.lead_status,
        tags: (data.contact.tags ?? []).join(", "),
      });
    }
  }, [data?.contact]);

  const save = useMutation({
    mutationFn: () =>
      upd({
        data: {
          id,
          name: form.name || null,
          email: form.email || null,
          city: form.city || null,
          state: form.state || null,
          company: form.company || null,
          job_title: form.job_title || null,
          source: form.source || null,
          lead_status: form.lead_status,
          tags: form.tags ? form.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
        },
      }),
    onSuccess: () => {
      toast.success("Lead atualizado");
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const [note, setNote] = useState("");
  const noteMut = useMutation({
    mutationFn: () => addNote({ data: { contact_id: id, content: note } }),
    onSuccess: () => {
      setNote("");
      toast.success("Nota adicionada");
      qc.invalidateQueries({ queryKey: ["lead", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  if (isLoading || !data || !form) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;
  }

  const c = data.contact;

  return (
    <div className="h-screen overflow-y-auto">
      <div className="border-b border-border bg-card/40 px-6 py-4">
        <Link to="/leads" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Voltar para Leads
        </Link>
        <div className="flex items-start gap-4">
          <Avatar className="h-14 w-14">
            <AvatarImage src={c.profile_pic_url ?? undefined} />
            <AvatarFallback>{(c.name ?? c.phone).slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{c.name ?? c.phone}</h1>
              <Badge variant="outline">{c.lead_status}</Badge>
              {c.opted_out && <Badge variant="destructive">Opt-out</Badge>}
              {data.events[0] && (
                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${TEMP_COLORS[data.events[0].temperature]}`}>
                  {TEMP_ICON[data.events[0].temperature]} {data.events[0].temperature} · {data.events[0].score}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>
              {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
              {(c.city || c.state) && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{[c.city, c.state].filter(Boolean).join(" / ")}</span>}
              {c.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{c.company}</span>}
            </div>
          </div>
          {data.conversations[0] && (
            <Link to="/inbox" className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-accent">
              <MessageSquare className="h-3.5 w-3.5" /> Abrir no Inbox
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline"><Activity className="mr-1.5 h-3.5 w-3.5" />Histórico</TabsTrigger>
              <TabsTrigger value="messages"><MessageSquare className="mr-1.5 h-3.5 w-3.5" />Mensagens ({data.messages.length})</TabsTrigger>
              <TabsTrigger value="intent">Intenção ({data.events.length})</TabsTrigger>
              <TabsTrigger value="campaigns"><Megaphone className="mr-1.5 h-3.5 w-3.5" />Campanhas ({data.campaignSends.length})</TabsTrigger>
              <TabsTrigger value="notes"><StickyNote className="mr-1.5 h-3.5 w-3.5" />Notas ({data.notes.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="mt-4">
              <Card className="p-4">
                <Timeline data={data} />
              </Card>
            </TabsContent>

            <TabsContent value="messages" className="mt-4">
              <Card className="max-h-[600px] overflow-y-auto p-4">
                {data.messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nenhuma mensagem.</div>
                ) : (
                  <div className="space-y-3">
                    {data.messages.map((m) => (
                      <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.direction === "out" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <div className="whitespace-pre-wrap break-words">{m.content ?? `[${m.type}]`}</div>
                          <div className="mt-1 text-[10px] opacity-70">
                            {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
                            {m.sent_by && ` · ${m.sent_by}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="intent" className="mt-4">
              <Card className="p-4">
                {data.events.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Sem eventos de intenção.</div>
                ) : (
                  <div className="space-y-3">
                    {data.events.map((e) => (
                      <div key={e.id} className="border-l-2 border-primary/50 pl-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`rounded px-1.5 py-0.5 ${TEMP_COLORS[e.temperature]}`}>{e.temperature}</span>
                          <span className="font-medium">{e.intent}</span>
                          <span className="text-muted-foreground">score: {e.score}</span>
                          <span className="ml-auto text-muted-foreground">{format(new Date(e.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
                        </div>
                        {e.summary && <p className="mt-1 text-sm">{e.summary}</p>}
                        {e.suggested_next && <p className="mt-1 text-xs text-muted-foreground"><strong>Próximo passo:</strong> {e.suggested_next}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="campaigns" className="mt-4">
              <Card className="p-4">
                {data.campaignSends.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Lead nunca foi incluído em campanhas.</div>
                ) : (
                  <div className="space-y-2">
                    {data.campaignSends.map((s) => (
                      <div key={s.id} className="flex items-start gap-3 rounded border border-border p-2 text-sm">
                        <Badge variant={s.status === "sent" || s.status === "replied" ? "default" : s.status === "failed" ? "destructive" : "secondary"}>
                          {s.status}
                        </Badge>
                        <div className="flex-1">
                          <div className="text-xs font-medium">{s.campaign_name ?? "Campanha"}</div>
                          {s.rendered_message && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.rendered_message}</div>}
                          {s.error && <div className="mt-1 text-xs text-destructive">{s.error}</div>}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.sent_at ? format(new Date(s.sent_at), "dd/MM HH:mm", { locale: ptBR }) : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card className="p-4">
                <div className="mb-3 flex gap-2">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Adicionar nota interna…" rows={2} />
                  <Button onClick={() => noteMut.mutate()} disabled={!note.trim() || noteMut.isPending}><Send className="h-4 w-4" /></Button>
                </div>
                {data.notes.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Sem notas.</div>
                ) : (
                  <div className="space-y-2">
                    {data.notes.map((n) => (
                      <div key={n.id} className="rounded border border-border bg-muted/30 p-2 text-sm">
                        <div className="whitespace-pre-wrap">{n.content}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(n.created_at), { locale: ptBR, addSuffix: true })}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 text-sm font-medium">Dados do lead</div>
            <div className="space-y-2 text-sm">
              <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Cidade"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
                <Field label="UF"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
              </div>
              <Field label="Empresa"><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
              <Field label="Cargo"><Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /></Field>
              <Field label="Origem"><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
              <Field label="Status">
                <Select value={form.lead_status} onValueChange={(v) => setForm({ ...form, lead_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="novo">Novo</SelectItem>
                    <SelectItem value="engajado">Engajado</SelectItem>
                    <SelectItem value="inscrito">Inscrito</SelectItem>
                    <SelectItem value="perdido">Perdido</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Tags (separadas por vírgula)">
                <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </Field>
              <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
                <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar
              </Button>
            </div>
          </Card>

          <Card className="p-4 text-xs">
            <div className="mb-2 text-sm font-medium">Jornada</div>
            <Stat label="Criado em" value={format(new Date(c.created_at), "dd/MM/yy HH:mm", { locale: ptBR })} />
            <Stat label="Última atualização" value={formatDistanceToNow(new Date(c.updated_at), { locale: ptBR, addSuffix: true })} />
            <Stat label="Link enviado" value={String(c.landing_link_sent_count)} />
            {c.landing_link_sent_at && <Stat label="Último link" value={format(new Date(c.landing_link_sent_at), "dd/MM/yy HH:mm", { locale: ptBR })} />}
            <Stat label="Jornada concluída" value={c.journey_completed ? "Sim" : "Não"} />
            {c.last_score_at && <Stat label="Último score" value={formatDistanceToNow(new Date(c.last_score_at), { locale: ptBR, addSuffix: true })} />}
            {c.opted_out && (
              <div className="mt-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                Opt-out em {c.opted_out_at && format(new Date(c.opted_out_at), "dd/MM/yy", { locale: ptBR })}
                {c.opt_out_reason && <div>Motivo: {c.opt_out_reason}</div>}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Timeline({ data }: { data: any }) {
  type Item = { date: string; type: string; title: string; desc?: string };
  const items: Item[] = [];
  for (const m of data.messages) {
    items.push({
      date: m.created_at,
      type: m.direction === "in" ? "msg_in" : "msg_out",
      title: m.direction === "in" ? "Recebida" : `Enviada${m.sent_by ? ` (${m.sent_by})` : ""}`,
      desc: m.content ?? `[${m.type}]`,
    });
  }
  for (const e of data.events) {
    items.push({ date: e.created_at, type: "intent", title: `Intenção: ${e.intent} · ${e.temperature}`, desc: e.summary ?? undefined });
  }
  for (const s of data.campaignSends) {
    items.push({ date: s.sent_at ?? s.created_at, type: "campaign", title: `Campanha: ${s.campaign_name ?? "—"} (${s.status})`, desc: s.rendered_message ?? undefined });
  }
  for (const n of data.notes) items.push({ date: n.created_at, type: "note", title: "Nota interna", desc: n.content });
  items.sort((a, b) => +new Date(b.date) - +new Date(a.date));

  if (items.length === 0) return <div className="text-sm text-muted-foreground">Sem histórico ainda.</div>;
  return (
    <div className="space-y-3">
      {items.slice(0, 80).map((i, idx) => (
        <div key={idx} className="border-l-2 border-border pl-3">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="text-[10px]">{i.type}</Badge>
            <span className="font-medium">{i.title}</span>
            <span className="ml-auto text-muted-foreground">{format(new Date(i.date), "dd/MM HH:mm", { locale: ptBR })}</span>
          </div>
          {i.desc && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{i.desc}</p>}
        </div>
      ))}
    </div>
  );
}