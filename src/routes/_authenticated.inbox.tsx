import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listConversations,
  getConversation,
  markRead,
  setUnread,
  toggleFavorite,
  setArchived,
  updateContact,
  addNote,
  listTeam,
  transferConversation,
} from "@/lib/inbox.functions";
import { sendTextMessage, sendMediaMessage, listInstances } from "@/lib/evolution.functions";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  Search, Send, Star, Archive, ArchiveRestore, MoreVertical, MailOpen, Mail,
  Paperclip, StickyNote, Check, CheckCheck, FileText, Download, MapPin,
} from "lucide-react";
import { formatDistanceToNow, format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Lívia CRM" }] }),
  component: InboxPage,
});

type ConversationRow = {
  id: string;
  status: string;
  is_favorite: boolean;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  assigned_to: string | null;
  instance_id: string;
  contact: { id: string; name: string | null; phone: string; profile_pic_url: string | null; city: string | null; state: string | null; tags: string[] | null };
  instance: { id: string; name: string; evolution_instance_name: string };
};

type Filter = "all" | "unread" | "favorites" | "mine" | "archived";

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  type: string;
  content: string | null;
  media_url: string | null;
  media_mime: string | null;
  status: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

function InboxPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listConversations);
  const getFn = useServerFn(getConversation);
  const markFn = useServerFn(markRead);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [instanceFilter, setInstanceFilter] = useState<string>("all");

  const listInstancesFn = useServerFn(listInstances);
  const { data: instances } = useQuery({
    queryKey: ["instances-all"],
    queryFn: () => listInstancesFn(),
  });

  const filters = useMemo(() => ({
    status: filter === "archived" ? ("archived" as const) : ("open" as const),
    unread: filter === "unread" || undefined,
    favorites: filter === "favorites" || undefined,
    mine: filter === "mine" || undefined,
    instanceId: instanceFilter !== "all" ? instanceFilter : undefined,
  }), [filter, instanceFilter]);

  const { data: conversations } = useQuery({
    queryKey: ["conversations", filters],
    queryFn: () => listFn({ data: filters }) as Promise<ConversationRow[]>,
  });

  useEffect(() => {
    const ch = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["conversations"] });
        if (selectedId) qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, selectedId]);

  const filtered = (conversations ?? []).filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.contact.name ?? "").toLowerCase().includes(q) || c.contact.phone.includes(q);
  });

  return (
    <div className="grid h-screen grid-cols-[340px_1fr_320px]">
      {/* Lista */}
      <div className="flex min-h-0 flex-col border-r border-border bg-card">
        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar contato…" className="pl-8" />
          </div>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="all" className="px-1 text-[11px]">Todas</TabsTrigger>
              <TabsTrigger value="unread" className="px-1 text-[11px]">Não lidas</TabsTrigger>
              <TabsTrigger value="favorites" className="px-1 text-[11px]">Favoritas</TabsTrigger>
              <TabsTrigger value="mine" className="px-1 text-[11px]">Minhas</TabsTrigger>
              <TabsTrigger value="archived" className="px-1 text-[11px]">Arquiv.</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={instanceFilter} onValueChange={setInstanceFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Instância" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as instâncias</SelectItem>
              {(instances ?? []).map((i) => (
                <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((c) => (
            <ConversationRowItem
              key={c.id}
              c={c}
              active={c.id === selectedId}
              onSelect={() => { setSelectedId(c.id); if (c.unread_count > 0) markFn({ data: { id: c.id } }); }}
              onChanged={() => qc.invalidateQueries({ queryKey: ["conversations"] })}
            />
          ))}
          {filtered.length === 0 && (
            <div className="p-8 text-center text-xs text-muted-foreground">Nenhuma conversa.</div>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-h-0 flex-col bg-background">
        {selectedId ? (
          <Thread id={selectedId} getFn={getFn} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Selecione uma conversa
          </div>
        )}
      </div>

      {/* Painel contato */}
      <div className="min-h-0 border-l border-border bg-card">
        {selectedId ? <ContactPanel id={selectedId} getFn={getFn} /> : null}
      </div>
    </div>
  );
}

function ConversationRowItem({
  c, active, onSelect, onChanged,
}: { c: ConversationRow; active: boolean; onSelect: () => void; onChanged: () => void }) {
  const favFn = useServerFn(toggleFavorite);
  const archFn = useServerFn(setArchived);
  const unreadFn = useServerFn(setUnread);
  const markFn = useServerFn(markRead);
  const name = c.contact.name || c.contact.phone;

  return (
    <div className={`group relative border-b border-border ${active ? "bg-accent" : "hover:bg-accent/50"}`}>
      <button onClick={onSelect} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={c.contact.profile_pic_url ?? undefined} />
          <AvatarFallback className="text-xs">{name[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-center gap-1 truncate">
              {c.is_favorite && <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400" />}
              <span className="truncate text-sm font-medium">{name}</span>
            </div>
            {c.last_message_at && (
              <div className="shrink-0 text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(c.last_message_at), { locale: ptBR, addSuffix: false })}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-xs text-muted-foreground">{c.last_message_preview ?? "Sem mensagens"}</div>
            {c.unread_count > 0 && (
              <Badge className="shrink-0 px-1.5 text-[10px]">{c.unread_count}</Badge>
            )}
          </div>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-6 w-6 opacity-0 group-hover:opacity-100">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={async () => { await favFn({ data: { id: c.id, value: !c.is_favorite } }); onChanged(); }}>
            <Star className="mr-2 h-4 w-4" /> {c.is_favorite ? "Desfavoritar" : "Favoritar"}
          </DropdownMenuItem>
          {c.unread_count > 0 ? (
            <DropdownMenuItem onClick={async () => { await markFn({ data: { id: c.id } }); onChanged(); }}>
              <MailOpen className="mr-2 h-4 w-4" /> Marcar como lida
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={async () => { await unreadFn({ data: { id: c.id } }); onChanged(); }}>
              <Mail className="mr-2 h-4 w-4" /> Marcar como não lida
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {c.status === "archived" ? (
            <DropdownMenuItem onClick={async () => { await archFn({ data: { id: c.id, archived: false } }); onChanged(); }}>
              <ArchiveRestore className="mr-2 h-4 w-4" /> Desarquivar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={async () => { await archFn({ data: { id: c.id, archived: true } }); onChanged(); }}>
              <Archive className="mr-2 h-4 w-4" /> Arquivar
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function dayLabel(d: Date) {
  if (isToday(d)) return "Hoje";
  if (isYesterday(d)) return "Ontem";
  return format(d, "dd 'de' MMMM, yyyy", { locale: ptBR });
}

function StatusTicks({ status }: { status: string }) {
  if (status === "sent") return <Check className="h-3 w-3 opacity-70" />;
  if (status === "delivered") return <CheckCheck className="h-3 w-3 opacity-70" />;
  if (status === "read") return <CheckCheck className="h-3 w-3 text-sky-400" />;
  if (status === "failed") return <span className="text-[10px] text-destructive">!</span>;
  return null;
}

function MessageBubble({ m }: { m: MessageRow }) {
  const out = m.direction === "out";
  const time = new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  let body: React.ReactNode = null;
  if (m.type === "image" && m.media_url) {
    body = <img src={m.media_url} alt="" className="max-h-80 rounded-lg" />;
  } else if (m.type === "audio" && m.media_url) {
    body = <audio controls src={m.media_url} className="h-10" />;
  } else if (m.type === "video" && m.media_url) {
    body = <video controls src={m.media_url} className="max-h-80 rounded-lg" />;
  } else if (m.type === "document" && m.media_url) {
    const filename = (m.metadata as { filename?: string } | null)?.filename ?? m.content ?? "arquivo";
    body = (
      <a href={m.media_url} download={filename} className="flex items-center gap-2 rounded-md bg-background/40 px-2 py-1.5 text-xs hover:underline">
        <FileText className="h-4 w-4" /> <span className="truncate">{filename}</span> <Download className="h-3.5 w-3.5" />
      </a>
    );
  } else if (m.type === "location") {
    body = <div className="flex items-center gap-1 text-xs"><MapPin className="h-3.5 w-3.5" /> {m.content}</div>;
  }

  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${out ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"}`}>
        {body && <div className="mb-1">{body}</div>}
        {m.content && m.type !== "location" && m.type !== "document" && (
          <div className="whitespace-pre-wrap break-words">{m.content}</div>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
          <span>{time}</span>
          {out && <StatusTicks status={m.status} />}
        </div>
      </div>
    </div>
  );
}

function NoteBubble({ content, time }: { content: string; time: string }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[80%] rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-yellow-600 dark:text-yellow-400">
          <StickyNote className="h-3 w-3" /> Nota interna
        </div>
        <div className="whitespace-pre-wrap text-foreground/90">{content}</div>
        <div className="mt-1 text-right text-[10px] opacity-60">{time}</div>
      </div>
    </div>
  );
}

function Thread({ id, getFn }: { id: string; getFn: ReturnType<typeof useServerFn<typeof getConversation>> }) {
  const qc = useQueryClient();
  const sendFn = useServerFn(sendTextMessage);
  const sendMediaFn = useServerFn(sendMediaMessage);
  const noteFn = useServerFn(addNote);
  const favFn = useServerFn(toggleFavorite);
  const archFn = useServerFn(setArchived);
  const { data } = useQuery({ queryKey: ["conversation", id], queryFn: () => getFn({ data: { id } }) });
  const [text, setText] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const messages = (data?.messages ?? []) as MessageRow[];
  const notes = (data?.notes ?? []) as unknown as Array<{ id: string; content: string; created_at: string }>;

  // Merge messages + notes timeline
  const timeline = useMemo(() => {
    const items: Array<{ kind: "msg"; m: MessageRow } | { kind: "note"; n: { id: string; content: string; created_at: string } }> = [];
    messages.forEach((m) => items.push({ kind: "msg", m }));
    notes.forEach((n) => items.push({ kind: "note", n }));
    items.sort((a, b) => {
      const ta = a.kind === "msg" ? a.m.created_at : a.n.created_at;
      const tb = b.kind === "msg" ? b.m.created_at : b.n.created_at;
      return new Date(ta).getTime() - new Date(tb).getTime();
    });
    return items;
  }, [messages, notes]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [timeline.length]);

  const conv = data?.conversation as { id: string; is_favorite: boolean; status: string; contact: { name: string | null; phone: string; profile_pic_url: string | null }; instance: { name: string; status: string } } | undefined;

  async function handleSend() {
    if (!text.trim() || sending) return;
    const t = text;
    setText("");
    setSending(true);
    try {
      if (noteMode) {
        await noteFn({ data: { conversationId: id, content: t } });
      } else {
        await sendFn({ data: { conversationId: id, text: t } });
      }
      qc.invalidateQueries({ queryKey: ["conversation", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setText(t);
      toast.error(e instanceof Error ? e.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  async function handleFile(file: File) {
    if (file.size > 16 * 1024 * 1024) { toast.error("Arquivo muito grande (máx 16MB)"); return; }
    setSending(true);
    try {
      const base64 = await fileToBase64(file);
      await sendMediaFn({ data: {
        conversationId: id,
        mediaBase64: base64,
        mimetype: file.type || "application/octet-stream",
        filename: file.name,
        caption: text || undefined,
      }});
      setText("");
      qc.invalidateQueries({ queryKey: ["conversation", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar mídia");
    } finally {
      setSending(false);
    }
  }

  // Render timeline with day separators
  const rendered: React.ReactNode[] = [];
  let lastDay: Date | null = null;
  timeline.forEach((item, idx) => {
    const t = item.kind === "msg" ? item.m.created_at : item.n.created_at;
    const d = new Date(t);
    if (!lastDay || !isSameDay(lastDay, d)) {
      rendered.push(
        <div key={`day-${idx}`} className="my-3 flex justify-center">
          <div className="rounded-full bg-muted px-3 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{dayLabel(d)}</div>
        </div>
      );
      lastDay = d;
    }
    if (item.kind === "msg") rendered.push(<MessageBubble key={item.m.id} m={item.m} />);
    else rendered.push(<NoteBubble key={item.n.id} content={item.n.content} time={new Date(item.n.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} />);
  });

  return (
    <>
      <div className="flex items-center justify-between gap-2.5 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="h-9 w-9">
            <AvatarImage src={conv?.contact.profile_pic_url ?? undefined} />
            <AvatarFallback>{(conv?.contact.name ?? conv?.contact.phone ?? "?")[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{conv?.contact.name || conv?.contact.phone}</div>
            <div className="truncate text-xs text-muted-foreground">
              {conv?.contact.phone} · via {conv?.instance.name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => conv && favFn({ data: { id: conv.id, value: !conv.is_favorite } }).then(() => qc.invalidateQueries({ queryKey: ["conversation", id] }))}>
            <Star className={`h-4 w-4 ${conv?.is_favorite ? "fill-yellow-400 text-yellow-400" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => conv && archFn({ data: { id: conv.id, archived: conv.status !== "archived" } }).then(() => { qc.invalidateQueries({ queryKey: ["conversations"] }); qc.invalidateQueries({ queryKey: ["conversation", id] }); })}>
            {conv?.status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {rendered}
        {timeline.length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground">Sem mensagens ainda.</div>
        )}
      </div>

      <div className={`border-t border-border p-3 ${noteMode ? "bg-yellow-500/5" : "bg-card"}`}>
        {noteMode && (
          <div className="mb-2 flex items-center gap-1 text-[11px] text-yellow-600 dark:text-yellow-400">
            <StickyNote className="h-3 w-3" /> Modo nota interna — visível só para a equipe.
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
          <Button variant="ghost" size="icon" disabled={noteMode || sending} onClick={() => fileRef.current?.click()} title="Anexar arquivo">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            variant={noteMode ? "default" : "ghost"}
            size="icon"
            onClick={() => setNoteMode((v) => !v)}
            title="Nota interna"
            className={noteMode ? "bg-yellow-500 hover:bg-yellow-500/90 text-yellow-950" : ""}
          >
            <StickyNote className="h-4 w-4" />
          </Button>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={noteMode ? "Escreva uma nota interna…" : "Digite uma mensagem…"}
            className="min-h-[44px] resize-none"
            rows={1}
            disabled={sending}
          />
          <Button onClick={handleSend} disabled={!text.trim() || sending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result ?? "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

function ContactPanel({ id, getFn }: { id: string; getFn: ReturnType<typeof useServerFn<typeof getConversation>> }) {
  const qc = useQueryClient();
  const updateContactFn = useServerFn(updateContact);
  const transferFn = useServerFn(transferConversation);
  const noteFn = useServerFn(addNote);
  const teamFn = useServerFn(listTeam);

  const { data } = useQuery({ queryKey: ["conversation", id], queryFn: () => getFn({ data: { id } }) });
  const { data: team } = useQuery({ queryKey: ["team"], queryFn: () => teamFn() });

  const conv = data?.conversation as { id: string; assigned_to: string | null; contact: { id: string; name: string | null; phone: string; email: string | null; city: string | null; state: string | null; company: string | null; tags: string[] | null; profile_pic_url: string | null } } | undefined;
  const notes = (data?.notes ?? []) as unknown as Array<{ id: string; content: string; created_at: string }>;

  const [tab, setTab] = useState<"detalhes" | "notas">("detalhes");
  const [tags, setTags] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [newNote, setNewNote] = useState("");

  useEffect(() => {
    if (conv?.contact) {
      setTags((conv.contact.tags ?? []).join(", "));
      setName(conv.contact.name ?? "");
      setCity(conv.contact.city ?? "");
      setEmail(conv.contact.email ?? "");
    }
  }, [conv?.contact?.id]);

  if (!conv) return null;
  const c = conv.contact;
  const convId = conv.id;
  const assignedTo = conv.assigned_to;

  async function save() {
    await updateContactFn({ data: {
      id: c.id, name, city,
      email: email || "",
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    }});
    toast.success("Contato atualizado");
    qc.invalidateQueries({ queryKey: ["conversation", id] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  }

  async function transfer(value: string) {
    await transferFn({ data: { id: convId, assignedTo: value === "none" ? null : value } });
    toast.success("Atendimento transferido");
    qc.invalidateQueries({ queryKey: ["conversation", id] });
  }

  async function addNewNote() {
    if (!newNote.trim()) return;
    await noteFn({ data: { conversationId: convId, content: newNote.trim() } });
    setNewNote("");
    qc.invalidateQueries({ queryKey: ["conversation", id] });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col items-center p-4 text-center">
        <Avatar className="h-16 w-16">
          <AvatarImage src={c.profile_pic_url ?? undefined} />
          <AvatarFallback className="text-lg">{(c.name ?? c.phone)[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="mt-2 text-sm font-semibold">{c.name || c.phone}</div>
        <div className="text-xs text-muted-foreground">{c.phone}</div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "detalhes" | "notas")} className="flex-1 min-h-0 flex flex-col">
        <TabsList className="mx-3 grid grid-cols-2">
          <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
          <TabsTrigger value="notas">Notas {notes.length > 0 && <Badge variant="secondary" className="ml-1 px-1 text-[10px]">{notes.length}</Badge>}</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {tab === "detalhes" && (
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-muted-foreground">Responsável</label>
                <Select value={assignedTo ?? "none"} onValueChange={transfer}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem responsável</SelectItem>
                    {(team ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Nome</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-8" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">E-mail</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-8" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Cidade</label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 h-8" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Tags (vírgula)</label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} className="mt-1 h-8" placeholder="lead, vip" />
                {tags && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button size="sm" className="w-full" onClick={save}>Salvar</Button>
            </div>
          )}

          {tab === "notas" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Adicionar nota interna…" className="min-h-[60px] resize-none text-sm" />
                <Button size="sm" className="w-full" onClick={addNewNote} disabled={!newNote.trim()}>
                  <StickyNote className="mr-2 h-3.5 w-3.5" /> Adicionar nota
                </Button>
              </div>
              <div className="space-y-2">
                {notes.map((n: { id: string; content: string; created_at: string }) => (
                  <div key={n.id} className="rounded-md border border-border bg-background p-2 text-xs">
                    <div className="text-foreground/90">{n.content}</div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{format(new Date(n.created_at), "dd/MM HH:mm")}</span>
                    </div>
                  </div>
                ))}
                {notes.length === 0 && (
                  <div className="py-6 text-center text-xs text-muted-foreground">Nenhuma nota ainda.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}