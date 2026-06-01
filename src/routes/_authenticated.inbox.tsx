import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { listConversations, getConversation, markRead, updateContact } from "@/lib/inbox.functions";
import { sendTextMessage } from "@/lib/evolution.functions";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Lívia CRM" }] }),
  component: InboxPage,
});

type Conversation = {
  id: string;
  status: string;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  contact: { id: string; name: string | null; phone: string; profile_pic_url: string | null; city: string | null; state: string | null; tags: string[] | null };
  instance: { id: string; name: string; evolution_instance_name: string };
};

function InboxPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listConversations);
  const getFn = useServerFn(getConversation);
  const markFn = useServerFn(markRead);
  const sendFn = useServerFn(sendTextMessage);
  const updateContactFn = useServerFn(updateContact);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listFn() as Promise<Conversation[]>,
  });

  // Realtime: refresh on message/conversation changes
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
    <div className="grid h-screen grid-cols-[320px_1fr_300px]">
      {/* Conversations list */}
      <div className="flex flex-col border-r border-border bg-card">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar contato…" className="pl-8" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((c) => {
            const active = c.id === selectedId;
            const name = c.contact.name || c.contact.phone;
            return (
              <button
                key={c.id}
                onClick={() => { setSelectedId(c.id); markFn({ data: { id: c.id } }); }}
                className={`flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition hover:bg-accent/50 ${active ? "bg-accent" : ""}`}
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={c.contact.profile_pic_url ?? undefined} />
                  <AvatarFallback className="text-xs">{name[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="truncate text-sm font-medium">{name}</div>
                    {c.last_message_at && (
                      <div className="shrink-0 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(c.last_message_at), { locale: ptBR, addSuffix: false })}
                      </div>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{c.last_message_preview ?? "Sem mensagens"}</div>
                </div>
                {c.unread_count > 0 && (
                  <Badge className="shrink-0 px-1.5 text-[10px]">{c.unread_count}</Badge>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="p-8 text-center text-xs text-muted-foreground">Nenhuma conversa.</div>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-col bg-background">
        {selectedId ? (
          <Thread id={selectedId} getFn={getFn} sendFn={sendFn} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Selecione uma conversa
          </div>
        )}
      </div>

      {/* Contact panel */}
      <div className="border-l border-border bg-card">
        {selectedId ? <ContactPanel id={selectedId} getFn={getFn} updateContactFn={updateContactFn} /> : null}
      </div>
    </div>
  );
}

function Thread({ id, getFn, sendFn }: { id: string; getFn: ReturnType<typeof useServerFn<typeof getConversation>>; sendFn: ReturnType<typeof useServerFn<typeof sendTextMessage>> }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["conversation", id], queryFn: () => getFn({ data: { id } }) });
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data?.messages.length]);

  async function handleSend() {
    if (!text.trim()) return;
    const t = text;
    setText("");
    try {
      await sendFn({ data: { conversationId: id, text: t } });
      qc.invalidateQueries({ queryKey: ["conversation", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setText(t);
    }
  }

  const contact = (data?.conversation as { contact: { name: string | null; phone: string; profile_pic_url: string | null } } | undefined)?.contact;

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-border bg-card px-4 py-3">
        <Avatar className="h-9 w-9">
          <AvatarImage src={contact?.profile_pic_url ?? undefined} />
          <AvatarFallback>{(contact?.name ?? contact?.phone ?? "?")[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div>
          <div className="text-sm font-medium">{contact?.name || contact?.phone}</div>
          <div className="text-xs text-muted-foreground">{contact?.phone}</div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {(data?.messages ?? []).map((m) => {
          const out = m.direction === "out";
          return (
            <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${out ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"}`}>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                <div className={`mt-1 text-[10px] opacity-70`}>
                  {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
        {(data?.messages ?? []).length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground">Sem mensagens ainda.</div>
        )}
      </div>

      <div className="border-t border-border bg-card p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Digite uma mensagem…"
            className="min-h-[44px] resize-none"
            rows={1}
          />
          <Button onClick={handleSend} disabled={!text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}

function ContactPanel({ id, getFn, updateContactFn }: { id: string; getFn: ReturnType<typeof useServerFn<typeof getConversation>>; updateContactFn: ReturnType<typeof useServerFn<typeof updateContact>> }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["conversation", id], queryFn: () => getFn({ data: { id } }) });
  const c = (data?.conversation as { contact: { id: string; name: string | null; phone: string; email: string | null; city: string | null; state: string | null; company: string | null; tags: string[] | null; profile_pic_url: string | null } } | undefined)?.contact;
  const [tags, setTags] = useState<string>("");
  const [name, setName] = useState<string>("");

  useEffect(() => {
    if (c) {
      setTags((c.tags ?? []).join(", "));
      setName(c.name ?? "");
    }
  }, [c?.id]);

  if (!c) return null;

  async function save() {
    await updateContactFn({ data: { id: c.id, name, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } });
    qc.invalidateQueries({ queryKey: ["conversation", id] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex flex-col items-center text-center">
        <Avatar className="h-16 w-16">
          <AvatarImage src={c.profile_pic_url ?? undefined} />
          <AvatarFallback className="text-lg">{(c.name ?? c.phone)[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="mt-2 text-sm font-semibold">{c.name || c.phone}</div>
        <div className="text-xs text-muted-foreground">{c.phone}</div>
      </div>

      <div className="mt-6 space-y-3 text-sm">
        <div>
          <label className="text-xs text-muted-foreground">Nome</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-8" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Tags (separadas por vírgula)</label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} className="mt-1 h-8" placeholder="lead, vip" />
        </div>
        {c.email && <Field label="E-mail" value={c.email} />}
        {c.city && <Field label="Cidade" value={c.city} />}
        {c.company && <Field label="Empresa" value={c.company} />}
        <Button size="sm" className="w-full" onClick={save}>Salvar</Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}